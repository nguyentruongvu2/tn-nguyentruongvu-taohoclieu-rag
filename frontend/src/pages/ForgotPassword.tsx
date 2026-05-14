import React, { useState } from "react";
import { Link } from "react-router-dom";
import { Mail, ArrowRight, ArrowLeft } from "lucide-react";
import { requestPasswordReset } from "../services/api";
import { toastService } from "../services/toastService";
import { AuthLayout } from "../components/Auth/AuthLayout";
import { AuthInput } from "../components/Auth/AuthInput";
import { AuthButton } from "../components/Auth/AuthButton";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+$/;

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const normalizedEmail = email.trim();
    if (!normalizedEmail || !EMAIL_REGEX.test(normalizedEmail)) {
      setError("Email không đúng định dạng.");
      return;
    }

    setLoading(true);
    try {
      await toastService.promise(
        requestPasswordReset(normalizedEmail),
        {
          loading: "Đang gửi yêu cầu...",
          success: "Yêu cầu khôi phục mật khẩu đã được gửi.",
          error: "Không thể gửi yêu cầu. Vui lòng thử lại.",
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
            <svg className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          </div>
          <div>
            <h3 className="text-lg font-medium text-gray-900">Kiểm tra email của bạn</h3>
            <p className="mt-2 text-sm text-gray-500">
              Chúng tôi đã gửi hướng dẫn khôi phục mật khẩu đến email <strong>{email}</strong>.
            </p>
          </div>
          <Link to="/login" className="block w-full">
            <AuthButton type="button" variant="primary">
              Quay lại đăng nhập
            </AuthButton>
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="text-center mb-6">
             <h2 className="text-xl font-semibold text-gray-900">Khôi phục mật khẩu</h2>
             <p className="mt-2 text-sm text-gray-600">Nhập email của bạn để nhận liên kết đặt lại mật khẩu.</p>
          </div>

          <AuthInput
            icon={Mail}
            label="Email"
            placeholder="Nhập email của bạn"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
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
            icon={!loading ? ArrowRight : undefined}
            className="mt-6"
          >
            Gửi yêu cầu
          </AuthButton>

          <div className="mt-6 text-center">
            <Link to="/login" className="inline-flex items-center text-sm font-medium text-indigo-600 hover:text-indigo-700">
              <ArrowLeft className="mr-1" size={16} />
              Quay lại đăng nhập
            </Link>
          </div>
        </form>
      )}
    </AuthLayout>
  );
}
