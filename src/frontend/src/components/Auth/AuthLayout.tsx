import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { 
  BookOpen, 
  LogIn,
  UserPlus,
  HelpCircle
} from 'lucide-react';

interface AuthLayoutProps {
  children: React.ReactNode;
  isLogin: boolean;
}

export const AuthLayout: React.FC<AuthLayoutProps> = ({ children, isLogin }) => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen w-full bg-[#f8f9fc] flex items-center justify-center p-4 sm:p-6 lg:p-8 font-sans relative overflow-hidden text-left">
      {/* Background Decorative Gradients */}
      <div className="absolute top-0 left-0 w-[500px] h-[500px] bg-blue-400/20 rounded-full mix-blend-multiply filter blur-[80px] opacity-70 animate-blob" />
      <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-indigo-400/20 rounded-full mix-blend-multiply filter blur-[80px] opacity-70 animate-blob" style={{ animationDelay: '2s' }} />
      <div className="absolute -bottom-32 left-1/2 -content-x-1/2 w-[500px] h-[500px] bg-purple-400/20 rounded-full mix-blend-multiply filter blur-[80px] opacity-70 animate-blob" style={{ animationDelay: '4s' }} />

      <div className="max-w-6xl w-full grid lg:grid-cols-2 gap-8 lg:gap-12 relative z-10">
        
        {/* Left Side - Academic/Branding */}
        <div className="flex flex-col justify-center px-4 lg:pr-8 pt-6 lg:pt-0">
          {/* Logo */}
          <div className="flex items-center gap-3 mb-8 lg:mb-12">
            <BookOpen className="text-blue-600 w-8 h-8 stroke-[1.5]" />
            <span className="text-2xl font-extrabold text-slate-800 tracking-tight">
              EduRAG
            </span>
          </div>

          {/* Hero Section */}
          <h1 className="text-4xl sm:text-5xl lg:text-5xl font-bold text-slate-900 leading-tight tracking-tight mb-5">
            Hỗ trợ xây dựng học liệu giảng dạy bằng AI
          </h1>
          
          <p className="text-slate-600 text-base sm:text-lg mb-10 leading-relaxed max-w-xl">
            Hệ thống hỗ trợ giảng viên tạo tài liệu giảng dạy và ngân hàng câu hỏi từ đề cương môn học cùng các giáo trình, tài liệu tham khảo bằng kỹ thuật Retrieval-Augmented Generation (RAG).
          </p>

          {/* Feature Cards */}
          <div className="grid sm:grid-cols-2 gap-5 mb-10">
            <div className="bg-white border border-slate-100 rounded-2xl p-6 shadow-sm">
              <div className="flex items-center gap-2 mb-4">
                <BookOpen className="text-blue-600 w-6 h-6 stroke-[1.5]" />
                <h3 className="font-bold text-slate-900 text-base">Tài liệu giảng dạy</h3>
              </div>
              <ul className="text-slate-600 text-sm space-y-2 list-disc list-inside leading-relaxed">
                <li>Tự động tạo nội dung bài giảng theo đề cương môn học.</li>
                <li>Khai thác tri thức từ giáo trình và tài liệu tham khảo.</li>
              </ul>
            </div>

            <div className="bg-white border border-slate-100 rounded-2xl p-6 shadow-sm">
              <div className="flex items-center gap-2 mb-4">
                <HelpCircle className="text-blue-600 w-6 h-6 stroke-[1.5]" />
                <h3 className="font-bold text-slate-900 text-base">Ngân hàng câu hỏi</h3>
              </div>
              <ul className="text-slate-600 text-sm space-y-2 list-disc list-inside leading-relaxed">
                <li>Sinh câu hỏi trắc nghiệm kèm đáp án và giải thích.</li>
                <li>Hỗ trợ xuất dữ liệu phục vụ giảng dạy.</li>
              </ul>
            </div>
          </div>

          {/* Usage Steps */}
          <div className="pt-8 border-t border-slate-200/60">
            <h4 className="text-sm font-extrabold text-slate-400 uppercase tracking-wider mb-5">Quy trình sử dụng</h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
              {[
                { step: "01", text: "Tải lên đề cương môn học" },
                { step: "02", text: "Bổ sung tài liệu học tập" },
                { step: "03", text: "AI hỗ trợ tạo bài học & câu hỏi" },
                { step: "04", text: "Xuất kết quả phục vụ giảng dạy" }
              ].map((item, idx) => (
                <div key={idx} className="space-y-1.5">
                  <div className="text-blue-600 font-bold text-sm font-mono">{item.step}</div>
                  <div className="text-slate-600 text-xs sm:text-sm font-medium leading-relaxed">{item.text}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-col items-center justify-center">
          <div className="w-full max-w-[440px]">
            
            {/* Tab Switcher */}
            <div className="flex bg-gray-200/50 hover:bg-gray-200/80 backdrop-blur-md p-1.5 rounded-2xl mb-6 transition-all shadow-inner border border-white/40">
              <button
                type="button"
                onClick={() => navigate('/login')}
                className={`flex-1 py-2.5 text-sm font-semibold rounded-xl transition-all duration-300 flex items-center justify-center gap-2
                  ${isLogin ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >
                Đăng nhập
              </button>
              <button
                type="button"
                onClick={() => navigate('/register')}
                className={`flex-1 py-2.5 text-sm font-semibold rounded-xl transition-all duration-300 flex items-center justify-center gap-2
                  ${!isLogin ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >
                Đăng ký
              </button>
            </div>

            {/* Auth Card */}
            <div className="bg-white/70 backdrop-blur-xl border border-white/60 p-8 sm:p-10 rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.06)] relative overflow-hidden">
              {/* Subtle top glare */}
              <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-white to-transparent opacity-80" />

              <div className="mb-8">
                <div className="w-12 h-12 bg-indigo-50 border border-indigo-100 text-indigo-600 rounded-2xl flex items-center justify-center mb-5">
                  {isLogin ? <LogIn className="w-6 h-6" /> : <UserPlus className="w-6 h-6" />}
                </div>
                <h2 className="text-2xl font-bold text-gray-900 mb-2">
                  {isLogin ? 'Đăng nhập' : 'Đăng ký'}
                </h2>
                <p className="text-sm text-gray-500">
                  {isLogin 
                    ? 'Chào mừng bạn trở lại! Vui lòng đăng nhập để tiếp tục.'
                    : 'Tạo tài khoản để bắt đầu sử dụng EduRAG ngay hôm nay.'}
                </p>
              </div>

              {children}

              <div className="mt-8 text-center sm:hidden">
                 <p className="text-sm text-gray-600">
                    {isLogin ? "Chưa có tài khoản? " : "Đã có tài khoản? "}
                    <Link 
                      to={isLogin ? "/register" : "/login"}
                      className="font-semibold text-indigo-600 hover:text-indigo-700 hover:underline"
                    >
                      {isLogin ? "Đăng ký ngay" : "Đăng nhập"}
                    </Link>
                 </p>
              </div>

            </div>
          </div>


        </div>
      </div>
      
      {/* Global CSS for shimmer animation */}
      <style>{`
        @keyframes shimmer {
          100% {
            transform: translateX(100%);
          }
        }
        @keyframes blob {
          0% { transform: translate(0px, 0px) scale(1); }
          33% { transform: translate(30px, -50px) scale(1.1); }
          66% { transform: translate(-20px, 20px) scale(0.9); }
          100% { transform: translate(0px, 0px) scale(1); }
        }
        .animate-blob {
          animation: blob 7s infinite;
        }
      `}</style>
    </div>
  );
};
