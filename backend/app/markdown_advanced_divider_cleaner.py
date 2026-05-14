#!/usr/bin/env python3
"""
Enhanced Markdown Cleaner with Divider-Based Page Structure and Table Extraction

Handles PDF pages with structure:
┌──────────────────┐
│ Header + Divider │ (Remove)
├──────────────────┤
│ Content (Keep)   │ (Between dividers)
├──────────────────┤
│ Footer (Remove)  │ (After divider)
└──────────────────┘
"""

import re
from typing import List, Tuple, Dict, Optional
from dataclasses import dataclass

from .markdown_cleaner import clean_markdown_advanced

@dataclass
class PageContent:
    """Content extracted from between dividers"""
    header: Optional[str]
    content: str
    footer: Optional[str]

@dataclass
class TableData:
    """Extracted table structure"""
    headers: List[str]
    rows: List[List[str]]
    
    def to_markdown(self) -> str:
        """Convert to markdown table format"""
        if not self.headers or not self.rows:
            return ""
        
        # Header row
        md = "| " + " | ".join(self.headers) + " |\n"
        # Divider
        md += "|" + "|".join(["---" for _ in self.headers]) + "|\n"
        # Data rows
        for row in self.rows:
            # Pad row if needed
            row_data = row + [""] * (len(self.headers) - len(row))
            md += "| " + " | ".join(row_data[:len(self.headers)]) + " |\n"
        
        return md


class AdvancedMarkdownCleaner:
    """Enhanced cleaner for divider-based PDF structure"""
    
    def __init__(self):
        # Divider patterns (more comprehensive) - includes em-dashes, en-dashes, and Unicode line chars
        # Also include standard repeated hyphens and less strict matching
        self.divider_pattern = re.compile(
            r'^[\s]*([-_═─━—–┄┅┆┇┈┉┊┋▬▭▮▯]){3,}[\s]*$|^-{3,}\s*$|^_{3,}\s*$|^={3,}\s*$',
            re.MULTILINE
        )
        
        # Table pattern: lines with pipes
        self.table_row_pattern = re.compile(r'^\s*\|.*\|\s*$')
        
        # Header pattern: short lines with page number
        self.header_pattern = re.compile(
            r'^[^\n]{5,80}\s+\d+\s*$'
        )

    def split_by_dividers(self, text: str) -> List[str]:
        """Split text by divider lines to extract page content"""
        # Split by divider
        parts = self.divider_pattern.split(text)
        
        # Group into pages (header, content, footer)
        pages = []
        i = 0
        while i < len(parts):
            if i + 1 < len(parts):
                # Between dividers is content
                pages.append(parts[i + 1])
                i += 2
            else:
                break
        
        return pages

    def extract_page_content(self, text: str) -> List[PageContent]:
        """
        Extract header/content/footer from page structure.
        
        Expected per page:
        [Header]
        -------  (divider)
        [Content]
        -------  (divider)
        [Footer]
        -------  (divider, if more pages)
        """
        import logging
        logger = logging.getLogger(__name__)
        
        lines = text.split('\n')
        pages = []
        sections = []  # Will hold: [header, content, footer, header, content, footer, ...]
        current_section = []
        
        # Find all divider lines for debugging
        divider_lines = []
        for i, line in enumerate(lines):
            if self.divider_pattern.match(line):
                divider_lines.append((i, line[:50]))  # Store line number and content sample
        
        logger.info(f"Found {len(divider_lines)} divider lines in text with {len(lines)} total lines")
        
        for line in lines:
            if self.divider_pattern.match(line):
                # End current section and start next
                if current_section:
                    section_text = '\n'.join(current_section).strip()
                    sections.append(section_text)
                    current_section = []
            else:
                current_section.append(line)
        
        # Add last section if any
        if current_section:
            section_text = '\n'.join(current_section).strip()
            sections.append(section_text)
        
        logger.info(f"Extracted {len(sections)} sections after divider split")
        
        # Group sections into pages: [header, content, footer, header, content, footer, ...]
        i = 0
        while i < len(sections):
            if i + 2 < len(sections):
                # Full page: header, content, footer
                header = sections[i] if sections[i] else None
                content = sections[i + 1] if sections[i + 1] else None
                footer = sections[i + 2] if sections[i + 2] else None
                
                if content:  # Only add if we have content
                    pages.append(PageContent(
                        header=header,
                        content=content,
                        footer=footer
                    ))
                i += 3
                
            elif i + 1 < len(sections):
                # Partial page at end: treat as [header, content] or [content, footer]
                # Check if first section looks like header (short, has page number)
                potential_header = sections[i]
                potential_content = sections[i + 1]
                
                # If first section is short and has page pattern, it's [header, content]
                # Otherwise it's [content, footer] - use content
                if len(potential_header) < 100 and self.header_pattern.match(potential_header):
                    pages.append(PageContent(
                        header=potential_header,
                        content=potential_content,
                        footer=None
                    ))
                else:
                    # First section is content, second is footer
                    pages.append(PageContent(
                        header=None,
                        content=potential_header,
                        footer=potential_content
                    ))
                i += 2
                
            else:
                # Single orphan section - treat as content
                if sections[i]:
                    pages.append(PageContent(
                        header=None,
                        content=sections[i],
                        footer=None
                    ))
                i += 1
        
        logger.info(f"Extracted {len(pages)} pages from {len(sections)} sections")
        return pages

    def extract_tables(self, text: str) -> List[TableData]:
        """Extract markdown tables from text"""
        lines = text.split('\n')
        tables = []
        i = 0
        
        while i < len(lines):
            line = lines[i]
            
            # Check if line looks like table header
            if self.table_row_pattern.match(line):
                # This might be a table
                table_lines = [line]
                i += 1
                
                # Collect header
                if i < len(lines) and self.table_row_pattern.match(lines[i]):
                    # Check if next line is divider
                    next_line = lines[i]
                    cells = [cell.strip() for cell in next_line.split('|') if cell.strip()]
                    
                    # Check if all cells are dashes (divider row)
                    if all(re.match(r'^-+$', cell) for cell in cells):
                        table_lines.append(next_line)
                        i += 1
                        
                        # Collect data rows
                        data_rows = []
                        while i < len(lines):
                            data_line = lines[i]
                            if self.table_row_pattern.match(data_line):
                                data_rows.append(data_line)
                                i += 1
                            else:
                                break
                        
                        # Parse table
                        if data_rows:
                            # Extract headers from first line
                            header_line = table_lines[0]
                            headers = [h.strip() for h in header_line.split('|')[1:-1]]
                            
                            # Extract rows
                            rows = []
                            for row_line in data_rows:
                                row = [cell.strip() for cell in row_line.split('|')[1:-1]]
                                rows.append(row)
                            
                            table = TableData(headers=headers, rows=rows)
                            tables.append(table)
                        continue
            
            i += 1
        
        return tables

    def clean_markdown_divider_based(self, text: str) -> Tuple[str, List[PageContent]]:
        """
        Clean markdown using divider-based page structure
        
        Returns:
            Tuple of (cleaned_text, page_contents)
        """
        import logging
        logger = logging.getLogger(__name__)
        
        # Extract page structure
        pages = self.extract_page_content(text)
        
        logger.info(f"clean_markdown_divider_based: Processing {len(pages)} pages")
        
        # Extract only content from between dividers
        content_lines = []
        for i, page in enumerate(pages):
            content = page.content.strip() if page.content else ""
            if content:
                content_lines.append(content)
                logger.debug(f"Page {i+1}: {len(content)} chars")
        
        # Join content
        if content_lines:
            cleaned_text = '\n\n'.join(content_lines)
            # Cleanup excessive whitespace
            cleaned_text = re.sub(r'\n\n+', '\n\n', cleaned_text)
            logger.info(f"Cleaned output: {len(cleaned_text)} chars from {len(content_lines)} pages")

            # Second pass: remove any residual repeated headers/footers.
            # This protects against imperfect divider extraction in real PDFs.
            refined_text, _ = clean_markdown_advanced(cleaned_text, debug=False)
            if refined_text and len(refined_text.strip()) > 0:
                cleaned_text = refined_text
                logger.info(f"Advanced refinement output: {len(cleaned_text)} chars")

            cleaned_text = self._remove_repeated_boilerplate(cleaned_text)
        else:
            # Fallback: if no pages found, use advanced cleaner on original text
            logger.warning(f"No pages extracted! Falling back to basic cleaning. Input: {len(text)} chars")
            cleaned_text, _ = clean_markdown_advanced(text, debug=False)
            cleaned_text = re.sub(r'\n\n+', '\n\n', cleaned_text.strip())
            cleaned_text = self._remove_repeated_boilerplate(cleaned_text)
            logger.info(f"Fallback (advanced) cleaned output: {len(cleaned_text)} chars")
        
        return cleaned_text, pages

    def _remove_repeated_boilerplate(self, text: str) -> str:
        """Remove repeated short boilerplate lines that often appear as headers/footers."""
        lines = text.split('\n')
        normalized = [re.sub(r'\s+', ' ', ln).strip() for ln in lines]

        freq: Dict[str, int] = {}
        for ln in normalized:
            if ln:
                freq[ln] = freq.get(ln, 0) + 1

        marker_pattern = re.compile(
            r'(bài giảng|giao vien bien soan|giáo viên biên soạn|trang\s*\d+|page\s*\d+)',
            re.IGNORECASE,
        )

        output_lines: List[str] = []
        for original, norm in zip(lines, normalized):
            if not norm:
                output_lines.append(original)
                continue

            # Preserve explicit markdown page markers for downstream metadata chunking.
            lowered = norm.lower()
            if lowered.startswith("## page ") or lowered.startswith("## trang "):
                output_lines.append(original)
                continue

            is_short = len(norm) <= 120
            repeated = freq.get(norm, 0) >= 2
            has_marker = bool(marker_pattern.search(norm))

            if is_short and (repeated or has_marker):
                continue

            output_lines.append(original)

        cleaned = '\n'.join(output_lines)
        cleaned = re.sub(r'\n{3,}', '\n\n', cleaned).strip()
        return cleaned

    def extract_all_tables(self, text: str) -> List[TableData]:
        """Extract all tables from markdown text"""
        return self.extract_tables(text)

    def format_extracted_data_as_table(self, data: List[Dict], 
                                     headers: Optional[List[str]] = None) -> str:
        """Format list of dicts as markdown table"""
        if not data:
            return ""
        
        # Auto-detect headers from first dict
        if headers is None:
            headers = list(data[0].keys())
        
        # Build table
        md = "| " + " | ".join(headers) + " |\n"
        md += "|" + "|".join(["---" for _ in headers]) + "|\n"
        
        for row in data:
            values = [str(row.get(h, "")).strip() for h in headers]
            md += "| " + " | ".join(values) + " |\n"
        
        return md


def demo():
    """Demonstrate the cleaner"""
    
    # Example with divider-based structure
    sample_text = """
Bài giảng Hệ quản trị CSDL    1
———————————————————————————————————

Chương 1: TỔNG QUAN VỀ HỆ QUẢN TRỊ CSDL

Định nghĩa: DBMS là hệ thống quản lý cơ sở dữ liệu

Tính năng chính:
- Lưu trữ dữ liệu
- Truy vấn dữ liệu  
- Cập nhật dữ liệu

———————————————————————————————————
Trang 1
———————————————————————————————————

Bài giảng Hệ quản trị CSDL    2
———————————————————————————————————

| STT | Họ và tên         | Công việc  |
|-----|-------------------|-----------|
| 1   | Nguyễn Trường Vũ | Frontend  |
| 2   | Trần Dinh Hiển   | Backend   |

———————————————————————————————————
Trang 2
———————————————————————————————————
"""

    cleaner = AdvancedMarkdownCleaner()
    
    print("=" * 80)
    print("DIVIDER-BASED PAGE STRUCTURE CLEANER")
    print("=" * 80)
    
    # Test 1: Extract content between dividers
    print("\n[TEST 1] Extract content using divider structure")
    print("-" * 80)
    cleaned, pages = cleaner.clean_markdown_divider_based(sample_text)
    print("Extracted pages:")
    for i, page in enumerate(pages, 1):
        print(f"\nPage {i}:")
        print(f"  Header: {page.header[:50] if page.header else 'None'}...")
        print(f"  Content lines: {len(page.content.split(chr(10)))}")
        print(f"  Footer: {page.footer[:50] if page.footer else 'None'}...")
    
    print("\nCleaned output:")
    print(cleaned)
    
    # Test 2: Extract tables
    print("\n[TEST 2] Extract and parse tables")
    print("-" * 80)
    tables = cleaner.extract_all_tables(cleaned)
    print(f"Found {len(tables)} table(s)")
    
    for i, table in enumerate(tables, 1):
        print(f"\nTable {i}:")
        print(f"  Headers: {table.headers}")
        print(f"  Rows: {len(table.rows)}")
        print(f"  Markdown output:\n{table.to_markdown()}")
    
    # Test 3: Format dict data as table
    print("\n[TEST 3] Format dict data as markdown table")
    print("-" * 80)
    team_data = [
        {"STT": "1", "Họ và tên": "Nguyễn Trường Vũ", "Công việc": "Frontend"},
        {"STT": "2", "Họ và tên": "Trần Dinh Hiển", "Công việc": "Backend"},
        {"STT": "3", "Họ và tên": "Phan Thị Hương", "Công việc": "Data Science"},
    ]
    
    table_md = cleaner.format_extracted_data_as_table(
        team_data,
        headers=["STT", "Họ và tên", "Công việc"]
    )
    print("Formatted table:\n")
    print(table_md)
    
    print("\n" + "=" * 80)
    print("ALL TESTS COMPLETED")
    print("=" * 80)


if __name__ == "__main__":
    demo()
