"""Slide rendering services — PPTX and PDF.

Extracted from routes/slides.py to follow Single Responsibility Principle.
Each renderer is a stateless class with a single `generate(items, title) -> bytes` method.
"""

from __future__ import annotations

import io
import logging
from typing import TYPE_CHECKING, List

logger = logging.getLogger(__name__)

# ── python-pptx ───────────────────────────────────────────────────────────────

PPTX_OK = False
PPTX_ERROR: str = ""

try:
    from pptx import Presentation as _Presentation          # type: ignore
    from pptx.util import Inches as _Inches, Pt as _Pt      # type: ignore
    from pptx.dml.color import RGBColor as _RGBColor        # type: ignore
    _test = _Presentation()
    _buf  = io.BytesIO()
    _test.save(_buf)
    if _buf.tell() > 0:
        PPTX_OK = True
    del _test, _buf
except Exception as _e:
    PPTX_ERROR = str(_e)
    logger.warning("python-pptx unavailable: %s", _e)


# ── reportlab ────────────────────────────────────────────────────────────────

PDF_OK = False
PDF_ERROR: str = ""

try:
    from reportlab.lib.pagesizes import landscape, A4  # type: ignore
    from reportlab.lib.colors import HexColor           # type: ignore
    from reportlab.pdfgen.canvas import Canvas as _Canvas  # type: ignore
    PDF_OK = True
except Exception as _pe:
    PDF_ERROR = str(_pe)
    logger.warning("reportlab unavailable: %s", _pe)


# ── SlideItem protocol (avoid circular import) ────────────────────────────────

if TYPE_CHECKING:
    from ..routes.slides import SlideItem


# ── Shared file-download helper ───────────────────────────────────────────────

def make_download_headers(title: str, extension: str, slide_count: int) -> dict:
    """Build RFC 5987-compliant Content-Disposition headers (no latin-1 issues)."""
    import re
    from urllib.parse import quote
    safe    = re.sub(r"[^a-zA-Z0-9\s_-]", "", title).strip().replace(" ", "_") or "bai_giang"
    encoded = quote(title.strip() or "bai_giang") + f".{extension}"
    return {
        "Content-Disposition": f'attachment; filename="{safe}.{extension}"; filename*=UTF-8\'\'{encoded}',
        "X-Slide-Count": str(slide_count),
    }


# ── PPTX Renderer ─────────────────────────────────────────────────────────────

class PptxRenderer:
    """Generates .pptx bytes from a list of SlideItem objects."""

    C_BG     = (15,  23,  42)
    C_WHITE  = (241, 245, 249)
    C_BULLET = (148, 163, 184)
    C_ACCENT = (99,  102, 241)
    C_DIM    = (71,  85,  105)

    def _rgb(self, t: tuple) -> "_RGBColor":  # type: ignore[name-defined]
        return _RGBColor(t[0], t[1], t[2])

    def _add_rect(self, slide, left, top, width, height, color: tuple) -> None:
        try:
            shape = slide.shapes.add_shape(1, left, top, width, height)
            shape.fill.solid()
            shape.fill.fore_color.rgb = self._rgb(color)
            shape.line.fill.background()
        except Exception as exc:
            logger.debug("add_shape: %s", exc)

    def _add_text(
        self, slide, left, top, width, height,
        text: str, size: int, bold: bool, color: tuple, wrap: bool = True,
        font_name: str = "Arial"
    ) -> None:
        try:
            box = slide.shapes.add_textbox(left, top, width, height)
            tf  = box.text_frame
            tf.word_wrap = wrap
            para = tf.paragraphs[0] if tf.paragraphs else tf.add_paragraph()
            run  = para.add_run()
            run.text           = str(text or "")
            run.font.name      = font_name
            run.font.size      = _Pt(size)
            run.font.bold      = bold
            run.font.color.rgb = self._rgb(color)
        except Exception as exc:
            logger.debug("add_text: %s", exc)

    def _add_bullets(self, slide, left, top, width, height, bullets: List[str]) -> None:
        try:
            box = slide.shapes.add_textbox(left, top, width, height)
            tf  = box.text_frame
            tf.word_wrap = True
            for i, bullet in enumerate(bullets):
                para = tf.paragraphs[0] if (i == 0 and tf.paragraphs) else tf.add_paragraph()
                para.space_before = _Pt(8)
                run  = para.add_run()
                run.text           = f"\u25b8  {str(bullet or '')}"
                run.font.name      = "Calibri"
                run.font.size      = _Pt(24) # Content font size (18-24pt)
                run.font.bold      = False
                run.font.color.rgb = self._rgb(self.C_BULLET)
        except Exception as exc:
            logger.debug("add_bullets: %s", exc)

    def generate(self, items: list, deck_title: str = "Bài giảng") -> bytes:
        if not PPTX_OK:
            raise RuntimeError(f"python-pptx init failed: {PPTX_ERROR}")

        prs = _Presentation()
        prs.slide_width  = _Inches(13.33)
        prs.slide_height = _Inches(7.5)
        blank = prs.slide_layouts[6]
        total = len(items)

        for idx, item in enumerate(items):
            try:
                slide = prs.slides.add_slide(blank)
                try:
                    bg = slide.background.fill
                    bg.solid()
                    bg.fore_color.rgb = self._rgb(self.C_BG)
                except Exception:
                    pass

                self._add_rect(slide, _Inches(0), _Inches(0), _Inches(0.12), _Inches(7.5), self.C_ACCENT)
                self._add_text(slide, _Inches(0.3), _Inches(0.2), _Inches(12.7), _Inches(1.3), item.title, 40, True, self.C_WHITE, font_name="Arial") # Title font size 40pt
                self._add_rect(slide, _Inches(0.3), _Inches(1.6), _Inches(12.7), _Inches(0.045), self.C_ACCENT)
                self._add_bullets(slide, _Inches(0.45), _Inches(1.75), _Inches(12.4), _Inches(5.3), item.bullet_points)
                self._add_text(slide, _Inches(11.5), _Inches(7.1), _Inches(1.7), _Inches(0.35), f"{idx+1}/{total}", 11, False, self.C_DIM, wrap=False)

                if item.speaker_notes:
                    try:
                        slide.notes_slide.notes_text_frame.text = str(item.speaker_notes)
                    except Exception:
                        pass
            except Exception as exc:
                logger.error("Slide %d build error: %s", idx, exc)

        buf = io.BytesIO()
        prs.save(buf)
        return buf.getvalue()


# ── PDF Renderer ──────────────────────────────────────────────────────────────

class PdfRenderer:
    """Generates .pdf bytes (landscape A4) from a list of SlideItem objects."""

    PAGE_W, PAGE_H = (landscape(A4) if PDF_OK else (842, 595))
    BG     = HexColor("#0f172a") if PDF_OK else None
    ACCENT = HexColor("#6366f1") if PDF_OK else None
    WHITE  = HexColor("#f1f5f9") if PDF_OK else None
    BULLET = HexColor("#94a3b8") if PDF_OK else None
    DIM    = HexColor("#475569") if PDF_OK else None

    def _type_color(self, idx: int, total: int):
        if idx == 0:              return HexColor("#818cf8")
        if idx == total - 1 > 1: return HexColor("#4ade80")
        return HexColor("#38bdf8")

    def _type_label(self, idx: int, total: int) -> str:
        if idx == 0:              return "TITLE"
        if idx == total - 1 > 1: return "SUMMARY"
        return "CONTENT"

    def generate(self, items: list, deck_title: str = "Bài giảng") -> bytes:
        if not PDF_OK:
            raise RuntimeError(f"reportlab not available: {PDF_ERROR}")

        buf   = io.BytesIO()
        W, H  = self.PAGE_W, self.PAGE_H
        c     = _Canvas(buf, pagesize=(W, H))
        total = len(items)

        for idx, item in enumerate(items):
            try:
                c.setFillColor(self.BG)
                c.rect(0, 0, W, H, fill=1, stroke=0)

                c.setFillColor(self.ACCENT)
                c.rect(0, 0, 10, H, fill=1, stroke=0)

                c.setFillColor(self._type_color(idx, total))
                c.setFont("Helvetica-Bold", 8)
                c.drawRightString(W - 16, H - 20, f"{self._type_label(idx, total)}  {idx+1}/{total}")

                c.setFillColor(self.WHITE)
                c.setFont("Helvetica-Bold", 32)
                c.drawString(26, H - 68, str(item.title or "")[:100])

                c.setStrokeColor(self.ACCENT)
                c.setLineWidth(2.5)
                c.line(26, H - 82, W - 26, H - 82)

                c.setFont("Helvetica", 18)
                y = H - 106
                for bullet in item.bullet_points[:6]:
                    if y < 60:
                        break
                    c.setFillColor(self.ACCENT)
                    c.drawString(26, y, "▸")
                    c.setFillColor(self.BULLET)
                    c.drawString(42, y, str(bullet or "")[:120])
                    y -= 34

                c.setFillColor(self.DIM)
                c.setFont("Helvetica", 9)
                c.drawCentredString(W / 2, 16, deck_title[:60])

            except Exception as ex:
                logger.debug("PDF slide %d: %s", idx, ex)

            c.showPage()

        c.save()
        return buf.getvalue()


# ── Singleton instances (module-level) ────────────────────────────────────────

pptx_renderer = PptxRenderer()
pdf_renderer  = PdfRenderer()
