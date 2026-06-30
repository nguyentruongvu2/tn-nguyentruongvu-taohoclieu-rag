import { Outlet, Navigate, Link, useLocation } from "react-router-dom";
import { getStoredAuthUser, hasStoredAuthSession } from "../services/api";
import { ShieldAlert } from "lucide-react";

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

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <Outlet />
    </div>
  );
}
