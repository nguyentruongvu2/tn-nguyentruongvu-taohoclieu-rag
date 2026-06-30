# HƯỚNG DẪN SỬ DỤNG HỆ THỐNG HỖ TRỢ BIÊN SOẠN BÀI GIẢNG RAG
## (Dành cho Giảng viên - Tối ưu hóa hiệu quả biên soạn học liệu)

Chào mừng thầy/cô đến với **Hệ thống hỗ trợ biên soạn bài giảng ứng dụng kỹ thuật RAG** (Retrieval-Augmented Generation). Tài liệu này được biên soạn nhằm hướng dẫn thầy/cô làm quen với hệ thống và áp dụng các kinh nghiệm thực tế để đạt hiệu quả cao nhất trong việc tạo bài giảng và sinh ngân hàng câu hỏi trắc nghiệm tự động.

---

## 📌 1. Giới thiệu Nguyên lý hoạt động của Hệ thống
Khác với các công cụ chatbot AI thông thường (chỉ trả lời dựa trên tri thức sẵn có của mô hình và dễ gặp hiện tượng "ảo tưởng thông tin"), hệ thống này hoạt động theo nguyên lý **RAG**:
1. Thầy/cô cung cấp tài liệu chuyên ngành (giáo trình, slide, đề cương).
2. Hệ thống tự động cắt nhỏ và nhúng tài liệu thành không gian Vector lưu vào cơ sở dữ liệu **Qdrant**.
3. Khi thầy/cô yêu cầu soạn bài giảng hoặc sinh câu hỏi, hệ thống sẽ **truy xuất ngữ nghĩa chính xác** các đoạn tài liệu nguồn liên quan nhất, đính kèm chúng làm ngữ cảnh (Context) gửi đến mô hình ngôn ngữ lớn (LLM - **Google Gemini**) cùng với Prompt chỉ thị.
4. LLM tổng hợp và sinh nội dung bám sát 100% tài liệu thầy/cô tải lên.

---

## 📂 2. Chuẩn bị Học liệu đầu vào (Yếu tố quyết định chất lượng)
Học liệu đầu vào là "xương sống" quyết định tính chính xác của tài liệu được sinh ra. Để RAG đạt hiệu quả tốt nhất, thầy/cô cần lưu ý:

*   **Định dạng tệp hỗ trợ**: `PDF`, `DOCX`, `TXT`.
*   **Chất lượng văn bản**:
    *   Tài liệu tải lên phải là văn bản dạng text có thể bôi đen/sao chép được. 
    *   *Tránh* tải các file PDF scan từ ảnh chụp (hoặc ảnh mờ), vì bộ trích xuất văn bản sẽ không thể đọc được nội dung chính xác.
*   **Bảng biểu và Công thức**:
    *   Hệ thống có tích hợp thư viện **pdfplumber** để trích xuất bảng biểu. Thầy/cô nên giữ các bảng biểu rõ ràng, không bị chèn hình vẽ đè lên.
*   **Cấu trúc Đề cương chi tiết**:
    *   Nên chuẩn bị một tệp đề cương chi tiết (Syllabus) ghi rõ các Chương, Mục và các từ khóa kiến thức cốt lõi. Cấu trúc đề cương rõ ràng giúp mô hình định hình luồng bài giảng chuẩn xác.

---

## 🚀 3. Quy trình sử dụng hệ thống chuẩn 5 bước

### Bước 1: Đăng nhập hệ thống
*   Truy cập vào trang giao diện người dùng.
*   Sử dụng tài khoản mẫu được cấp:
    *   **Tên đăng nhập (Username)**: `teacher`
    *   **Mật khẩu (Password)**: `teacher123`

### Bước 2: Tải lên tài liệu & Xây dựng Kho tri thức
1.  Truy cập phân hệ **Quản lý học liệu** (Document Manager).
2.  Tải lên giáo trình hoặc tài liệu tham khảo cho học phần.
3.  Hệ thống sẽ chạy ngầm quy trình xử lý tự động:
    *   *Đọc & Trích xuất* ➔ *Cắt nhỏ văn bản (Chunking)* ➔ *Nhúng Vector (Embedding)* ➔ *Lưu vào Qdrant*.
4.  Thầy/cô vui lòng đợi trạng thái hiển thị **Hoàn thành** (Success/Ready) trước khi bắt đầu tạo tài liệu.

### Bước 3: Soạn thảo bài giảng thông minh
1.  Vào mục **Tạo tài liệu giảng dạy** (Generate Material).
2.  Chọn các tài liệu nguồn trong kho tri thức cần sử dụng làm ngữ cảnh tham chiếu.
3.  Nhập cấu trúc đề cương chi tiết của bài giảng mong muốn.
4.  **Cấu hình Prompt nâng cao** (Xem mẹo ở Mục 4): Thầy/cô có thể thêm các yêu cầu cụ thể (ví dụ: *"Sinh nội dung bằng tiếng Việt, giải thích chi tiết các thuật toán, đưa ví dụ thực tế trong doanh nghiệp"*).
5.  Nhấn nút **Tạo bài giảng**: Hệ thống sẽ sinh bài giảng theo thời gian thực.
6.  Sử dụng giao diện **Xem trước song song** (Markdown & PDF) để rà soát, chỉnh sửa trực tiếp trên trình soạn thảo tích hợp nếu cần.

### Bước 4: Tạo và xuất ngân hàng câu hỏi trắc nghiệm
1.  Vào mục **Tạo câu hỏi trắc nghiệm** (Quiz Generation).
2.  Chọn bài giảng hoặc tài liệu nguồn muốn sinh câu hỏi.
3.  Chọn phân bổ câu hỏi theo thang nhận thức **Bloom**:
    *   **Nhận biết (Remember)**: Các câu hỏi định nghĩa, khái niệm trực tiếp.
    *   **Thông hiểu (Understand)**: Giải thích cơ chế, phân biệt các khái niệm.
    *   **Vận dụng (Apply)**: Giải quyết tình huống thực tế ngắn.
4.  Hệ thống tự động tạo câu hỏi trắc nghiệm (gồm đề bài, 4 phương án lựa chọn và đáp án đúng kèm giải thích ngắn).
5.  Thầy/cô rà soát câu hỏi trên giao diện trực quan, có thể nhấn sửa đổi hoặc sinh lại các câu chưa ưng ý.
6.  Nhấn **Xuất tệp CSV**: File tải về được chuẩn hóa cấu trúc để import trực tiếp vào các hệ thống LMS lớn như Moodle, Canvas, Google Classroom.

### Bước 5: Hỏi đáp trợ lý ảo trên tài liệu
*   Trong quá trình giảng dạy hoặc soạn bài, nếu cần tra cứu nhanh kiến thức trong hàng nghìn trang tài liệu đã tải lên, thầy/cô sử dụng **Hộp thoại hỏi đáp** (Chat Panel).
*   Trợ lý ảo RAG sẽ chỉ truy xuất và trả lời dựa trên tài liệu của thầy/cô, chỉ rõ câu trả lời nằm ở trang nào, phần nào của tài liệu nguồn để thầy/cô dễ kiểm chứng.

---

## 💡 4. Mẹo nâng cao để đạt hiệu quả tốt nhất (Tips & Tricks)

### ✍️ Kỹ thuật viết Prompt hiệu quả (Prompt Engineering)
Khi thầy/cô tinh chỉnh prompt tạo bài giảng, hãy áp dụng cấu trúc **V-A-C-T** sau để LLM hiểu đúng ý nhất:
*   **Vài vai trò (Role)**: *"Bạn là một giảng viên đại học xuất sắc ngành Công nghệ phần mềm..."*
*   **Ai là đối tượng (Audience)**: *"Nội dung bài giảng hướng tới đối tượng sinh viên năm 3..."*
*   **Cơ sở kiến thức (Constraint)**: *"Chỉ sử dụng thông tin trong ngữ cảnh được cung cấp, không tự ý bịa đặt kiến thức bên ngoài."*
*   **Tông giọng và Định dạng (Format)**: *"Viết bài giảng dưới dạng Markdown chuẩn, các thuật ngữ tiếng Anh cần mở ngoặc giải nghĩa tiếng Việt, sử dụng bảng so sánh để làm rõ ưu/nhược điểm."*

### 🧩 Tối ưu hóa dung lượng Chunk
Khi tải lên các file sách rất dày (trên 300 trang), hệ thống sẽ chia nhỏ thành nhiều đoạn văn. Nếu muốn sinh bài giảng chất lượng cao cho một mục cụ thể, thầy/cô nên tải thêm các bài báo khoa học ngắn hoặc tài liệu tóm tắt chuyên sâu của mục đó để hệ thống dễ dàng truy xuất chính xác các từ khóa thay vì các đoạn văn bản dài dòng mang tính khái quát trong sách giáo khoa.

---

## 🛠️ 5. Xử lý sự cố thường gặp (Troubleshooting)

| Sự cố | Nguyên nhân | Cách khắc phục |
| :--- | :--- | :--- |
| **Không tải được tệp tài liệu** | Định dạng không được hỗ trợ hoặc dung lượng quá lớn (vượt quá 50MB). | Kiểm tra lại đuôi tệp (`.pdf`, `.docx`, `.txt`). Nếu file quá nặng, hãy chia nhỏ tài liệu thành từng chương và tải lên. |
| **Bài giảng sinh ra bị sơ sài, thiếu ý** | Đề cương nhập quá ngắn hoặc tài liệu nguồn tải lên không chứa nội dung đó. | Bổ sung đề cương chi tiết hơn. Đảm bảo tài liệu nguồn được chọn chứa đủ thông tin giảng dạy. Bổ sung các tài liệu chuyên ngành liên quan vào kho tri thức. |
| **Câu hỏi trắc nghiệm bị lặp nội dung** | Do tài liệu nguồn lặp lại các ý kiến thức nhiều lần. | Rà soát và xóa các câu hỏi trùng lặp trên giao diện trước khi xuất file CSV. |
| **Hệ thống phản hồi chậm hoặc lỗi kết nối** | API Key Google Gemini bị giới hạn quota hoặc quá tải máy chủ. | Đợi 1-2 phút và thử lại. Nếu vẫn lỗi, liên hệ Quản trị viên để kiểm tra trạng thái hoạt động của container Backend và kiểm tra API Key. |

---
*Chúc thầy/cô có những trải nghiệm soạn học liệu hiệu quả và nhanh chóng cùng hệ thống!*
