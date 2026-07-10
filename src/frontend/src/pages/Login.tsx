import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Mail, Lock, ArrowRight, Eye, EyeOff } from "lucide-react";
import { loginUser } from "../services/api";
import { toastService } from "../services/toastService";
import { AuthLayout } from "../components/Auth/AuthLayout";
import { AuthInput } from "../components/Auth/AuthInput";
import { AuthButton } from "../components/Auth/AuthButton";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+$/;

const getLoginErrorMessage = (err: unknown): string => {
  if (err instanceof Error) {
    return err.message;
  }

  return "Đăng nhập thất bại. Vui lòng kiểm tra lại thông tin.";
};

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const rememberMe = true;
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const normalizedEmail = email.trim();
    if (!normalizedEmail) {
      setError("Email không được để trống.");
      return;
    }
    if (!EMAIL_REGEX.test(normalizedEmail)) {
      setError("Email không đúng định dạng.");
      return;
    }
    if (!password) {
      setError("Mật khẩu không được để trống.");
      return;
    }

    setLoading(true);
    try {
      const auth = await toastService.promise(
        loginUser(normalizedEmail.toLowerCase(), password, rememberMe),
        {
          loading: "Đang đăng nhập...",
          success: "Đăng nhập thành công.",
          error: (err) => getLoginErrorMessage(err),
        },
      );
      if (auth?.role === "admin") {
        navigate("/admin");
      } else {
        sessionStorage.setItem("just_logged_in", "true");
        navigate("/");
      }
    } catch (err) {
      const loginErrorMessage = getLoginErrorMessage(err);
      setError(loginErrorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout isLogin={true}>
      <form onSubmit={handleLogin} className="space-y-1">
        <div className="space-y-1 transition-all duration-500 ease-in-out">
          <AuthInput
            icon={Mail}
            label="Email"
            placeholder="Nhập email của bạn"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />

          <AuthInput
            icon={Lock}
            label="Mật khẩu"
            placeholder="Nhập mật khẩu"
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            rightIcon={showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            onRightIconClick={() => setShowPassword((value) => !value)}
            required
          />
          <div className="flex justify-end mt-1">
            <Link
              to="/forgot-password"
              className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 hover:underline"
            >
              Quên mật khẩu?
            </Link>
          </div>
        </div>

        {error && (
          <div className="mt-1 mb-2 flex items-start gap-2 rounded-lg border border-red-100 bg-red-50 p-2 text-sm font-medium text-red-500 animate-in fade-in slide-in-from-top-1">
            <span className="mt-0.5 shrink-0">⚠️</span>
            <span>{error}</span>
          </div>
        )}



        <AuthButton
          type="submit"
          variant="primary"
          isLoading={loading}
          icon={!loading ? ArrowRight : undefined}
          className="mt-4"
        >
          Đăng nhập
        </AuthButton>

        <div className="mt-6 text-center">
          <p className="text-sm text-gray-600">
            Chưa có tài khoản?{" "}
            <Link
              to="/register"
              className="font-semibold text-indigo-600 hover:text-indigo-700 hover:underline"
            >
              Đăng ký ngay
            </Link>
          </p>
        </div>
      </form>
    </AuthLayout>
  );
}
