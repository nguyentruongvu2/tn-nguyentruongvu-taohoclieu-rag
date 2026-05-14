import { useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import {
  generateTeachingMaterial,
  improveTeachingMaterial,
  regenerateTeachingMaterial,
  getStoredAuthUser,
} from "../services/api";
import { toastService } from "../services/toastService";
import {
  Download,
  Loader2,
  PlayCircle,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Edit3,
  Send,
  FileText,
  MessageSquareQuote,
  BarChart,
  Sparkles,
} from "lucide-react";
import { formatCitation } from "../utils/citation";

const STORAGE_KEY_GENERATE = "rag_generate_form_state";

const parseJsonSafely = <T,>(raw: string | null, fallback: T): T => {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const normalizeMarkdownForPreview = (text: string): string => {
  return (text || "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
};

// Translation map for evaluation metrics
const EVALUATION_LABELS: Record<string, string> = {
  relevance: "Độ liên quan",
  accuracy: "Độ chính xác",
  faithfulness: "Độ chính xác",
  coherence: "Độ mạch lạc",
  completeness: "Độ đầy đủ",
  clarity: "Độ rõ ràng",
  informativeness: "Độ thông tin",
  usefulness: "Độ hữu ích",
  coverage: "Độ bao phủ",
  precision: "Độ chi tiết",
  fluency: "Độ trôi chảy",
  consistency: "Độ nhất quán",
  strengths: "Điểm mạnh",
  weaknesses: "Điểm yếu",
  improvements: "Gợi ý cải thiện",
  grounding_unsupported_ratio: "Tỷ lệ ngoài ngữ cảnh",
  grounding_status: "Trạng thái grounding",
};

const SCORE_METRIC_KEYS = new Set([
  "relevance",
  "accuracy",
  "faithfulness",
  "coherence",
  "completeness",
  "clarity",
  "informativeness",
  "usefulness",
  "coverage",
  "precision",
  "fluency",
  "consistency",
]);

export default function GenerateMaterialForm({
  documents,
}: {
  documents: any[];
}) {
  const EVALUATION_TEXT_KEYS = ["strengths", "weaknesses", "improvements"];
  const currentUser = getStoredAuthUser();
  const storagePrefix = `${STORAGE_KEY_GENERATE}_${currentUser?.user_id ?? "anon"}`;

  // Load from localStorage or use defaults
  const [selectedDocs, setSelectedDocs] = useState<string[]>(() => {
    const saved = localStorage.getItem(`${storagePrefix}_docs`);
    return parseJsonSafely<string[]>(saved, []);
  });
  const [prompt, setPrompt] = useState(() => {
    return (
      localStorage.getItem(`${storagePrefix}_prompt`) ||
      "Tạo bài giảng cơ bản về..."
    );
  });
  const [level, setLevel] = useState(() => {
    return localStorage.getItem(`${storagePrefix}_level`) || "intermediate";
  });
  const [format, setFormat] = useState(() => {
    return localStorage.getItem(`${storagePrefix}_format`) || "lecture";
  });
  const [length, setLength] = useState(() => {
    return localStorage.getItem(`${storagePrefix}_length`) || "medium";
  });

  const [loading, setLoading] = useState(false);
  const [isDocListOpen, setIsDocListOpen] = useState(false);
  const [result, setResult] = useState<any>(() => {
    const saved = localStorage.getItem(`${storagePrefix}_result`);
    return parseJsonSafely<any>(saved, null);
  });
  const [error, setError] = useState<string | null>(null);

  const [activeResultTab, setActiveResultTab] = useState<
    "content" | "sources" | "evaluation"
  >("content");
  const [showImproveInput, setShowImproveInput] = useState(false);
  const [improvePrompt, setImprovePrompt] = useState("");

  // Save form state to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem(`${storagePrefix}_docs`, JSON.stringify(selectedDocs));
  }, [selectedDocs, storagePrefix]);

  useEffect(() => {
    localStorage.setItem(`${storagePrefix}_prompt`, prompt);
  }, [prompt, storagePrefix]);

  useEffect(() => {
    localStorage.setItem(`${storagePrefix}_level`, level);
  }, [level, storagePrefix]);

  useEffect(() => {
    localStorage.setItem(`${storagePrefix}_format`, format);
  }, [format, storagePrefix]);

  useEffect(() => {
    localStorage.setItem(`${storagePrefix}_length`, length);
  }, [length, storagePrefix]);

  useEffect(() => {
    if (result) {
      localStorage.setItem(`${storagePrefix}_result`, JSON.stringify(result));
    }
  }, [result, storagePrefix]);

  const handleToggleDoc = (docId: string) => {
    setSelectedDocs((prev) =>
      prev.includes(docId)
        ? prev.filter((id) => id !== docId)
        : [...prev, docId],
    );
  };

  const validateBeforeGenerate = (finalPrompt: string) => {
    if (selectedDocs.length === 0) {
      setError("Vui lòng chọn tài liệu");
      return false;
    }
    if (!finalPrompt.trim()) {
      setError("Vui lòng nhập yêu cầu!");
      return false;
    }
    return true;
  };

  const resolveErrorMessage = (err: any): string => {
    const raw = String(err?.message || "").toLowerCase();
    if (
      raw.includes("khong du") ||
      raw.includes("không đủ") ||
      raw.includes("khong tim thay context") ||
      raw.includes("không tìm thấy context")
    ) {
      return "Không đủ dữ liệu từ tài liệu";
    }
    return err?.message || "Không thể kết nối đến máy chủ.";
  };

  const handleGenerate = async () => {
    if (!validateBeforeGenerate(prompt)) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await toastService.promise(
        generateTeachingMaterial({
          document_ids: selectedDocs,
          prompt,
          level,
          output_format: format as "lecture" | "slide" | "summary",
          length,
        }).then((data) => {
          if (!data.success) {
            throw new Error("Có lỗi xảy ra khi tạo tài liệu.");
          }
          return data;
        }),
        {
          loading: "Đang tạo tài liệu giảng dạy...",
          success: "Tạo tài liệu giảng dạy thành công.",
          error: (err) => resolveErrorMessage(err),
        },
      );

      setResult(response);
    } catch (err: any) {
      setError(resolveErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleRegenerate = async () => {
    if (!validateBeforeGenerate(prompt)) return;

    setLoading(true);
    setError(null);

    try {
      const response = await toastService.promise(
        regenerateTeachingMaterial({
          document_ids: selectedDocs,
          prompt,
          level,
          output_format: format as "lecture" | "slide" | "summary",
          length,
          previous_content: result?.content_markdown,
        }).then((data) => {
          if (!data.success) {
            throw new Error("Có lỗi xảy ra khi tạo lại tài liệu.");
          }
          return data;
        }),
        {
          loading: "Đang tạo lại tài liệu...",
          success: "Tạo lại tài liệu thành công.",
          error: (err) => resolveErrorMessage(err),
        },
      );

      setResult(response);
    } catch (err: any) {
      setError(resolveErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleImprove = async () => {
    if (!validateBeforeGenerate(prompt)) return;
    if (!improvePrompt.trim()) {
      setError("Vui lòng nhập yêu cầu cải thiện");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await toastService.promise(
        improveTeachingMaterial({
          document_ids: selectedDocs,
          prompt,
          level,
          output_format: format as "lecture" | "slide" | "summary",
          length,
          improve_prompt: improvePrompt,
          previous_content: result?.content_markdown,
        }).then((data) => {
          if (!data.success) {
            throw new Error("Có lỗi xảy ra khi cải thiện tài liệu.");
          }
          return data;
        }),
        {
          loading: "Đang cải thiện tài liệu...",
          success: "Cải thiện tài liệu thành công.",
          error: (err) => resolveErrorMessage(err),
        },
      );

      setResult(response);
      setImprovePrompt("");
      setShowImproveInput(false);
    } catch (err: any) {
      setError(resolveErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = () => {
    if (!result || !result.content_markdown) return;
    const blob = new Blob([result.content_markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "tai_lieu_giang_day.md";
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  // Helper function to get Vietnamese label for evaluation metrics
  const getEvaluationLabel = (key: string): string => {
    return (
      EVALUATION_LABELS[key.toLowerCase()] ||
      key.charAt(0).toUpperCase() + key.slice(1)
    );
  };

  const evaluationEntries = result?.evaluation
    ? Object.entries(result.evaluation)
    : [];

  const scoreEntries = evaluationEntries.filter(
    ([key, val]) =>
      SCORE_METRIC_KEYS.has(key.toLowerCase()) && typeof val === "number",
  );

  const groundingUnsupportedRatio =
    typeof result?.evaluation?.grounding_unsupported_ratio === "number"
      ? Number(result.evaluation.grounding_unsupported_ratio)
      : null;

  const textEntries = evaluationEntries.filter(
    ([key, val]) =>
      EVALUATION_TEXT_KEYS.includes(key.toLowerCase()) &&
      typeof val === "string" &&
      val.trim().length > 0,
  );

  return (
    <div className="h-full flex flex-col p-4 xl:p-8 animate-in fade-in slide-in-from-bottom-4 duration-500 overflow-y-auto custom-scrollbar">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-6">
        <h3 className="text-xl font-bold text-gray-800">
          Tạo tài liệu giảng dạy (RAG)
        </h3>

        {error && (
          <div className="p-4 bg-red-50 text-red-600 rounded-lg">{error}</div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-4">
            <div>
              <button
                type="button"
                onClick={() => setIsDocListOpen(!isDocListOpen)}
                className="w-full flex items-center justify-between text-sm font-semibold text-gray-700 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 hover:bg-gray-100 transition-colors mb-2"
              >
                <span>
                  1. Chọn tài liệu (Knowledge Base){" "}
                  {selectedDocs.length > 0 && (
                    <span className="text-blue-600 ml-1">
                      ({selectedDocs.length} tài liệu đã chọn)
                    </span>
                  )}
                </span>
                {isDocListOpen ? (
                  <ChevronUp size={18} />
                ) : (
                  <ChevronDown size={18} />
                )}
              </button>

              {isDocListOpen && (
                <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-xl p-3 space-y-2 bg-white animate-in fade-in slide-in-from-top-2 duration-200 shadow-sm relative z-10">
                  {documents.length === 0 ? (
                    <p className="text-sm text-gray-500 text-center py-2">
                      Bạn chưa có tài liệu nào.
                    </p>
                  ) : (
                    documents.map((doc) => (
                      <label
                        key={doc.id}
                        className="flex items-center gap-3 p-2 hover:bg-blue-50/50 rounded-lg cursor-pointer transition-colors"
                      >
                        <input
                          type="checkbox"
                          className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                          checked={selectedDocs.includes(doc.id)}
                          onChange={() => handleToggleDoc(doc.id)}
                        />
                        <span className="text-sm text-gray-700 truncate select-none flex-1">
                          {doc.original_filename || doc.id}
                        </span>
                      </label>
                    ))
                  )}
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                2. Nhập yêu cầu Prompt
              </label>
              <textarea
                className="w-full border border-gray-200 rounded-xl p-3 text-sm"
                rows={3}
                placeholder="Ví dụ: Tạo bài giảng cơ bản, Tóm tắt chương 1..."
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">
                  Cấp độ
                </label>
                <select
                  value={level}
                  onChange={(e) => setLevel(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg p-2 text-sm"
                >
                  <option value="basic">Cơ bản</option>
                  <option value="intermediate">Trung bình</option>
                  <option value="advanced">Nâng cao</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">
                  Định dạng
                </label>
                <select
                  value={format}
                  onChange={(e) => setFormat(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg p-2 text-sm"
                >
                  <option value="lecture">Bài giảng</option>
                  <option value="slide">Slide</option>
                  <option value="summary">Tóm tắt</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">
                  Độ dài
                </label>
                <select
                  value={length}
                  onChange={(e) => setLength(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg p-2 text-sm"
                >
                  <option value="short">Ngắn</option>
                  <option value="medium">Vừa</option>
                  <option value="long">Dài</option>
                </select>
              </div>
            </div>

            <button
              onClick={handleGenerate}
              disabled={loading}
              className="w-full mt-4 flex items-center justify-center gap-2 bg-blue-600 text-white font-semibold py-3 rounded-xl hover:bg-blue-700"
            >
              {loading ? (
                <Loader2 className="animate-spin" size={20} />
              ) : (
                <PlayCircle size={20} />
              )}
              {loading ? "Đang xử lý RAG..." : "Tạo tài liệu giảng dạy"}
            </button>
          </div>

          <div className="bg-gray-50 border border-gray-100 rounded-xl flex flex-col h-screen max-h-[calc(100vh-120px)] overflow-hidden">
            {loading ? (
              <div className="flex-1 flex flex-col items-center justify-center text-gray-400 p-4">
                <Loader2 className="animate-spin w-10 h-10 mb-4 text-blue-500" />
                <p>
                  Hệ thống AI đang tổng hợp kiến thức từ tài liệu của bạn...
                </p>
              </div>
            ) : result ? (
              <div className="flex-1 flex flex-col h-full overflow-hidden">
                {/* Header & Actions */}
                <div className="flex flex-wrap items-center justify-between gap-2 p-4 border-b border-gray-200 bg-white">
                  <div className="flex space-x-1">
                    <button
                      onClick={() => setActiveResultTab("content")}
                      className={`px-3 py-1.5 text-sm font-semibold rounded-lg transition-colors flex items-center gap-1.5 ${
                        activeResultTab === "content"
                          ? "bg-blue-100 text-blue-700"
                          : "text-gray-600 hover:bg-gray-100"
                      }`}
                    >
                      <FileText size={16} /> Nội dung
                    </button>
                    <button
                      onClick={() => setActiveResultTab("sources")}
                      className={`px-3 py-1.5 text-sm font-semibold rounded-lg transition-colors flex items-center gap-1.5 ${
                        activeResultTab === "sources"
                          ? "bg-blue-100 text-blue-700"
                          : "text-gray-600 hover:bg-gray-100"
                      }`}
                    >
                      <MessageSquareQuote size={16} /> Nguồn dữ liệu
                    </button>
                    {result.evaluation && (
                      <button
                        onClick={() => setActiveResultTab("evaluation")}
                        className={`px-3 py-1.5 text-sm font-semibold rounded-lg transition-colors flex items-center gap-1.5 ${
                          activeResultTab === "evaluation"
                            ? "bg-blue-100 text-blue-700"
                            : "text-gray-600 hover:bg-gray-100"
                        }`}
                      >
                        <BarChart size={16} /> Đánh giá
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-2 relative">
                    <button
                      onClick={handleRegenerate}
                      disabled={loading}
                      className="flex items-center gap-1 text-sm bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 text-indigo-700 px-3 py-1.5 rounded-lg font-medium transition-colors"
                      title="Tạo lại kết quả khác"
                    >
                      <RefreshCw size={16} /> Tạo lại
                    </button>
                    <button
                      onClick={() => setShowImproveInput(!showImproveInput)}
                      className="flex items-center gap-1 text-sm bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 text-emerald-700 px-3 py-1.5 rounded-lg font-medium transition-colors"
                      title="Cải thiện nội dung"
                    >
                      <Edit3 size={16} /> Cải thiện
                    </button>
                    <button
                      onClick={handleDownload}
                      className="flex items-center gap-1 text-sm bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg shadow-sm font-medium transition-colors"
                      title="Tải xuống tệp Markdown"
                    >
                      <Download size={16} /> Tải Markdown
                    </button>
                  </div>
                </div>

                {showImproveInput && (
                  <div className="p-3 bg-emerald-50/50 border-b border-emerald-100 flex items-center gap-2">
                    <input
                      type="text"
                      className="flex-1 border border-emerald-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                      placeholder="Ví dụ: Giải thích chi tiết hơn phần khái niệm..."
                      value={improvePrompt}
                      onChange={(e) => setImprovePrompt(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleImprove()}
                    />
                    <button
                      onClick={handleImprove}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-1 transition-colors whitespace-nowrap shadow-sm"
                    >
                      <Send size={16} /> Gửi
                    </button>
                  </div>
                )}

                <div className="flex-1 overflow-y-auto p-6 custom-scrollbar bg-gray-50/50 space-y-6">
                  {/* Content Tab */}
                  {activeResultTab === "content" && (
                    <div className="prose prose-sm prose-blue markdown-preview max-w-none bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                      <ReactMarkdown>
                        {normalizeMarkdownForPreview(
                          String(result.content_markdown || ""),
                        )}
                      </ReactMarkdown>
                    </div>
                  )}

                  {/* Sources Tab */}
                  {activeResultTab === "sources" && (
                    <div className="space-y-4">
                      {result.contexts && result.contexts.length > 0 ? (
                        <>
                          <h4 className="font-bold text-gray-800 text-lg mb-4">
                            📚 Nguồn dữ liệu
                          </h4>
                          <div className="space-y-3">
                            {result.contexts.map((src: any, idx: number) => {
                              const citation = formatCitation({
                                file_name:
                                  src.file_name ||
                                  src.source ||
                                  src.title ||
                                  "Tài liệu hệ thống",
                                chapter: src.chapter || "",
                                section: src.section || "",
                                subsection: src.subsection || "",
                                start_page:
                                  typeof src.start_page === "number"
                                    ? src.start_page
                                    : typeof src.page_number === "number"
                                      ? src.page_number
                                      : null,
                                end_page:
                                  typeof src.end_page === "number"
                                    ? src.end_page
                                    : typeof src.page_number === "number"
                                      ? src.page_number
                                      : null,
                              });
                              const relevance = String(
                                src.relevance || "",
                              ).trim();
                              const snippet = normalizeMarkdownForPreview(
                                String(src.clean_content || src.snippet || ""),
                              );

                              return (
                                <div
                                  key={idx}
                                  className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm"
                                >
                                  <div className="flex items-center justify-between gap-2 mb-2 pb-2 border-b border-gray-100">
                                    <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded text-xs font-bold">
                                      Nguồn #{idx + 1}
                                    </span>
                                    {relevance && (
                                      <span className="text-[11px] px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-semibold">
                                        {relevance}
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-xs text-gray-600 font-medium mb-2">
                                    {citation}
                                  </p>
                                  <div className="prose prose-sm markdown-preview max-w-none text-gray-700 leading-relaxed prose-headings:my-1 prose-headings:text-sm prose-headings:font-semibold prose-p:my-1 prose-ul:my-1 prose-ol:my-1">
                                    <ReactMarkdown>{snippet}</ReactMarkdown>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </>
                      ) : (
                        <div className="flex flex-col items-center justify-center py-10 text-gray-500">
                          <MessageSquareQuote
                            size={48}
                            className="text-gray-300 mb-4"
                          />
                          <p>
                            Không có thông tin nguồn dữ liệu cho nội dung này.
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Evaluation Tab */}
                  {activeResultTab === "evaluation" && result.evaluation && (
                    <div className="space-y-6">
                      <h4 className="font-bold text-gray-800 text-lg mb-4">
                        📊 Đánh giá chất lượng
                      </h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        {scoreEntries.map(([key, val]) => (
                          <div
                            key={key}
                            className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex flex-col justify-center items-center text-center"
                          >
                            <span className="text-sm font-semibold text-gray-600 mb-2">
                              {getEvaluationLabel(key)}
                            </span>
                            <div className="flex items-end gap-1">
                              <span className="font-bold text-blue-600 text-3xl leading-none">
                                {val as any}
                              </span>
                              <span className="text-sm font-medium text-gray-400 mb-1">
                                / 5
                              </span>
                            </div>
                          </div>
                        ))}

                        {groundingUnsupportedRatio !== null && (
                          <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex flex-col justify-center items-center text-center">
                            <span className="text-sm font-semibold text-gray-600 mb-2">
                              {getEvaluationLabel(
                                "grounding_unsupported_ratio",
                              )}
                            </span>
                            <div className="flex items-end gap-1">
                              <span className="font-bold text-blue-600 text-3xl leading-none">
                                {groundingUnsupportedRatio.toFixed(3)}
                              </span>
                              <span className="text-sm font-medium text-gray-400 mb-1">
                                / 1
                              </span>
                            </div>
                          </div>
                        )}
                      </div>

                      {textEntries.length > 0 && (
                        <div className="space-y-4 mt-6">
                          {textEntries.map(([key, val]) => (
                            <div
                              key={key}
                              className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm"
                            >
                              <h5 className="font-bold text-gray-800 mb-2 capitalize border-b border-gray-100 pb-2">
                                {getEvaluationLabel(key)}
                              </h5>
                              <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                                {val as string}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-gray-400 p-8 text-center h-full">
                <Sparkles size={48} className="text-gray-300 mb-4" />
                <p className="font-medium text-gray-500">
                  Nội dung sinh ra sẽ hiển thị ở đây.
                </p>
                <p className="text-sm mt-2 text-gray-400">
                  Chọn tài liệu, nhập yêu cầu và nhấn "Tạo Tài Liệu Giảng Dạy".
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
