/**
 * messages.ts — Centralized Vietnamese UI string constants.
 *
 * WHY: Prevents hardcoded strings scattered across components.
 * HOW: All user-facing text references MSG.* — one place to change/translate.
 *
 * Convention:
 *   MSG.error.*  — error & failure messages
 *   MSG.quiz.*   — quiz page strings
 *   MSG.slide.*  — slide page strings
 *   MSG.api.*    — generic API/network error messages
 *   MSG.auth.*   — authentication messages
 *   MSG.common.* — shared labels (back, retry, loading…)
 */

export const MSG = {
  // ── Common labels ──────────────────────────────────────────────────────────
  common: {
    back: "← Quay lại",
    retry: "Thử lại",
    loading: "Đang tải...",
    saving: "Đang lưu...",
    saved: "Đã lưu",
    cloudSaving: "☁ Đang lưu...",
    cloudSaved: "☁ Đã lưu",
    delete: "Xóa",
    cancel: "Hủy",
    confirm: "Xác nhận",
    close: "Đóng",
  },

  // ── API / Network errors ───────────────────────────────────────────────────
  api: {
    sessionExpired:
      "Phiên đăng nhập không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại.",
    serverError: (status: number) =>
      `Lỗi máy chủ (${status}). Vui lòng thử lại.`,
    noResponse:
      "Không nhận được phản hồi từ máy chủ. Vui lòng kiểm tra backend.",
    invalidData: "Dữ liệu không hợp lệ. Vui lòng kiểm tra lại thông tin.",
    requestError: (msg: string) => `Lỗi gửi yêu cầu: ${msg}`,
    noServer: "Không kết nối được server. Kiểm tra Docker đang chạy.",
    unknownError: "Đã xảy ra lỗi không xác định.",
  },

  // ── Authentication ─────────────────────────────────────────────────────────
  auth: {
    loginFailed: "Đăng nhập thất bại.",
    registerFailed: "Đăng ký thất bại.",
    unknownLogin: "Lỗi không xác định trong quá trình đăng nhập.",
    unknownRegister: "Lỗi không xác định trong quá trình đăng ký.",
    unknownProfile: "Lỗi không xác định khi tải thông tin tài khoản.",
  },

  // ── Quiz page ──────────────────────────────────────────────────────────────
  quiz: {
    loadingQuestions: "Đang tạo câu hỏi quiz...",
    notFound:
      "Không tìm thấy dữ liệu quiz. Vui lòng quay lại bài giảng.",
    dataError: "Lỗi tải dữ liệu quiz.",
    generateError: "Lỗi tạo quiz. Vui lòng thử lại.",
    noValidQuestions:
      "Không tạo được câu hỏi hợp lệ. Nội dung bài giảng có thể quá ngắn.",
    saveFailed: (detail: string) => `Lưu kết quả thất bại: ${detail}`,
    statsFailed: "Lấy thống kê thất bại.",
    llmFailed: "Tạo quiz thất bại. Vui lòng thử lại.",
    backToLesson: "← Quay lại bài giảng",
    regenerate: "🔀 Câu hỏi mới",
    submit: "Nộp bài →",
    title: "📝 Luyện tập Quiz",
    answered: (done: number, total: number) =>
      `${done}/${total} câu đã trả lời`,
    unanswered: (n: number) => `⚠ Còn ${n} câu chưa trả lời`,
    allAnswered: (total: number) => `✓ Đã trả lời tất cả ${total} câu`,
    seed: (s: number) => `seed #${s}`,
  },

  // ── Slide page ─────────────────────────────────────────────────────────────
  slide: {
    notFound:
      "Không tìm thấy nội dung bài giảng. Vui lòng quay lại editor và nhấn '🖼️ Tạo Slide'.",
    dataError: "Dữ liệu khởi tạo bị lỗi. Vui lòng quay lại editor.",
    generateFailed: "Tạo slide thất bại. Vui lòng thử lại.",
    emptyFile: "File xuất ra bị rỗng. Vui lòng thử lại.",
    downloadFailed: "Tải xuống thất bại. Vui lòng thử lại.",
    pptxEmpty:
      "File PPTX rỗng — python-pptx chưa được cài (cần rebuild Docker).",
    pptxFailed: "Xuất PPTX thất bại.",
    pdfEmpty: "File PDF rỗng.",
    pdfFailed: "Xuất PDF thất bại.",
    serverError: "Lỗi server.",
    pptxNotAvailable: "⚠ PPTX không khả dụng",
    pptxNotInstalled: "python-pptx chưa được cài",
    generating: (n: number) =>
      `Đang phân tích nội dung và tạo ${n} slide...`,
    title: "🖼️ Tạo Slide tự động",
    autosaved: "✓ Đã tự lưu",
    draftRestored: (age: string, count: number) =>
      `💾 Đã khôi phục bản nháp (${age}) — ${count} slide.`,
    deleteDraft: "Xóa bản nháp",
    unknownError: "Không rõ lỗi",
  },

  // ── Error messages (generic backend detail strings) ────────────────────────
  error: {
    fieldInvalid: (field: string, msg: string) => `${field}: ${msg}`,
    unknownValidation: "Dữ liệu không hợp lệ.",
  },
} as const;
