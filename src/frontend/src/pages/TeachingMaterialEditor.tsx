import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  GripVertical,
  Plus,
  Trash2,
  RefreshCw,
  FileText,
  CheckCircle2,
  Loader2,
  PanelRight,
  Eye,
  EyeOff,
  ChevronDown,
  Zap,
  ArrowLeft,
  BookOpen,
  HelpCircle,
  Sparkles,
  FileCode,
  Download,
  Sun,
  Moon,
  Edit3,
} from "lucide-react";
import { EnhancedMarkdownRenderer } from "../components/EnhancedMarkdownRenderer";
import {
  createEditorSection,
  deleteEditorSection,
  exportEditorProject,
  generateEditorProjectOutline,
  generateEditorSection,
  generateBatchSections,
  getEditorProjectDetail,
  patchEditorSection,
  reorderEditorSections,
  getSectionHistory,
  restoreSectionHistory,
  getEditorSection,
  getSuggestedPrompt,
  editSelection,
  type EditorProjectExportFormat,
  type EditorSection,
} from "../services/api";
import {
  formatCitation,
  groupChunksBySourceForCitation,
  parseCitationSourceId,
  type CitationGroup,
} from "../utils/citation";
import { toastService } from "../services/toastService";

// --- Types ---
interface Section {
  id: string;
  title: string;
  prompt: string;
  content: string;
  order: number;
  level: number;
  isGenerating?: boolean;
}

interface Chunk {
  id: string;
  text: string;
  score: number;
  source?: string;
  title?: string;
  pageNumber?: number | null;
  startPage?: number | null;
  endPage?: number | null;
  metadata?: {
    docId?: string;
    fileName?: string;
    chapter?: string;
    section?: string;
    subsection?: string;
    chapterTitle?: string;
    sectionTitle?: string;
    subsectionTitle?: string;
    breadcrumb?: string;
    startPage?: number | null;
    endPage?: number | null;
  };
}

interface SectionEvaluation {
  scores: {
    accuracy: number;
    coverage: number;
    structure: number;
    clarity: number;
  };
  strengths: string[];
  weaknesses: string[];
  suggestions: string[];
  is_fallback?: boolean;
}

type ContextPanelTab = "source" | "evaluation" | "history";

interface EditorDraftPayload {
  projectId: string;
  activeSectionId: string;
  outlinePrompt: string;
  savedAt: number;
  sections: Section[];
}

function normalizePromptKey(text: string): string {
  return (text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanSuggestedPrompt(prompt: string): string {
  if (!prompt) return "";
  let clean = prompt;
  
  // 1. Fix ![placeholder: Vietnamese | English] where there is no following (
  clean = clean.replace(/!\[placeholder:\s*([^\]]+)\](?!\()/g, (_, content) => {
    let vi = content.trim();
    let en = "";
    if (vi.includes("|")) {
      const parts = vi.split("|");
      vi = (parts[0] || "").trim();
      en = (parts[1] || "").trim();
    } else {
      en = `Minimalist 2D vector art, clean design, scientific style, white background, no text clutter, ${vi}`;
    }
    vi = vi.replace(/[<>]/g, "").trim();
    en = en.replace(/[<>]/g, "").trim();
    return `![Sơ đồ minh họa](<placeholder: ${vi} | ${en}>)`;
  });

  // 2. Fix ![Alt](placeholder: ...) -> ![Alt](<placeholder: ...>) if angle brackets are missing
  clean = clean.replace(/!\[([^\]]*)\]\(\s*(?!<)placeholder:\s*([^\)\>]+)\)/g, (_, alt, inner) => {
    return `![${alt}](<placeholder: ${inner.trim()}>)`;
  });

  return clean;
}

const TOC_PROMPT_SUGGESTION = "Tạo dàn ý bài giảng chi tiết, bao quát đầy đủ các tài liệu nguồn đã chọn";

const SUGGEST_PROMPT_TYPES = [
  { id: "theory", label: "📖 Lý thuyết", name: "Lý thuyết" },
  { id: "example", label: "💡 Ví dụ", name: "Ví dụ" },
  { id: "exercise", label: "📝 Bài tập", name: "Bài tập" },
  { id: "discussion", label: "💬 Thảo luận", name: "Thảo luận" },
  { id: "case_study", label: "📂 Tình huống", name: "Tình huống" },
  { id: "practice", label: "🛠️ Thực hành", name: "Thực hành" },
];



function getSectionOrderWarning(
  section: Section,
  allSections: Section[],
): string | null {
  const normalized = normalizePromptKey(section.title || "");
  const isQuiz = ["cau hoi", "on tap", "quiz", "trac nghiem", "bai tap"].some((k) =>
    normalized.includes(k)
  );
  const isSummary = ["tom tat", "tong ket", "summary", "ket luan"].some((k) =>
    normalized.includes(k)
  );

  if (isQuiz || isSummary) {
    // Check if main content exists and has been generated
    const mainContentSection = allSections.find((s) => {
      const n = normalizePromptKey(s.title || "");
      return ["noi dung chinh", "main content", "key concept"].some((k) => n.includes(k));
    });
    if (mainContentSection && !(mainContentSection.content || "").trim()) {
      return isQuiz
        ? "⚠️ Khuyến nghị: Sinh 'Nội dung chính' trước để câu hỏi bám sát đúng kiến thức đã trình bày."
        : "⚠️ Khuyến nghị: Sinh 'Nội dung chính' trước để tóm tắt chính xác hơn.";
    }
  }
  return null;
}
const EXPORT_LABELS: Record<EditorProjectExportFormat, string> = {
  md: "Markdown (.md)",
  pdf: "PDF (.pdf)",
  docx: "Word (.docx)",
};

const EXPORT_FORMATS: EditorProjectExportFormat[] = ["md", "pdf", "docx"];

const CONTROL_SENTINELS = ["NOT_ENOUGH_CONTEXT", "FAIL_COVERAGE"] as const;
type ControlSentinel = (typeof CONTROL_SENTINELS)[number];
const MISSING_KB_EDITOR_MESSAGE =
  "Dự án chưa có Knowledge Base. Vui lòng quay lại và chọn ít nhất 1 tài liệu nguồn trước khi soạn thảo.";

// Batch generation groups (matches backend get_batch_group_type logic)
const BATCH_GROUPS: Array<{
  id: string;
  label: string;
  keywords: string[][];
}> = [
  {
    id: "INTRO_GROUP",
    label: "⚡ Tạo nhanh: Mở đầu",
    // Sections whose normalized titles match ALL of these keyword sets
    keywords: [
      ["tieu de", "lesson title", "title", "chu de"],
      ["muc tieu", "objective", "learning objective"],
      ["gioi thieu", "overview", "mo dau", "dan nhap"],
    ],
  },
  {
    id: "OUTRO_GROUP",
    label: "⚡ Tạo nhanh: Kết thúc",
    keywords: [
      ["tom tat", "tong ket", "summary", "ket luan"],
      ["cau hoi", "on tap", "quiz", "trac nghiem", "bai tap"],
    ],
  },
];

function matchesBatchGroup(
  sections: Section[],
  group: (typeof BATCH_GROUPS)[number],
): string[] | null {
  const matched: string[] = [];
  for (const keywordSet of group.keywords) {
    const found = sections.find((s) =>
      keywordSet.some((kw) => normalizePromptKey(s.title).includes(kw)),
    );
    if (!found) return null; // Group is incomplete — missing one category
    matched.push(found.id);
  }
  // Deduplicate in case the same section matched two sets
  return [...new Set(matched)];
}

function extractControlSentinel(text: string): ControlSentinel | "" {
  const normalized = (text || "").trim().toUpperCase();
  if (CONTROL_SENTINELS.includes(normalized as ControlSentinel)) {
    return normalized as ControlSentinel;
  }
  return "";
}

function sanitizeGeneratedSectionContent(text: string): string {
  return extractControlSentinel(text) ? "" : text;
}

function isQuizTitle(title: string): boolean {
  const normalizedTitle = normalizePromptKey(title || "");
  if (!normalizedTitle) return false;
  return (
    normalizedTitle.includes("cau hoi on tap") ||
    normalizedTitle.includes("on tap") ||
    normalizedTitle.includes("quiz") ||
    normalizedTitle.includes("trac nghiem") ||
    normalizedTitle.includes("bai tap")
  );
}

function stripTrailingQuizCitationGroupMarkdown(text: string): string {
  const normalized = String(text || "").trim();
  if (!normalized) return "";

  return normalized
    .replace(/\n{1,}📚\s*Nguồn:\s*\n(?:\s*[-*•]\s+.*(?:\n|$))+\s*$/gis, "")
    .trim();
}

function sanitizeSectionContentByTitle(
  content: string,
  sectionTitle: string,
): string {
  const base = sanitizeGeneratedSectionContent(content || "");
  if (!isQuizTitle(sectionTitle || "")) {
    return base;
  }
  return stripTrailingQuizCitationGroupMarkdown(base);
}

function normalizeMarkdownForPreview(text: string): string {
  return (text || "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
}

function stripExistingCitationBlock(text: string): string {
  const normalized = (text || "").trim();
  if (!normalized) return "";

  const withoutNewBlock = normalized
    .replace(/\n{1,}📚\s*Nguồn:\s*\n(?:\s*[-*]\s+.*(?:\n|$))+\s*$/gis, "")
    .trim();

  return withoutNewBlock
    .replace(/\n{1,}---\s*\*?\s*(nguồn|nguon)\s*:[^\n]*\*?\s*$/gim, "")
    .trim();
}

function stripCitationMarkers(text: string): string {
  const raw = String(text || "");
  if (!raw) return "";
  // Remove standalone citation lines (used in subsections and global footers)
  return raw
    .replace(/^\s*(?:[-*•]\s+)?📚\s*Nguồn\s*:\s*.*$\n?/gim, "")
    .trim();
}

function buildCitationBlockMarkdown(citationGroups: CitationGroup[]): string {
  if (!citationGroups.length) return "";

  const lines = ["📚 Nguồn:", ""];
  citationGroups.forEach((group) => {
    if (!group.lineText) return;
    lines.push(
      `* [${group.lineText}](#source:${encodeURIComponent(group.id)})`,
    );
  });

  return lines.join("\n").trim();
}

function shouldShowCitationInPreview(section: Section | undefined): boolean {
  const normalizedTitle = normalizePromptKey(String(section?.title || ""));
  if (!normalizedTitle) return true;

  const hideCitationKeywords = [
    "tieu de",
    "lesson title",
    "title",
    "chu de",
    "muc tieu",
    "objective",
    "learning objective",
    "gioi thieu",
    "overview",
    "mo dau",
    "dan nhap",
    "tom tat",
    "tong ket",
    "summary",
    "ket luan",
  ];

  return !hideCitationKeywords.some((keyword) =>
    normalizedTitle.includes(keyword),
  );
}

function isMainContentSection(section: Section | undefined): boolean {
  const normalizedTitle = normalizePromptKey(String(section?.title || ""));
  if (!normalizedTitle) return false;
  return (
    normalizedTitle.includes("noi dung chinh") ||
    normalizedTitle.includes("main content") ||
    normalizedTitle.includes("giai thich chi tiet") ||
    normalizedTitle.includes("detailed explanation")
  );
}

function isQuizSection(section: Section | undefined): boolean {
  return isQuizTitle(String(section?.title || ""));
}

function extractCitationFileHint(value: string): string {
  const raw = String(value || "")
    .replace(/^📚\s*Nguồn:\s*/i, "")
    .split(" – ")[0]
    .split(" - ")[0]
    .trim();
  return normalizePromptKey(raw);
}

function extractCitationPageHint(value: string): string {
  const normalized = normalizePromptKey(value || "");
  const match = normalized.match(/trang\s*\d+(?:\s*[–-]\s*\d+)?/i);
  return match ? match[0].replace(/\s+/g, " ").trim() : "";
}

function resolveCitationSourceIdFromInlineLabel(
  sourceLabel: string,
  citationGroups: CitationGroup[],
): string {
  const normalizedLabel = normalizePromptKey(sourceLabel || "");
  if (!normalizedLabel || !citationGroups.length) return "";

  for (const group of citationGroups) {
    const normalizedGroup = normalizePromptKey(group.lineText || "");
    if (!normalizedGroup) continue;
    if (
      normalizedGroup === normalizedLabel ||
      normalizedGroup.includes(normalizedLabel) ||
      normalizedLabel.includes(normalizedGroup)
    ) {
      return group.id;
    }
  }

  const fileHint = extractCitationFileHint(sourceLabel);
  const pageHint = extractCitationPageHint(sourceLabel);

  const fileMatchedGroups = citationGroups.filter((group) => {
    const groupFileHint = extractCitationFileHint(group.lineText || "");
    return Boolean(fileHint && groupFileHint && fileHint === groupFileHint);
  });

  for (const group of fileMatchedGroups) {
    const groupPageHint = extractCitationPageHint(group.lineText || "");
    if (!pageHint || !groupPageHint) {
      return group.id;
    }
    if (
      groupPageHint === pageHint ||
      groupPageHint.includes(pageHint) ||
      pageHint.includes(groupPageHint)
    ) {
      return group.id;
    }
  }

  // File matched but page is different: still allow click by mapping to the nearest
  // available group of the same file so citation remains interactive.
  if (fileMatchedGroups.length) {
    return fileMatchedGroups[0].id;
  }

  // Last resort: keep citation clickable even when metadata is sparse/mismatched.
  return citationGroups[0]?.id || "";
}

function linkifyInlineCitationLines(
  text: string,
  citationGroups: CitationGroup[],
): string {
  if (!text) return "";

  return text
    .split("\n")
    .map((rawLine) => {
      const line = rawLine.trimEnd();
      if (!line.trim()) return line;
      if (/#source:/i.test(line)) return line;

      const match = line.match(/^(\s*[-*]\s+)?(📚\s*Nguồn:\s*)(.+)$/i);
      if (!match) return line;

      const bulletPrefix = match[1] || "";
      const citationPrefix = match[2] || "📚 Nguồn: ";
      const citationLabel = String(match[3] || "").trim();
      if (!citationLabel) return line;
      if (/\[[^\]]+\]\([^)]+\)/.test(citationLabel)) return line;

      const sourceId = resolveCitationSourceIdFromInlineLabel(
        citationLabel,
        citationGroups,
      );
      if (!sourceId) return line;

      return `${bulletPrefix}${citationPrefix}[${citationLabel}](#source:${encodeURIComponent(sourceId)})`;
    })
    .join("\n");
}


function buildSentinelErrorMessage(
  sentinel: ControlSentinel,
  sectionTitle: string,
): string {
  const safeTitle = (sectionTitle || "section này").trim() || "section này";
  if (sentinel === "NOT_ENOUGH_CONTEXT") {
    return `Chưa đủ ngữ cảnh để tạo nội dung cho "${safeTitle}". Hãy bổ sung tài liệu nguồn hoặc viết prompt cụ thể hơn.`;
  }
  return `Ngữ cảnh hiện tại chưa bao phủ đủ ý chính để tạo "${safeTitle}". Hãy bổ sung tài liệu hoặc điều chỉnh prompt.`;
}

function normalizeSectionRetrievedChunks(section: EditorSection): Chunk[] {
  return (section.retrieved_chunks || []).map((item, index) => ({
    id: String(item.id || `${section.id}-chunk-${index}`),
    text: String(item.text || ""),
    score: Number(item.score || 0),
    source: item.source || item.title || "",
    title: item.title || "",
    pageNumber: typeof item.page_number === "number" ? item.page_number : null,
    startPage: typeof item.start_page === "number" ? item.start_page : null,
    endPage: typeof item.end_page === "number" ? item.end_page : null,
    metadata: item.metadata
      ? {
          docId: item.metadata.doc_id || "",
          fileName: item.metadata.file_name || "",
          chapter: item.metadata.chapter || "",
          section: item.metadata.section || "",
          subsection: item.metadata.subsection || "",
          chapterTitle: item.metadata.chapter_title || "",
          sectionTitle: item.metadata.section_title || "",
          subsectionTitle: item.metadata.subsection_title || "",
          breadcrumb: item.metadata.breadcrumb || "",
          startPage:
            typeof item.metadata.start_page === "number"
              ? item.metadata.start_page
              : null,
          endPage:
            typeof item.metadata.end_page === "number"
              ? item.metadata.end_page
              : null,
        }
      : undefined,
  }));
}

function normalizeSectionEvaluation(
  evaluation: EditorSection["evaluation"],
): SectionEvaluation | null {
  if (!evaluation) return null;
  return {
    scores: {
      accuracy: Number(evaluation.scores?.accuracy || 0),
      coverage: Number(evaluation.scores?.coverage || 0),
      structure: Number(evaluation.scores?.structure || 0),
      clarity: Number(evaluation.scores?.clarity || 0),
    },
    strengths: Array.isArray(evaluation.strengths)
      ? evaluation.strengths.map((item) => String(item))
      : [],
    weaknesses: Array.isArray(evaluation.weaknesses)
      ? evaluation.weaknesses.map((item) => String(item))
      : [],
    suggestions: Array.isArray(evaluation.suggestions)
      ? evaluation.suggestions.map((item) => String(item))
      : [],
    is_fallback: evaluation.is_fallback !== undefined ? Boolean(evaluation.is_fallback) : undefined,
  };
}

// --- Markdown Bloom Badge Processor ---
function renderBloomBadge(text: string): React.ReactNode {
  if (!text) return text;
  const bloomRegex = /(🎯\s*Mục tiêu:\s*(?:Nhận biết|Thông hiểu|Hiểu|Vận dụng cao|Vận dụng|Áp dụng|Phân tích|Đánh giá|Sáng tạo))/i;
  const parts = text.split(bloomRegex);
  
  if (parts.length === 1) return text;

  return parts.map((part, i) => {
    const match = part.match(/🎯\s*Mục tiêu:\s*(Nhận biết|Thông hiểu|Hiểu|Vận dụng cao|Vận dụng|Áp dụng|Phân tích|Đánh giá|Sáng tạo)/i);
    if (match) {
      const level = match[1].toLowerCase();
      let colorClass = "bg-slate-100 text-slate-800 border-slate-200";
      
      if (level === "nhận biết") colorClass = "bg-purple-100 text-purple-700 border-purple-200";
      else if (level === "thông hiểu" || level === "hiểu") colorClass = "bg-emerald-100 text-emerald-700 border-emerald-200";
      else if (level === "vận dụng" || level === "áp dụng") colorClass = "bg-blue-100 text-blue-700 border-blue-200";
      else if (level === "vận dụng cao" || level === "phân tích") colorClass = "bg-amber-100 text-amber-700 border-amber-200";
      else if (level === "đánh giá") colorClass = "bg-rose-100 text-rose-700 border-rose-200";
      else if (level === "sáng tạo") colorClass = "bg-indigo-100 text-indigo-700 border-indigo-200";

      return (
        <span key={i} className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold border ${colorClass} mx-1 uppercase tracking-wide shadow-sm`}>
          {part}
        </span>
      );
    }
    return part;
  });
}

function processMarkdownChildren(children: React.ReactNode): React.ReactNode {
  if (typeof children === "string") {
    return renderBloomBadge(children);
  }
  if (Array.isArray(children)) {
    return children.map((child, i) => <React.Fragment key={i}>{processMarkdownChildren(child)}</React.Fragment>);
  }
  return children;
}

// --- Main Editor Component ---
export default function TeachingMaterialEditor() {
  const { id } = useParams();
  const projectId = String(id || "");
  const navigate = useNavigate();
  const initialSectionFromQueryRef = useRef<string>(
    new URLSearchParams(window.location.search).get("section") || "",
  );
  const saveTimers = useRef<Record<string, number>>({});
  const pendingChangesRef = useRef<Record<string, Partial<Section>>>({});
  const latestDraftRef = useRef<{
    sections: Section[];
    activeSectionId: string;
    outlinePrompt: string;
  }>({ sections: [], activeSectionId: "", outlinePrompt: "" });
  const promptInputRef = useRef<HTMLTextAreaElement | null>(null);
  const outlinePromptRef = useRef<HTMLTextAreaElement | null>(null);
  const downloadMenuRef = useRef<HTMLDivElement | null>(null);
  const chunkCardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const draftStorageKey = `rag.editor.draft.${projectId}`;

  const persistDraft = useCallback(
    (
      nextSections: Section[],
      nextActiveSectionId: string,
      nextOutlinePrompt: string,
    ) => {
      if (!projectId) return;
      const payload: EditorDraftPayload = {
        projectId,
        sections: nextSections,
        activeSectionId: nextActiveSectionId,
        outlinePrompt: nextOutlinePrompt,
        savedAt: Date.now(),
      };
      localStorage.setItem(draftStorageKey, JSON.stringify(payload));
    },
    [draftStorageKey, projectId],
  );

  const loadDraft = useCallback((): EditorDraftPayload | null => {
    if (!projectId) return null;
    try {
      const raw = localStorage.getItem(draftStorageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as EditorDraftPayload;
      if (!parsed || parsed.projectId !== projectId) return null;
      // Keep drafts for 24h to avoid restoring stale data unexpectedly.
      if (
        !parsed.savedAt ||
        Date.now() - parsed.savedAt > 24 * 60 * 60 * 1000
      ) {
        localStorage.removeItem(draftStorageKey);
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }, [draftStorageKey, projectId]);

  const flushPendingSaves = useCallback(() => {
    const entries = Object.entries(pendingChangesRef.current);
    for (const [sectionId, changes] of entries) {
      void patchEditorSection(sectionId, {
        title: changes.title,
        content: changes.content,
        prompt: changes.prompt,
        order: changes.order,
        level: changes.level,
      }).catch(() => {
        // Keep best-effort flush non-blocking on unload.
      });
    }
  }, []);

  const flushPendingSavesAndWait = useCallback(async () => {
    Object.values(saveTimers.current).forEach((timerId) => {
      window.clearTimeout(timerId);
    });
    saveTimers.current = {};

    const entries = Object.entries(pendingChangesRef.current);
    if (!entries.length) return;

    setSaveStatus("saving");
    for (const [sectionId, changes] of entries) {
      await patchEditorSection(sectionId, {
        title: changes.title,
        content: changes.content,
        prompt: changes.prompt,
        order: changes.order,
        level: changes.level,
      });
      delete pendingChangesRef.current[sectionId];
    }
    setSaveStatus("saved");
    window.setTimeout(() => setSaveStatus("idle"), 1200);
  }, []);


  // state
  const [sections, setSections] = useState<Section[]>([]);
  const [isOutlineApproved, setIsOutlineApproved] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(`rag.outline.approved.${projectId}`);
      return stored === "true";
    } catch {
      return false;
    }
  });
  const [structurePromptText, setStructurePromptText] = useState("");
  const [isUpdatingStructure, setIsUpdatingStructure] = useState(false);
  const [suggestingPromptId, setSuggestingPromptId] = useState<string>("");
  const [showPromptSuggestions, setShowPromptSuggestions] = useState<boolean>(false);
  const [activeSuggestTab, setActiveSuggestTab] = useState<string>("theory");
  const [dropMode, setDropMode] = useState<"reorder-before" | "reorder-after" | "nest" | null>(null);
  const [deleteTargetSection, setDeleteTargetSection] = useState<Section | null>(null);
  const [deleteChildrenCount, setDeleteChildrenCount] = useState<number>(0);
  const [suggestedPrompts, setSuggestedPrompts] = useState<Record<string, string>>({});

  interface HistoryEntry {
    id: number;
    created_at: string;
    prompt: string;
    content_markdown: string;
  }
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [activeSectionId, setActiveSectionId] = useState<string>("");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">(
    "idle",
  );
  const [showContext, setShowContext] = useState(true);
  const [activeContextTab, setActiveContextTab] =
    useState<ContextPanelTab>("source");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [projectTitle, setProjectTitle] = useState("Dự án bài giảng");

  // AI Selection Edit
  const [selectedText, setSelectedText] = useState<string>("");
  const [selectionRange, setSelectionRange] = useState<{ x: number; y: number } | null>(null);
  const [selectionPrompt, setSelectionPrompt] = useState<string>("");
  const [isEditingSelection, setIsEditingSelection] = useState<boolean>(false);
  const [selectionDiff, setSelectionDiff] = useState<{
    originalText: string;
    refinedText: string;
    sectionId: string;
  } | null>(null);

  const [theme, setTheme] = useState<"light" | "dark">(() => {
    return (localStorage.getItem("theme") as "light" | "dark") || "light";
  });
  const [editMode, setEditMode] = useState<boolean>(true);

  const toggleTheme = () => {
    const nextTheme = theme === "light" ? "dark" : "light";
    setTheme(nextTheme);
    localStorage.setItem("theme", nextTheme);
    if (nextTheme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  };
  const [outlinePrompt, setOutlinePrompt] = useState("");
  const [isGeneratingOutline, setIsGeneratingOutline] = useState(false);

  const [showCitationsInPreview, setShowCitationsInPreview] = useState(true);


  const [isDownloadMenuOpen, setIsDownloadMenuOpen] = useState(false);
  const [exportingFormat, setExportingFormat] =
    useState<EditorProjectExportFormat | null>(null);
  const [draggingSectionId, setDraggingSectionId] = useState<string | null>(
    null,
  );
  const [dragOverSectionId, setDragOverSectionId] = useState<string | null>(
    null,
  );
  const [chunksBySection, setChunksBySection] = useState<
    Record<string, Chunk[]>
  >({});
  const [expandedChunksBySection, setExpandedChunksBySection] = useState<
    Record<string, Record<string, boolean>>
  >({});
  const [highlightedChunksBySection, setHighlightedChunksBySection] = useState<
    Record<string, string[]>
  >({});
  const [evaluationBySection, setEvaluationBySection] = useState<
    Record<string, SectionEvaluation | null>
  >({});
  // Tracks which batch group is currently generating ("INTRO_GROUP" | "OUTRO_GROUP" | null)
  const [batchGeneratingGroupId, setBatchGeneratingGroupId] = useState<string | null>(null);

  const inferLevelFromTitle = (title: string): number | null => {
    const normalized = (title || "").trim();
    const matched = normalized.match(/^(\d+(?:\.\d+)*)/);
    if (!matched) return null;
    return Math.max(1, matched[1].split(".").length);
  };

  const loadProject = useCallback(async (showLoader = true) => {
    if (!projectId) return;
    try {
      if (showLoader) {
        setLoading(true);
      }
      setError("");
      const project = await getEditorProjectDetail(projectId);

      const projectKnowledgeBaseIds = (project.knowledge_base_ids || [])
        .map((item) => String(item || "").trim())
        .filter((item) => Boolean(item));

      if (projectKnowledgeBaseIds.length === 0) {
        setError(MISSING_KB_EDITOR_MESSAGE);
        window.alert(MISSING_KB_EDITOR_MESSAGE);
        navigate("/materials", { replace: true });
        return;
      }

      setProjectTitle(project.title || "Dự án bài giảng");
      const persistedChunks: Record<string, Chunk[]> = {};
      const persistedEvaluations: Record<string, SectionEvaluation | null> = {};

      const mapped: Section[] = (project.sections || []).map(
        (item: EditorSection) => {
          persistedChunks[item.id] = normalizeSectionRetrievedChunks(item);
          persistedEvaluations[item.id] = normalizeSectionEvaluation(
            item.evaluation,
          );
          return {
            id: item.id,
            title: item.title,
            prompt: item.prompt || "",
            content: sanitizeSectionContentByTitle(
              item.content_markdown || "",
              item.title || "",
            ),
            order: item.order_index,
            level: Math.max(
              1,
              item.level || inferLevelFromTitle(item.title || "") || 1,
            ),
          };
        },
      );

      const draft = loadDraft();
      const merged = mapped.map((item) => {
        const draftSection = draft?.sections?.find((d) => d.id === item.id);
        if (!draftSection) return item;
        
        const rawPrompt = draftSection.prompt || "";
        const isDefault = 
          rawPrompt.trim() === "Tạo dàn ý bài giảng chi tiết, bao quát đầy đủ các tài liệu nguồn đã chọn" ||
          rawPrompt.trim() === "Đặt tiêu đề bài học mang tính mô tả cao và bao quát nội dung" ||
          rawPrompt.trim() === "Xác định mục tiêu học tập cụ thể dựa trên kiến thức cốt lõi từ tài liệu" ||
          rawPrompt.trim() === "Viết phần giới thiệu tổng quan, nêu bật các công nghệ/khái niệm chính từ nguồn tài liệu, có trích dẫn nguồn" ||
          rawPrompt.trim() === "Viết nội dung chính chi tiết, tổng hợp kiến thức từ tất cả tài liệu nguồn, bắt buộc đính kèm trích dẫn nguồn cho mỗi ý quan trọng" ||
          rawPrompt.trim() === "Tạo ví dụ minh họa thực tế dựa trên ngữ cảnh tài liệu, có giải thích và trích nguồn" ||
          rawPrompt.trim() === "Phân tích ứng dụng thực tế của kiến thức, liên hệ trực tiếp với các tình huống trong tài liệu" ||
          rawPrompt.trim() === "Tóm tắt các điểm quan trọng nhất, đảm bảo không bỏ sót ý chính từ bất kỳ tài liệu nguồn nào" ||
          rawPrompt.trim() === "Tạo câu hỏi ôn tập kiểm tra kiến thức tổng hợp từ tất cả các nguồn tài liệu" ||
          rawPrompt.trim() === "Viết nội dung chi tiết cho mục này, đảm bảo bám sát tài liệu nguồn và có trích dẫn đầy đủ" ||
          (rawPrompt.trim().startsWith("Viết nội dung phù hợp nhất với chủ đề") && rawPrompt.trim().endsWith("dựa sát vào tài liệu nguồn."));

        return {
          ...item,
          title: draftSection.title,
          prompt: isDefault ? "" : rawPrompt,
          content: sanitizeSectionContentByTitle(
            draftSection.content,
            draftSection.title || item.title || "",
          ),
          order: draftSection.order,
          level: draftSection.level,
        };
      });

      setChunksBySection(persistedChunks);
      setExpandedChunksBySection({});
      setHighlightedChunksBySection({});
      setEvaluationBySection(persistedEvaluations);
      setSections(merged);
      const hasContent = merged.some((item) => item.content && item.content.trim().length > 0);
      let isApproved = localStorage.getItem(`rag.outline.approved.${projectId}`) === "true";
      if (merged.length > 0 && hasContent) {
        isApproved = true;
      }
      setIsOutlineApproved(isApproved);
      if (isApproved) {
        localStorage.setItem(`rag.outline.approved.${projectId}`, "true");
      } else {
        localStorage.removeItem(`rag.outline.approved.${projectId}`);
      }
      setOutlinePrompt(draft?.outlinePrompt || "");
      setActiveSectionId((prev) => {
        const sectionFromQuery = initialSectionFromQueryRef.current;
        if (!merged.length) return "";
        if (
          sectionFromQuery &&
          merged.some((item) => item.id === sectionFromQuery)
        ) {
          return sectionFromQuery;
        }
        if (prev && merged.some((item) => item.id === prev)) return prev;
        if (
          draft?.activeSectionId &&
          merged.some((item) => item.id === draft.activeSectionId)
        ) {
          return draft.activeSectionId;
        }
        return merged[0].id;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tải được dữ liệu dự án");
    } finally {
      setLoading(false);
    }
  }, [projectId, loadDraft, navigate]);

  useEffect(() => {
    void loadProject();
  }, [loadProject]);

  // Derived state
  const activeSection =
    sections.find((s) => s.id === activeSectionId) || sections[0];
  const dynamicSuggestPromptTypes = useMemo(() => {
    const isPracticeSection = activeSection && ["thực hành", "lab", "thực tập", "vận dụng"].some(k => 
      (activeSection.title || "").toLowerCase().includes(k)
    );
    return SUGGEST_PROMPT_TYPES.map(t => {
      if (t.id === "exercise" && isPracticeSection) {
        return { ...t, label: "🛠️ Thực hành", name: "Thực hành" };
      }
      return t;
    });
  }, [activeSection]);
  const activeChunks = activeSectionId
    ? chunksBySection[activeSectionId] || []
    : [];
  const activeCitationGroups = useMemo<CitationGroup[]>(
    () => groupChunksBySourceForCitation(activeChunks),
    [activeChunks],
  );
  const activeEvaluation = activeSectionId
    ? evaluationBySection[activeSectionId] || null
    : null;
  const activeHighlightedChunkIds = useMemo(
    () =>
      new Set(
        activeSectionId
          ? highlightedChunksBySection[activeSectionId] || []
          : [],
      ),
    [activeSectionId, highlightedChunksBySection],
  );
  const activeSectionContent = activeSection?.content || "";
  const sectionOrderWarning = useMemo(
    () => (activeSection ? getSectionOrderWarning(activeSection, sections) : null),
    [activeSection, sections],
  );

  const canShowPreviewCitation = useMemo(
    () => shouldShowCitationInPreview(activeSection),
    [activeSection],
  );
  const isMainContentPreviewSection = useMemo(
    () => isMainContentSection(activeSection),
    [activeSection],
  );
  const isQuizPreviewSection = useMemo(
    () => isQuizSection(activeSection),
    [activeSection],
  );
  const previewContent = useMemo(() => {
    let contentToProcess = activeSectionContent;
    if (!showCitationsInPreview) {
      contentToProcess = stripCitationMarkers(contentToProcess);
    }

    const normalizedContent = normalizeMarkdownForPreview(
      stripExistingCitationBlock(contentToProcess),
    );
    // Standard linkification of any "📚 Nguồn: [Label](#source:id)" lines
    const baseContent = linkifyInlineCitationLines(
      normalizedContent,
      activeCitationGroups,
    );

    let finalContent = baseContent;

    if (canShowPreviewCitation && showCitationsInPreview) {
      if (!isQuizPreviewSection && !isMainContentPreviewSection && !baseContent.includes("📚 Nguồn:")) {
        const citationBlock = buildCitationBlockMarkdown(activeCitationGroups);
        if (citationBlock) {
          finalContent = baseContent ? `${baseContent}\n\n${citationBlock}` : citationBlock;
        }
      }
    }

    // Apply active selection diff preview styling if present
    if (selectionDiff && activeSection && selectionDiff.sectionId === activeSection.id) {
      const diffMarkdown = `~~${selectionDiff.originalText}~~ [${selectionDiff.refinedText}](#diff-add)`;
      finalContent = finalContent.replace(selectionDiff.originalText, diffMarkdown);
    }

    return finalContent;
  }, [
    activeSection,
    activeSectionContent,
    activeCitationGroups,
    canShowPreviewCitation,
    isMainContentPreviewSection,
    isQuizPreviewSection,
    showCitationsInPreview,
    selectionDiff,
  ]);
  const orderedSections = useMemo(
    () => sections.slice().sort((a, b) => a.order - b.order),
    [sections],
  );

  const sectionPrefixes = useMemo(() => {
    const list = sections;
    const sorted = list.slice().sort((a, b) => a.order - b.order);
    const prefixes: Record<string, string> = {};
    const counts: number[] = [];
    
    for (const s of sorted) {
      const lv = s.level || 1;
      counts.length = lv;
      counts[lv - 1] = (counts[lv - 1] || 0) + 1;
      
      if (lv === 1) {
        prefixes[s.id] = `Chương ${counts[0]}.`;
      } else {
        prefixes[s.id] = counts.slice(0, lv).join(".");
      }
    }
    return prefixes;
  }, [sections]);

  const getCleanTitle = (title: string): string => {
    let clean = title || "";
    if (clean.trim().startsWith("{") && clean.trim().endsWith("}")) {
      try {
        const parsed = JSON.parse(clean);
        if (parsed && typeof parsed === "object") {
          if (parsed.title) {
            clean = parsed.title;
          } else if (parsed.content) {
            clean = parsed.content;
          }
        }
      } catch (e) {
        // Ignored
      }
    }
    if (clean.includes("#")) {
      const lines = clean.split("\n");
      const headerLine = lines.find((l) => l.trim().startsWith("#"));
      if (headerLine) {
        clean = headerLine.replace(/^#+\s*/, "");
      } else {
        clean = lines[0] || "";
      }
    }
    clean = clean
      .replace(/^(Chương|Chuong)\s+\d+\.?\s*/i, "")
      .replace(/^(\d+(?:\.\d+)*)/, "")
      .trim();
    clean = clean.replace(/^[\.\s\-:]+/, "").trim();
    return clean;
  };
  const generatedSectionsCount = useMemo(
    () =>
      sections.reduce(
        (count, section) => count + ((section.content || "").trim() ? 1 : 0),
        0,
      ),
    [sections],
  );

  const truncateChunkText = (text: string, maxChars = 180) => {
    const clean = (text || "").trim();
    if (clean.length <= maxChars) return clean;
    return `${clean.slice(0, maxChars).trimEnd()}...`;
  };

  const isChunkExpanded = (sectionId: string, chunkId: string): boolean => {
    return Boolean(expandedChunksBySection[sectionId]?.[chunkId]);
  };

  const toggleChunkExpanded = (sectionId: string, chunkId: string) => {
    setExpandedChunksBySection((prev) => ({
      ...prev,
      [sectionId]: {
        ...(prev[sectionId] || {}),
        [chunkId]: !prev[sectionId]?.[chunkId],
      },
    }));
  };

  const handleCitationSourceClick = useCallback(
    (sourceId: string) => {
      if (!sourceId || !activeSectionId) return;
      const targetGroup =
        activeCitationGroups.find((item) => item.id === sourceId) ||
        activeCitationGroups.find((item) =>
          (item.chunkIds || []).includes(sourceId),
        );
      if (!targetGroup || !targetGroup.chunkIds.length) return;

      setShowContext(true);
      setActiveContextTab("source");
      setHighlightedChunksBySection((prev) => ({
        ...prev,
        [activeSectionId]: targetGroup.chunkIds,
      }));

      const firstChunkId = targetGroup.chunkIds[0];
      window.setTimeout(() => {
        const node = chunkCardRefs.current[firstChunkId];
        if (node) {
          node.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }, 80);
    },
    [activeCitationGroups, activeSectionId],
  );

  const formatScore10 = (value: number) => {
    if (!Number.isFinite(value)) return "0.0";
    return Math.max(0, Math.min(10, value)).toFixed(1);
  };

  useEffect(() => {
    if (!projectId || !activeSectionId) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("section") === activeSectionId) return;
    url.searchParams.set("section", activeSectionId);
    const nextSearch = url.searchParams.toString();
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${nextSearch ? `?${nextSearch}` : ""}`,
    );
  }, [projectId, activeSectionId]);


  useEffect(() => {
    if (promptInputRef.current) {
      promptInputRef.current.style.height = "auto";
      promptInputRef.current.style.height = `${promptInputRef.current.scrollHeight}px`;
    }
  }, [activeSectionId, activeSection?.prompt]);

  useEffect(() => {
    if (outlinePromptRef.current) {
      outlinePromptRef.current.style.height = "auto";
      outlinePromptRef.current.style.height = `${outlinePromptRef.current.scrollHeight}px`;
    }
  }, [outlinePrompt, sections.length]);

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

  const setSectionLocal = (sectionId: string, updates: Partial<Section>) => {
    setSections((prev) =>
      prev.map((item) => {
        if (item.id === sectionId) {
          const nextItem = { ...item, ...updates };
          if (updates.title !== undefined) {
            const inferred = inferLevelFromTitle(updates.title);
            if (inferred !== null) {
              nextItem.level = Math.max(1, inferred);
            }
          }
          return nextItem;
        }
        return item;
      }),
    );
  };

  const scheduleSave = (sectionId: string, updates: Partial<Section>) => {
    pendingChangesRef.current[sectionId] = {
      ...(pendingChangesRef.current[sectionId] || {}),
      ...updates,
    };

    if (saveTimers.current[sectionId]) {
      window.clearTimeout(saveTimers.current[sectionId]);
    }
    saveTimers.current[sectionId] = window.setTimeout(async () => {
      const mergedChanges = pendingChangesRef.current[sectionId];
      if (!mergedChanges) {
        return;
      }

      try {
        setSaveStatus("saving");
        await patchEditorSection(sectionId, {
          title: mergedChanges.title,
          content: mergedChanges.content,
          prompt: mergedChanges.prompt,
          order: mergedChanges.order,
          level: mergedChanges.level,
        });
        delete pendingChangesRef.current[sectionId];
        setSaveStatus("saved");
        window.setTimeout(() => setSaveStatus("idle"), 1200);
      } catch (e) {
        const message = e instanceof Error ? e.message : "Lưu section thất bại";
        if (message.includes("429")) {
          setError(
            "Bạn đang thao tác quá nhanh, hệ thống đang tự điều tiết lưu. Vui lòng chờ 1-2 giây.",
          );
        } else {
          setError(message);
        }
      }
    }, 400);
  };

  const updateSection = (sectionId: string, updates: Partial<Section>) => {
    setSectionLocal(sectionId, updates);
    scheduleSave(sectionId, updates);
  };

  useEffect(() => {
    const handleReplacePlaceholder = (e: Event) => {
      const customEvent = e as CustomEvent<{ placeholderSrc: string; newSrc: string }>;
      const { placeholderSrc, newSrc } = customEvent.detail;
      if (activeSection) {
        let decodedSrc = placeholderSrc;
        try {
          decodedSrc = decodeURIComponent(placeholderSrc);
        } catch {}

        if (activeSection.content.includes(decodedSrc)) {
          const updatedContent = activeSection.content.replace(decodedSrc, newSrc);
          updateSection(activeSection.id, { content: updatedContent });
          toastService.success("Đã thay thế placeholder bằng hình ảnh thành công!");
        } else if (activeSection.content.includes(placeholderSrc)) {
          const updatedContent = activeSection.content.replace(placeholderSrc, newSrc);
          updateSection(activeSection.id, { content: updatedContent });
          toastService.success("Đã thay thế placeholder bằng hình ảnh thành công!");
        }
      }
    };

    window.addEventListener("replace-placeholder", handleReplacePlaceholder);
    return () => {
      window.removeEventListener("replace-placeholder", handleReplacePlaceholder);
    };
  }, [activeSection, updateSection]);

  useEffect(() => {
    if (activeSectionId) {
      const cached = localStorage.getItem(`rag.suggestions.${activeSectionId}`);
      if (cached) {
        try {
          const rawParsed = JSON.parse(cached);
          const cleanedMap: Record<string, string> = {};
          Object.entries(rawParsed).forEach(([k, v]) => {
            cleanedMap[k] = cleanSuggestedPrompt(v as string);
          });
          setSuggestedPrompts(cleanedMap);
          const wasOpen = localStorage.getItem(`rag.suggestions.open.${activeSectionId}`) === "true";
          setShowPromptSuggestions(wasOpen);
        } catch {
          setSuggestedPrompts({});
          setShowPromptSuggestions(false);
        }
      } else {
        setSuggestedPrompts({});
        setShowPromptSuggestions(false);
      }
      
      const savedTab = localStorage.getItem(`rag.suggestions.tab.${activeSectionId}`) || "theory";
      setActiveSuggestTab(savedTab);

      // Scroll active section into view in sidebar
      const activeEl = document.querySelector(`[data-section-id="${activeSectionId}"]`);
      if (activeEl) {
        setTimeout(() => {
          activeEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }, 100);
      }
    } else {
      setSuggestedPrompts({});
      setShowPromptSuggestions(false);
      setActiveSuggestTab("theory");
    }
  }, [activeSectionId]);

  const handleSuggestPrompt = async (sectionId: string, _promptType: string = "theory") => {
    if (!projectId || !sectionId) return;
    try {
      setSuggestingPromptId(sectionId);
      setError("");
      const res = await getSuggestedPrompt(projectId, sectionId);
      if (res.success && res.data && res.data.suggestions) {
        const promptsMap: Record<string, string> = {};
        res.data.suggestions.forEach((item: any) => {
          promptsMap[item.type] = cleanSuggestedPrompt(item.prompt || "");
        });
        setSuggestedPrompts(promptsMap);
        localStorage.setItem(`rag.suggestions.${sectionId}`, JSON.stringify(promptsMap));
      } else {
        toastService.error("Không thể lấy gợi ý prompt.");
      }
    } catch (err) {
      toastService.error("Lỗi khi kết nối với máy chủ.");
    } finally {
      setSuggestingPromptId("");
    }
  };

  const handleSelectSuggestTab = (tabId: string) => {
    setActiveSuggestTab(tabId);
    if (activeSectionId) {
      localStorage.setItem(`rag.suggestions.tab.${activeSectionId}`, tabId);
    }
  };

  const handleToggleSuggestions = () => {
    if (!activeSectionId) return;
    const nextShow = !showPromptSuggestions;
    setShowPromptSuggestions(nextShow);
    localStorage.setItem(`rag.suggestions.open.${activeSectionId}`, String(nextShow));
    if (nextShow && Object.keys(suggestedPrompts).length === 0) {
      handleSuggestPrompt(activeSectionId);
    }
  };

  const hasGeneratedContent = (section: Section): boolean => {
    return (section.content || "").trim().length > 0;
  };

  const getChildrenSections = useCallback((parent: Section, list: Section[]): Section[] => {
    const sorted = list.slice().sort((a, b) => a.order - b.order);
    const parentIndex = sorted.findIndex((s) => s.id === parent.id);
    if (parentIndex < 0) return [];
    
    const children: Section[] = [];
    for (let i = parentIndex + 1; i < sorted.length; i++) {
      if (sorted[i].level > parent.level) {
        children.push(sorted[i]);
      } else {
        break;
      }
    }
    return children;
  }, []);

  const generateNewChildTitle = useCallback((parent: Section, child: Section, list: Section[]): string => {
    const parentTitle = (parent.title || "").trim();
    const parentDottedMatch = parentTitle.match(/^(\d+(?:\.\d+)*)/);
    const parentPrefix = parentDottedMatch ? parentDottedMatch[1] : "";
    
    if (!parentPrefix) {
      return (child.title || "").replace(/^(\d+(?:\.\d+)*\s*)/, "");
    }
    
    const children = getChildrenSections(parent, list);
    const directChildren = children.filter((c) => c.level === parent.level + 1);
    const nextChildIndex = directChildren.length + 1;
    
    const newPrefix = `${parentPrefix}.${nextChildIndex}`;
    const childTitleClean = (child.title || "").replace(/^(\d+(?:\.\d+)*\s*)/, "");
    
    return `${newPrefix} ${childTitleClean}`;
  }, [getChildrenSections]);

  const handlePreviewMouseUp = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isEditingSelection) return;

    const selection = window.getSelection();
    if (!selection) return;

    const text = selection.toString().trim();
    const clickedElement = e.target as HTMLElement;

    // Prevent clearing or recalculating selection if clicking within the selection popup itself
    if (clickedElement.closest(".ai-selection-popup")) {
      return;
    }

    if (!text) {
      setSelectedText("");
      setSelectionRange(null);
      return;
    }

    try {
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const containerRect = e.currentTarget.getBoundingClientRect();
      const x = rect.left - containerRect.left + rect.width / 2;
      const y = rect.top - containerRect.top + e.currentTarget.scrollTop;

      setSelectedText(text);
      setSelectionRange({ x, y });
    } catch (err) {
      console.error("Failed to calculate selection position", err);
    }
  };

  const handleApplySelectionEdit = async () => {
    if (!projectId || !activeSectionId || !selectedText.trim() || !selectionPrompt.trim()) return;
    setIsEditingSelection(true);
    try {
      const res = await editSelection({
        project_id: projectId,
        section_id: activeSectionId,
        selected_text: selectedText,
        prompt: selectionPrompt,
      });

      if (res.success) {
        toastService.success("AI đã đề xuất bản sửa đổi!");
        setSelectionDiff({
          originalText: selectedText,
          refinedText: res.content,
          sectionId: activeSectionId,
        });
        setSelectionPrompt("");
      } else {
        toastService.error("Không thể xử lý yêu cầu sửa đoạn bôi đen.");
      }
    } catch (err) {
      toastService.error(
        err instanceof Error ? err.message : "Đã xảy ra lỗi khi gọi AI sửa đoạn bôi đen."
      );
    } finally {
      setIsEditingSelection(false);
    }
  };

  const handleAcceptSelectionDiff = () => {
    if (!selectionDiff || !activeSectionId) return;

    const activeSec = sections.find((s) => s.id === activeSectionId);
    if (!activeSec) return;

    const newContent = activeSec.content.replace(
      selectionDiff.originalText,
      selectionDiff.refinedText
    );

    updateSection(activeSectionId, { content: newContent });
    toastService.success("Đã áp dụng các thay đổi từ AI!");

    setSelectionDiff(null);
    setSelectedText("");
    setSelectionRange(null);
  };

  const handleRejectSelectionDiff = () => {
    setSelectionDiff(null);
    setSelectedText("");
    setSelectionRange(null);
    toastService.info("Đã hủy bỏ đề xuất chỉnh sửa từ AI.");
  };

  const handleNestSection = async (sourceId: string, targetId: string) => {
    await flushPendingSavesAndWait();
    const sorted = sections.slice().sort((a, b) => a.order - b.order);
    const sourceIndex = sorted.findIndex((item) => item.id === sourceId);
    const targetIndex = sorted.findIndex((item) => item.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;

    const source = sorted[sourceIndex];
    const target = sorted[targetIndex];

    // Prevent nesting a parent under itself or its descendants
    if (sourceId === targetId) return;
    const sourceDescendants = getChildrenSections(source, sorted);
    if (sourceDescendants.some((d) => d.id === targetId)) {
      toastService.error("Không thể lồng mục cha vào trong mục con của chính nó!");
      return;
    }

    const nextLevel = target.level + 1;
    const nextTitleText = generateNewChildTitle(target, source, sorted);
    const levelDelta = nextLevel - source.level;

    // Shallow copy and update level for the moved subtree to trigger React state updates cleanly
    const movedGroup = [source, ...sourceDescendants].map((item) => ({
      ...item,
      level: Math.max(1, item.level + levelDelta),
    }));
    
    // Update the title text of the nested parent item
    movedGroup[0].title = nextTitleText;

    // Filter out the old items of the moved subtree
    const reordered = sorted.filter((item) => !movedGroup.some((m) => m.id === item.id));

    const targetInReordered = reordered.find((item) => item.id === targetId);
    if (!targetInReordered) return;

    const targetChildren = getChildrenSections(targetInReordered, reordered);
    let insertIndex = reordered.findIndex((item) => item.id === (targetChildren.length > 0 ? targetChildren[targetChildren.length - 1].id : targetId));
    
    reordered.splice(insertIndex + 1, 0, ...movedGroup);

    // Re-index order
    const nextSectionsWithRawOrders = reordered.map((item, index) => ({
      ...item,
      order: index,
    }));

    // Recalculate prefixes for the final list to rewrite title texts
    const prefixes: Record<string, string> = {};
    const counts: number[] = [];
    for (const s of nextSectionsWithRawOrders) {
      const lv = s.level || 1;
      counts.length = lv;
      counts[lv - 1] = (counts[lv - 1] || 0) + 1;
      if (lv === 1) {
        prefixes[s.id] = `Chương ${counts[0]}.`;
      } else {
        prefixes[s.id] = counts.slice(0, lv).join(".");
      }
    }

    const finalSections = nextSectionsWithRawOrders.map((s) => {
      const cleanText = getCleanTitle(s.title);
      const prefix = prefixes[s.id] || "";
      let formattedPrefix = prefix;
      if (prefix && !prefix.startsWith("Chương") && !prefix.startsWith("Chuong")) {
        formattedPrefix = prefix.endsWith(".") ? prefix : `${prefix}.`;
      }
      const newTitle = formattedPrefix ? `${formattedPrefix} ${cleanText}` : cleanText;
      return {
        ...s,
        title: newTitle,
      };
    });

    setSections(finalSections);
    toastService.success(`Đã lồng mục "${getCleanTitle(source.title)}" làm con của "${getCleanTitle(target.title)}"`);

    if (projectId) {
      setSaveStatus("saving");
      try {
        // Save the updated levels and titles of all items in the subtree to the server
        const savePromises = finalSections
          .filter((s) => movedGroup.some((m) => m.id === s.id))
          .map((s) => updateSection(s.id, { title: s.title, level: s.level }));
        
        await Promise.all(savePromises);
        await reorderEditorSections(projectId, finalSections.map((s) => s.id));
        setSaveStatus("saved");
        window.setTimeout(() => setSaveStatus("idle"), 1200);
      } catch (err) {
        setError("Không thể lưu cấu trúc lồng mục con mới.");
      }
    }
  };

  const handleReorderSections = useCallback(
    (sourceId: string, targetId: string, mode: "reorder-before" | "reorder-after" | null = null) => {
      if (!sourceId || !targetId || sourceId === targetId) return;

      const sorted = sections.slice().sort((a, b) => a.order - b.order);
      const sourceIndex = sorted.findIndex((item) => item.id === sourceId);
      const targetIndex = sorted.findIndex((item) => item.id === targetId);
      if (sourceIndex < 0 || targetIndex < 0) return;

      const source = sorted[sourceIndex];
      const target = sorted[targetIndex];

      // Prevent moving parent under its own descendants
      const descendants = getChildrenSections(source, sorted);
      if (descendants.some((d) => d.id === targetId)) {
        toastService.error("Không thể di chuyển mục cha vào trong mục con của chính nó!");
        return;
      }

      const levelDelta = target.level - source.level;

      // Shallow copy and update level for the moved group to trigger React state updates cleanly
      const movedGroup = [source, ...descendants].map((item) => ({
        ...item,
        level: Math.max(1, item.level + levelDelta),
      }));

      // Filter out moved group from the list
      const reordered = sorted.filter((item) => !movedGroup.some((m) => m.id === item.id));

      let insertIndex = reordered.findIndex((item) => item.id === targetId);
      if (insertIndex < 0) return;

      if (mode === "reorder-after") {
        // If reordering after, we insert after the target and all its remaining children in the list
        const targetItem = reordered[insertIndex];
        const targetChildren = getChildrenSections(targetItem, reordered);
        if (targetChildren.length > 0) {
          const lastChild = targetChildren[targetChildren.length - 1];
          insertIndex = reordered.findIndex((item) => item.id === lastChild.id);
        }
        insertIndex += 1;
      }

      reordered.splice(insertIndex, 0, ...movedGroup);

      // Re-index order
      const nextSectionsWithRawOrders = reordered.map((item, index) => ({
        ...item,
        order: index,
      }));

      // Recalculate prefixes for the final list to rewrite title texts
      const prefixes: Record<string, string> = {};
      const counts: number[] = [];
      for (const s of nextSectionsWithRawOrders) {
        const lv = s.level || 1;
        counts.length = lv;
        counts[lv - 1] = (counts[lv - 1] || 0) + 1;
        if (lv === 1) {
          prefixes[s.id] = `Chương ${counts[0]}.`;
        } else {
          prefixes[s.id] = counts.slice(0, lv).join(".");
        }
      }

      const finalSections = nextSectionsWithRawOrders.map((s) => {
        const cleanText = getCleanTitle(s.title);
        const prefix = prefixes[s.id] || "";
        let formattedPrefix = prefix;
        if (prefix && !prefix.startsWith("Chương") && !prefix.startsWith("Chuong")) {
          formattedPrefix = prefix.endsWith(".") ? prefix : `${prefix}.`;
        }
        const newTitle = formattedPrefix ? `${formattedPrefix} ${cleanText}` : cleanText;
        return {
          ...s,
          title: newTitle,
        };
      });

      setSections(finalSections);
      toastService.success("Đã thay đổi thứ tự mục bài giảng");

      if (projectId) {
        setSaveStatus("saving");
        // Save the updated levels and titles of all items in the moved group to the server
        const savePromises = finalSections
          .filter((s) => movedGroup.some((m) => m.id === s.id))
          .map((s) => updateSection(s.id, { title: s.title, level: s.level }));
        
        Promise.all(savePromises)
          .then(() => reorderEditorSections(projectId, finalSections.map((s) => s.id)))
          .then(() => {
            setSaveStatus("saved");
            window.setTimeout(() => setSaveStatus("idle"), 1200);
          })
          .catch((err) => {
            setError(
              err instanceof Error
                ? err.message
                : "Không thể lưu thứ tự mục lục vào máy chủ.",
            );
          });
      }
    },
    [sections, projectId],
  );

  useEffect(() => {
    persistDraft(sections, activeSectionId, outlinePrompt);
  }, [sections, activeSectionId, outlinePrompt, persistDraft]);

  useEffect(() => {
    latestDraftRef.current = {
      sections,
      activeSectionId,
      outlinePrompt,
    };
  }, [sections, activeSectionId, outlinePrompt]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      const latest = latestDraftRef.current;
      flushPendingSaves();
      persistDraft(
        latest.sections,
        latest.activeSectionId,
        latest.outlinePrompt,
      );
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      Object.values(saveTimers.current).forEach((timerId) => {
        window.clearTimeout(timerId);
      });
      const latest = latestDraftRef.current;
      flushPendingSaves();
      persistDraft(
        latest.sections,
        latest.activeSectionId,
        latest.outlinePrompt,
      );
    };
  }, [flushPendingSaves, persistDraft]);

  const pollSectionEvaluations = useCallback((sectionIds: string[]) => {
    if (sectionIds.length === 0) return;

    const pollAttempts: Record<string, number> = {};
    sectionIds.forEach((id) => {
      pollAttempts[id] = 0;
    });

    const activePolls = new Set(sectionIds);

    const intervalId = window.setInterval(async () => {
      if (activePolls.size === 0) {
        window.clearInterval(intervalId);
        return;
      }

      const currentIds = Array.from(activePolls);
      for (const sectionId of currentIds) {
        pollAttempts[sectionId] = (pollAttempts[sectionId] || 0) + 1;

        try {
          const sectionData = await getEditorSection(sectionId);
          if (sectionData && sectionData.evaluation) {
            const normalized = normalizeSectionEvaluation(sectionData.evaluation);
            if (normalized) {
              if (normalized.is_fallback === false) {
                setEvaluationBySection((prev) => ({
                  ...prev,
                  [sectionId]: normalized,
                }));
                activePolls.delete(sectionId);
              }
            }
          }
        } catch (error) {
          console.error(`Error polling evaluation for section ${sectionId}:`, error);
        }

        if (pollAttempts[sectionId] >= 15) {
          activePolls.delete(sectionId);
        }
      }
    }, 2000);
  }, []);

  const handleGenerate = (sectionId: string) => {
    const target = sections.find((s) => s.id === sectionId);
    if (!target || !projectId) return;

    if (!(target.prompt || "").trim()) {
      promptInputRef.current?.focus();
      return;
    }

    setSectionLocal(sectionId, { isGenerating: true });
    void (async () => {
      try {
        await toastService.promise(
          (async () => {
            await flushPendingSavesAndWait();
            const generated = await generateEditorSection({
              project_id: projectId,
              section_id: sectionId,
              prompt: target.prompt || "",
            });

            // 1. Handle Structure updates (intent == 'structure')
            if (generated.is_structure_update) {
              const mapped: Section[] = (generated.sections || []).map((item: any) => ({
                id: item.id,
                title: item.title,
                prompt: item.prompt || "",
                content: sanitizeSectionContentByTitle(
                  item.content_markdown || "",
                  item.title || "",
                ),
                order: item.order_index,
                level: Math.max(
                  1,
                  item.level || inferLevelFromTitle(item.title || "") || 1,
                ),
              }));
              setSections(mapped);
              setSectionLocal(sectionId, { isGenerating: false });
              setError("");
              return generated;
            }

            // 2. Standard content generation flow
            const sentinel = extractControlSentinel(generated.content || "");
            if (sentinel) {
              setSectionLocal(sectionId, { isGenerating: false });
              updateSection(sectionId, { content: "" });
            } else {
              const sanitizedGeneratedContent = sanitizeSectionContentByTitle(
                generated.content || "",
                target.title || "",
              );
              setSectionLocal(sectionId, {
                content: sanitizedGeneratedContent,
                isGenerating: false,
              });
              setError("");
              setSaveStatus("saved");
              window.setTimeout(() => setSaveStatus("idle"), 1200);
            }
            setChunksBySection((prev) => ({
              ...prev,
              [sectionId]: (generated.retrieved_chunks || []).map((item) => ({
                id: item.id,
                text: item.text,
                score: Number(item.score || 0),
                source: item.source || item.title || "",
                title: item.title || "",
                pageNumber:
                  typeof item.page_number === "number"
                    ? item.page_number
                    : null,
                startPage:
                  typeof item.start_page === "number" ? item.start_page : null,
                endPage:
                  typeof item.end_page === "number" ? item.end_page : null,
                metadata: item.metadata
                  ? {
                      docId: item.metadata.doc_id || "",
                      fileName: item.metadata.file_name || "",
                      chapter: item.metadata.chapter || "",
                      section: item.metadata.section || "",
                      subsection: item.metadata.subsection || "",
                      chapterTitle: item.metadata.chapter_title || "",
                      sectionTitle: item.metadata.section_title || "",
                      subsectionTitle: item.metadata.subsection_title || "",
                      breadcrumb: item.metadata.breadcrumb || "",
                      startPage:
                        typeof item.metadata.start_page === "number"
                          ? item.metadata.start_page
                          : null,
                      endPage:
                        typeof item.metadata.end_page === "number"
                          ? item.metadata.end_page
                          : null,
                    }
                  : undefined,
              })),
            }));
            setExpandedChunksBySection((prev) => ({
              ...prev,
              [sectionId]: {},
            }));
            setHighlightedChunksBySection((prev) => ({
              ...prev,
              [sectionId]: [],
            }));
            setEvaluationBySection((prev) => ({
              ...prev,
              [sectionId]: generated.evaluation || null,
            }));

            if (!sentinel) {
              pollSectionEvaluations([sectionId]);
            }

            if (sentinel) {
              throw new Error(
                buildSentinelErrorMessage(sentinel, target.title),
              );
            }

            return generated;
          })(),
          {
            loading: `Đang tạo nội dung cho mục "${target?.title || "chi tiết"}"...`,
            success: (data) => {
              if (data && data.is_structure_update) {
                return `Cập nhật cấu trúc mục lục cho mục "${target?.title || "chi tiết"}" thành công!`;
              }
              return `Tạo nội dung mục "${target?.title || "chi tiết"}" thành công.`;
            },
            error: (err) =>
              err instanceof Error ? err.message : `Tạo nội dung mục "${target?.title || "chi tiết"}" thất bại`,
          },
        );      } catch (e) {
        setSectionLocal(sectionId, { isGenerating: false });
        setError(e instanceof Error ? e.message : "Generate section thất bại");
      }
    })();
  };

  // --- Batch Generation Handler ---
  const handleBatchGenerate = (groupId: string, sectionIds: string[]) => {
    if (!projectId || batchGeneratingGroupId) return;
    const prompt = activeSection?.prompt ||
      sections.find((s) => sectionIds.includes(s.id))?.prompt || "";

    // Mark all sections in the group as loading
    sectionIds.forEach((sid) => setSectionLocal(sid, { isGenerating: true }));
    setBatchGeneratingGroupId(groupId);

    void (async () => {
      try {
        await toastService.promise(
          (async () => {
            const result = await generateBatchSections({
              project_id: projectId,
              section_ids: sectionIds,
              prompt,
            });

            let anySuccess = false;
            for (const sid of sectionIds) {
              const sdata = result.sections[sid];
              const sectionTitle = sections.find((s) => s.id === sid)?.title || "";

              if (!sdata) {
                setSectionLocal(sid, { isGenerating: false });
                continue;
              }

              const sentinel = (sdata.sentinel || "").toUpperCase() as ControlSentinel | "";
              if (sentinel && CONTROL_SENTINELS.includes(sentinel as ControlSentinel)) {
                setSectionLocal(sid, { isGenerating: false });
                updateSection(sid, { content: "" });
              } else {
                const sanitized = sanitizeSectionContentByTitle(
                  sdata.content || "",
                  sectionTitle,
                );
                setSectionLocal(sid, { content: sanitized, isGenerating: false });
                anySuccess = true;
              }
            }

            if (anySuccess) {
              setSaveStatus("saved");
              window.setTimeout(() => setSaveStatus("idle"), 1200);

              const successfulIds = sectionIds.filter((sid) => {
                const sdata = result.sections[sid];
                if (!sdata) return false;
                const sentinel = (sdata.sentinel || "").toUpperCase() as ControlSentinel | "";
                return !sentinel || !CONTROL_SENTINELS.includes(sentinel);
              });
              if (successfulIds.length > 0) {
                pollSectionEvaluations(successfulIds);
              }
            }
          })(),
          {
            loading: `Đang tạo nhóm mục ${groupId === "INTRO_GROUP" ? "Mở đầu" : "Kết thúc"}...`,
            success: () => {
              const generatedTitles = sectionIds
                .map((sid) => sections.find((s) => s.id === sid)?.title)
                .filter(Boolean)
                .map((t) => `"${t}"`)
                .join(", ");
              return `Đã tạo xong các mục: ${generatedTitles}`;
            },
            error: (err: unknown) =>
              err instanceof Error ? err.message : "Không thể tạo nhóm mục",
          },
        );
      } finally {
        sectionIds.forEach((sid) => setSectionLocal(sid, { isGenerating: false }));
        setBatchGeneratingGroupId(null);
      }
    })();
  };

  const handleGenerateOutline = async () => {
    if (!projectId) return;
    if (!outlinePrompt.trim()) {
      setError(
        `Vui lòng nhập prompt để sinh mục lục. Gợi ý: ${TOC_PROMPT_SUGGESTION}`,
      );
      return;
    }
    try {
      setError("");
      setIsGeneratingOutline(true);
      localStorage.removeItem(`rag.outline.approved.${projectId}`);
      setIsOutlineApproved(false);
      const generatedSections = await toastService.promise(
        generateEditorProjectOutline(projectId, outlinePrompt.trim()),
        {
          loading: "Đang sinh mục lục...",
          success: "Sinh mục lục thành công.",
          error: (err) =>
            err instanceof Error ? err.message : "Sinh mục lục thất bại",
        },
      );
      const mapped: Section[] = (generatedSections || []).map((item) => ({
        id: item.id,
        title: item.title,
        prompt: item.prompt || "",
        content: sanitizeSectionContentByTitle(
          item.content_markdown || "",
          item.title || "",
        ),
        order: item.order_index,
        level: Math.max(1, item.level || inferLevelFromTitle(item.title || "") || 1),
      }));
      setSections(mapped);
      setActiveSectionId(mapped[0]?.id || "");
      setChunksBySection({});
      setExpandedChunksBySection({});
      setHighlightedChunksBySection({});
      setEvaluationBySection({});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sinh mục lục thất bại");
    } finally {
      setIsGeneratingOutline(false);
    }
  };

  const generateSmartDefaultTitle = (prevSection: Section | undefined): string => {
    if (!prevSection) return "Section mới";
    const title = (prevSection.title || "").trim();

    // Match dotted numbers like 3.1.3 or 3.1
    const dottedMatch = title.match(/^(\d+(?:\.\d+)*)/);
    if (dottedMatch) {
      const prefix = dottedMatch[1];
      const parts = prefix.split(".");
      const lastNum = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(lastNum)) {
        parts[parts.length - 1] = String(lastNum + 1);
        const nextPrefix = parts.join(".");
        return `${nextPrefix} Section mới`;
      }
    }

    // Match "Chương X" or "Chương X."
    const chapterMatch = title.match(/^(Chương|Chuong)\s+(\d+)/i);
    if (chapterMatch) {
      const label = chapterMatch[1];
      const num = parseInt(chapterMatch[2], 10);
      if (!isNaN(num)) {
        return `${label} ${num + 1}. Section mới`;
      }
    }

    return "Section mới";
  };

  const handleCreateSection = async () => {
    if (!projectId) return;
    try {
      const sorted = sections.slice().sort((a, b) => a.order - b.order);
      const prevSection = sorted[sorted.length - 1];
      const defaultTitle = generateSmartDefaultTitle(prevSection);

      const created = await createEditorSection({
        project_id: projectId,
        title: defaultTitle,
        prompt: "",
        order: sections.length,
        level: prevSection ? prevSection.level : 1,
      });
      const next: Section = {
        id: created.id,
        title: created.title,
        prompt: created.prompt,
        content: sanitizeSectionContentByTitle(
          created.content_markdown,
          created.title || "",
        ),
        order: created.order_index,
        level: Math.max(
          1,
          created.level || inferLevelFromTitle(created.title || "") || 1,
        ),
      };
      setSections((prev) => [...prev, next]);
      setActiveSectionId(created.id);
      setChunksBySection((prev) => ({ ...prev, [created.id]: [] }));
      setExpandedChunksBySection((prev) => ({ ...prev, [created.id]: {} }));
      setHighlightedChunksBySection((prev) => ({ ...prev, [created.id]: [] }));
      setEvaluationBySection((prev) => ({ ...prev, [created.id]: null }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tạo được section mới");
    }
  };

  const handleInsertSectionAfter = async (afterOrder: number) => {
    if (!projectId) return;
    try {
      await flushPendingSavesAndWait();
      const sorted = sections.slice().sort((a, b) => a.order - b.order);
      const prevSection = sorted[afterOrder];
      const defaultTitle = generateSmartDefaultTitle(prevSection);

      await createEditorSection({
        project_id: projectId,
        title: defaultTitle,
        prompt: "",
        order: afterOrder + 1,
        level: prevSection ? prevSection.level : 1,
      });
      await loadProject(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không chèn được section");
    }
  };

  const handleDeleteSection = async (sectionId: string) => {
    try {
      await flushPendingSavesAndWait();
      const target = sections.find((s) => s.id === sectionId);
      if (!target) return;

      const children = getChildrenSections(target, sections);
      if (children.length > 0) {
        setDeleteTargetSection(target);
        setDeleteChildrenCount(children.length);
      } else {
        await executeDeleteSection(sectionId);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không xóa được mục.");
    }
  };

  const executeDeleteSection = async (sectionId: string, deleteChildren = false) => {
    try {
      setDeleteTargetSection(null);
      await flushPendingSavesAndWait();
      
      if (deleteChildren) {
        const target = sections.find((s) => s.id === sectionId);
        if (target) {
          const children = getChildrenSections(target, sections);
          for (const child of children) {
            await deleteEditorSection(child.id);
          }
        }
      } else {
        const target = sections.find((s) => s.id === sectionId);
        if (target) {
          const children = getChildrenSections(target, sections);
          for (const child of children) {
            const nextLevel = Math.max(1, child.level - 1);
            const childTitleClean = (child.title || "").replace(/^(\d+(?:\.\d+)*\s*)/, "");
            let nextTitle = childTitleClean;
            if (nextLevel > 1) {
              const targetPrefixMatch = (target.title || "").match(/^(\d+(?:\.\d+)*)/);
              if (targetPrefixMatch) {
                const parentPrefixParts = targetPrefixMatch[1].split(".");
                parentPrefixParts.pop();
                const parentPrefix = parentPrefixParts.join(".");
                if (parentPrefix) {
                  nextTitle = `${parentPrefix}.${child.order} ${childTitleClean}`;
                }
              }
            }
            updateSection(child.id, { title: nextTitle, level: nextLevel });
          }
        }
      }

      await deleteEditorSection(sectionId);
      await loadProject(false);
      toastService.success("Đã xóa mục thành công.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không xóa được mục.");
    }
  };

  const handleExportProject = async (format: EditorProjectExportFormat) => {
    if (!projectId) return;
    setIsDownloadMenuOpen(false);
    setExportingFormat(format);

    try {
      await flushPendingSavesAndWait();
      const blob = await exportEditorProject(projectId, format);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${projectTitle.replace(/\s+/g, "_") || "teaching_project"}.${format}`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      const fallbackMessage = `Xuất ${EXPORT_LABELS[format]} thất bại`;
      setError(e instanceof Error ? e.message : fallbackMessage);
    } finally {
      setExportingFormat(null);
    }
  };

  const handleOpenPreviewTab = async () => {
    if (!projectId) return;
    try {
      await flushPendingSavesAndWait();
      const sectionParam = activeSectionId
        ? `?section=${encodeURIComponent(activeSectionId)}`
        : "";
      window.open(
        `/materials/${projectId}/preview${sectionParam}`,
        "_blank",
      );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Không thể đồng bộ trước khi mở xem trước",
      );
    }
  };



  const handleBackToList = async () => {
    try {
      await flushPendingSavesAndWait();
    } catch {
      // Keep navigation available even if sync fails once.
    } finally {
      if (isOutlineApproved) {
        setIsOutlineApproved(false);
        localStorage.setItem(`rag.outline.approved.${projectId}`, "false");
      } else {
        navigate("/?tab=generate");
      }
    }
  };

  const handleOpenQuizTab = () => {
    const QUIZ_STORAGE_KEY = "rag.quiz.pending";
    const lessonContent = orderedSections
      .map((s) => `## ${s.title}\n${s.content || ""}`.trim())
      .filter((s) => s.length > 10)
      .join("\n\n");
    if (!lessonContent.trim()) {
      toastService.error("Bài giảng chưa có nội dung. Hãy sinh nội dung trước khi tạo quiz.");
      return;
    }
    try {
      const raw = localStorage.getItem(QUIZ_STORAGE_KEY);
      let draft = { projectId, lessonContent, numQuestions: 5 };
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.projectId === projectId) {
          // Preserve items and answers if they belong to the same project
          draft = { ...parsed, lessonContent };
        }
      }
      localStorage.setItem(QUIZ_STORAGE_KEY, JSON.stringify(draft));
    } catch (e) {
      localStorage.setItem(
        QUIZ_STORAGE_KEY,
        JSON.stringify({ projectId, lessonContent, numQuestions: 5 }),
      );
    }
    window.location.href = "/quiz";
  };


  // Resize text area when its content or the active section changes
  useEffect(() => {
    if (promptInputRef.current) {
      promptInputRef.current.style.height = "auto";
      promptInputRef.current.style.height = `${promptInputRef.current.scrollHeight}px`;
    }
  }, [activeSection?.prompt, activeSectionId]);

  const handleUpdateStructure = async () => {
    if (!projectId || !structurePromptText.trim() || !activeSectionId) return;
    try {
      setIsUpdatingStructure(true);
      setError("");
      await flushPendingSavesAndWait();
      const result = await generateEditorSection({
        project_id: projectId,
        section_id: activeSectionId,
        prompt: structurePromptText.trim(),
      });
      if (result.is_structure_update && result.sections) {
        const mapped: Section[] = result.sections.map((item: any) => ({
          id: item.id,
          title: item.title,
          prompt: item.prompt || "",
          content: sanitizeSectionContentByTitle(
            item.content_markdown || "",
            item.title || "",
          ),
          order: item.order_index,
          level: Math.max(1, item.level || inferLevelFromTitle(item.title || "") || 1),
        }));
        setSections(mapped);
        if (mapped.length > 0) {
          const stillExists = mapped.some((s) => s.id === activeSectionId);
          if (!stillExists) {
            setActiveSectionId(mapped[0].id);
          }
        }
        toastService.success("Cấu trúc mục lục đã được cập nhật!");
      } else {
        toastService.info("Không có thay đổi cấu trúc mục lục nào từ AI.");
      }
      setStructurePromptText("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cập nhật cấu trúc thất bại");
    } finally {
      setIsUpdatingStructure(false);
    }
  };

  const loadHistory = useCallback(async () => {
    if (!projectId || !activeSectionId) return;
    try {
      setLoadingHistory(true);
      const history = await getSectionHistory(projectId, activeSectionId);
      setHistoryEntries(
        history.map((item: any) => ({
          id: item.id,
          created_at: item.created_at || "",
          prompt: item.prompt || "",
          content_markdown: item.content_markdown || "",
        }))
      );
    } catch (e) {
      console.error("Failed to load section history:", e);
    } finally {
      setLoadingHistory(false);
    }
  }, [projectId, activeSectionId]);

  useEffect(() => {
    if (activeContextTab === "history") {
      void loadHistory();
    }
  }, [activeContextTab, activeSectionId, loadHistory]);

  useEffect(() => {
    const currentTheme = localStorage.getItem("theme") || "light";
    if (currentTheme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, []);

  const handleRestoreHistory = async (historyId: number) => {
    if (!projectId || !activeSectionId) return;
    try {
      setLoading(true);
      const restored = await restoreSectionHistory(projectId, activeSectionId, historyId);
      setSectionLocal(activeSectionId, {
        content: sanitizeSectionContentByTitle(
          restored.content_markdown || "",
          restored.title || "",
        ),
        title: restored.title,
        prompt: restored.prompt || "",
      });
      toastService.success("Khôi phục lịch sử thành công!");
      void loadHistory();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Khôi phục lịch sử thất bại");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-screen w-full flex flex-col bg-slate-50 dark:bg-slate-950 overflow-hidden text-slate-800 dark:text-slate-100">
      {/* 1. Navbar */}
      <header className="h-16 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-slate-200/60 dark:border-slate-800/80 flex items-center justify-between px-6 shrink-0 sticky top-0 z-30 shadow-sm shadow-slate-100/50 dark:shadow-none">
        <div className="flex items-center gap-4 flex-1 min-w-0 mr-4">
          <button
            onClick={() => void handleBackToList()}
            className="flex items-center gap-2 h-9 px-3 text-slate-500 hover:text-slate-800 hover:bg-slate-100 active:bg-slate-200 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-slate-850 dark:active:bg-slate-800 rounded-lg font-medium transition-all duration-200 shrink-0 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500/10"
          >
            <ArrowLeft size={16} />
            <span>Quay lại</span>
          </button>
          <div className="h-5 w-px bg-slate-200 dark:bg-slate-800 shrink-0"></div>
          <h1 className="font-bold text-slate-800 dark:text-slate-100 text-lg flex items-center gap-2 min-w-0">
            <FileText size={20} className="text-blue-600 shrink-0" />
            <span className="truncate max-w-[200px] lg:max-w-[320px]" title={projectTitle}>{projectTitle}</span>
          </h1>

          {/* Auto Save Status */}
          <div className="ml-4 flex items-center shrink-0 bg-slate-100 text-slate-600 text-[11px] px-2.5 py-0.5 rounded-full font-medium h-5">
            {saveStatus === "saving" && (
              <span className="text-amber-700 flex items-center gap-1">
                <Loader2 size={10} className="animate-spin" /> Đang lưu...
              </span>
            )}
            {saveStatus === "saved" && (
              <span className="text-emerald-700 flex items-center gap-1">
                <CheckCircle2 size={10} /> Đã lưu
              </span>
            )}
            {saveStatus === "idle" && (
              <span className="text-slate-600 flex items-center gap-1">
                Đã đồng bộ
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Global Theme Toggle (Trắng/Đen) */}
          <button
            onClick={toggleTheme}
            className={`flex items-center justify-center h-9 w-9 border rounded-lg transition-all duration-200 focus:outline-none ${
              theme === "light"
                ? "text-slate-500 border-slate-200 bg-white hover:text-violet-600 hover:bg-violet-50 hover:border-violet-200"
                : "text-slate-400 border-slate-700 bg-slate-900 hover:text-amber-400 hover:bg-amber-950/40 hover:border-amber-900/50"
            }`}
            title={theme === "light" ? "Chuyển sang nền tối (Dark mode)" : "Chuyển sang nền sáng (Light mode)"}
          >
            {theme === "light" ? <Moon size={16} /> : <Sun size={16} />}
          </button>

          {isOutlineApproved && (
            <>
              {/* Edit/Reader Mode Toggle */}
              <button
                onClick={() => setEditMode(!editMode)}
                className={`flex items-center gap-1.5 h-9 px-3 border rounded-lg font-medium transition duration-200 text-sm shadow-sm focus:outline-none ${
                  editMode
                    ? "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800"
                    : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-300 dark:border-slate-800 dark:hover:bg-slate-800"
                }`}
                title={editMode ? "Chuyển sang Chế độ Đọc (Ẩn mã nguồn Markdown)" : "Chuyển sang Chế độ Sửa (Hiện mã nguồn Markdown)"}
              >
                <Edit3 size={15} />
                <span>{editMode ? "Chế độ Sửa" : "Chế độ Đọc"}</span>
              </button>
              
              {/* Preview Button */}
              <button
                onClick={() => void handleOpenPreviewTab()}
                className="flex items-center gap-1.5 h-9 px-3.5 bg-emerald-50/50 hover:bg-emerald-100/70 active:bg-emerald-200/50 text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-300 dark:hover:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/50 rounded-lg font-medium transition duration-200 text-sm shadow-sm focus:outline-none"
                title="Xem trước giao diện hiển thị bài giảng học sinh"
              >
                <Eye size={15} />
                <span>Xem trước</span>
              </button>

              {/* Create Quiz Button */}
              <button
                onClick={() => handleOpenQuizTab()}
                className="flex items-center gap-1.5 h-9 px-3.5 bg-violet-50/50 hover:bg-violet-100/70 active:bg-violet-200/50 text-violet-700 dark:bg-violet-950/20 dark:text-violet-300 dark:hover:bg-violet-950/40 border border-violet-200 dark:border-violet-900/50 rounded-lg font-medium transition duration-200 text-sm shadow-sm focus:outline-none"
                title="Tạo tự động câu hỏi trắc nghiệm ôn tập bằng AI"
              >
                <HelpCircle size={15} className="text-violet-500" />
                <span>Tạo Quiz</span>
              </button>
              
              {/* Download Dropdown */}
              <div className="relative" ref={downloadMenuRef}>
                <button
                  onClick={() => setIsDownloadMenuOpen((prev) => !prev)}
                  disabled={Boolean(exportingFormat)}
                  className="flex items-center gap-1.5 h-9 px-3.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-lg font-medium transition duration-200 text-sm shadow-sm hover:shadow focus:outline-none disabled:opacity-60"
                  title="Tải bài giảng về máy (Word, Markdown, PDF, ...)"
                >
                  <Download size={15} />
                  <span>Tải về</span>
                  <ChevronDown size={14} className={`transition-transform duration-200 ${isDownloadMenuOpen ? 'rotate-180' : ''}`} />
                </button>

                {isDownloadMenuOpen && (
                  <div className="absolute right-0 top-full mt-2 w-56 rounded-xl border border-slate-200 bg-white shadow-xl z-30 overflow-hidden divide-y divide-slate-100 p-1.5 animate-in fade-in slide-in-from-top-2 duration-150">
                    <div className="py-1">
                      <div className="px-3 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                        Tải về bài giảng
                      </div>
                      {EXPORT_FORMATS.map((format) => (
                        <button
                          key={format}
                          onClick={() => void handleExportProject(format)}
                          disabled={Boolean(exportingFormat)}
                          className="w-full flex items-center gap-2.5 text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 rounded-lg transition duration-150 disabled:opacity-60"
                        >
                          {format === 'md' ? (
                            <FileCode size={15} className="text-emerald-500" />
                          ) : (
                            <FileText size={15} className="text-blue-500" />
                          )}
                          <span>{EXPORT_LABELS[format]}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Toggle Context Panel Button */}
              <button
                onClick={() => setShowContext(!showContext)}
                className={`h-9 w-9 flex items-center justify-center rounded-lg transition-all duration-200 border focus:outline-none ${
                  showContext 
                    ? "bg-indigo-600 hover:bg-indigo-700 text-white border-transparent shadow-md dark:bg-indigo-600 dark:hover:bg-indigo-700" 
                    : "text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 border-slate-200 bg-white dark:text-slate-400 dark:hover:bg-indigo-950/40 dark:hover:text-indigo-400 dark:border-slate-700"
                }`}
                title={showContext ? "Đóng bảng Tài liệu nguồn & Lịch sử" : "Mở bảng Tài liệu nguồn & Lịch sử"}
              >
                <PanelRight size={18} />
              </button>
            </>
          )}
        </div>
      </header>

      {/* 2. Content Area */}
      {!isOutlineApproved ? (
        <div className="flex-1 overflow-y-auto p-8 bg-slate-50/50 flex items-start justify-center relative">
          {loading && (
            <div className="absolute inset-0 bg-white/80 flex items-center justify-center z-20">
              <div className="w-full max-w-md space-y-4 animate-pulse p-6">
                <div className="h-6 bg-slate-200 rounded w-1/3 mb-4"></div>
                <div className="space-y-3">
                  <div className="h-4 bg-slate-100 rounded w-full"></div>
                  <div className="h-4 bg-slate-100 rounded w-5/6"></div>
                  <div className="h-4 bg-slate-100 rounded w-4/5"></div>
                </div>
              </div>
            </div>
          )}
          {error && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 text-sm bg-red-50 text-red-700 border border-red-200 rounded px-3 py-1 shadow-sm">
              {error}
            </div>
          )}
          {sections.length === 0 ? (
            <div className="w-full max-w-4xl bg-white rounded-2xl p-8 shadow-xl shadow-slate-100 border border-slate-100 animate-in fade-in duration-200">
              <h2 className="text-xl font-bold text-slate-800 mb-2 font-display">
                🚀 Bắt đầu Soạn thảo Bài giảng
              </h2>
              <p className="text-sm text-slate-500 mb-6 leading-relaxed">
                Nhập yêu cầu tổng quan về bài giảng rồi bấm <strong className="text-blue-600 font-semibold">Sinh mục lục</strong> để AI tự động xây dựng cấu trúc bài học hoàn chỉnh.
              </p>

               <textarea
                ref={(el) => {
                  outlinePromptRef.current = el;
                  if (el) {
                    el.style.height = "auto";
                    el.style.height = `${el.scrollHeight}px`;
                  }
                }}
                value={outlinePrompt}
                onChange={(e) => {
                  setOutlinePrompt(e.target.value);
                  e.target.style.height = "auto";
                  e.target.style.height = `${e.target.scrollHeight}px`;
                }}
                className="w-full border border-slate-200/85 rounded-xl p-4 min-h-[85px] max-h-[300px] overflow-y-auto resize-none text-slate-700 outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-colors duration-200 shadow-inner bg-slate-50/50 focus:bg-white text-sm"
                placeholder={TOC_PROMPT_SUGGESTION}
              />
              <div className="mt-5 flex justify-end">
                <button
                  onClick={handleGenerateOutline}
                  disabled={isGeneratingOutline}
                  className={`px-5 py-2.5 rounded-xl font-bold transition-all duration-200 flex items-center gap-2 ${
                    isGeneratingOutline 
                      ? "bg-slate-100 text-slate-400 border border-transparent cursor-not-allowed" 
                      : "bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:from-blue-700 hover:via-indigo-700 hover:to-purple-700 text-white shadow-md shadow-indigo-500/20 hover:shadow-lg hover:shadow-indigo-500/30"
                  }`}
                >
                  {isGeneratingOutline ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      <span>Đang sinh mục lục...</span>
                    </>
                  ) : (
                    <>
                      <BookOpen size={16} />
                      <span>Sinh mục lục</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          ) : (
            <div className="w-full max-w-5xl bg-white border border-slate-200/85 rounded-2xl p-8 shadow-xl border-slate-100 animate-in fade-in duration-200">
              <div className="flex items-start justify-between border-b border-slate-100 pb-5 mb-6">
                <div>
                  <h2 className="text-xl font-extrabold text-slate-800 dark:text-slate-100 font-display flex items-center gap-3">
                    <div className="bg-blue-600 p-2 rounded-xl shadow-sm shadow-blue-200 shrink-0">
                      <BookOpen size={20} className="text-white" />
                    </div>
                    <span>Phê duyệt Cấu trúc Mục lục</span>
                  </h2>
                  <p className="text-slate-500 text-xs mt-1.5 leading-relaxed">
                    Kiểm tra khung cấu trúc chương/bài dưới đây. Kéo thả để sắp xếp lại, hoặc chọn một đề mục để làm mục cha để chèn các tiểu mục con mới ngay dưới mục đó.
                  </p>
                </div>
                <button
                  onClick={() => {
                    setIsOutlineApproved(true);
                    localStorage.setItem(`rag.outline.approved.${projectId}`, "true");
                    toastService.success("Đã phê duyệt mục lục! Bắt đầu soạn thảo chi tiết.");
                  }}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-5 py-3 rounded-xl transition duration-200 text-sm shadow-md shadow-emerald-500/10 hover:shadow-emerald-500/20 shrink-0"
                >
                  Xác nhận & Đồng ý mục lục
                </button>
              </div>

              <div className="space-y-2.5 mb-6 max-h-[500px] overflow-y-auto custom-scrollbar p-4 bg-slate-50 rounded-xl border border-slate-150">
                {orderedSections.map((s) => {
                  const isSelected = activeSectionId === s.id;
                  const isDragging = draggingSectionId === s.id;
                  const isDropTarget = dragOverSectionId === s.id && draggingSectionId !== s.id;

                  return (
                    <div
                      key={s.id}
                      draggable
                      onClick={() => setActiveSectionId(s.id)}
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", s.id);
                        setDraggingSectionId(s.id);
                        setDragOverSectionId(s.id);
                      }}
                      onDragOver={(event) => {
                        if (!draggingSectionId || draggingSectionId === s.id) {
                          return;
                        }
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                        
                        const rect = event.currentTarget.getBoundingClientRect();
                        const relativeY = event.clientY - rect.top;
                        const height = rect.height;
                        
                        let mode: "reorder-before" | "reorder-after" | "nest" = "nest";
                        if (relativeY < height * 0.25) {
                          mode = "reorder-before";
                        } else if (relativeY > height * 0.75) {
                          mode = "reorder-after";
                        }
                        
                        if (dragOverSectionId !== s.id || dropMode !== mode) {
                          setDragOverSectionId(s.id);
                          setDropMode(mode);
                        }
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        const sourceId =
                          event.dataTransfer.getData("text/plain") ||
                          draggingSectionId ||
                          "";
                        if (sourceId && sourceId !== s.id) {
                          if (dropMode === "nest") {
                            void handleNestSection(sourceId, s.id);
                          } else {
                            void handleReorderSections(sourceId, s.id, dropMode);
                          }
                        }
                        setDraggingSectionId(null);
                        setDragOverSectionId(null);
                        setDropMode(null);
                      }}
                      onDragEnd={() => {
                        setDraggingSectionId(null);
                        setDragOverSectionId(null);
                        setDropMode(null);
                      }}
                      className={`group flex items-center justify-between py-2.5 px-4 rounded-xl border cursor-pointer transition-all duration-200 ${
                        isSelected
                          ? "bg-blue-50/80 border-blue-200 text-blue-800 dark:bg-blue-950/40 dark:border-blue-900/50 dark:text-blue-300 shadow-sm font-semibold"
                          : "bg-white border-slate-100 dark:bg-slate-900/50 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 hover:border-slate-200 dark:hover:bg-slate-900"
                      } ${
                        isDropTarget && dropMode === "nest"
                          ? "ring-2 ring-blue-400 bg-blue-50/80 dark:bg-blue-950/50"
                          : isDropTarget && dropMode === "reorder-before"
                          ? "border-t-2 border-t-blue-500 bg-blue-50/10 dark:bg-blue-950/10"
                          : isDropTarget && dropMode === "reorder-after"
                          ? "border-b-2 border-b-blue-500 bg-blue-50/10 dark:bg-blue-950/10"
                          : ""
                      } ${isDragging ? "opacity-60" : ""}`}
                      style={{ marginLeft: `${Math.max(0, s.level - 1) * 24}px` }}
                    >
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <GripVertical
                          size={14}
                          className="text-slate-300 dark:text-slate-600 opacity-0 group-hover:opacity-100 cursor-grab shrink-0 transition-opacity duration-150"
                        />
                        {s.level === 1 ? (
                          <BookOpen size={14} className="text-blue-600 dark:text-blue-400 shrink-0" />
                        ) : (
                          <span className="text-slate-300 dark:text-slate-700 font-mono text-sm shrink-0 select-none">
                            {s.level === 2 ? "├─" : "└─"}
                          </span>
                        )}
                        <span className="text-slate-600 dark:text-slate-400 font-mono text-xs select-none font-bold shrink-0">
                          {sectionPrefixes[s.id] || ""}
                        </span>
                        <input
                          type="text"
                          value={getCleanTitle(s.title)}
                          onChange={(e) => {
                            const clean = e.target.value;
                            const prefix = sectionPrefixes[s.id] || "";
                            let formattedPrefix = prefix;
                            if (prefix && !prefix.startsWith("Chương") && !prefix.startsWith("Chuong")) {
                              formattedPrefix = prefix.endsWith(".") ? prefix : `${prefix}.`;
                            }
                            const fullTitle = formattedPrefix ? `${formattedPrefix} ${clean}` : clean;
                            updateSection(s.id, { title: fullTitle });
                          }}
                          onClick={(e) => e.stopPropagation()}
                          className={`bg-transparent border-none outline-none focus:ring-1 focus:ring-blue-400 dark:focus:ring-blue-500 focus:bg-white dark:focus:bg-slate-800 px-1.5 py-0.5 rounded text-sm w-full min-w-0 transition-all duration-150 ${
                            s.level === 1
                              ? "font-bold text-slate-900 dark:text-slate-100"
                              : s.level === 2
                              ? "font-semibold text-slate-800 dark:text-slate-200"
                              : "font-medium text-slate-700 dark:text-slate-300"
                          }`}
                          title="Click để sửa nhanh tiêu đề"
                        />
                      </div>
                      
                      <div className="flex items-center gap-2 shrink-0">
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleInsertSectionAfter(s.order);
                            }}
                            className="text-slate-400 dark:text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-all duration-150"
                            title="Chèn mục phía dưới"
                          >
                            <Plus size={14} />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleDeleteSection(s.id);
                            }}
                            className="text-slate-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400 p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-all duration-150"
                            title="Xóa mục"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                        <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border transition-all duration-200 select-none ${
                          s.level === 1
                            ? "bg-blue-50 text-blue-600 border-blue-200/60 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-800/40"
                            : s.level === 2
                            ? "bg-emerald-50 text-emerald-600 border-emerald-200/60 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800/40"
                            : "bg-purple-50 text-purple-600 border-purple-200/60 dark:bg-purple-950/30 dark:text-purple-400 dark:border-purple-800/40"
                        }`}>
                          Cấp {s.level}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Prompt input for updating structure */}
              <div className="border-t border-slate-100 pt-5">
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider">
                    Yêu cầu điều chỉnh mục lục (Prompt điều chỉnh)
                  </label>
                  {activeSection && (
                    <span className="text-xs text-blue-600 font-semibold bg-blue-50 px-2.5 py-0.5 rounded-full border border-blue-100">
                      Đang chọn mục: {getCleanTitle(activeSection.title)}
                    </span>
                  )}
                </div>
                <div className="flex gap-3">
                  <input
                    type="text"
                    value={structurePromptText}
                    onChange={(e) => setStructurePromptText(e.target.value)}
                    placeholder="VD: tạo thêm các mục con 1.1.1, 1.1.2 nói về khái niệm OOP..."
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleUpdateStructure();
                    }}
                    className="flex-1 border border-slate-200 rounded-xl px-4 py-3 outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all text-sm text-slate-700 placeholder-slate-400 bg-slate-50/50 focus:bg-white"
                  />
                  <button
                    onClick={handleUpdateStructure}
                    disabled={isUpdatingStructure || !structurePromptText.trim()}
                    className={`font-bold px-6 py-3 rounded-xl transition duration-200 text-sm flex items-center gap-2 shadow-md shrink-0 ${
                      isUpdatingStructure || !structurePromptText.trim()
                        ? "bg-slate-100 text-slate-400 border border-transparent cursor-not-allowed"
                        : "bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:from-blue-700 hover:via-indigo-700 hover:to-purple-700 text-white shadow-indigo-500/20 hover:shadow-lg hover:shadow-indigo-500/30"
                    }`}
                  >
                    {isUpdatingStructure ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        <span>Đang cập nhật...</span>
                      </>
                    ) : (
                      <>
                        <BookOpen size={16} />
                        <span>Cập nhật cấu trúc</span>
                      </>
                    )}
                  </button>
                </div>
                <p className="text-[11px] text-slate-400 mt-2">
                  * AI sẽ sử dụng đề mục đang được lựa chọn ở trên để làm mục cha để chèn các tiểu mục con mới ngay dưới mục đó.
                </p>
              </div>
            </div>
          )}
        </div>
      ) : (
        // Three Column Layout for Step 2
        <div className="flex-1 flex overflow-hidden">
          {/* Left Column: Sections Sidebar */}
          <aside className="w-80 bg-white border-r border-slate-200/60 flex flex-col shrink-0 z-10 hidden md:flex shadow-sm shadow-slate-100/50">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-800 text-xs uppercase tracking-wider font-display">
                  Cấu trúc bài giảng
                </h3>
                <p className="text-[10px] text-slate-400 font-medium mt-0.5">
                  {generatedSectionsCount}/{sections.length} mục đã sinh nội dung
                </p>
              </div>
              <button
                onClick={handleCreateSection}
                className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition duration-200"
                title="Thêm mục mới"
              >
                <Plus size={16} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-1.5 custom-scrollbar">
              {/* ── Batch Group Buttons ── */}
              {BATCH_GROUPS.map((group) => {
                const matchedIds = matchesBatchGroup(orderedSections, group);
                if (!matchedIds) return null;
                const isRunning = batchGeneratingGroupId === group.id;
                const matchedTitles = matchedIds
                  .map((sid) => orderedSections.find((s) => s.id === sid)?.title)
                  .filter(Boolean) as string[];
                return (
                  <div
                    key={group.id}
                    className={`mb-3 p-3 rounded-xl border transition-all duration-200 ${
                      isRunning
                        ? "border-amber-200 bg-amber-50/50 shadow-sm"
                        : "border-slate-100 bg-slate-50/50 hover:bg-slate-50 shadow-sm"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wide">
                        {group.id === "INTRO_GROUP" ? "🏗️ Mở đầu" : "🏁 Kết thúc"}
                      </span>
                      <button
                        onClick={() => handleBatchGenerate(group.id, matchedIds)}
                        disabled={Boolean(batchGeneratingGroupId)}
                        className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded-md font-semibold transition-all duration-200 ${
                          Boolean(batchGeneratingGroupId)
                            ? "bg-slate-100 text-slate-400 cursor-not-allowed border border-transparent"
                            : "bg-white text-blue-600 border border-blue-200 hover:bg-blue-50 hover:border-blue-300"
                        }`}
                        title={group.label}
                      >
                        {isRunning ? (
                          <Loader2 size={10} className="animate-spin" />
                        ) : (
                          <Zap size={10} />
                        )}
                        <span>{isRunning ? "Đang tạo..." : "Tạo nhanh"}</span>
                      </button>
                    </div>
                    <div className="space-y-1">
                      {matchedTitles.map((title) => (
                        <p key={title} className="text-[11px] text-slate-500 font-medium truncate pl-1 flex items-center gap-1.5">
                          <span className="h-1.5 w-1.5 rounded-full bg-slate-300"></span>
                          {title}
                        </p>
                      ))}
                    </div>
                  </div>
                );
              })}

              {/* ── Individual Section List ── */}
              {orderedSections.map((s) => {
                const isActive = activeSectionId === s.id;
                const isDragging = draggingSectionId === s.id;
                const isDropTarget =
                  dragOverSectionId === s.id && draggingSectionId !== s.id;

                return (
                  <div
                    key={s.id}
                    data-section-id={s.id}
                    draggable
                    onClick={() => setActiveSectionId(s.id)}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", s.id);
                      setDraggingSectionId(s.id);
                      setDragOverSectionId(s.id);
                    }}
                    onDragOver={(event) => {
                      if (!draggingSectionId || draggingSectionId === s.id) {
                        return;
                      }
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                      
                      const rect = event.currentTarget.getBoundingClientRect();
                      const relativeY = event.clientY - rect.top;
                      const height = rect.height;
                      
                      let mode: "reorder-before" | "reorder-after" | "nest" = "nest";
                      if (relativeY < height * 0.25) {
                        mode = "reorder-before";
                      } else if (relativeY > height * 0.75) {
                        mode = "reorder-after";
                      }
                      
                      if (dragOverSectionId !== s.id || dropMode !== mode) {
                        setDragOverSectionId(s.id);
                        setDropMode(mode);
                      }
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      const sourceId =
                        event.dataTransfer.getData("text/plain") ||
                        draggingSectionId ||
                        "";
                      if (sourceId && sourceId !== s.id) {
                        if (dropMode === "nest") {
                          void handleNestSection(sourceId, s.id);
                        } else {
                          void handleReorderSections(sourceId, s.id, dropMode);
                        }
                      }
                      setDraggingSectionId(null);
                      setDragOverSectionId(null);
                      setDropMode(null);
                    }}
                    onDragEnd={() => {
                      setDraggingSectionId(null);
                      setDragOverSectionId(null);
                      setDropMode(null);
                    }}
                    className={`group flex items-center gap-2 mx-1 px-3 py-2 rounded-lg cursor-pointer transition-all duration-200 ${
                      isActive
                        ? "bg-blue-50 text-blue-700 font-semibold border border-blue-100/50 shadow-sm"
                        : "text-slate-600 hover:bg-slate-50 hover:text-slate-900 border border-transparent"
                    } ${
                      isDropTarget && dropMode === "nest"
                        ? "ring-2 ring-blue-400 bg-blue-50/50"
                        : isDropTarget && dropMode === "reorder-before"
                        ? "border-t-2 border-t-blue-500 bg-blue-50/10"
                        : isDropTarget && dropMode === "reorder-after"
                        ? "border-b-2 border-b-blue-500 bg-blue-50/10"
                        : ""
                    } ${isDragging ? "opacity-60" : ""}`}
                  >
                    <GripVertical
                      size={13}
                      className="text-slate-300 opacity-0 group-hover:opacity-100 cursor-grab shrink-0 transition-opacity duration-150"
                    />
                    <div 
                      className="flex items-center gap-1.5 min-w-0 flex-1"
                      style={{
                        paddingLeft: `${Math.max(0, s.level - 1) * 16}px`,
                      }}
                    >
                      {s.level === 1 ? (
                        <BookOpen size={13} className="text-blue-500 shrink-0" />
                      ) : (
                        <span className="text-slate-300 font-mono text-xs shrink-0 select-none">
                          {s.level === 2 ? "├─" : "└─"}
                        </span>
                      )}
                      <span
                        className={`truncate text-xs flex items-center gap-1 min-w-0 ${
                          s.level === 1 ? "font-bold text-slate-900" : s.level === 2 ? "font-semibold text-slate-800" : "font-medium text-slate-700 text-[11.5px]"
                        }`}
                        title={s.title}
                      >
                        <span className="text-slate-600 dark:text-slate-400 font-mono text-[10px] shrink-0 select-none font-bold">
                          {sectionPrefixes[s.id] || ""}
                        </span>
                        <span className="truncate">{getCleanTitle(s.title)}</span>
                      </span>
                    </div>
                    {s.isGenerating ? (
                      <Loader2 size={13} className="animate-spin text-blue-500" />
                    ) : hasGeneratedContent(s) ? (
                      <span className="shrink-0" title="Đã sinh nội dung">
                        <CheckCircle2 size={13} className="text-emerald-500" />
                      </span>
                    ) : (
                      <span
                        className="h-1.5 w-1.5 rounded-full bg-slate-300 shrink-0"
                        title="Chưa sinh nội dung"
                      />
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleInsertSectionAfter(s.order);
                      }}
                      className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-blue-600 p-0.5 hover:bg-white rounded transition-all duration-150"
                      title="Chèn mục phía dưới"
                    >
                      <Plus size={12} />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleDeleteSection(s.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-600 p-0.5 hover:bg-white rounded transition-all duration-150"
                      title="Xóa mục"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                );
              })}
            </div>
          </aside>

          {/* Middle Column: Main Editor */}
          <main className="flex-1 flex flex-col bg-white overflow-hidden relative">
            {loading && (
              <div className="absolute inset-0 bg-white/80 flex items-center justify-center z-20">
                <div className="w-full max-w-md space-y-4 animate-pulse p-6">
                  <div className="h-6 bg-slate-200 rounded w-1/3 mb-4"></div>
                  <div className="space-y-3">
                    <div className="h-4 bg-slate-100 rounded w-full"></div>
                    <div className="h-4 bg-slate-100 rounded w-5/6"></div>
                    <div className="h-4 bg-slate-100 rounded w-4/5"></div>
                  </div>
                </div>
              </div>
            )}
            {error && (
              <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 text-sm bg-red-50 text-red-700 border border-red-200 rounded px-3 py-1">
                {error}
              </div>
            )}
            {activeSection ? (
              <>
                {/* Section Header & Settings */}
                <div className="p-6 border-b border-slate-200/60 shrink-0 bg-slate-50/30">

                  <div className="flex items-center gap-2 mb-4">
                    <span className="text-sm font-bold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-2.5 py-1 rounded-lg select-none whitespace-nowrap shrink-0">
                      {sectionPrefixes[activeSection.id] || ""}
                    </span>
                    <input
                      value={getCleanTitle(activeSection.title)}
                      onChange={(e) => {
                        const clean = e.target.value;
                        const prefix = sectionPrefixes[activeSection.id] || "";
                        let formattedPrefix = prefix;
                        if (prefix && !prefix.startsWith("Chương") && !prefix.startsWith("Chuong")) {
                          formattedPrefix = prefix.endsWith(".") ? prefix : `${prefix}.`;
                        }
                        const fullTitle = formattedPrefix ? `${formattedPrefix} ${clean}` : clean;
                        updateSection(activeSection.id, { title: fullTitle });
                      }}
                      className="text-xl font-bold bg-transparent border-none outline-none w-full text-slate-800 dark:text-slate-100 placeholder-slate-300 font-display focus:ring-0"
                      placeholder="Tên mục (VD: Thực hành)..."
                    />
                  </div>

                  <div className="bg-slate-50/60 hover:bg-slate-50 border border-slate-200/80 rounded-xl p-4 relative group focus-within:border-blue-500 focus-within:bg-white focus-within:ring-4 focus-within:ring-blue-500/10 transition-all duration-200 shadow-sm w-full">
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-start gap-4 w-full">
                      <div className="flex-1 min-w-0 w-full">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2 w-full">
                          <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                            Yêu cầu cho AI (Prompt)
                          </label>
                          <div className="flex items-center gap-3">
                            {/* Tooltip Hướng dẫn viết prompt */}
                            <div className="relative group/tooltip inline-block select-none">
                              <div className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-blue-500 cursor-help transition-colors duration-150 py-0.5">
                                <HelpCircle size={13} className="shrink-0" />
                                <span className="font-medium">Hướng dẫn</span>
                              </div>
                              <div className="absolute top-full right-0 mt-2 w-80 p-4 bg-white/95 backdrop-blur-md border border-slate-200 rounded-xl shadow-xl opacity-0 invisible group-hover/tooltip:opacity-100 group-hover/tooltip:visible transition-all duration-200 z-50 text-xs text-slate-600 pointer-events-none group-hover/tooltip:pointer-events-auto leading-relaxed">
                                <p className="font-bold text-slate-800 mb-2.5 flex items-center gap-1.5 text-sm">
                                  ✨ Hướng dẫn viết Prompt hiệu quả
                                </p>
                                <ul className="space-y-2.5 list-none pl-0 text-left">
                                  <li className="flex items-start gap-1.5">
                                    <span className="shrink-0 mt-0.5">🎯</span>
                                    <span><strong className="text-slate-800 font-bold">Rõ ràng & Cụ thể:</strong> Nêu rõ chủ thể (ví dụ: viết <em>"ví dụ thực tế về Agile"</em> thay vị trí <em>"ví dụ"</em>), đặc biệt ở các tiểu mục con để AI hiểu đúng ngữ cảnh.</span>
                                  </li>
                                  <li className="flex items-start gap-1.5">
                                    <span className="shrink-0 mt-0.5">⚙️</span>
                                    <span><strong className="text-slate-800 font-bold">Cấu trúc vs Nội dung:</strong> Nhập prompt dạng <em>"thêm mục 1.1.1..."</em> sẽ kích hoạt tạo thêm nhánh mục mới bên trái. Còn gõ prompt mô tả kiến thức sẽ sinh bài giảng chi tiết cho mục hiện tại.</span>
                                  </li>
                                  <li className="flex items-start gap-1.5">
                                    <span className="shrink-0 mt-0.5">⚠️</span>
                                    <span><strong className="text-slate-800 font-bold">Ngoài tài liệu gốc:</strong> Tránh yêu cầu kiến thức không có trong các tài liệu nguồn đã tải lên. Hệ thống bắt buộc AI chỉ được trích dẫn thông tin trong sách/tài liệu được chọn.</span>
                                  </li>
                                  <li className="flex items-start gap-1.5">
                                    <span className="shrink-0 mt-0.5">🌐</span>
                                    <span><strong className="text-slate-800 font-bold">Thuật ngữ kỹ thuật:</strong> Nếu viết thuật ngữ tiếng Việt khó dịch, hãy đính kèm thuật ngữ tiếng Anh gốc trong prompt để AI tra cứu sách chuẩn xác.</span>
                                  </li>
                                </ul>
                              </div>
                            </div>

                            {/* Nút Gợi ý Prompt */}
                            <button
                              type="button"
                              onClick={handleToggleSuggestions}
                              className={`text-xs font-semibold flex items-center gap-1.5 py-1 px-2.5 rounded-lg border transition-all duration-150 ${
                                showPromptSuggestions
                                  ? "text-cyan-800 bg-cyan-100 border-cyan-200 shadow-sm"
                                  : "text-cyan-600 border-transparent hover:text-cyan-700 hover:bg-slate-100"
                              }`}
                              title="Tự động tạo prompt mẫu chi tiết bám sát tài liệu nguồn"
                            >
                              <Sparkles size={12} className={suggestingPromptId === activeSection.id ? "animate-spin text-cyan-500" : "text-cyan-500"} />
                              <span>💡 Gợi ý Prompt</span>
                            </button>
                          </div>
                        </div>
                         <textarea
                          spellCheck={false}
                          ref={promptInputRef}
                          value={activeSection.prompt}
                          onChange={(e) => {
                            updateSection(activeSection.id, {
                              prompt: e.target.value,
                            });
                            e.target.style.height = "auto";
                            e.target.style.height = `${Math.min(160, e.target.scrollHeight)}px`;
                          }}
                          rows={1}
                          className="w-full bg-transparent border-none outline-none resize-none text-slate-700 min-h-[28px] max-h-[160px] overflow-y-auto text-sm leading-relaxed py-1 placeholder:text-slate-400/80 custom-scrollbar"
                          placeholder="Hãy mô tả chi tiết yêu cầu của bạn, càng mô tả chi tiết, tài liệu tạo ra càng chính xác."
                        />
                        {/* ⚠️ Order warning */}
                        {sectionOrderWarning && (
                          <div className="mt-2.5 flex items-start gap-2 px-3 py-2 bg-amber-50 border border-amber-200/80 rounded-lg text-xs text-amber-700">
                            <span className="shrink-0 mt-0.5">⚠️</span>
                            <span>{sectionOrderWarning.replace(/^⚠️\s*/, "")}</span>
                          </div>
                        )}
                      </div>
                      <div className="shrink-0 flex flex-col justify-start">
                        <button
                          disabled={activeSection.isGenerating}
                          onClick={() => handleGenerate(activeSection.id)}
                          className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-bold transition-all duration-200 text-sm shadow-sm ${
                            activeSection.isGenerating 
                              ? "bg-slate-100 text-slate-400 cursor-not-allowed border border-transparent" 
                              : "bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:from-blue-700 hover:via-indigo-700 hover:to-purple-700 text-white shadow-md shadow-indigo-500/20 hover:shadow-lg hover:shadow-indigo-500/30"
                          }`}
                        >
                          {activeSection.isGenerating ? (
                            <>
                              <Loader2 size={16} className="animate-spin text-slate-400" />
                              <span>Đang xử lý...</span>
                            </>
                          ) : (
                            <>
                              <BookOpen size={14} className="text-white shrink-0" />
                              <span>{activeSection.content ? "Tạo lại" : "Tạo nội dung"}</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>

                    {/* 💡 Suggested prompt display card (Full width below the horizontal layout) */}
                    {showPromptSuggestions && (
                      <div className="mt-3.5 p-3.5 bg-cyan-50/50 border border-cyan-100 rounded-xl text-xs text-cyan-800 flex flex-col gap-3 animate-in fade-in duration-200">
                        <div className="flex items-center justify-between border-b border-cyan-100/50 pb-2">
                          <span className="font-bold flex items-center gap-1">
                            <Sparkles size={12} className="text-cyan-600" />
                            Gợi ý câu lệnh dựa trên tài liệu:
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setShowPromptSuggestions(false);
                              if (activeSectionId) {
                                localStorage.setItem(`rag.suggestions.open.${activeSectionId}`, "false");
                              }
                            }}
                            className="text-[10px] text-slate-400 hover:text-slate-600 font-semibold"
                          >
                            Đóng
                          </button>
                        </div>

                        {/* Prompt Type Tabs */}
                        <div className="flex flex-wrap gap-1">
                          {dynamicSuggestPromptTypes.map((t) => {
                            const isActive = activeSuggestTab === t.id;
                            return (
                              <button
                                key={t.id}
                                type="button"
                                onClick={() => handleSelectSuggestTab(t.id)}
                                className={`px-2.5 py-1 rounded-md font-semibold text-[10px] transition-all duration-150 ${
                                  isActive
                                    ? "bg-cyan-600 text-white shadow-sm"
                                    : "bg-white/95 text-cyan-800 hover:bg-cyan-100 border border-cyan-200/50"
                                }`}
                              >
                                {t.label}
                              </button>
                            );
                          })}
                        </div>

                        {/* Active Tab Prompt Content */}
                        <div className="bg-white/80 rounded-lg p-2.5 min-h-[60px] flex flex-col justify-between gap-2.5 border border-cyan-100/40">
                          {suggestingPromptId === activeSection.id ? (
                            <div className="flex items-center justify-center gap-1.5 py-3 text-cyan-600 font-medium">
                              <Loader2 size={14} className="animate-spin" />
                              <span>Đang sinh các gợi ý prompt từ tài liệu...</span>
                            </div>
                          ) : suggestedPrompts[activeSuggestTab] ? (
                            <>
                              <p className="italic leading-relaxed text-slate-700 font-medium text-[11px] text-left">
                                "{suggestedPrompts[activeSuggestTab]}"
                              </p>
                              <div className="flex justify-between items-center pt-1.5 border-t border-cyan-100/30">
                                <button
                                  type="button"
                                  disabled={suggestingPromptId === activeSection.id}
                                  onClick={() => handleSuggestPrompt(activeSection.id, activeSuggestTab)}
                                  className="text-[10px] text-cyan-600 hover:text-cyan-800 font-bold flex items-center gap-1 disabled:opacity-50"
                                >
                                  <RefreshCw size={10} className={suggestingPromptId === activeSection.id ? "animate-spin" : ""} />
                                  <span>Tạo lại gợi ý</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    updateSection(activeSection.id, { prompt: suggestedPrompts[activeSuggestTab] });
                                    // Trigger textarea resize
                                    window.setTimeout(() => {
                                      if (promptInputRef.current) {
                                        promptInputRef.current.style.height = "auto";
                                        promptInputRef.current.style.height = `${Math.min(160, promptInputRef.current.scrollHeight)}px`;
                                      }
                                    }, 50);
                                  }}
                                  className="text-[10px] bg-cyan-600 text-white px-2.5 py-1 rounded-md hover:bg-cyan-700 font-bold shadow-sm shadow-cyan-600/10"
                                >
                                  Áp dụng Prompt này
                                </button>
                              </div>
                            </>
                          ) : (
                            <div className="flex flex-col items-center justify-center py-3 gap-1.5">
                              <p className="text-slate-400 font-medium">Chưa có gợi ý cho mục này.</p>
                              <button
                                type="button"
                                onClick={() => handleSuggestPrompt(activeSection.id, activeSuggestTab)}
                                className="text-[10px] bg-cyan-600 text-white px-2.5 py-0.5 rounded-md hover:bg-cyan-700 font-bold"
                              >
                                Tải gợi ý
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Markdown Editor */}
                <div className="flex-1 flex flex-col md:flex-row overflow-hidden w-full min-w-0">
                  {/* Textarea */}
                  {editMode && (
                    <div className="w-full md:w-[42%] flex flex-col h-full bg-slate-50/50 dark:bg-slate-900/30 relative shrink min-w-0 border-r border-slate-200/60 dark:border-slate-800">
                      <div className="h-10 bg-slate-50 dark:bg-slate-900/50 flex items-center px-6 border-b border-slate-100 dark:border-slate-800 text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider shrink-0">
                        Markdown
                      </div>
                      <textarea
                        value={activeSection.content}
                        onChange={(e) =>
                          updateSection(activeSection.id, {
                            content: e.target.value,
                          })
                        }
                        className="flex-1 w-full bg-transparent p-6 outline-none resize-none text-slate-700 dark:text-slate-200 font-mono text-xs leading-relaxed focus:bg-slate-50/20 dark:focus:bg-slate-900/20 transition-all duration-200"
                        placeholder="Chạy AI tạo hoặc nhập nội dung Markdown thủ công..."
                      />
                    </div>
                  )}

                  {/* Live Preview */}
                  <div className={`flex-1 flex flex-col h-full bg-white dark:bg-slate-950 relative min-w-0 ${editMode ? "border-l border-slate-100 dark:border-slate-800" : ""}`}>
                    <div className="h-10 bg-white dark:bg-slate-950 flex items-center justify-between px-6 border-b border-slate-100 dark:border-slate-800 text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider shrink-0">
                      <span>Preview</span>
                      <button
                        onClick={() =>
                          setShowCitationsInPreview(!showCitationsInPreview)
                        }
                        className={`flex items-center gap-1.5 transition-colors duration-200 ${
                          showCitationsInPreview
                            ? "text-blue-600 dark:text-blue-400 hover:text-blue-700"
                            : "text-slate-400 hover:text-slate-600"
                        }`}
                        title={
                          showCitationsInPreview
                            ? "Ẩn trích dẫn nguồn"
                            : "Hiện trích dẫn nguồn"
                        }
                      >
                        {showCitationsInPreview ? (
                          <Eye size={13} />
                        ) : (
                          <EyeOff size={13} />
                        )}
                        <span>{showCitationsInPreview ? "Hiện nguồn" : "Ẩn nguồn"}</span>
                      </button>
                    </div>
                    <div 
                      onMouseUp={handlePreviewMouseUp}
                      className="flex-1 p-6 overflow-y-auto prose dark:prose-invert markdown-preview max-w-none text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-950 custom-scrollbar relative"
                    >
                      {/* Selection Popup */}
                      {selectedText && selectionRange && (
                        <div 
                          className="absolute bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl rounded-xl p-3.5 z-50 ai-selection-popup flex flex-col gap-2.5 w-72 animate-in fade-in zoom-in-95 duration-150 text-left normal-case font-normal"
                          style={{
                            left: `${Math.max(10, Math.min(selectionRange.x - 144, 400))}px`,
                            top: `${Math.max(10, selectionRange.y - 140)}px`,
                          }}
                          onMouseUp={(e) => e.stopPropagation()}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {selectionDiff ? (
                            <>
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider flex items-center gap-1">
                                  <Sparkles size={10} className="text-amber-500 animate-pulse" />
                                  AI đề xuất thay đổi
                                </span>
                              </div>
                              <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                                Hãy xem trước phần bị gạch đỏ (xóa) và tô xanh (thêm mới) trong Bản xem trước.
                              </p>
                              <div className="flex items-center gap-2 mt-1">
                                <button
                                  onClick={handleAcceptSelectionDiff}
                                  className="flex-1 text-[11px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white py-1.5 px-3 rounded-lg flex items-center justify-center gap-1 shadow-sm transition duration-150 active:scale-95"
                                >
                                  <CheckCircle2 size={12} />
                                  <span>Chấp nhận</span>
                                </button>
                                <button
                                  onClick={handleRejectSelectionDiff}
                                  className="flex-1 text-[11px] font-bold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 py-1.5 px-3 rounded-lg flex items-center justify-center gap-1 transition duration-150 active:scale-95"
                                >
                                  <span>Hủy bỏ</span>
                                </button>
                              </div>
                            </>
                          ) : (
                            <>
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider">
                                  AI Sửa đoạn bôi đen
                                </span>
                                <button 
                                  onClick={() => {
                                    setSelectedText("");
                                    setSelectionRange(null);
                                    setSelectionDiff(null);
                                  }}
                                  className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xs font-semibold"
                                >
                                  Đóng
                                </button>
                              </div>
                              <p className="text-[11px] text-slate-500 dark:text-slate-400 italic truncate max-w-full">
                                "{selectedText}"
                              </p>
                              <div className="flex items-center gap-1.5 mt-1">
                                <input 
                                  type="text"
                                  placeholder="Yêu cầu sửa (VD: viết lại ngắn gọn)..."
                                  value={selectionPrompt}
                                  onChange={(e) => setSelectionPrompt(e.target.value)}
                                  className="flex-1 text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-200 outline-none focus:border-blue-500 focus:bg-white transition-all duration-150"
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" && selectionPrompt.trim() && !isEditingSelection) {
                                      void handleApplySelectionEdit();
                                    }
                                  }}
                                />
                                <button
                                  disabled={isEditingSelection || !selectionPrompt.trim()}
                                  onClick={() => void handleApplySelectionEdit()}
                                  className={`p-1.5 rounded-lg text-white transition-all duration-150 ${
                                    isEditingSelection || !selectionPrompt.trim()
                                      ? "bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed"
                                      : "bg-blue-600 hover:bg-blue-700 active:scale-95"
                                  }`}
                                >
                                  {isEditingSelection ? (
                                    <Loader2 size={12} className="animate-spin" />
                                  ) : (
                                    <Zap size={12} />
                                  )}
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      )}
                      {activeSection.content ? (
                        <EnhancedMarkdownRenderer
                          content={previewContent}
                          components={{
                            del: ({ children }) => (
                              <del className="bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400 line-through px-1 rounded mx-0.5 border border-red-200/20 font-medium">
                                {children}
                              </del>
                            ),
                            a: ({ href, children }) => {
                              if (href === "#diff-add") {
                                return (
                                  <ins className="bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400 no-underline px-1.5 py-0.5 rounded mx-0.5 border border-emerald-200/30 font-semibold inline-block">
                                    {children}
                                  </ins>
                                );
                              }
                              const sourceId = parseCitationSourceId(href);
                              if (sourceId) {
                                return (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleCitationSourceClick(sourceId)
                                    }
                                    className="text-blue-600 underline underline-offset-2 hover:text-blue-700"
                                  >
                                    {children}
                                  </button>
                                );
                              }
                              return (
                                <a href={href} target="_blank" rel="noreferrer">
                                  {children}
                                </a>
                              );
                            },
                            p: ({ children }) => (
                              <p className="whitespace-pre-wrap break-words">
                                {processMarkdownChildren(children)}
                              </p>
                            ),
                            li: ({ children }) => (
                              <li className="whitespace-pre-wrap break-words">
                                {processMarkdownChildren(children)}
                              </li>
                            ),
                          }}
                        />
                      ) : (
                        <div className="h-full flex flex-col items-center justify-center text-slate-400 p-8 text-center bg-slate-50/20">
                          <FileText size={40} className="text-slate-300 mb-2.5" />
                          <p className="text-xs font-semibold text-slate-400">
                            Bản xem trước trống.
                          </p>
                          <p className="text-[11px] text-slate-400 mt-1 max-w-xs">
                            Sử dụng AI tạo nội dung hoặc tự nhập Markdown để xem trước tại đây.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-400 p-8 text-center bg-slate-50/20 animate-in fade-in duration-200">
                <FileText size={48} className="text-slate-300 mb-3 animate-pulse" />
                <p className="text-sm font-semibold text-slate-500 font-display">Chưa có mục nào được chọn</p>
                <p className="text-xs text-slate-400 mt-1 max-w-sm leading-relaxed">Chọn một mục ở danh sách bên trái hoặc tạo mới mục mới để bắt đầu chỉnh sửa</p>
              </div>
            )}
          </main>

          {/* Right Column: Context/RAG Panel */}
          {showContext && (
            <aside className="w-80 bg-slate-50 border-l border-slate-200/60 flex flex-col shrink-0 z-10 transition-all duration-300">

              <div className="flex-1 overflow-y-auto p-0 custom-scrollbar">
                <div className="bg-white flex flex-col min-h-full">
                  <div className="p-2 border-b border-slate-100 bg-slate-50/50">
                    <div className="flex bg-slate-100 p-1 rounded-xl text-xs font-semibold relative">
                      <button
                        onClick={() => setActiveContextTab("source")}
                        className={`flex-1 py-2 text-center rounded-lg transition-all duration-200 ${
                          activeContextTab === "source"
                            ? "bg-white text-blue-600 shadow-sm font-bold"
                            : "text-slate-500 hover:text-slate-800"
                        }`}
                      >
                        Nguồn trích dẫn
                      </button>
                      <button
                        onClick={() => setActiveContextTab("evaluation")}
                        className={`flex-1 py-2 text-center rounded-lg transition-all duration-200 ${
                          activeContextTab === "evaluation"
                            ? "bg-white text-blue-600 shadow-sm font-bold"
                            : "text-slate-500 hover:text-slate-800"
                        }`}
                      >
                        Đánh giá
                      </button>
                      <button
                        onClick={() => setActiveContextTab("history")}
                        className={`flex-1 py-2 text-center rounded-lg transition-all duration-200 ${
                          activeContextTab === "history"
                            ? "bg-white text-blue-600 shadow-sm font-bold"
                            : "text-slate-500 hover:text-slate-800"
                        }`}
                      >
                        Lịch sử
                      </button>
                    </div>
                  </div>

                  <div className="p-4 flex-1 space-y-4">
                    {activeContextTab === "source" && (
                      activeChunks.length === 0 ? (
                        <div className="flex flex-col items-center justify-center text-center p-6 bg-slate-50/40 border border-dashed border-slate-200 rounded-xl animate-in fade-in duration-200 mt-2">
                          <BookOpen size={24} className="text-slate-300 mb-2 animate-pulse" />
                          <p className="text-xs font-semibold text-slate-500">Chưa có nguồn trích dẫn</p>
                          <p className="text-[10px] text-slate-400 mt-1 max-w-[180px] leading-relaxed">
                            Bấm "Tạo nội dung" để AI tự động truy xuất tài liệu tham khảo cho mục này.
                          </p>
                        </div>
                      ) : (
                        activeChunks.map((chunk, index) => {
                          const expanded = activeSectionId
                            ? isChunkExpanded(activeSectionId, chunk.id)
                            : false;
                          const isHighlighted = activeHighlightedChunkIds.has(
                            chunk.id,
                          );
                          const displayText = expanded
                            ? chunk.text || ""
                            : truncateChunkText(chunk.text || "", 180);
                          const effectiveStartPage =
                            chunk.pageNumber ??
                            chunk.startPage ??
                            chunk.metadata?.startPage ??
                            null;
                          const effectiveEndPage =
                            chunk.endPage ?? chunk.metadata?.endPage ?? null;
                          const citation = formatCitation({
                            file_name:
                              chunk.metadata?.fileName ||
                              chunk.source ||
                              chunk.title ||
                              "",
                            chapter_title: chunk.metadata?.chapterTitle || "",
                            section_title: chunk.metadata?.sectionTitle || "",
                            subsection_title:
                              chunk.metadata?.subsectionTitle || "",
                            chapter: chunk.metadata?.chapter || "",
                            section: chunk.metadata?.section || "",
                            subsection: chunk.metadata?.subsection || "",
                            start_page: effectiveStartPage,
                            end_page: effectiveEndPage,
                          });
                          return (
                            <div
                              key={chunk.id || `${index}`}
                              ref={(node) => {
                                chunkCardRefs.current[chunk.id] = node;
                              }}
                              className={`border rounded-xl p-4 bg-white transition-all duration-200 shadow-sm ${
                                isHighlighted
                                  ? "ring-2 ring-blue-500 border-blue-400 bg-blue-50/30 shadow-md shadow-blue-500/5 scale-[1.01]"
                                  : "border-slate-200/80 hover:border-slate-300 hover:shadow"
                              }`}
                            >
                              <div className="flex items-center justify-between mb-1.5">
                                <span className="text-[11px] font-bold text-slate-800 flex items-center gap-1.5">
                                  <span className="h-1.5 w-1.5 rounded-full bg-blue-600"></span>
                                  Đoạn trích {index + 1}
                                </span>
                                <span className="text-[10px] bg-slate-100 text-slate-500 font-semibold px-2 py-0.5 rounded-full">
                                  Trùng khớp: {chunk.score.toFixed(2)}
                                </span>
                              </div>
                              <p className="text-[10px] text-slate-400 font-semibold leading-relaxed mb-2.5 break-words">
                                {citation}
                              </p>
                              <blockquote className="border-l-2 border-slate-200 pl-3 text-xs text-slate-600 leading-relaxed font-medium bg-slate-50/30 py-1.5 pr-1.5 rounded-r">
                                {displayText}
                              </blockquote>
                              {(chunk.text || "").trim().length > 180 &&
                                activeSectionId && (
                                  <button
                                    onClick={() =>
                                      toggleChunkExpanded(
                                        activeSectionId,
                                        chunk.id,
                                      )
                                    }
                                    className="mt-2.5 text-[10px] font-bold text-blue-600 hover:text-blue-700 hover:underline transition"
                                  >
                                    {expanded ? "Thu gọn" : "Xem thêm"}
                                  </button>
                                )}
                            </div>
                          );
                        })
                      )
                    )}

                    {activeContextTab === "evaluation" && (
                      !activeEvaluation ? (
                        <div className="flex flex-col items-center justify-center text-center p-6 bg-slate-50/40 border border-dashed border-slate-200 rounded-xl animate-in fade-in duration-200 mt-2">
                          <Sparkles size={24} className="text-slate-300 mb-2 animate-pulse" />
                          <p className="text-xs font-semibold text-slate-500">Chưa có đánh giá chất lượng</p>
                          <p className="text-[10px] text-slate-400 mt-1 max-w-[180px] leading-relaxed">
                            AI sẽ phân tích và đánh giá chất lượng (độ chính xác, chi tiết, dễ hiểu) sau khi tạo nội dung.
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          <div className="bg-slate-50/50 p-4 rounded-xl border border-slate-100">
                            <p className="text-xs font-bold text-slate-800 uppercase tracking-wide mb-3 flex items-center gap-1.5">
                              <span>📊 Điểm số chất lượng</span>
                            </p>
                            <div className="space-y-3.5">
                              {[
                                { label: "Độ chính xác", score: activeEvaluation.scores.accuracy },
                                { label: "Độ bao phủ", score: activeEvaluation.scores.coverage },
                                { label: "Cấu trúc tổ chức", score: activeEvaluation.scores.structure },
                                { label: "Độ dễ hiểu", score: activeEvaluation.scores.clarity },
                              ].map((item) => (
                                <div key={item.label} className="space-y-1">
                                  <div className="flex items-center justify-between text-xs font-medium">
                                    <span className="text-slate-500">{item.label}</span>
                                    <span className="font-bold text-slate-800">
                                      {formatScore10(item.score)}/10
                                    </span>
                                  </div>
                                  <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                    <div 
                                      className={`h-full rounded-full transition-all duration-300 ${
                                        item.score >= 8 
                                          ? "bg-emerald-500" 
                                          : item.score >= 6 
                                            ? "bg-blue-500" 
                                            : "bg-amber-500"
                                      }`}
                                      style={{ width: `${Math.min(100, item.score * 10)}%` }}
                                    />
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>

                          <div className="bg-emerald-50/30 p-4 rounded-xl border border-emerald-100/50">
                            <p className="text-xs font-bold text-emerald-800 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                              <CheckCircle2 size={13} className="text-emerald-600" />
                              <span>Điểm mạnh:</span>
                            </p>
                            <ul className="space-y-1 text-xs text-slate-700 font-medium">
                              {(activeEvaluation.strengths || []).length > 0 ? (
                                activeEvaluation.strengths.map((item, idx) => (
                                  <li key={`strength-${idx}`} className="flex items-start gap-1.5">
                                    <span className="text-emerald-500 shrink-0 mt-0.5">•</span>
                                    <span>{item}</span>
                                  </li>
                                ))
                              ) : (
                                <li className="text-slate-400 italic">Chưa phát hiện điểm nổi bật</li>
                              )}
                            </ul>
                          </div>

                          <div className="bg-rose-50/30 p-4 rounded-xl border border-rose-100/50">
                            <p className="text-xs font-bold text-rose-800 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                              <span className="text-rose-600 font-bold">✕</span>
                              <span>Hạn chế:</span>
                            </p>
                            <ul className="space-y-1 text-xs text-slate-700 font-medium">
                              {(activeEvaluation.weaknesses || []).length > 0 ? (
                                activeEvaluation.weaknesses.map((item, idx) => (
                                  <li key={`weakness-${idx}`} className="flex items-start gap-1.5">
                                    <span className="text-rose-500 shrink-0 mt-0.5">•</span>
                                    <span>{item}</span>
                                  </li>
                                ))
                              ) : (
                                <li className="text-slate-400 italic">Không phát hiện điểm yếu nào</li>
                              )}
                            </ul>
                          </div>

                          <div className="bg-amber-50/30 p-4 rounded-xl border border-amber-100/50">
                            <p className="text-xs font-bold text-amber-800 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                              <Sparkles size={13} className="text-amber-600" />
                              <span>Gợi ý cải thiện:</span>
                            </p>
                            <ul className="space-y-1 text-xs text-slate-700 font-medium">
                              {(activeEvaluation.suggestions || []).length > 0 ? (
                                activeEvaluation.suggestions.map((item, idx) => (
                                  <li key={`suggestion-${idx}`} className="flex items-start gap-1.5">
                                    <span className="text-amber-500 shrink-0 mt-0.5">•</span>
                                    <span>{item}</span>
                                  </li>
                                ))
                              ) : (
                                <li className="text-slate-400 italic">Giao diện đã tối ưu</li>
                              )}
                            </ul>
                          </div>
                        </div>
                      )
                    )}

                    {activeContextTab === "history" && (
                      loadingHistory ? (
                        <div className="flex justify-center items-center py-8">
                          <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
                        </div>
                      ) : historyEntries.length === 0 ? (
                        <div className="flex flex-col items-center justify-center text-center p-6 bg-slate-50/40 border border-dashed border-slate-200 rounded-xl mt-2 animate-in fade-in duration-200">
                          <RefreshCw size={24} className="text-slate-300 mb-2" />
                          <p className="text-xs font-semibold text-slate-500">Chưa có lịch sử thay đổi</p>
                          <p className="text-[10px] text-slate-400 mt-1 max-w-[180px] leading-relaxed">
                            Mỗi lần bạn tạo hoặc chỉnh sửa nội dung bài giảng, lịch sử sẽ được lưu tại đây.
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {historyEntries.map((entry) => (
                            <div
                              key={entry.id}
                              className="border border-slate-200/80 rounded-xl p-4 bg-white shadow-sm hover:border-slate-300 hover:shadow transition-all duration-200"
                            >
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-[10px] bg-slate-100 text-slate-500 font-semibold px-2 py-0.5 rounded-full">
                                  {new Date(entry.created_at).toLocaleString("vi-VN")}
                                </span>
                                <button
                                  onClick={() => void handleRestoreHistory(entry.id)}
                                  className="text-[10px] font-bold text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 px-2 py-1 rounded-md transition duration-200"
                                >
                                  Khôi phục
                                </button>
                              </div>
                              {entry.prompt && (
                                <div className="mb-2">
                                  <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Prompt đã dùng:</span>
                                  <p className="text-xs text-slate-700 font-medium bg-slate-50 p-2 rounded-lg border border-slate-100 leading-normal line-clamp-3" title={entry.prompt}>
                                    {entry.prompt}
                                  </p>
                                </div>
                              )}
                              {entry.content_markdown && (
                                <div>
                                  <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Xem trước nội dung:</span>
                                  <p className="text-[11px] text-slate-500 leading-relaxed font-mono line-clamp-3 bg-slate-50/30 p-2 rounded border border-slate-100/50" title={entry.content_markdown}>
                                    {entry.content_markdown}
                                  </p>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )
                    )}
                  </div>
                </div>
              </div>
            </aside>
          )}
        </div>
      )}

      {deleteTargetSection && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-2xl max-w-md w-full mx-4 animate-in zoom-in-95 duration-150">
            <h3 className="text-base font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2 mb-3">
              ⚠️ Xóa Mục Có Chứa Mục Con
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-6 leading-relaxed">
              Mục <strong className="text-slate-800 dark:text-slate-200">"{deleteTargetSection.title}"</strong> bạn chọn xóa có chứa <strong className="text-blue-600">{deleteChildrenCount} mục con</strong> trực thuộc phía dưới. Bạn muốn xử lý thế nào?
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => void executeDeleteSection(deleteTargetSection.id, true)}
                className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-2.5 rounded-xl text-xs transition duration-150"
              >
                Xóa mục cha và Xóa tất cả các mục con
              </button>
              <button
                onClick={() => void executeDeleteSection(deleteTargetSection.id, false)}
                className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 font-bold py-2.5 rounded-xl text-xs transition duration-150"
              >
                Chỉ xóa mục cha (Giữ lại & Đôn các mục con lên)
              </button>
              <button
                onClick={() => setDeleteTargetSection(null)}
                className="w-full bg-white hover:bg-slate-50 text-slate-500 border border-slate-200 dark:bg-slate-950 dark:hover:bg-slate-900 dark:text-slate-400 dark:border-slate-800 font-bold py-2.5 rounded-xl text-xs transition duration-150 mt-2"
              >
                Hủy bỏ
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
