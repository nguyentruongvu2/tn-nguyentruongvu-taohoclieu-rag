import React, { useState, useEffect } from "react";
import { User, Mail, Lock, CheckCircle, Save, Shield } from "lucide-react";
import { updateMyProfile, updateMyPassword, getStoredAuthUser } from "../services/api";
import type { AuthUser } from "../services/api";
import { toastService } from "../services/toastService";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+$/;
const PASSWORD_STRONG_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,128}$/;

export default function ProfileManagement() {
  const [user, setUser] = useState<AuthUser | null>(getStoredAuthUser());
  
  // Profile state
  const [username, setUsername] = useState(user?.username || "");
  const [email, setEmail] = useState(user?.email || "");
  const [profileLoading, setProfileLoading] = useState(false);

  // Password state
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);

  useEffect(() => {
    setUser(getStoredAuthUser());
  }, []);

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) {
      toastService.error("Tên người dùng không được để trống.");
      return;
    }
    if (!email.trim() || !EMAIL_REGEX.test(email.trim())) {
      toastService.error("Email không đúng định dạng.");
      return;
    }

    setProfileLoading(true);
    try {
      const payload: { username?: string; email?: string } = {};
      if (username !== user?.username) payload.username = username;
      if (email !== user?.email) payload.email = email;

      if (Object.keys(payload).length === 0) {
        toastService.info("Không có thay đổi nào để cập nhật.");
        return;
      }

      await toastService.promise(
        updateMyProfile(payload),
        {
          loading: "Đang cập nhật hồ sơ...",
          success: "Hồ sơ đã được cập nhật thành công.",
          error: (err) => err instanceof Error ? err.message : "Cập nhật hồ sơ thất bại.",
        }
      );
      setUser(getStoredAuthUser());
    } finally {
      setProfileLoading(false);
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!oldPassword) {
      toastService.error("Vui lòng nhập mật khẩu hiện tại.");
      return;
    }
    if (!PASSWORD_STRONG_REGEX.test(newPassword)) {
      toastService.error("Mật khẩu mới phải từ 8-128 ký tự, bao gồm chữ hoa, thường, số và ký tự đặc biệt.");
      return;
    }
    if (newPassword !== confirmPassword) {
      toastService.error("Xác nhận mật khẩu mới không khớp.");
      return;
    }

    setPasswordLoading(true);
    try {
      await toastService.promise(
        updateMyPassword({
          old_password: oldPassword,
          new_password: newPassword,
          confirm_password: confirmPassword,
        }),
        {
          loading: "Đang cập nhật mật khẩu...",
          success: "Mật khẩu đã được thay đổi thành công.",
          error: (err) => err instanceof Error ? err.message : "Đổi mật khẩu thất bại.",
        }
      );
      setOldPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } finally {
      setPasswordLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="bg-white rounded-3xl p-8 border border-gray-100 shadow-sm flex items-start gap-6 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-blue-50 to-indigo-50/50 pointer-events-none" />
        <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-bold text-3xl shadow-inner border-4 border-white relative z-10">
          {user?.username?.charAt(0).toUpperCase() || "U"}
        </div>
        <div className="relative z-10 pt-2">
          <h2 className="text-2xl font-bold text-gray-900">{user?.username}</h2>
          <div className="flex items-center gap-2 mt-1 text-gray-500 font-medium">
            <Mail size={16} />
            <span>{user?.email}</span>
            {user?.role === "admin" && (
              <span className="ml-2 inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-100 text-purple-700">
                <Shield size={12} /> Admin
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Profile Form */}
        <div className="bg-white rounded-3xl p-6 border border-gray-100 shadow-sm">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 bg-blue-50 text-blue-600 rounded-xl">
              <User size={20} />
            </div>
            <h3 className="text-lg font-bold text-gray-900">Thông tin cá nhân</h3>
          </div>
          
          <form onSubmit={handleUpdateProfile} className="space-y-5">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Tên người dùng</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-gray-200 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-medium text-gray-900"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Địa chỉ Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-gray-200 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-medium text-gray-900"
              />
            </div>
            <div className="pt-2">
              <button
                type="submit"
                disabled={profileLoading || (username === user?.username && email === user?.email)}
                className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white py-2.5 px-4 rounded-xl font-semibold shadow-sm hover:bg-blue-700 active:bg-blue-800 disabled:bg-gray-300 disabled:cursor-not-allowed transition-all"
              >
                {profileLoading ? (
                  "Đang lưu..."
                ) : (
                  <span className="flex items-center gap-2">
                    <Save size={18} /> Lưu thay đổi
                  </span>
                )}
              </button>
            </div>
          </form>
        </div>

        {/* Password Form */}
        <div className="bg-white rounded-3xl p-6 border border-gray-100 shadow-sm">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
              <Lock size={20} />
            </div>
            <h3 className="text-lg font-bold text-gray-900">Đổi mật khẩu</h3>
          </div>
          
          <form onSubmit={handleUpdatePassword} className="space-y-5">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Mật khẩu hiện tại</label>
              <input
                type="password"
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                placeholder="Nhập mật khẩu hiện tại"
                className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium text-gray-900 placeholder:text-gray-400 placeholder:font-normal"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Mật khẩu mới</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Mật khẩu mới (ít nhất 8 ký tự, 1 hoa, 1 số, 1 đặc biệt)"
                className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium text-gray-900 placeholder:text-gray-400 placeholder:font-normal"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Xác nhận mật khẩu mới</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Nhập lại mật khẩu mới"
                className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium text-gray-900 placeholder:text-gray-400 placeholder:font-normal"
              />
            </div>
            <div className="pt-2">
              <button
                type="submit"
                disabled={passwordLoading || !oldPassword || !newPassword || !confirmPassword}
                className="w-full flex items-center justify-center gap-2 bg-indigo-600 text-white py-2.5 px-4 rounded-xl font-semibold shadow-sm hover:bg-indigo-700 active:bg-indigo-800 disabled:bg-gray-300 disabled:cursor-not-allowed transition-all"
              >
                {passwordLoading ? (
                  "Đang cập nhật..."
                ) : (
                  <span className="flex items-center gap-2">
                    <CheckCircle size={18} /> Cập nhật mật khẩu
                  </span>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
