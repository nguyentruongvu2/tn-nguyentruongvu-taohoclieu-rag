"""
Markdown Cleaning and Normalization Module for RAG Pipeline

OVERVIEW:
This production-ready module prepares raw Markdown extracted from PDF/DOCX 
documents for downstream RAG processing. It removes noise while preserving 
semantic content, structures headings properly, and extracts metadata.

DESIGN PRINCIPLES:
1. Preserve important semantic content (never remove meaningful sections)
2. Remove only repetitive noise (headers, footers that appear on every page)
3. Normalize structure (fix heading hierarchy, spacing)
4. Extract metadata for better retrieval (titles, chapters, page count)
5. Keep output RAG-friendly (clean structure for header-based chunking)

PIPELINE:
1. Extract initial metadata and page information
2. Detect repeated headers/footers across pages
3. Remove noise patterns (dividers, page markers, duplicates)
4. Normalize heading hierarchy
5. Clean whitespace while preserving structure
6. Extract structured content blocks

INPUT: Raw Markdown from PDF/DOCX with noise patterns
OUTPUT: Clean Markdown + Metadata suitable for embedding + retrieval

KEY FEATURES:
- Handles page-marker format (## Page X)
- Handles divider-based format (──────)
- Normalizes headers with embedded page numbers
- Preserves list structure and formatting
- Maintains tables intact
- Extracts document title and chapters
- Returns confidence scores for detected patterns
"""

import re
from typing import Dict, List, Tuple, Optional
from dataclasses import dataclass, field
import logging

# Configure logger
logger = logging.getLogger(__name__)
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter('%(levelname)s:%(name)s:%(message)s'))
    logger.addHandler(handler)


@dataclass
class ContentBlock:
    """
    Represents a logical content unit extracted from markdown.
    
    Used for downstream processing (chunking, embedding, retrieval).
    Each block has type-specific handling (paragraphs, lists, tables, headings).
    """
    content: str  # Actual text content
    page_number: Optional[int] = None  # Which page (if detected)
    section_title: Optional[str] = None  # Parent section
    heading_level: int = 0  # Markdown heading level (1-6)
    block_type: str = "text"  # Type: "text", "heading", "list", "table", "code"
    confidence: float = 1.0  # Confidence that this is meaningful (0-1)
    
    def __repr__(self) -> str:
        type_label = f"[{self.block_type.upper()}]"
        if self.heading_level > 0:
            type_label = f"{'#' * self.heading_level}"
        content_preview = self.content[:60].replace('\n', ' ')
        return f"{type_label} {content_preview}..."


@dataclass
class DocumentMetadata:
    """
    Structured metadata extracted from document.
    
    Used for:
    - Document retrieval and identification
    - Search queries
    - Filtering results
    - Organizing content structure
    """
    title: Optional[str] = None  # Main document title
    chapters: List[str] = field(default_factory=list)  # Chapter headings (H1/H2)
    sections: Dict[str, List[str]] = field(default_factory=dict)  # Section hierarchy
    page_count: int = 0  # Number of pages detected
    language: str = "en"  # Detected language
    repeated_headers: List[str] = field(default_factory=list)  # Headers found 60%+ pages
    repeated_footers: List[str] = field(default_factory=list)  # Footers found 60%+ pages
    total_lines_removed: int = 0  # Noise lines removed
    total_lines_kept: int = 0  # Content lines kept
    
    @property
    def cleaning_ratio(self) -> float:
        """Percentage of content that was noise."""
        total = self.total_lines_removed + self.total_lines_kept
        return (self.total_lines_removed / total * 100) if total > 0 else 0


class PatternLibrary:
    """
    Central repository for regex patterns used in cleaning.
    
    Keeps patterns organized and prevents duplication.
    Makes it easy to tune cleaning behavior.
    """
    
    def __init__(self):
        """Initialize all regex patterns."""
        # PAGE DETECTION
        # Matches: "## Page 1", "Page 2:", "pg. 5", "p. 10"
        self.page_marker = re.compile(
            r'^#+\s*(?:page|trang|pg\s*#?|p\.)\s*\d+(?:\s*/\s*\d+)?\s*(?:[:,.]?)\s*$',
            re.IGNORECASE | re.MULTILINE
        )
        
        # PAGE NUMBERS embedded in text
        # Matches: "Page 42 at end of line"
        self.page_number_inline = re.compile(
            r'\s+(?:page|pg|p\.)\s*[\d\-–—]+\s*$',
            re.IGNORECASE
        )
        
        # HEADING LEVELS (Markdown #, ##, etc.)
        self.heading = re.compile(r'^#{1,6}\s+',)
        
        # DIVIDERS - All variations
        # ASCII: ---, ___, ***, ===
        # Unicode: ────, ═════, etc.
        self.divider = re.compile(
            r'^([-*_=])\1{2,}$|^[–—─═▬▭▮▯]{3,}$|^[━┄┅┆┇┈┉┊┋]{3,}$',
            re.MULTILINE
        )
        
        # LIST ITEMS
        # Matches: - item, * item, 1. item, etc.
        self.list_item = re.compile(r'^[\s]*[-*+]\s+|^[\s]*\d+\.\s+')
        
        # METADATA PATTERNS (author, date, copyright, etc.)
        # These are safe to remove as they're rarely important for RAG
        self.metadata = re.compile(
            r'^(?:Author|Written by|By|Date|Created|Version|Department|©|®|™)',
            re.IGNORECASE
        )
        
        # WHITESPACE cleanup
        self.multiple_spaces = re.compile(r'  +')  # Multiple spaces
        self.trailing_space = re.compile(r'\s+$')  # Trailing space
        
        # BROKEN LINES (common in PDF extraction)
        # Detects if a line looks split (ends abruptly, next starts with lowercase)
        self.line_break_fragment = re.compile(r'^[a-z]')





class MarkdownCleaner:
    """
    Production-grade Markdown cleaner for PDF/DOCX-extracted text.
    
    DESIGN:
    - Non-destructive: Preserves all meaningful content
    - Heuristic-based: Uses pattern matching and frequency analysis
    - Configurable: Adjust aggressiveness via parameters
    - Auditable: Logs all removed content for verification
    
    ALGORITHM:
    1. DETECT STRUCTURE: Identify pages, sections, repeated patterns
    2. CLASSIFY CONTENT: Headers, footers, noise, content
    3. REMOVE NOISE: Based on frequency thresholds (default 60%)
    4. NORMALIZE: Fix heading levels, spacing, formatting
    5. EXTRACT BLOCKS: Prepare for downstream chunking
    
    CONFIGURATION:
    - aggressive_cleaning: Bold removal of metadata (default: False)
    - header_frequency_threshold: How often must pattern repeat (default: 0.6 = 60%)
    - min_meaningful_length: Shortest meaningful line (default: 5 chars)
    """
    
    def __init__(
        self, 
        aggressive_cleaning: bool = False,
        header_frequency_threshold: float = 0.6,
        min_meaningful_length: int = 5,
        debug_mode: bool = False
    ):
        """
        Initialize the cleaner with configuration.
        
        Args:
            aggressive_cleaning: Remove more patterns (metadata, short lines)
            header_frequency_threshold: Pattern must appear on N% of pages to remove
                                      Higher = keep more (safer)
                                      Lower = remove more (riskier)
            min_meaningful_length: Don't remove lines shorter than this
            debug_mode: Log extra debugging information
        """
        self.aggressive_cleaning = aggressive_cleaning
        self.header_frequency_threshold = header_frequency_threshold
        self.min_meaningful_length = min_meaningful_length
        self.debug_mode = debug_mode
        
        # Compile patterns once (optimization)
        self.patterns = PatternLibrary()
        
        # Cache for repeated pattern detection
        self._pattern_cache = {}
        
        # Statistics tracking
        self.stats = {
            'lines_processed': 0,
            'lines_removed': 0,
            'headers_detected': 0,
            'footers_detected': 0,
            'pages_detected': 0,
        }
        
        if debug_mode:
            logger.setLevel(logging.DEBUG)
        else:
            logger.setLevel(logging.INFO)

        
    def clean_markdown(self, markdown_text: str) -> Tuple[str, DocumentMetadata]:
        """
        Main cleaning pipeline that processes raw markdown and returns cleaned output.
        
        PIPELINE STAGES:
        1. Extract initial metadata (title, pages, chapters)
        2. Identify repeated headers/footers across pages
        3. Remove noise patterns (dividers, page markers, duplicates)
        4. Normalize heading hierarchy
        5. Clean whitespace
        6. Extract structured blocks
        
        Args:
            markdown_text: Raw markdown text from PDF/DOCX conversion
            
        Returns:
            Tuple of (cleaned_markdown, metadata) with statistics
            
        Example:
            cleaned_md, metadata = cleaner.clean_markdown(pdf_extracted_text)
            print(f"Removed {metadata.total_lines_removed} noise lines")
            print(f"Pages: {metadata.page_count}, Title: {metadata.title}")
        """
        logger.info("="*70)
        logger.info("STARTING MARKDOWN CLEANING PIPELINE")
        logger.info("="*70)
        
        if not markdown_text or not markdown_text.strip():
            logger.warning("Empty markdown text provided")
            return "", DocumentMetadata()
        
        # Track original state
        original_lines = markdown_text.split('\n')
        original_line_count = len(original_lines)
        self.stats['lines_processed'] = original_line_count
        
        logger.debug(f"Input: {original_line_count} lines, {len(markdown_text)} chars")
        
        # ===== STAGE 1: EXTRACT METADATA =====
        logger.info("[STAGE 1/6] Extracting initial metadata...")
        metadata = self._extract_initial_metadata(markdown_text)
        logger.info(f"  [+] Title: {metadata.title}")
        logger.info(f"  [+] Pages detected: {metadata.page_count}")
        logger.info(f"  [+] Chapters: {len(metadata.chapters)}")
        
        # ===== STAGE 2: IDENTIFY REPEATED PATTERNS =====
        logger.info("[STAGE 2/6] Identifying repeated headers/footers...")
        lines = original_lines.copy()
        repeated_headers, repeated_footers = self._identify_repeated_patterns(lines)
        metadata.repeated_headers = repeated_headers
        metadata.repeated_footers = repeated_footers
        self.stats['headers_detected'] = len(repeated_headers)
        self.stats['footers_detected'] = len(repeated_footers)
        logger.info(f"  [+] Found {len(repeated_headers)} repeated headers:")
        for h in repeated_headers[:3]:  # Show first 3
            logger.debug(f"    - '{h[:50]}'")
        if len(repeated_headers) > 3:
            logger.debug(f"    ... and {len(repeated_headers)-3} more")
        
        # ===== STAGE 3: REMOVE NOISE =====
        logger.info("[STAGE 3/6] Removing noise patterns...")
        cleaned_lines = self._remove_noise_patterns(lines, repeated_headers, repeated_footers)
        removed_in_this_stage = len(lines) - len(cleaned_lines)
        self.stats['lines_removed'] += removed_in_this_stage
        logger.info(f"  [+] Removed {removed_in_this_stage} lines")
        
        # ===== STAGE 4: NORMALIZE STRUCTURE =====
        logger.info("[STAGE 4/6] Normalizing heading structure...")
        cleaned_lines = self._normalize_heading_structure(cleaned_lines, metadata)
        logger.info(f"  [+] Normalized heading hierarchy")
        
        # ===== STAGE 5: CLEAN WHITESPACE =====
        logger.info("[STAGE 5/6] Cleaning whitespace...")
        cleaned_lines = self._clean_whitespace(cleaned_lines)
        logger.info(f"  [+] Consolidated whitespace")
        
        # ===== STAGE 6: JOIN AND EXTRACT BLOCKS =====
        logger.info("[STAGE 6/6] Finalizing...")
        cleaned_markdown = '\n'.join(cleaned_lines)
        
        # Update statistics
        final_line_count = len(cleaned_lines)
        metadata.total_lines_removed = self.stats['lines_removed']
        metadata.total_lines_kept = final_line_count
        
        logger.info("="*70)
        logger.info("CLEANING COMPLETE")
        logger.info("="*70)
        logger.info(f"Result: {original_line_count} → {final_line_count} lines "
                   f"({metadata.cleaning_ratio:.1f}% removal)")
        logger.info(f"Removed: {self.stats['lines_removed']} lines")
        logger.info(f"Kept: {metadata.total_lines_kept} lines")
        logger.info(f"Size: {len(markdown_text)} → {len(cleaned_markdown)} chars "
                   f"({100*len(cleaned_markdown)/len(markdown_text):.1f}%)")
        logger.info("="*70)
        
        if self.debug_mode:
            self.print_statistics(markdown_text, cleaned_markdown)
        
        return cleaned_markdown, metadata
    
    def clean_markdown_advanced(self, markdown_text: str) -> Tuple[str, DocumentMetadata]:
        """
        Advanced markdown cleaner using positional heuristics and frequency analysis.
        
        Specialized for detecting and removing headers, footers, and layout artifacts.
        
        ALGORITHM:
        1. Split into pages (using page markers or dividers)
        2. Apply positional heuristics (top/bottom 10-15% of each page)
        3. Use frequency-based detection (patterns appearing >50% of pages)
        4. Apply structural pattern filtering (horizontal lines, very short lines)
        5. Preserve meaningful titles (Chương, Chapter, numbered sections)
        6. Remove noise (page numbers, repeated titles, author info)
        
        Args:
            markdown_text: Raw markdown from PDF/DOCX extraction
            
        Returns:
            Tuple of (cleaned_markdown, metadata) with detailed statistics
            
        Example:
            cleaned, meta = cleaner.clean_markdown_advanced(pdf_text)
            print(f"Removed {meta.total_lines_removed} header/footer lines")
        """
        logger.info("="*80)
        logger.info("STARTING ADVANCED MARKDOWN CLEANING (Headers/Footers Focus)")
        logger.info("="*80)
        
        if not markdown_text or not markdown_text.strip():
            logger.warning("Empty markdown text provided")
            return "", DocumentMetadata()
        
        original_lines = markdown_text.split('\n')
        original_count = len(original_lines)
        logger.info(f"Input: {original_count} lines, {len(markdown_text)} chars")
        
        # STAGE 1: Split into pages
        logger.info("[STAGE 1] Splitting into pages...")
        pages = self._split_pages_advanced(original_lines)
        logger.info(f"  [+] Detected {len(pages)} pages")

        # STAGE 1.5: If divider lines exist per page, keep only content between
        # the first and last divider in that page (header/footer stripping).
        pages, divider_trimmed_pages = self._extract_content_between_dividers_per_page(pages)
        if divider_trimmed_pages > 0:
            logger.info(
                f"  [+] Divider-based trim applied on {divider_trimmed_pages}/{len(pages)} pages"
            )
            original_lines = [ln for page in pages for ln in page]
            original_count = len(original_lines)

        # Safety guard: with a single detected page, skip frequency-based
        # header/footer removal to avoid deleting valid content.
        if len(pages) < 2:
            logger.info("  [!] Single page detected - using conservative cleanup only")
            cleaned_lines = []
            for line in original_lines:
                if self._is_page_marker(line) or self._is_divider(line):
                    continue
                cleaned_lines.append(line)

            cleaned_lines = self._clean_whitespace(cleaned_lines)
            cleaned_markdown = '\n'.join(cleaned_lines)

            metadata = DocumentMetadata()
            metadata.title = self._extract_document_title(original_lines)
            metadata.page_count = len(pages)
            metadata.chapters = self._extract_chapters(original_lines)
            metadata.repeated_headers = []
            metadata.repeated_footers = []
            metadata.total_lines_removed = original_count - len(cleaned_lines)
            metadata.total_lines_kept = len(cleaned_lines)

            logger.info("="*80)
            logger.info("ADVANCED CLEANING COMPLETE (CONSERVATIVE MODE)")
            logger.info("="*80)
            logger.info(f"Result: {original_count} → {len(cleaned_lines)} lines "
                       f"({metadata.cleaning_ratio:.1f}% removed)")
            logger.info("="*80)

            return cleaned_markdown, metadata
        
        # STAGE 2: Extract positional candidates for headers/footers
        logger.info("[STAGE 2] Extracting positional header/footer candidates...")
        positional_headers, positional_footers = self._extract_positional_candidates(pages)
        logger.info(f"  [+] Found {len(positional_headers)} potential headers (top 10-15%)")
        logger.info(f"  [+] Found {len(positional_footers)} potential footers (bottom 10-15%)")
        
        # STAGE 3: Apply frequency-based filtering
        logger.info("[STAGE 3] Applying frequency-based filtering (>50% threshold)...")
        repeated_headers = self._filter_by_frequency(positional_headers, len(pages), threshold=0.5)
        repeated_footers = self._filter_by_frequency(positional_footers, len(pages), threshold=0.5)
        logger.info(f"  [+] {len(repeated_headers)} headers appear >50% of pages")
        logger.info(f"  [+] {len(repeated_footers)} footers appear >50% of pages")
        
        # STAGE 4: Apply structural pattern filtering
        logger.info("[STAGE 4] Filtering structural noise patterns...")
        repeated_headers = self._filter_structural_noise(repeated_headers, preserve_titles=True)
        repeated_footers = self._filter_structural_noise(repeated_footers, preserve_titles=False)
        logger.info(f"  [+] After structural filtering: {len(repeated_headers)} headers, {len(repeated_footers)} footers")
        
        # STAGE 5: Remove identified patterns
        logger.info("[STAGE 5] Removing headers/footers and noise...")
        cleaned_lines = self._remove_headers_footers_advanced(
            original_lines, repeated_headers, repeated_footers
        )
        removed_count = original_count - len(cleaned_lines)
        logger.info(f"  [+] Removed {removed_count} lines ({100*removed_count/original_count:.1f}%)")
        
        # STAGE 6: Clean whitespace and finalize
        logger.info("[STAGE 6] Final cleanup...")
        cleaned_lines = self._clean_whitespace(cleaned_lines)
        cleaned_markdown = '\n'.join(cleaned_lines)
        
        # Prepare metadata
        metadata = DocumentMetadata()
        metadata.title = self._extract_document_title(original_lines)
        metadata.page_count = len(pages)
        metadata.chapters = self._extract_chapters(original_lines)
        metadata.repeated_headers = repeated_headers
        metadata.repeated_footers = repeated_footers
        metadata.total_lines_removed = removed_count
        metadata.total_lines_kept = len(cleaned_lines)
        
        logger.info("="*80)
        logger.info("ADVANCED CLEANING COMPLETE")
        logger.info("="*80)
        logger.info(f"Result: {original_count} → {len(cleaned_lines)} lines "
                   f"({metadata.cleaning_ratio:.1f}% removed)")
        logger.info(f"Size: {len(markdown_text)} → {len(cleaned_markdown)} chars "
                   f"({100*len(cleaned_markdown)/len(markdown_text):.1f}%)")
        logger.info("="*80)
        
        return cleaned_markdown, metadata

    def _extract_content_between_dividers_per_page(
        self,
        pages: List[List[str]],
    ) -> Tuple[List[List[str]], int]:
        """For each page, keep only lines between first and last divider when available."""
        if not pages:
            return pages, 0

        processed_pages: List[List[str]] = []
        trimmed_count = 0

        for page in pages:
            if not page:
                processed_pages.append(page)
                continue

            divider_positions = [idx for idx, ln in enumerate(page) if self._is_divider(ln)]

            if len(divider_positions) >= 2:
                start = divider_positions[0] + 1
                end = divider_positions[-1]

                # Keep only content in-between and remove divider lines themselves.
                content = [ln for ln in page[start:end] if not self._is_divider(ln)]
                processed_pages.append(content)
                trimmed_count += 1
            else:
                processed_pages.append(page)

        return processed_pages, trimmed_count
    
    def _split_pages_advanced(self, lines: List[str]) -> List[List[str]]:
        """
        Split lines into page blocks using various markers.
        
        Detects:
        - Page markers: "## Page X", "Page X:", etc.
        - Dividers: "---", "___", etc.
        - Manual page breaks
        
        Returns:
            List of page blocks (each page as list of lines)
        """
        # Prefer explicit page markers. Divider-only splitting is handled by
        # divider cleaner; using dividers here can over-split and remove content.
        has_page_markers = any(self._is_page_marker(line) for line in lines)
        if not has_page_markers:
            return [lines]

        pages = [[]]
        
        for line in lines:
            # Check for page marker (## Page X, etc.)
            if self._is_page_marker(line):
                # Start new page
                if pages[-1]:  # Only if current page has content
                    pages.append([])
            else:
                pages[-1].append(line)
        
        # Remove empty pages
        pages = [p for p in pages if p]
        
        return pages if pages else [lines]
    
    def _extract_positional_candidates(self, pages: List[List[str]]) -> Tuple[List[str], List[str]]:
        """
        Extract header/footer candidates using positional heuristics.
        
        For each page:
        - Top 10-15%: Potential headers
        - Bottom 10-15%: Potential footers
        - Middle: Content (keep)
        
        Returns:
            Tuple of (header_candidates, footer_candidates)
        """
        headers = []
        footers = []
        
        for page_idx, page in enumerate(pages):
            if not page:
                continue
            
            # Calculate boundaries
            page_len = len(page)
            top_boundary = max(1, int(page_len * 0.15))  # 15% from top
            bottom_boundary = max(1, int(page_len * 0.85))  # 15% from bottom
            
            # Extract top lines (potential headers)
            for i in range(0, min(top_boundary, page_len)):
                line = page[i].strip()
                if line and len(line) > 3:  # Not empty, not too short
                    headers.append(line)
            
            # Extract bottom lines (potential footers)
            for i in range(max(0, bottom_boundary), page_len):
                line = page[i].strip()
                if line and len(line) > 3:  # Not empty, not too short
                    footers.append(line)
        
        return headers, footers
    
    def _filter_by_frequency(self, candidates: List[str], total_pages: int, 
                            threshold: float = 0.5) -> List[str]:
        """
        Keep only candidates that appear in >threshold% of pages.
        
        Args:
            candidates: List of candidate lines (from all pages)
            total_pages: Total number of pages
            threshold: Minimum frequency (e.g., 0.5 = 50%)
            
        Returns:
            List of candidates appearing frequently
        """
        if not candidates or total_pages < 2:
            return []
        
        # Normalize candidates (remove trailing page numbers and extra spaces)
        normalized_map = {}  # Map: normalized -> original
        freq_count = {}  # Map: normalized -> count
        
        for cand in candidates:
            # Remove trailing numbers, page numbers, etc.
            normalized = re.sub(r'\s+\d+\s*$', '', cand).strip()
            
            # Skip very short lines
            if len(normalized) < 5:
                continue
            
            if normalized not in normalized_map:
                normalized_map[normalized] = cand
            
            freq_count[normalized] = freq_count.get(normalized, 0) + 1
        
        # Keep only patterns appearing >threshold% of pages
        min_frequency = max(2, int(total_pages * threshold + 0.999))
        result = []
        for normalized, count in freq_count.items():
            if count >= min_frequency:
                result.append(normalized_map[normalized])
                logger.debug(f"  Frequent pattern: '{normalized}' ({count}/{total_pages} pages)")
        
        return result
    
    def _filter_structural_noise(self, patterns: List[str], 
                                preserve_titles: bool = True) -> List[str]:
        """
        Filter out non-meaningful patterns using structural analysis.
        
        Removes:
        - Horizontal lines/dividers (---, ___, ===, etc.)
        - Very short lines (< 5 chars)
        - Metadata patterns (Author, Date, etc.)
        - Pure punctuation/symbols
        
        Preserves (if preserve_titles=True):
        - Titles with keywords: "Chương", "Chapter", "Bài", "Lesson"
        - Numbered sections: "1.1", "2.3.4", etc.
        - Hierarchical structure
        
        Args:
            patterns: List of pattern strings
            preserve_titles: Keep title-like patterns
            
        Returns:
            Filtered list
        """
        result = []
        
        for pattern in patterns:
            stripped = pattern.strip()
            
            # Skip empty or too short
            if not stripped or len(stripped) < 5:
                continue
            
            # Skip dividers and horizontal lines
            if self._is_divider_pattern(stripped):
                logger.debug(f"  Filtered divider: '{stripped}'")
                continue
            
            # Skip metadata patterns
            if self._is_metadata_line(pattern):
                logger.debug(f"  Filtered metadata: '{stripped}'")
                continue
            
            # Skip mostly non-alphanumeric (symbols, punctuation only)
            alphanumeric_ratio = sum(1 for c in stripped if c.isalnum()) / len(stripped)
            if alphanumeric_ratio < 0.3:
                logger.debug(f"  Filtered symbol noise: '{stripped}'")
                continue
            
            # Skip page numbers (standalone or trailing)
            if re.match(r'^\d+\s*$', stripped) or re.match(r'.*page?\s*\d+\s*$', stripped, re.IGNORECASE):
                logger.debug(f"  Filtered page number: '{stripped}'")
                continue
            
            # For removal candidates, title-like lines should be preserved from
            # removal, i.e. excluded from result.
            if preserve_titles:
                # Keep if it contains title keywords
                if any(keyword in stripped.lower() for keyword in 
                       ['chương', 'chapter', 'bài', 'lesson', 'section', 'phần', 'part', 'mục']):
                    logger.debug(f"  Preserved content title (not removed): '{stripped}'")
                    continue
                
                # Keep if it looks like numbered section (1.1, 2.3.4, etc.)
                if re.match(r'^\d+(\.\d+)*\s+', stripped):
                    logger.debug(f"  Preserved numbered section (not removed): '{stripped}'")
                    continue
            
            # Keep other patterns
            result.append(stripped)
        
        return result

    def _normalize_repeated_pattern(self, text: str) -> str:
        """Normalize page-variant header/footer strings for robust matching."""
        normalized = (text or "").strip().lower()
        normalized = re.sub(r'\s+', ' ', normalized)

        # Remove common page markers embedded in header/footer lines.
        normalized = re.sub(
            r'(?:\bpage\b|\btrang\b)\s*\d+(?:\s*/\s*\d+)?',
            '',
            normalized,
            flags=re.IGNORECASE,
        )
        normalized = re.sub(r'\b\d+\s*/\s*\d+\b', '', normalized)
        # Remove trailing standalone page index only when strongly separated.
        normalized = re.sub(r'\s{2,}\d+\s*$', '', normalized)

        normalized = re.sub(r'\s+', ' ', normalized)
        return normalized.strip(" -:|\t")
    
    def _remove_headers_footers_advanced(self, lines: List[str], 
                                       headers: List[str], 
                                       footers: List[str]) -> List[str]:
        """
        Remove identified header/footer patterns from the text.
        
        Strategy:
        1. Normalize patterns (remove page numbers for matching)
        2. For each line in text, check if it matches any pattern
        3. Remove exact matches or near-matches
        4. Preserve content lines
        
        Args:
            lines: Original lines
            headers: Identified header patterns
            footers: Identified footer patterns
            
        Returns:
            Filtered lines
        """
        # Create normalized patterns for matching
        normalized_headers = set()
        normalized_footers = set()
        
        for h in headers:
            normalized = self._normalize_repeated_pattern(h)
            normalized_headers.add(normalized)
        
        for f in footers:
            normalized = self._normalize_repeated_pattern(f)
            normalized_footers.add(normalized)
        
        result = []
        skip_count = 0
        
        for line in lines:
            stripped = line.strip()
            normalized = self._normalize_repeated_pattern(stripped)
            
            # Skip if matches header or footer
            if normalized in normalized_headers or normalized in normalized_footers:
                skip_count += 1
                logger.debug(f"  Skipped line: '{stripped[:60]}'")
                continue
            
            # Skip dividers and structural noise
            if self._is_divider(line):
                skip_count += 1
                logger.debug(f"  Skipped divider: '{stripped}'")
                continue
            
            # Skip page markers
            if self._is_page_marker(line):
                skip_count += 1
                logger.debug(f"  Skipped page marker: '{stripped}'")
                continue

            # Skip Word-style footer boilerplate even when slight variants exist.
            if self._looks_like_word_footer(stripped):
                skip_count += 1
                logger.debug(f"  Skipped Word footer: '{stripped[:80]}'")
                continue
            
            # Keep line
            result.append(line)
        
        logger.debug(f"Removed {skip_count} header/footer lines")
        return result

    def _looks_like_word_footer(self, line: str) -> bool:
        """Heuristic for Word-exported footer/header lines repeated on each page."""
        text = (line or "").strip()
        if not text:
            return False

        lowered = text.lower()
        # Ignore lines that are definitely valid content (form fields/labels/titles)
        if any(keyword in lowered for keyword in ["họ và tên", "nơi làm việc", "giảng viên", "email", "điện thoại", "thông tin chung", "general information"]):
            return False

        # Filter Adobe InDesign boilerplate lines (containing .indd, case-insensitive, short length)
        if ".indd" in lowered and len(text) <= 150:
            return True

        markers = [
            "biên soạn",
            "bien soan",
            "bộ môn",
            "bo mon",
            "khoa",
            "trang",
            "page",
            "giáo viên",
            "giao vien",
        ]
        hit_count = sum(1 for m in markers if m in lowered)

        # Require strong signal to avoid deleting real content.
        if hit_count >= 2 and len(text) <= 220:
            # Word footers with page variations typically contain a page number
            if any(p in lowered for p in ["trang", "page"]) or re.search(r'\b\d+\b', text):
                return True

        # Dedicated short page footer line.
        if re.match(r'^(?:trang|page)\s*\d+(?:\s*/\s*\d+)?\s*$', text, re.IGNORECASE):
            return True

        return False
    
    def _is_divider_pattern(self, text: str) -> bool:
        """Check if text is a horizontal divider/separator line."""
        stripped = text.strip()
        if len(stripped) < 3:
            return False
        
        # Check for divider patterns: ---, ___, ***, ===, etc.
        return bool(re.match(r'^([-*_=])\1{2,}$|^[–—─═▬▭▮▯]{3,}$|^[━┄┅┆┇┈┉┊┋]{3,}$', stripped))
    
    def _extract_document_title(self, lines: List[str]) -> Optional[str]:
        """Extract main document title (first H1 or substantial line)."""
        for line in lines:
            if line.startswith('# ') and not self._is_page_marker(line):
                return line.replace('# ', '').strip()
        return None
    
    def _extract_chapters(self, lines: List[str]) -> List[str]:
        """Extract chapter/section headings."""
        chapters = []
        for line in lines:
            if line.startswith('# ') and not self._is_page_marker(line):
                title = line.replace('# ', '').strip()
                if title not in chapters and len(chapters) < 50:  # Limit to 50 chapters
                    chapters.append(title)
        return chapters
    
    def _extract_initial_metadata(self, markdown_text: str) -> DocumentMetadata:
        """
        Extract initial metadata from raw markdown.
        
        Detects:
        - Document title (usually first H1 or long string at beginning)
        - Number of pages
        - Chapter/section structure
        """
        metadata = DocumentMetadata()
        lines = markdown_text.split('\n')
        
        # Find document title (first H1)
        title_found = False
        for line in lines:
            if line.startswith('# ') and not self._is_page_marker(line):
                metadata.title = line.replace('# ', '').strip()
                title_found = True
                break
        
        # If no H1 found, try to detect title from first substantial line
        # (avoid page markers and short lines)
        if not title_found:
            for line in lines:
                stripped = line.strip()
                # Skip empty lines, page markers, and short lines
                if (stripped and len(stripped) > 20 and 
                    not self._is_page_marker(line) and 
                    not self._is_metadata_line(line) and
                    not line.startswith('##')):  # Avoid subheadings
                    # Check if this looks like a title (contains common title patterns)
                    if any(keyword in stripped.lower() for keyword in 
                           ['bài', 'chapter', 'chương', 'lesson', 'title', 'tài liệu', 'hệ quản trị']):
                        metadata.title = stripped
                        title_found = True
                        break
        
        # Count pages from page markers
        page_markers = self.patterns.page_marker.findall(markdown_text)
        metadata.page_count = len(set(page_markers))  # Unique page markers
        if metadata.page_count == 0:
            # Fallback: count mentions of "Page X"
            page_numbers = re.findall(r'(?:page|pg|p\.)\s*(\d+)', markdown_text, re.IGNORECASE)
            if page_numbers:
                metadata.page_count = max(int(p) for p in page_numbers)
        
        # Extract chapter structure
        for line in lines:
            if line.startswith('# ') and not self._is_page_marker(line):
                chapter_title = line.replace('# ', '').strip()
                if chapter_title != metadata.title:  # Don't add title as chapter
                    metadata.chapters.append(chapter_title)
        
        return metadata
    
    def _identify_repeated_patterns(self, lines: List[str], 
                                   threshold: float = 0.6) -> Tuple[List[str], List[str]]:
        """
        Identify repeated headers and footers across the document.
        
        These patterns appear on multiple pages and should be removed.
        Works with BOTH:
        1. Divider-based structure (────────)
        2. Page marker structure (## Page X)
        
        Logic:
        - Divider: Content BETWEEN dividers is main content
        - Page marker: Content AFTER "## Page X" is page header/footer that repeats
        - Threshold: Pattern must appear in >60% of pages
        
        Args:
            lines: List of markdown lines
            threshold: Minimum percentage of pages (or similar structures) appear
            
        Returns:
            Tuple of (repeated_headers_list, repeated_footers_list)
        """
        # Strategy 1: Page marker-based pages (## Page X)
        if self.patterns.page_marker.search('\n'.join(lines)):
            page_blocks = self._split_by_page_markers(lines)
            
            if len(page_blocks) >= 2:
                logger.debug(f"Strategy 1: Found {len(page_blocks)} page blocks")
                
                # Collect lines from each block
                block_contents = []
                for block_idx, block in enumerate(page_blocks):
                    block_contents.append([line.strip() for line in block if line.strip()])
                
                # Find lines near top/bottom of each block.
                # Top lines are likely headers; bottom lines are likely footers.
                potential_headers = []
                potential_footers = []
                for block_idx, block in enumerate(block_contents):
                    # Get first 2 non-empty lines of each block (potential header lines)
                    for offset, line in enumerate(block[:2]):
                        if line and len(line) > 5 and not self._is_heading(line):
                            potential_headers.append((line, block_idx))

                    # Get last 2 non-empty lines of each block (potential footer lines)
                    tail = block[-2:] if len(block) >= 2 else block
                    for line in tail:
                        if line and len(line) > 5 and not self._is_heading(line):
                            potential_footers.append((line, block_idx))
                
                # Normalize headers by removing page numbers for matching
                # e.g., "Bài giảng CSDL     1" -> "Bài giảng CSDL" (key for matching)
                header_mapping = {}  # Maps normalized key -> original text
                normalized_list = []
                
                for orig_text, _ in potential_headers:
                    normalized = self._normalize_repeated_pattern(orig_text)
                    if normalized and len(normalized) > 5:
                        normalized_list.append(normalized)
                        if normalized not in header_mapping:
                            header_mapping[normalized] = orig_text
                
                # Count normalized patterns
                header_freq = {}
                for h in normalized_list:
                    header_freq[h] = header_freq.get(h, 0) + 1
                
                # Find header patterns appearing in multiple blocks
                repeated_threshold = max(2, int(len(page_blocks) * threshold + 0.999))
                repeated_headers = []
                for h, freq in header_freq.items():
                    if freq >= repeated_threshold:
                        repeated_headers.append(header_mapping[h])
                        logger.debug(f"Found repeated header '{h}' ({freq}/{len(page_blocks)} blocks)")

                # Footer frequency using the same normalization.
                footer_mapping = {}
                footer_normalized_list = []
                for orig_text, _ in potential_footers:
                    normalized = self._normalize_repeated_pattern(orig_text)
                    if normalized and len(normalized) > 5:
                        footer_normalized_list.append(normalized)
                        if normalized not in footer_mapping:
                            footer_mapping[normalized] = orig_text

                footer_freq = {}
                for f in footer_normalized_list:
                    footer_freq[f] = footer_freq.get(f, 0) + 1

                repeated_footers = []
                for f, freq in footer_freq.items():
                    if freq >= repeated_threshold:
                        repeated_footers.append(footer_mapping[f])
                        logger.debug(f"Found repeated footer '{f}' ({freq}/{len(page_blocks)} blocks)")

                return repeated_headers, repeated_footers
        
        # Strategy 2: Page marker-based structure (## Page X)
        # Find lines that appear after each page marker
        page_marker_indices = []
        for i, line in enumerate(lines):
            if re.match(r'^##\s+Page\s+\d+', line, re.IGNORECASE):
                page_marker_indices.append(i)
        
        if len(page_marker_indices) >= 2:
            logger.debug(f"Found {len(page_marker_indices)} page markers at indices: {page_marker_indices}")
            
            # Collect lines that appear immediately after each page marker
            headers_after_markers = []
            for page_idx, marker_line_idx in enumerate(page_marker_indices):
                # Look at next 3 lines after page marker
                for offset in range(1, 4):
                    next_line_idx = marker_line_idx + offset
                    if next_line_idx < len(lines):
                        next_line = lines[next_line_idx].strip()
                        if next_line and len(next_line) > 5 and not self._is_heading(lines[next_line_idx]):
                            headers_after_markers.append(next_line)
                            logger.debug(f"Page {page_idx+1} potential header: '{next_line}'")
            
            # Normalize headers by removing page numbers
            # e.g., "Bài giảng CSDL     1" -> "Bài giảng CSDL" (key for matching)
            normalized_headers = []
            header_mapping = {}  # Map normalized key back to original
            
            for h in headers_after_markers:
                normalized = self._normalize_repeated_pattern(h)
                if normalized and len(normalized) > 5:
                    normalized_headers.append(normalized)
                    if normalized not in header_mapping:
                        header_mapping[normalized] = h
            
            # Count frequency of normalized patterns
            header_freq = {}
            for h in normalized_headers:
                header_freq[h] = header_freq.get(h, 0) + 1
            
            # Keep headers that appear on 60%+ of pages
            threshold_count = max(2, int(len(page_marker_indices) * threshold + 0.999))
            repeated_headers = []
            for h, freq in header_freq.items():
                if freq >= threshold_count:
                    # Use original header text (with one page number as reference)
                    repeated_headers.append(header_mapping[h])
                    logger.debug(f"Repeated header '{h}' found {freq}/{len(page_marker_indices)} times")
            
            return repeated_headers, []
        
        return [], []
    
    def _detect_headers_near_separators(self, lines: List[str]) -> Tuple[List[str], List[str]]:
        """
        Detect header/footer patterns that appear immediately before or after separators.
        
        Pattern: Text that appears on multiple pages in the form:
        ────────────────────
        Tiêu đề trang
        ────────────────────
        
        Args:
            lines: List of markdown lines
            
        Returns:
            Tuple of (headers_list, footers_list)
        """
        headers = []
        footers = []
        
        for i in range(1, len(lines) - 1):
            if self._is_divider(lines[i]):
                # Check line before separator (likely header)
                before = lines[i-1].strip()
                if before and len(before) > 5 and not self._is_heading(lines[i-1]):
                    headers.append(before)
                
                # Check line after separator (likely footer or header)
                if i + 1 < len(lines):
                    after = lines[i+1].strip()
                    if after and len(after) > 5 and not self._is_heading(lines[i+1]):
                        headers.append(after)
        
        # Count frequency - keep only patterns that appear multiple times
        header_freq = {}
        for h in headers:
            header_freq[h] = header_freq.get(h, 0) + 1
        
        repeated_headers = [h for h, freq in header_freq.items() if freq >= 2]
        
        return repeated_headers, footers
    
    def _split_by_page_markers(self, lines: List[str]) -> List[List[str]]:
        """
        Split lines into blocks separated by page markers.
        
        Args:
            lines: List of markdown lines
            
        Returns:
            List of page blocks
        """
        page_blocks = [[]]
        
        for line in lines:
            if self._is_page_marker(line):
                # Start new page block
                if page_blocks[-1]:  # Only add if current block has content
                    page_blocks.append([])
            else:
                page_blocks[-1].append(line)
        
        # Remove empty blocks
        return [block for block in page_blocks if block]
    
    def _remove_noise_patterns(self, lines: List[str], 
                              repeated_headers: List[str],
                              repeated_footers: List[str]) -> List[str]:
        """
        Remove various noise patterns from markdown.
        
        Key Strategy: Extract content BETWEEN dividers (page structure):
        [HEADER - REMOVE]
        ─────────────────
        [CONTENT - KEEP]
        ─────────────────
        [FOOTER - REMOVE]
        
        Args:
            lines: List of markdown lines
            repeated_headers: List of repeated header patterns
            repeated_footers: List of repeated footer patterns
            
        Returns:
            Cleaned list of lines
        """
        if not lines:
            return lines
        
        # Find all divider positions
        divider_positions = []
        for i, line in enumerate(lines):
            if self._is_divider(line):
                divider_positions.append(i)
        
        logger.debug(f"Found {len(divider_positions)} dividers at positions: {divider_positions}")
        
        # Mark lines to remove
        lines_to_remove = set()
        
        # If we have dividers, extract only content BETWEEN them
        if len(divider_positions) >= 2:
            # Only remove header (before first divider) and footer (after last divider) for short documents
            # (e.g. single-slide presentations or single pages, <= 150 lines).
            # Long documents should not use this aggressive top/bottom truncation.
            if len(lines) <= 150:
                # Remove EVERYTHING before first divider (top header)
                first_divider = divider_positions[0]
                for i in range(0, first_divider):
                    logger.debug(f"Removed top header (before first divider): {lines[i][:50]}")
                    lines_to_remove.add(i)
                
                # Remove EVERYTHING after last divider (bottom footer)
                last_divider = divider_positions[-1]
                for i in range(last_divider + 1, len(lines)):
                    logger.debug(f"Removed bottom footer (after last divider): {lines[i][:50]}")
                    lines_to_remove.add(i)
            
            # Remove all divider lines themselves
            for idx in divider_positions:
                logger.debug(f"Removed divider: {lines[idx][:50]}")
                lines_to_remove.add(idx)
        
        # Also handle content between consecutive dividers on same page
        for i in range(1, len(divider_positions)):
            prev_divider = divider_positions[i-1]
            curr_divider = divider_positions[i]
            
            # If dividers are very close (within 3 lines), content between is likely header/footer
            if curr_divider - prev_divider <= 3:
                for j in range(prev_divider + 1, curr_divider):
                    if lines[j].strip():  # Only remove non-empty lines
                        logger.debug(f"Removed content between dividers: {lines[j][:50]}")
                        lines_to_remove.add(j)
        
        # Handle standalone page markers
        for i, line in enumerate(lines):
            if i not in lines_to_remove and self._is_page_marker(line):
                logger.debug(f"Removed page marker: {line[:50]}")
                lines_to_remove.add(i)

        # Handle Word-style footer/header boilerplate (author/department/page)
        for i, line in enumerate(lines):
            if i not in lines_to_remove and self._looks_like_word_footer(line.strip()):
                logger.debug(f"Removed Word footer/header: {line[:80]}")
                lines_to_remove.add(i)
        
        # Handle repeated headers/footers not associated with dividers
        # This includes headers that appear on multiple pages with different page numbers
        for i, line in enumerate(lines):
            if i not in lines_to_remove:
                line_stripped = line.strip()
                
                # Exact match for repeated headers/footers
                if line_stripped in repeated_headers or line_stripped in repeated_footers:
                    logger.debug(f"Removed repeated pattern (exact): {line[:50]}")
                    lines_to_remove.add(i)
                    continue
                
                # Also try to match normalized versions (for headers/footers with page variants)
                line_normalized = self._normalize_repeated_pattern(line_stripped)
                for header in repeated_headers:
                    header_normalized = self._normalize_repeated_pattern(header)
                    if line_normalized and header_normalized and line_normalized == header_normalized:
                        logger.debug(f"Removed repeated pattern (normalized): {line[:50]}")
                        lines_to_remove.add(i)
                        break
                
                if i not in lines_to_remove:
                    for footer in repeated_footers:
                        footer_normalized = self._normalize_repeated_pattern(footer)
                        if line_normalized and footer_normalized and line_normalized == footer_normalized:
                            logger.debug(f"Removed repeated footer (normalized): {line[:50]}")
                            lines_to_remove.add(i)
                            break

        
        # Remove inline page numbers
        for i, line in enumerate(lines):
            if i not in lines_to_remove and not self._is_heading(line):
                # Remove patterns like "Page 42" at end of line
                if re.search(r'\s+(?:page|pg|p\.)\s*\d+\s*$', line, flags=re.IGNORECASE):
                    lines[i] = re.sub(r'\s+(?:page|pg|p\.)\s*\d+\s*$', '', line, flags=re.IGNORECASE)
        
        # Aggressive cleaning: Remove metadata-like patterns
        if self.aggressive_cleaning:
            for i, line in enumerate(lines):
                if i not in lines_to_remove and self._is_metadata_line(line):
                    lines_to_remove.add(i)
        
        # Build cleaned lines
        cleaned_lines = []
        for i, line in enumerate(lines):
            if i not in lines_to_remove:
                cleaned_lines.append(line)
        
        return cleaned_lines
    
    def _normalize_heading_structure(self, lines: List[str], 
                                    metadata: DocumentMetadata) -> List[str]:
        """
        Normalize heading hierarchy to ensure consistent structure.
        
        Issues fixed:
        1. Improper heading levels (e.g., jumping from H1 to H3)
        2. Duplicate headings
        3. Inconsistent heading formatting
        
        Uses hierarchy: H1 (Title) -> H2 (Chapters) -> H3 (Sections) -> H4 (Subsections)
        
        Args:
            lines: List of markdown lines
            metadata: Document metadata
            
        Returns:
            Lines with normalized heading structure
        """
        normalized_lines = []
        last_heading_level = 0
        seen_headings = set()
        
        for line in lines:
            if self._is_heading(line):
                heading_level = len(line) - len(line.lstrip('#'))
                heading_text = line.lstrip('#').strip()
                
                # Avoid duplicate headings
                if heading_text in seen_headings:
                    logger.debug(f"Skipped duplicate heading: {heading_text}")
                    continue
                
                seen_headings.add(heading_text)
                
                # Fix improper level jumps
                # If jumping from H1 to H4, normalize to H2
                if heading_level > last_heading_level + 1 and last_heading_level > 0:
                    adjusted_level = last_heading_level + 1
                    line = '#' * adjusted_level + ' ' + heading_text
                    logger.debug(f"Normalized heading level from {heading_level} to {adjusted_level}")
                    heading_level = adjusted_level
                
                last_heading_level = heading_level
            
            normalized_lines.append(line)
        
        return normalized_lines
    
    def _clean_whitespace(self, lines: List[str]) -> List[str]:
        """
        Clean up excessive whitespace while preserving structure.
        
        Rules:
        1. Remove empty lines at start and end
        2. Reduce multiple consecutive empty lines to max 2
        3. Ensure single empty line between sections
        
        Args:
            lines: List of markdown lines
            
        Returns:
            Cleaned lines
        """
        if not lines:
            return []
        
        # Remove leading/trailing empty lines
        start_idx = 0
        end_idx = len(lines) - 1
        
        while start_idx < len(lines) and not lines[start_idx].strip():
            start_idx += 1
        
        while end_idx >= 0 and not lines[end_idx].strip():
            end_idx -= 1
        
        if start_idx > end_idx:
            return []
        
        lines = lines[start_idx:end_idx + 1]
        
        # Reduce multiple consecutive empty lines
        cleaned = []
        empty_count = 0
        
        for line in lines:
            if not line.strip():
                empty_count += 1
                if empty_count <= 2:  # Allow max 2 consecutive empty lines
                    cleaned.append(line)
            else:
                empty_count = 0
                cleaned.append(line)
        
        return cleaned
    
    def extract_content_blocks(self, markdown_text: str) -> List[ContentBlock]:
        """
        Extract structured content blocks from markdown.
        
        Each block represents a logical unit (paragraph, section, list item, etc.)
        with associated metadata.
        
        Args:
            markdown_text: Cleaned markdown text
            
        Returns:
            List of ContentBlock objects
        """
        blocks = []
        current_section = None
        current_heading_level = 0
        
        for line in markdown_text.split('\n'):
            if not line.strip():
                continue
            
            if self._is_heading(line):
                level = len(line) - len(line.lstrip('#'))
                text = line.lstrip('#').strip()
                current_section = text
                current_heading_level = level
                
                block = ContentBlock(
                    content=text,
                    section_title=current_section,
                    heading_level=level,
                    block_type="heading"
                )
                blocks.append(block)
            
            elif line.startswith(('- ', '* ', '+ ', '1. ', '2. ', '3. ')):
                block = ContentBlock(
                    content=line,
                    section_title=current_section,
                    heading_level=current_heading_level,
                    block_type="list_item"
                )
                blocks.append(block)
            
            elif line.startswith('|'):  # Table row
                if not blocks or blocks[-1].block_type != "table":
                    block = ContentBlock(
                        content=line,
                        section_title=current_section,
                        heading_level=current_heading_level,
                        block_type="table"
                    )
                    blocks.append(block)
                else:
                    blocks[-1].content += '\n' + line
            
            else:  # Regular paragraph
                block = ContentBlock(
                    content=line,
                    section_title=current_section,
                    heading_level=current_heading_level,
                    block_type="paragraph"
                )
                blocks.append(block)
        
        return blocks
    
    # ============================================================================
    # HELPER METHODS - Pattern Detection and Validation
    # ============================================================================
    
    def _is_page_marker(self, line: str) -> bool:
        """
        Detect if line is a page marker (e.g., "## Page 1", "pg. 5").
        
        Page markers are generated by PDF extraction and don't add semantic value.
        Removing them improves readability.
        
        Args:
            line: Line to check
            
        Returns:
            True if line matches page marker pattern
        """
        stripped = line.strip()
        return self.patterns.page_marker.match(stripped) is not None
    
    def _is_heading(self, line: str) -> bool:
        """
        Detect if line is a Markdown heading (# ## ### etc.).
        
        Headings are structural and should be preserved.
        They mark section boundaries for chunking.
        
        Args:
            line: Line to check
            
        Returns:
            True if line is a valid Markdown heading
        """
        if not line.startswith('#'):
            return False
        # Count leading # symbols (max 6 for Markdown)
        hash_count = len(line) - len(line.lstrip('#'))
        return 1 <= hash_count <= 6 and (len(line) == hash_count or line[hash_count] == ' ')
    
    def _is_divider(self, line: str) -> bool:
        """
        Detect if line is a horizontal divider (---, ***, etc.).
        
        Dividers are layout artifacts from PDF and should be removed.
        They don't add semantic information.
        
        Args:
            line: Line to check
            
        Returns:
            True if line matches divider pattern
        """
        stripped = line.strip()
        if not stripped:
            return False
        return self.patterns.divider.match(stripped) is not None
    
    def _is_list_item(self, line: str) -> bool:
        """
        Detect if line is a list item (-, *, +, or numbered).
        
        List items are structural and should be preserved.
        They often contain important information in structured form.
        
        Args:
            line: Line to check
            
        Returns:
            True if line is a list item
        """
        return self.patterns.list_item.match(line.lstrip()) is not None
    
    def _is_metadata_line(self, line: str) -> bool:
        """
        Detect if line looks like document metadata (author, date, copyright).
        
        These are typically not important for RAG and can be removed safely
        in aggressive mode.
        
        Args:
            line: Line to check
            
        Returns:
            True if line appears to be metadata
        """
        stripped = line.strip()
        if not stripped:
            return False
        
        # Check against metadata pattern library
        if self.patterns.metadata.match(stripped):
            return True
        
        # Additional heuristics
        if stripped.startswith('[') and stripped.endswith(']'):
            return True
        
        return False
    
    def _is_meaningful_line(self, line: str) -> bool:
        """
        Determine if line contains meaningful content.
        
        Meaningful content should be preserved.
        Filtering by length prevents removing important short statements.
        
        Args:
            line: Line to check
            
        Returns:
            True if line has meaningful content
        """
        stripped = line.strip()
        
        # Empty lines are not meaningful (but may be important for structure)
        if not stripped:
            return False
        
        # Very short lines are usually noise (but could be data)
        if len(stripped) < self.min_meaningful_length:
            return False
        
        # Lines that are mostly special characters are noise
        special_char_ratio = sum(1 for c in stripped if not c.isalnum()) / len(stripped)
        if special_char_ratio > 0.7:
            return False
        
        return True
    
    def _normalize_text(self, text: str) -> str:
        """
        Normalize text for comparison (case-insensitive, whitespace-reduced).
        
        Used for duplicate detection and pattern matching.
        
        Args:
            text: Text to normalize
            
        Returns:
            Normalized text
        """
        # Convert to lowercase
        text = text.lower()
        
        # Remove extra whitespace
        text = self.patterns.multiple_spaces.sub(' ', text)
        text = text.strip()
        
        # Remove page numbers at end
        text = re.sub(r'\s+\d+\s*$', '', text)
        
        return text
    
    def _get_heading_level(self, line: str) -> int:
        """
        Extract heading level from Markdown heading.
        
        Args:
            line: Heading line (must be validated with _is_heading first)
            
        Returns:
            Heading level (1-6) or 0 if not a heading
        """
        if not self._is_heading(line):
            return 0
        return len(line) - len(line.lstrip('#'))
    
    def _get_statistics(self, original_lines: int, cleaned_lines: int) -> Dict:
        """
        Calculate cleaning statistics.
        
        Useful for monitoring cleaning effectiveness.
        
        Args:
            original_lines: Number of lines before cleaning
            cleaned_lines: Number of lines after cleaning
            
        Returns:
            Dictionary with statistics
        """
        removed = original_lines - cleaned_lines
        ratio = (removed / original_lines * 100) if original_lines > 0 else 0
        
        return {
            'original_lines': original_lines,
            'cleaned_lines': cleaned_lines,
            'lines_removed': removed,
            'removal_ratio_percent': round(ratio, 2),
            'content_kept_ratio_percent': round(100 - ratio, 2),
        }
    
    # ============================================================================
    # DEBUGGING AND VISUALIZATION METHODS
    # ============================================================================
    
    def print_statistics(self, markdown_text: str, cleaned_text: str) -> None:
        """
        Print cleaning statistics to console (for debugging).
        
        Args:
            markdown_text: Original text
            cleaned_text: Cleaned text
        """
        orig_lines = len(markdown_text.split('\n'))
        clean_lines = len(cleaned_text.split('\n'))
        stats = self._get_statistics(orig_lines, clean_lines)
        
        print("\n" + "="*60)
        print("MARKDOWN CLEANING STATISTICS")
        print("="*60)
        print(f"Original lines:        {stats['original_lines']}")
        print(f"Cleaned lines:         {stats['cleaned_lines']}")
        print(f"Lines removed:         {stats['lines_removed']}")
        print(f"Removal ratio:         {stats['removal_ratio_percent']}%")
        print(f"Content kept ratio:    {stats['content_kept_ratio_percent']}%")
        print("="*60 + "\n")
    
    def get_detection_report(self, metadata: DocumentMetadata) -> Dict:
        """
        Generate a report of what was detected and removed.
        
        Useful for auditing cleaning results.
        
        Args:
            metadata: Document metadata from cleaning
            
        Returns:
            Dictionary with detection report
        """
        return {
            'title': metadata.title,
            'pages': metadata.page_count,
            'chapters': len(metadata.chapters),
            'repeated_headers': metadata.repeated_headers,
            'repeated_footers': metadata.repeated_footers,
            'cleaning_ratio': round(metadata.cleaning_ratio, 2),
        }



def clean_markdown(
    markdown_text: str, 
    aggressive: bool = False,
    debug: bool = False,
    threshold: float = 0.6
) -> Tuple[str, DocumentMetadata]:
    """
    Convenience function to clean markdown in one call.
    
    This is the main public API for using the cleaner.
    
    Args:
        markdown_text: Raw markdown from PDF/DOCX conversion
        aggressive: If True, apply aggressive cleaning (removes more metadata)
        debug: If True, print detailed debugging information
        threshold: Header frequency threshold (0.0-1.0, default 0.6 = 60%)
                 - Higher (0.9): Keep more (safer, less aggressive)
                 - Lower (0.3): Remove more (riskier, more aggressive)
        
    Returns:
        Tuple of (cleaned_markdown: str, metadata: DocumentMetadata)
        
    Example:
        >>> from backend.app.markdown_cleaner import clean_markdown
        >>> pdf_text = extract_text_from_pdf("document.pdf")
        >>> cleaned, metadata = clean_markdown(pdf_text, aggressive=False)
        >>> print(f"Removed {metadata.total_lines_removed} noise lines")
        >>> # Use cleaned markdown for embedding
        >>> chunks = split_by_headings(cleaned)
        >>> embeddings = embed_chunks(chunks)
    """
    cleaner = MarkdownCleaner(
        aggressive_cleaning=aggressive,
        header_frequency_threshold=threshold,
        debug_mode=debug
    )
    return cleaner.clean_markdown(markdown_text)


# ============================================================================
# MODULE-LEVEL DOCUMENTATION AND EXAMPLES
# ============================================================================

"""
USAGE EXAMPLES:

Example 1: Basic cleaning with default settings
────────────────────────────────────────────────────────────────────

    from backend.app.markdown_cleaner import clean_markdown
    
    # Extract text from PDF
    from PyPDF2 import PdfReader
    pdf = PdfReader("document.pdf")
    text = ""
    for page in pdf.pages:
        text += page.extract_text() + "\\n"
    
    # Clean the markdown
    cleaned_text, metadata = clean_markdown(text)
    
    print(f"Original lines: {len(text.split(chr(10)))}")
    print(f"Cleaned lines: {len(cleaned_text.split(chr(10)))}")
    print(f"Title: {metadata.title}")
    print(f"Pages: {metadata.page_count}")
    print(f"Repeated headers removed: {metadata.repeated_headers}")


Example 2: Aggressive cleaning for noisy PDFs
────────────────────────────────────────────────────────────────────

    cleaned_text, metadata = clean_markdown(
        pdf_text,
        aggressive=True,  # Remove more metadata
        threshold=0.5     # Remove patterns on 50%+ pages (more aggressive)
    )


Example 3: Debug mode to see detailed processing
────────────────────────────────────────────────────────────────────

    cleaned_text, metadata = clean_markdown(
        pdf_text,
        debug=True  # Print detailed logs
    )
    
    # Check what was detected
    detection_report = cleaner.get_detection_report(metadata)
    print(detection_report)


Example 4: Extract content blocks for RAG
────────────────────────────────────────────────────────────────────

    from backend.app.markdown_cleaner import MarkdownCleaner, clean_markdown
    
    cleaned_text, metadata = clean_markdown(pdf_text)
    
    # Extract structured blocks for downstream processing
    cleaner = MarkdownCleaner()
    blocks = cleaner.extract_content_blocks(cleaned_text)
    
    # Process blocks for embedding
    for block in blocks:
        if block.block_type == "heading":
            # Use as chunk boundary
            chunk_start = block.content
        elif block.block_type == "paragraph":
            # Add to current chunk
            pass


CONFIGURATION GUIDANCE:

1. For published/clean PDFs:
   ├─ aggressive=False
   ├─ threshold=0.6 (default)
   └─ Result: Minimal changes, preserve content

2. For scanned/noisy PDFs:
   ├─ aggressive=False
   ├─ threshold=0.7 (higher = safer)
   └─ Result: Remove some patterns, preserve content

3. For highly structured PDFs (courses, textbooks):
   ├─ aggressive=True
   ├─ threshold=0.5 (lower = more cleaning)
   └─ Result: Clean structure, remove duplicate headers

4. For OCR/degraded PDFs:
   ├─ aggressive=True
   ├─ threshold=0.3 (aggressive)
   ├─ debug=True (see what's happening)
   └─ Result: Maximum cleaning, may lose some content


PATTERNS REMOVED:

✓ PAGE MARKERS: "## Page 1", "Page 2", "pg. 5"
✓ DIVIDERS: "---", "===", "****", Unicode lines
✓ REPEATED HEADERS: "Document Title" appearing on every page
✓ REPEATED FOOTERS: "Author: John", "Department: IT" on every page
✓ METADATA: "Copyright", "Author:", "Version:", footnotes
✓ INLINE PAGE NUMBERS: "Page 42" at end of lines
✓ EXCESS WHITESPACE: Multiple blank lines reduced to max 2

✗ HEADINGS: Markdown headings preserved and normalized
✗ LISTS: List items and formatting preserved
✗ TABLES: Table structure preserved
✗ CODE: Code blocks preserved
✗ MEANINGFUL CONTENT: No semantic content removed


DATA FLOW:

Raw PDF Text
    ↓
[Frequency Analysis] → Detect repeated patterns
    ↓
[Pattern Removal] → Remove noise
    ↓
[Structure Normalization] → Fix heading hierarchy
    ↓
[Whitespace Cleanup] → Remove excess spacing
    ↓
[Validation] → Extract metadata, verify quality
    ↓
Clean Markdown + Metadata
    ↓
[RAG Pipeline] → Chunking → Embedding → Retrieval


QUALITY METRICS:

Use cleaning_ratio to monitor effectiveness:
  - < 20%: Almost no changes (very clean input)
  - 20-40%: Normal (typical PDF extraction)
  - 40-60%: Significant cleaning (common for scanned docs)
  - > 60%: Heavy cleaning (highly structured or noisy)


TROUBLESHOOTING:

Problem: Too much content removed
Solution: Lower the threshold
  ├─ Default: threshold=0.6 (60% of pages)
  ├─ Try: threshold=0.8 (80% - only remove very frequent)
  └─ Result: More conservative cleaning

Problem: Not enough cleaning
Solution: Raise the threshold + enable aggressive
  ├─ Default: threshold=0.6, aggressive=False
  ├─ Try: threshold=0.4, aggressive=True
  └─ Result: More aggressive cleaning

Problem: Can't tell what's happening
Solution: Enable debug mode
  ├─ Use: debug=True
  ├─ Check: logs will show all detected patterns
  └─ Result: Detailed information about cleaning


NEXT STEPS AFTER CLEANING:

1. CHUNKING: Split by headings for semantic chunks
   ```python
   from backend.app.chunker import chunk_by_headings
   chunks = chunk_by_headings(cleaned_text)
   ```

2. EMBEDDING: Convert chunks to vectors
   ```python
   from backend.app.embedder import embed_text
   embeddings = embed_text(chunks)
   ```

3. STORAGE: Store with metadata for retrieval
   ```python
   from backend.app.vector_store import store_embeddings
   store_embeddings(embeddings, metadata, chunks)
   ```

4. RETRIEVAL: Use for RAG queries
   ```python
   results = retrieve_similar(query_embedding, k=5)
   context = format_context(results)
   response = llm.generate(query, context)
   ```
"""


# ============================================================================
# MODULE-LEVEL FUNCTIONS (Convenience wrappers)
# ============================================================================

def clean_markdown_advanced(text: str, aggressive: bool = False, 
                           debug: bool = False) -> Tuple[str, DocumentMetadata]:
    """
    Clean markdown text using advanced header/footer detection.
    
    High-level wrapper for easy usage. Detects and removes headers, footers, 
    and layout artifacts using:
    - Positional heuristics (top 10-15%, bottom 10-15% of pages)
    - Frequency-based detection (>50% of pages)
    - Structural pattern filtering
    - Title preservation (keeps meaningful section headers)
    
    This function is optimized for RAG systems and works generically across
    different document types and formats.
    
    Args:
        text: Raw markdown extracted from PDF/DOCX
        aggressive: Remove more metadata patterns (default: False)
        debug: Print detailed debugging information (default: False)
        
    Returns:
        Tuple of (cleaned_markdown, metadata):
        - cleaned_markdown (str): Clean markdown ready for chunking
        - metadata (DocumentMetadata): Document title, chapters, pages, statistics
        
    Example:
        >>> pdf_text = extract_pdf("document.pdf")
        >>> markdown = convert_to_markdown(pdf_text)
        >>> cleaned, meta = clean_markdown_advanced(markdown)
        >>> print(f"Removed {meta.total_lines_removed} header/footer lines")
        >>> print(f"Document: {meta.title}, Pages: {meta.page_count}")
        >>> # Now ready for chunking
        >>> chunks = chunk_by_headings(cleaned)
    """
    cleaner = MarkdownCleaner(
        aggressive_cleaning=aggressive,
        debug_mode=debug
    )
    return cleaner.clean_markdown_advanced(text)


def clean_markdown(text: str, aggressive: bool = False, 
                  threshold: float = 0.6, debug: bool = False) -> Tuple[str, DocumentMetadata]:
    """
    Clean markdown text using the standard cleaning pipeline.
    
    High-level wrapper for the main cleaning method. Removes noise while 
    preserving semantic content.
    
    Args:
        text: Raw markdown from PDF/DOCX extraction
        aggressive: Remove more patterns (metadata, short lines)
        threshold: Header/footer frequency threshold (0.0-1.0)
                  Higher = keep more (safer), Lower = remove more (riskier)
        debug: Print detailed debugging information
        
    Returns:
        Tuple of (cleaned_markdown, metadata)
        
    Example:
        >>> from markdown_cleaner import clean_markdown
        >>> text, meta = clean_markdown(pdf_markdown)
        >>> print(meta.cleaning_ratio)  # Percentage removed
    """
    cleaner = MarkdownCleaner(
        aggressive_cleaning=aggressive,
        header_frequency_threshold=threshold,
        debug_mode=debug
    )
    return cleaner.clean_markdown(text)


# ============================================================================
# EXAMPLE USAGE AND TESTING
# ============================================================================

if __name__ == "__main__":
    # Configure logging
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
    
    # Sample text from PDF extraction (with typical noise)
    sample_markdown = """
# Bài giảng Hệ quản trị CSDL     1

## Page 1

Bài giảng Hệ quản trị CSDL

### Chương 1: TỔNG QUAN VỀ HỆ QUẢN TRỊ CSDL

#### 1.1. Định nghĩa

- Hệ quản trị cơ sở dữ liệu (Database Management System - DBMS) là một hệ thống phần mềm
- Cho phép người dùng tạo, truy cập, quản lý dữ liệu
- Đảm bảo tính toàn vẹn, bảo mật của dữ liệu

## Page 2

Bài giảng Hệ quản trị CSDL     2

#### 1.2. Chức năng chính

1. Tạo và xóa database
2. Tạo, sửa, xóa bảng dữ liệu
3. Nhập, cập nhật, xóa bản ghi
4. Sao lưu và khôi phục dữ liệu

---

### Chương 2: KIẾN TRÚC HỆ QUẢN TRỊ CSDL

#### 2.1. Ba lớp kiến trúc

| Lớp | Chức năng |
|-----|----------|
| External | Cho phép người dùng | 
| Conceptual | Mô tả logic của dữ liệu |
| Internal | Mô tả cách lưu trữ vật lý |

## Page 3

Bài giảng Hệ quản trị CSDL     3

#### 2.2. Độc lập dữ liệu

- Độc lập vật lý: Không ảnh hưởng từ cách lưu trữ
- Độc lập logic: Không phải sửa ứng dụng khi thay đổi schema

## Page 4

Bài giảng Hệ quản trị CSDL     4

────────────────────────────────────────────

Cuối tài liệu

────────────────────────────────────────────
"""
    
    print("\n" + "="*80)
    print("MARKDOWN CLEANER - DEMONSTRATION")
    print("="*80)
    
    # Test 1: Basic cleaning
    print("\n[TEST 1] Basic Cleaning (Default Settings)")
    print("-" * 80)
    cleaned, metadata = clean_markdown(sample_markdown, debug=False)
    print(f"\n[OK] Output:\n{cleaned}\n")
    print(f"[OK] Metadata:")
    print(f"   Title: {metadata.title}")
    print(f"   Pages: {metadata.page_count}")
    print(f"   Chapters: {metadata.chapters}")
    print(f"   Removed: {metadata.total_lines_removed} lines")
    print(f"   Kept: {metadata.total_lines_kept} lines")
    print(f"   Removal ratio: {metadata.cleaning_ratio:.1f}%")
    
    # Test 3: Advanced cleaning (headers/footers focus)
    print("\n[TEST 3] Advanced Cleaning (Header/Footer Detection)")
    print("-" * 80)
    cleaned_adv, metadata_adv = clean_markdown_advanced(sample_markdown, debug=False)
    print(f"[OK] Output:\n{cleaned_adv}\n")
    print(f"[OK] Metadata:")
    print(f"   Title: {metadata_adv.title}")
    print(f"   Pages: {metadata_adv.page_count}")
    print(f"   Detected repeated headers: {metadata_adv.repeated_headers}")
    print(f"   Detected repeated footers: {metadata_adv.repeated_footers}")
    print(f"   Removed: {metadata_adv.total_lines_removed} lines")
    print(f"   Kept: {metadata_adv.total_lines_kept} lines")
    print(f"   Removal ratio: {metadata_adv.cleaning_ratio:.1f}%")
    
    # Test 4: Extract blocks
    print("\n[TEST 4] Content Block Extraction")
    print("-" * 80)
    cleaner = MarkdownCleaner()
    blocks = cleaner.extract_content_blocks(cleaned_adv)
    print(f"[OK] Extracted {len(blocks)} content blocks:")
    for i, block in enumerate(blocks[:5], 1):  # Show first 5
        print(f"   {i}. [{block.block_type}] {block.content[:60]}")
    if len(blocks) > 5:
        print(f"   ... and {len(blocks) - 5} more blocks")
    
    print("\n" + "="*80)
    print("[OK] CLEANING TESTS COMPLETE")
    print("="*80 + "\n")

