import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, BookOpen, Trash2, Edit2, Search, FileText } from "lucide-react";
import {
  createEditorProject,
  deleteEditorProject,
  listEditorProjects,
  listSecureDocuments,
  updateEditorProject,
  type EditorProject,
  type SecureDocument,
} from "../services/api";

const KB_REQUIRED_MESSAGE =
  "Vui lòng chọn ít nhất 1 Knowledge Base trước khi tạo hoặc mở phần soạn thảo bài giảng.";

const hasKnowledgeBase = (project: EditorProject): boolean =>
  Array.isArray(project.knowledge_base_ids) &&
  project.knowledge_base_ids.some(
    (item) => String(item || "").trim().length > 0,
  );

export default function TeachingMaterialList() {
  const PROJECT_BATCH_SIZE = 6;
  const navigate = useNavigate();
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [projects, setProjects] = useState<EditorProject[]>([]);
  const [hasMoreProjects, setHasMoreProjects] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [documents, setDocuments] = useState<SecureDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string>("");
  const [error, setError] = useState("");

  // Form State
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [level, setLevel] = useState("CB");
  const [format, setFormat] = useState("markdown");
  const [teachingTone, setTeachingTone] = useState("academic");
  const [knowledgeBaseIds, setKnowledgeBaseIds] = useState<string[]>([]);
  const [syllabusDocId, setSyllabusDocId] = useState<string | null>(null);

  const [kbSearch, setKbSearch] = useState("");
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const [isKbListOpen, setIsKbListOpen] = useState(false);
  const kbSelectorRef = useRef<HTMLDivElement | null>(null);

  const resetForm = () => {
    setTitle("");
    setDescription("");
    setLevel("CB");
    setFormat("markdown");
    setTeachingTone("academic");
    setKnowledgeBaseIds([]);
    setSyllabusDocId(null);
    setIsEditMode(false);
    setEditingProjectId("");
    setKbSearch("");
    setIsAdvancedOpen(false);
    setIsKbListOpen(false);
  };

  const loadMoreProjects = async () => {
    if (!hasMoreProjects || loadingMore) return;
    try {
      setLoadingMore(true);
      const newProjects = await listEditorProjects(
        PROJECT_BATCH_SIZE,
        projects.length,
      );
      if (newProjects.length < PROJECT_BATCH_SIZE) {
        setHasMoreProjects(false);
      }
      setProjects((prev) => [
        ...prev,
        ...newProjects.map((item) => ({
          ...item,
          knowledge_base_ids: (item.knowledge_base_ids || []).map((id) =>
            String(id),
          ),
        })),
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi khi tải thêm dự án");
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        const [projectRows, docRows] = await Promise.all([
          listEditorProjects(PROJECT_BATCH_SIZE, 0),
          listSecureDocuments(),
        ]);

        if (!projectRows || projectRows.length < PROJECT_BATCH_SIZE) {
          setHasMoreProjects(false);
        }

        setProjects(
          (projectRows || []).map((item) => ({
            ...item,
            knowledge_base_ids: (item.knowledge_base_ids || []).map((id) =>
              String(id),
            ),
          })),
        );
        setDocuments(
          (docRows || []).map((item) => ({
            ...item,
            id: String(item.id),
          })),
        );
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Không tải được danh sách dự án",
        );
      } finally {
        setLoading(false);
      }
    };
    void loadData();
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        kbSelectorRef.current &&
        !kbSelectorRef.current.contains(event.target as Node)
      ) {
        setIsKbListOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const handleSaveProject = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setError("");
      const normalizedKnowledgeBaseIds = knowledgeBaseIds
        .map((id) => String(id || "").trim())
        .filter((id) => Boolean(id));

      if (normalizedKnowledgeBaseIds.length === 0) {
        setError(KB_REQUIRED_MESSAGE);
        return;
      }

      if (isEditMode && editingProjectId) {
        const updated = await updateEditorProject(editingProjectId, {
          title: title || "Dự án bài giảng",
          description,
          knowledge_base_ids: normalizedKnowledgeBaseIds,
          level,
          format,
          teaching_tone: teachingTone,
          syllabus_doc_id: syllabusDocId,
        });
        setProjects((prev) =>
          prev.map((item) =>
            item.id === editingProjectId
              ? {
                  ...item,
                  ...updated,
                  knowledge_base_ids: (updated.knowledge_base_ids || []).map(
                    (id) => String(id),
                  ),
                  syllabus_doc_id: updated.syllabus_doc_id,
                  sections_count: item.sections_count,
                }
              : item,
          ),
        );
      } else {
        const created = await createEditorProject({
          title: title || "Dự án bài giảng mới",
          description,
          knowledge_base_ids: normalizedKnowledgeBaseIds,
          level,
          format,
          teaching_tone: teachingTone,
          syllabus_doc_id: syllabusDocId,
        });
        setProjects((prev) => [{ ...created, sections_count: 0 }, ...prev]);
        navigate(`/materials/${created.id}/editor`);
      }

      resetForm();
      setIsModalOpen(false);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : isEditMode
            ? "Cập nhật dự án thất bại"
            : "Tạo dự án thất bại",
      );
    }
  };

  const openCreateModal = () => {
    resetForm();
    setError("");
    setIsModalOpen(true);
  };

  const openEditModal = (project: EditorProject) => {
    setIsEditMode(true);
    setEditingProjectId(project.id);
    setTitle(project.title || "");
    setDescription(project.description || "");
    setLevel(project.level || "CB");
    setFormat(project.format || "markdown");
    setTeachingTone(project.teaching_tone || "academic");
    setKnowledgeBaseIds(
      (project.knowledge_base_ids || []).map((id) => String(id)),
    );
    setSyllabusDocId(project.syllabus_doc_id || null);
    setError("");
    setIsModalOpen(true);
  };

  const handleDeleteProject = async (projectId: string) => {
    if (!window.confirm("Bạn có chắc muốn xóa dự án này?")) {
      return;
    }
    try {
      await deleteEditorProject(projectId);
      setProjects((prev) => prev.filter((p) => p.id !== projectId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Xóa dự án thất bại");
    }
  };

  const toggleKb = (docId: string) => {
    const normalizedId = String(docId);
    setKnowledgeBaseIds((prev) =>
      prev.includes(normalizedId)
        ? prev.filter((id) => id !== normalizedId)
        : [...prev, normalizedId],
    );
  };

  const handleOpenEditor = (project: EditorProject) => {
    if (!hasKnowledgeBase(project)) {
      setError(KB_REQUIRED_MESSAGE);
      return;
    }
    navigate(`/materials/${project.id}/editor`);
  };

  return (
    <div
      ref={scrollContainerRef}
      className="h-full overflow-y-auto custom-scrollbar p-6 md:p-8 max-w-6xl mx-auto w-full"
    >
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">
            Quản lý bài giảng
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            Danh sách các dự án tài liệu đã tạo
          </p>
        </div>
        <button
          onClick={openCreateModal}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium transition-colors"
        >
          <Plus size={20} />
          Tạo bài giảng mới
        </button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white border rounded-xl p-5 shadow-sm animate-pulse">
              <div className="flex items-start justify-between mb-4">
                <div className="w-12 h-12 bg-slate-200 rounded-lg"></div>
              </div>
              <div className="h-5 bg-slate-200 rounded w-3/4 mb-4"></div>
              <div className="flex items-center justify-between mt-4">
                <div className="h-4 bg-slate-200 rounded w-1/4"></div>
                <div className="h-6 bg-slate-200 rounded w-1/4"></div>
              </div>
              <div className="mt-4 w-full h-10 bg-slate-200 rounded-lg"></div>
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="text-red-600 p-4 bg-red-50 rounded-xl border border-red-100">{error}</div>
      ) : projects.length === 0 ? (
        <div className="py-20 px-4 flex flex-col items-center justify-center text-center bg-white rounded-2xl border border-dashed border-slate-300">
          <div className="w-20 h-20 bg-blue-50 text-blue-300 rounded-full flex items-center justify-center mb-4 border border-blue-100/50 shadow-sm">
            <BookOpen size={40} />
          </div>
          <h4 className="text-lg font-bold text-slate-800 mb-2">Chưa có dự án bài giảng nào</h4>
          <p className="text-slate-500 text-sm max-w-sm mb-6">Tạo dự án mới để bắt đầu sử dụng AI RAG trong việc soạn thảo tài liệu giảng dạy của bạn.</p>
          <button 
            onClick={openCreateModal}
            className="px-6 py-2.5 bg-blue-50 text-blue-600 font-semibold rounded-xl hover:bg-blue-100 transition-colors border border-blue-200 flex items-center gap-2"
          >
            <Plus size={18} />
            Tạo bài giảng mới
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {projects.map((project) => {
          // Helper maps for badges
          const levelLabels: Record<string, { text: string; css: string }> = {
            CB: { text: "Cơ bản", css: "bg-emerald-50 text-emerald-700 border-emerald-100" },
            TC: { text: "Trung cấp", css: "bg-blue-50 text-blue-700 border-blue-100" },
            NC: { text: "Nâng cao", css: "bg-purple-50 text-purple-700 border-purple-100" },
          };
          
          const formatLabels: Record<string, { text: string; css: string }> = {
            markdown: { text: "Markdown 📝", css: "bg-sky-50 text-sky-700 border-sky-100" },
            pdf: { text: "PDF 📄", css: "bg-rose-50 text-rose-700 border-rose-100" },
          };

          const toneLabels: Record<string, string> = {
            academic: "🎓 Hàn lâm",
            inspiring: "🌟 Cảm hứng",
            practical: "🛠️ Thực tiễn",
          };

          const levelInfo = (project.level && levelLabels[project.level]) || { text: project.level || "Cơ bản", css: "bg-slate-50 text-slate-700 border-slate-100" };
          const formatInfo = (project.format && formatLabels[project.format]) || { text: project.format || "Markdown", css: "bg-slate-50 text-slate-700 border-slate-100" };
          const toneText = (project.teaching_tone && toneLabels[project.teaching_tone]) || project.teaching_tone || "";

          return (
            <div
              key={project.id}
              className="bg-white border border-slate-100 rounded-2xl p-6 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 relative group flex flex-col justify-between"
            >
              <div>
                <div className="flex items-start justify-between mb-4">
                  <div className="p-3 bg-gradient-to-br from-blue-500 to-indigo-600 text-white rounded-xl shadow-md shadow-blue-100 group-hover:scale-110 transition-transform duration-300">
                    <BookOpen size={22} />
                  </div>
                  <div className="flex gap-2 sm:opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                    <button
                      onClick={() => openEditModal(project)}
                      className="w-8 h-8 rounded-full bg-slate-50 hover:bg-blue-50 text-slate-400 hover:text-blue-600 flex items-center justify-center border border-slate-100 hover:border-blue-100 transition-colors shadow-sm"
                      title="Chỉnh sửa dự án"
                    >
                      <Edit2 size={15} />
                    </button>
                    <button
                      onClick={() => handleDeleteProject(project.id)}
                      className="w-8 h-8 rounded-full bg-slate-50 hover:bg-red-50 text-slate-400 hover:text-red-600 flex items-center justify-center border border-slate-100 hover:border-red-100 transition-colors shadow-sm"
                      title="Xóa dự án"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>

                <h3 className="font-bold text-lg text-slate-800 line-clamp-2 group-hover:text-blue-600 transition-colors">
                  {project.title}
                </h3>
                
                {project.description && (
                  <p className="text-slate-500 text-xs mt-2 line-clamp-2 leading-relaxed">
                    {project.description}
                  </p>
                )}

                {/* Badges/Tags Grid */}
                <div className="flex flex-wrap gap-1.5 mt-4">
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${levelInfo.css}`}>
                    {levelInfo.text}
                  </span>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${formatInfo.css}`}>
                    {formatInfo.text}
                  </span>
                  {project.teaching_tone && (
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border border-amber-100 bg-amber-50 text-amber-700">
                      {toneText}
                    </span>
                  )}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mt-5 pt-4 border-t border-slate-50 text-xs text-slate-400">
                  <span>
                    Cập nhật: {new Date(project.created_at).toLocaleDateString("vi-VN")}
                  </span>
                  <span className="font-semibold text-slate-500 bg-slate-50 border border-slate-100 px-2 py-0.5 rounded-full">
                    {project.sections_count || 0} mục soạn thảo
                  </span>
                </div>
                <button
                  onClick={() => handleOpenEditor(project)}
                  className="mt-4 w-full bg-slate-50 hover:bg-blue-600 text-blue-600 hover:text-white font-semibold py-2.5 rounded-xl transition-all duration-300 border border-slate-200/50 hover:border-blue-600 hover:shadow-md hover:shadow-blue-100 text-sm flex items-center justify-center gap-1.5"
                >
                  Mở soạn thảo bài giảng
                </button>
              </div>
            </div>
          );
        })}
      </div>
      )}

      {!loading && !error && projects.length > 0 && (
        <div className="mt-8 text-center flex flex-col items-center">
          <p className="text-xs text-slate-500 mb-4">
            Hiển thị {projects.length} dự án
          </p>
          {hasMoreProjects && (
            <button
              onClick={loadMoreProjects}
              disabled={loadingMore}
              className={`px-6 py-2 rounded-lg font-medium transition-colors border ${
                loadingMore
                  ? "bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed"
                  : "bg-white text-blue-600 border-blue-200 hover:bg-blue-50 hover:border-blue-300"
              }`}
            >
              {loadingMore ? "Đang tải..." : "Xem thêm"}
            </button>
          )}
        </div>
      )}

      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="p-6 border-b">
              <h2 className="text-xl font-bold text-slate-800">
                {isEditMode
                  ? "Cập nhật dự án bài giảng"
                  : "Tạo dự án bài giảng mới"}
              </h2>
            </div>
            <form
              onSubmit={handleSaveProject}
              className="p-6 flex-1 overflow-y-auto"
            >
              <div className="space-y-4">
                <div className="relative">
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Tiêu đề bài giảng
                  </label>
                  <input
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder=""
                    className="w-full border border-slate-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Mô tả bài giảng
                  </label>
                  <textarea
                    value={description}
                    onChange={(e) => {
                      setDescription(e.target.value);
                      e.target.style.height = "auto";
                      e.target.style.height = `${e.target.scrollHeight}px`;
                    }}
                    rows={1}
                    style={{ minHeight: "38px", height: "auto", resize: "none" }}
                    className="w-full border rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 outline-none transition-all duration-150"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Tài liệu đề cương (Syllabus/Outline PDF - Tùy chọn)
                  </label>
                  <select
                    value={syllabusDocId || ""}
                    onChange={(e) => setSyllabusDocId(e.target.value || null)}
                    className="w-full border border-slate-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 outline-none bg-white text-sm"
                  >
                    <option value="">Không sử dụng đề cương (Tự sinh dàn ý RAG)</option>
                    {documents.map((doc) => (
                      <option key={doc.id} value={doc.id}>
                        {doc.original_filename}
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-slate-400 mt-1">
                    Nếu chọn đề cương, hệ thống sẽ trích xuất cấu trúc mục lục trực tiếp từ đề cương môn học này.
                  </p>
                </div>
                {/* Advanced Configuration Accordion */}
                <div className="pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setIsAdvancedOpen(!isAdvancedOpen)}
                    className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-blue-600 transition-colors focus:outline-none"
                  >
                    <span className="text-[10px] transform transition-transform duration-200">
                      {isAdvancedOpen ? "▼" : "▶"}
                    </span>
                    <span>⚙️ Cấu hình nâng cao (Cấp độ, Định dạng, Giọng văn)</span>
                  </button>
                </div>

                {isAdvancedOpen && (
                  <div className="space-y-4 pt-3 pb-3 px-4 bg-slate-50/60 rounded-xl border border-slate-150 animate-in fade-in slide-in-from-top-1 duration-200">
                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1">
                        Cấp độ
                      </label>
                      <select
                        value={level}
                        onChange={(e) => setLevel(e.target.value)}
                        className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-xs bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
                      >
                        <option value="CB">Cơ bản</option>
                        <option value="TC">Trung cấp</option>
                        <option value="NC">Nâng cao</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1">
                        Định dạng
                      </label>
                      <select
                        value={format}
                        onChange={(e) => setFormat(e.target.value)}
                        className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-xs bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
                      >
                        <option value="markdown">Markdown</option>
                        <option value="pdf">PDF</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1">
                        Giọng văn bài giảng (Teaching Tone)
                      </label>
                      <select
                        value={teachingTone}
                        onChange={(e) => setTeachingTone(e.target.value)}
                        className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-xs bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
                      >
                        <option value="academic">Hàn lâm 🎓</option>
                        <option value="inspiring">Truyền cảm hứng 🌟</option>
                        <option value="practical">Thực tiễn 🛠️</option>
                      </select>
                    </div>
                  </div>
                )}

                {/* Knowledge Base Selection */}
                <div ref={kbSelectorRef}>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-sm font-bold text-slate-700">
                      Chọn Tài liệu nguồn (để AI tham chiếu)
                    </label>
                    <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-100 whitespace-nowrap">
                      Đã chọn {knowledgeBaseIds.length} tài liệu
                    </span>
                  </div>
                  
                  <p className="text-[11px] text-slate-400 mb-2.5 leading-normal">
                    Hệ thống AI sẽ chỉ truy xuất và biên soạn nội dung bài giảng dựa trên các tài liệu được chọn tại đây.
                  </p>
                  
                  {/* Search box for documents */}
                  <div className="relative mb-2">
                    <span className="absolute inset-y-0 left-0 flex items-center pl-2.5 pointer-events-none text-slate-400">
                      <Search size={13} />
                    </span>
                    <input
                      type="text"
                      placeholder="Nhấp vào đây để tìm và chọn tài liệu nguồn..."
                      value={kbSearch}
                      onChange={(e) => setKbSearch(e.target.value)}
                      onFocus={() => setIsKbListOpen(true)}
                      className="w-full border border-slate-200 rounded-lg pl-8 pr-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all bg-slate-50"
                    />
                  </div>

                  {isKbListOpen && (
                    <div className="max-h-[136px] overflow-y-auto border border-slate-200 rounded-lg p-2 space-y-1.5 bg-slate-50/30 custom-scrollbar shadow-inner animate-in fade-in slide-in-from-top-1 duration-150">
                      {documents
                        .filter((doc) =>
                          (doc.original_filename || "")
                            .toLowerCase()
                            .includes(kbSearch.toLowerCase())
                        )
                        .map((doc) => {
                          const isSelected = knowledgeBaseIds.includes(String(doc.id));
                          const isWord = doc.original_filename.endsWith(".docx") || doc.original_filename.endsWith(".doc");
                          const isPdf = doc.original_filename.endsWith(".pdf");
                          
                          return (
                            <div
                              key={doc.id}
                              onClick={() => toggleKb(String(doc.id))}
                              className={`flex items-center justify-between p-2 rounded-lg border text-xs cursor-pointer select-none transition-all ${
                                isSelected
                                  ? "bg-blue-50/80 border-blue-200 text-blue-800 shadow-sm font-semibold"
                                  : "bg-white border-slate-100 text-slate-600 hover:bg-slate-50 hover:border-slate-200"
                              }`}
                            >
                              <div className="flex items-center gap-2 min-w-0 pr-2">
                                <span className={`p-1 rounded ${
                                  isWord 
                                    ? "bg-blue-50 text-blue-500" 
                                    : isPdf 
                                      ? "bg-rose-50 text-rose-500" 
                                      : "bg-slate-50 text-slate-500"
                                }`}>
                                  <FileText size={13} />
                                </span>
                                <span className="truncate" title={doc.original_filename}>
                                  {doc.original_filename}
                                </span>
                              </div>
                              <input
                                type="checkbox"
                                checked={isSelected}
                                readOnly
                                className="w-3.5 h-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer pointer-events-none"
                              />
                            </div>
                          );
                        })}
                      {documents.filter((doc) =>
                        (doc.original_filename || "")
                          .toLowerCase()
                          .includes(kbSearch.toLowerCase())
                      ).length === 0 && (
                        <p className="text-xs text-slate-400 text-center py-4">
                          {documents.length === 0 ? "Chưa có tài liệu nào." : "Không tìm thấy tài liệu phù hợp."}
                        </p>
                      )}
                    </div>
                  )}
                </div>
                {error && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {error}
                  </div>
                )}
              </div>
              <div className="mt-8 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setIsModalOpen(false);
                    resetForm();
                  }}
                  className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-medium"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium"
                >
                  {isEditMode ? "Cập nhật" : "Tạo dự án"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
