# QA: WP4 Tab Layout

> **Branch:** slug-wp4-tab-layout-v2
> **Ngày:** 2026-04-14
> **Tester:** slugmacro

## Cách test

1. `npm run compile` (phải pass)
2. Nhấn **F5** trong VS Code để mở Extension Development Host
3. Đăng nhập GitHub
4. Đi theo checklist bên dưới

---

## 1. Cấu trúc Tab

- [ ] 1.1 Hiện 3 tab: **Chat** | **Friends** | **Discover**
- [ ] 1.2 Không còn chữ "Inbox", "Channels", "Feed", "Trending" ở đâu cả
- [ ] 1.3 Tab Chat active mặc định khi mở lần đầu
- [ ] 1.4 Tab active có indicator (underline/accent) rõ ràng
- [ ] 1.5 Bấm mỗi tab chuyển nội dung đúng

## 2. Chat Tab — Filter Chips

- [ ] 2.1 Filter bar hiện: **All** | **DM** | **Groups** | **Communities** | **Teams**
- [ ] 2.2 "All" active mặc định (highlight)
- [ ] 2.3 Bấm "DM" chỉ hiện DM conversations
- [ ] 2.4 Bấm "Groups" chỉ hiện group conversations
- [ ] 2.5 Bấm "Communities" chỉ hiện community conversations (có thể rỗng)
- [ ] 2.6 Bấm "Teams" chỉ hiện team conversations (có thể rỗng)
- [ ] 2.7 Bấm "All" lại hiện tất cả
- [ ] 2.8 Chỉ 1 chip active tại 1 thời điểm
- [ ] 2.9 Count badge cập nhật đúng theo filter (dạng "(N)")

## 3. Chat Tab — Hiển thị Type

- [ ] 3.1 DM: avatar **tròn** + chấm xanh (online) hoặc chấm xám (offline)
- [ ] 3.2 Group: avatar **vuông bo góc** (6px) + icon `codicon-organization` trước tên (màu muted)
- [ ] 3.3 Community: avatar **vuông bo góc** + icon `codicon-star` trước tên (màu muted)
- [ ] 3.4 Team: avatar **vuông bo góc** + icon `codicon-git-pull-request` trước tên (màu muted)
- [ ] 3.5 Icon màu muted (`--gs-muted`), không màu sắc nổi bật
- [ ] 3.6 Bấm conversation vẫn mở chat view bình thường

## 4. Chat Tab — Danh sách Conversation

- [ ] 4.1 Conversations sắp xếp theo tin nhắn mới nhất (newest first)
- [ ] 4.2 Conversations được pin lên đầu, icon pin nằm cạnh timestamp (không phải trước tên)
- [ ] 4.3 Badge unread (`.gs-badge`) hiện trên conversations chưa đọc
- [ ] 4.4 Preview tin nhắn cuối có ellipsis khi dài
- [ ] 4.5 Timestamp hiện (2m, 15m, 1h, 2d, v.v.)
- [ ] 4.6 "Draft:" hiện trước preview khi có tin nháp chưa gửi
- [ ] 4.7 Conversations bị mute hiện mờ + icon chuông gạch
- [ ] 4.8 Typing indicator hiện "typing..." trong preview
- [ ] 4.9 Empty state khi không có conversations
- [ ] 4.10 Empty state khi filter active nhưng không có kết quả
- [ ] 4.11 Right-click context menu hoạt động (Pin/Unpin, Mark as read, Delete)

## 5. Friends Tab — Accordion

- [ ] 5.1 3 sections hiện: **ONLINE** | **OFFLINE** | **NOT ON GITCHAT**
- [ ] 5.2 Header "ONLINE" chữ **xanh lá** (`--gs-success`)
- [ ] 5.3 Header "OFFLINE" chữ **xám** (`--gs-muted`)
- [ ] 5.4 Header "NOT ON GITCHAT" chữ **mờ** (muted + opacity 0.5)
- [ ] 5.5 Count badge hiện trên mỗi header
- [ ] 5.6 Count badge Online có nền xanh nhạt (green tint)

## 6. Friends Tab — Hành vi Accordion

- [ ] 6.1 Bấm header thu gọn section (chevron xoay -90 độ)
- [ ] 6.2 Bấm header lần nữa mở ra (chevron xoay lại)
- [ ] 6.3 Nhiều sections có thể mở cùng lúc
- [ ] 6.4 Section thu gọn vẫn hiện count badge
- [ ] 6.5 **Nhớ trạng thái:** thu gọn → chuyển tab Chat → quay lại Friends → vẫn thu gọn
- [ ] 6.6 **Nhớ trạng thái qua ẩn/hiện sidebar:** thu gọn → ẩn sidebar → hiện lại → vẫn giữ
- [ ] 6.7 Bàn phím: Tab đến header, Enter/Space toggle thu gọn/mở rộng

## 7. Friends Tab — Nội dung

- [ ] 7.1 Bạn online: avatar + chấm xanh + tên + nút DM (ghost)
- [ ] 7.2 Bạn offline: avatar mờ (opacity 0.5) + tên + "· Xh ago" + nút DM
- [ ] 7.3 Not on GitChat: placeholder "Coming soon" (section thu gọn mặc định)
- [ ] 7.4 Bấm nút DM mở chat (không navigate sang profile)
- [ ] 7.5 Bấm row mở profile view
- [ ] 7.6 Hover avatar hiện profile card popover
- [ ] 7.7 Section "NOT ON GITCHAT" thu gọn mặc định
- [ ] 7.8 Khi không có bạn bè: hiện "Follow people on GitHub to see them here"

## 8. Discover Tab — Accordion

- [ ] 8.1 4 sections: **PEOPLE** | **COMMUNITIES** | **TEAMS** | **ONLINE NOW**
- [ ] 8.2 People hiện danh sách người bạn follow
- [ ] 8.3 Communities hiện repo channels (từ `setChannelData`)
- [ ] 8.4 Teams hiện placeholder: "Contribute to repos to join their teams"
- [ ] 8.5 Online Now hiện bạn bè đang online + chấm xanh
- [ ] 8.6 Count badge trên mỗi header

## 9. Discover Tab — Hành vi Accordion

- [ ] 9.1 Hành vi thu gọn/mở rộng giống Friends tab
- [ ] 9.2 Trạng thái lưu riêng, không ảnh hưởng Friends tab
- [ ] 9.3 Section "TEAMS" thu gọn mặc định
- [ ] 9.4 Bàn phím: Enter/Space toggle

## 10. Discover Tab — Nội dung

- [ ] 10.1 People: avatar + tên + nút DM (ghost)
- [ ] 10.2 Communities: icon `codicon-star` (muted) + tên repo + số member + nút Join/Joined
- [ ] 10.3 Bấm community row gọi joinCommunity handler
- [ ] 10.4 Online Now: avatar + chấm xanh + tên + nút **Wave** (disabled, tooltip "Coming soon")
- [ ] 10.5 Empty state mỗi section có icon Codicon + thông báo phù hợp
- [ ] 10.6 Nút DM bấm mở chat (stopPropagation, không trigger row click)

## 11. Tìm kiếm

- [ ] 11.1 Placeholder thay đổi theo tab: "Search messages..." / "Search friends..." / "Search..."
- [ ] 11.2 Tìm trên Chat gọi BE search (debounce 300ms)
- [ ] 11.3 Tìm trên Friends lọc client-side tức thì qua tất cả sections
- [ ] 11.4 Tìm trên Discover lọc client-side tức thì qua tất cả sections
- [ ] 11.5 Xóa search khôi phục danh sách đầy đủ
- [ ] 11.6 Chuyển tab xóa ô search và reset trạng thái
- [ ] 11.7 Tìm + filter chip: khi chip active, kết quả search bị post-filter theo type

## 12. Điều hướng & Trạng thái

- [ ] 12.1 Bấm conversation → mở chat → nút back → quay lại đúng tab
- [ ] 12.2 Trạng thái tab giữ nguyên sau đóng/mở sidebar
- [ ] 12.3 State cũ ("inbox"/"channels") tự migrate sang "chat"/"discover"
- [ ] 12.4 Badge unread trên tab Chat vẫn hoạt động
- [ ] 12.5 Vị trí scroll giữ nguyên mỗi tab (chuyển đi rồi quay lại = scroll cũ)

## 13. Loading & Error

- [ ] 13.1 Skeleton loading (hàng giả nhấp nháy) hiện khi đang tải data chat
- [ ] 13.2 "Searching..." hiện khi đang chờ kết quả tìm kiếm Chat
- [ ] 13.3 Lỗi search hiện thông báo + nút Retry
- [ ] 13.4 Nút Retry bấm tìm lại được

## 14. Tính năng cũ vẫn hoạt động

- [ ] 14.1 Right-click menu trên conversations (Pin/Unpin, Mark as read, Delete)
- [ ] 14.2 Typing indicator hiện trong preview conversation
- [ ] 14.3 "Draft:" hiện trên conversations có tin nháp
- [ ] 14.4 Conversations bị mute hiện mờ + icon chuông gạch
- [ ] 14.5 Hover avatar hiện profile card popover
- [ ] 14.6 User menu (settings, sign out) hoạt động
- [ ] 14.7 Notification section hoạt động (nếu có)

## 15. Giao diện / Design System

- [ ] 15.1 Không hardcode màu (tất cả dùng --gs-* tokens)
- [ ] 15.2 Hiển thị đúng trên cả dark và light theme của VS Code
- [ ] 15.3 Không emoji trong UI (chỉ Codicons)
- [ ] 15.4 Font size >= 11px mọi nơi
- [ ] 15.5 Spacing theo lưới 4px
- [ ] 15.6 Extension trông native VS Code (không giống web app nhúng)

## 16. Kiểm tra Cleanup

- [ ] 16.1 Không còn chữ "Feed" hoặc "Trending" trong UI
- [ ] 16.2 Không lỗi trong console (mở DevTools: Help → Toggle Developer Tools)
- [ ] 16.3 Không có click handler chết hoặc navigation hỏng

---

## Bug Log

| # | Khu vực | Mô tả | Trạng thái |
|---|---------|-------|------------|
| | | | |
