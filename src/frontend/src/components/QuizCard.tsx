import { useState, useEffect } from "react";
import { type QuizItem } from "../services/api";

/**
 * QuizCard — Premium dark-theme quiz question card.
 * Fully controlled: parent passes state, QuizCard emits events.
 */

const ACCENT = "#6366f1";
const GREEN  = "#22c55e";
const RED    = "#ef4444";

export const TYPE_LABELS: Record<string, string> = {
  knowledge:     "Nhận biết",
  comprehension: "Thông hiểu",
  application:   "Vận dụng",
  analysis:      "Vận dụng cao",
};

const TYPE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  knowledge:     { bg: "rgba(124,58,237,0.15)",  text: "#a78bfa", border: "rgba(167,139,250,0.3)" }, // Purple
  comprehension: { bg: "rgba(16,185,129,0.15)",  text: "#34d399", border: "rgba(52,211,153,0.3)" },  // Emerald
  application:   { bg: "rgba(59,130,246,0.15)",  text: "#60a5fa", border: "rgba(96,165,250,0.3)" },  // Blue
  analysis:      { bg: "rgba(245,158,11,0.15)",  text: "#fbbf24", border: "rgba(251,191,36,0.3)" },  // Amber
};

export interface QuizCardProps {
  item: QuizItem;
  index: number;
  userAnswer: string | undefined;
  submitted: boolean;
  expanded: boolean;
  onSelect: (questionId: string, letter: string) => void;
  onToggleExpand: (index: number) => void;
  onUpdateItem?: (updatedItem: QuizItem) => void;
  onDeleteItem?: (questionId: string) => void;
}

function getOptionLetter(option: string): string {
  return (option || "").split(".")[0].trim().toUpperCase();
}

export function QuizCard({
  item,
  index,
  userAnswer: _userAnswer,
  submitted: _submitted,
  expanded,
  onSelect: _onSelect,
  onToggleExpand,
  onUpdateItem,
  onDeleteItem,
}: QuizCardProps) {
  const typeColor  = TYPE_COLORS[item.type] ?? TYPE_COLORS.knowledge;

  // Editing state
  const [isEditing, setIsEditing] = useState(false);
  const [editQuestion, setEditQuestion] = useState(item.question);
  const [editOptions, setEditOptions] = useState<string[]>(() =>
    item.options.map((opt, idx) => {
      const letter = ["A", "B", "C", "D"][idx];
      const regex = new RegExp(`^[${letter}][.)\\s]+`, "i");
      return opt.replace(regex, "").trim();
    })
  );
  const [editCorrectAnswer, setEditCorrectAnswer] = useState(item.correct_answer);
  const [editExplanation, setEditExplanation] = useState(item.explanation);
  const [editExplanations, setEditExplanations] = useState<Record<string, string>>(() => {
    const exps = item.explanations || {};
    return {
      A: exps.A || "",
      B: exps.B || "",
      C: exps.C || "",
      D: exps.D || "",
    };
  });
  const [editType, setEditType] = useState(item.type);
  const [editRestudyHint, setEditRestudyHint] = useState(item.restudy_hint || "");

  // Reset internal states if item changes from parent
  useEffect(() => {
    setEditQuestion(item.question);
    setEditOptions(
      item.options.map((opt, idx) => {
        const letter = ["A", "B", "C", "D"][idx];
        const regex = new RegExp(`^[${letter}][.)\\s]+`, "i");
        return opt.replace(regex, "").trim();
      })
    );
    setEditCorrectAnswer(item.correct_answer);
    setEditExplanation(item.explanation);
    const exps = item.explanations || {};
    setEditExplanations({
      A: exps.A || "",
      B: exps.B || "",
      C: exps.C || "",
      D: exps.D || "",
    });
    setEditType(item.type);
    setEditRestudyHint(item.restudy_hint || "");
  }, [item]);

  const handleSave = () => {
    if (!editQuestion.trim()) {
      alert("Nội dung câu hỏi không được để trống.");
      return;
    }
    if (editOptions.some((opt) => !opt.trim())) {
      alert("Vui lòng điền đầy đủ nội dung cho tất cả 4 đáp án.");
      return;
    }

    if (onUpdateItem) {
      onUpdateItem({
        ...item,
        question: editQuestion.trim(),
        options: [
          `A. ${editOptions[0].trim()}`,
          `B. ${editOptions[1].trim()}`,
          `C. ${editOptions[2].trim()}`,
          `D. ${editOptions[3].trim()}`,
        ],
        correct_answer: editCorrectAnswer,
        explanation: editExplanation.trim(),
        explanations: {
          A: editExplanations.A.trim() || editExplanation.trim(),
          B: editExplanations.B.trim() || editExplanation.trim(),
          C: editExplanations.C.trim() || editExplanation.trim(),
          D: editExplanations.D.trim() || editExplanation.trim(),
        },
        type: editType as any,
        restudy_hint: editRestudyHint.trim(),
      });
    }
    setIsEditing(false);
  };

  const handleCancel = () => {
    // Reset to item values
    setEditQuestion(item.question);
    setEditOptions(
      item.options.map((opt, idx) => {
        const letter = ["A", "B", "C", "D"][idx];
        const regex = new RegExp(`^[${letter}][.)\\s]+`, "i");
        return opt.replace(regex, "").trim();
      })
    );
    setEditCorrectAnswer(item.correct_answer);
    setEditExplanation(item.explanation);
    const exps = item.explanations || {};
    setEditExplanations({
      A: exps.A || "",
      B: exps.B || "",
      C: exps.C || "",
      D: exps.D || "",
    });
    setEditType(item.type);
    setEditRestudyHint(item.restudy_hint || "");
    setIsEditing(false);
  };

  // Dynamic card class
  let cardClass = "quiz-card";

  // Edit Mode Render
  if (isEditing) {
    return (
      <div id={`quiz-card-${item.id}`} className={cardClass} style={{ animationDelay: `${index * 0.04}s`, border: `2px solid ${ACCENT}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: ACCENT }}>
            ✏️ Đang chỉnh sửa Câu {index + 1}
          </span>
          
          <select
            value={editType}
            onChange={(e) => setEditType(e.target.value as any)}
            style={{
              padding: "6px 12px",
              borderRadius: 8,
              border: "1px solid #cbd5e1",
              fontSize: 13,
              fontWeight: 600,
              background: "#fff",
              color: "#334155",
            }}
          >
            <option value="knowledge">Nhận biết</option>
            <option value="comprehension">Thông hiểu</option>
            <option value="application">Vận dụng</option>
            <option value="analysis">Vận dụng cao</option>
          </select>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
          {item.chapter && (
            <span style={{ fontSize: 11, padding: "4px 8px", background: "rgba(0,0,0,0.04)", borderRadius: 6, color: "#64748b", fontWeight: 600 }}>
              📖 Chương: {item.chapter}
            </span>
          )}
          {item.topic && (
            <span style={{ fontSize: 11, padding: "4px 8px", background: "rgba(0,0,0,0.04)", borderRadius: 6, color: "#64748b", fontWeight: 600 }}>
              🏷️ Chủ đề: {item.topic}
            </span>
          )}
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ display: "block", marginBottom: 4, fontSize: 13, fontWeight: 600, color: "#475569" }}>
            Nội dung câu hỏi:
          </label>
          <textarea
            value={editQuestion}
            onChange={(e) => setEditQuestion(e.target.value)}
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: 8,
              border: "1px solid #cbd5e1",
              fontSize: 14,
              minHeight: 70,
              fontFamily: "inherit",
              resize: "vertical",
              boxSizing: "border-box",
            }}
          />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
          <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#475569" }}>
            Các lựa chọn đáp án (Click chữ cái tương ứng để đặt làm đáp án đúng):
          </label>
          {["A", "B", "C", "D"].map((letter, idx) => (
            <div key={letter} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button
                type="button"
                onClick={() => setEditCorrectAnswer(letter)}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  border: "none",
                  background: editCorrectAnswer === letter ? GREEN : "rgba(0,0,0,0.06)",
                  color: editCorrectAnswer === letter ? "#fff" : "#64748b",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: "pointer",
                  transition: "background 0.2s, color 0.2s",
                }}
                title={`Chọn ${letter} làm đáp án đúng`}
              >
                {letter}
              </button>
              <div style={{ flex: 1, position: "relative", display: "flex", alignItems: "center" }}>
                <input
                  type="text"
                  value={editOptions[idx] || ""}
                  onChange={(e) => {
                    const newOpts = [...editOptions];
                    newOpts[idx] = e.target.value;
                    setEditOptions(newOpts);
                  }}
                  placeholder={`Lựa chọn ${letter}`}
                  style={{
                    flex: 1,
                    padding: "8px 12px",
                    paddingRight: editCorrectAnswer === letter ? "110px" : "12px",
                    borderRadius: 8,
                    border: editCorrectAnswer === letter ? `1.5px solid ${GREEN}` : "1px solid #cbd5e1",
                    background: editCorrectAnswer === letter ? "rgba(34, 197, 94, 0.03)" : "#fff",
                    fontSize: 14,
                    boxSizing: "border-box",
                    transition: "all 0.2s",
                  }}
                />
                {editCorrectAnswer === letter && (
                  <span style={{ 
                    position: "absolute", 
                    right: "12px", 
                    color: GREEN, 
                    fontWeight: 700, 
                    fontSize: "12px", 
                    background: "rgba(34, 197, 94, 0.12)", 
                    padding: "2px 8px", 
                    borderRadius: "12px",
                    userSelect: "none"
                  }}>
                    ✓ Đáp án đúng
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ display: "block", marginBottom: 4, fontSize: 13, fontWeight: 600, color: "#475569" }}>
            Giải thích đáp án chung (Fallback):
          </label>
          <textarea
            value={editExplanation}
            onChange={(e) => setEditExplanation(e.target.value)}
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: 8,
              border: "1px solid #cbd5e1",
              fontSize: 13,
              minHeight: 50,
              fontFamily: "inherit",
              resize: "vertical",
              boxSizing: "border-box",
            }}
          />
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 600, color: "#475569" }}>
            Giải thích chi tiết cho từng lựa chọn:
          </label>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {["A", "B", "C", "D"].map((letter) => (
              <div key={letter} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{
                  width: 24,
                  height: 24,
                  borderRadius: 6,
                  background: editCorrectAnswer === letter ? GREEN : "rgba(0,0,0,0.06)",
                  color: editCorrectAnswer === letter ? "#fff" : "#64748b",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 700,
                  fontSize: 12,
                }}>
                  {letter}
                </span>
                <input
                  type="text"
                  value={editExplanations[letter] || ""}
                  onChange={(e) => {
                    setEditExplanations({
                      ...editExplanations,
                      [letter]: e.target.value,
                    });
                  }}
                  placeholder={`Giải thích cho lựa chọn ${letter}...`}
                  style={{
                    flex: 1,
                    padding: "8px 12px",
                    borderRadius: 8,
                    border: "1px solid #cbd5e1",
                    fontSize: 13,
                    boxSizing: "border-box",
                  }}
                />
              </div>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ display: "block", marginBottom: 4, fontSize: 13, fontWeight: 600, color: "#475569" }}>
            Gợi ý lộ trình ôn tập (nếu làm sai):
          </label>
          <input
            type="text"
            value={editRestudyHint}
            onChange={(e) => setEditRestudyHint(e.target.value)}
            placeholder="VD: Mục 2.3: Các loại bộ nhớ đệm"
            style={{
              width: "100%",
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid #cbd5e1",
              fontSize: 13,
              boxSizing: "border-box",
            }}
          />
        </div>

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={handleCancel}
            style={{
              padding: "8px 16px",
              borderRadius: 8,
              border: "1px solid #cbd5e1",
              background: "#fff",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 600,
              color: "#475569",
            }}
          >
            Huỷ
          </button>
          <button
            type="button"
            onClick={handleSave}
            style={{
              padding: "8px 16px",
              borderRadius: 8,
              border: "none",
              background: ACCENT,
              color: "#fff",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            Lưu thay đổi
          </button>
        </div>
      </div>
    );
  }

  // Normal Display Mode Render
  return (
    <div id={`quiz-card-${item.id}`} className={cardClass} style={{ animationDelay: `${index * 0.04}s`, transition: 'box-shadow 0.5s ease-in-out' }}>
      {/* Card header: number badge + type badge + result icon */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {/* Number badge */}
          <span
            style={{
              width: 28,
              height: 28,
              borderRadius: "50%",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 12,
              fontWeight: 700,
              flexShrink: 0,
              background: ACCENT,
              color: "#fff",
            }}
          >
            {index + 1}
          </span>

          {/* Type badge */}
          <span
            className="qp-type-badge"
            style={{
              background: typeColor.bg,
              color: typeColor.text,
              border: `1px solid ${typeColor.border}`,
            }}
          >
            {TYPE_LABELS[item.type] ?? item.type}
          </span>

          {/* Chapter badge */}
          {item.chapter && (
            <span
              className="qp-type-badge"
              style={{
                background: "rgba(30, 41, 59, 0.08)",
                color: "#475569",
                border: "1px solid rgba(71, 85, 105, 0.15)",
              }}
              title={`Chương: ${item.chapter}`}
            >
              📖 {item.chapter}
            </span>
          )}

          {/* Topic badge */}
          {item.topic && (
            <span
              className="qp-type-badge"
              style={{
                background: "rgba(13, 148, 136, 0.08)",
                color: "#0f766e",
                border: "1px solid rgba(13, 148, 136, 0.15)",
              }}
              title={`Chủ đề: ${item.topic}`}
            >
              🏷️ {item.topic}
            </span>
          )}
        </div>

        {/* Action icons / Result icon */}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              style={{
                background: "rgba(99,102,241,0.08)",
                border: "1px solid rgba(99,102,241,0.2)",
                color: ACCENT,
                padding: "4px 8px",
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 3,
                transition: "background 0.2s",
              }}
              title="Sửa câu hỏi này"
            >
              ✏️ Sửa
            </button>
            {onDeleteItem && (
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(`Bạn có chắc chắn muốn xoá câu hỏi ${index + 1}?`)) {
                    onDeleteItem(item.id);
                  }
                }}
                style={{
                  background: "rgba(239,68,68,0.08)",
                  border: "1px solid rgba(239,68,68,0.2)",
                  color: RED,
                  padding: "4px 8px",
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 3,
                  transition: "background 0.2s",
                }}
                title="Xoá câu hỏi này"
              >
                🗑️ Xoá
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Question text */}
      <p style={{ fontSize: 16, color: "#1e293b", lineHeight: 1.65, margin: "0 0 14px", fontWeight: 600 }}>
        <strong style={{ color: "#818cf8", marginRight: 6 }}>Câu {index + 1}:</strong>
        {item.question}
      </p>

      {/* Options */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {item.options.map((option) => {
          const letter       = getOptionLetter(option);

          // Option styling: neutral styled list
          let optClass = "quiz-option";

          return (
            <div
              key={letter}
              className={optClass}
              data-locked={true}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "10px 14px",
                borderRadius: "10px",
                border: "1px solid #e2e8f0",
                background: "#ffffff",
                color: "#334155",
                fontSize: "14px",
                fontWeight: 500,
              }}
            >
              {/* Letter badge */}
              <span
                className="qp-option-letter"
                style={{
                  background: "rgba(15, 23, 42, 0.06)",
                  color: "#475569",
                  width: 24,
                  height: 24,
                  borderRadius: "6px",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 700,
                  fontSize: 12,
                  flexShrink: 0,
                }}
              >
                {letter}
              </span>

              <span style={{ flex: 1, color: "inherit" }}>
                {option.replace(/^[A-D]\.\s*/, "")}
              </span>
            </div>
          );
        })}
      </div>

      {/* Expand toggle (for long questions) */}
      {item.question.length > 120 && (
        <button
          style={{
            marginTop: 10,
            background: "transparent",
            border: "none",
            color: ACCENT,
            fontSize: 12,
            cursor: "pointer",
            fontWeight: 600,
          }}
          onClick={() => onToggleExpand(index)}
        >
          {expanded ? "Thu gọn ▲" : "Xem thêm ▼"}
        </button>
      )}
    </div>
  );
}

