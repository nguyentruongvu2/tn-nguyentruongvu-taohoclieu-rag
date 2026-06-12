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
  comprehension: "Hiểu",
  application:   "Áp dụng",
  analysis:      "Phân tích",
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
  userAnswer,
  submitted,
  expanded,
  onSelect,
  onToggleExpand,
  onUpdateItem,
  onDeleteItem,
}: QuizCardProps) {
  const isCorrect  = userAnswer === item.correct_answer;
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
  if (submitted) {
    if (isCorrect && userAnswer) cardClass += " answered-correct";
    else if (!isCorrect && userAnswer)  cardClass += " answered-wrong";
  }

  // Edit Mode Render
  if (isEditing) {
    return (
      <div id={`quiz-card-${item.id}`} className={cardClass} style={{ animationDelay: `${index * 0.04}s`, border: `2px solid ${ACCENT}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
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
            <option value="comprehension">Hiểu</option>
            <option value="application">Áp dụng</option>
            <option value="analysis">Phân tích</option>
          </select>
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
                  borderRadius: 8,
                  border: "1px solid #cbd5e1",
                  fontSize: 14,
                  boxSizing: "border-box",
                }}
              />
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
              transition: "background 0.2s",
              background: submitted
                ? isCorrect && userAnswer ? GREEN : userAnswer ? RED : "rgba(255,255,255,0.1)"
                : userAnswer ? ACCENT : "rgba(255,255,255,0.08)",
              color: userAnswer || submitted ? "#fff" : "#64748b",
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
        </div>

        {/* Action icons / Result icon */}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {submitted && (
            <span style={{ fontSize: 20 }}>
              {isCorrect && userAnswer ? "✅" : userAnswer ? "❌" : "⬜"}
            </span>
          )}

          {!submitted && (
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
          )}
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
          const selected     = userAnswer === letter;
          const isCorrectOpt = letter === item.correct_answer;

          // Option styling
          let optClass = "quiz-option";
          if (!submitted && selected) optClass += " selected";
          if (submitted && isCorrectOpt) optClass += " correct";
          if (submitted && selected && !isCorrect) optClass += " wrong";

          return (
            <label
              key={letter}
              className={optClass}
              data-locked={submitted || undefined}
              onClick={() => !submitted && onSelect(item.id, letter)}
            >
              {/* Letter badge */}
              <span
                className="qp-option-letter"
                style={{
                  background:
                    isCorrectOpt && submitted ? GREEN
                    : selected && !submitted ? ACCENT
                    : "rgba(255,255,255,0.06)",
                  color:
                    (isCorrectOpt && submitted) || (selected && !submitted) ? "#fff" : "#64748b",
                }}
              >
                {letter}
              </span>

              <input
                type="radio"
                name={item.id}
                value={letter}
                checked={selected}
                disabled={submitted}
                onChange={() => onSelect(item.id, letter)}
                style={{ display: "none" }}
              />

              <span style={{ flex: 1, color: "inherit" }}>
                {option.replace(/^[A-D]\.\s*/, "")}
              </span>

              {submitted && isCorrectOpt && (
                <span style={{ color: GREEN, fontWeight: 700, marginLeft: 8, flexShrink: 0 }}>✓</span>
              )}
              {submitted && selected && !isCorrect && letter === userAnswer && (
                <span style={{ color: RED, fontWeight: 700, marginLeft: 8, flexShrink: 0 }}>✗</span>
              )}
            </label>
          );
        })}
      </div>

      {/* Explanation (after submit) */}
      {submitted && (
        <div
          className={`qp-explanation ${!isCorrect && userAnswer ? "is-wrong-alert" : ""}`}
          style={{
            marginTop: 14,
            padding: "12px 16px",
            borderRadius: 8,
            background: !isCorrect && userAnswer ? "rgba(251, 146, 60, 0.1)" : "rgba(99, 102, 241, 0.08)",
            borderLeft: `4px solid ${!isCorrect && userAnswer ? "#fb923c" : "#6366f1"}`,
            fontSize: 14,
            lineHeight: 1.6,
            color: "#334155",
          }}
        >
          <div style={{ marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontWeight: 800, color: !isCorrect && userAnswer ? "#ea580c" : "#4f46e5", fontSize: 13, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              {!isCorrect && userAnswer ? "⚠️ Phân tích lỗi sai" : "💡 Giải thích kiến thức"}
            </span>
          </div>

          <div style={{ color: "#475569" }}>
            {userAnswer && item.explanations && item.explanations[userAnswer] ? (
              <span>
                <strong style={{ color: isCorrect ? GREEN : "#ea580c" }}>[Lựa chọn {userAnswer}]:</strong>{" "}
                {item.explanations[userAnswer]}
              </span>
            ) : (
              item.explanation
            )}
          </div>

          {!isCorrect && userAnswer && item.restudy_hint && (
            <div
              style={{
                marginTop: 10,
                paddingTop: 10,
                borderTop: "1px solid rgba(251, 146, 60, 0.2)",
                fontSize: 13,
                color: "#c2410c",
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              🚀 Lộ trình ôn tập: <span style={{ color: "#9a3412", textDecoration: "underline" }}>{item.restudy_hint}</span>
            </div>
          )}

          {!userAnswer && (
            <em style={{ color: "#64748b", fontSize: 12, display: "block", marginTop: 8 }}>
              (Bạn đã bỏ trống câu hỏi này)
            </em>
          )}
        </div>
      )}

      {/* Expand toggle (for long questions) */}
      {!submitted && item.question.length > 120 && (
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

