# Runbook triển khai Monopoly Market Arena lên AWS EC2

Tài liệu này dành riêng cho source `mln-game` hiện tại: Node.js, Express, Socket.IO, state trận đấu nằm trong RAM và một trận kéo dài 15 phút.

## 1. Kiến trúc khuyến nghị

```text
Người chơi / Host
        │
        │ HTTPS + WSS :443
        ▼
Route 53 hoặc DNS của nhà cung cấp domain
        │
        ▼
Elastic IP ── EC2 Ubuntu ── Nginx ── Node.js :3000
                                      │
                                      └── State game trong RAM
```

Chỉ chạy **một EC2 và một Node process** cho một phòng game.

Không chạy nhiều replica, không bật Auto Scaling và không deploy/restart giữa trận. Socket.IO có thể chuyển packet giữa nhiều node bằng adapter, nhưng game state hiện không được chia sẻ; mỗi process sẽ có một trận khác nhau.

AWS xác nhận Application Load Balancer hỗ trợ WebSocket, nhưng với một phòng/classroom thì Nginx trực tiếp trên một EC2 đơn giản và tiết kiệm hơn. Chỉ thêm ALB khi thực sự cần AWS Certificate Manager, WAF hoặc kiến trúc nhiều tầng.

Tài liệu chính thức:

- [Launch EC2 instance](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/LaunchingAndUsingInstances.html)
- [EC2 launch parameters và security group](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-instance-launch-parameters.html)
- [AWS ALB WebSocket support](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-listeners.html)
- [Socket.IO reverse proxy](https://socket.io/docs/v4/reverse-proxy/)
- [Nginx WebSocket proxy](https://nginx.org/en/docs/http/websocket.html)

## 2. Cấu hình AWS đề xuất

### Region

Nếu người chơi ở Việt Nam, ưu tiên kiểm tra latency tại:

- `ap-southeast-1` — Singapore.
- Region khác chỉ chọn khi latency thực tế tốt hơn hoặc có yêu cầu dữ liệu riêng.

### Instance

Khởi đầu an toàn cho một lớp tối đa khoảng 50 người:

- Ubuntu Server 24.04 LTS, x86_64.
- Tối thiểu 2 vCPU, 4 GiB RAM.
- Khuyến nghị dòng compute/general-purpose không quá phụ thuộc CPU burst khi tổ chức trận quan trọng.
- EBS gp3 từ 20 GiB.

Không lấy cấu hình này làm cam kết tải. Phải rehearsal với đúng số thiết bị và Wi-Fi thật trước ngày sử dụng.

### Elastic IP

Gắn một Elastic IP để địa chỉ public không đổi khi stop/start instance. AWS có thể tính phí public IPv4/Elastic IP; nhớ release khi không còn dùng.

### Security group

Inbound:

| Protocol | Port | Source | Mục đích |
|---|---:|---|---|
| TCP | 22 | IP quản trị của bạn `/32` | SSH |
| TCP | 80 | `0.0.0.0/0`, `::/0` | HTTP và cấp certificate |
| TCP | 443 | `0.0.0.0/0`, `::/0` | HTTPS/WSS |

Không mở port `3000` ra Internet. Nginx trên máy sẽ proxy vào `127.0.0.1:3000`.

AWS cảnh báo không nên mở SSH `0.0.0.0/0` trong production; chỉ cho phép IP quản trị cụ thể.

Outbound có thể giữ mặc định để instance tải package và certificate.

## 3. Chuẩn bị domain

Tạo bản ghi DNS:

```text
Type: A
Name: game.example.com
Value: <ELASTIC_IP>
TTL: 300
```

Chờ DNS cập nhật rồi kiểm tra:

```bash
nslookup game.example.com
```

Kết quả phải trỏ đúng Elastic IP trước khi chạy Certbot.

## 4. Kết nối EC2

Trên máy cá nhân:

```bash
chmod 400 your-key.pem
ssh -i your-key.pem ubuntu@<ELASTIC_IP>
```

Windows PowerShell:

```powershell
ssh -i C:\keys\your-key.pem ubuntu@<ELASTIC_IP>
```

## 5. Cài package hệ thống

```bash
sudo apt update
sudo apt upgrade -y
sudo apt install -y nginx git curl ca-certificates build-essential certbot python3-certbot-nginx
```

Cài Node.js 24.x theo phương thức bạn đã phê duyệt cho hệ thống. Sau khi cài, bắt buộc kiểm tra:

```bash
node --version
npm --version
which node
```

Kỳ vọng `node` nằm tại `/usr/bin/node`. Nếu nằm ở đường dẫn khác, sửa `ExecStart` trong systemd ở phần dưới.

Không chạy production bằng `npx`, VS Code terminal hoặc một phiên SSH phải mở liên tục.

## 6. Tạo user dịch vụ

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin mln-game
sudo mkdir -p /opt/mln-game/releases
sudo chown -R mln-game:mln-game /opt/mln-game
```

## 7. Đưa source lên server

### Cách A — Git repository

```bash
sudo -u mln-game git clone <YOUR_REPOSITORY_URL> /opt/mln-game/releases/initial
```

### Cách B — SCP từ máy cá nhân

Không upload `node_modules`, `.git`, log hoặc file secret.

```bash
scp -i your-key.pem -r ./mln-game ubuntu@<ELASTIC_IP>:/tmp/mln-game
```

Trên EC2:

```bash
sudo mv /tmp/mln-game /opt/mln-game/releases/initial
sudo chown -R mln-game:mln-game /opt/mln-game/releases/initial
```

Tạo symlink release hiện hành:

```bash
sudo ln -sfn /opt/mln-game/releases/initial /opt/mln-game/current
```

## 8. Cài dependency production

```bash
cd /opt/mln-game/current
sudo -u mln-game npm ci --omit=dev
```

Kiểm tra cú pháp:

```bash
sudo -u mln-game node --check server.js
```

Không upload `node_modules` từ Windows lên Linux.

## 9. Cấu hình môi trường

Tạo secret ngoài repository:

```bash
sudo nano /etc/mln-game.env
```

Nội dung đề xuất:

```dotenv
NODE_ENV=production
PORT=3000

# Đổi thành PIN riêng, không giữ 2468 khi public Internet.
HOST_PIN=CHANGE_TO_A_STRONG_PRIVATE_PIN
HOST_RECONNECT_GRACE_MS=30000

# Giới hạn phòng và network.
MAX_PLAYERS=50
PLAYER_NETWORK_RATE=30
HOST_NETWORK_RATE=30
IDLE_NETWORK_RATE=2
PERSONAL_STATE_RATE=5
PLAYER_AOI_RADIUS=900
PLAYER_RESOURCE_RATE=3
HOST_RESOURCE_RATE=3

# Chống spam vật thể bắn vốn.
MAX_EJECTED_PER_PLAYER=32
MAX_EJECTED_GLOBAL=500
```

Khóa quyền đọc:

```bash
sudo chown root:mln-game /etc/mln-game.env
sudo chmod 640 /etc/mln-game.env
```

Không commit file `/etc/mln-game.env`, PIN hoặc private key vào Git.

### Link tham gia

Sau khi host đăng nhập, dùng chức năng sửa link tham gia và đặt:

```text
https://game.example.com/player
```

Nếu không đặt, server có thể tạo link từ network interface của EC2 và QR không đúng domain public.

## 10. Tạo systemd service

```bash
sudo nano /etc/systemd/system/mln-game.service
```

Nội dung:

```ini
[Unit]
Description=Monopoly Market Arena
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=mln-game
Group=mln-game
WorkingDirectory=/opt/mln-game/current
EnvironmentFile=/etc/mln-game.env
ExecStart=/usr/bin/node /opt/mln-game/current/server.js
Restart=on-failure
RestartSec=5
TimeoutStopSec=20
KillSignal=SIGTERM
LimitNOFILE=65535
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true

[Install]
WantedBy=multi-user.target
```

Nạp và chạy:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now mln-game
sudo systemctl status mln-game --no-pager
```

Xem log:

```bash
sudo journalctl -u mln-game -n 100 --no-pager
sudo journalctl -u mln-game -f
```

Kiểm tra local:

```bash
curl -I http://127.0.0.1:3000/player
curl 'http://127.0.0.1:3000/socket.io/?EIO=4&transport=polling'
```

Lệnh Socket.IO phải trả handshake, không phải 404/502.

## 11. Cấu hình Nginx cho HTTP và WebSocket

Tạo map header upgrade:

```bash
sudo nano /etc/nginx/conf.d/websocket-map.conf
```

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}
```

Tạo virtual host:

```bash
sudo nano /etc/nginx/sites-available/mln-game
```

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name game.example.com;

    client_max_body_size 2m;

    location /socket.io/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 75s;
        proxy_send_timeout 75s;
        proxy_buffering off;
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 75s;
        proxy_send_timeout 75s;
    }
}
```

Đổi toàn bộ `game.example.com` thành domain thật.

Kích hoạt:

```bash
sudo ln -sfn /etc/nginx/sites-available/mln-game /etc/nginx/sites-enabled/mln-game
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

Kiểm tra HTTP:

```bash
curl -I http://game.example.com/player
```

## 12. Bật HTTPS

Sau khi DNS đã trỏ đúng và port 80/443 mở:

```bash
sudo certbot --nginx -d game.example.com
```

Chọn redirect HTTP sang HTTPS.

Kiểm tra gia hạn:

```bash
sudo certbot renew --dry-run
```

Kiểm tra:

```bash
curl -I https://game.example.com/player
```

Trình duyệt phải kết nối bằng:

```text
https://game.example.com/host
https://game.example.com/player
```

Socket.IO cùng origin sẽ tự dùng `wss://` khi trang chạy HTTPS.

## 13. Firewall trên Ubuntu

Security group là lớp bắt buộc. Có thể bổ sung UFW:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status
```

Không `ufw allow 3000`.

## 14. Quy trình deploy release mới

Không deploy khi trận đang chạy.

Ví dụ release có timestamp:

```bash
RELEASE=$(date +%Y%m%d-%H%M%S)
sudo -u mln-game git clone <YOUR_REPOSITORY_URL> /opt/mln-game/releases/$RELEASE
cd /opt/mln-game/releases/$RELEASE
sudo -u mln-game npm ci --omit=dev
sudo -u mln-game node --check server.js
```

Chuyển release:

```bash
sudo ln -sfn /opt/mln-game/releases/$RELEASE /opt/mln-game/current
sudo systemctl restart mln-game
sudo systemctl status mln-game --no-pager
curl -I http://127.0.0.1:3000/player
```

Sau đó mở một host và một player để smoke test thật.

## 15. Rollback

Liệt kê release:

```bash
ls -lah /opt/mln-game/releases
readlink -f /opt/mln-game/current
```

Trỏ lại release trước:

```bash
sudo ln -sfn /opt/mln-game/releases/<PREVIOUS_RELEASE> /opt/mln-game/current
sudo systemctl restart mln-game
sudo systemctl status mln-game --no-pager
```

Rollback/restart cũng làm mất trận đang nằm trong RAM. Chỉ thực hiện giữa các trận trừ khi server đã hỏng hoàn toàn.

## 16. Checklist trước khi mở phòng

- [ ] EC2 ở trạng thái running và không có lịch maintenance trong giờ chơi.
- [ ] Elastic IP và DNS đúng.
- [ ] HTTPS certificate hợp lệ.
- [ ] `systemctl is-active mln-game` trả `active`.
- [ ] `systemctl is-active nginx` trả `active`.
- [ ] `/host` và `/player` mở được qua HTTPS.
- [ ] Host PIN đã đổi khỏi giá trị mặc định.
- [ ] QR/link tham gia là domain public HTTPS.
- [ ] Một player thử join, di chuyển, tách và bắn vốn thành công.
- [ ] Host nhận state mượt, không có lỗi 502/504.
- [ ] Test bằng mạng ngoài, không chỉ từ EC2/local.
- [ ] Rehearsal với số thiết bị gần tải thật.
- [ ] Không có deploy/restart/Auto Scaling trong trận.

## 17. Kiểm tra hiệu năng

### CPU và RAM

```bash
top
free -h
ps -o pid,%cpu,%mem,rss,cmd -C node
```

### Port và connection

```bash
sudo ss -lntp
sudo ss -ant | grep ':443' | wc -l
```

### Log lỗi

```bash
sudo journalctl -u mln-game --since '15 minutes ago' --no-pager
sudo tail -n 200 /var/log/nginx/error.log
```

### Network

```bash
sudo apt install -y nload
nload
```

Nếu CPU thấp nhưng game lag trên nhiều máy, kiểm tra bandwidth, packet loss, Wi-Fi/AP và Nginx 499/502 trước khi tăng instance.

## 18. Xử lý sự cố

### `502 Bad Gateway`

```bash
sudo systemctl status mln-game --no-pager
sudo journalctl -u mln-game -n 100 --no-pager
curl -I http://127.0.0.1:3000/player
sudo nginx -t
```

### Trang mở được nhưng Socket.IO không kết nối

- Kiểm tra block `location /socket.io/`.
- Kiểm tra `proxy_http_version 1.1`.
- Kiểm tra header `Upgrade` và `Connection`.
- Kiểm tra security group port 443.
- Kiểm tra browser DevTools → Network → WS.

### QR trỏ sai IP/private URL

Trong host, sửa join URL thành:

```text
https://game.example.com/player
```

### Server restart giữa trận

State hiện chỉ ở RAM nên không thể phục hồi đầy đủ. Xem nguyên nhân:

```bash
sudo journalctl -u mln-game -b --no-pager
sudo dmesg -T | grep -i -E 'oom|killed process'
```

Nếu có OOM, tăng RAM và kiểm tra object/socket tăng bất thường; không chỉ bật restart loop.

### Chuyển động vẫn lag

- Xác nhận client đã tải `game-sprites.js?v=20260714-2`.
- Hard refresh hoặc xóa cache.
- Kiểm tra biến môi trường `PLAYER_NETWORK_RATE=30` và `HOST_NETWORK_RATE=30`.
- Kiểm tra packet loss và latency từ thiết bị đến AWS.
- Thử WebSocket trực tiếp thay vì mạng/proxy chặn upgrade.
- Profile FPS trên thiết bị host/player.

## 19. Phương án ALB tùy chọn

Chỉ dùng nếu cần ACM/WAF hoặc chuẩn hóa hạ tầng AWS:

```text
Route 53 → ALB HTTPS :443 → Target group HTTP :3000 → một EC2
```

Yêu cầu:

- ALB ở ít nhất hai subnet theo yêu cầu dịch vụ.
- Certificate ACM gắn listener 443.
- Target group trỏ port 3000.
- EC2 security group chỉ cho phép port 3000 từ security group của ALB.
- Target health check dùng một HTTP path trả 200, tạm thời có thể là `/player`.
- Chỉ đăng ký một target khi state vẫn ở RAM.

ALB hỗ trợ WebSocket nguyên bản và WebSocket connection sau upgrade vốn gắn với target đã chấp nhận kết nối. Điều đó không biến nhiều Node process thành một shared game state.

## 20. Việc cần làm trước public Internet lâu dài

Host đã có PIN, nhưng player hiện không có room/invite code. Nếu URL public bị lộ, người ngoài có thể chiếm slot.

Trước khi chạy public lâu dài nên bổ sung:

- Room code hoặc signed join token có TTL.
- Rate limit theo IP tại Nginx/WAF.
- Health endpoint nhẹ thay vì dùng `/player`.
- Metrics/CloudWatch alarm cho CPU, RAM, disk và process restart.
- Backup config Nginx/systemd/env ở nơi mã hóa an toàn.
- Load test và rehearsal trên AWS trước sự kiện thật.

## 21. Lệnh kiểm tra nhanh sau deploy

```bash
sudo systemctl is-active mln-game
sudo systemctl is-active nginx
curl -fsSI http://127.0.0.1:3000/player
curl -fsSI https://game.example.com/player
sudo nginx -t
sudo journalctl -u mln-game -n 30 --no-pager
```

Nếu tất cả đạt, mở `/host`, xác thực PIN, đặt link tham gia HTTPS, kết nối ít nhất một player và chạy một vòng smoke test trước khi mời cả lớp.
