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
      <circle cx={68} cy={68} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={11} />
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

  return (
    <div className="qp-score-panel">
      <CircleScore pct={pct} color={feedback.color} />

      <div className="qp-score-title" style={{ color: feedback.color }}>
        {feedback.emoji} {score}/{total} câu đúng
      </div>
      <p className="qp-score-subtitle">{feedback.text}</p>

      {/* Quick stats */}
      <div className="qp-stats-row">
        <div className="qp-stat-card">
          <div className="qp-stat-value" style={{ color: feedback.color }}>{pct}%</div>
          <div className="qp-stat-label">điểm</div>
        </div>
        <div className="qp-stat-card">
          <div className="qp-stat-value">{score}</div>
          <div className="qp-stat-label">câu đúng</div>
        </div>
        <div className="qp-stat-card">
          <div className="qp-stat-value">{total - score}</div>
          <div className="qp-stat-label">câu sai</div>
        </div>
        {elapsed > 0 && (
          <div className="qp-stat-card">
            <div className="qp-stat-value" style={{ fontSize: 18 }}>{formatTime(elapsed)}</div>
            <div className="qp-stat-label">thời gian</div>
          </div>
        )}
      </div>

      {/* Historical stats */}
      {stats && stats.attempts > 0 && (
        <div className="qp-stats-row" style={{ marginTop: 10 }}>
          {[
            { value: stats.attempts,                             label: "lần làm" },
            { value: `${stats.avg_percentage?.toFixed(0)}%`,    label: "TB lịch sử" },
            { value: `${stats.best_percentage?.toFixed(0)}%`,   label: "cao nhất" },
          ].map(({ value, label }) => (
            <div key={label} className="qp-stat-card" style={{ borderColor: "rgba(99,102,241,0.2)" }}>
              <span className="qp-stat-value" style={{ color: ACCENT }}>{value}</span>
              <span className="qp-stat-label">{label}</span>
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

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {items
              .filter((item) => userAnswers[item.id] !== item.correct_answer)
              .map((item, i) => (
                <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <span style={{ fontSize: 12, marginTop: 2 }}>🔴</span>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#1e293b" }}>
                      {item.restudy_hint || "Kiến thức tổng hợp"}
                    </div>
                    <div style={{ fontSize: 11, color: "#94a3b8", textTransform: "uppercase", fontWeight: 600 }}>
                      Kỹ năng: {item.type === "knowledge" ? "Nhận biết" : item.type === "comprehension" ? "Hiểu" : item.type === "application" ? "Áp dụng" : "Phân tích"}
                    </div>
                  </div>
                </div>
              ))}
          </div>

          <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px dashed rgba(0,0,0,0.1)", fontSize: 12, color: "#475569", fontStyle: "italic" }}>
            💡 Lời khuyên: Hãy cuộn xuống dưới xem kỹ phần giải thích lỗi sai hoặc quay lại đọc mục tương ứng trong bài giảng trước khi làm lại.
          </div>
        </div>
      )}

      <div className="qp-action-row">
        <button className="qp-btn-primary" onClick={onRetry}>
          🔄 Làm lại
        </button>
        <button className="qp-btn-ghost" onClick={onBack}>
          ← Quay lại bài giảng
        </button>
      </div>
    </div>
  );
}
