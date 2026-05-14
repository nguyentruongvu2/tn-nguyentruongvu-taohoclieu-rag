import { Outlet, Navigate, Link, useLocation } from "react-router-dom";
import {
  getStoredAuthUser,
  hasStoredAuthSession,
  logoutUser,
} from "../services/api";
import { LogOut, ShieldAlert } from "lucide-react";

export default function AdminLayout() {
  const isAuthed = hasStoredAuthSession();
  const user = getStoredAuthUser();
  const location = useLocation();

  if (!isAuthed || !user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (user.role !== "admin") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 pb-12">
        <div className="bg-white p-8 rounded-lg shadow-md max-w-md text-center">
          <ShieldAlert className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            Truy cập bị từ chối
          </h2>
          <p className="text-gray-600 mb-6">
            Bạn không có quyền quản trị để xem trang này.
          </p>
          <Link
            to="/"
            className="bg-blue-600 text-white px-6 py-2 rounded font-medium hover:bg-blue-700"
          >
            Quay lại trang chủ
          </Link>
        </div>
      </div>
    );
  }

  const handleLogout = () => {
    logoutUser();
    window.location.href = "/login";
  };

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <nav className="bg-gray-900 text-white shadow-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center">
              <span className="font-bold text-xl tracking-tight text-blue-400">
                RAG Admin
              </span>
            </div>
            <div className="flex items-center space-x-4">
              <Link
                to="/"
                className="text-gray-300 hover:text-white px-3 py-2 rounded-md text-sm font-medium"
              >
                Về User App
              </Link>
              <div className="flex items-center space-x-2 bg-gray-800 px-3 py-1.5 rounded-full">
                <span className="text-sm font-medium">{user.username}</span>
                <span className="text-xs bg-red-500 text-white px-2 py-0.5 rounded-full">
                  Admin
                </span>
              </div>
              <button
                onClick={handleLogout}
                className="text-gray-300 hover:text-white p-2"
                title="Đăng xuất"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </nav>

      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8">
        <Outlet />
      </main>
    </div>
  );
}
