/**
 * ScorePanel — Premium dark-theme result summary after quiz submission.
 */

const GREEN  = "#22c55e";
const GOLD   = "#f59e0b";
const RED    = "#ef4444";
const ACCENT = "#6366f1";

import type { QuizStats, QuizItem } from "../services/api";

interface ScorePanelProps {
  score: number;
  total: number;
  elapsed: number;
  savedId: number | null;
  stats: QuizStats | null;
  items: QuizItem[];
  userAnswers: Record<string, string>;
  onRetry: () => void;
  onBack: () => void;
}

function getFeedback(pct: number): { text: string; color: string; emoji: string } {
  if (pct >= 90) return { text: "Xuất sắc! Bạn đã thành thạo nội dung này.", color: GREEN,    emoji: "🏆" };
  if (pct >= 75) return { text: "Rất tốt! Nắm vững phần lớn kiến thức.",    color: GREEN,    emoji: "🎉" };
  if (pct >= 60) return { text: "Khá tốt! Hiểu được phần lớn nội dung.",   color: GOLD,     emoji: "👍" };
  if (pct >= 40) return { text: "Tạm ổn. Nên ôn lại một số khái niệm.",    color: "#f97316", emoji: "📖" };
  return           { text: "Cần ôn lại bài! Đọc lại nội dung bài giảng.", color: RED,      emoji: "💪" };
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

function CircleScore({ pct, color }: { pct: number; color: string }) {
  const r = 54;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  return (
    <svg width={136} height={136} style={{ transform: "rotate(-90deg)", filter: `drop-shadow(0 0 12px ${color}55)` }}>
      <circle cx={68} cy={68} r={r} fill="none" stroke="#f1f5f9" strokeWidth={11} />
      <circle cx={68} cy={68} r={r} fill="none" stroke={color} strokeWidth={11}
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
        style={{ transition: "stroke-dasharray 1s cubic-bezier(.4,0,.2,1)" }} />
      <text x={68} y={72} textAnchor="middle" dominantBaseline="middle"
        style={{
          fill: color, fontSize: 26, fontWeight: 800,
          transform: "rotate(90deg)", transformOrigin: "68px 68px",
          fontFamily: "Inter,system-ui",
        }}>
        {pct}%
      </text>
    </svg>
  );
}

export function ScorePanel({ score, total, elapsed, savedId, stats, items, userAnswers, onRetry, onBack }: ScorePanelProps) {
  const pct      = total > 0 ? Math.round((score / total) * 100) : 0;
  const feedback = getFeedback(pct);

  // Group incorrect answers by restudy hint
  const missedItems = items.filter((item) => userAnswers[item.id] !== item.correct_answer);
  const groupedMisses: Record<string, typeof missedItems> = {};
  missedItems.forEach(item => {
    let hint = item.restudy_hint || "Kiến thức tổng hợp";
    if (hint.startsWith("Mục:")) {
      hint = hint.replace("Mục:", "").trim();
    }
    if (!groupedMisses[hint]) groupedMisses[hint] = [];
    groupedMisses[hint].push(item);
  });

  const getAdviceForType = (type: string) => {
    switch (type) {
      case "knowledge": return "Ôn lại định nghĩa và các khái niệm cốt lõi.";
      case "comprehension": return "Đọc kỹ lại phần giải thích để tránh nhầm lẫn bản chất.";
      case "application": return "Xem lại các ví dụ thực tế trong bài học để biết cách vận dụng.";
      case "analysis": return "Suy luận chậm lại, phân tách vấn đề để tìm nguyên nhân.";
      default: return "Cần xem lại nội dung này trong bài giảng.";
    }
  };

  return (
    <div className="qp-score-panel">
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: 32, marginBottom: 20 }}>
        <CircleScore pct={pct} color={feedback.color} />
        
        <div style={{ textAlign: "left", flex: "1 1 300px" }}>
          <div className="qp-score-title" style={{ color: feedback.color, margin: "0 0 8px" }}>
            {feedback.emoji} {score}/{total} câu đúng
          </div>
          <p className="qp-score-subtitle" style={{ margin: "0 0 20px" }}>{feedback.text}</p>

          {/* Quick stats */}
          <div className="qp-stats-row" style={{ margin: 0, justifyContent: "flex-start", gap: 12 }}>
            <div className="qp-stat-card" style={{ flex: "1 1 100px", padding: "16px 12px", background: "rgba(241, 245, 249, 0.5)", border: "1px solid rgba(226, 232, 240, 0.8)" }}>
              <div className="qp-stat-value" style={{ color: feedback.color, fontSize: 26 }}>{pct}%</div>
              <div className="qp-stat-label" style={{ fontSize: 12, fontWeight: 600 }}>Điểm số</div>
            </div>
            <div className="qp-stat-card" style={{ flex: "1 1 80px", padding: "16px 12px", background: "rgba(241, 245, 249, 0.5)", border: "1px solid rgba(226, 232, 240, 0.8)" }}>
              <div className="qp-stat-value" style={{ color: "#3b82f6", fontSize: 22 }}>{score}</div>
              <div className="qp-stat-label" style={{ fontSize: 11, fontWeight: 500 }}>Câu đúng</div>
            </div>
            <div className="qp-stat-card" style={{ flex: "1 1 80px", padding: "16px 12px", background: "rgba(241, 245, 249, 0.5)", border: "1px solid rgba(226, 232, 240, 0.8)" }}>
              <div className="qp-stat-value" style={{ color: "#ef4444", fontSize: 22 }}>{total - score}</div>
              <div className="qp-stat-label" style={{ fontSize: 11, fontWeight: 500 }}>Câu sai</div>
            </div>
            {elapsed > 0 && (
              <div className="qp-stat-card" style={{ flex: "1 1 80px", padding: "16px 12px", background: "rgba(241, 245, 249, 0.5)", border: "1px solid rgba(226, 232, 240, 0.8)" }}>
                <div className="qp-stat-value" style={{ fontSize: 20, color: "#64748b" }}>{formatTime(elapsed)}</div>
                <div className="qp-stat-label" style={{ fontSize: 11, fontWeight: 500 }}>Thời gian</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Historical stats */}
      {stats && stats.attempts > 0 && (
        <div className="qp-stats-row" style={{ marginTop: 10 }}>
          {[
            { value: stats.attempts,                             label: "Lần làm" },
            { value: `${stats.avg_percentage?.toFixed(0)}%`,    label: "TB lịch sử" },
            { value: `${stats.best_percentage?.toFixed(0)}%`,   label: "Cao nhất" },
          ].map(({ value, label }) => (
            <div key={label} className="qp-stat-card" style={{ padding: "12px 20px", borderColor: "rgba(99,102,241,0.2)", background: "rgba(99,102,241,0.03)" }}>
              <div className="qp-stat-value" style={{ color: ACCENT, fontSize: 22 }}>{value}</div>
              <div className="qp-stat-label" style={{ fontSize: 11 }}>{label}</div>
            </div>
          ))}
        </div>
      )}

      {savedId && (
        <p className="qp-score-meta">✓ Đã lưu kết quả #{savedId}</p>
      )}

      {/* Weak Point Analysis (New Task 4.3) */}
      {score < total && (
        <div
          style={{
            marginTop: 20,
            padding: "16px",
            background: "rgba(239, 68, 68, 0.05)",
            border: "1px solid rgba(239, 68, 68, 0.15)",
            borderRadius: 12,
            textAlign: "left",
            width: "100%",
          }}
        >
          <div style={{ color: RED, fontWeight: 800, fontSize: 13, marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
            🔍 PHÂN TÍCH LỖ HỔNG KIẾN THỨC
          </div>
          
          <p style={{ fontSize: 13, color: "#64748b", marginBottom: 12 }}>
            Hệ thống nhận thấy bạn đang gặp khó khăn ở các nội dung sau:
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {Object.entries(groupedMisses).map(([hint, itemsGrp], i) => (
              <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", background: "#ffffff", padding: "12px", borderRadius: "8px", border: "1px solid rgba(239, 68, 68, 0.1)" }}>
                <span style={{ fontSize: 14, marginTop: 2 }}>🔴</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#1e293b", marginBottom: 6 }}>
                    Mục: {hint}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {itemsGrp.map(item => (
                      <div 
                        key={item.id} 
                        style={{ fontSize: 13, background: "rgba(241, 245, 249, 0.6)", padding: "8px", borderRadius: "6px", cursor: "pointer", transition: "all 0.2s" }}
                        onClick={() => {
                          const el = document.getElementById(`quiz-card-${item.id}`);
                          if (el) {
                            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            el.style.boxShadow = '0 0 0 4px #fb923c, 0 8px 32px rgba(251,146,60,0.4)';
                            setTimeout(() => {
                              el.style.boxShadow = '';
                            }, 2500);
                          }
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(226, 232, 240, 0.8)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(241, 245, 249, 0.6)"; }}
                        title="Cuộn tới câu hỏi này"
                      >
                        <div style={{ color: "#64748b", fontWeight: 500, marginBottom: 4 }}>
                          <span style={{ fontSize: 11, color: "#94a3b8", textTransform: "uppercase", fontWeight: 700, marginRight: 6 }}>
                            [{item.type === "knowledge" ? "Nhận biết" : item.type === "comprehension" ? "Hiểu" : item.type === "application" ? "Áp dụng" : "Phân tích"}]
                          </span>
                          {item.question.length > 80 ? item.question.substring(0, 80) + "..." : item.question}
                        </div>
                        <div style={{ color: "#b45309", fontWeight: 500, fontStyle: "italic", fontSize: 12 }}>
                          👉 {getAdviceForType(item.type)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px dashed rgba(0,0,0,0.1)", fontSize: 12, color: "#475569" }}>
            💡 <span style={{ fontWeight: 600 }}>Tip:</span> Hãy cuộn xuống dưới xem kỹ phần giải thích lỗi sai của từng câu, sau đó quay lại đọc mục tương ứng trong bài giảng trước khi làm lại.
          </div>
        </div>
      )}

      <div className="qp-action-row">
        <button className="qp-btn-primary" onClick={onRetry}>
          🔄 Làm lại
        </button>
        <button className="qp-btn-ghost" onClick={onBack}>
          ← Quay lại
        </button>
      </div>
    </div>
  );
}
