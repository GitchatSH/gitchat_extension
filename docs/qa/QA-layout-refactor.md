# GitChat Layout Refactor — QA Checklist

Branch: `slug-layout-refactor`

✅ = code verified (67 items) | ⬜ = needs manual test (14 items)

## 1. Layout & Navigation
- [x] Sidebar hien "GitChat" header (native VS Code)
- [x] 3 icons tren header: Search, New Message, Profile
- [x] 3 tabs: Inbox | Friends | Channels
- [x] Filter chips (All | Direct | Group | Requests) hien khi o Inbox tab
- [x] Filter chips an khi switch sang Friends/Channels
- [x] Click conversation → slide animation sang chat view
- [x] Tabs an khi o chat view
- [x] Nut ← back → slide ve list, tabs hien lai
- [ ] Scroll position giu nguyen khi back ve list ⬜ manual
- [ ] Sidebar border ben phai luon hien ⬜ manual

## 2. Chat List (Inbox)
- [x] Conversations load va hien dung (avatar, name, preview, time)
- [x] Unread badge hien dung
- [x] Pin icon hien cho pinned conversations
- [x] Mute icon hien cho muted conversations
- [x] Draft preview "[Draft] ..." hien khi co draft
- [x] Sorting: Pinned first → recency → Muted last
- [x] Right-click → context menu (Pin/Unpin, Mark Read, Delete)
- [x] Filter chips loc dung (Direct, Group, Requests)
- [x] Context menu tu dong close khi click outside

## 3. Friends Tab
- [x] Friends list load voi online/offline status
- [x] Search bar hien va filter dung
- [ ] Click friend → mo chat trong sidebar ⬜ manual (command flow)

## 4. Channels Tab
- [x] Channels list load
- [ ] Click channel → mo chat trong sidebar ⬜ manual (command flow)

## 5. Chat View — Messages
- [x] Messages render dung (bubbles, sender name, timestamp)
- [x] Sent messages ben phai (accent bg), received ben trai
- [x] Group messages gom dung (consecutive from same sender)
- [x] Date separators hien giua cac ngay
- [x] Reply quotes hien dung (left border + sender name)
- [x] Status icons: sending → sent (check) → seen (double check)
- [x] Scroll len → tu dong load older messages (infinite scroll, KHONG co button)
- [x] Scroll position giu nguyen sau khi load older (KHONG nhay xuong bottom)
- [x] Go Down button hien khi scroll len, an khi o bottom
- [x] Go Down badge hien so tin nhan moi

## 6. Chat View — Input
- [x] Go text + Enter → gui message
- [x] Shift+Enter → new line
- [x] Input auto-expand khi go nhieu dong
- [x] Send button hien khi co text, an khi trong
- [x] Up arrow (input trong) → edit last message
- [x] Draft auto-save khi back ra ngoai, restore khi mo lai

## 7. Reactions & Emoji
- [x] Hover message → floating bar (React, Reply, Copy, More)
- [x] Click React → emoji picker
- [x] Emoji picker hien dung, search works
- [x] Click emoji → reaction hien duoi message
- [x] Click emoji button trong input → picker insert emoji vao text
- [x] Reaction pills hien dung (emoji + count)

## 8. Reply
- [x] Click Reply (floating bar) → reply bar hien tren input
- [x] Reply bar hien ten sender + preview text
- [x] X button dong reply bar
- [x] Escape dong reply bar
- [x] Gui message khi reply → message co quote

## 9. Pinned Messages
- [x] Pinned banner hien khi co pinned messages
- [x] Click banner → cycle qua pinned messages
- [x] Expand → full pinned list view voi search
- [x] Click pinned message → jump to message trong chat
- [x] Pin/Unpin qua More menu

## 10. Attachments & Link Previews
- [x] Attach button → menu (Photo/Video + Document)
- [x] Chon file → preview strip hien truoc khi gui
- [x] Drag & drop file vao messages area
- [x] Paste image vao input
- [x] Image attachment render dung trong message
- [x] File attachment hien download link
- [x] Click image → lightbox overlay
- [x] Link preview bar hien khi go URL vao input
- [x] Link preview card hien trong message da gui

## 11. Message Actions
- [x] More dropdown: Forward, Pin, Edit, Unsend, Delete
- [x] Edit (15min window) → inline textarea
- [x] Unsend → confirmation → message removed
- [x] Delete for me → confirmation → message removed
- [x] Forward → conversation picker → send
- [x] Copy → clipboard + toast

## 12. In-Chat Search
- [x] Click search icon tren header → search bar hien
- [x] Go text → results hien (debounce 300ms)
- [x] Click result → jump to message trong chat
- [x] Navigate prev/next qua results
- [x] Close search → ve lai chat binh thuong
- [x] User filter (groups only)

## 13. @Mentions
- [x] Go `@` → autocomplete dropdown
- [x] Filter by typed text
- [x] Click/Enter → insert mention
- [x] Groups: show member list, DMs: show friends

## 14. Group Management
- [x] Header menu → Group Info
- [x] Group info panel: name, avatar, member list
- [x] Add/remove member (creator/admin)
- [x] Invite link create/copy/revoke
- [x] Leave/Delete group

## 15. Real-time ⬜ (all need live WebSocket)
- [ ] New messages appear live
- [ ] Typing indicator hien trong subtitle
- [ ] Reactions update live
- [ ] Read receipts update (check → double check)
- [ ] Online/offline status update

## 16. State Persistence
- [x] Switch sang Explorer sidebar → switch back → state giu nguyen
- [ ] Dang o chat view → switch away → switch back → chat restore ⬜ manual
- [x] Tab selection giu nguyen sau restore

## 17. Theme Compatibility ⬜ (all need visual check)
- [ ] Dark theme OK
- [ ] Light theme OK
- [ ] High Contrast theme OK

## 18. New Chat Flow
- [x] Click New Message icon → dropdown (New Message / New Group)
- [ ] New Message → user picker → click user → start DM trong sidebar ⬜ manual
- [ ] New Group → select users → group info → create → mo chat trong sidebar ⬜ manual

## 19. Hidden Features
- [x] Set SHOW_FEED_TAB = true → Feed tab hien va hoat dong
- [x] Set SHOW_TRENDING_TAB = true → Trending tab hien va hoat dong
