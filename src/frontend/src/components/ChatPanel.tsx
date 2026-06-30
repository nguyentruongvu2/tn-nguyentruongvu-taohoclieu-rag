import React from 'react';
import { Plus, X, ChevronDown, Check, User, Sparkles, BookOpen, Send, StopCircle } from 'lucide-react';
import MarkdownViewer from './MarkdownViewer';

const formatMessageCitations = (content: string, sources?: any[]) => {
  if (!sources || sources.length === 0) return content;
  return content.replace(/\[Source\s*(\d+)\]/gi, (match, p1) => {
    const idx = parseInt(p1, 10);
    const src = sources[idx - 1];
    if (src) {
      const filename = src.title || src.source || "";
      const displayName = filename.length > 25 ? filename.slice(0, 22) + "..." : filename;
      const pageInfo = src.page_number && src.page_number > 0 ? `, Tr. ${src.page_number}` : "";
      return `[[${idx}] ${displayName}${pageInfo}](ref-${idx})`;
    }
    return match;
  });
};

export interface ChatPanelProps {
  activeConversationId: string;
  setActiveConversationId: (id: string) => void;
  conversations: any[];
  handleCreateConversation: () => void;
  handleDeleteConversation: () => void;
  
  showDocDropdown: boolean;
  setShowDocDropdown: (show: boolean) => void;
  selectedDocIds: string[];
  setSelectedDocIds: React.Dispatch<React.SetStateAction<string[]>>;
  documents: any[];
  
  chatHistory: any[];
  messagesEndRef: React.RefObject<HTMLDivElement>;
  
  message: string;
  setMessage: (msg: string) => void;
  handleSendMessage: (text?: string) => void;
  streaming: boolean;
}

export default function ChatPanel({
  activeConversationId,
  setActiveConversationId,
  conversations,
  handleCreateConversation,
  handleDeleteConversation,
  showDocDropdown,
  setShowDocDropdown,
  selectedDocIds,
  setSelectedDocIds,
  documents,
  chatHistory,
  messagesEndRef,
  message,
  setMessage,
  handleSendMessage,
  streaming
}: ChatPanelProps) {
  return (
    <div className="h-full min-h-0 flex flex-col max-w-6xl mx-auto p-4 pt-2 xl:p-8 xl:pt-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="mb-4 mt-1 grid grid-cols-1 md:grid-cols-3 gap-3 shrink-0 relative z-30">
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
            className="flex flex-wrap items-center gap-2 p-2 border border-gray-200 rounded-xl bg-white min-h-[42px] max-w-md overflow-hidden text-left hover:border-blue-400 transition-colors w-full"
          >
            {selectedDocIds.length === 0 ? (
              <span className="text-gray-400 text-sm p-1 flex items-center gap-2">
                <Plus size={16} /> Chọn tài liệu...
              </span>
            ) : (
              <div className="flex flex-wrap gap-1">
                {selectedDocIds.slice(0, 2).map(id => {
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
                {selectedDocIds.length > 2 && (
                  <div className="flex items-center bg-gray-100 text-gray-600 px-2 py-0.5 rounded-lg text-[10px] font-medium">
                    +{selectedDocIds.length - 2} tài liệu
                  </div>
                )}
              </div>
            )}
            <div className="ml-auto text-gray-400 pr-1">
              <ChevronDown size={16} className={`transition-transform ${showDocDropdown ? "rotate-180" : ""}`} />
            </div>
          </button>

          {showDocDropdown && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowDocDropdown(false)}></div>
              <div className="absolute top-full left-0 w-full mt-1 bg-white border border-gray-200 rounded-xl shadow-2xl z-50 max-h-60 overflow-y-auto animate-in slide-in-from-top-2">
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

      <div className="flex-1 min-h-0 overflow-y-auto pr-2 pb-4 space-y-6 custom-scrollbar rounded-2xl bg-white shadow-sm border border-gray-100 p-6 flex flex-col justify-between">
        {chatHistory.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center max-w-2xl mx-auto space-y-8 py-6">
            <div className="text-center space-y-3">
              <div className="inline-flex p-3.5 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-3xl text-white shadow-lg shadow-blue-100 animate-pulse mb-2">
                <Sparkles size={32} />
              </div>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-950 tracking-tight bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-600">
                Trợ giảng RAG AI
              </h2>
              <p className="text-sm text-gray-500 font-medium max-w-md mx-auto">
                Hỏi đáp thông minh, phân tích tài liệu bài giảng và hỗ trợ soạn thảo nhanh chóng. Hãy chọn tài liệu và bắt đầu!
              </p>
            </div>

            {/* Quy trình hướng dẫn soạn bài giảng thông minh */}
            <div className="w-full bg-gradient-to-br from-slate-50 to-blue-50/20 rounded-2xl p-5 border border-gray-150 shadow-sm space-y-4">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-blue-500/10 text-blue-600 rounded-lg">
                  <BookOpen size={18} className="text-blue-600" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-gray-900">
                    📚 Quy trình soạn bài giảng thông minh hiệu quả
                  </h3>
                  <p className="text-[11px] text-gray-500">
                    Phối hợp các tính năng của hệ thống RAG để tối ưu công việc giảng dạy
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                {/* Bước 1 */}
                <div className="bg-white border border-gray-100 rounded-xl p-3.5 space-y-1.5 shadow-sm hover:border-blue-200 transition-all">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-blue-600 text-[10px] px-1.5 py-0.5 bg-blue-50 rounded-full">Bước 1</span>
                    <span className="text-sm">📂</span>
                  </div>
                  <h4 className="font-bold text-gray-900 text-xs">Quản lý Tài liệu</h4>
                  <p className="text-gray-500 text-[11px] leading-normal font-normal">
                    Tải lên tài liệu tham khảo (PDF, DOCX, TXT...). Hệ thống sẽ trích xuất nội dung tự động.
                  </p>
                </div>

                {/* Bước 2 */}
                <div className="bg-white border border-gray-100 rounded-xl p-3.5 space-y-1.5 shadow-sm hover:border-blue-200 transition-all">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-blue-600 text-[10px] px-1.5 py-0.5 bg-blue-50 rounded-full">Bước 2</span>
                    <span className="text-sm">💬</span>
                  </div>
                  <h4 className="font-bold text-gray-900 text-xs">AI Trợ giảng</h4>
                  <p className="text-gray-500 text-[11px] leading-normal font-normal">
                    Chọn tài liệu vừa tải ở thanh công cụ phía trên và hỏi AI để tóm tắt, giải thích khái niệm.
                  </p>
                </div>

                {/* Bước 3 */}
                <div className="bg-white border border-gray-100 rounded-xl p-3.5 space-y-1.5 shadow-sm hover:border-blue-200 transition-all">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-blue-600 text-[10px] px-1.5 py-0.5 bg-blue-50 rounded-full">Bước 3</span>
                    <span className="text-sm">📝</span>
                  </div>
                  <h4 className="font-bold text-gray-900 text-xs">Tạo bài giảng (RAG)</h4>
                  <p className="text-gray-500 text-[11px] leading-normal font-normal">
                    Sử dụng các tài liệu đã tải để AI lập đề cương và sinh nội dung bài giảng hoàn chỉnh tự động.
                  </p>
                </div>

                {/* Bước 4 */}
                <div className="bg-white border border-gray-100 rounded-xl p-3.5 space-y-1.5 shadow-sm hover:border-blue-200 transition-all">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-blue-600 text-[10px] px-1.5 py-0.5 bg-blue-50 rounded-full">Bước 4</span>
                    <span className="text-sm">🧠</span>
                  </div>
                  <h4 className="font-bold text-gray-900 text-xs">Tạo Quiz trắc nghiệm</h4>
                  <p className="text-gray-500 text-[11px] leading-normal font-normal">
                    Trong trình soạn thảo bài giảng, nhấp chọn <span className="font-semibold text-blue-600">Tạo Quiz</span> để kiểm tra kiến thức và xuất ngân hàng câu hỏi.
                  </p>
                </div>
              </div>

              <div className="bg-blue-50/50 rounded-xl p-3 border border-blue-100/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                <div className="space-y-0.5">
                  <span className="font-bold text-blue-800 text-[10px] uppercase tracking-wider block">💡 Câu lệnh hướng dẫn hiệu quả:</span>
                  <p className="text-gray-600 italic">
                    "Hướng dẫn tôi các bước sử dụng hệ thống RAG để soạn bài giảng và tạo quiz hiệu quả."
                  </p>
                </div>
                <button
                  onClick={() => handleSendMessage("Hướng dẫn tôi các bước sử dụng hệ thống RAG để soạn bài giảng và tạo quiz hiệu quả.")}
                  className="shrink-0 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-4 py-2 rounded-xl transition-all shadow-sm shadow-blue-200 text-xs cursor-pointer"
                >
                  Thử ngay ⚡
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full">
              {[
                {
                  title: "📝 Tóm tắt tài liệu",
                  desc: "Tóm tắt các nội dung và luận điểm cốt lõi trong tài liệu này.",
                  prompt: "Hãy tóm tắt ngắn gọn các nội dung cốt lõi và các luận điểm chính trong tài liệu này dưới dạng danh sách gạch đầu dòng."
                },
                {
                  title: "❓ Tạo câu hỏi ôn tập",
                  desc: "Tạo danh sách 5 câu hỏi ôn tập kèm lời giải gợi ý.",
                  prompt: "Hãy tạo ra 5 câu hỏi ôn tập trắc nghiệm dựa trên nội dung tài liệu này, kèm theo đáp án đúng và lời giải thích chi tiết cho từng câu."
                },
                {
                  title: "🔍 Tìm thuật ngữ khó",
                  desc: "Định nghĩa và giải thích các từ viết tắt hoặc thuật ngữ chuyên ngành.",
                  prompt: "Hãy tìm các thuật ngữ chuyên ngành, từ viết tắt hoặc khái niệm kỹ thuật xuất hiện trong tài liệu này và định nghĩa chi tiết ý nghĩa của chúng."
                },
                {
                  title: "💡 Gợi ý bài tập áp dụng",
                  desc: "Thiết kế các bài tập thực hành nhỏ để học viên áp dụng kiến thức.",
                  prompt: "Dựa vào nội dung tài liệu học tập này, hãy gợi ý 3 bài tập thực hành thực tế hoặc tình huống thảo luận giúp học viên có thể áp dụng ngay kiến thức đã học."
                }
              ].map((p, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSendMessage(p.prompt)}
                  className="bg-white border border-gray-150 rounded-2xl p-4 text-left hover:border-blue-400 hover:shadow-md hover:shadow-blue-50/50 transition-all duration-300 group relative overflow-hidden cursor-pointer"
                >
                  <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />
                  <h4 className="font-bold text-gray-900 text-sm mb-1.5 flex items-center justify-between">
                    {p.title}
                    <span className="text-xs text-blue-500 font-medium opacity-0 group-hover:opacity-100 transition-opacity group-hover:translate-x-0.5 transform duration-300">
                      Gửi →
                    </span>
                  </h4>
                  <p className="text-xs text-gray-500 leading-normal font-normal">
                    {p.desc}
                  </p>
                </button>
              ))}
            </div>
          </div>
        ) : (
          chatHistory.map((msg, i) => (
            <div key={i} className="space-y-6">
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
              <div className="flex justify-start items-start gap-4">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center flex-shrink-0 shadow-md">
                  <Sparkles size={14} className="text-white" />
                </div>
                <div className="bg-gray-50 border border-gray-100 text-gray-800 max-w-[85%] rounded-2xl rounded-tl-sm p-6 shadow-sm prose prose-sm sm:prose-base prose-blue max-w-none hover:shadow-md transition-shadow">
                  {msg.answer ? (
                    <div className="markdown-content">
                      <MarkdownViewer 
                        content={formatMessageCitations(msg.answer, msg.metadata?.sources)} 
                        className="!p-0 !border-0 bg-transparent" 
                        components={{
                          a: ({ href, children }: any) => {
                            if (href?.startsWith("ref-")) {
                              const idx = parseInt(href.substring(4), 10);
                              const handleCitationClick = () => {
                                const el = document.getElementById(`chat-ref-${i}-${idx - 1}`);
                                if (el) {
                                  const detailsEl = el.closest('details');
                                  if (detailsEl) {
                                    detailsEl.open = true;
                                  }
                                  el.scrollIntoView({ behavior: "smooth", block: "nearest" });
                                  el.classList.add("bg-yellow-100", "border-yellow-400", "scale-105");
                                  setTimeout(() => {
                                    el.classList.remove("bg-yellow-100", "border-yellow-400", "scale-105");
                                  }, 2000);
                                }
                              };
                              return (
                                <span 
                                  onClick={handleCitationClick}
                                  className="inline-flex items-center bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded px-1.5 py-0.5 text-[10px] font-semibold mx-0.5 cursor-pointer transition-colors shadow-sm"
                                  title="Nhấp để xem chi tiết nguồn tham khảo ở dưới"
                                >
                                  {children}
                                </span>
                              );
                            }
                            return (
                              <a href={href} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                                {children}
                              </a>
                            );
                          }
                        }}
                      />
                      {msg.metadata?.sources && msg.metadata.sources.length > 0 && (
                        <details className="group/details mt-4 pt-4 border-t border-gray-150" open={false}>
                          <summary className="flex items-center justify-between cursor-pointer list-none select-none text-[11px] font-bold text-gray-500 uppercase tracking-wider hover:text-blue-600 transition-colors outline-none">
                            <span className="flex items-center gap-2">
                              <BookOpen size={14} className="text-blue-500" />
                              Nguồn tham khảo ({msg.metadata.sources.length})
                            </span>
                            <ChevronDown size={14} className="transition-transform duration-200 group-open/details:rotate-180 text-gray-400" />
                          </summary>
                          <div className="flex flex-wrap gap-2 mt-3 animate-in fade-in duration-300">
                            {msg.metadata.sources.map((src: any, sIdx: number) => (
                              <div 
                                id={`chat-ref-${i}-${sIdx}`}
                                key={sIdx} 
                                className="group/source relative bg-white border border-gray-200 rounded-lg px-3 py-1.5 flex items-center gap-2 hover:border-blue-300 hover:shadow-sm transition-all cursor-help transition-all duration-300"
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
                        </details>
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

      <div className="mt-4 bg-white border border-gray-200 rounded-2xl shadow-sm focus-within:shadow-md focus-within:border-blue-300 transition-all duration-300 p-1.5 pl-4 flex items-end relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-400 via-indigo-400 to-purple-400 opacity-20" />
        <textarea
          value={message}
          rows={1}
          onChange={(e) => {
            setMessage(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = `${e.target.scrollHeight}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSendMessage();
              const target = e.target as HTMLTextAreaElement;
              target.style.height = "auto";
            }
          }}
          placeholder="Nhập câu hỏi của bạn về tài liệu... (Shift+Enter để xuống dòng)"
          className="w-full max-h-32 min-h-[40px] bg-transparent outline-none resize-none py-2 text-gray-700 text-sm font-medium placeholder:font-normal placeholder-gray-400 custom-scrollbar"
          disabled={streaming}
        />
        <div className="flex flex-shrink-0 ml-2 py-2 pr-1">
          <button
            onClick={() => handleSendMessage()}
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
  );
}
