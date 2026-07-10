import { useState, useEffect, useMemo } from "react";
import {
  Users,
  FileText,
  Activity,
  Trash2,
  LogOut,
  TerminalSquare,
  Search,
  Eye,
  Menu,
  X,
  LayoutDashboard,
  HelpCircle,
  Coins,
  Cpu,
  BookOpen
} from "lucide-react";
import { Link } from "react-router-dom";
import { getAvatarUrl } from "../utils/user_avatar";
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  Legend
} from "recharts";
import ReactMarkdown from "react-markdown";
import {
  adminGetUsers,
  adminGetDocuments,
  adminGetUsage,
  adminGetLogs,
  adminGetStats,
  adminDeleteDocument,
  adminDeleteUser,
  adminSetUserLocked,
  logoutUser,
  getStoredAuthUser,
  getSecureDocumentDetail,
  type AdminUser,
  type AdminDocument,
  type AdminUsageEntry,
  type AdminLogEntry,
  type AdminStats,
} from "../services/api";

type TabKey = "overview" | "users" | "documents" | "usage" | "logs";

const formatFileSize = (bytes?: number) => {
  if (bytes === undefined || bytes === null || bytes === 0) return "—";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
};

export default function AdminDashboard() {
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [documents, setDocuments] = useState<AdminDocument[]>([]);
  const [usage, setUsage] = useState<AdminUsageEntry[]>([]);
  const [logs, setLogs] = useState<AdminLogEntry[]>([]);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [userActionLoadingId, setUserActionLoadingId] = useState<number | null>(null);
  
  // Search & Filter state
  const [searchUser, setSearchUser] = useState("");
  const [filterRole, setFilterRole] = useState<"all" | "admin" | "user">("all");
  const [filterStatus, setFilterStatus] = useState<"all" | "active" | "locked">("all");
  const [searchDoc, setSearchDoc] = useState("");
  
  // Preview state
  const [previewDoc, setPreviewDoc] = useState<AdminDocument | null>(null);
  const [previewMarkdown, setPreviewMarkdown] = useState<string>("");
  const [previewLoading, setPreviewLoading] = useState(false);

  const currentUser = getStoredAuthUser();

  // Derived state (Filtered)
  const filteredUsers = useMemo(() => {
    return users.filter(u => {
      const matchSearch = u.username.toLowerCase().includes(searchUser.toLowerCase()) || u.id.toString().includes(searchUser);
      const matchRole = filterRole === "all" || u.role === filterRole;
      const matchStatus = filterStatus === "all" || (filterStatus === "active" ? u.is_active : !u.is_active);
      return matchSearch && matchRole && matchStatus;
    });
  }, [users, searchUser, filterRole, filterStatus]);

  const filteredDocuments = useMemo(() => {
    return documents.filter(d => 
      d.original_filename.toLowerCase().includes(searchDoc.toLowerCase()) || 
      d.id.toLowerCase().includes(searchDoc.toLowerCase())
    );
  }, [documents, searchDoc]);

  // Derived state (Charts)
  const usageChartData = useMemo(() => {
    const grouped: Record<string, { date: string, llmCalls: number }> = {};
    logs.forEach(log => {
      const dateStr = new Date(log.created_at).toLocaleDateString("vi-VN");
      if (!grouped[dateStr]) grouped[dateStr] = { date: dateStr, llmCalls: 0 };
      grouped[dateStr].llmCalls += (log.llm_calls || 0);
    });
    // Logs are DESC from API, so reverse to make it ASC for chart
    return Object.values(grouped).reverse();
  }, [logs]);

  // Derived state (Document format distribution chart)
  const documentFormatChartData = useMemo(() => {
    const counts: Record<string, number> = { PDF: 0, Word: 0, Text: 0, Markdown: 0 };
    documents.forEach(doc => {
      const ext = doc.original_filename.split(".").pop()?.toLowerCase();
      if (ext === "pdf") counts["PDF"]++;
      else if (ext === "docx" || ext === "doc") counts["Word"]++;
      else if (ext === "txt") counts["Text"]++;
      else if (ext === "md") counts["Markdown"]++;
    });
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .filter(item => item.value > 0);
  }, [documents]);

  // Derived state (AI Calls Trend for Overview page)
  const usageTrendChartData = useMemo(() => {
    const grouped: Record<string, { date: string, llmCalls: number }> = {};
    logs.forEach(log => {
      const dateStr = new Date(log.created_at).toLocaleDateString("vi-VN", { month: "numeric", day: "numeric" });
      if (!grouped[dateStr]) grouped[dateStr] = { date: dateStr, llmCalls: 0 };
      grouped[dateStr].llmCalls += (log.llm_calls || 0);
    });
    return Object.values(grouped).reverse().slice(-7); // Last 7 days trend
  }, [logs]);

  useEffect(() => {
    if (activeTab === "overview") loadStats();
    else if (activeTab === "users") loadUsers();
    else if (activeTab === "documents") loadDocuments();
    else if (activeTab === "usage") loadUsage();
    else if (activeTab === "logs") loadLogs();
  }, [activeTab]);

  const loadStats = async () => {
    setLoading(true);
    try {
      const [statsData, usersData, docsData, logsData] = await Promise.all([
        adminGetStats(),
        adminGetUsers(),
        adminGetDocuments(),
        adminGetLogs(),
      ]);
      setStats(statsData);
      setUsers(usersData);
      setDocuments(docsData);
      setLogs(logsData);
    } catch (e) {
    } finally {
      setLoading(false);
    }
  };
  const loadUsers = async () => {
    setLoading(true);
    try {
      setUsers(await adminGetUsers());
    } catch (e) {
      // toastService handles display via interceptor
    } finally {
      setLoading(false);
    }
  };
  const loadDocuments = async () => {
    setLoading(true);
    try {
      setDocuments(await adminGetDocuments());
    } catch (e) {
    } finally {
      setLoading(false);
    }
  };
  const loadUsage = async () => {
    setLoading(true);
    try {
      setUsage(await adminGetUsage());
    } catch (e) {
    } finally {
      setLoading(false);
    }
  };
  const loadLogs = async () => {
    setLoading(true);
    try {
      setLogs(await adminGetLogs());
    } catch (e) {
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteDocument = async (id: string) => {
    if (!window.confirm("Bạn có chắc muốn xóa tài liệu này?")) return;
    try {
      await adminDeleteDocument(id);
      loadDocuments();
    } catch (e) {
      alert("Xóa thất bại");
    }
  };

  const handlePreviewDocument = async (doc: AdminDocument) => {
    setPreviewDoc(doc);
    setPreviewLoading(true);
    setPreviewMarkdown("");
    try {
      const detail = await getSecureDocumentDetail(doc.id);
      setPreviewMarkdown(detail.markdown || "Tài liệu này không có nội dung.");
    } catch (error) {
      setPreviewMarkdown("Không thể tải nội dung tài liệu. Vui lòng thử lại.");
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleToggleUserLock = async (user: AdminUser) => {
    const isActive = !!user?.is_active;
    const nextLocked = isActive;
    const actionLabel = nextLocked ? "khóa" : "mở khóa";

    if (!window.confirm(`Bạn có chắc muốn ${actionLabel} tài khoản ${user.username}?`)) {
      return;
    }

    setUserActionLoadingId(user.id);
    try {
      await adminSetUserLocked(Number(user.id), nextLocked);
      await loadUsers();
    } catch (e) {
      alert(`${actionLabel} tài khoản thất bại`);
    } finally {
      setUserActionLoadingId(null);
    }
  };

  const handleDeleteUser = async (user: AdminUser) => {
    if (
      !window.confirm(
        `Xóa người dùng ${user.username}? Hệ thống sẽ xóa toàn bộ tài liệu, đoạn chunks và dữ liệu liên quan.`,
      )
    ) {
      return;
    }

    setUserActionLoadingId(user.id);
    try {
      await adminDeleteUser(Number(user.id));
      await loadUsers();
      await loadDocuments();
    } catch (e) {
      alert("Xóa người dùng thất bại");
    } finally {
      setUserActionLoadingId(null);
    }
  };

  const handleLogout = () => {
    logoutUser();
    window.location.href = "/login";
  };

  const NavItem = ({
    icon: Icon,
    label,
    tabKey,
  }: {
    icon: any;
    label: string;
    tabKey: TabKey;
  }) => (
    <button
      onClick={() => {
        setActiveTab(tabKey);
        if (window.innerWidth < 1024) setIsSidebarOpen(false);
      }}
      className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 ${tabKey === activeTab ? "bg-purple-600 text-white shadow-md font-semibold" : "text-gray-600 hover:bg-gray-100 hover:text-gray-900 font-medium"}`}
    >
      <Icon size={20} className={tabKey === activeTab ? "text-white" : "text-gray-500"} /> <span className="font-medium">{label}</span>
    </button>
  );

  return (
    <div className="flex h-screen bg-white overflow-hidden w-full font-sans">
      {isSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-20 lg:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-30 w-72 bg-white text-gray-800 border-r border-gray-200 transform transition-transform duration-300 ease-in-out flex flex-col ${isSidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}
      >
        <div className="p-6 border-b border-gray-200 flex justify-between items-center bg-gray-50/50">
          <Link to="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
            <div className="bg-blue-600 p-2 rounded-xl shadow-sm shadow-blue-200">
              <BookOpen size={24} className="text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900 leading-tight">
                EduRAG
              </h1>
            </div>
          </Link>
          <button
            className="lg:hidden text-gray-400 hover:text-gray-600"
            onClick={() => setIsSidebarOpen(false)}
          >
            <X size={24} />
          </button>
        </div>
        <div className="flex-1 px-4 py-6 space-y-2 overflow-y-auto flex flex-col justify-between">
          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4 px-2">
              Quản trị hệ thống
            </p>
            <NavItem icon={LayoutDashboard} label="Thống kê hệ thống" tabKey="overview" />
            <NavItem icon={Users} label="Quản lý người dùng" tabKey="users" />
            <NavItem
              icon={FileText}
              label="Quản lý tài liệu"
              tabKey="documents"
            />
            <NavItem icon={Activity} label="Thống kê API Usage" tabKey="usage" />
            <NavItem icon={TerminalSquare} label="System Logs" tabKey="logs" />
          </div>
        </div>
        <div className="p-4 border-t border-gray-200 bg-gray-50/30">
          <div className="bg-gray-50 rounded-xl p-4 flex flex-col items-center border border-slate-200">
            <img
              src={getAvatarUrl(currentUser)}
              alt="Avatar"
              className="w-12 h-12 rounded-full object-cover border border-gray-200 shadow-sm mb-2"
            />
            <p className="text-sm font-bold text-gray-900 truncate w-full text-center">
              {currentUser?.username || "Admin"}
            </p>
            <p className="text-xs text-gray-500 mb-4">Admin</p>
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 text-sm text-red-600 hover:text-red-700 hover:bg-red-50 border border-transparent hover:border-red-100 py-2 px-4 rounded-lg w-full justify-center transition-colors font-medium"
            >
              <LogOut size={16} /> <span>Đăng xuất</span>
            </button>
          </div>
        </div>
      </aside>
      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-4 lg:px-8 shrink-0 shadow-sm z-10">
          <div className="flex items-center gap-4">
            <button
              className="lg:hidden text-gray-600 hover:bg-gray-100 p-2 rounded-lg"
              onClick={() => setIsSidebarOpen(true)}
            >
              <Menu size={24} />
            </button>
            <h2 className="text-xl font-bold text-gray-800 hidden sm:block">
              {activeTab === "overview" && "Thống kê hệ thống"}
              {activeTab === "users" && "Quản lý người dùng"}
              {activeTab === "documents" && "Quản lý tài liệu"}
              {activeTab === "usage" && "Thống kê & API Usage"}
              {activeTab === "logs" && "Logs hệ thống"}
            </h2>
          </div>
          <div className="flex items-center">
          </div>
        </header>
        <main className="flex-1 overflow-auto p-4 lg:p-8 bg-slate-100/60">
          <div className="max-w-7xl mx-auto h-full flex flex-col gap-6">
            {/* Summary Cards & Charts */}
            {activeTab === "overview" && (
              <div className="flex flex-col gap-6 w-full animate-in fade-in slide-in-from-bottom-4 duration-500">
                {/* Summary Cards Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                  <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex items-center gap-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-md hover:border-slate-300/80">
                    <div className="p-4 bg-blue-50 text-blue-600 rounded-2xl border border-blue-100/50 shrink-0">
                      <Users size={26} />
                    </div>
                    <div>
                      <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Tổng người dùng</h3>
                      <p className="text-3xl font-extrabold text-gray-900 mt-1 leading-tight">{stats?.total_users ?? 0}</p>
                    </div>
                  </div>

                  <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex items-center gap-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-md hover:border-slate-300/80">
                    <div className="p-4 bg-indigo-50 text-indigo-600 rounded-2xl border border-indigo-100/50 shrink-0">
                      <FileText size={26} />
                    </div>
                    <div>
                      <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Tổng số dự án</h3>
                      <p className="text-3xl font-extrabold text-gray-900 mt-1 leading-tight">{stats?.total_projects ?? 0}</p>
                    </div>
                  </div>

                  <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex items-center gap-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-md hover:border-slate-300/80">
                    <div className="p-4 bg-emerald-50 text-emerald-600 rounded-2xl border border-emerald-100/50 shrink-0">
                      <FileText size={26} />
                    </div>
                    <div>
                      <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Tổng tài liệu</h3>
                      <p className="text-3xl font-extrabold text-gray-900 mt-1 leading-tight">{stats?.total_documents ?? 0}</p>
                    </div>
                  </div>

                  <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex items-center gap-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-md hover:border-slate-300/80">
                    <div className="p-4 bg-amber-50 text-amber-600 rounded-2xl border border-amber-100/50 shrink-0">
                      <HelpCircle size={26} />
                    </div>
                    <div>
                      <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Ngân hàng câu hỏi</h3>
                      <p className="text-3xl font-extrabold text-gray-900 mt-1 leading-tight">{stats?.total_quizzes ?? 0}</p>
                    </div>
                  </div>

                  <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex items-center gap-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-md hover:border-slate-300/80">
                    <div className="p-4 bg-rose-50 text-rose-600 rounded-2xl border border-rose-100/50 shrink-0">
                      <Cpu size={26} />
                    </div>
                    <div>
                      <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Tổng lượt gọi AI</h3>
                      <p className="text-3xl font-extrabold text-gray-900 mt-1 leading-tight">{(stats?.total_llm_calls ?? 0).toLocaleString("vi-VN")}</p>
                    </div>
                  </div>

                  <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex items-center gap-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-md hover:border-slate-300/80">
                    <div className="p-4 bg-teal-50 text-teal-600 rounded-xl border border-teal-100/50 shrink-0">
                      <Coins size={26} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Tổng số token</h3>
                      <div className="flex items-baseline gap-3 flex-wrap mt-1">
                        <p className="text-2xl font-extrabold text-gray-900">
                          {(stats?.total_tokens ?? 0).toLocaleString("vi-VN")}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Charts Section */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* Left Area Chart - AI Calls Trend */}
                  <div className="lg:col-span-2 bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex flex-col justify-between">
                    <h3 className="font-bold text-gray-800 text-sm mb-4">Xu hướng gọi LLM</h3>
                    <div className="w-full h-72">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={usageTrendChartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                          <defs>
                            <linearGradient id="colorCalls" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.2}/>
                              <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0}/>
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                          <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748b' }} />
                          <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748b' }} />
                          <RechartsTooltip contentStyle={{ borderRadius: '12px', border: '1px solid #f1f5f9', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.05)' }} />
                          <Legend verticalAlign="top" height={36} iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                          <Area type="monotone" dataKey="llmCalls" name="Số cuộc gọi LLM" stroke="#8b5cf6" strokeWidth={2} fillOpacity={1} fill="url(#colorCalls)" />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* Right Doughnut Chart - Document Formats */}
                  <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex flex-col justify-between">
                    <h3 className="font-bold text-gray-800 text-sm mb-4">Phân bổ định dạng RAG</h3>
                    <div className="h-56 w-full relative flex-1 min-h-[220px]">
                      {documentFormatChartData.length >= 2 ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={documentFormatChartData}
                              cx="50%"
                              cy="50%"
                              innerRadius={60}
                              outerRadius={80}
                              paddingAngle={4}
                              dataKey="value"
                            >
                              {documentFormatChartData.map((_, index) => {
                                const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ec4899"];
                                return <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />;
                              })}
                            </Pie>
                            <RechartsTooltip contentStyle={{ borderRadius: '12px', border: '1px solid #f1f5f9', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.05)' }} />
                          </PieChart>
                        </ResponsiveContainer>
                      ) : documentFormatChartData.length === 1 ? (
                        <div className="h-full flex flex-col items-center justify-center p-4 text-center">
                          <div className="p-4 bg-blue-50 text-blue-600 rounded-2xl mb-3 border border-blue-100/50">
                            <FileText size={32} />
                          </div>
                          <span className="text-2xl font-black text-slate-800">
                            {documentFormatChartData[0].name}: {documentFormatChartData[0].value} tệp
                          </span>
                          <span className="text-xs text-slate-500 mt-2 font-medium">
                            100% tài liệu hiện có thuộc định dạng {documentFormatChartData[0].name}.
                          </span>
                        </div>
                      ) : (
                        <div className="h-full flex flex-col items-center justify-center p-4 text-center border border-dashed border-gray-200 rounded-xl bg-gray-50/50">
                          <FileText size={32} className="text-gray-300 mb-2" />
                          <span className="text-sm font-semibold text-gray-500">Chưa tải tài liệu nào</span>
                          <span className="text-xs text-gray-400 mt-1">Hỗ trợ các định dạng PDF, DOCX, TXT, MD.</span>
                        </div>
                      )}
                    </div>
                    {/* Legend (only shown when >= 2 formats exist) */}
                    {documentFormatChartData.length >= 2 && (
                      <div className="grid grid-cols-2 gap-2 text-xs font-semibold text-gray-600 mt-4 border-t border-gray-50 pt-4">
                        {documentFormatChartData.map((item, index) => {
                          const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ec4899"];
                          return (
                            <div key={item.name} className="flex items-center gap-2">
                              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: COLORS[index % COLORS.length] }}></span>
                              <span className="truncate">{item.name}: {item.value} tệp</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {activeTab === "users" && (
              <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                  <div className="p-6 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 w-full">
                      <h3 className="font-bold text-lg text-gray-900 whitespace-nowrap">
                        Người dùng ({filteredUsers.length})
                      </h3>
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="relative">
                          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                          <input type="text" placeholder="Tìm kiếm..." value={searchUser} onChange={e => setSearchUser(e.target.value)} className="pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm w-full sm:w-64 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500" />
                        </div>
                        <select value={filterRole} onChange={e => setFilterRole(e.target.value as any)} className="py-2 pl-3 pr-8 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500">
                          <option value="all">Tất cả Vai trò</option>
                          <option value="admin">Quản trị viên</option>
                          <option value="user">Giảng viên</option>
                        </select>
                        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as any)} className="py-2 pl-3 pr-8 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500">
                          <option value="all">Tất cả Trạng thái</option>
                          <option value="active">Hoạt động</option>
                          <option value="locked">Đã khóa</option>
                        </select>
                      </div>
                    </div>
                    <button
                      onClick={loadUsers}
                      className="text-sm px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg font-medium shrink-0"
                    >
                      Tải lại
                    </button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                      <thead className="bg-gray-50 text-gray-600 font-medium border-b border-gray-200 uppercase text-xs">
                        <tr>
                          <th className="px-6 py-4">ID</th>
                          <th className="px-6 py-4">Username</th>
                          <th className="px-6 py-4">Role</th>
                          <th className="px-6 py-4">Số Project</th>
                          <th className="px-6 py-4">Số Tài liệu</th>
                          <th className="px-6 py-4">Trạng thái</th>
                          <th className="px-6 py-4">Hành động</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {loading ? (
                          <tr>
                            <td
                              colSpan={7}
                              className="px-6 py-8 text-center text-gray-500"
                            >
                              Đang tải...
                            </td>
                          </tr>
                        ) : (
                          filteredUsers.map((u) => (
                            <tr key={u.id}>
                              <td className="px-6 py-4 font-mono text-xs text-gray-500">
                                {u.id}
                              </td>
                              <td className="px-6 py-4 font-medium text-gray-900">
                                {u.username}
                              </td>
                              <td className="px-6 py-4">
                                <span
                                  className={`px-2.5 py-1 rounded-full text-xs font-bold ${u.role === "admin" ? "bg-purple-100 text-purple-700" : "bg-gray-100 text-gray-700"}`}
                                >
                                  {u.role}
                                </span>
                              </td>
                              <td className="px-6 py-4 text-center font-semibold text-gray-700">
                                {u.projects_count ?? 0}
                              </td>
                              <td className="px-6 py-4 text-center font-semibold text-gray-700">
                                {u.documents_count ?? 0}
                              </td>
                              <td className="px-6 py-4">
                                {u.is_active ? (
                                  <span className="text-green-600 font-medium whitespace-nowrap">
                                    <span className="inline-block w-2 h-2 rounded-full bg-green-500 mr-2"></span>
                                    Hoạt động
                                  </span>
                                ) : (
                                  <span className="text-red-600 font-medium whitespace-nowrap">
                                    <span className="inline-block w-2 h-2 rounded-full bg-red-500 mr-2"></span>
                                    Đã khóa
                                  </span>
                                )}
                              </td>
                              <td className="px-6 py-4">
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={() => handleToggleUserLock(u)}
                                    disabled={userActionLoadingId === u.id || currentUser?.user_id === u.id}
                                    className="text-xs px-3 py-1.5 rounded-lg bg-amber-50 text-amber-700 hover:bg-amber-100 disabled:opacity-50 disabled:cursor-not-allowed"
                                  >
                                    {u.is_active ? "Khóa" : "Mở khóa"}
                                  </button>
                                  <button
                                    onClick={() => handleDeleteUser(u)}
                                    disabled={userActionLoadingId === u.id || currentUser?.user_id === u.id}
                                    className="p-2 text-red-500 hover:bg-red-50 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                                    title="Xóa người dùng và dữ liệu liên quan"
                                  >
                                    <Trash2 size={16} />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
            {activeTab === "documents" && (
              <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                  <div className="p-6 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 w-full">
                      <h3 className="font-bold text-lg text-gray-900 whitespace-nowrap">
                        Tài liệu ({filteredDocuments.length})
                      </h3>
                      <div className="flex items-center gap-2 w-full max-w-md">
                        <div className="relative w-full">
                          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                          <input type="text" placeholder="Tìm kiếm tên file hoặc ID..." value={searchDoc} onChange={e => setSearchDoc(e.target.value)} className="pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm w-full focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500" />
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={loadDocuments}
                      className="text-sm px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg font-medium shrink-0"
                    >
                      Tải lại
                    </button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                      <thead className="bg-gray-50 text-gray-600 font-medium border-b border-gray-200 uppercase text-xs">
                        <tr>
                          <th className="px-6 py-4">Tên Tài liệu</th>
                          <th className="px-6 py-4">User ID</th>
                          <th className="px-6 py-4">Chunks</th>
                          <th className="px-6 py-4">Dung lượng</th>
                          <th className="px-6 py-4">Ngày tải</th>
                          <th className="px-6 py-4">Hành động</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {loading ? (
                          <tr>
                            <td
                              colSpan={6}
                              className="px-6 py-8 text-center text-gray-500"
                            >
                              Đang tải...
                            </td>
                          </tr>
                        ) : (
                          filteredDocuments.map((doc) => (
                            <tr key={doc.id}>
                              <td className="px-6 py-4 font-medium text-gray-900">
                                {doc.original_filename}
                              </td>
                              <td className="px-6 py-4 font-mono text-xs text-gray-500">
                                {doc.user_id}
                              </td>
                              <td className="px-6 py-4">{doc.chunks_count}</td>
                              <td className="px-6 py-4 font-mono text-xs text-gray-600 whitespace-nowrap">
                                {formatFileSize(doc.file_size)}
                              </td>
                              <td className="px-6 py-4 text-gray-500 whitespace-nowrap">
                                {new Date(doc.created_at).toLocaleDateString("vi-VN", {
                                  year: "numeric",
                                  month: "2-digit",
                                  day: "2-digit",
                                  hour: "2-digit",
                                  minute: "2-digit"
                                })}
                              </td>
                              <td className="px-6 py-4">
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={() => handlePreviewDocument(doc)}
                                    className="p-2 text-blue-500 hover:bg-blue-50 rounded-lg"
                                    title="Xem nội dung"
                                  >
                                    <Eye size={18} />
                                  </button>
                                  <button
                                    onClick={() => handleDeleteDocument(doc.id)}
                                    className="p-2 text-red-500 hover:bg-red-50 rounded-lg"
                                    title="Xóa tài liệu"
                                  >
                                    <Trash2 size={18} />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
            {activeTab === "usage" && (
              <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                  <div className="p-6 border-b border-slate-200 flex items-center justify-between">
                    <h3 className="font-bold text-lg text-gray-900">
                      Thống kê Tokens
                    </h3>{" "}
                    <button
                      onClick={loadUsage}
                      className="text-sm px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg font-medium"
                    >
                      Tải lại
                    </button>
                  </div>
                  
                  {/* Chart Section */}
                  {usageChartData.length > 0 && (
                    <div className="p-6 border-b border-slate-200 bg-gray-50/30">
                      <h4 className="text-sm font-semibold text-gray-700 mb-4">Biểu đồ Gọi LLM theo thời gian</h4>
                      <div className="h-64 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={usageChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                            <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{fontSize: 12, fill: '#6b7280'}} />
                            <YAxis axisLine={false} tickLine={false} tick={{fontSize: 12, fill: '#6b7280'}} />
                            <RechartsTooltip cursor={{fill: '#f3f4f6'}} contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}} />
                            <Bar dataKey="llmCalls" name="LLM Calls" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  )}

                  <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                      <thead className="bg-gray-50 text-gray-600 font-medium border-b border-gray-200 uppercase text-xs">
                        <tr>
                          <th className="px-6 py-4">Username</th>
                          <th className="px-6 py-4">Role</th>
                          <th className="px-6 py-4">Requests</th>
                          <th className="px-6 py-4">LLM Calls</th>
                          <th className="px-6 py-4">Tokens Used</th>
                          <th className="px-6 py-4">Last Activity</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {loading ? (
                          <tr>
                            <td
                              colSpan={5}
                              className="px-6 py-8 text-center text-gray-500"
                            >
                              Đang tải...
                            </td>
                          </tr>
                        ) : (
                          usage.map((u, i) => (
                            <tr key={i}>
                              <td className="px-6 py-4 font-medium text-gray-900">
                                {u.username}
                              </td>
                              <td className="px-6 py-4">
                                <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                                  u.role === "admin" ? "bg-purple-100 text-purple-700" : "bg-gray-100 text-gray-700"
                                }`}>{u.role}</span>
                              </td>
                              <td className="px-6 py-4 text-blue-600 font-medium">
                                {u.request_count ?? 0}
                              </td>
                              <td className="px-6 py-4 text-violet-600 font-medium">
                                {u.llm_calls ?? 0}
                              </td>
                              <td className="px-6 py-4 text-green-600 font-medium">
                                {u.token_usage ?? 0}
                              </td>
                              <td className="px-6 py-4 text-gray-500">
                                {u.last_activity
                                  ? new Date(u.last_activity).toLocaleString("vi-VN")
                                  : "—"}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
            {activeTab === "logs" && (
              <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 h-full flex flex-col">
                <div className="bg-gray-950 rounded-2xl shadow-sm border border-gray-800 overflow-hidden flex flex-col flex-1 min-h-[500px]">
                  <div className="p-4 border-b border-gray-800 flex items-center justify-between bg-black">
                    <h3 className="font-bold text-white flex items-center gap-2">
                      <TerminalSquare className="text-gray-400" size={18} />{" "}
                      System Terminal Logs
                    </h3>{" "}
                    <button
                      onClick={loadLogs}
                      className="text-xs px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded font-mono"
                    >
                      Refresh
                    </button>
                  </div>
                  <div className="flex-1 overflow-auto p-4 bg-gray-950 font-mono text-xs text-gray-300">
                    {loading ? (
                      <div className="text-center p-8">Loading logs...</div>
                    ) : (
                      logs.map((log, i) => (
                        <div
                          key={i}
                          className="mb-2 pb-2 border-b border-gray-800/50"
                        >
                          <span className="text-blue-400">
                            [{new Date(log.created_at).toLocaleString("vi-VN")}]
                          </span>{" "}
                          <span className={`font-bold ${
                            log.status_code >= 500 ? "text-red-400" :
                            log.status_code >= 400 ? "text-yellow-400" :
                            "text-green-400"
                          }`}>[{log.status_code}]</span>{" "}
                          <span className="text-purple-400">{log.method}</span>{" "}
                          <span className="text-cyan-400">{log.endpoint}</span>
                          {log.username && (
                            <span className="text-gray-500 ml-2">— {log.username}</span>
                          )}
                          {log.ip_address && (
                            <span className="text-gray-600 ml-2 text-[10px]">({log.ip_address})</span>
                          )}
                          {log.llm_calls > 0 && (
                            <span className="text-amber-400 ml-2 text-[10px]">🤖 {log.llm_calls} LLM calls</span>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>

      {/* Document Preview Modal */}
      {previewDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setPreviewDoc(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-4xl h-[85vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between p-4 border-b border-slate-200 bg-gray-50/50">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-100 text-blue-600 rounded-lg">
                  <FileText size={20} />
                </div>
                <div>
                  <h3 className="font-bold text-gray-900">{previewDoc.original_filename}</h3>
                  <p className="text-xs text-gray-500">ID: {previewDoc.id}</p>
                </div>
              </div>
              <button
                onClick={() => setPreviewDoc(null)}
                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X size={24} />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-6 bg-white">
              {previewLoading ? (
                <div className="space-y-4 animate-pulse">
                  <div className="h-6 bg-slate-200 rounded w-1/3 mb-6"></div>
                  <div className="h-4 bg-slate-100 rounded w-full"></div>
                  <div className="h-4 bg-slate-100 rounded w-5/6"></div>
                  <div className="h-4 bg-slate-100 rounded w-4/5"></div>
                  <div className="h-4 bg-slate-100 rounded w-full"></div>
                </div>
              ) : (
                <div className="prose prose-sm sm:prose-base max-w-none prose-headings:text-gray-900 prose-p:text-gray-700 prose-a:text-blue-600">
                  <ReactMarkdown>{previewMarkdown}</ReactMarkdown>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
