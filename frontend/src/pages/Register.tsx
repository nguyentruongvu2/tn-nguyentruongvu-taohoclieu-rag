import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Mail, Lock, UserPlus, Eye, EyeOff, User, Check } from "lucide-react";
import { registerUser } from "../services/api";
import { toastService } from "../services/toastService";
import { AuthLayout } from "../components/Auth/AuthLayout";
import { AuthInput } from "../components/Auth/AuthInput";
import { AuthButton } from "../components/Auth/AuthButton";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+$/;
const PASSWORD_STRONG_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,128}$/;

const getRegisterErrorMessage = (err: unknown): string => {
  if (err instanceof Error) {
    return err.message;
  }

  return "Đăng ký thất bại. Vui lòng thử lại.";
};

export default function Register() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const normalizedName = name.trim();
    const normalizedEmail = email.trim();

    if (!normalizedName) {
      setError("Họ và tên không được để trống.");
      return;
    }
    if (!normalizedEmail) {
      setError("Email không được để trống.");
      return;
    }
    if (!EMAIL_REGEX.test(normalizedEmail)) {
      setError("Email không đúng định dạng.");
      return;
    }
    if (!PASSWORD_STRONG_REGEX.test(password)) {
      setError("Mật khẩu phải từ 8-128 ký tự, bao gồm ít nhất một chữ hoa, một chữ thường, một số và một ký tự đặc biệt (@$!%*?&).");
      return;
    }
    if (password !== confirmPassword) {
      setError("Xác nhận mật khẩu không khớp.");
      return;
    }

    setLoading(true);
    try {
      await toastService.promise(
        registerUser(normalizedEmail.toLowerCase(), password, confirmPassword),
        {
          loading: "Đang tạo tài khoản...",
          success: "Đăng ký thành công.",
          error: (err) => getRegisterErrorMessage(err),
        },
      );
      navigate("/");
    } catch (err) {
      const registerErrorMessage = getRegisterErrorMessage(err);
      setError(registerErrorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout isLogin={false}>
      <form onSubmit={handleRegister} className="space-y-1">
        <div className="space-y-1 transition-all duration-500 ease-in-out">
          <AuthInput
            icon={User}
            label="Họ và tên"
            placeholder="Nhập họ và tên"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />

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
            placeholder="Tạo mật khẩu"
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            rightIcon={showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            onRightIconClick={() => setShowPassword((value) => !value)}
            required
          />

          <AuthInput
            icon={Lock}
            label="Xác nhận mật khẩu"
            placeholder="Nhập lại mật khẩu"
            type={showPassword ? "text" : "password"}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
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
          <label className="group flex cursor-pointer items-start gap-2.5">
            <div className="relative mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border border-gray-300 transition-colors group-hover:border-indigo-400 peer-checked:border-indigo-600 peer-checked:bg-indigo-600">
              <input type="checkbox" className="peer sr-only" required />
              <Check
                size={12}
                className="absolute text-white opacity-0 transition-opacity peer-checked:opacity-100"
              />
            </div>
            <span className="select-none text-sm leading-tight text-gray-600">
              Tôi đồng ý với{" "}
              <a href="#" className="text-indigo-600 hover:underline">
                Điều khoản sử dụng
              </a>{" "}
              và{" "}
              <a href="#" className="text-indigo-600 hover:underline">
                Chính sách bảo mật
              </a>
            </span>
          </label>
        </div>

        <AuthButton
          type="submit"
          variant="primary"
          isLoading={loading}
          icon={!loading ? UserPlus : undefined}
          className="mt-4"
        >
          Tạo tài khoản
        </AuthButton>

        <div className="mt-8 text-left">
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-200"></div>
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-white px-3 font-medium text-gray-400">
                Đã có tài khoản?
              </span>
            </div>
          </div>

          <div className="mt-6 text-center">
            <Link to="/login" className="flex w-full justify-center">
              <AuthButton type="button" variant="outline">
                Về trang đăng nhập
              </AuthButton>
            </Link>
          </div>
        </div>
      </form>
    </AuthLayout>
  );
}
