import { useCallback, useEffect, useRef, useState } from "react";
import {
  checkSlidesHealth,
  downloadPdf,
  downloadPptx,
  generateSlideOutline,
  saveSlidesDraft,
  uploadTemplate,
  type SlideItem,
} from "../services/api";
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

  const [templatePath, setTemplatePath] = useState<string>("");
  const [templateName, setTemplateName] = useState<string>("");
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Inline edit state
  const [editTitle, setEditTitle] = useState(false);
  const [editBullet, setEditBullet] = useState<number | null>(null);
  const [showExportMenu, setShowExportMenu] = useState(false);

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
    }
  }, []);

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
    setError("");
    setHasDraft(false);
    setLayouts({});
    setEditTitle(false);
    setEditBullet(null);
    try {
      const res = await generateSlideOutline(lessonContent, numSlides);
      const newSlides = res.slides ?? [];
      setSlides(newSlides);
      setActiveIdx(0);
      setStep("preview");
      saveDraft(projectId, projectTitle, newSlides, {});
    } catch (e) {
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
      const blob = await downloadPptx(slides, projectTitle, templatePath);
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

  const clearDraft = () => {
    localStorage.removeItem(DRAFT_KEY);
    setHasDraft(false);
    setSlides([]);
    setStep("idle");
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

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pptx")) {
      setError("Chỉ hỗ trợ file .pptx");
      return;
    }
    setIsUploading(true);
    setError("");
    try {
      const res = await uploadTemplate(file);
      if (res.success) {
        setTemplatePath(res.template_path);
        setTemplateName(res.filename);
      }
    } catch (err: any) {
      setError("Upload template thất bại: " + err.message);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
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
          
          <input 
            type="file" 
            accept=".pptx" 
            ref={fileInputRef} 
            style={{ display: "none" }} 
            onChange={handleFileUpload} 
          />
          <button
            style={{ ...S.btn, ...S.btnSecondary, position: "relative" }}
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            title={templateName ? `Đang dùng mẫu: ${templateName}` : "Tải lên file PPTX làm mẫu slide"}
          >
            {isUploading ? "⏳ Tải lên..." : templateName ? `🎨 Mẫu: ${templateName.slice(0, 15)}...` : "🎨 Chọn Template"}
            {templateName && (
              <span 
                style={{ 
                  position: "absolute", top: -5, right: -5, background: "#ef4444", 
                  color: "#fff", borderRadius: "50%", width: 16, height: 16, 
                  fontSize: 10, display: "flex", alignItems: "center", justifyContent: "center"
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  setTemplatePath("");
                  setTemplateName("");
                }}
              >
                ✕
              </span>
            )}
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
            </>
          )}
        </div>
      </header>

      {/* Draft banner */}
      {hasDraft && (
        <div className="sp-draft-banner" style={S.draftBanner}>
          💾 Đã khôi phục bản nháp ({draftAge}) — {slides.length} slide.
          <button className="sp-draft-btn" style={S.draftBtn} onClick={clearDraft}>
            Xóa bản nháp
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
          <p style={{ color: "#94a3b8", marginTop: 16 }}>
            Đang phân tích nội dung và tạo {numSlides} slide...
          </p>
        </div>
      )}

      {/* Two-panel workspace */}
      {step === "preview" && slides.length > 0 && (
        <div className="sp-workspace" style={S.workspace}>
          {/* Sidebar */}
          <aside className="sp-sidebar" style={S.sidebar}>
            <p className="sp-sidebar-label" style={S.sidebarLabel}>SLIDE ({slides.length})</p>
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
              const layoutIcon = LAYOUTS.find((l) => l.id === (layouts[idx] ?? "standard"))?.icon ?? "▤";
              return (
                <div
                  key={idx}
                  style={{ position: "relative", marginBottom: 6 }}
                >
                  {/* Mini visual thumbnail */}
                  <button
                    className="thumb-card"
                    style={{
                      display: "block",
                      width: "100%",
                      border: isActive
                        ? "2px solid #6366f1"
                        : "2px solid transparent",
                      borderRadius: 8,
                      padding: 0,
                      cursor: "pointer",
                      background: "transparent",
                      textAlign: "left",
                      boxShadow: isActive ? "0 0 0 3px #6366f133" : "none",
                      transition: "all 0.15s",
                    }}
                    onClick={() => {
                      setActiveIdx(idx);
                      setEditTitle(false);
                      setEditBullet(null);
                    }}
                  >
                    {/* Mini PPTX-style card */}
                    <div
                      style={{
                        background: isActive ? "#162032" : "#0f172a",
                        borderRadius: 6,
                        padding: "8px 10px 8px 14px",
                        position: "relative",
                        overflow: "hidden",
                        minHeight: 62,
                      }}
                    >
                      <div
                        style={{
                          position: "absolute",
                          left: 0,
                          top: 0,
                          bottom: 0,
                          width: 4,
                          background: typeColor,
                          borderRadius: "6px 0 0 6px",
                        }}
                      />
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "flex-start",
                          marginBottom: 3,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 9,
                            fontWeight: 700,
                            color: typeColor,
                            textTransform: "uppercase",
                            letterSpacing: "0.06em",
                          }}
                        >
                          {type}
                        </span>
                        <span style={{ fontSize: 9, color: "#475569", display: "flex", alignItems: "center", gap: 3 }}>
                          <span title={`Layout: ${layouts[idx] ?? "standard"}`} style={{ fontSize: 10 }}>{layoutIcon}</span>
                          {idx + 1}/{slides.length}
                        </span>
                      </div>
                      <p
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          color: "#e2e8f0",
                          margin: 0,
                          lineHeight: 1.4,
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                        }}
                      >
                        {slide.title}
                      </p>
                      {slide.bullet_points.slice(0, 3).map((b, i) => (
                        <p
                          key={i}
                          style={{
                            fontSize: 8,
                            color: "#64748b",
                            margin: "2px 0 0",
                            overflow: "hidden",
                            whiteSpace: "nowrap",
                            textOverflow: "ellipsis",
                          }}
                        >
                          ▸ {b}
                        </p>
                      ))}
                      {warn && (
                        <span
                          style={{
                            position: "absolute",
                            top: 6,
                            right: 6,
                            fontSize: 9,
                            background: "#f59e0b",
                            color: "#fff",
                            borderRadius: 3,
                            padding: "1px 4px",
                          }}
                        >
                          ⚠
                        </span>
                      )}
                    </div>
                  </button>
                  {/* Move/duplicate/delete actions */}
                  {isActive && (
                    <div
                      style={{
                        display: "flex",
                        gap: 2,
                        padding: "3px 4px 0",
                        justifyContent: "flex-end",
                      }}
                    >
                      <button
                        style={S.microBtn}
                        onClick={() => moveSlide(idx, -1)}
                        disabled={idx === 0}
                        title="Di chuyển lên"
                      >
                        ↑
                      </button>
                      <button
                        style={S.microBtn}
                        onClick={() => moveSlide(idx, 1)}
                        disabled={idx === slides.length - 1}
                        title="Di chuyển xuống"
                      >
                        ↓
                      </button>
                      <button
                        style={{ ...S.microBtn, color: "#a78bfa" }}
                        onClick={() => duplicateSlide(idx)}
                        title="Nhân bản slide"
                      >
                        ⧉
                      </button>
                      <button
                        style={{ ...S.microBtn, color: "#ef4444" }}
                        onClick={() => deleteSlide(idx)}
                        disabled={slides.length <= 1}
                        title="Xóa slide"
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </aside>

          {/* Main canvas + notes */}
          {currentSlide && (
            <main className="sp-main" style={S.main}>
              {/* Layout selector toolbar */}
              <div
                style={{
                  display: "flex",
                  gap: 6,
                  alignItems: "center",
                  marginBottom: 8,
                  maxWidth: 900,
                }}
              >
                <span
                  style={{
                    fontSize: 11,
                    color: "#94a3b8",
                    fontWeight: 600,
                    letterSpacing: "0.05em",
                  }}
                >
                  LAYOUT
                </span>
                {LAYOUTS.map((l) => {
                  const active = (layouts[safeIdx] ?? "standard") === l.id;
                  return (
                    <button
                      key={l.id}
                      onClick={() =>
                        setLayouts((prev) => ({ ...prev, [safeIdx]: l.id }))
                      }
                      title={l.description}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        padding: "4px 10px",
                        borderRadius: 6,
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: "pointer",
                        border: "none",
                        transition: "all 0.15s",
                        background: active ? ACCENT : "#f1f5f9",
                        color: active ? "#fff" : "#64748b",
                        boxShadow: active ? "0 2px 8px #6366f140" : "none",
                      }}
                    >
                      <span style={{ fontSize: 14 }}>{l.icon}</span>
                      {l.label}
                    </button>
                  );
                })}
              </div>

              <SlideCanvas
                slide={currentSlide}
                slideIndex={safeIdx}
                totalSlides={slides.length}
                layout={layouts[safeIdx] ?? "standard"}
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
              />

              {/* Speaker notes */}
              <div className="sp-notes-box">
                <span className="sp-notes-label">📝 Ghi chú diễn thuyết</span>
                <textarea
                  value={currentSlide.speaker_notes}
                  onChange={(e) =>
                    updateSlide(safeIdx, "speaker_notes", e.target.value)
                  }
                  placeholder="Nhập ghi chú cho người thuyết trình..."
                  className="sp-notes-textarea"
                  rows={2}
                />
              </div>

              {/* Smart Delivery Guidance */}
              <div
                style={{
                  maxWidth: 900,
                  display: "grid",
                  gridTemplateColumns: "1fr 180px",
                  gap: 12,
                  marginBottom: 12,
                }}
              >
                {/* Talking Points */}
                <div
                  style={{
                    background: "#f8fafc",
                    border: "1px solid #e2e8f0",
                    borderRadius: 10,
                    padding: "12px",
                  }}
                >
                  <span
                    style={{
                      display: "block",
                      fontSize: 11,
                      fontWeight: 700,
                      color: "#64748b",
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      marginBottom: 8,
                    }}
                  >
                    💡 Kịch bản gợi ý
                  </span>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "#334155" }}>
                    {(currentSlide.talking_points || []).length > 0 ? (
                      currentSlide.talking_points?.map((pt, i) => <li key={i} style={{ marginBottom: 4 }}>{pt}</li>)
                    ) : (
                      <li style={{ color: "#94a3b8", fontStyle: "italic" }}>Chưa có kịch bản gợi ý cho slide này.</li>
                    )}
                  </ul>
                </div>

                {/* Duration */}
                <div
                  style={{
                    background: "#f0fdf4",
                    border: "1px solid #dcfce7",
                    borderRadius: 10,
                    padding: "12px",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#166534", textTransform: "uppercase", marginBottom: 4 }}>
                    ⏱ Thời lượng
                  </span>
                  <div style={{ fontSize: 24, fontWeight: 800, color: "#15803d" }}>
                    {currentSlide.estimated_duration || 60}s
                  </div>
                  <span style={{ fontSize: 11, color: "#16a34a" }}>Dự kiến trình bày</span>
                </div>
              </div>

              {/* Visual suggestion — shown only when AI provided one */}
              {currentSlide.visual_prompt && (
                <div
                  style={{
                    maxWidth: 900,
                    background: "linear-gradient(135deg, #eef2ff 0%, #f0f9ff 100%)",
                    border: "1.5px solid #c7d2fe",
                    borderRadius: 10,
                    padding: "12px 16px",
                    display: "flex",
                    gap: 12,
                    alignItems: "flex-start",
                  }}
                >
                  <span style={{ fontSize: 22, lineHeight: 1 }}>🖼️</span>
                  <div>
                    <p
                      style={{
                        margin: "0 0 4px 0",
                        fontSize: 11,
                        fontWeight: 700,
                        letterSpacing: "0.07em",
                        color: "#4f46e5",
                        textTransform: "uppercase",
                      }}
                    >
                      Gợi ý hình ảnh / sơ đồ
                    </p>
                    <p
                      style={{
                        margin: 0,
                        fontSize: 13,
                        color: "#1e40af",
                        lineHeight: 1.5,
                      }}
                    >
                      {currentSlide.visual_prompt}
                    </p>
                  </div>
                </div>
              )}

            </main>
          )}
        </div>
      )}

      {/* Empty / idle */}
      {step === "idle" && !error && (
        <div className="sp-center">
          <div style={{ fontSize: 56, marginBottom: 12 }}>🖼️</div>
          <p className="sp-idle-text">
            Nhấn <strong>✨ Khởi tạo Slide</strong> để tạo từ nội dung bài
            giảng.
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
                document.querySelector(".sp-main")?.scrollTo({ top: 0, behavior: "smooth" });
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
