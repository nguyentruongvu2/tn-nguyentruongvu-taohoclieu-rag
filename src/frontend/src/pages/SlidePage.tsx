import { useCallback, useEffect, useRef, useState } from "react";
import {
  checkSlidesHealth,
  downloadPdf,
  downloadPptx,
  generateSlideOutline,
  saveSlidesDraft,
  loadSlidesDraft,
  type SlideItem,
} from "../services/api";
import {
  Sparkles,
  PanelRight,
  Layout,
  FileText,
  Clock,
  Copy,
  ArrowUp,
  ArrowDown,
  Trash2,
} from "lucide-react";
import "./SlidePage.css";
import { SlideCanvas, type SlideLayout } from "../components/SlideCanvas";

// ── Design tokens ─────────────────────────────────────────────────────────────
const ACCENT = "#6366f1";

const S: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "#f1f5f9",
    fontFamily: "Inter, system-ui, sans-serif",
    display: "flex",
    flexDirection: "column",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 24px",
    background: "#fff",
    borderBottom: "1px solid #e2e8f0",
    position: "sticky",
    top: 0,
    zIndex: 20,
    flexWrap: "wrap",
    gap: 8,
  },
  title: { fontSize: 18, fontWeight: 700, color: "#1e293b", margin: 0 },
  draftBanner: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    background: "#eff6ff",
    borderBottom: "1px solid #bfdbfe",
    padding: "8px 24px",
    fontSize: 13,
    color: "#1d4ed8",
  },
  draftBtn: {
    marginLeft: "auto",
    background: "transparent",
    border: "1px solid #93c5fd",
    borderRadius: 6,
    padding: "2px 10px",
    fontSize: 12,
    cursor: "pointer",
    color: "#1d4ed8",
  },
  autosaveBadge: {
    background: "#f0fdf4",
    borderBottom: "1px solid #bbf7d0",
    padding: "4px 24px",
    fontSize: 12,
    color: "#15803d",
  },
  errorBanner: {
    margin: "12px 24px 0",
    padding: "10px 16px",
    background: "#fef2f2",
    border: "1px solid #fca5a5",
    borderRadius: 8,
    color: "#dc2626",
    fontSize: 14,
  },
  center: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: 40,
  },
  spinner: {
    width: 40,
    height: 40,
    border: "4px solid #e2e8f0",
    borderTop: `4px solid ${ACCENT}`,
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
  },
  workspace: {
    display: "flex",
    flex: 1,
    overflow: "hidden",
    height: "calc(100vh - 57px)",
  },
  sidebar: {
    width: 200,
    background: "#0f172a",
    borderRight: "1px solid #1e293b",
    overflowY: "auto",
    padding: "12px 8px",
    flexShrink: 0,
  },
  sidebarLabel: {
    fontSize: 10,
    fontWeight: 700,
    color: "#475569",
    letterSpacing: "0.08em",
    padding: "0 8px 8px",
    margin: 0,
  },
  microBtn: {
    border: "none",
    background: "transparent",
    cursor: "pointer",
    fontSize: 13,
    color: "#64748b",
    padding: "1px 5px",
    borderRadius: 4,
  },
  main: {
    flex: 1,
    overflowY: "auto",
    padding: "24px 28px",
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },
  btn: {
    padding: "8px 16px",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    border: "none",
    cursor: "pointer",
    transition: "opacity 0.15s",
    whiteSpace: "nowrap",
  },
  btnGhost: {
    background: "transparent",
    color: "#64748b",
    border: "1.5px solid #e2e8f0",
  },
  btnPrimary: { background: ACCENT, color: "#fff" },
  btnSecondary: {
    background: "#f1f5f9",
    color: "#475569",
    border: "1.5px solid #e2e8f0",
  },
  btnSuccess: { background: "#16a34a", color: "#fff" },
  select: {
    padding: "4px 8px",
    borderRadius: 6,
    border: "1.5px solid #e2e8f0",
    fontSize: 13,
    color: "#334155",
    background: "#fff",
  },
};

// ── Storage keys ──────────────────────────────────────────────────────────────
const PENDING_KEY = "rag.slides.pending";
const DRAFT_KEY = "rag.slides.draft";

// SlideLayout is imported from SlideCanvas component

const LAYOUTS: { id: SlideLayout; label: string; icon: string; description: string }[] = [
  { id: "standard", label: "Chuẩn", icon: "▤", description: "Bố cục truyền thống: Tiêu đề trên cùng, nội dung bên dưới." },
  { id: "two_column", label: "2 cột", icon: "▥", description: "Chia nội dung thành 2 cột song song, phù hợp để so sánh." },
  { id: "big_title", label: "Tiêu đề lớn", icon: "▦", description: "Tập trung vào một thông điệp hoặc tiêu đề lớn ở giữa." },
];

interface PendingState {
  projectId: string;
  lessonContent: string;
  projectTitle: string;
  numSlides: number;
}

interface DraftState {
  projectId: string;
  projectTitle: string;
  slides: SlideItem[];
  layouts: Record<number, SlideLayout>;
  savedAt: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function saveDraft(
  projectId: string,
  projectTitle: string,
  slides: SlideItem[],
  layouts: Record<number, SlideLayout> = {},
) {
  try {
    const draft: DraftState = {
      projectId,
      projectTitle,
      slides,
      layouts,
      savedAt: Date.now(),
    };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    /* quota error — silently skip */
  }
}

function loadDraft(projectId: string): DraftState | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw) as DraftState;
    // Only restore draft for same project
    if (draft.projectId !== projectId) return null;
    return draft;
  } catch {
    return null;
  }
}

/** Cross-browser blob download */
function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  // Small delay before cleanup so browser has time to initiate
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 200);
}

/** Extract error message from axios blob error response (handles JSON and plain-text) */
async function extractErrorMsg(err: unknown): Promise<string> {
  const fallback = "Tải xuống thất bại. Vui lòng thử lại.";
  if (!err || typeof err !== "object") return fallback;
  const axiosErr = err as {
    response?: { data?: unknown; status?: number };
    message?: string;
  };
  const data = axiosErr.response?.data;
  if (data instanceof Blob) {
    try {
      const text = (await data.text()).trim();
      // Try JSON {"detail": "..."} first
      try {
        const parsed = JSON.parse(text) as { detail?: string };
        if (parsed.detail) return parsed.detail;
      } catch {
        /* not JSON */
      }
      // Plain text fallback (e.g. uvicorn "Internal Server Error")
      if (text && text.length < 500) return text;
    } catch {
      /* blob read failed */
    }
  }
  const msg = axiosErr.message;
  if (msg && msg !== "Network Error") return msg;
  return fallback;
}

/** Detect slide type by position in deck */
function slideType(
  idx: number,
  total: number,
): "TITLE" | "SUMMARY" | "CONTENT" {
  if (idx === 0) return "TITLE";
  if (idx === total - 1 && total > 2) return "SUMMARY";
  return "CONTENT";
}

/** True if slide has quality issues (too many bullets or long title) */
function hasTrimWarning(slide: SlideItem): boolean {
  if (slide.bullet_points.length > 5) return true;
  if (slide.title.split(" ").length > 12) return true;
  if (slide.bullet_points.some((b) => b.split(" ").length > 12)) return true;
  return false;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SlidePage({
  isEmbedded = false,
  onClose,
  embeddedData,
}: {
  isEmbedded?: boolean;
  onClose?: () => void;
  embeddedData?: {
    projectId: string;
    lessonContent: string;
    projectTitle: string;
    numSlides: number;
  };
} = {}) {
  const [slides, setSlides] = useState<SlideItem[]>([]);
  const [projectTitle, setProjectTitle] = useState("Bài giảng");
  const [projectId, setProjectId] = useState("");
  const [lessonContent, setLessonContent] = useState("");
  const [numSlides, setNumSlides] = useState(8);

  const [step, setStep] = useState<
    "idle" | "generating" | "preview" | "downloading"
  >("idle");
  const [progressVal, setProgressVal] = useState(0);
  const [error, setError] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const [hasDraft, setHasDraft] = useState(false);
  const [draftAge, setDraftAge] = useState("");
  const [pptxReady, setPptxReady] = useState<boolean | null>(null); // null = checking
  const [pptxError, setPptxError] = useState("");
  const [layouts, setLayouts] = useState<Record<number, SlideLayout>>({});
  const [cloudSaved, setCloudSaved] = useState<string | null>(null);
  const [isCloudSaving, setIsCloudSaving] = useState(false);
  const cloudSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);



  // Inline edit state
  const [editTitle, setEditTitle] = useState(false);
  const [editBullet, setEditBullet] = useState<number | null>(null);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showRightPanel, setShowRightPanel] = useState(true);
  const [activeRightTab, setActiveRightTab] = useState<"notes" | "design">("notes");

  const initRef = useRef(false);

  // ── Init: load pending + check draft ────────────────────────────────────────
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;

    const rawPending = localStorage.getItem(PENDING_KEY);
    if (!rawPending) {
      setError(
        "Không tìm thấy nội dung bài giảng. Vui lòng quay lại editor và nhấn '🖼️ Tạo Slide'.",
      );
      return;
    }

    // Health check — non-blocking, runs in parallel with pending parse
    checkSlidesHealth()
      .then((h) => {
        setPptxReady(h.pptx_available);
        if (!h.pptx_available) setPptxError(h.pptx_error ?? "Không rõ lỗi");
      })
      .catch(() => setPptxReady(false));

    let pending: PendingState;
    if (isEmbedded && embeddedData) {
      pending = embeddedData;
    } else {
      try {
        pending = JSON.parse(rawPending) as PendingState;
      } catch {
        setError("Dữ liệu khởi tạo bị lỗi. Vui lòng quay lại editor.");
        return;
      }
    }

    const content = pending.lessonContent || "";
    setProjectId(pending.projectId || "");
    setLessonContent(content);
    setProjectTitle(pending.projectTitle || "Bài giảng");

    let initialNumSlides = pending.numSlides || 0;
    if (!initialNumSlides) {
      const wordCount = content.trim().split(/\s+/).length;
      initialNumSlides = Math.max(5, Math.min(15, Math.ceil(wordCount / 60)));
    }
    setNumSlides(initialNumSlides);

    // Try to restore draft
    const draft = loadDraft(pending.projectId || "");
    if (draft && draft.slides.length > 0) {
      const ageMs = Date.now() - draft.savedAt;
      const ageMin = Math.round(ageMs / 60000);
      const ageStr =
        ageMin < 1
          ? "vừa xong"
          : ageMin < 60
            ? `${ageMin} phút trước`
            : `${Math.round(ageMin / 60)} giờ trước`;
      setHasDraft(true);
      setDraftAge(ageStr);
      setSlides(draft.slides);
      setLayouts(draft.layouts ?? {});
      setProjectTitle(
        draft.projectTitle || pending.projectTitle || "Bài giảng",
      );
      setStep("preview");
    } else if (pending.projectId) {
      // Fallback: load cloud draft from backend database
      loadSlidesDraft(pending.projectId)
        .then((cloudDraft) => {
          if (cloudDraft && cloudDraft.slides && cloudDraft.slides.length > 0) {
            setSlides(cloudDraft.slides);
            const restoredLayouts: Record<number, SlideLayout> = {};
            if (cloudDraft.layouts) {
              Object.entries(cloudDraft.layouts).forEach(([k, v]) => {
                restoredLayouts[Number(k)] = v as SlideLayout;
              });
            }
            setLayouts(restoredLayouts);
            if (cloudDraft.title) {
              setProjectTitle(cloudDraft.title);
            }
            setStep("preview");
            saveDraft(
              pending.projectId,
              cloudDraft.title || pending.projectTitle || "Bài giảng",
              cloudDraft.slides,
              restoredLayouts
            );
          }
        })
        .catch((err) => {
          console.error("Lỗi khi tải bản nháp slide từ server:", err);
        });
    }
  }, []);

  // ── Auto-dismiss draft restored notification banner after 6 seconds ───────
  useEffect(() => {
    if (hasDraft) {
      const timer = setTimeout(() => {
        setHasDraft(false);
      }, 6000);
      return () => clearTimeout(timer);
    }
  }, [hasDraft]);

  // ── Auto-save draft whenever slides change ────────────────────────────────
  useEffect(() => {
    if (slides.length === 0 || !projectId) return;
    saveDraft(projectId, projectTitle, slides, layouts);
    // Debounced cloud save (2s after last change)
    if (cloudSaveTimer.current) clearTimeout(cloudSaveTimer.current);
    cloudSaveTimer.current = setTimeout(() => {
      setIsCloudSaving(true);
      saveSlidesDraft(projectId, projectTitle, slides, layouts)
        .then((res) => {
          setCloudSaved(res.saved_at);
        })
        .catch(() => {
          /* cloud save silent fail */
        })
        .finally(() => setIsCloudSaving(false));
    }, 2000);
  }, [slides, projectId, projectTitle, layouts]);

  // ── Safe active slide ─────────────────────────────────────────────────────
  const safeIdx = Math.min(activeIdx, Math.max(0, slides.length - 1));
  const currentSlide = slides[safeIdx] ?? null;

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleGenerate = async (force = false) => {
    if (!lessonContent) return;
    // Warn user if there are existing slides with edits
    if (!force && slides.length > 0) {
      const ok = window.confirm(
        `Bạn có ${slides.length} slide đang chỉnh sửa.\nKhởi tạo lại sẽ xóa toàn bộ nội dung hiện tại.\n\nTiếp tục?`,
      );
      if (!ok) return;
    }
    setStep("generating");
    setProgressVal(0);
    setError("");
    setHasDraft(false);
    setLayouts({});
    setEditTitle(false);
    setEditBullet(null);

    const interval = setInterval(() => {
      setProgressVal((prev) => {
        if (prev >= 95) return prev;
        const increment = prev < 50 ? Math.floor(Math.random() * 6) + 4 : Math.floor(Math.random() * 2) + 1;
        return Math.min(prev + increment, 95);
      });
    }, 450);

    try {
      const res = await generateSlideOutline(lessonContent, numSlides);
      clearInterval(interval);
      setProgressVal(100);
      setTimeout(() => {
        const newSlides = res.slides ?? [];
        setSlides(newSlides);
        setActiveIdx(0);
        setStep("preview");
        saveDraft(projectId, projectTitle, newSlides, {});
      }, 300);
    } catch (e) {
      clearInterval(interval);
      setError(
        e instanceof Error
          ? e.message
          : "Tạo slide thất bại. Vui lòng thử lại.",
      );
      setStep("idle");
    }
  };

  const handleDownload = async () => {
    if (!slides.length) return;
    setStep("downloading");
    setError("");
    try {
      const blob = await downloadPptx(slides, projectTitle);
      // Validate we got actual pptx bytes
      if (blob.size < 100)
        throw new Error("File xuất ra bị rỗng. Vui lòng thử lại.");
      const safe =
        projectTitle
          .replace(/[^\w\s-]/g, "")
          .trim()
          .replace(/\s+/g, "_") || "bai_giang";
      triggerBlobDownload(blob, `${safe}.pptx`);
    } catch (e) {
      setError(await extractErrorMsg(e));
    } finally {
      setStep("preview");
    }
  };

  const handleBack = () => {
    if (isEmbedded && onClose) {
      onClose();
      return;
    }
    if (projectId) window.location.href = `/materials/${projectId}/editor`;
    else {
      window.close();
      window.location.href = "/";
    }
  };

  const handleDownloadPdf = async () => {
    if (!slides.length) return;
    setStep("downloading");
    setError("");
    try {
      const blob = await downloadPdf(slides, projectTitle);
      if (blob.size < 100) throw new Error("File PDF rỗng.");
      const safe =
        projectTitle
          .replace(/[^\w\s-]/g, "")
          .trim()
          .replace(/\s+/g, "_") || "bai_giang";
      triggerBlobDownload(blob, `${safe}.pdf`);
    } catch (e) {
      setError(await extractErrorMsg(e));
    } finally {
      setStep("preview");
    }
  };

  // ── Slide mutation helpers ─────────────────────────────────────────────────

  const updateSlide = useCallback(
    <K extends keyof SlideItem>(idx: number, field: K, value: SlideItem[K]) => {
      setSlides((prev) =>
        prev.map((s, i) => (i === idx ? { ...s, [field]: value } : s)),
      );
    },
    [],
  );

  const updateBullet = useCallback(
    (sIdx: number, bIdx: number, val: string) => {
      setSlides((prev) =>
        prev.map((s, i) => {
          if (i !== sIdx) return s;
          const bp = [...s.bullet_points];
          bp[bIdx] = val;
          return { ...s, bullet_points: bp };
        }),
      );
    },
    [],
  );

  const addBullet = (sIdx: number) => {
    setSlides((prev) =>
      prev.map((s, i) =>
        i === sIdx && s.bullet_points.length < 6
          ? { ...s, bullet_points: [...s.bullet_points, ""] }
          : s,
      ),
    );
  };

  const deleteBullet = (sIdx: number, bIdx: number) => {
    setSlides((prev) =>
      prev.map((s, i) => {
        if (i !== sIdx || s.bullet_points.length <= 1) return s;
        return {
          ...s,
          bullet_points: s.bullet_points.filter((_, bi) => bi !== bIdx),
        };
      }),
    );
  };

  const addSlide = () => {
    const blank: SlideItem = {
      title: "Slide mới",
      bullet_points: ["Nội dung chính"],
      speaker_notes: "",
    };
    setSlides((prev) => {
      const next = [...prev];
      next.splice(safeIdx + 1, 0, blank);
      return next;
    });
    setActiveIdx(safeIdx + 1);
  };

  const duplicateSlide = (idx: number) => {
    const copy: SlideItem = {
      ...slides[idx],
      title: slides[idx].title + " (bản sao)",
      bullet_points: [...slides[idx].bullet_points],
    };
    setSlides((prev) => {
      const next = [...prev];
      next.splice(idx + 1, 0, copy);
      return next;
    });
    setActiveIdx(idx + 1);
  };

  const deleteSlide = (idx: number) => {
    if (slides.length <= 1) return;
    setSlides((prev) => prev.filter((_, i) => i !== idx));
    setActiveIdx((prev) => Math.min(prev, slides.length - 2));
  };

  const moveSlide = (from: number, dir: -1 | 1) => {
    const to = from + dir;
    if (to < 0 || to >= slides.length) return;
    setSlides((prev) => {
      const next = [...prev];
      [next[from], next[to]] = [next[to], next[from]];
      return next;
    });
    setActiveIdx(to);
  };



  // ── Render ────────────────────────────────────────────────────────────────
  const isLoading = step === "generating";
  const isDownloading = step === "downloading";

  return (
    <div className="sp-page" style={S.page}>
      {/* ── Header ── */}
      <header className="sp-header" style={S.header}>
        <button style={{ ...S.btn, ...S.btnGhost }} onClick={handleBack}>
          ← Quay lại
        </button>
        <h1 style={S.title}>🖼️ Tạo Slide tự động</h1>
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <label style={{ fontSize: 13, color: "#94a3b8", display: "flex", alignItems: "center", gap: 6 }}>
            {slides.length === 0 && (
              <span style={{ color: "#6366f1", fontWeight: 600 }}>🤖 AI đề xuất:</span>
            )}
            Số slide:&nbsp;
            <select
              value={numSlides}
              onChange={(e) => setNumSlides(+e.target.value)}
              disabled={isLoading}
              style={S.select}
            >
              {[5, 6, 7, 8, 10, 12, 15].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <button
            style={{ ...S.btn, ...S.btnPrimary, opacity: isLoading ? 0.6 : 1 }}
            onClick={() => handleGenerate()}
            disabled={isLoading || !lessonContent}
          >
            {isLoading ? "⏳ Đang tạo..." : "✨ Khởi tạo Slide"}
          </button>
          


          {slides.length > 0 && (
            <>
              <button
                style={{ ...S.btn, ...S.btnSecondary }}
                onClick={addSlide}
              >
                + Thêm slide
              </button>
              <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                <button
                  style={{ 
                    ...S.btn, 
                    ...S.btnSuccess, 
                    opacity: isDownloading ? 0.7 : 1,
                    borderRadius: "8px",
                  }}
                  onClick={() => setShowExportMenu(!showExportMenu)}
                  disabled={isDownloading || slides.length === 0}
                >
                  {isDownloading ? "⏳ Đang xử lý..." : "⬇ Tải xuống ▾"}
                </button>
                {showExportMenu && (
                  <div
                    style={{
                      position: "absolute",
                      top: "100%",
                      right: 0,
                      marginTop: 4,
                      background: "#fff",
                      border: "1px solid #e2e8f0",
                      borderRadius: 8,
                      boxShadow: "0 10px 15px -3px rgba(0,0,0,0.1)",
                      zIndex: 50,
                      padding: 8,
                      minWidth: 150,
                    }}
                    onMouseLeave={() => setShowExportMenu(false)}
                  >
                    <button
                      style={{
                        display: "block",
                        width: "100%",
                        textAlign: "left",
                        padding: "8px 12px",
                        background: "transparent",
                        border: "none",
                        borderRadius: 6,
                        cursor: "pointer",
                        color: pptxReady === false ? "#94a3b8" : "#1e293b",
                        fontSize: 13,
                        fontWeight: 500,
                      }}
                      onMouseEnter={(e) => {
                        if (pptxReady !== false) e.currentTarget.style.background = "#f1f5f9";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = "transparent";
                      }}
                      onClick={() => {
                        handleDownload();
                        setShowExportMenu(false);
                      }}
                      disabled={pptxReady === false}
                    >
                      📊 Tải PPTX {pptxReady === false && "(Lỗi server)"}
                    </button>
                    <button
                      style={{
                        display: "block",
                        width: "100%",
                        textAlign: "left",
                        padding: "8px 12px",
                        background: "transparent",
                        border: "none",
                        borderRadius: 6,
                        cursor: "pointer",
                        color: "#1e293b",
                        fontSize: 13,
                        fontWeight: 500,
                        marginTop: 4,
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = "#f1f5f9";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = "transparent";
                      }}
                      onClick={() => {
                        handleDownloadPdf();
                        setShowExportMenu(false);
                      }}
                    >
                      📄 Tải PDF
                    </button>
                  </div>
                )}
              </div>
              {/* Cloud save indicator */}
              <span
                style={{
                  fontSize: 11,
                  color: isCloudSaving ? "#f59e0b" : "#22c55e",
                  display: "flex",
                  alignItems: "center",
                  gap: 3,
                  minWidth: 80,
                }}
              >
                {isCloudSaving ? "☁ Đang lưu..." : cloudSaved ? "☁ Đã lưu" : ""}
              </span>

              <button
                onClick={() => setShowRightPanel(!showRightPanel)}
                style={{
                  background: showRightPanel ? "#eff6ff" : "transparent",
                  border: showRightPanel ? "1px solid #bfdbfe" : "1px solid transparent",
                  cursor: "pointer",
                  color: showRightPanel ? "#2563eb" : "#64748b",
                  padding: "6px",
                  borderRadius: 8,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  transition: "all 0.2s",
                }}
                title={showRightPanel ? "Ẩn bảng ghi chú & gợi ý" : "Hiện bảng ghi chú & gợi ý"}
              >
                <PanelRight size={18} />
              </button>
            </>
          )}
        </div>
      </header>

      {/* Draft banner */}
      {hasDraft && (
        <div className="sp-draft-banner" style={S.draftBanner}>
          <span>💾 Đã khôi phục bản nháp ({draftAge}) — {slides.length} slide.</span>
          <button className="sp-draft-btn" style={S.draftBtn} onClick={() => setHasDraft(false)}>
            Đóng
          </button>
        </div>
      )}

      {/* Auto-save indicator */}
      {step === "preview" && slides.length > 0 && !hasDraft && (
        <div className="sp-autosave-badge" style={S.autosaveBadge}>✓ Đã tự lưu</div>
      )}

      {/* pptx not available warning */}
      {pptxReady === false && (
        <div
          style={{
            ...S.errorBanner,
            background: "#fefce8",
            borderColor: "#fde047",
            color: "#854d0e",
          }}
        >
          ⚠ <strong>python-pptx chưa được cài</strong> — tính năng tải .pptx
          không hoạt động.
          <br />
          <code
            style={{
              fontSize: 12,
              background: "#fef9c3",
              padding: "2px 6px",
              borderRadius: 4,
            }}
          >
            docker compose up --build
          </code>
          &nbsp;để rebuild Docker image.
          {pptxError ? ` Chi tiết: ${pptxError}` : ""}
        </div>
      )}

      {/* Other errors */}
      {error && <div style={S.errorBanner}>⚠ {error}</div>}

      {/* Loading */}
      {isLoading && (
        <div style={S.center}>
          <div style={S.spinner} />
          <p style={{ color: "#94a3b8", marginTop: 16, fontSize: 15, fontWeight: 500 }}>
            Đang phân tích nội dung và tạo {numSlides} slide... ({progressVal}%)
          </p>
          <div style={{ width: 240, height: 6, background: "#334155", borderRadius: 3, marginTop: 12, overflow: "hidden" }}>
            <div
              style={{ height: "100%", background: "linear-gradient(90deg, #818cf8, #6366f1)", width: `${progressVal}%`, borderRadius: 3, transition: "width 0.2s ease-out" }}
            />
          </div>
        </div>
      )}

      {/* Two-panel workspace */}
      {step === "preview" && slides.length > 0 && (
        <div className="sp-workspace">
          {/* Sidebar */}
          <aside className="sp-sidebar">
            <p className="sp-sidebar-label">SLIDES ({slides.length})</p>
            <div className="sp-sidebar-slides-list">
              {slides.map((slide, idx) => {
                const type = slideType(idx, slides.length);
                const warn = hasTrimWarning(slide);
                const isActive = safeIdx === idx;
                const typeColor =
                  type === "TITLE"
                    ? "#6366f1"
                    : type === "SUMMARY"
                      ? "#16a34a"
                      : "#0ea5e9";
                const currentLayout = layouts[idx] ?? (slide.diagram ? "two_column" : "standard");
                return (
                  <div
                    key={idx}
                    className={`sp-thumb-container ${isActive ? "active" : ""}`}
                  >
                    {/* Mini visual 16:9 thumbnail */}
                    <button
                      className="sp-thumb-card"
                      title={`${slide.title || "Không có tiêu đề"}\n${(slide.bullet_points || []).map(b => `• ${b}`).join("\n")}${
                        slide.diagram && slide.diagram.nodes && slide.diagram.nodes.length > 0
                          ? `\n\n[Sơ đồ]:\n${slide.diagram.nodes.map(n => `  - ${n.label}`).join("\n")}`
                          : ""
                      }`}
                      onClick={() => {
                        setActiveIdx(idx);
                        setEditTitle(false);
                        setEditBullet(null);
                      }}
                    >
                      <div className="sp-thumb-slide-wrapper">
                        {/* Accent Bar */}
                        <div
                          className="sp-thumb-accent-bar"
                          style={{ background: typeColor }}
                        />
                        {/* Slide Title */}
                        <div className="sp-thumb-title-text">
                          {slide.title || <span className="text-slate-300 italic">Không có tiêu đề</span>}
                        </div>
                        {/* Simulated bullets lines */}
                        <div className="sp-thumb-content-proxy">
                          {currentLayout === "big_title" ? (
                            <div className="sp-thumb-big-title-indicator">Aa</div>
                          ) : currentLayout === "two_column" ? (
                            slide.diagram && slide.diagram.nodes && slide.diagram.nodes.length > 0 ? (
                              <div className="sp-thumb-diagram-proxy">
                                {slide.diagram.nodes.slice(0, 3).map(n => n.label).join(" → ")}
                              </div>
                            ) : (
                              <div className="sp-thumb-columns-proxy">
                                <div className="sp-thumb-col-proxy">
                                  {slide.bullet_points.slice(0, 2).map((bp, bIdx) => (
                                    <div key={bIdx} className="sp-thumb-bullet-text">{bp}</div>
                                  ))}
                                </div>
                                <div className="sp-thumb-col-proxy">
                                  {slide.bullet_points.slice(2, 4).map((bp, bIdx) => (
                                    <div key={bIdx} className="sp-thumb-bullet-text">{bp}</div>
                                  ))}
                                </div>
                              </div>
                            )
                          ) : (
                            <div className="sp-thumb-bullets-proxy">
                              {slide.bullet_points.slice(0, 3).map((bp, bIdx) => (
                                <div key={bIdx} className="sp-thumb-bullet-text">{bp}</div>
                              ))}
                            </div>
                          )}
                        </div>
                        {/* Footer indicator */}
                        <div className="sp-thumb-footer-row">
                          <span className="sp-thumb-type-badge" style={{ color: typeColor }}>{type}</span>
                          <span className="sp-thumb-number-badge">
                            {currentLayout === "big_title" ? "▦" : currentLayout === "two_column" ? "▥" : "▤"} {idx + 1}/{slides.length}
                          </span>
                        </div>
                        {/* Warning badge */}
                        {warn && (
                          <span className="sp-thumb-warn-badge" title="Vi phạm quy tắc thiết kế 6x6">⚠</span>
                        )}
                      </div>
                    </button>
                    {/* Slide controls */}
                    {isActive && (
                      <div className="sp-thumb-actions-bar">
                        <button
                          className="sp-thumb-action-btn"
                          onClick={() => moveSlide(idx, -1)}
                          disabled={idx === 0}
                          title="Di chuyển lên"
                        >
                          <ArrowUp size={11} />
                        </button>
                        <button
                          className="sp-thumb-action-btn"
                          onClick={() => moveSlide(idx, 1)}
                          disabled={idx === slides.length - 1}
                          title="Di chuyển xuống"
                        >
                          <ArrowDown size={11} />
                        </button>
                        <button
                          className="sp-thumb-action-btn text-indigo-500"
                          onClick={() => duplicateSlide(idx)}
                          title="Nhân bản slide"
                        >
                          <Copy size={11} />
                        </button>
                        <button
                          className="sp-thumb-action-btn text-rose-500"
                          onClick={() => deleteSlide(idx)}
                          disabled={slides.length <= 1}
                          title="Xóa slide"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </aside>

          {/* Center Column: Slide Canvas */}
          {currentSlide && (
            <main className="sp-center-main">
              <div className="sp-canvas-container">
                <SlideCanvas
                  slide={currentSlide}
                  slideIndex={safeIdx}
                  totalSlides={slides.length}
                  layout={layouts[safeIdx] ?? (currentSlide.diagram ? "two_column" : "standard")}
                  editTitle={editTitle}
                  editBullet={editBullet}
                  onTitleClick={() => setEditTitle(true)}
                  onTitleChange={(val) => updateSlide(safeIdx, "title", val)}
                  onTitleBlur={() => setEditTitle(false)}
                  onBulletClick={(i) => setEditBullet(i)}
                  onBulletChange={(i, val) => updateBullet(safeIdx, i, val)}
                  onBulletBlur={() => setEditBullet(null)}
                  onDeleteBullet={(i) => deleteBullet(safeIdx, i)}
                  onAddBullet={() => addBullet(safeIdx)}
                  onUpdateDiagram={(diag) => updateSlide(safeIdx, "diagram", diag)}
                />
              </div>
            </main>
          )}

          {/* Right Column: AI Assistant & Notes Panel */}
          {showRightPanel && currentSlide && (
            <aside className="sp-right-panel">
              {/* Tab Header (Segmented control) */}
              <div className="sp-right-panel-header">
                <div className="sp-right-tabs-control">
                  <button
                    onClick={() => setActiveRightTab("notes")}
                    className={`sp-right-tab-btn ${activeRightTab === "notes" ? "active" : ""}`}
                  >
                    <FileText size={14} />
                    <span>Thuyết trình</span>
                  </button>
                  <button
                    onClick={() => setActiveRightTab("design")}
                    className={`sp-right-tab-btn ${activeRightTab === "design" ? "active" : ""}`}
                  >
                    <Layout size={14} />
                    <span>Thiết kế</span>
                  </button>
                </div>
              </div>

              <div className="sp-right-panel-body custom-scrollbar">
                {activeRightTab === "notes" ? (
                  <div className="space-y-4">
                    {/* Duration */}
                    <div className="sp-right-card sp-right-duration-card">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider flex items-center gap-1.5">
                          <Clock size={12} />
                          Thời lượng dự kiến
                        </span>
                        <span className="text-xs font-semibold text-emerald-600">Dự kiến trình bày</span>
                      </div>
                      <div className="text-2xl font-extrabold text-emerald-700 mt-1">
                        {currentSlide.estimated_duration || 60}s
                      </div>
                    </div>

                    {/* Speaker Notes */}
                    <div className="sp-right-card bg-white border border-slate-100">
                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                        Ghi chú diễn thuyết
                      </label>
                      <textarea
                        value={currentSlide.speaker_notes}
                        onChange={(e) =>
                          updateSlide(safeIdx, "speaker_notes", e.target.value)
                        }
                        placeholder="Nhập ghi chú cho người thuyết trình..."
                        className="sp-right-textarea focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 transition-all duration-200"
                        rows={5}
                      />
                    </div>

                    {/* Talking Points */}
                    <div className="sp-right-card bg-slate-50 border border-slate-100">
                      <span className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
                        <Sparkles size={12} className="text-blue-600" />
                        Kịch bản gợi ý
                      </span>
                      <ul className="space-y-2 text-xs text-slate-700 leading-relaxed font-medium pl-4 list-disc">
                        {(currentSlide.talking_points || []).length > 0 ? (
                          currentSlide.talking_points?.map((pt, i) => (
                            <li key={i} className="pl-0.5">{pt}</li>
                          ))
                        ) : (
                          <li className="text-slate-400 italic list-none pl-0">Chưa có kịch bản gợi ý cho slide này.</li>
                        )}
                      </ul>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Slide Layout Selection */}
                    <div className="sp-right-card bg-white border border-slate-100">
                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-3">
                        Chọn Bố cục Slide (Layout)
                      </label>
                      <div className="grid grid-cols-3 gap-2">
                        {LAYOUTS.map((l) => {
                          const active = (layouts[safeIdx] ?? (currentSlide.diagram ? "two_column" : "standard")) === l.id;
                          return (
                            <button
                              key={l.id}
                              onClick={() =>
                                setLayouts((prev) => ({ ...prev, [safeIdx]: l.id }))
                              }
                              title={l.description}
                              className={`flex flex-col items-center justify-center p-2.5 rounded-xl border transition-all duration-200 cursor-pointer ${
                                active
                                  ? "bg-blue-50/50 border-blue-500 text-blue-600 shadow-sm"
                                  : "border-slate-100 hover:border-slate-200 text-slate-500 hover:text-slate-700 bg-slate-50/50"
                              }`}
                            >
                              <span className="text-lg font-bold mb-1">{l.icon}</span>
                              <span className="text-[10px] font-bold tracking-tight">{l.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Visual Suggestion */}
                    {currentSlide.visual_prompt && (
                      <div className="sp-right-card bg-blue-50/30 border border-blue-100/50">
                        <span className="block text-[10px] font-bold text-blue-700 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                          💡 Ý nghĩa & Ý tưởng thiết kế sơ đồ
                        </span>
                        <p className="text-xs text-blue-900 leading-relaxed font-semibold">
                          {currentSlide.visual_prompt}
                        </p>
                      </div>
                    )}

                    {/* Diagram Editor */}
                    <div className="sp-right-card bg-white border border-slate-100">
                      <div className="flex items-center justify-between mb-3">
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                          Sơ đồ tương tác (Flowchart)
                        </label>
                        {currentSlide.diagram ? (
                          <button
                            onClick={() => updateSlide(safeIdx, "diagram", undefined)}
                            className="text-[10px] text-rose-500 hover:text-rose-700 font-semibold border-none bg-transparent cursor-pointer"
                          >
                            Xóa sơ đồ
                          </button>
                        ) : (
                          <button
                            onClick={() => {
                              updateSlide(safeIdx, "diagram", {
                                nodes: [
                                  { id: "A", label: "Bắt đầu" },
                                  { id: "B", label: "Kết thúc" }
                                ],
                                links: [
                                  { source: "A", target: "B", label: "Liên kết" }
                                ]
                              });
                              // Automatically switch layout to two_column to display the diagram!
                              setLayouts(prev => ({ ...prev, [safeIdx]: "two_column" }));
                            }}
                            className="text-[10px] text-indigo-600 hover:text-indigo-800 font-semibold border-none bg-transparent cursor-pointer"
                          >
                            + Tạo sơ đồ mới
                          </button>
                        )}
                      </div>

                      {currentSlide.diagram && (
                        <div className="space-y-4">
                          {/* Nodes list */}
                          <div className="border-t border-slate-50 pt-2.5">
                            <span className="block text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-2">Các thành phần (Nodes)</span>
                            <div className="space-y-2">
                              {currentSlide.diagram.nodes.map((node, nIdx) => (
                                <div key={node.id} className="flex items-center gap-1.5">
                                  <span className="text-[10px] font-bold text-indigo-500 bg-indigo-50 w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0">
                                    {node.id}
                                  </span>
                                  <input
                                    type="text"
                                    value={node.label}
                                    onChange={(e) => {
                                      const nextNodes = [...(currentSlide.diagram?.nodes || [])];
                                      nextNodes[nIdx] = { ...node, label: e.target.value };
                                      updateSlide(safeIdx, "diagram", {
                                        ...currentSlide.diagram!,
                                        nodes: nextNodes
                                      });
                                    }}
                                    placeholder="Tên thành phần..."
                                    className="flex-1 text-xs border border-slate-200 rounded px-2 py-1 outline-none focus:border-indigo-500 bg-slate-50/50"
                                  />
                                  <button
                                    onClick={() => {
                                      const nextNodes = (currentSlide.diagram?.nodes || []).filter(n => n.id !== node.id);
                                      const nextLinks = (currentSlide.diagram?.links || []).filter(l => l.source !== node.id && l.target !== node.id);
                                      updateSlide(safeIdx, "diagram", {
                                        nodes: nextNodes,
                                        links: nextLinks
                                      });
                                    }}
                                    disabled={(currentSlide.diagram?.nodes || []).length <= 1}
                                    className="p-1 text-slate-400 hover:text-rose-500 disabled:opacity-30 border-none bg-transparent cursor-pointer"
                                  >
                                    ✕
                                  </button>
                                </div>
                              ))}
                            </div>
                            <button
                              onClick={() => {
                                const nextNodes = [...(currentSlide.diagram?.nodes || [])];
                                const lastId = nextNodes.length > 0 ? nextNodes[nextNodes.length - 1].id : "@";
                                const newId = String.fromCharCode(lastId.charCodeAt(0) + 1);
                                nextNodes.push({ id: newId, label: `Thành phần ${newId}` });
                                updateSlide(safeIdx, "diagram", {
                                  ...(currentSlide.diagram || { links: [] }),
                                  nodes: nextNodes
                                });
                              }}
                              className="text-[10px] font-bold text-indigo-600 hover:text-indigo-800 bg-transparent border-none cursor-pointer mt-2"
                            >
                              + Thêm thành phần
                            </button>
                          </div>

                          {/* Links list */}
                          <div className="border-t border-slate-50 pt-2.5">
                            <span className="block text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-2">Các kết nối (Links)</span>
                            <div className="space-y-2 max-h-[150px] overflow-y-auto custom-scrollbar pr-1">
                              {currentSlide.diagram.links.map((link, lIdx) => (
                                <div key={lIdx} className="flex items-center gap-1 bg-slate-50/50 p-1.5 rounded border border-slate-100">
                                  <select
                                    value={link.source}
                                    onChange={(e) => {
                                      const nextLinks = [...(currentSlide.diagram?.links || [])];
                                      nextLinks[lIdx] = { ...link, source: e.target.value };
                                      updateSlide(safeIdx, "diagram", {
                                        ...currentSlide.diagram!,
                                        links: nextLinks
                                      });
                                    }}
                                    className="text-[10px] border border-slate-200 rounded p-0.5 outline-none font-bold text-indigo-600 bg-white"
                                  >
                                    {currentSlide.diagram?.nodes.map(n => (
                                      <option key={n.id} value={n.id}>{n.id}</option>
                                    ))}
                                  </select>
                                  <span className="text-[9px] text-slate-400">→</span>
                                  <select
                                    value={link.target}
                                    onChange={(e) => {
                                      const nextLinks = [...(currentSlide.diagram?.links || [])];
                                      nextLinks[lIdx] = { ...link, target: e.target.value };
                                      updateSlide(safeIdx, "diagram", {
                                        ...currentSlide.diagram!,
                                        links: nextLinks
                                      });
                                    }}
                                    className="text-[10px] border border-slate-200 rounded p-0.5 outline-none font-bold text-indigo-600 bg-white"
                                  >
                                    {currentSlide.diagram?.nodes.map(n => (
                                      <option key={n.id} value={n.id}>{n.id}</option>
                                    ))}
                                  </select>
                                  <input
                                    type="text"
                                    value={link.label || ""}
                                    onChange={(e) => {
                                      const nextLinks = [...(currentSlide.diagram?.links || [])];
                                      nextLinks[lIdx] = { ...link, label: e.target.value };
                                      updateSlide(safeIdx, "diagram", {
                                        ...currentSlide.diagram!,
                                        links: nextLinks
                                      });
                                    }}
                                    placeholder="Nhãn liên kết..."
                                    className="flex-1 text-[10px] border border-slate-200 rounded px-1 py-0.5 outline-none bg-white"
                                  />
                                  <button
                                    onClick={() => {
                                      const nextLinks = (currentSlide.diagram?.links || []).filter((_, li) => li !== lIdx);
                                      updateSlide(safeIdx, "diagram", {
                                        ...currentSlide.diagram!,
                                        links: nextLinks
                                      });
                                    }}
                                    className="p-0.5 text-slate-400 hover:text-rose-500 border-none bg-transparent cursor-pointer"
                                  >
                                    ✕
                                  </button>
                                </div>
                              ))}
                            </div>
                            <button
                              onClick={() => {
                                const nodesList = currentSlide.diagram?.nodes || [];
                                if (nodesList.length < 2) return;
                                const nextLinks = [...(currentSlide.diagram?.links || [])];
                                nextLinks.push({
                                  source: nodesList[0].id,
                                  target: nodesList[1].id,
                                  label: "liên kết"
                                });
                                updateSlide(safeIdx, "diagram", {
                                  ...currentSlide.diagram!,
                                  links: nextLinks
                                });
                              }}
                              disabled={(currentSlide.diagram?.nodes || []).length < 2}
                              className="text-[10px] font-bold text-indigo-600 hover:text-indigo-800 bg-transparent border-none cursor-pointer mt-2 disabled:opacity-30"
                            >
                              + Thêm kết nối
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </aside>
          )}
        </div>
      )}

      {/* Empty / idle */}
      {step === "idle" && !error && (
        <div className="sp-center">
          <div style={{ fontSize: 56, marginBottom: 12 }}>🖼️</div>
          <p className="sp-idle-text">
            Nhấn <strong>✨ Khởi tạo Slide</strong> để tạo từ nội dung bài giảng.
            <br />
            <span style={{ fontSize: 13, color: "#94a3b8" }}>
              Chỉnh sửa tiêu đề, bullet và ghi chú trực tiếp. Bản nháp tự lưu.
            </span>
          </p>
        </div>
      )}

      {/* Mobile bottom slide nav bar */}
      {step === "preview" && slides.length > 0 && (
        <nav className="sp-slide-nav-bar" aria-label="Danh sách slide">
          {slides.map((slide, idx) => (
            <button
              key={idx}
              className={`sp-slide-nav-pill${safeIdx === idx ? " active" : ""}`}
              onClick={() => {
                setActiveIdx(idx);
                setEditTitle(false);
                setEditBullet(null);
                // Scroll canvas into view on mobile
                document.querySelector(".sp-center-main")?.scrollTo({ top: 0, behavior: "smooth" });
              }}
              title={slide.title}
            >
              {idx + 1}
              {hasTrimWarning(slide) && " ⚠"}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
