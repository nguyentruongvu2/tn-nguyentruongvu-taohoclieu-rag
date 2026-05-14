# Kế hoạch Tối ưu hóa Hệ thống Bài giảng AI (Demo Khóa luận)

**Mục tiêu:** Chuyển đổi từ một hệ thống sinh nội dung RAG thuần túy sang một trợ lý thiết kế giáo dục (Instructional Design Assistant) chuyên nghiệp, bám sát nghiệp vụ sư phạm thực tế.

---

## 1. Phân tích Hiện trạng vs. Mục tiêu

| Module | Hiện trạng (RAG-focused) | Mục tiêu (Teacher-focused) |
| :--- | :--- | :--- |
| **Nội dung** | Tổng hợp kiến thức từ tài liệu, có trích dẫn. | Cấu trúc bài giảng chủ động (Hook, Concept Check, Scaffolding). |
| **Quiz** | 6 câu hỏi text (3 MCQ + 3 Tự luận), có giải thích. | Hỗ trợ export sang LMS (Moodle, Kahoot, Quizizz) để dùng ngay. |
| **Slide** | Chia slide theo độ dài text, nội dung text thuần. | Assertion-Evidence chuẩn, gợi ý hình ảnh/sơ đồ cho mỗi slide. |

---

## 2. Lộ trình thực hiện chi tiết

### Giai đoạn 1: Chuẩn hóa Nghiệp vụ Slide (Ưu tiên: CAO - Cho Demo)
*Trọng tâm: Làm cho slide trông "thông minh" và có tư duy thiết kế thay vì chỉ là tóm tắt text.*

*   **Lợi ích & Cải thiện:**
    *   **Chuyển đổi Tư duy:** Áp dụng mô hình **Assertion-Evidence**. Tiêu đề slide không còn là "Giới thiệu về X" mà là "X giúp tăng năng suất 50%", giúp người học nắm bắt thông điệp ngay lập tức.
    *   **Trực quan hóa:** AI gợi ý ý tưởng hình ảnh/sơ đồ cho mỗi slide, biến bài thuyết trình từ "toàn chữ" thành "giàu hình ảnh".
    *   **Nhịp độ (Pacing):** Slide được chia dựa trên các ý niệm hoàn chỉnh thay vì chia theo độ dài văn bản, giúp mạch thuyết trình tự nhiên hơn.
*   **Task 1.1: Tối ưu thuật toán phân phối Slide.**
    *   *Kỹ thuật:* Thay vì chia slide dựa trên số từ (`_distribute_slides` hiện tại), LLM sẽ nhận toàn bộ Section và tự đề xuất danh sách slide phù hợp với logic nội dung.
*   **Task 1.2: Triển khai Visual Evidence (Assertion-Evidence 2.0).**
    *   *Kỹ thuật:* Cập nhật Prompt trong `slides.py` để LLM trả về field `visual_prompt` cho mỗi slide (VD: "Sơ đồ dòng chảy của thuật toán X", "Ảnh minh họa so sánh trước và sau khi dùng Y").
    *   *Frontend:* Hiển thị các gợi ý hình ảnh này tại editor để giáo viên tham khảo.

### Giai đoạn 2: Số hóa Quiz Luyện tập (Ưu tiên: TRUNG BÌNH)
*Trọng tâm: Biến các lượt luyện tập thành dữ liệu có thể sử dụng trên các nền tảng EdTech (Kahoot, Quizizz, Moodle).*

*   **Task 2.1: Export bộ Quiz luyện tập định dạng chuẩn.**
    *   *Tính năng:* Thêm nút "Tải xuống chuẩn LMS" hỗ trợ export 5-10 câu hỏi của lượt làm bài hiện tại sang file `.txt` (GIFT format) hoặc `.csv`.
*   **Task 2.2: Tăng cường tính tương tác của Quiz.**
    *   *Frontend:* Cải thiện giao diện trang Luyện tập Quiz để giáo viên có thể trải nghiệm luồng làm bài như một học sinh thực thụ.

### Giai đoạn 3: Nâng cấp "Bộ khung sư phạm" Content (Hoàn thành)
*Trọng tâm: Cải thiện chất lượng văn phong và tính tương tác của bài giảng.*
*   **Status:** Đã triển khai cấu trúc Hook -> Explain -> Concept Check -> Glossary.

### Giai đoạn 4: Smart Pedagogy & Feedback Loop (Nâng tầm thực tế - MỚI)
*Trọng tâm: Giải quyết bài toán "Dạy thế nào?" cho Giáo viên và "Học thế nào?" cho Học sinh.*

*   **Dành cho Giáo viên (Chiến lược giảng dạy):**
    *   **Task 4.1: Slide Delivery Guidance:** Bổ sung field `talking_points` và `estimated_duration` cho từng Slide. Giúp giáo viên biết nên nói gì và phân bổ thời gian bao lâu cho hợp lý.
    *   **Task 4.2: Quiz Timing Recommendations:** AI gợi ý thời điểm triển khai câu hỏi (VD: "Câu này nên dùng để khởi động bài học", "Câu này dùng để chốt ý sau Slide 5").
    *   **Task 4.3: Weak Point Analysis:** Sau khi học sinh làm Quiz, hệ thống tổng hợp các phần kiến thức bị sai nhiều nhất để giáo viên biết cần giảng lại (Re-teach) chỗ nào.

*   **Dành cho Học sinh (Tăng hiệu quả học tập):**
    *   **Task 4.4: Smart Restudy Path (Lộ trình ôn tập thông minh):** Nếu học sinh làm sai Quiz, AI không chỉ hiện đáp án mà còn đưa ra link/gợi ý: "Bạn nên đọc lại mục [Tên mục] trong bài giảng để hiểu rõ hơn về phần này".
    *   **Task 4.5: Interactive Explanations:** Cải thiện giao diện hiển thị giải thích (Explanation) sao cho sinh động, bắt buộc người học phải tương tác (VD: click để xem tại sao sai) thay vì chỉ nhìn điểm rồi đóng.

---

## 3. Danh sách các file cần tác động chính

1.  `backend/app/routes/slides.py`: Thay đổi logic Prompt và distribution.
2.  `backend/app/prompts/project_rag_section_profiles.py`: Cập nhật cấu trúc sinh nội dung & quiz.
3.  `backend/app/routes/project_rag.py`: Bổ sung logic xử lý hậu kỳ (Post-processing) cho nội dung.
4.  `frontend/src/pages/TeachingMaterialEditor.tsx`: Thêm UI cho Visual Suggestions và Export Quiz.

---

## 4. Cam kết chất lượng
- **Đúng kiến thức:** Dữ liệu luôn được Grounding (đối chiếu) 100% với Knowledge Base.
- **Phù hợp người dùng:** Giảm thiểu thao tác thủ công của giáo viên xuống mức thấp nhất.
- **Tính thực tế:** Mọi đầu ra (Slide, Quiz) đều có thể tải về và sử dụng trong lớp học thật.
