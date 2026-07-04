import Sidebar from "../components/Sidebar";
import React, { useState, useEffect, useRef, Suspense, lazy } from "react";
import MarkdownViewer from "../components/MarkdownViewer";

const TeachingMaterialList = lazy(() => import("./TeachingMaterialList"));
const ProfileManagement = lazy(() => import("../components/ProfileManagement"));
const ChatPanel = lazy(() => import("../components/ChatPanel"));
const DocumentManager = lazy(() => import("../components/DocumentManager"));
import { useSearchParams } from "react-router-dom";
import {
  Search,
  FileText,
  User,
  Menu,
  Sparkles,
  Eye,
  Copy,
  Download,
} from "lucide-react";
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
  getSecureDocumentReferences,
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
  const [currentUser, setCurrentUser] = useState(getStoredAuthUser());

  useEffect(() => {
    const handleAuthUpdate = () => {
      setCurrentUser(getStoredAuthUser());
    };
    window.addEventListener("auth-update", handleAuthUpdate);
    return () => window.removeEventListener("auth-update", handleAuthUpdate);
  }, []);

  const storagePrefix = `${STORAGE_KEY_DASHBOARD}_${currentUser?.user_id ?? "anon"}`;

  const [activeTab, setActiveTab] = useState<DashboardTab>(() => {
    const isJustLoggedIn = sessionStorage.getItem("just_logged_in") === "true";
    if (isJustLoggedIn) {
      sessionStorage.removeItem("just_logged_in");
      return "chat";
    }
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
  const [docsLoadedAtLeastOnce, setDocsLoadedAtLeastOnce] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStage, setUploadStage] = useState<"uploading" | "processing">("uploading");
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
    if (messagesEndRef.current) {
      const parent = messagesEndRef.current.parentElement;
      if (parent) {
        parent.scrollTo({
          top: parent.scrollHeight,
          behavior: "smooth"
        });
      }
    }
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
      setDocsLoadedAtLeastOnce(true);
    } catch (e: any) {
      setDocError(
        e?.message ||
          "Không tải được danh sách tài liệu. Vui lòng kiểm tra kết nối API.",
      );
    } finally {
      setDocLoading(false);
    }
  };

  useEffect(() => {
    if (!docsLoadedAtLeastOnce) return;
    if (documents.length > 0) {
      const validIds = selectedDocIds.filter(id => documents.some(d => String(d.id) === id));
      if (validIds.length !== selectedDocIds.length) {
        setSelectedDocIds(validIds);
      }
    } else if (selectedDocIds.length > 0) {
      setSelectedDocIds([]);
    }
  }, [documents, selectedDocIds, docsLoadedAtLeastOnce]);

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
          pendingUser.metadata = msg.metadata || null;
          pairs.push(pendingUser);
          pendingUser = null;
        } else {
          pairs.push({
            question: "",
            answer: msg.content || "",
            metadata: msg.metadata || null,
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
      
      const conv = conversations.find(c => c.id === activeConversationId);
      if (conv) {
        if (conv.document_ids && conv.document_ids.length > 0) {
          setSelectedDocIds(conv.document_ids);
        } else if (conv.document_id) {
          setSelectedDocIds([conv.document_id]);
        }
      }

      try {
        const messages = await getChatMessages(activeConversationId);
        setChatHistory(toChatPairs(messages));
      } catch (e: any) {
        console.error(e?.message || "Load messages failed");
      }
    };

    loadActiveMessages();
  }, [activeConversationId, conversations]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;
    const file = e.target.files[0];
    setUploading(true);
    setUploadProgress(0);
    setUploadStage("uploading");
    try {
      const res = await secureUploadDocument(
        file, 
        { ocrMode: uploadOcrMode },
        (progressEvent) => {
          const percentCompleted = Math.round((progressEvent.loaded * 100) / (progressEvent.total || 1));
          setUploadProgress(Math.min(99, percentCompleted));
        }
      );

      if (res && res.document_id) {
        setUploadStage("processing");
        setUploadProgress(0);
        
        let isDone = false;
        let attempts = 0;
        const maxAttempts = 600; // 10 minutes timeout
        
        while (!isDone && attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          attempts++;
          
          const docs = await listSecureDocuments();
          setDocuments(docs);
          
          const currentDoc = docs.find(d => String(d.id) === String(res.document_id));
          if (currentDoc) {
            if (currentDoc.status === "ready") {
              isDone = true;
              setUploadProgress(100);
              toastService.success(`Tải tài liệu "${file.name}" lên và xử lý thành công.`);
            } else if (currentDoc.status === "failed") {
              isDone = true;
              throw new Error(currentDoc.processing_error || "Xử lý tài liệu thất bại.");
            } else {
              setUploadProgress(currentDoc.processing_progress || 0);
            }
          }
        }
        
        if (!isDone) {
          throw new Error("Quá thời gian xử lý tài liệu.");
        }
      } else {
        toastService.success(`Tải tài liệu "${file.name}" lên và xử lý thành công.`);
        await loadDocuments();
      }
    } catch (err: any) {
      const msg = err?.message || "Tải lên tài liệu thất bại!";
      console.error(msg);
      toastService.error(msg);
      await loadDocuments();
    } finally {
      setUploading(false);
      setUploadProgress(0);
      setUploadStage("uploading");
    }
  };

  const handleDeleteDoc = async (id: string) => {
    const doc = documents.find(d => String(d.id) === String(id));
    const filename = doc ? doc.original_filename : "tài liệu này";
    try {
      let confirmMsg = `Bạn có chắc muốn xóa tài liệu "${filename}"?`;
      try {
        const refRes = await getSecureDocumentReferences(id);
        if (refRes.success && refRes.projects && refRes.projects.length > 0) {
          confirmMsg = `Tài liệu "${filename}" đang được sử dụng trong các bài giảng sau:\n` +
            refRes.projects.map((p: string) => `• ${p}`).join("\n") +
            `\n\nNếu xóa, các bài giảng này sẽ không thể tự động sinh nội dung từ tài liệu này nữa. Bạn vẫn muốn tiếp tục xóa chứ?`;
        } else {
          confirmMsg = `Bạn có chắc muốn xóa tài liệu "${filename}" khỏi kho lưu trữ RAG?`;
        }
      } catch (e) {
        console.error("Lấy danh sách dự án tham chiếu thất bại:", e);
        confirmMsg = `Bạn có chắc muốn xóa tài liệu "${filename}" khỏi kho lưu trữ RAG?`;
      }

      if (!window.confirm(confirmMsg)) return;

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

  const handleSendMessage = async (text?: string) => {
    const currentMsg = typeof text === "string" ? text : message;
    if (!currentMsg.trim() || streaming) return;
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
        },
        () => {
          // onRetry callback
          fullAnswer = "";
          setChatHistory((prev) => {
            const up = [...prev];
            up[up.length - 1].answer = "";
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
      <Sidebar
        isSidebarOpen={isSidebarOpen}
        setIsSidebarOpen={setIsSidebarOpen}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        currentUser={currentUser}
        handleLogout={handleLogout}
      />

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden bg-white/50 relative">
        <header className="h-16 bg-white/80 backdrop-blur-md border-b border-gray-200 flex items-center justify-between px-4 xl:px-8 shrink-0 shadow-sm z-20 relative">
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

          <div className={`h-full relative z-30 ${['chat', 'generate', 'preview'].includes(activeTab) ? 'overflow-hidden flex flex-col' : 'overflow-y-auto'}`}>
            <Suspense fallback={
              <div className="h-full flex items-center justify-center">
                <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div>
              </div>
            }>
              {activeTab === "profile" && (
                <div className="p-4 xl:p-8 h-full flex flex-col">
                  <ProfileManagement />
                </div>
              )}
              {activeTab === "generate" && <TeachingMaterialList />}
              {activeTab === "chat" && (
                <ChatPanel
                  activeConversationId={activeConversationId}
                  setActiveConversationId={setActiveConversationId}
                  conversations={conversations}
                  handleCreateConversation={handleCreateConversation}
                  handleDeleteConversation={handleDeleteConversation}
                  showDocDropdown={showDocDropdown}
                  setShowDocDropdown={setShowDocDropdown}
                  selectedDocIds={selectedDocIds}
                  setSelectedDocIds={setSelectedDocIds}
                  documents={documents}
                  chatHistory={chatHistory}
                  messagesEndRef={messagesEndRef}
                  message={message}
                  setMessage={setMessage}
                  handleSendMessage={handleSendMessage}
                  streaming={streaming}
                />
              )}

              {activeTab === "documents" && (
                <DocumentManager
                  documents={documents}
                  docLoading={docLoading}
                  docError={docError}
                  uploading={uploading}
                  uploadProgress={uploadProgress}
                  uploadStage={uploadStage}
                  fileInputRef={fileInputRef}
                  handleFileUpload={handleFileUpload}
                  handleDeleteDoc={handleDeleteDoc}
                  handleOpenPreview={handleOpenPreview}
                />
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
                      <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center text-gray-500 flex flex-col items-center justify-center space-y-4">
                        <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div>
                        <p>Đang tải preview tài liệu...</p>
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
                          ) : previewDetail?.markdown ? (
                            <div className="w-full h-[70vh] border border-slate-200 rounded-lg overflow-y-auto p-8 bg-white shadow-inner custom-scrollbar">
                              <MarkdownViewer content={previewDetail.markdown} className="bg-transparent !p-0 !border-0" />
                            </div>
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

                          <div className="w-full h-[70vh] border border-gray-200 rounded-lg overflow-y-auto p-4 custom-scrollbar bg-gray-50">
                            <pre className="text-sm whitespace-pre-wrap font-mono text-gray-700">
                              {previewDetail?.markdown ||
                                "Tài liệu này không có nội dung văn bản (hoặc quá trình trích xuất thất bại)."}
                            </pre>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </Suspense>
          </div>
        </main>
      </div>
    </div>
  );
}
