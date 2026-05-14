import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import { ChevronDown, Download, Eye, RefreshCw, Save } from "lucide-react";
import {
  exportEditorProject,
  getEditorProjectDetail,
  patchEditorSection,
  type EditorProjectExportFormat,
  type EditorSection,
} from "../services/api";

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
    const level = Math.max(1, Math.min(5, Number(section.level || 1)));
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
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDownloadMenuOpen, setIsDownloadMenuOpen] = useState(false);
  const [exportingFormat, setExportingFormat] =
    useState<EditorProjectExportFormat | null>(null);
  const isDirtyRef = useRef(false);
  const downloadMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    isDirtyRef.current = isDirty;
  }, [isDirty]);

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
        if (!isDirtyRef.current) {
          const mapped: EditableSection[] = (data.sections || []).map((s) => ({
            id: s.id,
            title: s.title,
            content: stripSourceCitations(s.content_markdown || ""),
            order: s.order_index || 0,
            level: s.level || 1,
          }));
          setEditableSections(mapped);
        }
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

  const handleSectionChange = (sectionId: string, content: string) => {
    setEditableSections((prev) =>
      prev.map((item) => (item.id === sectionId ? { ...item, content } : item)),
    );
    setIsDirty(true);
  };

  const saveSection = async (sectionId: string) => {
    const section = editableSections.find((s) => s.id === sectionId);
    if (!section) return;
    await patchEditorSection(sectionId, { content: section.content });
  };

  const saveAllChanges = async () => {
    try {
      setIsSaving(true);
      for (const section of editableSections) {
        await patchEditorSection(section.id, { content: section.content });
      }
      setIsDirty(false);
      setLastSyncedAt(new Date().toLocaleTimeString("vi-VN"));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lưu nội dung thất bại");
    } finally {
      setIsSaving(false);
    }
  };

  const handleExportProject = async (format: EditorProjectExportFormat) => {
    if (!projectId) return;
    setIsDownloadMenuOpen(false);
    setExportingFormat(format);

    try {
      if (isDirty) {
        await saveAllChanges();
      }
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
        <div className="flex items-center gap-4">
          {lastSyncedAt && (
            <span className="text-xs text-slate-500 flex items-center gap-1">
              <RefreshCw size={12} /> Đồng bộ lúc {lastSyncedAt}
            </span>
          )}
          <button
            onClick={saveAllChanges}
            disabled={isSaving || !isDirty}
            className="px-3 py-1.5 rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-sm disabled:opacity-50"
          >
            <span className="inline-flex items-center gap-1">
              <Save size={14} /> {isSaving ? "Đang lưu..." : "Lưu thay đổi"}
            </span>
          </button>
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
          <button
            onClick={backToEditor}
            className="px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-sm"
          >
            Về soạn thảo
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6 pb-10">
        {loading && <div className="text-slate-500">Đang tải nội dung...</div>}
        {error && (
          <div className="text-sm bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-md">
            {error}
          </div>
        )}
        {!loading && !error && (
          <div className="space-y-4">
            <section className="bg-white border rounded-xl p-6">
              <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-3">
                Chỉnh sửa nội dung đã lưu trước khi tải về
              </h2>
              <div className="space-y-4 max-h-[50vh] overflow-y-auto pr-1">
                {editableSections
                  .slice()
                  .sort((a, b) => a.order - b.order)
                  .map((section) => (
                    <div
                      key={section.id}
                      className="border rounded-lg p-3 bg-slate-50"
                    >
                      <div className="font-medium text-slate-800 mb-2">
                        {section.title}
                      </div>
                      <textarea
                        value={section.content}
                        onChange={(e) =>
                          handleSectionChange(section.id, e.target.value)
                        }
                        className="w-full min-h-[140px] p-3 rounded-md border bg-white text-sm font-mono outline-none focus:ring-2 ring-blue-200"
                      />
                      <div className="mt-2 flex justify-end">
                        <button
                          onClick={() => void saveSection(section.id)}
                          className="text-xs px-2.5 py-1 rounded-md border border-slate-200 hover:bg-white text-slate-600"
                        >
                          Lưu mục này
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            </section>

            <article className="bg-white border rounded-xl p-6 prose markdown-preview max-w-none">
              <ReactMarkdown
                components={{
                  p: ({ children }) => (
                    <p className="whitespace-pre-wrap break-words">
                      {children}
                    </p>
                  ),
                  li: ({ children }) => (
                    <li className="whitespace-pre-wrap break-words">
                      {children}
                    </li>
                  ),
                }}
              >
                {markdown}
              </ReactMarkdown>
            </article>
          </div>
        )}
      </main>
    </div>
  );
}
