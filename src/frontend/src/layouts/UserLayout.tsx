import { Outlet, Navigate, useLocation } from "react-router-dom";
import { hasStoredAuthSession } from "../services/api";

export default function UserLayout() {
  const isAuthed = hasStoredAuthSession();
  const location = useLocation();

  if (!isAuthed) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      <Outlet />
    </div>
  );
}
