# QA Checklist — In-Chat Search

## Setup
- [x] Branch: `slug-search`
- [x] F5 chạy extension, mở 1 group chat + 1 DM

## 1. Search Bar — Mở/Đóng
- [x] Header có nút search icon (codicon-search) cạnh gear
- [x] Click search icon → search bar xuất hiện dưới header
- [x] Search bar: arrows (disabled) | input | filter icons | close
- [x] Click ✕ → header restore đúng (tên, avatar, member count)
- [x] Escape → đóng search, header restore
- [x] Mở lại search lần 2 → hoạt động bình thường (không bị lỗi DOM)

## 2. Search Results
- [x] Gõ query → debounce 300ms → results list xuất hiện
- [x] Results: avatar + sender (xanh) + preview (keyword bold) + date
- [x] Date format: gần = "Yesterday"/"Sat", xa = "6/02/26"
- [x] Không có kết quả → "No messages found"
- [x] Xóa input → results clear, quay về empty state
- [x] Gõ nhanh liên tục → chỉ hiện kết quả cuối cùng (stale discard)
- [x] API lỗi → "Search unavailable"

## 3. User Match Card
- [x] Trong group chat, gõ tên member → user card hiện đầu results
- [x] User card: avatar + name + @handle
- [x] Click user card → activate user filter (badge xuất hiện trong search bar)
- [x] Trong DM → không hiện user card (chỉ 2 người)

## 4. Keyboard Navigation — Results List
- [x] Arrow ↑↓ → highlight di chuyển giữa result rows
- [x] Enter trên highlighted row → jump vào chat
- [x] Arrow buttons (↑↓ trên search bar) → disabled trong results list state

## 5. Jump to Message — Chat Navigation
- [x] Click result → results overlay ẩn, chat hiện message được highlight (viền xanh + nền xanh nhạt)
- [x] Highlight fade out sau 2s
- [x] Keyword highlight trong text message (vàng/accent)
- [x] Search bar vẫn hiện ở trên (kể cả khi scroll/reload)
- [x] Counter hiện: "3 of 12" (hoặc "3 of 12+" nếu có thêm)
- [x] Arrow buttons bây giờ enabled
- [x] Click ↑↓ buttons → nhảy giữa matched messages
- [x] Arrow keys (↑↓) → nhảy giữa matched messages
- [x] Click vào search input → quay về results list

## 6. Restore khi đóng
- [x] Đang ở chat nav → bấm Escape → chat restore về trạng thái trước search
- [x] Đang ở results list (chưa jump) → bấm Escape → chat không thay đổi

## 7. User Filter (Group chat only)
- [x] Icon person hiện trong group chat
- [x] Icon person ẩn trong DM
- [x] Click person icon → dropdown danh sách members
- [x] Click member → badge (chip style) hiện trong search bar + results lọc theo user
- [x] Click badge ✕ → bỏ filter, results reload
- [x] Click outside dropdown → dropdown đóng
- [x] System/deleted/empty messages filtered ra khỏi results
- [x] Attachment messages → "Photo" (ảnh), "Video" (video), filename (file)

## 8. Jump to Date (Telegram-style calendar)
- [x] Click calendar icon → date picker xuất hiện (popup cạnh icon)
- [x] Header: `< April 2026 >` — ◄ ► navigate theo tháng
- [x] ► disabled khi đang ở tháng hiện tại
- [x] Day labels: Mo Tu We Th Fr Sa Su — weekend (Sa Su) màu đỏ
- [x] Day grid: ngày trong tháng, ngày prev/next month mờ
- [x] Today highlight: circle xanh (focus color)
- [x] Ngày tương lai disabled (mờ, không click được)
- [ ] Click 1 ngày → chat nhảy đến messages ngày đó — **BLOCKED: BE `around_date` chưa support**
- [x] Click outside → picker đóng

## 9. Infinite Scroll
- [x] Scroll xuống cuối results list → load thêm results (nếu có nextCursor)
- [x] Results mới append vào list, không replace (giữ scroll position)
- [x] Loading spinner hiện ở cuối list khi đang load

## 10. Edge Cases
- [x] Search query rỗng (chỉ spaces) → không gọi API
- [x] Conversation ít messages → search hoạt động bình thường
- [x] Attachment messages trong results → hiện "Photo"/"Video"/filename
- [x] Nhận tin nhắn mới khi search đang mở → không crash, không hiện dưới overlay
- [x] Mở search → jump → scroll xa → bấm ↑↓ → nhảy đúng theo index

## 11. Build
- [x] `npm run compile` → 0 errors
- [x] `npm run check-types` → pass

## UI Polish (phiên 2026-04-12)
- [x] Search bar + pin banner height: 44px
- [x] Padding đồng bộ 16px (khớp header)
- [x] Border đồng bộ: `--gs-widget-border` (header/search/pin)
- [x] Search bar top offset 1px (không đè header border)
- [x] Input style khớp explore "Search repos & people"
- [x] Pin list icon: muted color (không dùng link color)
