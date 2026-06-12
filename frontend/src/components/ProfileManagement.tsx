import React, { useState, useEffect, useRef } from "react";
import { User, Mail, Lock, CheckCircle, Save, Shield, BookOpen, FileText, Calendar, Activity, Camera } from "lucide-react";
import { updateMyProfile, updateMyPassword, getStoredAuthUser, listEditorProjects, listSecureDocuments, uploadAvatar } from "../services/api";
import type { AuthUser } from "../services/api";
import { toastService } from "../services/toastService";
import { getAvatarUrl } from "../utils/user_avatar";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+$/;
const PASSWORD_STRONG_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,128}$/;

export default function ProfileManagement() {
  const [user, setUser] = useState<AuthUser | null>(getStoredAuthUser());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  
  // Profile state
  const [username, setUsername] = useState(user?.username || "");
  const [email, setEmail] = useState(user?.email || "");
  const [profileLoading, setProfileLoading] = useState(false);

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;
    const file = e.target.files[0];

    if (file.size > 2 * 1024 * 1024) {
      toastService.error("Kích thước tệp tin không được vượt quá 2MB.");
      return;
    }

    setAvatarUploading(true);
    try {
      await toastService.promise(
        uploadAvatar(file),
        {
          loading: "Đang tải ảnh đại diện lên...",
          success: "Tải ảnh đại diện lên thành công.",
          error: (err) => err instanceof Error ? err.message : "Tải ảnh đại diện thất bại.",
        }
      );
      setUser(getStoredAuthUser());
    } catch (err) {
      console.error(err);
    } finally {
      setAvatarUploading(false);
    }
  };

  // Stats state
  const [stats, setStats] = useState({ lecturesCount: 0, docsCount: 0 });

  // Password state
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);

  useEffect(() => {
    const activeUser = getStoredAuthUser();
    setUser(activeUser);
    
    // Fetch stats
    const fetchStats = async () => {
      try {
        const [projects, docs] = await Promise.all([
          listEditorProjects(100, 0),
          listSecureDocuments()
        ]);
        setStats({
          lecturesCount: projects?.length || 0,
          docsCount: docs?.length || 0
        });
      } catch (err) {
        console.error("Failed to load profile stats", err);
      }
    };
    fetchStats();
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
      {/* Premium Profile Banner Header */}
      <div className="bg-white rounded-3xl border border-slate-100 shadow-lg overflow-hidden relative">
        <div className="h-32 bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.15),transparent)] animate-pulse duration-[8000ms]" />
          <div className="absolute -bottom-10 -right-10 w-40 h-40 bg-white/10 rounded-full blur-2xl" />
        </div>
        <div className="px-8 pb-8 pt-4 relative bg-white">
          <div className="flex flex-col md:flex-row items-center md:items-end gap-5 justify-between">
            <div className="flex flex-col md:flex-row items-center md:items-end gap-5">
              {/* Avatar container has negative margin only to lift it above the banner */}
              <div className="relative z-10 -mt-20 md:-mt-20 flex-shrink-0">
                <div 
                  onClick={() => !avatarUploading && fileInputRef.current?.click()}
                  className="w-28 h-28 rounded-full shadow-xl border-4 border-white bg-white group cursor-pointer overflow-hidden relative"
                  title="Click để thay đổi ảnh đại diện"
                >
                  <img
                    src={getAvatarUrl(user)}
                    alt="Avatar"
                    className="w-full h-full rounded-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-black/45 rounded-full flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200 text-white text-[10px] font-bold">
                    <Camera size={18} className="mb-0.5 text-white" />
                    Thay đổi
                  </div>
                  {avatarUploading && (
                    <div className="absolute inset-0 bg-black/60 rounded-full flex items-center justify-center text-white">
                      <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    </div>
                  )}
                </div>
                <div className="absolute bottom-0.5 right-0.5 w-6 h-6 bg-emerald-500 border-4 border-white rounded-full z-20" title="Online" />
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleAvatarChange}
                  accept="image/*"
                  className="hidden"
                />
              </div>
              <div className="text-center md:text-left pt-2">
                <h2 className="text-2xl font-bold text-gray-900 flex items-center justify-center md:justify-start gap-2">
                  {user?.username}
                  {user?.role === "admin" && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-100 text-purple-700 border border-purple-200">
                      <Shield size={12} /> Admin
                    </span>
                  )}
                </h2>
                <div className="flex flex-wrap items-center justify-center md:justify-start gap-4 mt-2 text-sm text-gray-500 font-medium">
                  <span className="flex items-center gap-1.5">
                    <Mail size={15} className="text-slate-400" />
                    {user?.email}
                  </span>
                  <span className="w-1.5 h-1.5 bg-gray-300 rounded-full hidden sm:inline" />
                  <span className="flex items-center gap-1.5">
                    <Activity size={15} className="text-emerald-500" />
                    Trạng thái: <span className="text-emerald-600 font-semibold">Hoạt động</span>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Account Statistics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm hover:shadow-md transition-shadow flex items-center gap-4">
          <div className="p-3.5 bg-blue-50 text-blue-600 rounded-xl">
            <BookOpen size={24} />
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Bài giảng đã tạo</p>
            <p className="text-2xl font-bold text-gray-900 mt-0.5">{stats.lecturesCount}</p>
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm hover:shadow-md transition-shadow flex items-center gap-4">
          <div className="p-3.5 bg-indigo-50 text-indigo-600 rounded-xl">
            <FileText size={24} />
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Tài liệu học tập</p>
            <p className="text-2xl font-bold text-gray-900 mt-0.5">{stats.docsCount}</p>
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm hover:shadow-md transition-shadow flex items-center gap-4">
          <div className="p-3.5 bg-purple-50 text-purple-600 rounded-xl">
            <Calendar size={24} />
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Vai trò tài khoản</p>
            <p className="text-lg font-bold text-purple-700 mt-1 capitalize">{user?.role === "admin" ? "Giảng viên cấp cao" : "Thành viên RAG"}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Profile Form */}
        <div className="bg-white rounded-3xl p-6 border border-slate-100 shadow-md">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 bg-blue-50 text-blue-600 rounded-xl">
              <User size={20} />
            </div>
            <h3 className="text-lg font-bold text-gray-900">Thông tin cá nhân</h3>
          </div>
          
          <form onSubmit={handleUpdateProfile} className="space-y-5">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Tên người dùng</label>
              <div className="relative">
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full pl-4 pr-10 py-2.5 rounded-xl border border-gray-200 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-medium text-gray-900"
                />
                <User className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
              </div>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Địa chỉ Email</label>
              <div className="relative">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-4 pr-10 py-2.5 rounded-xl border border-gray-200 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-medium text-gray-900"
                />
                <Mail className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
              </div>
            </div>
            <div className="pt-2">
              <button
                type="submit"
                disabled={profileLoading || (username === user?.username && email === user?.email)}
                className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white py-2.5 px-4 rounded-xl font-semibold shadow-sm hover:bg-blue-700 active:bg-blue-800 disabled:opacity-60 disabled:cursor-not-allowed transition-all"
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
        <div className="bg-white rounded-3xl p-6 border border-slate-100 shadow-md">
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
                className="w-full flex items-center justify-center gap-2 bg-indigo-600 text-white py-2.5 px-4 rounded-xl font-semibold shadow-sm hover:bg-indigo-700 active:bg-indigo-800 disabled:opacity-60 disabled:cursor-not-allowed transition-all"
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
