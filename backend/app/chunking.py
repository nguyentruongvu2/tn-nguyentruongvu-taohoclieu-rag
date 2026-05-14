"""
================================================================================
MODULE: chunking.py
PURPOSE: Document chunking for RAG pipeline (Stage 2)
================================================================================

OVERVIEW:
This module implements a two-stage chunking strategy for cleaned Markdown documents:

1. HEADER-BASED CHUNKING: Uses LangChain's MarkdownHeaderTextSplitter to chunk
   documents by hierarchical headers (h1, h2, h3), preserving document structure
   and semantic boundaries.

2. RECURSIVE CHARACTER SPLITTING: Applies RecursiveCharacterTextSplitter to
   control chunk size (500-800 chars) with overlap (100 chars) for embedding
   compatibility. Ensures chunks are neither too large nor too small.

METADATA PRESERVATION:
Every chunk retains full hierarchical context through metadata:
  - h1: Chapter/document title (ALWAYS preserved)
  - h2: Section title (None if not present)
  - h3: Subsection title (None if not present)
  - chunk_id: Unique identifier for tracking
  - source: Original document filename

WORKFLOW:
  Input (cleaned Markdown)
    ↓
  [Stage 1] MarkdownHeaderTextSplitter
    → Chunks by headers (#, ##, ###)
    → Preserves h1, h2, h3 in metadata
    ↓
  [Stage 2] RecursiveCharacterTextSplitter
    → Splits large chunks (size > 800)
    → Maintains overlap (100 chars)
    → Preserves metadata from Stage 1
    ↓
  Output (List[Document])
    → Each Document has page_content + metadata
    → Ready for embedding and retrieval

DESIGN PRINCIPLES:
- Non-destructive: Never lose semantic meaning
- Hierarchical: Preserve document structure
- Contextual: Each chunk knows its chapter (h1)
- Consistent: Standard metadata for all chunks
- Production-grade: Error handling, validation, logging

QUALITY METRICS:
Track key statistics during chunking:
  - Total chunks generated
  - Average chunk size
  - Chunks with h1/h2/h3 coverage
  - Metadata consistency

USE CASES:
1. After markdown cleaning: chunk_markdown(cleaned_text, source_filename)
2. Before embedding: chunksList fed to embedding model
3. RAG retrieval: Metadata used for context enrichment
4. Document analysis: Statistics for quality assessment
"""

import logging
import hashlib
import re
from typing import List, Optional, Dict, Tuple
from dataclasses import dataclass
from langchain_core.documents import Document

try:
    from ftfy import fix_text as _ftfy_fix_text  # type: ignore
except Exception:  # pragma: no cover - optional dependency
    _ftfy_fix_text = None

# Configure logging
logger = logging.getLogger(__name__)

MIN_CHUNK_WORDS = 100
MIN_CHUNK_CHARS = 130
MIN_OVERLAP_RATIO = 0.10
MAX_OVERLAP_RATIO = 0.20
SENTENCE_END_RE = re.compile(r'[.!?][\)\]\}"\'”’»]*$')
SQL_TAIL_RE = re.compile(
    r"\b(?:select|from|where|join|left\s+join|right\s+join|inner\s+join|group\s+by|order\s+by|having|"
    r"insert\s+into|update|delete\s+from|set|values|on|and|or|union)\s*$",
    re.IGNORECASE,
)
SQL_KEYWORDS = (
    "SELECT",
    "UPDATE",
    "INSERT",
    "DELETE",
    "CREATE",
    "ALTER",
    "DROP",
    "FROM",
    "WHERE",
    "JOIN",
    "LEFT",
    "RIGHT",
    "INNER",
    "OUTER",
    "GROUP",
    "ORDER",
    "BY",
    "HAVING",
    "INTO",
    "VALUES",
    "SET",
)
SQL_KEYWORD_RE = re.compile(r"\b(" + "|".join(SQL_KEYWORDS) + r")\b", re.IGNORECASE)
HEADING_LINE_RE = re.compile(r"^(\s*#{1,3}\s*)(.*)$")


# ============================================================================
# DATA STRUCTURES
# ============================================================================

@dataclass
class ChunkStatistics:
    """Statistics about the chunking process.
    
    Attributes:
        total_chunks: Total number of chunks generated
        avg_chunk_size: Average character count per chunk
        chunks_with_h1: Number of chunks with h1 (should be all)
        chunks_with_h2: Number of chunks with h2
        chunks_with_h3: Number of chunks with h3
        min_chunk_size: Smallest chunk size
        max_chunk_size: Largest chunk size
        total_characters: Total characters across all chunks
    """
    total_chunks: int = 0
    avg_chunk_size: float = 0.0
    chunks_with_h1: int = 0
    chunks_with_h2: int = 0
    chunks_with_h3: int = 0
    min_chunk_size: int = 0
    max_chunk_size: int = 0
    total_characters: int = 0


# ============================================================================
# CORE CHUNKING PIPELINE
# ============================================================================

def chunk_markdown(
    text: str,
    source: str = "unknown",
    chunk_size: int = 800,
    chunk_overlap: int = 100,
    debug: bool = False,
    title: Optional[str] = None,
    doc_id: Optional[str] = None,
    file_name: Optional[str] = None,
) -> Tuple[List[Document], ChunkStatistics]:
    """
    Two-stage chunking pipeline for cleaned Markdown documents.
    
    This function implements the complete RAG Stage 2 chunking strategy:
    1. Header-based chunking to preserve document structure
    2. Recursive character splitting for size control
    
    Args:
        text: Cleaned Markdown content (output from markdown_cleaner.py)
        source: Original document filename for metadata tracking
        chunk_size: Target chunk size in characters (default: 800)
        chunk_overlap: Character overlap between chunks (default: 100)
        debug: Enable detailed logging (default: False)
        title: Optional title to prepend as h1 if not present (default: None)
        doc_id: Optional document identifier for source tracing metadata
        file_name: Optional original filename for source tracing metadata
    
    Returns:
        Tuple containing:
        - List[Document]: LangChain Document objects with page_content + metadata
        - ChunkStatistics: Metrics about the chunking process
    
    Raises:
        ValueError: If text is empty or invalid
        TypeError: If arguments have incorrect types
    
    Example:
        >>> markdown_text = '''
        ... # Chapter 1: Introduction
        ... 
        ... ## Section 1.1: Overview
        ... This is the first section content.
        ... 
        ... ## Section 1.2: Details
        ... More detailed information here.
        ... '''
        >>> documents, stats = chunk_markdown(markdown_text, source="lecture.md")
        >>> print(f"Generated {stats.total_chunks} chunks")
        >>> for doc in documents:
        ...     print(f"[{doc.metadata['h1']}] - {len(doc.page_content)} chars")
    
    Pipeline:
        1. Validate input
        2. Ensure proper markdown structure (prepend title if needed)
        3. Extract header structure
        4. Apply MarkdownHeaderTextSplitter (Stage 1)
        5. Apply RecursiveCharacterTextSplitter (Stage 2)
        6. Enhance metadata (add chunk_id, source)
        7. Calculate statistics
        8. Return documents + stats
    """
    
    # ===== VALIDATION =====
    if not isinstance(text, str):
        raise TypeError(f"text must be str, got {type(text)}")
    if not isinstance(source, str):
        raise TypeError(f"source must be str, got {type(source)}")
    if not text or not text.strip():
        raise ValueError("text cannot be empty")
    if chunk_size <= 0 or chunk_overlap < 0:
        raise ValueError(f"Invalid chunk_size ({chunk_size}) or chunk_overlap ({chunk_overlap})")
    if chunk_overlap >= chunk_size:
        raise ValueError(f"chunk_overlap ({chunk_overlap}) must be less than chunk_size ({chunk_size})")
    
    if debug:
        logger.info("="*80)
        logger.info("STARTING TWO-STAGE CHUNKING PIPELINE")
        logger.info("="*80)
        logger.info(f"Input: {len(text)} characters")
        logger.info(f"Configuration: chunk_size={chunk_size}, overlap={chunk_overlap}")

    # ===== TEXT CLEANING LAYER (SAFE PRE-PROCESSING) =====
    # Why: PDF conversion often leaves isolated symbols and wrapped lines.
    # Keep this conservative to avoid changing source meaning.
    text = clean_text(text)
    
    # ===== ENSURE PROPER MARKDOWN STRUCTURE =====
    text = _ensure_markdown_structure(text, title=title, debug=debug)
    
    # Normalize wrapped PDF lines before chunking to preserve sentence integrity.
    text = _normalize_paragraph_line_breaks(text)

    # ===== STAGE 1: HEADER-BASED CHUNKING =====
    if debug:
        logger.info("\n[STAGE 1/2] Applying Header-based Chunking...")
    
    stage1_docs = _apply_header_chunking(text)
    
    if debug:
        logger.info(f"  [+] Generated {len(stage1_docs)} header-based chunks")
    
    # ===== STAGE 2: RECURSIVE CHARACTER SPLITTING =====
    if debug:
        logger.info("\n[STAGE 2/2] Applying Recursive Character Splitting...")
    
    stage2_docs = _apply_recursive_splitting(
        stage1_docs,
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap
    )

    # ===== SAFE BOUNDARY & QUALITY PATCHES (NON-DESTRUCTIVE EXTENSIONS) =====
    # Why: avoid sentence/SQL cuts and merge very small chunks with low learning value.
    stage2_docs = _fix_invalid_chunk_boundaries(stage2_docs)
    stage2_docs = _merge_low_quality_chunks_by_chars(stage2_docs, min_chars=MIN_CHUNK_CHARS)
    
    if debug:
        logger.info(f"  [+] Generated {len(stage2_docs)} final chunks after size control")
    
    # ===== METADATA ENHANCEMENT =====
    final_docs = _enhance_metadata(
        stage2_docs,
        source,
        doc_id=doc_id,
        file_name=file_name,
    )
    
    # ===== FILTER EMPTY CHUNKS =====
    final_docs = [doc for doc in final_docs if doc.page_content.strip()]
    final_docs = _merge_heading_only_chunks(final_docs)
    
    if debug:
        logger.info(f"  [+] Filtered to {len(final_docs)} non-empty chunks")
    
    # ===== CALCULATE STATISTICS =====
    stats = _calculate_statistics(final_docs)
    
    if debug:
        logger.info("\n" + "="*80)
        logger.info("CHUNKING COMPLETE")
        logger.info("="*80)
        logger.info(f"Total chunks: {stats.total_chunks}")
        logger.info(f"Average size: {stats.avg_chunk_size:.0f} chars")
        logger.info(f"H1 coverage: {stats.chunks_with_h1}/{stats.total_chunks} (100%)")
        logger.info(f"H2 coverage: {stats.chunks_with_h2}/{stats.total_chunks} ({100*stats.chunks_with_h2/max(1,stats.total_chunks):.1f}%)")
        logger.info(f"H3 coverage: {stats.chunks_with_h3}/{stats.total_chunks} ({100*stats.chunks_with_h3/max(1,stats.total_chunks):.1f}%)")
        logger.info("="*80 + "\n")
    
    return final_docs, stats


def _is_heading_only_text(text: str) -> bool:
    lines = [ln.strip() for ln in (text or "").splitlines() if ln.strip()]
    if not lines:
        return False
    if len(lines) > 3:
        return False
    return all(re.match(r"^#{1,3}\s+", ln) for ln in lines)


def _merge_heading_only_chunks(documents: List[Document]) -> List[Document]:
    if not documents:
        return []

    merged: List[Document] = []
    i = 0
    while i < len(documents):
        current = documents[i]
        text = current.page_content.strip()

        if _is_heading_only_text(text) and i + 1 < len(documents):
            nxt = documents[i + 1]
            combined_meta = nxt.metadata.copy()
            for key in ("h1", "h2", "h3"):
                if not combined_meta.get(key) and current.metadata.get(key):
                    combined_meta[key] = current.metadata.get(key)

            merged_next = Document(
                page_content=f"{text}\n\n{nxt.page_content.strip()}".strip(),
                metadata=combined_meta,
            )
            documents[i + 1] = merged_next
            i += 1
            continue

        merged.append(current)
        i += 1

    return merged


def _word_count(text: str) -> int:
    return len(re.findall(r"\S+", text or ""))


def clean_text(text: str) -> str:
    """
    Conservative text cleaning for chunking pre-processing.

    Responsibilities:
    - Remove isolated broken symbols (for example standalone '$')
    - Fix spacing artifacts
    - Merge wrongly wrapped paragraph lines
    - Keep content meaning unchanged (no aggressive rewriting)
    """
    if not text:
        return ""

    # Preserve old flow while extending cleaning quality for SQL curriculum artifacts.
    cleaned = clean_sql_curriculum_text(text)
    cleaned = cleaned.replace("\u00a0", " ")
    cleaned = re.sub(r"(?<!\w)\$(?!\w)", " ", cleaned)
    cleaned = re.sub(r"[ \t]+", " ", cleaned)
    cleaned = re.sub(r"\n[ \t]+", "\n", cleaned)
    cleaned = _normalize_paragraph_line_breaks(cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()


def _fix_vietnamese_text_encoding(text: str) -> str:
    if not text:
        return ""
    if _ftfy_fix_text is None:
        return text
    try:
        return _ftfy_fix_text(text)
    except Exception:
        return text


def _normalize_sql_keyword_tokens(text: str) -> str:
    if not text:
        return ""
    return SQL_KEYWORD_RE.sub(lambda m: m.group(1).upper(), text)


def _sanitize_sql_inline_content(content: str) -> str:
    if not content:
        return ""

    cleaned = content
    # Normalize common bracket artifacts from PDF extraction.
    cleaned = re.sub(r"\]\s*\$|\[\s*\$|\[\s*\*\s*\|", "[ ]", cleaned)

    # Remove noisy PDF symbols while keeping semantic punctuation.
    cleaned = cleaned.replace("\x0c", " ").replace("\t", " ")
    cleaned = cleaned.replace("$", " ").replace("|", " ")

    # Strip uncommon symbol wrappers around SQL keywords.
    cleaned = re.sub(
        r"(?i)(?<![A-Za-z0-9_#])[^A-Za-z0-9_\s\[\]\(\),.;:+\-]*(SELECT|UPDATE|INSERT|DELETE|CREATE|ALTER|DROP|FROM|WHERE|JOIN|GROUP|ORDER|BY|HAVING|INTO|VALUES|SET)[^A-Za-z0-9_\s\[\]\(\),.;:+\-]*",
        lambda m: m.group(1).upper(),
        cleaned,
    )

    cleaned = _normalize_sql_keyword_tokens(cleaned)
    cleaned = re.sub(r"[ ]{2,}", " ", cleaned)
    return cleaned.strip()


def clean_sql_curriculum_text(text: str) -> str:
    """
    Clean extracted SQL curriculum chunk text from PDF artifacts.

    Logic:
    1) Remove noisy symbols/form-feed/tab/separator lines
    2) Repair common SQL parsing artifacts
    3) Normalize spaces/newlines
    4) Preserve markdown heading structure (#, ##, ###)
    5) Fix Vietnamese font encoding when ftfy is available
    """
    if not text:
        return ""

    cleaned = text.replace("\r\n", "\n").replace("\r", "\n")
    cleaned = _fix_vietnamese_text_encoding(cleaned)

    # Remove long visual separators from PDF extraction.
    cleaned = re.sub(r"(?m)^\s*[-=]{3,}\s*$", "", cleaned)

    output_lines: List[str] = []
    for raw_line in cleaned.split("\n"):
        line = raw_line.rstrip()
        heading_match = HEADING_LINE_RE.match(line)
        if heading_match:
            prefix = heading_match.group(1)
            heading_text = _sanitize_sql_inline_content(heading_match.group(2))
            output_lines.append(f"{prefix}{heading_text}".rstrip())
            continue

        output_lines.append(_sanitize_sql_inline_content(line))

    cleaned = "\n".join(output_lines)
    cleaned = re.sub(r"[ \t]{2,}", " ", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()


def _is_list_line(line: str) -> bool:
    return bool(re.match(r"^\s*(?:[-*+]\s+|\d+[.)]\s+)", line))


def _is_heading_line(line: str) -> bool:
    return bool(re.match(r"^\s*#{1,6}\s+", line or ""))


def _has_non_heading_content(lines: List[str]) -> bool:
    for raw in lines:
        line = (raw or "").strip()
        if not line:
            continue
        if not _is_heading_line(line):
            return True
    return False


def _split_into_semantic_blocks(text: str) -> List[str]:
    """
    Split text into semantic blocks while preserving list integrity.
    Blocks are paragraph/list-level units and are never split by character.
    """
    lines = text.splitlines()
    blocks: List[str] = []
    current: List[str] = []

    def flush() -> None:
        if current:
            block = "\n".join(current).strip()
            if block:
                blocks.append(block)
            current.clear()

    i = 0
    while i < len(lines):
        line = lines[i]

        if not line.strip():
            flush()
            i += 1
            continue

        if _is_list_line(line):
            flush()
            list_lines = [line]
            i += 1
            while i < len(lines):
                nxt = lines[i]
                # Keep list block intact: list items and indented continuations.
                if not nxt.strip():
                    if i + 1 < len(lines) and (
                        _is_list_line(lines[i + 1])
                        or lines[i + 1].startswith((" ", "\t"))
                    ):
                        list_lines.append(nxt)
                        i += 1
                        continue
                    break

                if _is_list_line(nxt) or nxt.startswith((" ", "\t")):
                    list_lines.append(nxt)
                    i += 1
                    continue
                break

            block = "\n".join(list_lines).strip()
            if block:
                blocks.append(block)
            continue

        current.append(line)
        i += 1

    flush()

    # Guarantee: no standalone heading block. Always attach heading to the
    # following semantic content block when available.
    if not blocks:
        return blocks

    merged_blocks: List[str] = []
    i = 0
    while i < len(blocks):
        block = blocks[i]
        non_empty = [ln.strip() for ln in block.splitlines() if ln.strip()]
        is_heading_only = bool(non_empty) and all(_is_heading_line(ln) for ln in non_empty)

        if is_heading_only and i + 1 < len(blocks):
            merged_blocks.append(f"{block}\n\n{blocks[i + 1]}".strip())
            i += 2
            continue

        merged_blocks.append(block)
        i += 1

    return merged_blocks


def _normalize_paragraph_line_breaks(text: str) -> str:
    """
    Normalize wrapped lines inside paragraph text while preserving markdown headings.

    Rules:
    - Heading lines (#, ##, ###...) are kept unchanged.
    - Paragraph lines are merged when a line does not end with sentence punctuation.
    - Blank lines preserve paragraph separation.
    """
    if not text:
        return ""

    lines = text.splitlines()
    normalized_lines: List[str] = []
    paragraph_buffer: List[str] = []

    def flush_paragraph() -> None:
        if not paragraph_buffer:
            return
        merged = _merge_wrapped_paragraph_lines(paragraph_buffer)
        if merged:
            normalized_lines.extend(merged)
        paragraph_buffer.clear()

    for raw in lines:
        line = raw.rstrip()
        stripped = line.strip()

        if not stripped:
            flush_paragraph()
            normalized_lines.append("")
            continue

        # Keep structural markdown lines unchanged.
        if _is_heading_line(stripped) or _is_list_line(stripped) or stripped.startswith("|"):
            flush_paragraph()
            normalized_lines.append(stripped if _is_heading_line(stripped) else line)
            continue

        paragraph_buffer.append(stripped)

    flush_paragraph()

    normalized = "\n".join(normalized_lines)
    return re.sub(r"\n{3,}", "\n\n", normalized).strip()


def _merge_wrapped_paragraph_lines(lines: List[str]) -> List[str]:
    if not lines:
        return []

    sentences: List[str] = []
    current = lines[0].strip()

    for raw in lines[1:]:
        nxt = raw.strip()
        if not nxt:
            continue

        if _line_ends_with_sentence_punctuation(current):
            sentences.append(current)
            current = nxt
        else:
            current = f"{current} {nxt}".strip()

    if current:
        sentences.append(current)

    return sentences


def _line_ends_with_sentence_punctuation(text: str) -> bool:
    return bool(SENTENCE_END_RE.search((text or "").rstrip()))


def _split_text_into_sentences(text: str) -> List[str]:
    """Split paragraph text into sentence-like units without dropping characters."""
    if not text or not text.strip():
        return []

    normalized = re.sub(r"\s+", " ", text.strip())
    parts: List[str] = []
    current_tokens: List[str] = []

    for token in normalized.split(" "):
        tok = token.strip()
        if not tok:
            continue
        current_tokens.append(tok)
        if _line_ends_with_sentence_punctuation(tok):
            parts.append(" ".join(current_tokens).strip())
            current_tokens = []

    if current_tokens:
        parts.append(" ".join(current_tokens).strip())

    return [p for p in parts if p]


def _calculate_overlap_word_budget(chunk_size: int, chunk_overlap: int) -> int:
    """Clamp effective overlap to a safe 10-20% range while preserving old config inputs."""
    max_words = _estimate_max_words(chunk_size)
    base_overlap_words = max(1, int(chunk_overlap / 6))
    min_words = max(1, int(max_words * MIN_OVERLAP_RATIO))
    max_words_budget = max(min_words, int(max_words * MAX_OVERLAP_RATIO))
    return min(max(base_overlap_words, min_words), max_words_budget)


def _same_heading_scope(left_md: Dict[str, object], right_md: Dict[str, object]) -> bool:
    return all(
        str(left_md.get(key) or "") == str(right_md.get(key) or "")
        for key in ("h1", "h2", "h3")
    )


def _can_merge_low_quality_scope(left_md: Dict[str, object], right_md: Dict[str, object]) -> bool:
    # Prefer exact scope match first.
    if _same_heading_scope(left_md, right_md):
        return True

    # Soft fallback: allow merge in same chapter+section to avoid tiny chunks
    # when subsection boundaries create sparse remnants.
    left_h1 = str(left_md.get("h1") or "")
    right_h1 = str(right_md.get("h1") or "")
    left_h2 = str(left_md.get("h2") or "")
    right_h2 = str(right_md.get("h2") or "")
    return bool(left_h1 and left_h1 == right_h1 and left_h2 == right_h2)


def _ends_with_incomplete_sentence(text: str) -> bool:
    stripped = (text or "").strip()
    if not stripped:
        return False

    last_line = stripped.splitlines()[-1].strip()
    if not last_line:
        return False
    if _is_heading_line(last_line):
        return False
    if _is_list_line(last_line):
        return False
    return not _line_ends_with_sentence_punctuation(last_line)


def _ends_with_incomplete_sql(text: str) -> bool:
    stripped = (text or "").strip()
    if not stripped:
        return False

    tail = stripped.splitlines()[-1].strip().lower()
    if not tail:
        return False
    if tail.endswith(";"):
        return False
    if SQL_TAIL_RE.search(tail):
        return True
    if re.search(r"[\(,]\s*$", tail):
        return True
    return False


def _should_extend_chunk_boundary(text: str) -> bool:
    return _ends_with_incomplete_sentence(text) or _ends_with_incomplete_sql(text)


def _fix_invalid_chunk_boundaries(documents: List[Document]) -> List[Document]:
    """
    Extend chunks that end in the middle of sentence/SQL by merging with next chunk in same scope.
    This wraps existing split output without changing split core logic.
    """
    if not documents:
        return []

    merged: List[Document] = []
    i = 0
    while i < len(documents):
        current = documents[i]
        current_text = current.page_content.strip()

        if i == len(documents) - 1:
            merged.append(current)
            break

        nxt = documents[i + 1]
        current_md = current.metadata if isinstance(current.metadata, dict) else {}
        next_md = nxt.metadata if isinstance(nxt.metadata, dict) else {}

        if not _should_extend_chunk_boundary(current_text) or not _same_heading_scope(current_md, next_md):
            merged.append(current)
            i += 1
            continue

        next_text = nxt.page_content.strip()
        combined_text = f"{current_text}\n\n{next_text}".strip()
        merged_md = nxt.metadata.copy()
        for key in ("h1", "h2", "h3"):
            if not merged_md.get(key) and current_md.get(key):
                merged_md[key] = current_md.get(key)

        documents[i + 1] = Document(page_content=combined_text, metadata=merged_md)
        i += 1

    return merged


def _merge_low_quality_chunks_by_chars(documents: List[Document], min_chars: int = MIN_CHUNK_CHARS) -> List[Document]:
    """
    Merge tiny chunks (low semantic value) with next chunk in the same heading scope.
    This is an additive quality filter on top of existing min-word merge logic.
    """
    if not documents:
        return []

    merged: List[Document] = []
    i = 0
    while i < len(documents):
        current = documents[i]
        current_text = current.page_content.strip()

        if len(current_text) >= min_chars:
            merged.append(current)
            i += 1
            continue

        if i == len(documents) - 1:
            if merged:
                prev = merged[-1]
                prev_md = prev.metadata if isinstance(prev.metadata, dict) else {}
                curr_md = current.metadata if isinstance(current.metadata, dict) else {}
                if _can_merge_low_quality_scope(prev_md, curr_md):
                    back_merged_text = f"{prev.page_content.strip()}\n\n{current_text}".strip()
                    back_merged_md = prev.metadata.copy()
                    for key in ("h1", "h2", "h3"):
                        if not back_merged_md.get(key) and curr_md.get(key):
                            back_merged_md[key] = curr_md.get(key)
                    merged[-1] = Document(page_content=back_merged_text, metadata=back_merged_md)
                else:
                    merged.append(current)
            else:
                merged.append(current)
            i += 1
            continue

        nxt = documents[i + 1]
        current_md = current.metadata if isinstance(current.metadata, dict) else {}
        next_md = nxt.metadata if isinstance(nxt.metadata, dict) else {}
        if not _can_merge_low_quality_scope(current_md, next_md):
            merged.append(current)
            i += 1
            continue

        merged_text = f"{current_text}\n\n{nxt.page_content.strip()}".strip()
        merged_md = nxt.metadata.copy()
        for key in ("h1", "h2", "h3"):
            if not merged_md.get(key) and current_md.get(key):
                merged_md[key] = current_md.get(key)
        documents[i + 1] = Document(page_content=merged_text, metadata=merged_md)
        i += 1

    return merged


def _split_oversized_unit(unit: str, max_words: int) -> List[str]:
    """Split oversized text by full-sentence boundaries; fallback to words only when needed."""
    if _word_count(unit) <= max_words:
        return [unit]

    sentences = _split_text_into_sentences(unit)
    if len(sentences) <= 1:
        words = re.findall(r"\S+", unit)
        if not words:
            return []
        pieces: List[str] = []
        current_words: List[str] = []
        for w in words:
            if current_words and len(current_words) + 1 > max_words:
                pieces.append(" ".join(current_words))
                current_words = [w]
                continue
            current_words.append(w)
        if current_words:
            pieces.append(" ".join(current_words))
        return pieces

    pieces: List[str] = []
    current_sentences: List[str] = []
    current_words = 0

    def flush_current() -> None:
        if current_sentences:
            pieces.append(" ".join(current_sentences).strip())

    for sentence in sentences:
        sentence_words = _word_count(sentence)
        if sentence_words > max_words:
            flush_current()
            current_sentences = []
            current_words = 0
            pieces.extend(_split_oversized_unit(sentence, max_words))
            continue

        if current_sentences and current_words + sentence_words > max_words:
            flush_current()
            current_sentences = [sentence]
            current_words = sentence_words
            continue

        current_sentences.append(sentence)
        current_words += sentence_words

    flush_current()
    return [p for p in pieces if p.strip()]


def _build_sentence_units(blocks: List[str], max_words: int) -> List[str]:
    """Build split units with sentence granularity for paragraph blocks."""
    units: List[str] = []
    for block in blocks:
        stripped = block.strip()
        if not stripped:
            continue

        non_empty_lines = [ln.strip() for ln in stripped.splitlines() if ln.strip()]
        is_list_or_heading = any(_is_list_line(ln) or _is_heading_line(ln) for ln in non_empty_lines)

        if is_list_or_heading:
            units.extend(_split_oversized_unit(stripped, max_words))
            continue

        sentences = _split_text_into_sentences(stripped)
        if not sentences:
            units.extend(_split_oversized_unit(stripped, max_words))
            continue

        for sentence in sentences:
            units.extend(_split_oversized_unit(sentence, max_words))

    return [u for u in units if u.strip()]


def _estimate_max_words(chunk_size: int) -> int:
    # Existing API uses character chunk_size. Convert to practical word budget.
    # Typical technical markdown average is ~5-6 chars per word.
    return max(MIN_CHUNK_WORDS + 20, int(chunk_size / 6))


def _merge_small_chunks(documents: List[Document], min_words: int = MIN_CHUNK_WORDS) -> List[Document]:
    if not documents:
        return []

    merged: List[Document] = []
    i = 0
    while i < len(documents):
        current = documents[i]
        current_text = current.page_content.strip()
        current_words = _word_count(current_text)

        if current_words >= min_words:
            merged.append(current)
            i += 1
            continue

        if i == len(documents) - 1:
            if merged:
                prev = merged[-1]
                prev_meta = prev.metadata if isinstance(prev.metadata, dict) else {}
                curr_meta = current.metadata if isinstance(current.metadata, dict) else {}
                if _can_merge_low_quality_scope(prev_meta, curr_meta):
                    back_merged_text = f"{prev.page_content.strip()}\n\n{current_text}".strip()
                    back_merged_meta = prev.metadata.copy()
                    for key in ("h1", "h2", "h3"):
                        if not back_merged_meta.get(key) and curr_meta.get(key):
                            back_merged_meta[key] = curr_meta.get(key)
                    merged[-1] = Document(page_content=back_merged_text, metadata=back_merged_meta)
                else:
                    merged.append(current)
            else:
                merged.append(current)
            i += 1
            continue

        nxt = documents[i + 1]
        current_meta = current.metadata if isinstance(current.metadata, dict) else {}
        next_meta = nxt.metadata if isinstance(nxt.metadata, dict) else {}

        # Do not merge across heading scope boundaries.
        # This keeps section-level semantics stable for source citation UI.
        same_scope = _can_merge_low_quality_scope(current_meta, next_meta)
        if not same_scope:
            merged.append(current)
            i += 1
            continue

        # Rule: if too short and still in the same scope, merge with the next chunk.
        next_text = nxt.page_content.strip()
        new_text = f"{current_text}\n\n{next_text}".strip()

        new_meta = nxt.metadata.copy()
        for key in ("h1", "h2", "h3"):
            if not new_meta.get(key) and current.metadata.get(key):
                new_meta[key] = current.metadata.get(key)

        documents[i + 1] = Document(page_content=new_text, metadata=new_meta)
        i += 1

    return merged


# ============================================================================
# MARKDOWN STRUCTURE PREPROCESSING
# ============================================================================

def _ensure_markdown_structure(text: str, title: Optional[str] = None, debug: bool = False) -> str:
    """
    Ensure the markdown text has proper h1 structure for MarkdownHeaderTextSplitter.
    
    MarkdownHeaderTextSplitter requires at least one h1 (#) header to work correctly.
    If the text doesn't start with a heading, prepend one based on the title parameter.
    
    Args:
        text: Markdown content
        title: Optional title to use for h1 header
        debug: Enable logging
    
    Returns:
        Markdown text with proper h1 structure guaranteed
    """
    
    # Check if text starts with a heading
    lines = text.strip().split('\n')
    
    # Check if first non-empty line is a heading
    first_non_empty_idx = None
    for i, line in enumerate(lines):
        if line.strip():
            first_non_empty_idx = i
            break
    
    if first_non_empty_idx is not None:
        first_line = lines[first_non_empty_idx].strip()
    else:
        first_line = ""
    
    # If doesn't start with h1/h2/h3, prepend an h1
    if first_line and not first_line.startswith(('#', '##', '###')):
        # Need to add an h1 header
        if title is None:
            # Try to extract title from first line
            title = first_line[:100] if first_line else "Untitled Document"
        
        # Prepend h1 header
        h1_header = f"# {title}\n\n"
        text = h1_header + text
        
        if debug:
            logger.info(f"  [+] Prepended h1 header: '# {title}'")
    
    return text


# ============================================================================
# STAGE 1: HEADER-BASED CHUNKING
# ============================================================================

def _apply_header_chunking(text: str) -> List[Document]:
    """
    Apply LangChain's MarkdownHeaderTextSplitter to chunk by headers.
    
    This stage splits the document by markdown headers (#, ##, ###), creating
    chunks that respect document hierarchy and semantic boundaries.
    
    Header Structure:
      # h1 - Chapter/Document Title (ALWAYS preserved in metadata)
      ## h2 - Section Title
      ### h3 - Subsection Title
    
    Args:
        text: Cleaned markdown text
    
    Returns:
        List of Document objects with h1, h2, h3 in metadata
    
    Example Output:
        [
            Document(
                page_content="Section content...",
                metadata={"h1": "Chapter 1", "h2": "Section 1.1", "h3": None}
            ),
            ...
        ]
    """
    
    lines = text.splitlines()
    heading_re = re.compile(r"^(#{1,6})\s+(.+?)\s*$")

    docs: List[Document] = []
    current_lines: List[str] = []
    current_h1: Optional[str] = None
    current_h2: Optional[str] = None
    current_h3: Optional[str] = None

    def flush_current() -> None:
        if not current_lines:
            return
        content = "\n".join(current_lines).strip()
        if not content:
            return
        # Never emit heading-only chunks.
        if not _has_non_heading_content(current_lines):
            return
        docs.append(
            Document(
                page_content=content,
                metadata={
                    "h1": current_h1,
                    "h2": current_h2,
                    "h3": current_h3,
                },
            )
        )

    for raw in lines:
        line = raw.rstrip("\n")
        match = heading_re.match(line.strip())

        if match and len(match.group(1)) <= 3:
            level = len(match.group(1))
            title = match.group(2).strip()

            # Heading boundary rule:
            # - Start a new chunk whenever we already collected non-heading content.
            # - This keeps sections (##/###) isolated and avoids mixing unrelated headings.
            if current_lines and _has_non_heading_content(current_lines):
                flush_current()
                current_lines = []

            if level == 1:
                current_h1 = title
                current_h2 = None
                current_h3 = None
            elif level == 2:
                current_h2 = title
                current_h3 = None
            elif level == 3:
                current_h3 = title

            current_lines.append(line.strip())
            continue

        if not current_lines and line.strip():
            # Attach loose text to the nearest hierarchy block.
            current_lines = [line]
        else:
            current_lines.append(line)

    flush_current()

    if not docs:
        return [Document(page_content=text.strip(), metadata={"h1": None, "h2": None, "h3": None})]

    return docs


# ============================================================================
# STAGE 2: RECURSIVE CHARACTER SPLITTING
# ============================================================================

def _apply_recursive_splitting(
    documents: List[Document],
    chunk_size: int = 800,
    chunk_overlap: int = 100
) -> List[Document]:
    """
    Apply RecursiveCharacterTextSplitter to control chunk size.
    
    This stage further splits chunks that exceed the size limit, using
    recursive splitting to preserve text coherence and maintain metadata.
    
    Splitting Order:
      1. Split by "\n\n" (paragraph boundaries)
      2. Split by "\n" (line boundaries)
      3. Split by " " (word boundaries)
      4. Split by "" (character level - as fallback)
    
    Args:
        documents: Document objects from Stage 1
        chunk_size: Target chunk size in characters
        chunk_overlap: Overlap between consecutive chunks
    
    Returns:
        List of Document objects with size control applied
    
    Example:
        Input chunk (1500 chars) → Output 2 chunks (750 + 750 with overlap)
    """
    
    max_words = _estimate_max_words(chunk_size)
    overlap_words = _calculate_overlap_word_budget(chunk_size=chunk_size, chunk_overlap=chunk_overlap)
    split_docs: List[Document] = []

    for doc in documents:
        text = doc.page_content.strip()
        if not text:
            continue

        # Build chunk candidates from semantic blocks only.
        blocks = _split_into_semantic_blocks(text)
        if not blocks:
            continue

        units = _build_sentence_units(blocks, max_words=max_words)
        if not units:
            continue

        current_units: List[str] = []
        current_words = 0

        def flush_units() -> None:
            if not current_units:
                return
            split_docs.append(
                Document(
                    page_content=" ".join(current_units).strip(),
                    metadata=doc.metadata.copy(),
                )
            )

        for unit in units:
            unit_words = _word_count(unit)

            if current_units and current_words + unit_words > max_words:
                carry_units: List[str] = []

                # Overlap strategy: move last full sentence(s) to next chunk.
                carry_word_count = 0
                while current_units and carry_word_count < overlap_words:
                    moved = current_units.pop()
                    moved_words = _word_count(moved)
                    if moved_words == 0:
                        continue
                    carry_units.insert(0, moved)
                    carry_word_count += moved_words

                flush_units()
                current_units = carry_units + [unit]
                current_words = sum(_word_count(x) for x in current_units)
                continue

            current_units.append(unit)
            current_words += unit_words

        flush_units()

    # Respect "too short" rule by merging undersized chunks with following content.
    return _merge_small_chunks(split_docs, min_words=MIN_CHUNK_WORDS)


# ============================================================================
# METADATA ENHANCEMENT
# ============================================================================

def _sanitize_metadata_text(value: object) -> str:
    return str(value or "").strip()


def _extract_breadcrumb_token(value: object) -> str:
    text = _sanitize_metadata_text(value)
    if not text:
        return ""

    chapter_like = re.search(
        r"(?:chuong|chương|chapter|part|phan|phần|muc|mục|section)\s*([0-9]+(?:\.[0-9]+)*)",
        text,
        flags=re.IGNORECASE,
    )
    if chapter_like:
        return chapter_like.group(1)

    leading_numeric = re.match(r"^([0-9]+(?:\.[0-9]+)*)", text)
    if leading_numeric:
        return leading_numeric.group(1)

    inline_numeric = re.search(r"\b([0-9]+(?:\.[0-9]+)+)\b", text)
    if inline_numeric:
        return inline_numeric.group(1)

    return text


def _build_breadcrumb(chapter: object, section: object, subsection: object) -> str:
    parts = [
        _extract_breadcrumb_token(chapter),
        _extract_breadcrumb_token(section),
        _extract_breadcrumb_token(subsection),
    ]

    filtered: List[str] = []
    for part in parts:
        if not part:
            continue
        if filtered and filtered[-1] == part:
            continue
        filtered.append(part)

    return " > ".join(filtered)


def _enhance_metadata(
    documents: List[Document],
    source: str,
    doc_id: Optional[str] = None,
    file_name: Optional[str] = None,
) -> List[Document]:
    """
    Enhance document metadata with chunk IDs and source information.
    
    IMPORTANT: Propagates h1 (chapter) context forward through all chunks.
    If a chunk doesn't have h1, it inherits from the most recent preceding chunk.
    This ensures every chunk knows its document-level context.
    
    For each document, this function:
    1. Extracts/propagates h1 (chapter level) through all chunks
    2. Generates a unique chunk_id based on content hash + position
    3. Adds source filename for tracking
    4. Ensures h1, h2, h3 fields exist (with None if h2/h3 missing, never for h1)
    5. Normalizes metadata for consistency
    
    Args:
        documents: Document objects from pipeline stages
        source: Original document filename
    
    Returns:
        List of Document objects with enhanced metadata and propagated h1
    """
    
    enhanced_docs = []
    current_h1 = None  # Track most recent h1 value
    resolved_doc_id = _sanitize_metadata_text(doc_id) or _sanitize_metadata_text(source) or "unknown"
    resolved_file_name = _sanitize_metadata_text(file_name) or _sanitize_metadata_text(source) or "unknown"
    
    for idx, doc in enumerate(documents):
        # Ensure all header fields exist
        metadata = doc.metadata.copy()
        
        # CRITICAL: Propagate h1 forward
        # If this chunk has h1, update current_h1
        if metadata.get('h1'):
            current_h1 = metadata['h1']
        # If missing h1, use the most recent one (never None after first h1)
        elif current_h1:
            metadata['h1'] = current_h1
        
        # Ensure h2, h3 default to None if missing (but never override)
        metadata.setdefault('h2', None)
        metadata.setdefault('h3', None)

        # Backward-compatible enriched hierarchy metadata for downstream consumers.
        metadata['chapter'] = metadata.get('chapter') or metadata.get('h1')
        metadata['section'] = metadata.get('section') or metadata.get('h2')
        metadata['subsection'] = metadata.get('subsection') or metadata.get('h3')
        heading_path_parts = [
            str(metadata.get('chapter') or '').strip(),
            str(metadata.get('section') or '').strip(),
            str(metadata.get('subsection') or '').strip(),
        ]
        heading_path = " > ".join(part for part in heading_path_parts if part)
        metadata['breadcrumb'] = _build_breadcrumb(
            metadata.get('chapter'),
            metadata.get('section'),
            metadata.get('subsection'),
        ) or heading_path
        metadata['heading_path'] = heading_path
        metadata['doc_id'] = metadata.get('doc_id') or resolved_doc_id
        metadata['file_name'] = metadata.get('file_name') or resolved_file_name
        metadata.setdefault('start_page', -1)
        metadata.setdefault('end_page', -1)
        
        # Generate unique chunk ID (based on content hash + position)
        chunk_id = _generate_chunk_id(
            source=source,
            position=idx,
            content_hash=hashlib.md5(doc.page_content.encode()).hexdigest()[:8]
        )
        metadata['chunk_id'] = chunk_id
        metadata['source'] = source
        metadata['source_file'] = metadata.get('source_file') or resolved_file_name
        metadata['filename'] = metadata.get('filename') or resolved_file_name
        
        # Keep heading context visible in chunk content for better RAG faithfulness.
        heading_prefix_lines: List[str] = []
        if metadata.get('h1'):
            heading_prefix_lines.append(f"# {metadata['h1']}")
        if metadata.get('h2'):
            heading_prefix_lines.append(f"## {metadata['h2']}")
        if metadata.get('h3'):
            heading_prefix_lines.append(f"### {metadata['h3']}")

        base_content = doc.page_content.strip()
        if heading_prefix_lines and not base_content.startswith('#'):
            base_content = "\n".join(heading_prefix_lines) + "\n\n" + base_content

        # Do not prepend plain heading_path text into chunk content because
        # downstream renderers already display breadcrumb metadata and this can
        # create duplicated heading trails in retrieved chunk previews.
        final_content = base_content

        # Create enhanced document
        enhanced_doc = Document(
            page_content=final_content,
            metadata=metadata
        )
        enhanced_docs.append(enhanced_doc)
    
    return enhanced_docs


# ============================================================================
# STATISTICS CALCULATION
# ============================================================================

def _calculate_statistics(documents: List[Document]) -> ChunkStatistics:
    """
    Calculate comprehensive statistics about the chunking process.
    
    Metrics tracked:
    - Chunk count and size distribution
    - Header metadata coverage
    - Character statistics
    
    Args:
        documents: Final list of Document objects
    
    Returns:
        ChunkStatistics object with detailed metrics
    """
    
    if not documents:
        return ChunkStatistics()
    
    chunk_sizes = [len(doc.page_content) for doc in documents]
    
    chunks_with_h1 = sum(1 for doc in documents if doc.metadata.get('h1'))
    chunks_with_h2 = sum(1 for doc in documents if doc.metadata.get('h2'))
    chunks_with_h3 = sum(1 for doc in documents if doc.metadata.get('h3'))
    
    total_chars = sum(chunk_sizes)
    
    stats = ChunkStatistics(
        total_chunks=len(documents),
        avg_chunk_size=total_chars / len(documents) if documents else 0,
        chunks_with_h1=chunks_with_h1,
        chunks_with_h2=chunks_with_h2,
        chunks_with_h3=chunks_with_h3,
        min_chunk_size=min(chunk_sizes) if chunk_sizes else 0,
        max_chunk_size=max(chunk_sizes) if chunk_sizes else 0,
        total_characters=total_chars
    )
    
    return stats


# ============================================================================
# UTILITY FUNCTIONS
# ============================================================================

def _generate_chunk_id(source: str, position: int, content_hash: str) -> str:
    """
    Generate a unique, reproducible chunk ID.
    
    Format: source__chunk_000__hash8
    Example: lecture_01__chunk_005__a3f2b1c9
    
    Args:
        source: Document filename
        position: Chunk position (0-indexed)
        content_hash: First 8 chars of content MD5 hash
    
    Returns:
        Unique chunk identifier string
    """
    # Clean source filename (remove extension)
    clean_source = source.replace('.md', '').replace('.txt', '')[:20]
    
    # Format: source__chunk_NNN__HASH8
    chunk_id = f"{clean_source}__chunk_{position:03d}__{content_hash}"
    
    return chunk_id


def print_chunk_preview(documents: List[Document], max_chunks: int = 3) -> None:
    """
    Print a preview of generated chunks for inspection.
    
    Useful for debugging and validation. Shows:
    - Metadata (h1, h2, h3)
    - First 100 characters of content
    - Chunk size
    
    Args:
        documents: List of Document objects
        max_chunks: Maximum number of chunks to display
    """
    
    print("\n" + "="*80)
    print("CHUNK PREVIEW")
    print("="*80)
    
    for i, doc in enumerate(documents[:max_chunks]):
        # Safely encode metadata for console output
        h1 = doc.metadata.get('h1', 'N/A')
        h2 = doc.metadata.get('h2', 'N/A')
        h3 = doc.metadata.get('h3', 'N/A')
        chunk_id = doc.metadata.get('chunk_id', 'N/A')
        
        # Convert non-ASCII to safe representation
        if isinstance(h1, str):
            h1 = h1.encode('ascii', 'replace').decode('ascii')
        if isinstance(h2, str):
            h2 = h2.encode('ascii', 'replace').decode('ascii')
        if isinstance(h3, str):
            h3 = h3.encode('ascii', 'replace').decode('ascii')
        
        content_preview = doc.page_content[:100].replace('\n', ' ')
        content_preview = content_preview.encode('ascii', 'replace').decode('ascii')
        
        print(f"\nChunk {i+1}:")
        print(f"  ID: {chunk_id}")
        print(f"  H1: {h1}")
        print(f"  H2: {h2}")
        print(f"  H3: {h3}")
        print(f"  Size: {len(doc.page_content)} chars")
        print(f"  Preview: {content_preview}...")
    
    if len(documents) > max_chunks:
        print(f"\n... and {len(documents) - max_chunks} more chunks")
    
    print("="*80 + "\n")


# ============================================================================
# DEMONSTRATION & TESTING
# ============================================================================

if __name__ == "__main__":
    """
    Demonstration of the chunking pipeline with realistic sample data.
    """
    
    # Configure logging for demo
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
    
    # Sample markdown from markdown_cleaner output
    sample_markdown = """# Chapter 2: Database Architecture

## Section 2.1: Three-Layer Architecture

The three-layer architecture of a DBMS consists of three independent layers:

| Layer | Function |
|-------|----------|
| External | Provides user interface |
| Conceptual | Describes logical data structure |
| Internal | Describes physical storage |

### Subsection: External Layer Details
The external layer is the user-facing interface that defines how applications interact with the database.

### Subsection: Conceptual Layer Details
The conceptual layer describes the overall logical structure of all the data in the database.

## Section 2.2: Data Independence

Data independence is the ability to modify the schema of a lower level without affecting the schema of a higher level.

- Physical data independence: Ability to change internal storage without modifying conceptual schema
- Logical data independence: Ability to change conceptual schema without modifying external schema

### Subsection: Benefits of Data Independence
Data independence provides flexibility and reduces maintenance costs.

### Subsection: Implementation Challenges
Implementing proper data independence requires careful schema design.

## Section 2.3: Normalization

Database normalization is a systematic approach to organizing data that minimizes redundancy.

Normal forms provide standards for data organization:

1. First Normal Form (1NF)
2. Second Normal Form (2NF)
3. Third Normal Form (3NF)
4. Boyce-Codd Normal Form (BCNF)

### Subsection: Benefits of Normalization
Normalization improves data integrity and query performance.

End of chapter.
"""
    
    # ===== TEST 1: Basic Chunking =====
    print("\n[TEST 1] Basic Chunking (Default Settings)")
    print("-" * 80)
    documents, stats = chunk_markdown(
        sample_markdown,
        source="database_lecture.md",
        debug=True
    )
    
    print(f"\n[OK] Statistics:")
    print(f"   Total chunks: {stats.total_chunks}")
    print(f"   Average size: {stats.avg_chunk_size:.0f} chars")
    print(f"   Size range: {stats.min_chunk_size}-{stats.max_chunk_size} chars")
    print(f"   H1 coverage: {stats.chunks_with_h1}/{stats.total_chunks}")
    print(f"   H2 coverage: {stats.chunks_with_h2}/{stats.total_chunks}")
    print(f"   H3 coverage: {stats.chunks_with_h3}/{stats.total_chunks}")
    
    print_chunk_preview(documents, max_chunks=5)
    
    # ===== TEST 2: Smaller Chunk Size =====
    print("\n[TEST 2] Smaller Chunk Size (500 chars)")
    print("-" * 80)
    documents_small, stats_small = chunk_markdown(
        sample_markdown,
        source="database_lecture.md",
        chunk_size=500,
        chunk_overlap=50,
        debug=False
    )
    
    print(f"\n[OK] Generated {stats_small.total_chunks} chunks (vs {stats.total_chunks} before)")
    print(f"   Average size: {stats_small.avg_chunk_size:.0f} chars")
    print(f"   Size range: {stats_small.min_chunk_size}-{stats_small.max_chunk_size} chars")
    
    # ===== TEST 3: Metadata Validation =====
    print("\n[TEST 3] Metadata Validation")
    print("-" * 80)
    
    for i, doc in enumerate(documents[:3]):
        metadata = doc.metadata
        h1_valid = metadata.get('h1') is not None
        chunk_id_valid = 'chunk_id' in metadata
        source_valid = metadata.get('source') == 'database_lecture.md'
        
        status = "[OK]" if (h1_valid and chunk_id_valid and source_valid) else "[ERROR]"
        print(f"\n   Chunk {i+1}: {status}")
        print(f"     H1 valid: {h1_valid}")
        print(f"     Chunk ID valid: {chunk_id_valid}")
        print(f"     Source valid: {source_valid}")
    
    print("\n" + "="*80)
    print("[OK] CHUNKING TESTS COMPLETE")
    print("="*80 + "\n")
