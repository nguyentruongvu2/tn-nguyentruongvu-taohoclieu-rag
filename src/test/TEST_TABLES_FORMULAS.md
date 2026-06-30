# Bài Giảng: Bảng & Công Thức Toán Học

Tài liệu kiểm tra xử lý bảng biểu và công thức LaTeX trong hệ thống RAG.

## 1. Bảng Doanh Thu Bán Hàng

Bảng tổng hợp doanh thu theo quý:

| Quý  | Doanh Thu (triệu VND) | Lợi Nhuận (triệu VND) | Tỷ Lệ Tăng (%) |
| ---- | --------------------- | --------------------- | -------------- |
| Q1   | 500                   | 150                   | 10%            |
| Q2   | 650                   | 195                   | 30%            |
| Q3   | 820                   | 246                   | 26%            |
| Q4   | 900                   | 270                   | 10%            |
| Year | 2,870                 | 861                   | 19%            |

## 2. Bảng So Sánh Phương Pháp

| Phương Pháp   | Ưu Điểm         | Nhược Điểm | Chi Phí    |
| ------------- | --------------- | ---------- | ---------- |
| Phương Pháp A | Nhanh, hiệu quả | Phức tạp   | Cao        |
| Phương Pháp B | Đơn giản        | Chậm       | Thấp       |
| Phương Pháp C | Cân bằng        | Trung bình | Trung bình |

## 3. Công Thức Toán Học

### 3.1 Phương Trình Bậc 2

Công thức tìm nghiệm của phương trình bậc 2:

$$x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}$$

Trong đó:

- $a$, $b$, $c$ là các hệ số
- $\Delta = b^2 - 4ac$ là delta (biệt thức)

### 3.2 Công Thức Thống Kê

Công thức tính trung bình cộng:
$$\bar{x} = \frac{1}{n}\sum_{i=1}^{n} x_i$$

Công thức tính phương sai:
$$\sigma^2 = \frac{1}{N}\sum_{i=1}^{N}(x_i - \mu)^2$$

Công thức tính độ lệch chuẩn:
$$\sigma = \sqrt{\sigma^2}$$

### 3.3 Công Thức Entropy Shannon

Entropy của biến ngẫu nhiên X:
$$H(X) = -\sum_{x} p(x) \log_2 p(x)$$

## 4. Bảng Ma Trận Tương Quan

Bảng tương quan giữa các biến:

| Biến | X1    | X2   | X3    | X4   | X5    |
| ---- | ----- | ---- | ----- | ---- | ----- |
| X1   | 1.00  | 0.85 | -0.12 | 0.45 | 0.78  |
| X2   | 0.85  | 1.00 | 0.23  | 0.56 | 0.89  |
| X3   | -0.12 | 0.23 | 1.00  | 0.34 | -0.45 |
| X4   | 0.45  | 0.56 | 0.34  | 1.00 | 0.67  |
| X5   | 0.78  | 0.89 | -0.45 | 0.67 | 1.00  |

## 5. Bảng Kết Quả Phân Tích

| Chỉ Số  | Giá Trị | Đánh Giá | Ghi Chú              |
| ------- | ------- | -------- | -------------------- |
| Mean    | 750.5   | Tốt      | Trung bình doanh thu |
| Median  | 735     | Tốt      | Trung vị ổn định     |
| Std Dev | 152.3   | Vừa phải | Phân tán trung bình  |
| Min     | 500     | -        | Quý I năm            |
| Max     | 900     | -        | Quý IV năm           |

## 6. Công Thức Tương Quan Pearson

Công thức tính hệ số tương quan Pearson:

$$r = \frac{\sum_{i=1}^{n}(x_i - \bar{x})(y_i - \bar{y})}{\sqrt{\sum_{i=1}^{n}(x_i - \bar{x})^2 \sum_{i=1}^{n}(y_i - \bar{y})^2}}$$

Các giá trị tương quan từ bảng trên cho thấy:

- $r(X1, X2) = 0.85$: Tương quan mạnh dương
- $r(X1, X3) = -0.12$: Tương quan yếu âm
- $r(X2, X5) = 0.89$: Tương quan rất mạnh dương

## Kết Luận

Tài liệu này chứa nhiều bảng biểu và công thức toán học của các loại, phục vụ mục đích kiểm tra xem hệ thống có xử lý chính xác các yếu tố này hay không.
