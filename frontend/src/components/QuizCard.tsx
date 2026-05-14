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
  item: {
    id: string;
    question: string;
    options: string[];
    correct_answer: string;
    explanation: string;
    type: string;
    restudy_hint?: string;
  };
  index: number;
  userAnswer: string | undefined;
  submitted: boolean;
  expanded: boolean;
  onSelect: (questionId: string, letter: string) => void;
  onToggleExpand: (index: number) => void;
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
}: QuizCardProps) {
  const isCorrect  = userAnswer === item.correct_answer;
  const typeColor  = TYPE_COLORS[item.type] ?? TYPE_COLORS.knowledge;

  // Dynamic card class
  let cardClass = "quiz-card";
  if (submitted) {
    if (isCorrect && userAnswer) cardClass += " answered-correct";
    else if (!isCorrect && userAnswer)  cardClass += " answered-wrong";
  }

  return (
    <div className={cardClass} style={{ animationDelay: `${index * 0.04}s` }}>
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

        {/* Result icon */}
        {submitted && (
          <span style={{ fontSize: 20 }}>
            {isCorrect && userAnswer ? "✅" : userAnswer ? "❌" : "⬜"}
          </span>
        )}
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
            background: !isCorrect && userAnswer ? "rgba(251, 146, 60, 0.1)" : "rgba(255, 255, 255, 0.04)",
            borderLeft: `4px solid ${!isCorrect && userAnswer ? "#fb923c" : "#a78bfa"}`,
            fontSize: 14,
            lineHeight: 1.6,
            color: "#e2e8f0",
          }}
        >
          <div style={{ marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontWeight: 800, color: !isCorrect && userAnswer ? "#fb923c" : "#a78bfa", fontSize: 13, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              {!isCorrect && userAnswer ? "⚠️ Phân tích lỗi sai" : "💡 Giải thích kiến thức"}
            </span>
          </div>

          <div style={{ color: "#cbd5e1" }}>
            {item.explanation}
          </div>

          {!isCorrect && userAnswer && item.restudy_hint && (
            <div
              style={{
                marginTop: 10,
                paddingTop: 10,
                borderTop: "1px solid rgba(251, 146, 60, 0.2)",
                fontSize: 13,
                color: "#fdba74",
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              🚀 Lộ trình ôn tập: <span style={{ color: "#fff", textDecoration: "underline" }}>{item.restudy_hint}</span>
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
