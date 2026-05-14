import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Mail, Lock, ArrowRight, Eye, EyeOff, Check } from "lucide-react";
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
  const [rememberMe, setRememberMe] = useState(true);
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
        </div>

        {error && (
          <div className="mt-1 mb-2 flex items-start gap-2 rounded-lg border border-red-100 bg-red-50 p-2 text-sm font-medium text-red-500 animate-in fade-in slide-in-from-top-1">
            <span className="mt-0.5 shrink-0">⚠️</span>
            <span>{error}</span>
          </div>
        )}

        <div className="mb-2 flex w-full items-center justify-between py-2 text-left">
          <label className="group flex cursor-pointer items-center gap-2">
            <div className="relative flex h-4 w-4 items-center justify-center rounded border border-gray-300 transition-colors group-hover:border-indigo-400 peer-checked:border-indigo-600 peer-checked:bg-indigo-600">
              <input
                type="checkbox"
                className="peer sr-only"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
              />
              <Check
                size={12}
                className="absolute text-white opacity-0 transition-opacity peer-checked:opacity-100"
              />
            </div>
            <span className="select-none text-sm text-gray-600">
              Ghi nhớ đăng nhập
            </span>
          </label>

          <Link
            to="/forgot-password"
            className="text-sm font-medium text-indigo-600 transition-colors hover:text-indigo-700 hover:underline"
          >
            Quên mật khẩu?
          </Link>
        </div>

        <AuthButton
          type="submit"
          variant="primary"
          isLoading={loading}
          icon={!loading ? ArrowRight : undefined}
          className="mt-4"
        >
          Đăng nhập
        </AuthButton>

        <div className="mt-8 text-left">
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-200"></div>
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-white px-3 font-medium text-gray-400">
                Hoặc đăng nhập với
              </span>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-3">
            <AuthButton type="button" variant="social" className="h-11">
              <svg
                viewBox="0 0 24 24"
                className="h-5 w-5 shrink-0"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#EA4335"
                />
              </svg>
              Google
            </AuthButton>

            <AuthButton type="button" variant="social" className="h-11">
              <svg
                viewBox="0 0 21 21"
                className="h-5 w-5 shrink-0"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path fill="#f25022" d="M1 1h9v9H1z" />
                <path fill="#00a4ef" d="M11 1h9v9h-9z" />
                <path fill="#7fba00" d="M1 11h9v9H1z" />
                <path fill="#ffb900" d="M11 11h9v9h-9z" />
              </svg>
              Microsoft
            </AuthButton>
          </div>

          <div className="mt-8 hidden text-center sm:block">
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
        </div>
      </form>
    </AuthLayout>
  );
}
