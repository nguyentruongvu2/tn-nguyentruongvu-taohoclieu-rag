import TeachingMaterialList from "./TeachingMaterialList";
import ProfileManagement from "../components/ProfileManagement";
import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Upload,
  Search,
  FileText,
  Send,
  Trash2,
  StopCircle,
  User,
  LogOut,
  CheckCircle,
  AlertTriangle,
  Menu,
  X,
  Filter,
  Sparkles,
  Eye,
  Copy,
  Download,
  Check,
  ChevronDown,
  BookOpen,
  Plus,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import {
  createChatConversation,
  deleteChatConversation,
  getChatMessages,
  listSecureDocuments,
  listChatConversations,
  deleteSecureDocument,
  secureUploadDocument,
  secureAskChatStream,
  logoutUser,
  getStoredAuthUser,
  getSecureDocumentDetail,
  fetchSecureDocumentPreviewBlob,
} from "../services/api";
import { toastService } from "../services/toastService";

const STORAGE_KEY_DASHBOARD = "rag_dashboard_state";
const DASHBOARD_TAB_VALUES = [
  "chat",
  "documents",
  "generate",
  "preview",
  "profile",
] as const;

type DashboardTab = (typeof DASHBOARD_TAB_VALUES)[number];

const normalizeDashboardTab = (value: string | null): DashboardTab | null => {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return DASHBOARD_TAB_VALUES.includes(normalized as DashboardTab)
    ? (normalized as DashboardTab)
    : null;
};

const parseJsonSafely = <T,>(raw: string | null, fallback: T): T => {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

export default function UserDashboard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const currentUser = getStoredAuthUser();
  const storagePrefix = `${STORAGE_KEY_DASHBOARD}_${currentUser?.user_id ?? "anon"}`;

  const [activeTab, setActiveTab] = useState<DashboardTab>(() => {
    const tabFromUrl = normalizeDashboardTab(searchParams.get("tab"));
    const tabFromStorage = normalizeDashboardTab(
      localStorage.getItem(`${storagePrefix}_activeTab`),
    );
    return tabFromUrl || tabFromStorage || "chat";
  });
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  const [documents, setDocuments] = useState<any[]>([]);
  const [docLoading, setDocLoading] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadOcrMode] = useState<"auto" | "on" | "off">("auto");
  const [previewDocumentId, setPreviewDocumentId] = useState<string | null>(
    null,
  );
  const [previewDetail, setPreviewDetail] = useState<any | null>(null);
  const [previewBlobUrl, setPreviewBlobUrl] = useState<string | null>(null);
  const [previewBlobType, setPreviewBlobType] = useState<string>("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [chatHistory, setChatHistory] = useState<any[]>(() => {
    const saved = localStorage.getItem(`${storagePrefix}_chatHistory`);
    return parseJsonSafely<any[]>(saved, []);
  });
  const [conversations, setConversations] = useState<any[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string>(
    () => {
      return localStorage.getItem(`${storagePrefix}_conversationId`) || "";
    },
  );
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>(() => {
    const saved = localStorage.getItem(`${storagePrefix}_selectedDocIds`);
    return parseJsonSafely<string[]>(saved, []);
  });
  const [message, setMessage] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [showDocDropdown, setShowDocDropdown] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Save activeTab to localStorage
  useEffect(() => {
    localStorage.setItem(`${storagePrefix}_activeTab`, activeTab);
  }, [activeTab, storagePrefix]);

  // Keep URL query in sync with active dashboard tab for direct/shareable links.
  useEffect(() => {
    const tabInUrl = normalizeDashboardTab(searchParams.get("tab"));
    if (tabInUrl === activeTab) return;
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("tab", activeTab);
    setSearchParams(nextParams, { replace: true });
  }, [activeTab, searchParams, setSearchParams]);

  // React to browser navigation changes (back/forward) on tab query.
  useEffect(() => {
    const tabInUrl = normalizeDashboardTab(searchParams.get("tab"));
    if (tabInUrl) {
      setActiveTab((prev) => (prev === tabInUrl ? prev : tabInUrl));
    }
  }, [searchParams]);

  // Save chatHistory to localStorage
  useEffect(() => {
    localStorage.setItem(
      `${storagePrefix}_chatHistory`,
      JSON.stringify(chatHistory),
    );
  }, [chatHistory, storagePrefix]);

  useEffect(() => {
    localStorage.setItem(
      `${storagePrefix}_conversationId`,
      activeConversationId || "",
    );
  }, [activeConversationId, storagePrefix]);
  useEffect(() => {
    localStorage.setItem(
      `${storagePrefix}_selectedDocIds`,
      JSON.stringify(selectedDocIds)
    );
  }, [selectedDocIds, storagePrefix]);

  // Load documents on mount
  useEffect(() => {
    loadDocuments();
    loadConversations();
  }, []);

  // Auto-scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory]);

  useEffect(() => {
    return () => {
      if (previewBlobUrl) {
        URL.revokeObjectURL(previewBlobUrl);
      }
    };
  }, [previewBlobUrl]);

  const loadDocuments = async () => {
    setDocLoading(true);
    setDocError(null);
    try {
      const docs = await listSecureDocuments();
      setDocuments(docs);
      if (selectedDocIds.length === 0 && docs.length > 0) {
        setSelectedDocIds([String(docs[0].id)]);
      }
    } catch (e: any) {
      setDocError(
        e?.message ||
          "Không tải được danh sách tài liệu. Vui lòng kiểm tra kết nối API.",
      );
    } finally {
      setDocLoading(false);
    }
  };

  const toChatPairs = (messages: any[]) => {
    const pairs: any[] = [];
    let pendingUser: any = null;

    for (const msg of messages) {
      if (msg.role === "user") {
        if (pendingUser) {
          pairs.push(pendingUser);
        }
        pendingUser = {
          question: msg.content,
          answer: "",
          timestamp: msg.created_at,
        };
      } else {
        if (pendingUser) {
          pendingUser.answer = msg.content || "";
          pairs.push(pendingUser);
          pendingUser = null;
        } else {
          pairs.push({
            question: "",
            answer: msg.content || "",
            timestamp: msg.created_at,
          });
        }
      }
    }

    if (pendingUser) {
      pairs.push(pendingUser);
    }

    return pairs;
  };

  const loadConversations = async () => {
    try {
      const rows = await listChatConversations();
      setConversations(rows);
      if (!activeConversationId && rows.length > 0) {
        setActiveConversationId(rows[0].id);
      }
      if (!rows.length) {
        setChatHistory([]);
      }
    } catch (e: any) {
      console.error(e?.message || "Load conversations failed");
    }
  };

  const handleCreateConversation = async () => {
    try {
      const created = await createChatConversation({
        title: "Cuộc hội thoại mới",
        document_ids: selectedDocIds.length > 0 ? selectedDocIds : undefined,
      });
      await loadConversations();
      setActiveConversationId(created.id);
      setChatHistory([]);
    } catch (e: any) {
      const msg = e?.message || "Không thể tạo cuộc hội thoại mới.";
      console.error(msg);
      toastService.error(msg);
    }
  };

  const handleDeleteConversation = async () => {
    if (!activeConversationId) return;
    if (!window.confirm("Bạn có chắc muốn xóa cuộc hội thoại hiện tại?"))
      return;
    try {
      await deleteChatConversation(activeConversationId);
      const rows = await listChatConversations();
      setConversations(rows);
      const nextId = rows.length > 0 ? rows[0].id : "";
      setActiveConversationId(nextId);
      if (!nextId) {
        setChatHistory([]);
      }
    } catch (e: any) {
      const msg = e?.message || "Không thể xóa cuộc hội thoại.";
      console.error(msg);
      toastService.error(msg);
    }
  };

  useEffect(() => {
    const loadActiveMessages = async () => {
      if (!activeConversationId) {
        setChatHistory([]);
        return;
      }
      try {
        const messages = await getChatMessages(activeConversationId);
        setChatHistory(toChatPairs(messages));
      } catch (e: any) {
        console.error(e?.message || "Load messages failed");
      }
    };

    loadActiveMessages();
  }, [activeConversationId]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;
    setUploading(true);
    try {
      await toastService.promise(
        secureUploadDocument(e.target.files[0], { ocrMode: uploadOcrMode }),
        {
          loading: "Đang tải và xử lý tài liệu...",
          success: "Tải tài liệu lên thành công.",
          error: (err) =>
            err instanceof Error ? err.message : "Tải lên thất bại!",
        },
      );
      await loadDocuments();
    } catch {
      // Error toast is handled by toastService.promise
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteDoc = async (id: string) => {
    if (!window.confirm("Bạn có chắc muốn xóa tài liệu này?")) return;
    try {
      const res = await deleteSecureDocument(id);
      if (previewDocumentId === id) {
        if (previewBlobUrl) {
          URL.revokeObjectURL(previewBlobUrl);
        }
        setPreviewDocumentId(null);
        setPreviewDetail(null);
        setPreviewBlobUrl(null);
        setPreviewBlobType("");
      }
      await loadDocuments();
      toastService.success(
        `Đã xóa tài liệu. Chunks đã xóa: ${res.chunks_deleted}`,
      );
    } catch (err: any) {
      const msg = err?.message || "Xóa tài liệu thất bại.";
      console.error(msg);
      toastService.error(msg);
    }
  };

  const handleOpenPreview = async (documentId: string) => {
    setActiveTab("preview");
    setPreviewDocumentId(documentId);
    setPreviewLoading(true);
    setPreviewError(null);

    try {
      const [detail, blob] = await Promise.all([
        getSecureDocumentDetail(documentId),
        fetchSecureDocumentPreviewBlob(documentId),
      ]);

      if (previewBlobUrl) {
        URL.revokeObjectURL(previewBlobUrl);
      }

      const blobUrl = URL.createObjectURL(blob);
      setPreviewBlobUrl(blobUrl);
      setPreviewBlobType(blob.type || "");
      setPreviewDetail(detail);
    } catch (err: any) {
      setPreviewError(
        err?.message || "Không thể tải preview tài liệu. Vui lòng thử lại.",
      );
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleCopyMarkdown = async () => {
    const markdown = previewDetail?.markdown || "";
    if (!markdown.trim()) return;
    try {
      await navigator.clipboard.writeText(markdown);
      toastService.success("Đã copy nội dung Markdown.");
    } catch {
      toastService.error("Không thể copy Markdown trên trình duyệt hiện tại.");
    }
  };

  const handleDownloadMarkdown = () => {
    const markdown = previewDetail?.markdown || "";
    if (!markdown.trim()) return;
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${previewDetail?.document?.original_filename || "document"}.md`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const handleDownloadOriginal = () => {
    if (!previewBlobUrl) return;
    const link = document.createElement("a");
    link.href = previewBlobUrl;
    link.download = previewDetail?.document?.original_filename || "document";
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const handleSendMessage = async () => {
    if (!message.trim() || streaming) return;
    const currentMsg = message;
    setMessage("");
    setStreaming(true);

    let currentConversationId = activeConversationId;
    if (!currentConversationId) {
      try {
        const created = await createChatConversation({
          title: currentMsg.slice(0, 80),
          document_ids: selectedDocIds.length > 0 ? selectedDocIds : undefined,
        });
        currentConversationId = created.id;
        setActiveConversationId(created.id);
      } catch (e: any) {
        setStreaming(false);
        const errMsg = e?.message || "Không thể tạo cuộc hội thoại.";
        console.error(errMsg);
        toastService.error(errMsg);
        return;
      }
    }

    const newHistory = [
      ...chatHistory,
      { question: currentMsg, answer: "", timestamp: new Date().toISOString() },
    ];
    setChatHistory(newHistory);
    let fullAnswer = "";

    try {
      await secureAskChatStream(
        {
          conversation_id: currentConversationId,
          document_ids: selectedDocIds.length > 0 ? selectedDocIds : undefined,
          question: currentMsg,
        },
        (chunk) => {
          fullAnswer += chunk;
          setChatHistory((prev) => {
            const up = [...prev];
            up[up.length - 1].answer = fullAnswer;
            return up;
          });
        },
        (metadata) => {
          if (metadata.conversation_id) {
            setActiveConversationId(metadata.conversation_id);
          }
          setChatHistory((prev) => {
            const up = [...prev];
            up[up.length - 1].metadata = { sources: metadata.sources };
            return up;
          });
        }
      );
      if (!fullAnswer) {
        setChatHistory((prev) => {
          const up = [...prev];
          up[up.length - 1].answer = "Không có nội dung trả lời";
          return up;
        });
      }
      await loadConversations();
    } catch (e: any) {
      const errMsg = e?.message || "Gửi tin nhắn thất bại.";
      console.error(errMsg, e);
      toastService.error(errMsg);
      // Remove the optimistic message or show error state
      setChatHistory(prev => prev.slice(0, -1));
    } finally {
      setStreaming(false);
    }
  };

  const handleLogout = () => {
    logoutUser();
    window.location.href = "/login";
  };

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden w-full font-sans">
      {/* Mobile Sidebar Overlay */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-20 xl:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed xl:static inset-y-0 left-0 z-30 w-72 bg-white border-r border-gray-200 transform transition-transform duration-300 ease-in-out flex flex-col ${isSidebarOpen ? "translate-x-0" : "-translate-x-full xl:translate-x-0"}`}
      >
        <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
          <div className="flex items-center gap-3">
            <div className="bg-blue-600 p-2 rounded-xl shadow-sm shadow-blue-200">
              <Sparkles size={24} className="text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900 leading-tight">
                AI Assistant
              </h1>
              <p className="text-xs text-gray-500 font-medium tracking-wide">
                Workspace Edition
              </p>
            </div>
          </div>
          <button
            className="xl:hidden text-gray-400 hover:text-gray-600 p-1"
            onClick={() => setIsSidebarOpen(false)}
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 px-4 py-6 space-y-2 overflow-y-auto">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4 px-2">
            Khu vực làm việc
          </p>
          <button
            onClick={() => {
              setActiveTab("chat");
              if (window.innerWidth < 1280) setIsSidebarOpen(false);
            }}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 ${activeTab === "chat" ? "bg-blue-50 text-blue-700 font-semibold shadow-sm border border-blue-100/50" : "text-gray-600 hover:bg-gray-50 hover:text-gray-900 font-medium"}`}
          >
            <Search
              size={20}
              className={
                activeTab === "chat" ? "text-blue-600" : "text-gray-400"
              }
            />{" "}
            AI Trợ giảng
          </button>
          <button
            onClick={() => {
              setActiveTab("documents");
              if (window.innerWidth < 1280) setIsSidebarOpen(false);
            }}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 ${activeTab === "documents" ? "bg-blue-50 text-blue-700 font-semibold shadow-sm border border-blue-100/50" : "text-gray-600 hover:bg-gray-50 hover:text-gray-900 font-medium"}`}
          >
            <FileText
              size={20}
              className={
                activeTab === "documents" ? "text-blue-600" : "text-gray-400"
              }
            />{" "}
            Quản lý Tài liệu
          </button>
          <button
            onClick={() => {
              setActiveTab("generate");
              if (window.innerWidth < 1280) setIsSidebarOpen(false);
            }}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 ${activeTab === "generate" ? "bg-blue-50 text-blue-700 font-semibold shadow-sm border border-blue-100/50" : "text-gray-600 hover:bg-gray-50 hover:text-gray-900 font-medium"}`}
          >
            <Sparkles
              size={20}
              className={
                activeTab === "generate" ? "text-blue-600" : "text-gray-400"
              }
            />{" "}
            Tạo bài giảng (RAG)
          </button>
          <button
            onClick={() => {
              setActiveTab("preview");
              if (window.innerWidth < 1280) setIsSidebarOpen(false);
            }}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 ${activeTab === "preview" ? "bg-blue-50 text-blue-700 font-semibold shadow-sm border border-blue-100/50" : "text-gray-600 hover:bg-gray-50 hover:text-gray-900 font-medium"}`}
          >
            <Eye
              size={20}
              className={
                activeTab === "preview" ? "text-blue-600" : "text-gray-400"
              }
            />{" "}
            Xem tài liệu
          </button>
          
          <button
            onClick={() => {
              setActiveTab("profile");
              if (window.innerWidth < 1280) setIsSidebarOpen(false);
            }}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 ${activeTab === "profile" ? "bg-blue-50 text-blue-700 font-semibold shadow-sm border border-blue-100/50" : "text-gray-600 hover:bg-gray-50 hover:text-gray-900 font-medium"}`}
          >
            <User
              size={20}
              className={
                activeTab === "profile" ? "text-blue-600" : "text-gray-400"
              }
            />{" "}
            Hồ sơ cá nhân
          </button>
        </div>

        <div className="p-4 border-t border-gray-100 bg-gray-50/50">
          <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 flex flex-col items-center relative overflow-hidden group">
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-purple-500/5 pointer-events-none" />
            <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-bold text-lg mb-3 shadow-inner ring-4 ring-white z-10">
              {currentUser?.username?.charAt(0).toUpperCase() || "U"}
            </div>
            <p className="text-sm font-bold text-gray-900 truncate w-full text-center z-10">
              {currentUser?.username || "User"}
            </p>
            <p className="text-xs text-gray-500 mb-4 font-medium z-10">
              Tài khoản cá nhân
            </p>
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 text-sm text-red-600 hover:text-red-700 hover:bg-red-50 py-2.5 px-4 rounded-lg w-full justify-center transition-colors font-medium border border-transparent hover:border-red-100 z-10"
            >
              <LogOut size={16} /> Đăng xuất
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden bg-white/50 relative">
        <header className="h-16 bg-white/80 backdrop-blur-md border-b border-gray-200 flex items-center justify-between px-4 xl:px-8 shrink-0 shadow-sm z-10 sticky top-0">
          <div className="flex items-center gap-4">
            <button
              className="xl:hidden text-gray-600 hover:bg-gray-100 p-2 rounded-lg transition-colors border border-transparent hover:border-gray-200"
              onClick={() => setIsSidebarOpen(true)}
            >
              <Menu size={20} />
            </button>
            <h2 className="text-xl font-bold text-gray-800 hidden sm:flex items-center gap-2">
              {activeTab === "chat" && (
                <>
                  <Search className="text-blue-500" size={24} /> AI Trợ giảng
                </>
              )}
              {activeTab === "documents" && (
                <>
                  <FileText className="text-blue-500" size={24} /> Quản lý Tài
                  liệu Của Bạn
                </>
              )}
              {activeTab === "generate" && (
                <>
                  <Sparkles className="text-blue-500" size={24} /> Tạo bài giảng
                  (RAG)
                </>
              )}
              {activeTab === "preview" && (
                <>
                  <Eye className="text-blue-500" size={24} /> Xem tài liệu gốc
                  và Markdown
                </>
              )}
              {activeTab === "profile" && (
                <>
                  <User className="text-blue-500" size={24} /> Quản lý Hồ sơ
                </>
              )}
            </h2>
          </div>
        </header>

        <main className="flex-1 min-h-0 overflow-hidden relative">
          {/* BACKGROUND BLOB DECORATION */}
          <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-400/5 rounded-full blur-[100px] pointer-events-none" />
          <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-400/5 rounded-full blur-[100px] pointer-events-none" />

          <div className="h-full relative z-10 overflow-y-auto">
            {activeTab === "profile" && (
              <div className="p-4 xl:p-8 h-full flex flex-col">
                <ProfileManagement />
              </div>
            )}
            {activeTab === "generate" && <TeachingMaterialList />}
            {activeTab === "chat" && (
              <div className="h-full min-h-0 flex flex-col max-w-5xl mx-auto p-4 pt-6 xl:p-8 xl:pt-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="mb-4 mt-4 grid grid-cols-1 md:grid-cols-3 gap-3 shrink-0 relative z-30">
                  <select
                    value={activeConversationId}
                    onChange={(e) => setActiveConversationId(e.target.value)}
                    className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white"
                  >
                    <option value="">Chọn cuộc hội thoại</option>
                    {conversations.map((conv) => (
                      <option key={conv.id} value={conv.id}>
                        {conv.title}
                      </option>
                    ))}
                  </select>

                  <div className="relative">
                    <button 
                      onClick={() => setShowDocDropdown(!showDocDropdown)}
                      className="flex flex-wrap items-center gap-2 p-2 border border-gray-200 rounded-xl bg-white min-h-[42px] max-w-md overflow-hidden text-left hover:border-blue-400 transition-colors"
                    >
                      {selectedDocIds.length === 0 ? (
                        <span className="text-gray-400 text-sm p-1 flex items-center gap-2">
                          <Plus size={16} /> Chọn tài liệu...
                        </span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {selectedDocIds.map(id => {
                            const doc = documents.find(d => String(d.id) === id);
                            return (
                              <div key={id} className="flex items-center gap-1 bg-blue-100 text-blue-700 px-2 py-0.5 rounded-lg text-[10px] font-medium">
                                <span className="truncate max-w-[80px]">{doc?.original_filename || id}</span>
                                <span onClick={(e) => { e.stopPropagation(); setSelectedDocIds(prev => prev.filter(i => i !== id)); }} className="hover:text-blue-900 cursor-pointer">
                                  <X size={10} />
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                      <div className="ml-auto text-gray-400 pr-1">
                        <ChevronDown size={16} className={`transition-transform ${showDocDropdown ? "rotate-180" : ""}`} />
                      </div>
                    </button>

                    {showDocDropdown && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setShowDocDropdown(false)}></div>
                        <div className="absolute bottom-full left-0 w-full mb-1 bg-white border border-gray-200 rounded-xl shadow-2xl z-50 max-h-60 overflow-y-auto animate-in slide-in-from-bottom-2">
                          <div className="p-2 border-b border-gray-50 bg-gray-50/50 flex justify-between items-center">
                            <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider px-2">Tài liệu của bạn ({documents.length})</span>
                            <button onClick={() => setSelectedDocIds([])} className="text-[10px] text-blue-600 hover:underline px-2">Xóa tất cả</button>
                          </div>
                          {documents.map((doc) => (
                            <div 
                              key={doc.id} 
                              onClick={() => {
                                const id = String(doc.id);
                                setSelectedDocIds(prev => 
                                  prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
                                );
                              }}
                              className={`px-4 py-2 text-sm cursor-pointer hover:bg-blue-50 flex items-center justify-between transition-colors ${selectedDocIds.includes(String(doc.id)) ? "text-blue-700 font-medium bg-blue-50/50" : "text-gray-700"}`}
                            >
                              <span className="truncate flex-1">{doc.original_filename}</span>
                              {selectedDocIds.includes(String(doc.id)) ? (
                                <div className="bg-blue-600 text-white rounded-full p-0.5">
                                  <Check size={12} />
                                </div>
                              ) : (
                                <div className="border border-gray-200 rounded-md w-4 h-4"></div>
                              )}
                            </div>
                          ))}
                          {documents.length === 0 && (
                            <div className="p-4 text-center text-gray-400 text-sm italic">
                              Chưa có tài liệu nào
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={handleCreateConversation}
                      className="flex-1 border border-blue-200 text-blue-700 bg-blue-50 rounded-xl px-3 py-2 text-sm font-medium hover:bg-blue-100"
                    >
                      Cuộc hội thoại mới
                    </button>
                    <button
                      onClick={handleDeleteConversation}
                      disabled={!activeConversationId}
                      className="border border-red-200 text-red-700 bg-red-50 rounded-xl px-3 py-2 text-sm font-medium hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Xóa
                    </button>
                  </div>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto pr-2 pb-4 space-y-6 custom-scrollbar rounded-2xl bg-white shadow-sm border border-gray-100 p-6 flex flex-col">
                  {chatHistory.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-gray-400 space-y-6 opacity-70">
                      <div className="w-24 h-24 bg-blue-50 rounded-3xl flex items-center justify-center rotate-12 shadow-sm border border-blue-100/50">
                        <Sparkles
                          size={48}
                          className="text-blue-400 -rotate-12"
                        />
                      </div>
                      <div className="text-center">
                        <p className="text-xl font-bold text-gray-700 mb-2">
                          Chưa có cuộc hội thoại nào
                        </p>
                        <p className="text-sm font-medium">
                          Bắt đầu nhập câu hỏi bên dưới để RAG Assistant hỗ trợ
                          bạn!
                        </p>
                      </div>
                    </div>
                  ) : (
                    chatHistory.map((msg, i) => (
                      <div key={i} className="space-y-6">
                        {/* User Message */}
                        <div className="flex justify-end group">
                          <div className="bg-blue-600 text-white max-w-[85%] rounded-2xl rounded-tr-sm p-5 shadow-sm transform transition-transform origin-bottom-right hover:scale-[1.01]">
                            <p className="text-sm leading-relaxed whitespace-pre-wrap font-medium">
                              {msg.question}
                            </p>
                          </div>
                          <div className="w-8 flex-shrink-0 ml-3 hidden sm:flex items-end pb-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <User size={16} className="text-gray-400" />
                          </div>
                        </div>
                        {/* AI Response */}
                        <div className="flex justify-start items-start gap-4">
                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center flex-shrink-0 shadow-md">
                            <Sparkles size={14} className="text-white" />
                          </div>
                          <div className="bg-gray-50 border border-gray-100 text-gray-800 max-w-[85%] rounded-2xl rounded-tl-sm p-6 shadow-sm prose prose-sm sm:prose-base prose-blue max-w-none hover:shadow-md transition-shadow">
                            {msg.answer ? (
                              <div className="markdown-content">
                                <ReactMarkdown>
                                  {msg.answer}
                                </ReactMarkdown>
                                
                                {msg.metadata?.sources && msg.metadata.sources.length > 0 && (
                                  <div className="mt-6 pt-4 border-t border-gray-200">
                                    <div className="flex items-center gap-2 mb-3">
                                      <BookOpen size={14} className="text-blue-500" />
                                      <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">Nguồn tham khảo</span>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                      {msg.metadata.sources.map((src: any, sIdx: number) => (
                                        <div 
                                          key={sIdx} 
                                          className="group/source relative bg-white border border-gray-200 rounded-lg px-3 py-1.5 flex items-center gap-2 hover:border-blue-300 hover:shadow-sm transition-all cursor-help"
                                          title={src.snippet}
                                        >
                                          <div className="w-5 h-5 rounded bg-blue-50 flex items-center justify-center text-[10px] font-bold text-blue-600 border border-blue-100">
                                            {sIdx + 1}
                                          </div>
                                          <div className="flex flex-col">
                                            <span className="text-[11px] font-semibold text-gray-700 truncate max-w-[150px]">
                                              {src.title || src.source}
                                            </span>
                                            {src.page_number && src.page_number > 0 && (
                                              <span className="text-[9px] text-gray-400">Trang {src.page_number}</span>
                                            )}
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div className="flex space-x-1.5 items-center h-6">
                                <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                                <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                                <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce"></div>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {/* Input Area */}
                <div className="mt-6 bg-white border border-gray-200 rounded-2xl shadow-sm focus-within:shadow-md focus-within:border-blue-300 transition-all duration-300 p-2 pl-4 flex items-end relative overflow-hidden">
                  <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-400 via-indigo-400 to-purple-400 opacity-20" />
                  <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleSendMessage();
                      }
                    }}
                    placeholder="Nhập câu hỏi của bạn về tài liệu... (Shift+Enter để xuống dòng)"
                    className="w-full max-h-32 min-h-[44px] bg-transparent outline-none resize-none py-3 text-gray-700 text-sm font-medium placeholder:font-normal placeholder-gray-400"
                    rows={1}
                    disabled={streaming}
                  />
                  <div className="flex flex-shrink-0 ml-2 py-2 pr-1">
                    <button
                      onClick={handleSendMessage}
                      disabled={streaming || !message.trim()}
                      className={`p-3 rounded-xl flex items-center justify-center transition-all duration-300 ${
                        message.trim() && !streaming
                          ? "bg-blue-600 text-white shadow-md shadow-blue-200 hover:bg-blue-700 hover:-translate-y-0.5 active:translate-y-0"
                          : "bg-gray-100 text-gray-400 cursor-not-allowed"
                      }`}
                    >
                      {streaming ? (
                        <StopCircle size={20} className="animate-pulse" />
                      ) : (
                        <Send size={20} />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "documents" && (
              <div className="h-full overflow-y-auto p-4 xl:p-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="max-w-6xl mx-auto space-y-6">
                  {/* Upload Card */}
                  <div className="bg-white rounded-3xl p-8 border border-dashed border-gray-200 shadow-sm flex flex-col items-center justify-center text-center hover:border-blue-300 hover:bg-blue-50/30 transition-all duration-300 group">
                    <div className="w-20 h-20 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mb-6 shadow-sm shadow-blue-200 group-hover:scale-110 transition-transform duration-300">
                      <Upload size={32} />
                    </div>
                    <h3 className="text-xl font-bold text-gray-800 mb-2">
                      Tải tài liệu mới lên RAG
                    </h3>
                    <p className="text-sm text-gray-500 max-w-md mx-auto mb-8 font-medium">
                      Hỗ trợ các định dạng file PDF, DOCX, TXT, MD.Hỗ trợ OCR
                      với các file chứa ảnh Scan. Hệ thống sẽ tự động phân mảnh
                      (chunking) và nhúng (embedding) để AI có thể đọc hiểu.
                    </p>

                    {/* <div className="w-full max-w-sm mb-5 text-left">
                      <label className="block text-xs font-semibold text-gray-600 mb-2">
                        OCR cho PDF dạng ảnh/scan
                      </label>
                      <select
                        value={uploadOcrMode}
                        onChange={(e) =>
                          setUploadOcrMode(
                            e.target.value as "auto" | "on" | "off",
                          )
                        }
                        className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-700 bg-white"
                        disabled={uploading}
                      >
                        <option value="auto">Tự động (khuyên dùng)</option>
                        <option value="on">
                          Luôn bật OCR (chất lượng cao, chậm hơn)
                        </option>
                        <option value="off">
                          Tắt OCR (nhanh hơn, không đọc được chữ trong ảnh)
                        </option>
                      </select>
                    </div> */}

                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleFileUpload}
                      className="hidden"
                      accept=".pdf,.doc,.docx,.txt,.md"
                    />
                    <button
                      onClick={() =>
                        !uploading && fileInputRef.current?.click()
                      }
                      disabled={uploading}
                      className="px-8 py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition-colors shadow-md shadow-blue-200 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {uploading ? (
                        <>
                          <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />{" "}
                          Đang xử lý...
                        </>
                      ) : (
                        "Chọn Tệp Tin"
                      )}
                    </button>
                  </div>

                  {/* Document List */}
                  <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                    <div className="p-6 border-b border-gray-100 bg-gray-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <Filter size={20} className="text-gray-400" />
                        <h3 className="font-bold text-lg text-gray-900">
                          Danh sách tài liệu đã tải lên
                        </h3>
                      </div>
                      <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-bold leading-none flex items-center">
                        {documents.length} Tệp
                      </span>
                    </div>

                    <div className="divide-y divide-gray-100">
                      {docLoading ? (
                        <div className="p-6 space-y-4">
                          {[1, 2, 3].map((i) => (
                            <div key={i} className="flex items-center gap-4 animate-pulse">
                              <div className="w-12 h-12 bg-gray-200 rounded-xl flex-shrink-0"></div>
                              <div className="flex-1 space-y-3">
                                <div className="h-4 bg-gray-200 rounded w-1/3"></div>
                                <div className="flex gap-3">
                                  <div className="h-3 bg-gray-200 rounded w-20"></div>
                                  <div className="h-3 bg-gray-200 rounded w-32"></div>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : docError ? (
                        <div className="py-12 text-center text-red-500 font-medium">
                          {docError}
                        </div>
                      ) : documents.length === 0 ? (
                        <div className="py-16 px-4 flex flex-col items-center justify-center text-center">
                          <div className="w-20 h-20 bg-blue-50 text-blue-300 rounded-full flex items-center justify-center mb-4 border border-blue-100/50 shadow-sm">
                            <FileText size={40} />
                          </div>
                          <h4 className="text-lg font-bold text-gray-800 mb-2">Chưa có tài liệu nào</h4>
                          <p className="text-gray-500 text-sm max-w-sm mb-6">Bạn cần tải lên tài liệu (PDF, Word, TXT, Markdown) để bắt đầu trò chuyện với AI và tạo bài giảng tự động.</p>
                          <button 
                            onClick={() => !uploading && fileInputRef.current?.click()}
                            className="px-6 py-2.5 bg-blue-50 text-blue-600 font-semibold rounded-xl hover:bg-blue-100 transition-colors border border-blue-200"
                          >
                            Tải tài liệu lên ngay
                          </button>
                        </div>
                      ) : (
                        documents.map((doc) => (
                          <div
                            key={doc.id}
                            className="p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-gray-50/80 transition-colors group"
                          >
                            <div className="flex items-start gap-4">
                              <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl mt-1">
                                <FileText size={24} />
                              </div>
                              <div>
                                <h4 className="font-bold text-gray-900 text-base">
                                  {doc.original_filename}
                                </h4>
                                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-2 text-xs font-medium text-gray-500">
                                  <span className="flex items-center gap-1.5">
                                    <CheckCircle
                                      size={14}
                                      className="text-green-500"
                                    />{" "}
                                    Sẵn sàng cho RAG
                                  </span>
                                  <span className="flex items-center gap-1.5 px-2 py-0.5 bg-gray-100 rounded-md">
                                    ID:{" "}
                                    <span
                                      className="font-mono text-gray-600 truncate max-w-[120px]"
                                      title={doc.id}
                                    >
                                      {doc.id}
                                    </span>
                                  </span>
                                  <span className="flex items-center gap-1.5">
                                    <AlertTriangle size={14} />{" "}
                                    {doc.chunks_count} chunks
                                  </span>
                                </div>
                              </div>
                            </div>
                            <div className="self-end sm:self-auto flex items-center gap-2 sm:opacity-0 sm:-translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all">
                              <button
                                onClick={() => handleOpenPreview(doc.id)}
                                className="p-2.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-colors group-hover:shadow-sm"
                                title="Xem preview tài liệu"
                              >
                                <Eye size={20} />
                              </button>
                              <button
                                onClick={() => handleDeleteDoc(doc.id)}
                                className="p-2.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-colors group-hover:shadow-sm"
                                title="Xóa tài liệu khỏi kho"
                              >
                                <Trash2 size={20} />
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "preview" && (
              <div className="h-full overflow-y-auto p-4 xl:p-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="max-w-6xl mx-auto space-y-6">
                  <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 sm:p-6">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 justify-between">
                      <div>
                        <h3 className="text-lg font-bold text-gray-900">
                          Preview tài liệu
                        </h3>
                        <p className="text-sm text-gray-500">
                          Chọn tài liệu để xem file gốc và nội dung Markdown.
                        </p>
                      </div>
                      <select
                        value={previewDocumentId || ""}
                        onChange={(e) => {
                          const id = e.target.value;
                          if (id) handleOpenPreview(id);
                        }}
                        className="w-full sm:w-80 border border-gray-200 rounded-lg px-3 py-2 text-sm"
                      >
                        <option value="">-- Chọn tài liệu --</option>
                        {documents.map((doc) => (
                          <option key={doc.id} value={doc.id}>
                            {doc.original_filename}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {previewLoading ? (
                    <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center text-gray-500">
                      Đang tải preview tài liệu...
                    </div>
                  ) : previewError ? (
                    <div className="bg-white rounded-2xl border border-red-100 p-8 text-center text-red-500">
                      {previewError}
                    </div>
                  ) : !previewDetail ? (
                    <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center text-gray-500">
                      Chưa có tài liệu nào được chọn để preview.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                        <div className="flex items-center justify-between mb-3">
                          <h4 className="font-bold text-gray-800">File gốc</h4>
                          <button
                            onClick={handleDownloadOriginal}
                            className="text-sm px-3 py-1.5 rounded-lg bg-gray-200 hover:bg-gray-300 text-gray-800 flex items-center gap-1"
                          >
                            <Download size={14} /> Tải file gốc
                          </button>
                        </div>

                        {previewBlobUrl && previewBlobType.includes("pdf") ? (
                          <iframe
                            src={previewBlobUrl}
                            title="Original document preview"
                            className="w-full h-[70vh] border border-gray-200 rounded-lg"
                          />
                        ) : (
                          <div className="h-[70vh] border border-gray-200 rounded-lg flex items-center justify-center text-sm text-gray-500 text-center px-6">
                            Định dạng file này không hỗ trợ xem trực tiếp trên
                            trình duyệt. Hãy dùng nút "Tải file gốc" để mở tài
                            liệu.
                          </div>
                        )}
                      </div>

                      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                          <h4 className="font-bold text-gray-800">
                            File Markdown đã chuyển đổi
                          </h4>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={handleCopyMarkdown}
                              className="text-sm px-3 py-1.5 rounded-lg bg-blue-100 hover:bg-blue-200 text-blue-700 flex items-center gap-1"
                            >
                              <Copy size={14} /> Copy MD
                            </button>
                            <button
                              onClick={handleDownloadMarkdown}
                              className="text-sm px-3 py-1.5 rounded-lg bg-gray-200 hover:bg-gray-300 text-gray-800 flex items-center gap-1"
                            >
                              <Download size={14} /> Tải MD
                            </button>
                          </div>
                        </div>

                        <pre className="w-full h-[70vh] overflow-auto custom-scrollbar border border-gray-200 rounded-lg p-4 text-xs sm:text-sm leading-relaxed text-gray-700 bg-gray-50 whitespace-pre-wrap">
                          {previewDetail.markdown ||
                            "Không có nội dung markdown."}
                        </pre>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
