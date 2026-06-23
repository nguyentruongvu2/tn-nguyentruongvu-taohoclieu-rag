import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { EnhancedMarkdownRenderer } from "../components/EnhancedMarkdownRenderer";
import { ChevronDown, Download, Eye, RefreshCw } from "lucide-react";
import {
  exportEditorProject,
  getEditorProjectDetail,
  patchEditorSection,
  type EditorProjectExportFormat,
  type EditorSection,
} from "../services/api";
import { toastService } from "../services/toastService";

const EXPORT_LABELS: Record<EditorProjectExportFormat, string> = {
  md: "Markdown (.md)",
  pdf: "PDF (.pdf)",
  docx: "Word (.docx)",
};

const EXPORT_FORMATS: EditorProjectExportFormat[] = ["md", "pdf", "docx"];

interface PreviewProject {
  id: string;
  title: string;
  description: string;
  sections: EditorSection[];
}

interface EditableSection {
  id: string;
  title: string;
  content: string;
  order: number;
  level: number;
}

function normalizeHeading(text: string): string {
  return (text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripSourceCitations(text: string): string {
  const normalized = String(text || "");
  if (!normalized.trim()) return "";

  const cleaned = normalized
    .replace(/^\s*(?:[-*•]\s+)?📚\s*Nguồn\s*:\s*.*$/gim, "")
    .replace(/\n{0,2}📚\s*Nguồn\s*:\s*\n(?:\s*[-*•]\s+.*(?:\n|$))+/gis, "\n")
    .replace(/^\s*---\s*\*?\s*(nguồn|nguon)\s*:[^\n]*\*?\s*$/gim, "")
    .replace(/\[([^\]]+)\]\(#source:[^)]+\)/gi, "$1")
    .replace(/\n{3,}/g, "\n\n");

  return cleaned.trim();
}

function removeDuplicateHeading(content: string, sectionTitle: string): string {
  const lines = (content || "").split("\n");
  if (!lines.length) return content;

  const target = normalizeHeading(sectionTitle);
  let idx = 0;
  while (idx < lines.length && !lines[idx].trim()) idx += 1;
  if (idx >= lines.length) return content;

  const first = lines[idx].replace(/^#{1,6}\s+/, "").trim();
  if (normalizeHeading(first) === target) {
    lines.splice(idx, 1);
    while (idx < lines.length && !lines[idx].trim()) lines.splice(idx, 1);
  }
  return lines.join("\n").trim();
}

function inferLevelFromTitle(title: string): number {
  const normalized = (title || "").trim();
  if (
    normalized.toLowerCase().startsWith("chương") ||
    normalized.toLowerCase().startsWith("chuong")
  ) {
    return 1;
  }
  const matched = normalized.match(/^(\d+(?:\.\d+)*)/);
  if (!matched) return 1;
  return Math.max(1, matched[1].split(".").length);
}

function buildPreviewMarkdown(project: PreviewProject): string {
  const ordered = [...(project.sections || [])].sort(
    (a, b) => (a.order_index || 0) - (b.order_index || 0),
  );

  const lines: string[] = [];
  lines.push(`# ${project.title || "Bài giảng"}`);
  lines.push("");

  if ((project.description || "").trim()) {
    lines.push(project.description.trim());
    lines.push("");
  }

  for (const section of ordered) {
    const level = Math.max(1, Math.min(5, Number(section.level || inferLevelFromTitle(section.title || ""))));
    const headingPrefix = "#".repeat(level + 1);
    lines.push(`${headingPrefix} ${section.title || "Mục chưa đặt tên"}`);
    lines.push("");
    lines.push(
      removeDuplicateHeading(
        (section.content_markdown || "").trim(),
        section.title || "",
      ),
    );
    lines.push("");
  }

  return `${lines.join("\n").trim()}\n`;
}

function normalizeMarkdownForPreview(text: string): string {
  return (text || "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
}

export default function TeachingMaterialPreview() {
  const { id } = useParams();
  const projectId = String(id || "");
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [project, setProject] = useState<PreviewProject | null>(null);
  const [editableSections, setEditableSections] = useState<EditableSection[]>(
    [],
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastSyncedAt, setLastSyncedAt] = useState<string>("");
  const [isDownloadMenuOpen, setIsDownloadMenuOpen] = useState(false);
  const [exportingFormat, setExportingFormat] =
    useState<EditorProjectExportFormat | null>(null);
  const downloadMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!projectId) return;

    let mounted = true;

    const fetchProject = async () => {
      try {
        const data = await getEditorProjectDetail(projectId);
        if (!mounted) return;

        setProject({
          id: data.id,
          title: data.title,
          description: data.description,
          sections: data.sections || [],
        });
        const mapped: EditableSection[] = (data.sections || []).map((s) => ({
          id: s.id,
          title: s.title,
          content: stripSourceCitations(s.content_markdown || ""),
          order: s.order_index || 0,
          level: s.level || inferLevelFromTitle(s.title || ""),
        }));
        setEditableSections(mapped);
        setError("");
        setLastSyncedAt(new Date().toLocaleTimeString("vi-VN"));
      } catch (e) {
        if (!mounted) return;
        setError(
          e instanceof Error ? e.message : "Không tải được nội dung xem trước",
        );
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void fetchProject();
    const timer = window.setInterval(() => {
      void fetchProject();
    }, 2000);

    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, [projectId]);

  useEffect(() => {
    if (!isDownloadMenuOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (
        downloadMenuRef.current &&
        !downloadMenuRef.current.contains(event.target as Node)
      ) {
        setIsDownloadMenuOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsDownloadMenuOpen(false);
      }
    };

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [isDownloadMenuOpen]);

  useEffect(() => {
    const handleReplacePlaceholder = async (e: Event) => {
      const customEvent = e as CustomEvent<{ placeholderSrc: string; newSrc: string }>;
      const { placeholderSrc, newSrc } = customEvent.detail;
      
      let decodedSrc = placeholderSrc;
      try {
        decodedSrc = decodeURIComponent(placeholderSrc);
      } catch {}

      const targetSection = editableSections.find(
        (s) => s.content.includes(decodedSrc) || s.content.includes(placeholderSrc)
      );

      if (targetSection) {
        let updatedContent = targetSection.content;
        if (targetSection.content.includes(decodedSrc)) {
          updatedContent = targetSection.content.replace(decodedSrc, newSrc);
        } else {
          updatedContent = targetSection.content.replace(placeholderSrc, newSrc);
        }

        // Optimistically update local state so it renders immediately
        setEditableSections((prev) =>
          prev.map((s) => (s.id === targetSection.id ? { ...s, content: updatedContent } : s))
        );

        try {
          await patchEditorSection(targetSection.id, {
            content: updatedContent,
          });
          toastService.success("Đã thay thế placeholder bằng hình ảnh thành công!");
        } catch (err) {
          console.error("Failed to save image URL:", err);
          toastService.error("Không thể lưu URL hình ảnh lên máy chủ");
        }
      }
    };

    window.addEventListener("replace-placeholder", handleReplacePlaceholder);
    return () => {
      window.removeEventListener("replace-placeholder", handleReplacePlaceholder);
    };
  }, [editableSections]);

  const handleExportProject = async (format: EditorProjectExportFormat) => {
    if (!projectId) return;
    setIsDownloadMenuOpen(false);
    setExportingFormat(format);

    try {
      const blob = await exportEditorProject(projectId, format);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(project?.title || "teaching_project").replace(/\s+/g, "_")}.${format}`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      const fallbackMessage = `Xuất ${EXPORT_LABELS[format]} thất bại`;
      setError(e instanceof Error ? e.message : fallbackMessage);
    } finally {
      setExportingFormat(null);
    }
  };

  const markdown = useMemo(() => {
    if (!project) return "";
    const projected: PreviewProject = {
      ...project,
      sections: editableSections.map((s) => ({
        id: s.id,
        project_id: project.id,
        title: s.title,
        content_markdown: s.content,
        prompt: "",
        order_index: s.order,
        level: s.level,
        updated_at: "",
      })),
    };
    return normalizeMarkdownForPreview(buildPreviewMarkdown(projected));
  }, [editableSections, project]);

  const backToEditor = () => {
    const section = searchParams.get("section") || "";
    const target = section
      ? `/materials/${projectId}/editor?section=${encodeURIComponent(section)}`
      : `/materials/${projectId}/editor`;
    navigate(target);
  };

  return (
    <div className="h-screen w-full overflow-y-auto bg-slate-50">
      <header className="sticky top-0 z-10 bg-white border-b px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={backToEditor}
            className="px-3.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold transition-colors flex items-center gap-1 border border-slate-200"
          >
            ← Quay lại
          </button>
          <div className="h-5 w-px bg-slate-200"></div>
          <div className="flex items-center gap-3">
            <Eye size={20} className="text-blue-600" />
            <div>
              <h1 className="font-semibold text-slate-800">
                Xem nội dung đã lưu
              </h1>
              <p className="text-xs text-slate-500">
                Tự động cập nhật mỗi 2 giây theo dữ liệu đã lưu
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {lastSyncedAt && (
            <span className="text-xs text-slate-500 flex items-center gap-1">
              <RefreshCw size={12} /> Đồng bộ lúc {lastSyncedAt}
            </span>
          )}
          <div className="relative" ref={downloadMenuRef}>
            <button
              onClick={() => setIsDownloadMenuOpen((prev) => !prev)}
              disabled={Boolean(exportingFormat)}
              className="px-3 py-1.5 rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-sm disabled:opacity-50"
            >
              <span className="inline-flex items-center gap-1">
                <Download size={14} />
                {exportingFormat ? "Đang tải..." : "Download"}
                <ChevronDown size={14} />
              </span>
            </button>

            {isDownloadMenuOpen && (
              <div className="absolute right-0 top-full mt-2 min-w-[150px] rounded-md border border-slate-200 bg-white shadow-lg z-30 overflow-hidden">
                {EXPORT_FORMATS.map((format) => (
                  <button
                    key={format}
                    onClick={() => void handleExportProject(format)}
                    disabled={Boolean(exportingFormat)}
                    className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                  >
                    {EXPORT_LABELS[format]}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6 pb-10">
        {loading && (
          <div className="space-y-4 animate-pulse">
            <div className="bg-white border rounded-xl p-6">
              <div className="h-4 bg-slate-200 rounded w-1/4 mb-4"></div>
              <div className="space-y-3">
                <div className="h-20 bg-slate-100 rounded w-full"></div>
                <div className="h-20 bg-slate-100 rounded w-full"></div>
                <div className="h-20 bg-slate-100 rounded w-full"></div>
              </div>
            </div>
          </div>
        )}
        {error && (
          <div className="text-sm bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-md">
            {error}
          </div>
        )}
        {!loading && !error && (
          <div className="space-y-4">
            <style>{`
              .markdown-preview h1 {
                font-size: 2.2rem !important;
                color: #1e3a8a !important;
                font-weight: 800 !important;
                margin-top: 1.5rem !important;
                margin-bottom: 2rem !important;
                border-bottom: 3px solid #3b82f6 !important;
                padding-bottom: 0.75rem !important;
              }
              .markdown-preview h2 {
                font-size: 1.75rem !important;
                color: #0f766e !important;
                font-weight: 700 !important;
                margin-top: 2rem !important;
                margin-bottom: 1rem !important;
                padding-left: 0.75rem !important;
                border-left: 4px solid #0f766e !important;
                border-bottom: none !important;
              }
              .markdown-preview h3 {
                font-size: 1.35rem !important;
                color: #1e293b !important;
                font-weight: 700 !important;
                margin-top: 1.5rem !important;
                margin-bottom: 0.75rem !important;
                padding-left: 0.5rem !important;
                border-left: 2px solid #cbd5e1 !important;
              }
              .markdown-preview h4 {
                font-size: 1.15rem !important;
                color: #334155 !important;
                font-weight: 600 !important;
                margin-top: 1.25rem !important;
                margin-bottom: 0.5rem !important;
                padding-left: 0.5rem !important;
                border-left: none !important;
              }
              .markdown-preview h5 {
                font-size: 1rem !important;
                color: #475569 !important;
                font-weight: 600 !important;
                font-style: italic !important;
                margin-top: 1rem !important;
                margin-bottom: 0.5rem !important;
                padding-left: 0.5rem !important;
                border-left: none !important;
              }
              .markdown-preview p {
                font-size: 0.975rem !important;
                color: #334155 !important;
                line-height: 1.7 !important;
                margin-bottom: 0.85rem !important;
              }
              .markdown-preview ul, .markdown-preview ol {
                padding-left: 1.5rem !important;
                margin-bottom: 1rem !important;
              }
              .markdown-preview li {
                font-size: 0.975rem !important;
                color: #334155 !important;
                line-height: 1.7 !important;
                margin-bottom: 0.4rem !important;
              }
              .markdown-preview li p {
                display: inline !important;
                margin: 0 !important;
              }
            `}</style>
            <article className="bg-white border rounded-xl p-8 prose markdown-preview max-w-none shadow-sm">
              <EnhancedMarkdownRenderer content={markdown} className="!p-0 !border-0 bg-transparent" />
            </article>
          </div>
        )}
      </main>
    </div>
  );
}
