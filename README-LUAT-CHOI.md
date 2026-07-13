# Monopoly Market Arena - Nuốt Thị Trường

Game web realtime mô phỏng quá trình cạnh tranh thị trường, tích tụ tư bản, độc quyền và vai trò điều tiết của Nhà nước.

Mỗi người chơi là một doanh nghiệp. Doanh nghiệp di chuyển trên bản đồ, thu thập tài nguyên để tăng điểm/quy mô, có thể tách doanh nghiệp, bắn vốn, thâu tóm doanh nghiệp nhỏ hơn và chịu các cơ chế điều tiết khi quá mạnh.

## Cách chạy

```bash
cd mln-game
npm install
npm start
```

Màn hình host/máy chiếu:

```text
http://localhost:3000/host
```

Màn hình người chơi:

```text
http://localhost:3000/player
```

Nếu chơi cùng mạng LAN, host sẽ hiện QR/link tham gia. Người chơi dùng điện thoại hoặc laptop để vào link `/player`.

## Cấu trúc màn hình

- `/host`: màn hình lớp học, hiện bản đồ lớn, bảng xếp hạng, chỉ số thị trường, QR tham gia, nút điều khiển game.
- `/player`: màn hình người chơi, nhập tên doanh nghiệp, chọn logo, điều khiển nhân vật, nhìn vùng xung quanh mình.

## Mục tiêu chiến thắng

Người thắng là người có `score` cao nhất khi hết giờ.

Điểm có thể tăng từ:

- Ăn tài nguyên trên bản đồ.
- Nhặt túi điểm điều tiết.
- Sở hữu hạ tầng điện/nước.
- Thâu tóm người chơi khác.
- Nhặt SP Item có lợi.

Điểm có thể giảm từ:

- Bị phạt độc quyền.
- Nhặt item khủng hoảng kinh tế.
- Bị tác động bởi item Luật chống độc quyền.

## Lưu ý về thời lượng hiện tại

Trong source hiện tại:

```js
const MATCH_DURATION_MS = 2 * 60 * 1000;
```

Nghĩa là trận đấu đang được cấu hình chạy 2 phút.

Trong khi đó, logic phase và anti-monopoly được thiết kế theo mốc 15 phút. Nếu muốn dùng đầy đủ 5 giai đoạn bên dưới, đổi lại thành:

```js
const MATCH_DURATION_MS = 15 * 60 * 1000;
```

Nếu giữ 2 phút, trận gần như chỉ chạy giai đoạn 1 và kết thúc ngay khi hết 2 phút.

## Các giai đoạn trong code

Server tự tính phase theo thời gian đã trôi qua từ lúc host bấm `Bắt đầu game`.

### Giai đoạn 1: 0-2 phút - Cạnh tranh tự do

- Người chơi farm tài nguyên và tăng quy mô.
- Trong 2 phút đầu, người chơi không thể thâu tóm nhau.
- Mục đích: mọi doanh nghiệp có thời gian khởi đầu tương đối công bằng.

### Giai đoạn 2: 2-7 phút - Tích tụ tư bản

- Cơ chế thâu tóm bắt đầu hoạt động.
- Doanh nghiệp lớn có lợi thế hơn trong việc ăn tài nguyên và nuốt doanh nghiệp nhỏ.
- Hạ tầng điện/nước bắt đầu có vai trò trong chỉ số thị trường.

### Giai đoạn 3: 7-12 phút - Độc quyền

- Server bắt đầu theo dõi top 1.
- Nếu một người chơi giữ top 1 liên tục 30 giây, người đó bị gắn trạng thái giám sát độc quyền.
- Trạng thái này làm giảm tốc 10%.

### Giai đoạn 4: 12-13 phút - Chuyển tiếp điều tiết

- Tiếp tục áp dụng giám sát độc quyền.
- Nếu top 1 vẫn giữ vị trí sau mỗi chu kỳ 30 giây, bị trừ 5% điểm hiện tại.
- Điểm bị trừ được chia thành các túi điểm rơi trên bản đồ.

### Giai đoạn 5: 13-15 phút - Độc quyền nhà nước

- Các rule điều tiết tiếp tục hoạt động.
- Vote chính sách xuất hiện trên màn hình player/host.
- Host có thể dùng SP Item để tạo biến động cuối trận.

## Tài nguyên trên bản đồ

Người chơi ăn các tài nguyên nhỏ để tăng điểm và tăng quy mô.

Các loại tài nguyên trong source:

- `capital`: vốn.
- `tech`: công nghệ.
- `customer`: khách hàng.
- `license`: giấy phép.

Mỗi tài nguyên có `value` khác nhau. Khi ăn tài nguyên:

- Cell của người chơi tăng mass.
- Điểm `score` tăng theo giá trị tài nguyên.
- Nếu đang có hiệu ứng x2 tài nguyên, cả điểm và tăng trưởng từ tài nguyên được nhân đôi.

## Thâu tóm doanh nghiệp

Sau 2 phút đầu, người chơi có thể thâu tóm nhau.

Điều kiện cơ bản:

- Hai cell của 2 người chơi khác nhau chạm đủ gần.
- Cell lớn phải lớn hơn cell nhỏ ít nhất 18%.
- Nếu người bị nuốt đang có khiên bảo hộ thì không bị nuốt.
- Nếu người đi nuốt đang bị hiệu ứng `Cấm thâu tóm` thì không nuốt được người khác.

Khi thâu tóm thành công:

- Người thắng nhận một phần mass của người thua.
- Nếu người thua mất hết cell, người thua bị chết tạm thời và sẽ hồi sinh.
- Người thắng được cộng thêm điểm.
- Chỉ số `swallowed` và sự kiện trên host được cập nhật.

## Hồi sinh và comeback

Khi bị thâu tóm hết cell:

- Người chơi chết tạm thời.
- Sau khoảng 4.2 giây sẽ hồi sinh tại vị trí mới.
- Khi hồi sinh, người chơi nhận 3 buff trong 10 giây:
  - Khiên bảo hộ.
  - Tăng tốc 20%.
  - x2 điểm/tăng trưởng khi ăn tài nguyên.

Trong thời gian có khiên, người chơi không bị người khác nuốt.

## Điều khiển người chơi

Trên máy tính:

- Di chuột để điều khiển hướng di chuyển.
- `Space`: tách cell.
- `W`: bắn vốn.

Trên điện thoại:

- Dùng joystick trên màn hình.
- Nút `Tách`: tách cell.
- Nút `Bắn vốn`: bắn một phần mass ra ngoài.

## Tách cell

Người chơi có thể tách thành nhiều cell để di chuyển/chiến đấu linh hoạt hơn.

Rule trong source:

- Tối đa 4 cell.
- Mỗi cell cần ít nhất `MIN_SPLIT_MASS = 200` để tách.
- Cell tách ra có lực đẩy theo hướng chuột/joystick.
- Cell cần thời gian mới có thể nhập lại.

## Bắn vốn

Người chơi có thể bắn một phần mass ra ngoài.

Rule trong source:

- Cần ít nhất `MIN_EJECT_MASS = 100`.
- Mỗi lần bắn mất `EJECT_COST = 14` mass.
- Vật thể bắn ra có `EJECT_GIVE = 12` mass.
- Vật thể bắn ra có thể được cell khác ăn lại.

## Hạ tầng điện/nước

Từ phase 2 trở đi, có 2 hạ tầng trên bản đồ:

- Bốn cứ điểm chiến lược trên bản đồ.

Người chơi đứng gần hạ tầng với quy mô đủ lớn có thể chiếm quyền kiểm soát.

Khi kiểm soát hạ tầng:

- Người chơi nhận điểm thụ động.
- Cell lớn nhất tăng mass chậm theo thời gian.
- Dashboard host hiện chủ sở hữu hạ tầng.
- Chỉ số rủi ro hạ tầng/monopoly tăng lên.

## Rule chống độc quyền tự động

Từ phút thứ 7:

1. Server theo dõi người đang top 1 theo `score`.
2. Nếu cùng một người giữ top 1 liên tục 30 giây:
   - Người đó bị gắn trạng thái `Bị giám sát độc quyền`.
   - Bị giảm tốc 10%.
   - Host và người chơi nhận thông báo.
3. Cứ mỗi 30 giây:
   - Nếu người đó vẫn top 1, bị trừ 5% điểm hiện tại.
   - Điểm bị trừ không mất đi, mà được chia thành túi điểm rơi trên bản đồ.
4. Nếu người đó không còn top 1:
   - Trạng thái giám sát được gỡ.

## Túi điểm điều tiết

Túi điểm xuất hiện khi top 1 bị phạt bởi rule chống độc quyền hoặc item Luật chống độc quyền.

Rule:

- Tổng điểm trong các túi bằng điểm đã bị trừ.
- Số túi random từ 5 đến 12.
- Vị trí rơi ngẫu nhiên trên bản đồ.
- Tồn tại 30-45 giây.
- Ai chạm vào thì nhận điểm và tăng một ít mass.

Ý nghĩa mô phỏng: Nhà nước điều tiết lại nguồn lực từ doanh nghiệp quá lớn, tạo cơ hội cho doanh nghiệp khác.

## SP Item

Host có nút `Thả SP Item` trên màn hình `/host`.

Rule nút:

- Chỉ dùng sau khi game đã bắt đầu.
- Cooldown 2 phút.
- Nếu ít người chơi: spawn 8-12 item.
- Nếu đông người chơi: spawn 15-20 item.
- Item tồn tại 30-45 giây.
- Người chơi chạm vào item thì server áp dụng hiệu ứng.

### Tỉ lệ random SP Item

- `Đổi mới công nghệ`: 30%.
- `Mở rộng phân phối`: 25%.
- `Khiên bảo hộ`: 20%.
- `Vốn vay ưu đãi`: 12%.
- `Khủng hoảng kinh tế`: 8%.
- `Luật chống độc quyền`: 5%.

Riêng `Luật chống độc quyền`:

- Chỉ xuất hiện từ phút thứ 7.
- Mỗi lần thả tối đa 1 item loại này.

### Danh sách SP Item

#### Đổi mới công nghệ

Ký hiệu trên bản đồ: `x2`

Hiệu ứng:

- x2 điểm và tăng trưởng khi ăn tài nguyên trong 15 giây.
- Không nhân đôi điểm khi thâu tóm người chơi khác.

#### Mở rộng phân phối

Ký hiệu trên bản đồ: `>>`

Hiệu ứng:

- Tăng tốc 25% trong 15 giây.

#### Khiên bảo hộ

Ký hiệu trên bản đồ: `SH`

Hiệu ứng:

- Không bị người khác thâu tóm trong 15 giây.
- Vẫn được ăn tài nguyên và vẫn có thể thâu tóm người khác.

#### Vốn vay ưu đãi

Ký hiệu trên bản đồ: `+%`

Hiệu ứng:

- Nếu người nhặt thuộc top 3: cộng 5% điểm hiện tại.
- Nếu không thuộc top 3: cộng 10% điểm hiện tại.

#### Khủng hoảng kinh tế

Ký hiệu trên bản đồ: `-%`

Hiệu ứng:

- Người nhặt bị mất 10% điểm hiện tại.
- Điểm mất do item này biến mất luôn, không rơi thành túi điểm.

#### Luật chống độc quyền

Ký hiệu trên bản đồ: `LAW`

Hiệu ứng:

- Tác động lên người đang top 1 hiện tại.
- Nếu top 1 nhặt item này, item vẫn tác động lên chính top 1.
- Random 1 trong 3 hiệu ứng:
  - Mất 10% điểm hiện tại, điểm bị mất rơi thành túi điểm trên bản đồ.
  - Giảm tốc 20% trong 15 giây.
  - Không được thâu tóm người khác trong 15 giây.

## Vote chính sách

Vote xuất hiện ở phase 5.

Người chơi có 3 lựa chọn:

- A: Không can thiệp, để thị trường tự xử lý.
- B: Nhà nước giữ toàn bộ.
- C: Nhà nước giữ khâu cốt lõi, tư nhân tham gia phần phù hợp.

Host thấy kết quả vote bằng các thanh tỉ lệ trên màn hình.

## Màn hình host

Host có các nút:

- `Bắt đầu game`: bắt đầu trận.
- `Chuyển giai đoạn`: đổi phase thủ công.
- `Thả SP Item`: thả item đặc biệt trên bản đồ.
- `Tạm dừng/Tiếp tục`: pause/resume.
- `Chơi lại`: reset trận.

Host thấy:

- QR/link để người chơi tham gia.
- Đồng hồ đếm ngược.
- Bản đồ toàn cảnh.
- Leaderboard.
- Chỉ số thị trường.
- Chủ sở hữu điện/nước.
- Sự kiện gần đây.
- Toast thông báo các sự kiện quan trọng.

## Màn hình player

Người chơi thấy:

- Tên doanh nghiệp.
- Phase hiện tại.
- Quy mô hiện tại.
- Bản đồ trong tầm nhìn hạn chế.
- Resource, SP Item, túi điểm trong tầm nhìn.
- Timer hiệu ứng đang có.
- Thông báo nổi cá nhân/toàn bản đồ.
- Nút tách, bắn vốn, vote chính sách.

## File quan trọng

- `server.js`: toàn bộ logic game, realtime state, socket events, rule thâu tóm, item, phase, điểm, anti-monopoly.
- `public/host.html`: màn hình host/máy chiếu.
- `public/player.html`: màn hình người chơi.
- `public/style.css`: CSS màn hình player.
- `public/host-classroom.css`: CSS màn hình host.
- `public/game-sprites.js`: load sprite, vẽ logo, resource, hạ tầng, buffer nội suy vị trí.
- `public/assets/`: hình ảnh bản đồ, logo, tài nguyên, icon.

## Ghi chú kỹ thuật

- Server giữ state trong RAM, reset khi restart server.
- Game dùng Socket.IO để đồng bộ realtime.
- Tick game chạy theo `TICK_RATE = 30`.
- Resource không gửi mỗi frame mà sync theo chu kỳ `RESOURCE_SYNC_EVERY`.
- Logic và điểm do server xử lý, client chỉ gửi input/action.
