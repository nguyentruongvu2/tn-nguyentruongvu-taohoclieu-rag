import React, { RefObject } from 'react';
import { FileText, CheckCircle, AlertTriangle, Eye, Trash2, Filter } from 'lucide-react';

export interface DocumentManagerProps {
  documents: any[];
  docLoading: boolean;
  docError: string | null;
  uploading: boolean;
  uploadProgress?: number;
  uploadStage?: 'uploading' | 'processing';
  fileInputRef: RefObject<HTMLInputElement | null>;
  handleFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleDeleteDoc: (id: string) => void;
  handleOpenPreview: (id: string) => void;
}

export default function DocumentManager({
  documents,
  docLoading,
  docError,
  uploading,
  uploadProgress = 0,
  uploadStage = 'uploading',
  fileInputRef,
  handleFileUpload,
  handleDeleteDoc,
  handleOpenPreview
}: DocumentManagerProps) {
  return (
    <div className="h-full overflow-y-auto p-4 xl:p-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 md:p-6 relative overflow-hidden">
          <div className="absolute top-[-50%] left-[-10%] w-[120%] h-[200%] bg-gradient-to-br from-blue-50 via-white to-purple-50 pointer-events-none -z-10" />
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-xl flex items-center justify-center flex-shrink-0 shadow-inner mt-0.5">
                <FileText size={24} />
              </div>
              <div className="text-left space-y-1">
                <h3 className="text-lg font-bold text-gray-800">
                  Tải tài liệu mới lên RAG
                </h3>
                <p className="text-xs text-gray-500 max-w-xl font-medium leading-relaxed">
                  Hỗ trợ định dạng PDF, DOCX, TXT, MD (bao gồm ảnh Scan OCR). 
                  Hệ thống tự động phân mảnh (chunking) và nhúng (embedding) để AI có thể đọc hiểu.
                </p>
              </div>
            </div>

            <div className="flex-shrink-0 flex flex-col items-center md:items-end justify-center min-w-[180px] w-full md:w-auto">
              <input
                type="file"
                ref={fileInputRef as RefObject<HTMLInputElement>}
                onChange={handleFileUpload}
                className="hidden"
                accept=".pdf,.doc,.docx,.txt,.md"
              />
              <button
                onClick={() => !uploading && fileInputRef.current?.click()}
                disabled={uploading}
                className="px-6 py-2.5 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition-colors shadow-md shadow-blue-200 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer w-full md:w-auto justify-center"
              >
                {uploading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />{" "}
                    {uploadStage === "uploading"
                      ? `Đang tải (${uploadProgress}%)`
                      : `Đang xử lý (${uploadProgress}%)`}
                  </>
                ) : (
                  "Chọn Tệp Tin"
                )}
              </button>

              {uploading && (
                <div className="w-full mt-3 space-y-1.5 animate-in fade-in duration-300">
                  <div className="h-1.5 w-full bg-blue-50 border border-blue-100 rounded-full overflow-hidden relative">
                    <div 
                      className="h-full bg-gradient-to-r from-blue-500 to-indigo-600 rounded-full transition-all duration-150" 
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-gray-500 font-bold text-center md:text-right">
                    {uploadStage === "uploading" 
                      ? `Đang tải tệp lên (${uploadProgress}%)` 
                      : `Đang phân tích, trích xuất & nhúng (${uploadProgress}%)`}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

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
                        {doc.status === "processing" ? (
                          <span className="flex items-center gap-1.5 text-blue-600 font-bold">
                            <div className="w-3.5 h-3.5 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
                            Đang xử lý ({doc.processing_progress ?? 0}%)
                          </span>
                        ) : doc.status === "failed" ? (
                          <span className="flex items-center gap-1.5 text-red-600 font-bold" title={doc.processing_error || "Lỗi xử lý"}>
                            <AlertTriangle size={14} className="text-red-500" />
                            Xử lý thất bại
                          </span>
                        ) : (
                          <span className="flex items-center gap-1.5">
                            <CheckCircle
                              size={14}
                              className="text-green-500"
                            />{" "}
                            Sẵn sàng cho RAG
                          </span>
                        )}
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
  );
}
