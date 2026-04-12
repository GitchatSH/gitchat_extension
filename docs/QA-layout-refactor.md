# GitChat Layout Refactor — QA Checklist

Branch: `slug-layout-refactor`

## 1. Layout & Navigation
- [ ] Sidebar hien "GitChat" header (native VS Code)
- [ ] 3 icons tren header: Search, New Message, Profile
- [ ] 3 tabs: Inbox | Friends | Channels
- [ ] Filter chips (All | Direct | Group | Requests) hien khi o Inbox tab
- [ ] Filter chips an khi switch sang Friends/Channels
- [ ] Click conversation → slide animation sang chat view
- [ ] Tabs an khi o chat view
- [ ] Nut ← back → slide ve list, tabs hien lai
- [ ] Scroll position giu nguyen khi back ve list
- [ ] Sidebar border ben phai luon hien

## 2. Chat List (Inbox)
- [ ] Conversations load va hien dung (avatar, name, preview, time)
- [ ] Unread badge hien dung
- [ ] Pin icon hien cho pinned conversations
- [ ] Mute icon hien cho muted conversations
- [ ] Draft preview "[Draft] ..." hien khi co draft
- [ ] Sorting: Pinned first → recency → Muted last
- [ ] Right-click → context menu (Pin/Unpin, Mark Read, Delete)
- [ ] Filter chips loc dung (Direct, Group, Requests)
- [ ] Context menu tu dong close khi click outside

## 3. Friends Tab
- [ ] Friends list load voi online/offline status
- [ ] Search bar hien va filter dung
- [ ] Click friend → mo chat trong sidebar

## 4. Channels Tab
- [ ] Channels list load
- [ ] Click channel → mo chat trong sidebar

## 5. Chat View — Messages
- [ ] Messages render dung (bubbles, sender name, timestamp)
- [ ] Sent messages ben phai (accent bg), received ben trai
- [ ] Group messages gom dung (consecutive from same sender)
- [ ] Date separators hien giua cac ngay
- [ ] Reply quotes hien dung (left border + sender name)
- [ ] Status icons: sending → sent (check) → seen (double check)
- [ ] Scroll len → tu dong load older messages (infinite scroll, KHONG co button)
- [ ] Scroll position giu nguyen sau khi load older (KHONG nhay xuong bottom)
- [ ] Go Down button hien khi scroll len, an khi o bottom
- [ ] Go Down badge hien so tin nhan moi

## 6. Chat View — Input
- [ ] Go text + Enter → gui message
- [ ] Shift+Enter → new line
- [ ] Input auto-expand khi go nhieu dong
- [ ] Send button hien khi co text, an khi trong
- [ ] Up arrow (input trong) → edit last message
- [ ] Draft auto-save khi back ra ngoai, restore khi mo lai

## 7. Reactions & Emoji
- [ ] Hover message → floating bar (React, Reply, Copy, More)
- [ ] Click React → emoji picker
- [ ] Emoji picker hien dung, search works
- [ ] Click emoji → reaction hien duoi message
- [ ] Click emoji button trong input → picker insert emoji vao text
- [ ] Reaction pills hien dung (emoji + count)

## 8. Reply
- [ ] Click Reply (floating bar) → reply bar hien tren input
- [ ] Reply bar hien ten sender + preview text
- [ ] X button dong reply bar
- [ ] Escape dong reply bar
- [ ] Gui message khi reply → message co quote

## 9. Pinned Messages
- [ ] Pinned banner hien khi co pinned messages
- [ ] Click banner → cycle qua pinned messages
- [ ] Expand → full pinned list view voi search
- [ ] Click pinned message → jump to message trong chat
- [ ] Pin/Unpin qua More menu

## 10. Attachments & Link Previews
- [ ] Attach button → menu (Photo/Video + Document)
- [ ] Chon file → preview strip hien truoc khi gui
- [ ] Drag & drop file vao messages area
- [ ] Paste image vao input
- [ ] Image attachment render dung trong message
- [ ] File attachment hien download link
- [ ] Click image → lightbox overlay
- [ ] Link preview bar hien khi go URL vao input
- [ ] Link preview card hien trong message da gui

## 11. Message Actions
- [ ] More dropdown: Forward, Pin, Edit, Unsend, Delete
- [ ] Edit (15min window) → inline textarea
- [ ] Unsend → confirmation → message removed
- [ ] Delete for me → confirmation → message removed
- [ ] Forward → conversation picker → send
- [ ] Copy → clipboard + toast

## 12. In-Chat Search
- [ ] Click search icon tren header → search bar hien
- [ ] Go text → results hien (debounce 300ms)
- [ ] Click result → jump to message trong chat
- [ ] Navigate prev/next qua results
- [ ] Close search → ve lai chat binh thuong
- [ ] User filter (groups only)

## 13. @Mentions
- [ ] Go `@` → autocomplete dropdown
- [ ] Filter by typed text
- [ ] Click/Enter → insert mention
- [ ] Groups: show member list, DMs: show friends

## 14. Group Management
- [ ] Header menu → Group Info
- [ ] Group info panel: name, avatar, member list
- [ ] Add/remove member (creator/admin)
- [ ] Invite link create/copy/revoke
- [ ] Leave/Delete group

## 15. Real-time
- [ ] New messages appear live
- [ ] Typing indicator hien trong subtitle
- [ ] Reactions update live
- [ ] Read receipts update (check → double check)
- [ ] Online/offline status update

## 16. State Persistence
- [ ] Switch sang Explorer sidebar → switch back → state giu nguyen
- [ ] Dang o chat view → switch away → switch back → chat restore
- [ ] Tab selection giu nguyen sau restore

## 17. Theme Compatibility
- [ ] Dark theme OK
- [ ] Light theme OK
- [ ] High Contrast theme OK

## 18. New Chat Flow
- [ ] Click New Message icon → dropdown (New Message / New Group)
- [ ] New Message → user picker → click user → start DM trong sidebar
- [ ] New Group → select users → group info → create → mo chat trong sidebar

## 19. Hidden Features
- [ ] Set SHOW_FEED_TAB = true → Feed tab hien va hoat dong
- [ ] Set SHOW_TRENDING_TAB = true → Trending tab hien va hoat dong
