import { X, Search, FileText, Eye, User, LogOut, Shield, BookOpen, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { getAvatarUrl } from '../utils/user_avatar';

export interface SidebarProps {
  isSidebarOpen: boolean;
  setIsSidebarOpen: (isOpen: boolean) => void;
  activeTab: "generate" | "documents" | "chat" | "preview" | "profile";
  setActiveTab: (tab: "generate" | "documents" | "chat" | "preview" | "profile") => void;
  currentUser: any;
  handleLogout: () => void;
}

export default function Sidebar({
  isSidebarOpen,
  setIsSidebarOpen,
  activeTab,
  setActiveTab,
  currentUser,
  handleLogout
}: SidebarProps) {
  return (
    <>
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
              <BookOpen size={24} className="text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900 leading-tight">
                EduRAG
              </h1>
              <p className="text-xs text-gray-500 font-medium tracking-wide">
                Học liệu & RAG
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
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 border ${activeTab === "chat" ? "bg-blue-50/70 text-blue-700 font-semibold shadow-sm border-l-4 border-l-blue-600 border-y border-r border-blue-100/40" : "text-gray-600 hover:bg-gray-50 hover:text-gray-900 font-medium border-transparent"}`}
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
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 border ${activeTab === "documents" ? "bg-blue-50/70 text-blue-700 font-semibold shadow-sm border-l-4 border-l-blue-600 border-y border-r border-blue-100/40" : "text-gray-600 hover:bg-gray-50 hover:text-gray-900 font-medium border-transparent"}`}
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
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 border ${activeTab === "generate" ? "bg-blue-50/70 text-blue-700 font-semibold shadow-sm border-l-4 border-l-blue-600 border-y border-r border-blue-100/40" : "text-gray-600 hover:bg-gray-50 hover:text-gray-900 font-medium border-transparent"}`}
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
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 border ${activeTab === "preview" ? "bg-blue-50/70 text-blue-700 font-semibold shadow-sm border-l-4 border-l-blue-600 border-y border-r border-blue-100/40" : "text-gray-600 hover:bg-gray-50 hover:text-gray-900 font-medium border-transparent"}`}
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
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 border ${activeTab === "profile" ? "bg-blue-50/70 text-blue-700 font-semibold shadow-sm border-l-4 border-l-blue-600 border-y border-r border-blue-100/40" : "text-gray-600 hover:bg-gray-50 hover:text-gray-900 font-medium border-transparent"}`}
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
            <img
              src={getAvatarUrl(currentUser)}
              alt="Avatar"
              className="w-12 h-12 rounded-full mb-3 shadow-inner ring-4 ring-white z-10 object-cover"
            />
            <p className="text-sm font-bold text-gray-900 truncate w-full text-center z-10">
              {currentUser?.username || "User"}
            </p>
            <p className="text-xs text-gray-500 mb-4 font-medium z-10">
              {currentUser?.role === "admin" ? "Quản trị viên" : "Tài khoản cá nhân"}
            </p>
            {currentUser?.role === "admin" && (
              <Link
                to="/admin"
                className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700 hover:bg-blue-50 py-2.5 px-4 rounded-lg w-full justify-center transition-colors font-medium border border-blue-100/50 hover:border-blue-200 z-10 mb-2"
              >
                <Shield size={16} /> Trang Admin
              </Link>
            )}
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 text-sm text-red-600 hover:text-red-700 hover:bg-red-50 py-2.5 px-4 rounded-lg w-full justify-center transition-colors font-medium border border-transparent hover:border-red-100 z-10"
            >
              <LogOut size={16} /> Đăng xuất
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
