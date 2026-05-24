from __future__ import annotations

import json
import logging
import os
import re
from typing import Any, Dict, List, Optional, TYPE_CHECKING

from .embedding_ops import embed_document, local_embedding, normalize_embedding_batch
from ..chunking import chunk_markdown

if TYPE_CHECKING:
    from ..rag_pipeline import RAGPipeline

logger = logging.getLogger(__name__)

_DIMENSION_MISMATCH_RE = re.compile(
    r"Collection expecting embedding with dimension of\s+(\d+),\s*got\s+(\d+)",
    re.IGNORECASE,
)

_REFINEMENT_MODEL = "gemini-1.5-flash"
_REFINEMENT_TEMPERATURE = 0.2
_REFINEMENT_TOP_P = 0.8
_MAX_REFINED_CHUNKS_PER_DOC = max(0, int(os.getenv("RAG_CHUNK_REFINEMENT_MAX_PER_DOC", "8")))

_NOISY_CHUNK_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"\x0c|\t"),
    re.compile(r"(?m)^\s*[-=]{3,}\s*$"),
    re.compile(r"\]\s*\$|\[\s*\$|\[\s*\*\s*\|"),
    re.compile(r"[$|]{2,}"),
)

_CHUNK_REFINEMENT_PROMPT_TEMPLATE = """You are a data refinement assistant in a Retrieval-Augmented Generation (RAG) system.

Your task is to clean, normalize, and improve the readability of a raw text chunk extracted from documents (PDF, DOCX, etc.).

GOAL:
Transform the input into a CLEAN, COHERENT, and STRUCTURED version while STRICTLY preserving the original meaning.

STRICT RULES:
1. NO HALLUCINATION:
- DO NOT add any new knowledge
- DO NOT invent examples or explanations
- ONLY use information from the input

2. PRESERVE MEANING:
- Keep all important information
- DO NOT remove key ideas
- DO NOT simplify to the point of losing meaning

3. LANGUAGE:
- Output MUST be in the SAME language as input

WHAT YOU MUST FIX:
1. Broken text: fix cut/incomplete sentences, merge wrongly split lines.
2. Formatting issues: remove duplicated spaces and strange symbols, normalize punctuation.
3. Structure: preserve headings and hierarchy if present.
4. Code/technical content: keep SQL/code readable without changing logic.
5. Noise removal: remove meaningless/corrupted duplicate fragments.

WHAT YOU MUST NOT DO:
- DO NOT summarize
- DO NOT explain
- DO NOT translate
- DO NOT expand content
- DO NOT restructure into a new format

OUTPUT FORMAT:
Return ONLY the cleaned content.

Refine the following chunk:

<CHUNK_TEXT_HERE>
{chunk_text}
"""

_H1_RE = re.compile(r"(?m)^\s*#\s+(.+?)\s*$")
_H2_RE = re.compile(r"(?m)^\s*##\s+(.+?)\s*$")
_H3_RE = re.compile(r"(?m)^\s*###\s+(.+?)\s*$")
_BREADCRUMB_RE = re.compile(r"(?m)^\s*([^>\n]+)\s*>\s*([^>\n]+)(?:\s*>\s*([^>\n]+))?\s*$")
_CHAPTER_LINE_RE = re.compile(r"(?im)^\s*((?:chương|chuong|chapter)\s+\d+[^\n]*)$")
_SECTION_LINE_RE = re.compile(r"(?m)^\s*(\d+\.\d+(?:\.\d+)?)\s*[:\-.)]?\s*(.+)$")
_SUBSECTION_LINE_RE = re.compile(r"(?m)^\s*(\d+\.\d+\.\d+(?:\.\d+)?)\s*[:\-.)]?\s*(.+)$")
_HEADING_SQL_NOISE_RE = re.compile(
    r"\b(SELECT|FROM|WHERE|DISTINCT|JOIN|INSERT|UPDATE|DELETE|GROUP\s+BY|ORDER\s+BY)\b",
    re.IGNORECASE,
)


def _token_set(text: str) -> set[str]:
    normalized = re.sub(r"\s+", " ", (text or "").lower()).strip()
    return {t for t in re.findall(r"[a-z0-9_\-]+", normalized) if len(t) >= 3}


def _parse_bool_env(name: str, default: bool = True) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    normalized = raw.strip().lower()
    if normalized in {"1", "true", "yes", "y", "on"}:
        return True
    if normalized in {"0", "false", "no", "n", "off"}:
        return False
    return default


def _is_chunk_refinement_enabled() -> bool:
    # Fast kill-switch for chunk refinement without code changes.
    return _parse_bool_env("RAG_CHUNK_REFINEMENT_ENABLED", default=True)


def _contains_vietnamese_chars(text: str) -> bool:
    return bool(re.search(r"[ăâđêôơưáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]", text or "", flags=re.IGNORECASE))


def _looks_noisy_chunk(text: str) -> bool:
    chunk = text or ""
    if len(chunk.strip()) < 40:
        return False

    for pattern in _NOISY_CHUNK_PATTERNS:
        if pattern.search(chunk):
            return True

    lines = [ln.strip() for ln in chunk.splitlines() if ln.strip()]
    if not lines:
        return False

    # Heuristic: likely broken chunk tail if ending without punctuation.
    tail = lines[-1]
    if len(tail) >= 40 and not re.search(r"[.!?;:]$", tail):
        return True

    return False


def _build_chunk_refinement_prompt(chunk_text: str) -> str:
    return _CHUNK_REFINEMENT_PROMPT_TEMPLATE.format(chunk_text=(chunk_text or "").strip())


def _strip_refinement_wrappers(text: str) -> str:
    cleaned = (text or "").strip()
    cleaned = re.sub(r"^```[a-zA-Z0-9_\-]*\s*", "", cleaned)
    cleaned = re.sub(r"\s*```$", "", cleaned)
    return cleaned.strip()


def _is_refinement_safe(original: str, refined: str) -> bool:
    before = (original or "").strip()
    after = (refined or "").strip()
    if not before or not after:
        return False

    if len(after) < max(80, int(len(before) * 0.45)):
        return False

    before_tokens = _token_set(before)
    after_tokens = _token_set(after)
    if before_tokens:
        overlap_ratio = len(before_tokens & after_tokens) / max(1, len(before_tokens))
        if overlap_ratio < 0.35:
            return False

    if _contains_vietnamese_chars(before) and not _contains_vietnamese_chars(after):
        return False

    return True


def _refine_noisy_chunk_with_gemini(pipeline: "RAGPipeline", chunk_text: str) -> str:
    if not (pipeline.gemini_api_key and (chunk_text or "").strip()):
        return chunk_text

    prompt = _build_chunk_refinement_prompt(chunk_text)
    try:
        from google import genai
        from google.genai import types
        client = genai.Client(api_key=pipeline.gemini_api_key)
        response = client.models.generate_content(
            model=_REFINEMENT_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                temperature=_REFINEMENT_TEMPERATURE,
                top_p=_REFINEMENT_TOP_P,
            ),
        )
        refined = _strip_refinement_wrappers(getattr(response, "text", "") or "")
        if not refined:
            return chunk_text
        if not _is_refinement_safe(chunk_text, refined):
            return chunk_text
        return refined
    except Exception as exc:
        logger.warning("Chunk refinement skipped due to Gemini error: %s", exc)
        return chunk_text


def _maybe_refine_chunk_text(
    pipeline: "RAGPipeline",
    source: str,
    chunk_text: str,
    refined_count: int,
) -> tuple[str, bool]:
    if not _is_chunk_refinement_enabled():
        return chunk_text, False

    source_name = (source or "").lower()
    if not source_name.endswith(".pdf"):
        return chunk_text, False
    if refined_count >= _MAX_REFINED_CHUNKS_PER_DOC:
        return chunk_text, False
    if not _looks_noisy_chunk(chunk_text):
        return chunk_text, False

    refined = _refine_noisy_chunk_with_gemini(pipeline, chunk_text)
    return refined, refined != chunk_text


def extract_title(markdown: str) -> str:
    for line in markdown.splitlines():
        line = line.strip()
        if line.startswith("# "):
            return line[2:].strip()
    return "Untitled"


def extract_page_number(text: str) -> Optional[int]:
    patterns = [
        r"\bTrang\s+(\d+)(?:/\d+)?\b",
        r"\bPage\s+(\d+)(?:/\d+)?\b",
        r"^##\s*Page\s+(\d+)\b",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE | re.MULTILINE)
        if match:
            try:
                return int(match.group(1))
            except Exception:
                return None
    return None


def _sanitize_metadata_heading(value: object) -> Optional[str]:
    text = re.sub(r"\s+", " ", str(value or "").strip())
    if not text:
        return None

    text = re.sub(r"^[+\-*•]+\s*", "", text).strip()
    text = text.splitlines()[0].strip()
    if not text:
        return None

    # Trim obvious SQL/body spill when heading metadata is polluted.
    noise_match = _HEADING_SQL_NOISE_RE.search(text)
    if noise_match and noise_match.start() > 0:
        text = text[: noise_match.start()].rstrip(" -,:;")

    if not text:
        return None
    if len(text) > 120:
        return None
    return text


def _coerce_positive_page(value: Any) -> Optional[int]:
    if isinstance(value, int):
        return value if value > 0 else None
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    match = re.search(r"\d+", text)
    if not match:
        return None
    page = int(match.group(0))
    return page if page > 0 else None


def _extract_heading_candidates(text: str) -> tuple[Optional[str], Optional[str], Optional[str]]:
    if not text:
        return None, None, None

    chapter = None
    section = None
    subsection = None

    h1_match = _H1_RE.search(text)
    h2_match = _H2_RE.search(text)
    h3_match = _H3_RE.search(text)
    if h1_match:
        chapter = _sanitize_metadata_heading(h1_match.group(1))
    if h2_match:
        section = _sanitize_metadata_heading(h2_match.group(1))
    if h3_match:
        subsection = _sanitize_metadata_heading(h3_match.group(1))

    breadcrumb_match = _BREADCRUMB_RE.search(text)
    if breadcrumb_match:
        chapter = chapter or _sanitize_metadata_heading(breadcrumb_match.group(1))
        section = section or _sanitize_metadata_heading(breadcrumb_match.group(2))
        subsection = subsection or _sanitize_metadata_heading(breadcrumb_match.group(3))

    chapter_match = _CHAPTER_LINE_RE.search(text)
    if chapter_match:
        chapter = chapter or _sanitize_metadata_heading(chapter_match.group(1))

    subsection_match = _SUBSECTION_LINE_RE.search(text)
    if subsection_match:
        subsection = subsection or _sanitize_metadata_heading(
            f"{subsection_match.group(1)}. {subsection_match.group(2)}"
        )

    section_match = _SECTION_LINE_RE.search(text)
    if section_match:
        section = section or _sanitize_metadata_heading(
            f"{section_match.group(1)}. {section_match.group(2)}"
        )

    return chapter, section, subsection


def _infer_structure_metadata(
    chunk_text: str,
    context_text: str,
    fallback_chapter: object,
    fallback_section: object,
    fallback_subsection: object,
) -> tuple[Optional[str], Optional[str], Optional[str]]:
    chapter = _sanitize_metadata_heading(fallback_chapter)
    section = _sanitize_metadata_heading(fallback_section)
    subsection = _sanitize_metadata_heading(fallback_subsection)

    chunk_chapter, chunk_section, chunk_subsection = _extract_heading_candidates(chunk_text)
    chapter = chunk_chapter or chapter
    section = chunk_section or section
    subsection = chunk_subsection or subsection

    if not (chapter and section and subsection):
        ctx_chapter, ctx_section, ctx_subsection = _extract_heading_candidates(context_text)
        chapter = chapter or ctx_chapter
        section = section or ctx_section
        subsection = subsection or ctx_subsection

    return chapter, section, subsection


def clean_metadata(metadata: Dict[str, object]) -> Dict[str, object]:
    result: Dict[str, object] = {}
    for key, value in metadata.items():
        if isinstance(value, (str, int, float, bool)):
            result[key] = value
        elif value is None:
            result[key] = ""
        else:
            result[key] = str(value)
    return result


def index_markdown(
    pipeline: "RAGPipeline",
    markdown: str,
    source: str,
    collection_name: Optional[str] = None,
    chunk_size: int = 1200,
    chunk_overlap: int = 120,
    total_pages: int = 0,
    doc_id: Optional[str] = None,
    file_name: Optional[str] = None,
) -> Dict[str, object]:
    title = extract_title(markdown)
    docs, stats = chunk_markdown(
        text=markdown,
        source=source,
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        debug=False,
        title=title,
        doc_id=doc_id,
        file_name=file_name,
    )

    collection = pipeline._collection(collection_name)

    # Keep collection clean when re-indexing the same source file.
    try:
        collection.delete(where={"source": source})
    except Exception:
        pass

    ids: List[str] = []
    texts: List[str] = []
    metadatas: List[Dict[str, object]] = []
    embeddings: List[List[float]] = []
    refined_chunks = 0
    resolved_doc_id = str(doc_id or source or "").strip() or "unknown"
    resolved_file_name = str(file_name or source or "").strip() or "unknown"

    total_docs = max(1, len(docs))

    for idx, doc in enumerate(docs):
        chunk_text, is_refined = _maybe_refine_chunk_text(
            pipeline=pipeline,
            source=source,
            chunk_text=doc.page_content,
            refined_count=refined_chunks,
        )
        if is_refined:
            refined_chunks += 1

        chunk_id = str(doc.metadata.get("chunk_id"))
        page_number = extract_page_number(chunk_text)
        if page_number is None:
            page_number = _coerce_positive_page(doc.metadata.get("start_page"))
        if page_number is None:
            page_number = _coerce_positive_page(doc.metadata.get("page_number", doc.metadata.get("page")))
        if page_number is None and total_pages > 0:
            page_number = min(total_pages, int((idx * total_pages) / total_docs) + 1)
        normalized_page = int(page_number) if isinstance(page_number, int) and page_number > 0 else -1

        inferred_chapter, inferred_section, inferred_subsection = _infer_structure_metadata(
            chunk_text=chunk_text,
            context_text=str(doc.metadata.get("heading_path") or doc.metadata.get("breadcrumb") or ""),
            fallback_chapter=doc.metadata.get("chapter") or doc.metadata.get("h1"),
            fallback_section=doc.metadata.get("section") or doc.metadata.get("h2"),
            fallback_subsection=doc.metadata.get("subsection") or doc.metadata.get("h3"),
        )

        canonical_chunk_metadata = {
            "file_name": str(doc.metadata.get("file_name") or resolved_file_name),
            "chapter": inferred_chapter,
            "section": inferred_section,
            "subsection": inferred_subsection,
            "start_page": normalized_page,
            "end_page": normalized_page,
        }

        metadata = {
            **doc.metadata,
            "title": title,
            "doc_id": str(doc.metadata.get("doc_id") or resolved_doc_id),
            "file_name": canonical_chunk_metadata["file_name"],
            "chapter": canonical_chunk_metadata["chapter"],
            "section": canonical_chunk_metadata["section"],
            "subsection": canonical_chunk_metadata["subsection"],
            "breadcrumb": doc.metadata.get("breadcrumb") or doc.metadata.get("heading_path") or "",
            "page_number": normalized_page,
            "page": normalized_page,
            "start_page": normalized_page,
            "end_page": normalized_page,
            "source": source,
            "source_file": str(doc.metadata.get("source_file") or resolved_file_name),
            "filename": str(doc.metadata.get("filename") or resolved_file_name),
            "chunk_refined": bool(is_refined),
            # Canonical JSON payload aligned with downstream chunk metadata contract.
            "chunk_metadata_json": json.dumps(canonical_chunk_metadata, ensure_ascii=False),
        }
        metadata = clean_metadata(metadata)

        ids.append(chunk_id)
        texts.append(chunk_text)
        metadatas.append(metadata)
        embeddings.append(embed_document(pipeline, chunk_text))

    embeddings, batch_dims = normalize_embedding_batch(texts, embeddings)

    if ids:
        try:
            collection.upsert(
                ids=ids,
                documents=texts,
                metadatas=metadatas,
                embeddings=embeddings,
            )
        except Exception as exc:
            msg = str(exc)
            match = _DIMENSION_MISMATCH_RE.search(msg)
            if not match:
                raise

            expected_dims = int(match.group(1))
            got_dims = int(match.group(2))
            logger.warning(
                "Collection '%s' expects dims=%s but batch dims=%s (dominant=%s). "
                "Retrying upsert with local embeddings sized to expected dimension.",
                collection.name,
                expected_dims,
                got_dims,
                batch_dims,
            )

            fallback_embeddings = [local_embedding(text, dims=expected_dims) for text in texts]
            collection.upsert(
                ids=ids,
                documents=texts,
                metadatas=metadatas,
                embeddings=fallback_embeddings,
            )

    return {
        "chunks_indexed": len(ids),
        "collection": collection.name,
        "statistics": {
            "total_chunks": stats.total_chunks,
            "chunks_refined": refined_chunks,
            "avg_chunk_size": stats.avg_chunk_size,
            "total_characters": stats.total_characters,
            "chunks_with_h1": stats.chunks_with_h1,
            "chunks_with_h2": stats.chunks_with_h2,
            "chunks_with_h3": stats.chunks_with_h3,
        },
    }
