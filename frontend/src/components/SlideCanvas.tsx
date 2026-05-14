/**
 * SlideCanvas — renders a single slide in 16:9 format.
 * Supports 3 layouts: standard | two_column | big_title.
 * Fully controlled: parent manages edit state & slide data.
 */

import type React from "react";
import type { SlideItem } from "../services/api";

export type SlideLayout = "standard" | "two_column" | "big_title";

const LIGHT   = "#ffffff";
const ACCENT  = "#6366f1";
const TEXT    = "#1e293b";
const MUTED   = "#475569";
const BORDER  = "#e2e8f0";

const css = {
  canvas:     { position: "relative" as const, width: "100%", maxWidth: 900, aspectRatio: "16/9", background: LIGHT, borderRadius: 12, overflow: "hidden", boxShadow: "0 8px 32px rgba(0,0,0,0.08)", padding: "28px 44px 28px 56px", boxSizing: "border-box" as const, display: "flex", flexDirection: "column" as const, border: `1px solid ${BORDER}` },
  accentBar:  { position: "absolute" as const, top: 0, left: 0, width: 10, height: "100%", background: ACCENT, borderRadius: "12px 0 0 12px" },
  slideTitle: { fontSize: "clamp(18px, 2.8vw, 32px)", fontWeight: 700, color: TEXT, margin: "0 0 8px", lineHeight: 1.25, cursor: "pointer", display: "flex", alignItems: "center", gap: 8 },
  titleInput: { background: "transparent", border: "none", borderBottom: "2px solid #6366f1", color: TEXT, fontSize: "clamp(18px, 2.8vw, 32px)", fontWeight: 700, width: "100%", outline: "none", fontFamily: "inherit", marginBottom: 8 },
  editPen:    { fontSize: 11, opacity: 0.3, marginLeft: 4, flexShrink: 0, color: MUTED },
  divider:    { height: 3, background: ACCENT, borderRadius: 2, marginBottom: 14, flexShrink: 0 },
  bulletList: { listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column" as const, gap: 8, flex: 1, overflowY: "auto" as const, paddingRight: 4 },
  bulletItem: { fontSize: "clamp(12px, 1.7vw, 17px)", color: MUTED, lineHeight: 1.5, display: "flex", alignItems: "center", gap: 6 },
  bulletMark: { color: ACCENT, fontWeight: 700, flexShrink: 0, fontSize: 14 },
  bulletInput:{ background: "transparent", border: "none", borderBottom: "1.5px solid #6366f1", color: TEXT, fontSize: "inherit", fontFamily: "inherit", flex: 1, outline: "none" },
  delBullet:  { background: "transparent", border: "none", color: MUTED, cursor: "pointer", fontSize: 11, padding: "0 2px", opacity: 0.45, flexShrink: 0 },
  addBullet:  { marginTop: 8, background: "transparent", border: "1px dashed #cbd5e1", color: MUTED, cursor: "pointer", borderRadius: 6, padding: "3px 12px", fontSize: 12, alignSelf: "flex-start" as const },
};

export interface SlideCanvasProps {
  slide: SlideItem;
  slideIndex: number;
  totalSlides: number;
  layout: SlideLayout;
  editTitle: boolean;
  editBullet: number | null;
  onTitleClick: () => void;
  onTitleChange: (val: string) => void;
  onTitleBlur: () => void;
  onBulletClick: (i: number) => void;
  onBulletChange: (i: number, val: string) => void;
  onBulletBlur: () => void;
  onDeleteBullet: (i: number) => void;
  onAddBullet: () => void;
}

function slideTypeLabel(idx: number, total: number): "TITLE" | "SUMMARY" | "CONTENT" {
  if (idx === 0) return "TITLE";
  if (idx === total - 1 && total > 2) return "SUMMARY";
  return "CONTENT";
}

function getTrimWarning(slide: SlideItem): string | null {
  if (slide.bullet_points.length > 6) return "Vi phạm 6x6 (> 6 dòng)";
  // Tiếng Việt thường cần nhiều từ ghép nên giới hạn 8 từ/dòng thay vì 6
  if (slide.bullet_points.some(b => b.trim().split(/\s+/).length > 8)) return "Vi phạm 6x6 (Dòng quá dài)";
  if (slide.title.trim().split(/\s+/).length > 14) return "Tiêu đề quá dài";
  return null;
}

function TypeBadge({ idx, total }: { idx: number; total: number }) {
  const type = slideTypeLabel(idx, total);
  const color = type === "TITLE" ? "#818cf8" : type === "SUMMARY" ? "#4ade80" : "#38bdf8";
  return <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", color }}>{type}</span>;
}

function TitleField({ slide, editTitle, onTitleClick, onTitleChange, onTitleBlur, style = {} }: {
  slide: SlideItem; editTitle: boolean;
  onTitleClick: () => void; onTitleChange: (v: string) => void; onTitleBlur: () => void;
  style?: React.CSSProperties;
}) {
  return editTitle ? (
    <input autoFocus value={slide.title}
      onChange={e => onTitleChange(e.target.value)}
      onBlur={onTitleBlur}
      onKeyDown={e => e.key === "Enter" && onTitleBlur()}
      style={{ ...css.titleInput, ...style }} />
  ) : (
    <h2 style={{ ...css.slideTitle, ...style }} onClick={onTitleClick}>
      {slide.title}<span style={css.editPen}>✎</span>
    </h2>
  );
}

function BulletList({ slide, editBullet, onBulletClick, onBulletChange, onBulletBlur, onDeleteBullet, onAddBullet, slice }: {
  slide: SlideItem; editBullet: number | null;
  onBulletClick: (i: number) => void; onBulletChange: (i: number, v: string) => void;
  onBulletBlur: () => void; onDeleteBullet: (i: number) => void; onAddBullet: () => void;
  slice?: [number, number];
}) {
  const bullets = slice ? slide.bullet_points.slice(...slice) : slide.bullet_points;
  const offset  = slice ? slice[0] : 0;
  return (
    <>
      <ul style={css.bulletList}>
        {bullets.map((bp, i) => {
          const realIdx = offset + i;
          return (
            <li key={realIdx} style={css.bulletItem}>
              <span style={css.bulletMark}>▸</span>
              {editBullet === realIdx ? (
                <input autoFocus value={bp}
                  onChange={e => onBulletChange(realIdx, e.target.value)}
                  onBlur={onBulletBlur}
                  onKeyDown={e => e.key === "Enter" && onBulletBlur()}
                  style={css.bulletInput} />
              ) : (
                <span style={{ cursor: "pointer", flex: 1 }} onClick={() => onBulletClick(realIdx)}>
                  {bp || <em style={{ opacity: 0.35 }}>(trống — nhấp để nhập)</em>}
                  <span style={css.editPen}>✎</span>
                </span>
              )}
              <button style={css.delBullet} onClick={() => onDeleteBullet(realIdx)}>✕</button>
            </li>
          );
        })}
      </ul>
      {!slice && slide.bullet_points.length < 6 && (
        <button style={css.addBullet} onClick={onAddBullet}>+ Thêm dòng</button>
      )}
    </>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export function SlideCanvas({
  slide, slideIndex, totalSlides, layout,
  editTitle, editBullet,
  onTitleClick, onTitleChange, onTitleBlur,
  onBulletClick, onBulletChange, onBulletBlur,
  onDeleteBullet, onAddBullet,
}: SlideCanvasProps) {
  const warningMsg = getTrimWarning(slide);
  const half = Math.ceil(slide.bullet_points.length / 2);

  const BadgeRow = () => (
    <div style={{ position: "absolute", top: 12, right: 18, display: "flex", gap: 6, alignItems: "center" }}>
      {warningMsg && (
        <span 
          style={{ fontSize: 11, background: "#f59e0b", color: "#fff", borderRadius: 4, padding: "2px 7px", fontWeight: 600, cursor: "help" }}
          title="Nội dung quá dài vi phạm quy tắc thiết kế 6x6. Hãy chia nhỏ hoặc rút gọn câu chữ để học sinh dễ tập trung."
        >
          ⚠ {warningMsg}
        </span>
      )}
      <TypeBadge idx={slideIndex} total={totalSlides} />
      <span style={{ fontSize: 11, color: MUTED }}>{slideIndex + 1} / {totalSlides}</span>
    </div>
  );

  if (layout === "big_title") {
    return (
      <div style={{ ...css.canvas, justifyContent: "center", alignItems: "center", textAlign: "center", gap: 0 }}>
        <div style={css.accentBar} />
        <BadgeRow />
        <TitleField slide={slide} editTitle={editTitle} onTitleClick={onTitleClick} onTitleChange={onTitleChange} onTitleBlur={onTitleBlur}
          style={{ fontSize: "clamp(24px,4vw,48px)", textAlign: "center", justifyContent: "center" }} />
        <p style={{ color: MUTED, fontSize: 14, marginTop: 12 }}>Bố cục này tập trung vào tiêu đề chính lớn giữa trang.</p>
      </div>
    );
  }

  if (layout === "two_column") {
    return (
      <div style={{ ...css.canvas, flexDirection: "row", gap: 0, padding: "28px 10px 28px 60px" }}>
        <div style={css.accentBar} />
        <div style={{ position: "absolute", top: 12, right: 18, display: "flex", gap: 6, alignItems: "center" }}>
          <TypeBadge idx={slideIndex} total={totalSlides} />
          <span style={{ fontSize: 11, color: "#475569" }}>{slideIndex + 1} / {totalSlides}</span>
        </div>
        {/* Left column */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", paddingRight: 16 }}>
          <TitleField slide={slide} editTitle={editTitle} onTitleClick={onTitleClick} onTitleChange={onTitleChange} onTitleBlur={onTitleBlur}
            style={{ fontSize: "clamp(14px,2vw,22px)" }} />
          <div style={{ height: 2, background: ACCENT, borderRadius: 2, marginBottom: 10 }} />
          <BulletList slide={slide} editBullet={editBullet} onBulletClick={onBulletClick} onBulletChange={onBulletChange} onBulletBlur={onBulletBlur} onDeleteBullet={onDeleteBullet} onAddBullet={onAddBullet} slice={[0, half]} />
        </div>
        <div style={{ width: 1, background: BORDER, alignSelf: "stretch", margin: "0 8px" }} />
        {/* Right column */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", paddingLeft: 16, justifyContent: "center" }}>
          <BulletList slide={slide} editBullet={editBullet} onBulletClick={onBulletClick} onBulletChange={onBulletChange} onBulletBlur={onBulletBlur} onDeleteBullet={onDeleteBullet} onAddBullet={onAddBullet} slice={[half, slide.bullet_points.length]} />
        </div>
      </div>
    );
  }

  // Standard
  return (
    <div style={css.canvas}>
      <div style={css.accentBar} />
      <BadgeRow />
      <TitleField slide={slide} editTitle={editTitle} onTitleClick={onTitleClick} onTitleChange={onTitleChange} onTitleBlur={onTitleBlur} />
      <div style={css.divider} />
      <BulletList slide={slide} editBullet={editBullet} onBulletClick={onBulletClick} onBulletChange={onBulletChange} onBulletBlur={onBulletBlur} onDeleteBullet={onDeleteBullet} onAddBullet={onAddBullet} />
    </div>
  );
}
