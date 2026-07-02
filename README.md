# Monopoly Market Arena - Nuốt Thị Trường

Web game mô phỏng chủ đề độc quyền cho bài thuyết trình Kinh tế chính trị Mác - Lênin.

## Ý tưởng

Mỗi người chơi là một doanh nghiệp. Ban đầu doanh nghiệp nhỏ, cạnh tranh bằng cách thu thập:

- 💰 Vốn
- ⚙️ Công nghệ
- 👥 Khách hàng
- 📜 Giấy phép
- ⚡ Lưới điện
- 💧 Đường ống nước

Doanh nghiệp lớn dần lên, có thể thâu tóm doanh nghiệp nhỏ hơn. Khi xuất hiện doanh nghiệp có thị phần lớn hoặc kiểm soát hạ tầng điện/nước, game sẽ cảnh báo nguy cơ độc quyền. Cuối game, cả lớp vote chính sách: để thị trường tự xử lý hay Nhà nước can thiệp.

## Cách chạy

```bash
cd monopoly_market_game
npm install
npm start
```

Mở trên máy chiếu:

```text
http://localhost:3000/host
```

Người chơi dùng điện thoại/laptop mở:

```text
http://<IP-máy-chủ>:3000/player
```

Ví dụ nếu IP máy bạn là `192.168.1.20`, người chơi vào:

```text
http://192.168.1.20:3000/player
```

## Luật chơi gợi ý khi thuyết trình

### Giai đoạn 1: Cạnh tranh tự do
Người chơi thu thập vốn, công nghệ, khách hàng. Doanh nghiệp lớn dần lên.

### Giai đoạn 2: Độc quyền hình thành
Doanh nghiệp lớn có thể thâu tóm doanh nghiệp nhỏ hơn. Dashboard hiển thị thị phần, mức độ tập trung thị trường và cảnh báo độc quyền.

### Giai đoạn 3: Điện, nước và Nhà nước điều tiết
Xuất hiện ⚡ lưới điện và 💧 đường ống nước. Ai kiểm soát hạ tầng sẽ có quyền lực đặc biệt. Cả lớp vote chính sách cuối game.

## Phím điều khiển host

- `Next phase`: chuyển giai đoạn
- `Pause/Resume`: tạm dừng / chạy tiếp
- `Reset game`: chơi lại từ đầu

