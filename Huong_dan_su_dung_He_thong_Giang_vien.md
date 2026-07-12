# HƯỚNG DẪN SỬ DỤNG HỆ THỐNG HỖ TRỢ BIÊN SOẠN BÀI GIẢNG RAG
## (Dành cho Giảng viên - Tối ưu hóa hiệu quả biên soạn học liệu)

Chào mừng thầy/cô đến với **Hệ thống hỗ trợ biên soạn bài giảng ứng dụng kỹ thuật RAG** (Retrieval-Augmented Generation). Tài liệu này được cập nhật nhằm hướng dẫn chi tiết các tính năng mới nâng cao (Dark Mode, Chỉnh sửa mục lục trực tiếp, Failover Model, Gợi ý Prompt và chèn sơ đồ ảnh) giúp thầy/cô tối ưu hóa quy trình làm việc.

---

## 📌 1. Giới thiệu Nguyên lý hoạt động & Cơ chế API thông minh
Khác với các công cụ chatbot AI thông thường (chỉ trả lời dựa trên tri thức sẵn có của mô hình và dễ gặp hiện tượng "ảo tưởng thông tin"), hệ thống này hoạt động theo nguyên lý:
1.  **RAG (Retrieval-Augmented Generation)**: Hệ thống sử dụng cơ sở dữ liệu Vector **Qdrant** để trích xuất ngữ cảnh chính xác nhất từ tài liệu thầy/cô tải lên trước khi gửi yêu cầu tới mô hình ngôn ngữ lớn (**Google Gemini**).
2.  **Cơ chế dự phòng mô hình (Auto-Failover) (Mới)**: Nếu mô hình chính gặp lỗi quá tải hoặc hết hạn mức gọi API (Quota limit), hệ thống sẽ **tự động chuyển đổi ngầm sang mô hình dự phòng tiếp theo** trong danh sách (ví dụ: chuyển từ `gemini-2.5-flash` sang `gemini-1.5-flash` hoặc `gemini-1.5-pro`) mà không làm gián đoạn quy trình soạn bài của thầy/cô.

---

## 📂 2. Chuẩn bị Học liệu đầu vào (Quyết định chất lượng đầu ra)
Học liệu đầu vào là "xương sống" quyết định tính chính xác của tài liệu được sinh ra:
*   **Định dạng hỗ trợ**: `PDF`, `DOCX`, `TXT` (Kích thước tệp khuyến nghị < 50MB).
*   **Đề cương học phần (Syllabus)**: Nên tải lên tệp đề cương chi tiết chứa đầy đủ Chuẩn đầu ra (CLOs) và Lịch trình giảng dạy. Hệ thống sẽ áp dụng thuật toán **Quét toàn diện hướng Sư phạm** để tự động đối chiếu CLOs, quy định kiến thức và xây dựng cấu trúc bài giảng Level 2, Level 3 chuẩn chỉ theo lộ trình đào tạo của trường học.

---

## 🚀 3. Quy trình sử dụng hệ thống & Vị trí các nút thao tác chính

### 🔐 Bước 1: Đăng nhập hệ thống
*   Truy cập địa chỉ: [http://localhost:3000](http://localhost:3000)
*   Sử dụng tài khoản mẫu:
    *   **Email đăng nhập**: `teacher@local.test`
    *   **Mật khẩu**: `teacher123`
*   *(Nhấp nút **Quên mật khẩu?** ngay dưới ô nhập liệu nếu cần gửi yêu cầu đặt lại mật khẩu).*

### 📁 Bước 2: Tải lên tài liệu tham khảo
1.  Vào menu **Quản lý học liệu** (Document Manager) ở thanh Sidebar trái.
2.  Nhấp nút **Tải tài liệu mới** (Upload), chọn file giáo trình hoặc bài đọc.
3.  Hệ thống hiển thị thanh tiến trình xử lý, khi trạng thái hiển thị tích xanh **Hoàn thành** (Ready), tài liệu đã sẵn sàng.

### 📝 Bước 3: Phê duyệt mục lục & Chỉnh sửa trực tiếp (Inline Edit) (Mới)
Sau khi hệ thống phân tích đề cương học phần, giao diện **Phê duyệt Cấu trúc Mục lục** hiển thị:
*   **Sửa tên đề mục trực tiếp:** Thầy/cô chỉ cần **click chuột trực tiếp vào văn bản của bất kỳ Chương hoặc Mục con nào** trên danh sách để gõ thay đổi tiêu đề. Tiêu đề mới sẽ được tự động lưu ngay lập tức.
*   **Điều chỉnh cấu trúc:**
    *   Sử dụng nút **Grip (Kéo thả)** ở bên trái mỗi mục để sắp xếp lại thứ tự bài học.
    *   Nhấp biểu tượng dấu cộng `+` ở góc phải mục để thêm tiểu mục mới.
    *   Nhấp biểu tượng thùng rác `Trash` để xóa mục không cần thiết.
*   **Xác nhận:** Bấm nút **"Xác nhận & Đồng ý mục lục"** (màu xanh lục, góc trên cùng bên phải) để chuyển sang màn hình Biên soạn chi tiết.

### ✍️ Bước 4: Soạn thảo bài giảng thông minh & Chuyển đổi giao diện
Tại màn hình Soạn thảo tích hợp:

1.  **Chỉnh sửa nhanh Tiêu đề & Prompt yêu cầu:**
    *   Nhấp vào ô tiêu đề lớn ở cột giữa để thay đổi tên bài viết.
    *   Nhấp vào ô **Yêu cầu cho AI (Prompt)** để điều chỉnh hướng dẫn viết bài giảng.
2.  **Sử dụng Trợ lý gợi ý Prompt (Sparkles) (Mới):**
    *   Nhấp vào biểu tượng 🌟 **Sparkles (Lấy gợi ý)** nằm ngay trên góc phải của khung Prompt.
    *   Hộp thoại mở ra cho phép chọn các mẫu Prompt chuẩn hóa: **Lý thuyết** (soạn nội dung chính), **Ví dụ** (tạo ví dụ minh họa thực tế), hoặc **Câu hỏi** (tạo bài tập thảo luận). Thầy/cô chỉ cần bấm nút **Áp dụng** để AI điền tự động.
3.  **Tạo nội dung bài giảng:**
    *   Bấm nút **Tạo nội dung** (màu xanh lam) phía dưới khung prompt. AI sẽ truy xuất RAG và viết nội dung Markdown hiển thị trực tiếp.
4.  **Cú pháp gợi ý vị trí chèn ảnh minh họa AI (Mới):**
    *   Khi viết bài giảng, thầy/cô có thể chèn các ảnh sơ đồ 2D dạng vector vào văn bản Markdown bằng cú pháp đặc biệt sau:
      `![Tên sơ đồ](<[Mô tả chi tiết bằng tiếng Anh về hình vẽ vector 2D, màu nền trắng, không chữ rác]>)`
    *   *Ví dụ:* `![Sơ đồ ba trụ cột quản lý sản phẩm](<[Minimalist 2D vector art, clean design, white background, showing three intersecting circles representing Business, Technology, and User Experience]>)`
    *   Hệ thống có bộ lọc **tự sửa lỗi cú pháp ảnh (Self-healing)** để đảm bảo sơ đồ được sinh ra hoàn hảo trên giao diện Web và hiển thị sắc nét khi xuất PDF/Word.
5.  **Sử dụng nút Chuyển đổi giao diện (Navbar đầu trang):**
    *   ☀️/🌙 **Nút Sun/Moon**: Nằm ở thanh điều hướng trên cùng, nhấp để chuyển nhanh giao diện toàn hệ thống giữa nền Sáng (Light) và nền Tối (Dark).
    *   📖 **Nút Chế độ Sửa / Chế độ Đọc**: Nhấp để tắt ô soạn thảo Markdown bên trái, giúp ô xem trước (Preview) phóng to **100% diện tích màn hình** để tập trung rà soát bài học. Nhấp lại để quay lại màn hình chia đôi.

### 📊 Bước 5: Sinh ngân hàng câu hỏi trắc nghiệm theo thang Bloom
1.  Vào menu **Tạo câu hỏi trắc nghiệm** (Quiz Generation) ở Sidebar trái.
2.  **Lưu ý quan trọng (Cảnh báo Sư phạm) (Mới):** 
    *   Hệ thống yêu cầu các mục bài học **bắt buộc phải được sinh nội dung lý thuyết trước** thì mới có thể tạo câu hỏi trắc nghiệm. 
    *   Nếu thầy/cô chọn mục trống (chưa có nội dung soạn thảo), hệ thống sẽ hiển thị **cảnh báo màu vàng** nhắc nhở thầy/cô quay lại soạn bài giảng trước để đảm bảo câu hỏi trắc nghiệm được sinh ra bám sát đúng nội dung giảng dạy thực tế.
3.  Chọn thang nhận thức cần sinh (Nhận biết, Thông hiểu, Vận dụng) và nhấn **Tạo câu hỏi**.
4.  Nhấp nút **Xuất CSV** (góc trên bên phải) để tải file câu hỏi đã định dạng chuẩn, sẵn sàng import thẳng vào Moodle/Canvas.

---

## 💡 4. Mẹo viết Prompt hiệu quả cho Giảng viên (Công thức V-A-C-T)
Khi tự viết Prompt yêu cầu cho AI soạn bài, thầy/cô nên áp dụng công thức sau để đạt chất lượng bài soạn tốt nhất:
*   **V (Vai trò - Role)**: Xác định vị thế của AI (Ví dụ: *"Bạn là một giảng viên đại học xuất sắc ngành Công nghệ phần mềm..."*).
*   **A (Ai đọc - Audience)**: Đối tượng tiếp thu bài giảng (Ví dụ: *"Viết dễ hiểu cho sinh viên năm nhất mới bắt đầu học lập trình..."*).
*   **C (Cơ sở kiến thức - Constraint)**: Giới hạn RAG (Ví dụ: *"Chỉ sử dụng kiến thức trong tài liệu nguồn đã cung cấp, không lấy kiến thức bên ngoài giáo trình..."*).
*   **T (Tông giọng & Định dạng - Tone/Format)**: Cách thể hiện (Ví dụ: *"Trình bày rõ ràng dưới dạng Markdown, sử dụng bảng so sánh ưu nhược điểm, từ chuyên ngành cần mở ngoặc giải nghĩa tiếng Việt..."*).

---

*Chúc thầy/cô có những trải nghiệm biên soạn học liệu nhanh chóng và chất lượng nhất cùng hệ thống!*
