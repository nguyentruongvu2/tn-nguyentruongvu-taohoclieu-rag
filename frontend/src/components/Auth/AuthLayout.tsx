import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { 
  Sparkles, 
  BookOpen, 
  ShieldCheck, 
  LogIn,
  UserPlus
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
        
        {/* Left Side - Hero/Branding */}
        <div className="flex flex-col justify-center px-4 lg:pr-12 pt-8 lg:pt-0">
          <div className="flex items-center gap-2.5 mb-10 lg:mb-16">
            <div className="bg-gradient-to-br from-blue-600 to-indigo-600 p-2.5 rounded-xl shadow-lg shadow-indigo-200">
              <Sparkles className="text-white w-6 h-6" />
            </div>
            <span className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-gray-900 to-gray-700 tracking-tight">
              EduRAG
            </span>
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-gray-900 leading-[1.15] tracking-tight mb-6">
            Tạo bài giảng <br className="hidden sm:block" />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-600">AI</span> từ tài liệu của bạn
          </h1>
          
          <p className="text-lg text-gray-600 mb-10 max-w-xl leading-relaxed">
            Biến tài liệu thành bài giảng chất lượng chỉ trong vài giây với RAG & AI. Nền tảng thông minh hỗ trợ giáo viên và giảng viên tối ưu hóa quy trình chuẩn bị.
          </p>

          <div className="space-y-6">
            {[
              {
                icon: BookOpen,
                title: "Kho tri thức cá nhân",
                desc: "Lưu trữ và quản lý tài liệu an toàn, dễ dàng truy xuất."
              },
              {
                icon: Sparkles,
                title: "Tạo nội dung với AI",
                desc: "AI hiểu ngữ cảnh, hỗ trợ tạo bài giảng, tóm tắt và trích xuất thông tin."
              },
              {
                icon: ShieldCheck,
                title: "Bảo mật dữ liệu",
                desc: "Dữ liệu của bạn được mã hóa và bảo vệ bằng mã hóa tiêu chuẩn."
              }
            ].map((feature, idx) => (
              <div key={idx} className="flex items-start gap-4 group">
                <div className="mt-1 bg-white p-2.5 rounded-xl shadow-sm border border-gray-100 group-hover:border-indigo-100 group-hover:shadow-md transition-all duration-300">
                  <feature.icon className="w-5 h-5 text-indigo-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900 mb-1">{feature.title}</h3>
                  <p className="text-sm text-gray-500 leading-relaxed">{feature.desc}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="hidden lg:flex items-center gap-3 mt-16 text-sm text-gray-500 font-medium">
            <ShieldCheck className="w-4 h-4 text-green-500" />
            <span>EduRAG cam kết bảo mật cấp doanh nghiệp theo ISO 27001</span>
          </div>
        </div>

        {/* Right Side - Auth Forms */}
        <div className="flex flex-col items-center justify-center lg:justify-end">
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
          
          <div className="lg:hidden flex items-center gap-3 mt-8 bg-white/50 backdrop-blur px-5 py-3 rounded-xl shadow-sm border border-gray-100 text-sm text-gray-500 font-medium w-full max-w-[440px]">
            <ShieldCheck className="w-5 h-5 text-green-500 flex-shrink-0" />
            <span className="leading-tight text-xs sm:text-sm">Cam kết bảo mật dữ liệu cấp doanh nghiệp <br/><span className="text-gray-400">Tiêu chuẩn ISO 27001</span></span>
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
