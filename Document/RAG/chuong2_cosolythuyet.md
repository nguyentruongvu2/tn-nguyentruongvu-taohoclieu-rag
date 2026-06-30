# CHƯƠNG 2: CƠ SỞ LÝ THUYẾT VÀ CÔNG NGHỆ LIÊN QUAN

Chương này trình bày các cơ sở lý thuyết khoa học cốt lõi và hệ thống các công nghệ được áp dụng để giải quyết bài toán thiết kế giáo trình bài giảng thông minh. Nội dung tập trung nghiên cứu kiến trúc RAG, các mô hình ngôn ngữ lớn (LLM), cơ sở dữ liệu vector, cùng các công nghệ bổ trợ phát triển phần mềm trong dự án. Mỗi phần công nghệ được phân tích chi tiết theo cấu trúc: Giới thiệu chung (GT), Ưu/Nhược điểm, Hạn chế thực tế (Khuyết) và Vai trò/Ý định áp dụng cụ thể trong đề tài.

---

## 2.1. KIẾN TRÚC TRUY HỒI TĂNG CƯỜNG THẾ HỆ (RETRIEVAL-AUGMENTED GENERATION - RAG)

### 2.1.1. Giới thiệu chung (GT)
Retrieval-Augmented Generation (RAG) là một kỹ thuật tối ưu hóa hiệu suất của Mô hình ngôn ngữ lớn (LLM) bằng cách tích hợp một cơ chế truy hồi thông tin từ nguồn dữ liệu ngoại vi đáng tin cậy bên ngoài vào quá trình sinh văn bản. Thay vì chỉ dựa hoàn toàn vào tri thức tĩnh đã được học trong giai đoạn huấn luyện (pre-training) của LLM, quy trình của RAG bao gồm 3 bước cơ bản:
1. **Truy vấn (Querying):** Chuyển đổi câu hỏi hoặc yêu cầu của người dùng thành định dạng tìm kiếm.
2. **Truy hồi (Retrieval):** Tìm kiếm và trích xuất các phân đoạn văn bản (chunks) có độ liên quan ngữ nghĩa cao nhất từ kho tài liệu tri thức (Knowledge Base).
3. **Tăng cường và Sinh (Augmentation & Generation):** Hợp nhất các phân đoạn tri thức vừa truy hồi vào ngữ cảnh (Prompt) gửi tới LLM, yêu cầu LLM tổng hợp và sinh ra câu trả lời dựa trên bằng chứng thực tế đó.

```
+------------------+     Query     +---------------------+
|  User Prompt     |-------------->|  Retrieval Engine   |
+------------------+               +---------------------+
         |                                    |
         |                                    | Search
         |                                    v
         |                         +---------------------+
         |                         |  Knowledge Base     |
         |                         +---------------------+
         |                                    |
         |                                    | Retrieve Chunks
         v                                    v
+------------------+   Context +   +---------------------+
|  Prompt Builder  |<--------------|   Relevant Chunks   |
+------------------+               +---------------------+
         |
         | Combined Prompt
         v
+------------------+
|    LLM Agent     |
+------------------+
         |
         v
+------------------+
|  Final Response  |
+------------------+
```

### 2.1.2. Ưu điểm và Nhược điểm
* **Ưu điểm:**
  * **Giảm thiểu hiện tượng ảo tưởng (Hallucination reduction):** Ràng buộc câu trả lời của LLM vào ngữ cảnh tài liệu nguồn, hạn chế tối đa việc LLM tự bịa ra thông tin sai lệch.
  * **Cập nhật tri thức động:** Cho phép cập nhật tri thức mới của hệ thống ngay lập tức bằng cách thay đổi/bổ sung tài liệu vào cơ sở tri thức mà không cần phải huấn luyện lại (fine-tuning) mô hình rất tốn kém.
  * **Khả năng kiểm chứng (Verifiability):** Có thể trích dẫn chính xác nguồn gốc thông tin (tên tài liệu, chương, trang) giúp giáo viên dễ dàng đối chiếu và kiểm tra tính đúng đắn.
* **Nhược điểm:**
  * **Phụ thuộc vào chất lượng truy hồi:** Nếu bước truy hồi lấy sai tài liệu hoặc thông tin không liên quan, mô hình LLM sẽ sinh ra câu trả lời sai lệch (rác đầu vào - rác đầu ra).
  * **Độ trễ hệ thống tăng:** Do phải thực hiện thêm bước tìm kiếm vector và xử lý ngữ cảnh trước khi gọi LLM.

### 2.1.3. Hạn chế chưa giải quyết được trong thực tế (Khuyết)
* **Mất mát thông tin do phân mảnh (Chunking loss):** Việc cắt nhỏ tài liệu thành các đoạn cố định (như 1000 ký tự) có thể bẻ gãy mạch logic hoặc cấu trúc bảng biểu, công thức toán học, dẫn đến việc mất mát ngữ cảnh của toàn bộ chương sách.
* **Độ bao phủ tri thức yếu:** Khó trả lời các câu hỏi mang tính tổng hợp cao xuyên suốt toàn bộ tài liệu dài (ví dụ: "Tóm tắt xu hướng phát triển của cả cuốn sách 800 trang này") do giới hạn cửa sổ ngữ cảnh (Context Window) của LLM và khả năng chọn lọc của thuật toán tìm kiếm tương tự.

### 2.1.4. Ý định áp dụng trong đề tài
Trong đề tài "Xây dựng hệ thống sinh bài giảng thông minh", RAG đóng vai trò là **trọng tâm kiến trúc xử lý tri thức**:
* RAG đảm bảo mọi nội dung bài giảng, slide bài giảng hay câu hỏi trắc nghiệm (Quiz) sinh ra đều được căn chỉnh (grounded) 100% theo nội dung giáo trình/sách giáo khoa mà giảng viên đã tải lên.
* RAG giải quyết triệt để bài toán "chính xác học thuật" – tiêu chuẩn khắt khe nhất trong giáo dục. Giảng viên chỉ cần tải lên sách chuyên ngành, hệ thống RAG sẽ chịu trách nhiệm bóc tách kiến thức chuẩn để giảng dạy mà không làm biến dạng nội dung chuyên môn.

---

## 2.2. MÔ HÌNH NGÔN NGỮ LỚN (LARGE LANGUAGE MODELS - LLM)

### 2.2.1. Giới thiệu chung (GT)
Mô hình ngôn ngữ lớn (LLM) là các mạng thần kinh nhân tạo học sâu cấu trúc học máy (thường dựa trên kiến trúc Transformer) được huấn luyện trên khối lượng dữ liệu văn bản khổng lồ. LLM có khả năng hiểu, phân tích ngữ cảnh, suy luận logic cơ bản và sinh ra văn bản tự nhiên giống như con người. Trong hệ thống này, dự án sử dụng các mô hình thương mại tiên tiến như dòng **Gemini** (Gemini 2.5 Flash / Pro) của Google thông qua kết nối API nhằm tối ưu hóa khả năng suy luận ngữ nghĩa học thuật.

### 2.2.2. Ưu điểm và Nhược điểm
* **Ưu điểm:**
  * **Khả năng hiểu ngữ cảnh vượt trội:** Xử lý và phân tích được các yêu cầu học thuật phức tạp từ giảng viên (Prompt), thực hiện viết lại, phân tích cấu trúc, tóm tắt và dịch thuật xuất sắc.
  * **Tốc độ sinh văn bản nhanh:** Sinh ra một chương bài giảng hoàn chỉnh trong vài giây, rút ngắn thời gian chuẩn bị học liệu của giáo viên từ nhiều ngày xuống vài phút.
  * **Hỗ trợ đa ngôn ngữ:** Có khả năng đọc hiểu tài liệu chuyên ngành tiếng Anh và sinh bài giảng bằng tiếng Việt chuẩn ngữ pháp sư phạm.
* **Nhược điểm:**
  * **Chi phí vận hành và bản quyền:** Việc sử dụng các mô hình thương mại qua API (như OpenAI, Gemini) phát sinh chi phí tính theo lượng ký tự gửi/nhận (Tokens).
  * **Nguy cơ rò rỉ dữ liệu:** Dữ liệu học liệu nội bộ khi gửi lên API của bên thứ ba cần được kiểm soát bảo mật chặt chẽ.

### 2.2.3. Hạn chế chưa giải quyết được trong thực tế (Khuyết)
* **Khả năng tính toán toán học và logic cấu trúc kém:** LLM bản chất là dự đoán từ tiếp theo dựa trên xác suất nên đôi khi gặp lỗi khi xử lý công thức toán học phức tạp hoặc định dạng đầu ra có cấu trúc nghiêm ngặt (như xuất định dạng GIFT của Moodle, định dạng JSON cho sơ đồ).
* **Thời gian đáp ứng (Latency):** Việc sinh các bài viết học thuật có độ dài lớn thường mất thời gian lâu, dễ dẫn tới lỗi kết nối (Timeout) trong các ứng dụng web thông thường nếu không áp dụng kỹ thuật Streaming hoặc xử lý bất đồng bộ.

### 2.2.4. Ý định áp dụng trong đề tài
Trong hệ thống, LLM được áp dụng để làm **bộ não xử lý ngôn ngữ và sinh nội dung bài giảng**:
* Chuyển hóa văn bản thô bóc tách từ tài liệu thành cấu trúc bài giảng sư phạm chuẩn mực (bao gồm phần dẫn nhập Hook, nội dung chính, ví dụ minh họa và câu hỏi kiểm tra nhanh).
* Tự động thiết kế slide dựa trên triết lý **Assertion-Evidence** (nhận diện luận điểm cốt lõi và đề xuất hình ảnh minh họa trực quan).
* Thiết kế ngân hàng câu hỏi trắc nghiệm đa dạng (nhận diện câu hỏi, sinh đáp án đúng và viết lời giải thích chi tiết cho từng lựa chọn).

---

## 2.3. CƠ SỞ DỮ LIỆU VECTOR (VECTOR DATABASE - QDRANT)

### 2.3.1. Giới thiệu chung (GT)
Cơ sở dữ liệu Vector (Vector Database) là hệ thống lưu trữ và tìm kiếm chuyên dụng dành cho các đại lượng vector đa chiều (Embeddings) được sinh ra từ các mô hình nhúng (Embedding Models). Khác với cơ sở dữ liệu quan hệ tìm kiếm bằng từ khóa chính xác (SQL WHERE LIKE), Vector Database sử dụng các thuật toán tìm kiếm láng giềng gần nhất (như HNSW - Hierarchical Navigable Small World) để tính toán độ tương đồng cosine (Cosine Similarity) giữa các vector. Dự án sử dụng **Qdrant** làm Vector DB chủ đạo nhờ hiệu năng xử lý cao, hỗ trợ Docker hóa hoàn chỉnh và có khả năng lọc metadata mạnh mẽ.

### 2.3.2. Ưu điểm và Nhược điểm
* **Ưu điểm:**
  * **Tìm kiếm theo ngữ nghĩa (Semantic Search):** Tìm được thông tin liên quan ngay cả khi giáo viên sử dụng các từ đồng nghĩa hoặc cách diễn đạt khác hoàn toàn với tài liệu nguồn gốc.
  * **Hiệu năng cực cao:** Khả năng truy vấn hàng triệu vector chỉ trong mili-giây, hỗ trợ tìm kiếm thời gian thực.
  * **Lọc kết hợp (Hybrid Filtering):** Qdrant cho phép kết hợp lọc chính xác theo điều kiện (ví dụ: chỉ tìm trong file PDF có ID là X) và tìm kiếm độ tương đồng ngữ nghĩa cùng lúc.
* **Nhược điểm:**
  * **Tiêu tốn bộ nhớ RAM:** Việc giữ các chỉ mục vector (Index) trong bộ nhớ để tìm kiếm nhanh yêu cầu tài nguyên phần cứng lớn.
  * **Độ chính xác từ khóa tuyệt đối kém:** Không tối ưu cho việc tìm kiếm các từ khóa chính xác tuyệt đối (như mã số, tên riêng viết tắt đặc biệt) nếu không cấu hình cơ chế Hybrid Search (Lexical + Vector).

### 2.3.3. Hạn chế chưa giải quyết được trong thực tế (Khuyết)
* **Khó khăn trong việc cập nhật chỉ mục lớn:** Khi tài liệu thay đổi liên tục, việc xóa và tái nhúng vector (re-indexing) đòi hỏi năng lực xử lý tính toán lớn và dễ gây ra hiện tượng không nhất quán dữ liệu tạm thời.
* **Mất cân biến trọng số tìm kiếm:** Việc điều phối trọng số giữa tìm kiếm từ khóa (Keyword/Sparse vector) và tìm kiếm ngữ nghĩa (Dense vector) trong các thư viện lai (Hybrid Search) vẫn mang tính thực nghiệm và khó tối ưu tự động cho mọi loại tài liệu.

### 2.3.4. Ý định áp dụng trong đề tài
Qdrant được áp dụng làm **kho lưu trữ tri thức ngữ nghĩa của hệ thống**:
* Toàn bộ tài liệu PDF/DOCX sau khi bóc tách sẽ được chạy qua mô hình nhúng (`models/gemini-embedding-001`) để chuyển thành các vector 768 chiều và lưu trữ vào Qdrant.
* Khi giáo viên soạn thảo một tiểu mục cụ thể (ví dụ: "3.1. Phân tích thiết kế hệ thống"), hệ thống sẽ sử dụng tiêu đề mục này làm vector truy vấn gửi tới Qdrant để lọc ra các trang sách có nội dung khớp nhất phục vụ cho việc sinh bài giảng tương ứng.

---

## 2.4. CÁC CÔNG NGHỆ BỔ TRỢ PHÁT TRIỂN HỆ THỐNG

---

### 2.4.1. FastAPI (Backend Framework)
* **GT:** FastAPI là một web framework hiện đại, có hiệu năng cực cao dùng để xây dựng các API bằng Python. Framework này hoạt động dựa trên tiêu chuẩn ASGI, hỗ trợ lập trình bất đồng bộ (`async/await`) toàn diện và tự động sinh tài liệu API bằng Swagger UI.
* **Ưu/Nhược:**
  * *Ưu điểm:* Tốc độ xử lý tương đương NodeJS và Go; kiểm soát kiểu dữ liệu đầu vào/đầu ra nghiêm ngặt bằng thư viện Pydantic giúp hạn chế lỗi runtime; hỗ trợ xử lý luồng streaming dữ liệu rất tốt cho LLM.
  * *Nhược điểm:* Cộng đồng và số lượng thư viện tích hợp sẵn nhỏ hơn so với Django hay Flask.
* **Khuyết:** Khả năng xử lý các tác vụ CPU-bound nặng (như bóc tách file PDF 800 trang) trực tiếp trên luồng chính dễ làm treo máy chủ nếu không tách sang tiến trình riêng hoặc Background Tasks chuyên biệt.
* **Ý định áp dụng:** Sử dụng làm máy chủ dịch vụ API Backend chính. FastAPI chịu trách nhiệm tiếp nhận file upload, phân phối các tiến trình trích xuất tài liệu chạy ngầm (`BackgroundTasks`), kết nối cơ sở dữ liệu PostgreSQL và Qdrant, điều phối luồng sinh nội dung từ Gemini API để trả về cho Frontend.

---

### 2.4.2. ReactJS (Frontend Library)
* **GT:** ReactJS là một thư viện Javascript mã nguồn mở được phát triển bởi Meta, chuyên dùng để xây dựng giao diện người dùng (UI) tương tác cao dạng ứng dụng đơn trang (SPA). Hệ thống sử dụng React kết hợp TypeScript và Vite để tối ưu hóa hiệu năng biên dịch.
* **Ưu/Nhược:**
  * *Ưu điểm:* Giao diện phản hồi cực nhanh nhờ cơ chế Virtual DOM; kiến trúc Component tái sử dụng cao giúp xây dựng trình soạn thảo bài giảng phức tạp một cách mạch lạc; hệ sinh thái thư viện phong phú.
  * *Nhược điểm:* Cần cấu hình và quản lý state phức tạp khi ứng dụng có nhiều tương tác chéo giữa các panel.
* **Khuyết:** Việc xử lý hiển thị và biên tập các tài liệu Markdown lớn, kết hợp đồng bộ kéo thả cây thư mục (Drag and Drop Outline) tiêu tốn nhiều tài nguyên xử lý của trình duyệt, dễ gây hiện tượng giật lag nếu không tối ưu hóa các hàm render.
* **Ý định áp dụng:** Làm nền tảng xây dựng toàn bộ giao diện người dùng chuyên nghiệp (Web Application UI). Thiết kế giao diện soạn thảo bài giảng trực quan dạng hai cột (Bên trái là cây đề mục giáo trình hỗ trợ kéo thả sắp xếp, bên phải là trình biên soạn Markdown kết hợp Preview hiển thị trích dẫn nguồn thực tế). Tích hợp chức năng bôi đen văn bản trực tiếp và mở tooltip gọi AI sửa đổi văn bản tại chỗ (AI Selection Edit).

---

### 2.4.3. PostgreSQL (Relational Database)
* **GT:** PostgreSQL là một hệ quản trị cơ sở dữ liệu quan hệ mã nguồn mở mạnh mẽ và phổ biến nhất hiện nay. Hệ thống hỗ trợ xử lý các giao dịch phức tạp (ACID) cực kỳ an toàn và có hiệu năng truy vấn dữ liệu quan hệ vượt trội.
* **Ưu/Nhược:**
  * *Ưu điểm:* Độ tin cậy dữ liệu tối đa; hỗ trợ lưu trữ dữ liệu JSON linh hoạt; cộng đồng phát triển mạnh mẽ và dễ dàng tích hợp vào hệ thống Docker.
  * *Nhược điểm:* Cần nhiều tài nguyên cấu hình hơn các hệ thống DB nhẹ như SQLite; đòi hỏi thiết kế Schema chuẩn xác ngay từ đầu.
* **Khuyết:** Khó khăn trong việc mở rộng quy mô lưu trữ lớn (horizontal scaling) so với các cơ sở dữ liệu NoSQL khi số lượng bản ghi lịch sử soạn thảo giáo trình tăng lên quá lớn.
* **Ý định áp dụng:** Đóng vai trò làm cơ sở dữ liệu lưu trữ trạng thái của toàn bộ hệ thống: quản lý tài khoản người dùng, lưu trữ cấu trúc dự án bài giảng, cây đề mục của giáo trình, lịch sử các phiên sinh bài giảng của AI (để phục vụ tính năng khôi phục phiên bản lịch sử soạn thảo) và lưu trữ metadata tài liệu đính kèm.

---

### 2.4.4. Docker & Containerization (Công nghệ đóng gói)
* **GT:** Docker là một nền tảng mã nguồn mở cho phép đóng gói ứng dụng và tất cả các thư viện phụ thuộc của nó vào trong một môi trường cô lập gọi là Container. Docker Compose được sử dụng để điều phối và chạy hệ thống gồm nhiều dịch vụ (multi-container) đồng thời.
* **Ưu/Nhược:**
  * *Ưu điểm:* Đảm bảo tính nhất quán môi trường tuyệt đối ("chạy trên máy tôi thế nào thì chạy trên server thế ấy"); cô lập tài nguyên hệ thống tốt; giúp việc triển khai dự án lên staging/production nhanh chóng chỉ bằng một câu lệnh.
  * *Nhược điểm:* Tăng thêm một lớp ảo hóa tài nguyên phần cứng làm hao hụt nhẹ hiệu năng CPU/RAM trên môi trường phát triển cục bộ.
* **Khuyết:** Quá trình debug (sửa lỗi) trực tiếp bên trong container phức tạp hơn so với chạy local thuần túy; dung lượng các file ảnh (Docker Images) thường rất lớn, gây tốn không gian lưu trữ ổ đĩa.
* **Ý định áp dụng:** Đóng gói toàn bộ hệ sinh thái dự án gồm 4 dịch vụ độc lập (`rag-backend`, `rag-frontend`, `rag-postgres`, `rag-qdrant`) vào một mạng ảo nội bộ (`rag-network`). Docker Compose giúp việc khởi động, cấu hình biến môi trường kết nối giữa các dịch vụ diễn ra tự động và an toàn, đồng thời đơn giản hóa quy trình cài đặt kiểm thử cho giảng viên và hội đồng đánh giá khóa luận tốt nghiệp.
