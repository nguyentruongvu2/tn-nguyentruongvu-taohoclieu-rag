import { Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import Login from "./pages/Login";
import Register from "./pages/Register";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import UserDashboard from "./pages/UserDashboard";
import AdminDashboard from "./pages/AdminDashboard";
import AdminLayout from "./layouts/AdminLayout";
import UserLayout from "./layouts/UserLayout";
import { hasStoredAuthSession } from "./services/api";

// New Pages imported
import TeachingMaterialEditor from "./pages/TeachingMaterialEditor";
import TeachingMaterialPreview from "./pages/TeachingMaterialPreview";
import QuizPage from "./pages/QuizPage";
import SlidePage from "./pages/SlidePage";

function App() {
  const isAuthed = hasStoredAuthSession();

  return (
    <>
      <Routes>
        <Route
          path="/login"
          element={isAuthed ? <Navigate to="/" /> : <Login />}
        />
        <Route
          path="/register"
          element={isAuthed ? <Navigate to="/" /> : <Register />}
        />
        <Route
          path="/forgot-password"
          element={isAuthed ? <Navigate to="/" /> : <ForgotPassword />}
        />
        <Route
          path="/reset-password"
          element={isAuthed ? <Navigate to="/" /> : <ResetPassword />}
        />

        {/* User Routes */}
        <Route path="/" element={<UserLayout />}>
          <Route index element={<UserDashboard />} />
          <Route
            path="materials"
            element={<Navigate to="/?tab=generate" replace />}
          />
          <Route
            path="materials/:id/editor"
            element={<TeachingMaterialEditor />}
          />
          <Route
            path="materials/:id/preview"
            element={<TeachingMaterialPreview />}
          />
        </Route>

        {/* Admin Routes */}
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<AdminDashboard />} />
        </Route>

        {/* Standalone pages (no layout) */}
        <Route path="/quiz" element={<QuizPage />} />
        <Route path="/slides" element={<SlidePage />} />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Toaster richColors position="top-right" />
    </>
  );
}

export default App;
