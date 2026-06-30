/**
 * SlideCanvas — renders a single slide in 16:9 format.
 * Supports 3 layouts: standard | two_column | big_title.
 * Fully controlled: parent manages edit state & slide data.
 */

import React, { useState } from "react";
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
  onUpdateDiagram?: (diagram: SlideItem["diagram"]) => void;
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
  onUpdateDiagram,
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
        <div style={{ flex: 1, display: "flex", flexDirection: "column", paddingLeft: 16, justifyContent: "center", position: "relative" }}>
          {slide.diagram && slide.diagram.nodes && slide.diagram.nodes.length > 0 ? (
            <SlideDiagramVisualizer diagram={slide.diagram} caption={slide.visual_prompt} onUpdateDiagram={onUpdateDiagram} />
          ) : (
            <BulletList slide={slide} editBullet={editBullet} onBulletClick={onBulletClick} onBulletChange={onBulletChange} onBulletBlur={onBulletBlur} onDeleteBullet={onDeleteBullet} onAddBullet={onAddBullet} slice={[half, slide.bullet_points.length]} />
          )}
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

interface SlideDiagramVisualizerProps {
  diagram: {
    nodes: { id: string; label: string; x?: number; y?: number }[];
    links: { source: string; target: string; label?: string }[];
  };
  caption?: string;
  onUpdateDiagram?: (diagram: SlideItem["diagram"]) => void;
}

export function SlideDiagramVisualizer({ diagram, caption, onUpdateDiagram }: SlideDiagramVisualizerProps) {
  const nodes = diagram.nodes || [];
  const links = diagram.links || [];
  const N = nodes.length;

  if (N === 0) return null;

  const width = 360;
  const height = 240;
  const cx = width / 2;
  const cy = height / 2;

  // Local state for dragging coordinates to ensure smooth rendering at 60fps
  const [draggedPositions, setDraggedPositions] = useState<Record<string, { x: number; y: number }>>({});

  // States for inline editing of nodes and link labels
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [editingLinkIdx, setEditingLinkIdx] = useState<number | null>(null);
  const [editingText, setEditingText] = useState("");

  const handleNodeDoubleClick = (nodeId: string, currentLabel: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingNodeId(nodeId);
    setEditingLinkIdx(null);
    setEditingText(currentLabel);
  };

  const handleLinkDoubleClick = (linkIdx: number, currentLabel: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingLinkIdx(linkIdx);
    setEditingNodeId(null);
    setEditingText(currentLabel || "");
  };

  // 1. Calculate default circular/linear layout positions
  const basePositions: Record<string, { x: number; y: number }> = {};
  if (N === 1) {
    basePositions[nodes[0].id] = { x: cx, y: cy };
  } else if (N === 2) {
    basePositions[nodes[0].id] = { x: cx - 80, y: cy };
    basePositions[nodes[1].id] = { x: cx + 80, y: cy };
  } else if (N === 3) {
    const isChain = links.length === 2 && 
      ((links[0].source === nodes[0].id && links[0].target === nodes[1].id && links[1].source === nodes[1].id && links[1].target === nodes[2].id) ||
       (links[0].source === nodes[0].id && links[0].target === nodes[1].id && links[1].source === nodes[2].id && links[1].target === nodes[1].id));
    if (isChain) {
      basePositions[nodes[0].id] = { x: cx - 100, y: cy };
      basePositions[nodes[1].id] = { x: cx, y: cy };
      basePositions[nodes[2].id] = { x: cx + 100, y: cy };
    } else {
      const rx = 90;
      const ry = 60;
      nodes.forEach((node, idx) => {
        const angle = (idx * 2 * Math.PI) / N - Math.PI / 2;
        basePositions[node.id] = {
          x: cx + rx * Math.cos(angle),
          y: cy + ry * Math.sin(angle)
        };
      });
    }
  } else {
    const rx = 100;
    const ry = 65;
    nodes.forEach((node, idx) => {
      const angle = (idx * 2 * Math.PI) / N - Math.PI / 2;
      basePositions[node.id] = {
        x: cx + rx * Math.cos(angle),
        y: cy + ry * Math.sin(angle)
      };
    });
  }

  // 2. Combine base positions with saved custom coordinates and active dragged coordinates
  const positions: Record<string, { x: number; y: number }> = {};
  nodes.forEach(node => {
    if (draggedPositions[node.id]) {
      positions[node.id] = draggedPositions[node.id];
    } else if (node.x !== undefined && node.x !== null && node.y !== undefined && node.y !== null) {
      positions[node.id] = { x: node.x, y: node.y };
    } else {
      positions[node.id] = basePositions[node.id];
    }
  });

  // Handler for mouse down (starts drag)
  const handleMouseDown = (nodeId: string, e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const initialPos = positions[nodeId];

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      
      // Bound the coordinates inside the 360x240 svg viewbox (keeping nodes inside diagram canvas)
      const newX = Math.max(55, Math.min(width - 55, initialPos.x + dx));
      const newY = Math.max(22, Math.min(height - 22, initialPos.y + dy));

      setDraggedPositions(prev => ({
        ...prev,
        [nodeId]: { x: newX, y: newY }
      }));
    };

    const handleMouseUp = () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);

      // Persist the coordinate in the global slide state
      const finalPos = draggedPositions[nodeId] || positions[nodeId];
      if (onUpdateDiagram) {
        const updatedNodes = nodes.map(n => {
          if (n.id === nodeId) {
            return { ...n, x: finalPos.x, y: finalPos.y };
          }
          // Maintain coordinates of other nodes that already have custom positions
          const otherPos = positions[n.id];
          return { 
            ...n, 
            x: otherPos.x !== undefined ? otherPos.x : basePositions[n.id].x, 
            y: otherPos.y !== undefined ? otherPos.y : basePositions[n.id].y 
          };
        });
        onUpdateDiagram({
          ...diagram,
          nodes: updatedNodes
        });
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  const nodeW = 105;
  const nodeH = 38;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%" }}>
      <div style={{ position: "relative", width: "100%", height: height, background: "#f8fafc", borderRadius: 8, border: "1px solid #e2e8f0", overflow: "hidden" }}>
        <svg style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
          <defs>
            <marker
              id="arrowhead"
              markerWidth="8"
              markerHeight="6"
              refX="5"
              refY="3"
              orient="auto"
            >
              <polygon points="0 0, 8 3, 0 6" fill="#6366f1" />
            </marker>
          </defs>

          {links.map((link, idx) => {
            const from = positions[link.source];
            const to = positions[link.target];
            if (!from || !to) return null;

            const dx = to.x - from.x;
            const dy = to.y - from.y;
            const len = Math.sqrt(dx * dx + dy * dy);

            if (len < 30) return null;

            const ux = dx / len;
            const uy = dy / len;

            // Dynamic padding based on node dimensions and angle to prevent line crossing and overlaps
            const w = nodeW / 2;
            const h = nodeH / 2;
            const margin = 6;

            const getPadding = (xUnit: number, yUnit: number) => {
              const px = xUnit !== 0 ? w / Math.abs(xUnit) : Infinity;
              const py = yUnit !== 0 ? h / Math.abs(yUnit) : Infinity;
              return Math.min(px, py) + margin;
            };

            const startPad = getPadding(ux, uy);
            // End padding needs extra spacing to account for arrowhead length (8px marker)
            const endPad = getPadding(ux, uy) + 6;

            if (len < startPad + endPad + 2) return null;

            const sx = from.x + ux * startPad;
            const sy = from.y + uy * startPad;
            const ex = to.x - ux * endPad;
            const ey = to.y - uy * endPad;

            // Perpendicular offset for link labels to avoid line overlap
            const nx = -uy;
            const ny = ux;
            
            // Place label at 35% of visible line length to clear the center space and avoid overlapping at (cx, cy)
            const lineLen = len - startPad - endPad;
            const mx = sx + ux * lineLen * 0.35 + nx * 10;
            const my = sy + uy * lineLen * 0.35 + ny * 10;

            const labelW = Math.max(45, (link.label || "").length * 6 + 10);

            return (
              <g key={idx}>
                {/* Thin visible arrow line */}
                <line
                  x1={sx}
                  y1={sy}
                  x2={ex}
                  y2={ey}
                  stroke="#6366f1"
                  strokeWidth="1.5"
                  markerEnd="url(#arrowhead)"
                />
                {/* Thick transparent line for mouse events, makes arrows easy to double click */}
                <line
                  x1={sx}
                  y1={sy}
                  x2={ex}
                  y2={ey}
                  stroke="transparent"
                  strokeWidth="8"
                  cursor="pointer"
                  pointerEvents="stroke"
                  onDoubleClick={(e) => handleLinkDoubleClick(idx, link.label || "", e)}
                >
                  <title>Nhấp đúp vào mũi tên để sửa hoặc thêm nhãn</title>
                </line>
                {link.label && (
                  <g
                    pointerEvents="auto"
                    cursor="pointer"
                    onDoubleClick={(e) => handleLinkDoubleClick(idx, link.label || "", e)}
                  >
                    <title>Nhấp đúp để chỉnh sửa nhãn liên kết</title>
                    <rect
                      x={mx - labelW / 2}
                      y={my - 6.5}
                      width={labelW}
                      height="13"
                      fill="#ffffff"
                      rx="2"
                      stroke="#e2e8f0"
                      strokeWidth="0.5"
                    />
                    <text
                      x={mx}
                      y={my + 3}
                      textAnchor="middle"
                      fill="#4f46e5"
                      fontSize="7.5px"
                      fontWeight="700"
                    >
                      {link.label}
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </svg>

        {nodes.map((node) => {
          const pos = positions[node.id];
          if (!pos) return null;
          const isEditing = editingNodeId === node.id;
          return (
            <div
              key={node.id}
              onMouseDown={(e) => {
                if (isEditing) {
                  e.stopPropagation();
                } else {
                  handleMouseDown(node.id, e);
                }
              }}
              onDoubleClick={(e) => handleNodeDoubleClick(node.id, node.label, e)}
              style={{
                position: "absolute",
                left: pos.x - nodeW / 2,
                top: pos.y - nodeH / 2,
                width: nodeW,
                height: nodeH,
                background: "#ffffff",
                border: isEditing ? "1.5px dashed #4f46e5" : "1.5px solid #6366f1",
                borderRadius: "6px",
                boxShadow: isEditing ? "0 0 0 3px rgba(99, 102, 241, 0.15)" : "0 2px 4px rgba(99, 102, 241, 0.06)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "2px 6px",
                boxSizing: "border-box",
                zIndex: 10,
                cursor: isEditing ? "text" : "grab",
                userSelect: "none",
              }}
              onMouseEnter={(e) => {
                if (!isEditing) {
                  e.currentTarget.style.borderColor = "#4f46e5";
                  e.currentTarget.style.boxShadow = "0 4px 10px rgba(99, 102, 241, 0.12)";
                }
              }}
              onMouseLeave={(e) => {
                if (!isEditing) {
                  e.currentTarget.style.borderColor = "#6366f1";
                  e.currentTarget.style.boxShadow = "0 2px 4px rgba(99, 102, 241, 0.06)";
                }
              }}
            >
              {isEditing ? (
                <input
                  autoFocus
                  value={editingText}
                  onChange={(e) => setEditingText(e.target.value)}
                  onBlur={() => {
                    if (onUpdateDiagram) {
                      const updatedNodes = nodes.map(n => n.id === node.id ? { ...n, label: editingText } : n);
                      onUpdateDiagram({ ...diagram, nodes: updatedNodes });
                    }
                    setEditingNodeId(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.currentTarget.blur();
                    } else if (e.key === "Escape") {
                      setEditingNodeId(null);
                    }
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  style={{
                    fontSize: "9px",
                    fontWeight: 700,
                    color: "#1e293b",
                    textAlign: "center",
                    width: "100%",
                    border: "none",
                    outline: "none",
                    background: "transparent",
                    fontFamily: "inherit",
                  }}
                />
              ) : (
                <div
                  style={{
                    fontSize: "9px",
                    fontWeight: 700,
                    color: "#1e293b",
                    textAlign: "center",
                    lineHeight: "1.2",
                    wordBreak: "break-word",
                    width: "100%",
                  }}
                  title="Nhấp giữ để kéo, nhấp đúp để sửa"
                >
                  {node.label}
                </div>
              )}
            </div>
          );
        })}

        {/* Floating Link Editor Input */}
        {editingLinkIdx !== null && (() => {
          const link = links[editingLinkIdx];
          if (!link) return null;
          const from = positions[link.source];
          const to = positions[link.target];
          if (!from || !to) return null;
          
          const dx = to.x - from.x;
          const dy = to.y - from.y;
          const len = Math.sqrt(dx * dx + dy * dy);
          if (len < 30) return null;

          const ux = dx / len;
          const uy = dy / len;
          const w = nodeW / 2;
          const h = nodeH / 2;
          const margin = 6;
          const getPadding = (xUnit: number, yUnit: number) => {
            const px = xUnit !== 0 ? w / Math.abs(xUnit) : Infinity;
            const py = yUnit !== 0 ? h / Math.abs(yUnit) : Infinity;
            return Math.min(px, py) + margin;
          };
          const startPad = getPadding(ux, uy);
          const endPad = getPadding(ux, uy) + 6;
          const lineLen = len - startPad - endPad;
          const nx = -uy;
          const ny = ux;
          const mx = from.x + ux * startPad + ux * lineLen * 0.35 + nx * 10;
          const my = from.y + uy * startPad + uy * lineLen * 0.35 + ny * 10;
          
          const labelW = 80;
          
          return (
            <input
              autoFocus
              value={editingText}
              onChange={(e) => setEditingText(e.target.value)}
              onBlur={() => {
                if (onUpdateDiagram) {
                  const updatedLinks = links.map((l, li) => li === editingLinkIdx ? { ...l, label: editingText } : l);
                  onUpdateDiagram({ ...diagram, links: updatedLinks });
                }
                setEditingLinkIdx(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.currentTarget.blur();
                } else if (e.key === "Escape") {
                  setEditingLinkIdx(null);
                }
              }}
              style={{
                position: "absolute",
                left: mx - labelW / 2,
                top: my - 9,
                width: labelW,
                height: 18,
                fontSize: "9px",
                fontWeight: 700,
                color: "#4f46e5",
                background: "#ffffff",
                border: "1.5px dashed #6366f1",
                borderRadius: "4px",
                textAlign: "center",
                outline: "none",
                zIndex: 20,
                boxSizing: "border-box",
                boxShadow: "0 0 0 3px rgba(99, 102, 241, 0.15)"
              }}
            />
          );
        })()}
      </div>
      {caption && (
        <div style={{ fontSize: "10px", color: "#64748b", fontStyle: "italic", textAlign: "center", lineHeight: "1.4", padding: "0 8px" }}>
          💡 Ý nghĩa sơ đồ: {caption}
        </div>
      )}
    </div>
  );
}
