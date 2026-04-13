# QA Checklist: Telegram Scroll System

**Branch:** `slug-scroll`
**Test:** F5 trong VS Code để launch Extension Host

---

## 1. Go Down Button

- [ ] Scroll lên >300px trong chat → button Go Down xuất hiện (slide up animation)
- [ ] Scroll về ≤100px → button biến mất (slide down animation)
- [ ] Scroll trong vùng 100-300px → button giữ nguyên trạng thái (không nhấp nháy)
- [ ] Click Go Down khi không có unread → smooth scroll về bottom (nếu gần), instant jump (nếu xa >1000px)
- [ ] Click Go Down khi có unread divider → scroll đến divider "New Messages"

## 2. Badge trên Go Down

- [ ] Scroll lên, nhận tin nhắn mới → badge đỏ hiện số (1, 2, 3...)
- [ ] Nhận thêm tin → badge tăng
- [ ] Scroll về bottom → badge biến mất, counter reset
- [ ] Trong chat **muted** → badge **xám** thay vì đỏ
- [ ] Gửi tin nhắn khi scrolled up → badge reset về 0

## 3. Auto-Scroll khi gửi tin

- [ ] Scroll lên, gửi tin nhắn text → auto scroll về bottom
- [ ] Scroll lên, gửi attachment → auto scroll về bottom
- [ ] Scroll lên, reply tin nhắn → auto scroll về bottom

## 4. Unread Divider ("New Messages")

- [ ] Mở conversation có unread → thấy dòng "New Messages" phía trên các tin chưa đọc
- [ ] Scroll xuống bottom → divider biến mất
- [ ] Divider **không** xuất hiện lại khi có tin mới trong cùng session
- [ ] Mở conversation không có unread → scroll thẳng xuống bottom (không có divider)

## 5. Mark as Read

- [ ] Mở chat, scroll xuống bottom → sidebar badge giảm/mất (conversation được mark read)
- [ ] Mở chat nhưng **không** scroll xuống → sidebar badge **vẫn còn** (chưa mark read)
- [ ] Scroll lên rồi scroll xuống lại → mark read chỉ trigger 1 lần (kiểm tra console/network)

## 6. Pin Jump + Context View

- [ ] Click vào pinned message → jump đến message đó, Go Down button xuất hiện
- [ ] Click Go Down khi đang xem context cũ → reload về latest messages

## 7. Sidebar Badges

- [ ] Conversation có unread → badge đỏ với số
- [ ] Conversation **muted** có unread → badge **xám** với số
- [ ] Nhận tin ở conversation khác → sidebar badge tăng realtime
- [ ] Nhận tin ở conversation đang mở + scrolled up → sidebar badge tăng
- [ ] Nhận tin ở conversation đang mở + ở bottom → sidebar badge **không** tăng

## 8. Mention & Reaction Buttons

> **Note:** Buttons chưa active vì BE chưa có endpoints. Chỉ verify:

- [ ] Mention button (`@`) **không hiện** (đúng — chưa có data)
- [ ] Reaction button (heart) **không hiện** (đúng — chưa có data)
- [ ] Không có lỗi JS trong console liên quan đến mention/reaction

## 9. Edge Cases

- [ ] Mở chat trống (0 messages) → không crash, không hiện divider
- [ ] Nhận nhiều tin liên tiếp khi scrolled up → badge đếm đúng
- [ ] Đóng chat rồi mở lại → state reset sạch (không residual badge/divider)
- [ ] Resize VS Code window khi đang trong chat → button stack vẫn đúng vị trí (bottom-right)

## 10. Visual / Animation

- [ ] Go Down button: tròn 36x36px, border, shadow, ở bottom-right
- [ ] Animation show: slide up + fade in (~150ms)
- [ ] Animation hide: slide down + fade out (~150ms)
- [ ] Badge: tròn 18px, nằm top-right của button
- [ ] Tất cả màu sắc blend với VS Code theme (test cả dark + light theme)
