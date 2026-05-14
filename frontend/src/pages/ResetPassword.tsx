import React, { useState, useEffect } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { Lock, Eye, EyeOff, CheckCircle } from "lucide-react";
import { confirmPasswordReset } from "../services/api";
import { toastService } from "../services/toastService";
import { AuthLayout } from "../components/Auth/AuthLayout";
import { AuthInput } from "../components/Auth/AuthInput";
import { AuthButton } from "../components/Auth/AuthButton";

const PASSWORD_STRONG_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,128}$/;

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!token) {
      setError("Liên kết không hợp lệ. Không tìm thấy token.");
    }
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setError("");

    if (!PASSWORD_STRONG_REGEX.test(password)) {
      setError("Mật khẩu phải từ 8-128 ký tự, bao gồm chữ hoa, thường, số và ký tự đặc biệt.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Xác nhận mật khẩu không khớp.");
      return;
    }

    setLoading(true);
    try {
      await toastService.promise(
        confirmPasswordReset(token, password, confirmPassword),
        {
          loading: "Đang cập nhật mật khẩu...",
          success: "Cập nhật mật khẩu thành công.",
          error: "Không thể đổi mật khẩu. Liên kết có thể đã hết hạn.",
        }
      );
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || "Đã xảy ra lỗi.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout isLogin={false}>
      {success ? (
        <div className="text-center space-y-6">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
            <CheckCircle className="h-6 w-6 text-green-600" />
          </div>
          <div>
            <h3 className="text-lg font-medium text-gray-900">Hoàn tất!</h3>
            <p className="mt-2 text-sm text-gray-500">
              Mật khẩu của bạn đã được thay đổi thành công.
            </p>
          </div>
          <Link to="/login" className="block w-full">
            <AuthButton type="button" variant="primary">
              Đăng nhập ngay
            </AuthButton>
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="text-center mb-6">
             <h2 className="text-xl font-semibold text-gray-900">Tạo mật khẩu mới</h2>
             <p className="mt-2 text-sm text-gray-600">Vui lòng nhập mật khẩu mới cho tài khoản của bạn.</p>
          </div>

          <AuthInput
            icon={Lock}
            label="Mật khẩu mới"
            placeholder="Nhập mật khẩu mới"
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            rightIcon={showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            onRightIconClick={() => setShowPassword((value) => !value)}
            required
            disabled={!token}
          />

          <AuthInput
            icon={Lock}
            label="Xác nhận mật khẩu mới"
            placeholder="Nhập lại mật khẩu"
            type={showPassword ? "text" : "password"}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            disabled={!token}
          />

          {error && (
            <div className="mt-1 flex items-start gap-2 rounded-lg border border-red-100 bg-red-50 p-2 text-sm font-medium text-red-500">
              <span className="mt-0.5 shrink-0">⚠️</span>
              <span>{error}</span>
            </div>
          )}

          <AuthButton
            type="submit"
            variant="primary"
            isLoading={loading}
            className="mt-6"
            disabled={!token}
          >
            Lưu mật khẩu
          </AuthButton>
        </form>
      )}
    </AuthLayout>
  );
}
