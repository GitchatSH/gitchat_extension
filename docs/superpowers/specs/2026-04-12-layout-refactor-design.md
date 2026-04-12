# GitChat Layout Refactor — Telegram-Style Sidebar Chat

> Chuyển toàn bộ trải nghiệm chat từ editor panel sang sidebar (~300px). Viết mới sidebar-chat.js từ đầu, không port từ chat.js. Giữ nguyên tất cả chức năng hiện tại.

## Goals

1. Tất cả chat hoạt động trong sidebar — không mở editor panel
2. Clone trải nghiệm Telegram thu nhỏ: chat list → slide → chat view → back
3. Viết mới `sidebar-chat.js` cho context 300px — self-contained, không share state
4. Giữ nguyên 100% chức năng chat hiện tại
5. Ẩn Feed/Trending tabs (feature flags), code giữ nguyên

## Non-Goals

- Không port code từ chat.js — viết mới
- Không sửa backend API — dùng y hệt
- Không thêm chức năng mới — chỉ chuyển layout

## Architecture

### File Structure

```
src/webviews/
  explore.ts        ── Sidebar provider (tabs + chat list + chat view message routing)
  chat.ts           ── Editor panel (DISABLED — code giữ, không activate)
  chat-panel.ts     ── Draft management + badge (giữ làm utility)

media/webview/
  shared.js         ── vscode API, escapeHtml, timeAgo, doAction (KHÔNG ĐỔI)
  explore.js        ── Sidebar layout: tabs, chat list, navigation (SỬA LAYOUT)
  sidebar-chat.js   ── MỚI: Chat view self-contained
  shared.css        ── Design tokens (KHÔNG ĐỔI)
  explore.css       ── Sidebar layout styles (SỬA LAYOUT)
  sidebar-chat.css  ── MỚI: Chat view styles
```

### Module Boundaries

```
explore.js                          sidebar-chat.js
┌─────────────────────┐            ┌─────────────────────┐
│ Tabs, chat list,    │            │ Messages, input,    │
│ filters, navigation,│  open()   │ scroll, emoji,      │
│ user picker,        │ ────────→ │ search, pin,        │
│ new chat dropdown   │            │ reactions, attach,  │
│                     │ ←──────── │ group info, forward  │
│                     │  close()  │                     │
└─────────────────────┘            └─────────────────────┘
        │                                    │
        └──────── explore.ts ────────────────┘
                 (message routing)
```

- **explore.js** KHÔNG biết về tin nhắn, scroll, emoji
- **sidebar-chat.js** KHÔNG biết về tabs, danh sách chat, filters
- Giao tiếp qua `SidebarChat.open(id)` / `SidebarChat.close()` / `SidebarChat.handleMessage(data)`

### Public API (sidebar-chat.js exports)

```javascript
window.SidebarChat = {
  open(conversationId),    // Mở chat view, fetch data
  close(),                 // Đóng chat view, save draft
  isOpen(),                // Trả boolean
  handleMessage(data),     // Route chat:* messages từ provider
  destroy(),               // Cleanup khi webview bị destroy
};
```

### State Management

sidebar-chat.js dùng **1 state object duy nhất**:

```javascript
var _state = {
  conversationId: null,
  currentUser: '',
  messages: [],
  pinnedMessages: [],
  groupMembers: [],
  isGroup: false,
  isGroupCreator: false,
  hasMoreOlder: false,
  hasMoreAfter: false,
  loadingOlder: false,
  loadingNewer: false,
  isViewingContext: false,
  replyingTo: null,
  isMuted: false,
  isPinned: false,
  createdBy: '',
  otherReadAt: null,
  conversation: null,     // participant info (name, avatar, login)
  pendingAttachments: [],
  draft: '',
};
```

Không có state nào nằm ngoài object này. explore.js không access `_state`.

### Scroll System (1 listener, tất cả cases)

```javascript
function attachScrollListener() {
  // RAF-throttled, single listener on messages container
  // Cases handled:
  // 1. scrollTop < 200 → loadOlder() (infinite scroll up)
  // 2. distBottom > 300 → showGoDown()
  // 3. distBottom <= 100 → hideGoDown() + markRead()
  // 4. context mode + distBottom <= 100 → loadNewer() or reload
  // 5. dead zone 100-300 → retain current go-down state
}
```

### Message Routing (explore.ts)

```typescript
// In onMessage():
if (msg.type.startsWith("chat:")) {
  this.postToWebview(msg); // Forward to webview
  // sidebar-chat.js handles via SidebarChat.handleMessage()
}
```

```javascript
// In explore.js message listener:
if (data.type && data.type.startsWith("chat:")) {
  if (SidebarChat.isOpen()) {
    SidebarChat.handleMessage(data);
  }
}
```

### Navigation Flow

```
User mở app
  → explore.js: render tabs (Inbox | Friends | Channels) + chat list

User click conversation
  → explore.js: SidebarChat.open(convId)
  → sidebar-chat.js: slide animation, show chat container
  → sidebar-chat.js: doAction("chat:open", { conversationId })
  → explore.ts: loadConversationData(convId) → postToWebview("chat:init")
  → sidebar-chat.js: renderHeader(), renderMessages(), renderInput()

User bấm ← Back
  → sidebar-chat.js: save draft, cleanup
  → explore.js: slide animation back, show chat list, restore scroll

New message arrives (WebSocket)
  → explore.ts: check if for active conversation
  → YES + chat open: postToWebview("chat:newMessage") → sidebar-chat.js: appendMessage()
  → NO or chat closed: update conversation list badge
```

### Feature Flags

```typescript
const SHOW_FEED_TAB = false;
const SHOW_TRENDING_TAB = false;
```

ALL render functions for Feed/Trending có null guard (`if (!container) return;`).

## sidebar-chat.js Features (viết mới)

### Messages
- Message bubbles: sent (right, accent bg) / received (left, secondary bg)
- Message grouping (consecutive from same sender within 2min)
- Date separators
- Status icons: sending → sent ✓ → seen ✓✓
- System messages
- Unread divider

### Scroll
- Infinite scroll up (auto-load older khi scrollTop < 200)
- Go Down button với badge (hysteresis: show >300, hide <=100)
- Bidirectional scroll (context viewing after pin/search jump)
- Mark-as-read at bottom (throttled 500ms)
- Smart auto-scroll on new message (only if already at bottom)

### Input
- Auto-expand textarea (max 5 lines)
- Enter to send, Shift+Enter new line
- IME composition handling
- Up arrow edit last message
- Draft auto-save (500ms debounce)

### Emoji & Reactions
- Emoji picker overlay (73 emojis + search)
- Quick reactions on message hover
- Reaction pills below message (emoji + count + avatars)
- Input emoji insert

### Floating Action Bar
- Hover message → React, Reply, Copy, More buttons
- Positioned relative to message

### Reply
- Reply preview bar above input
- Reply quote in sent message
- Cancel reply (Escape or X button)

### Pinned Messages
- Pinned banner (compact, accent bar, click to cycle)
- Pinned view overlay (full list + search)
- Jump to pinned message in chat
- Pin/Unpin via More menu

### In-Chat Search
- Search bar replaces header
- Results overlay with pagination
- Navigate prev/next through results
- Jump to result (loads context)
- User filter (groups only)
- Keyword highlighting

### Attachments
- Attach menu: Photo/Video + Document
- File picker (VS Code native)
- Drag-drop on messages area
- Paste image in input
- Preview strip before send (max 10 files, 10MB each)
- Image display: single full-width, 2-4 mosaic grid
- File download links
- Image lightbox (overlay full-sidebar)

### Link Previews
- Auto-detect URL in input (500ms debounce)
- Preview bar above input (dismissible)
- Preview card in message (GitHub-aware)
- Queue management (max 5 concurrent)

### Message Actions (More menu)
- Forward to conversation(s)
- Pin/Unpin message
- Edit (15min window, inline textarea)
- Unsend for everyone (with confirm)
- Delete for me (with confirm)
- Copy to clipboard
- Report

### @Mentions
- Trigger on `@` in input
- Autocomplete dropdown above input
- Groups: member list, DMs: friends list
- API search for additional users
- Insert mention into text

### Group Management
- Header menu: Pin/Unpin conv, Mute/Unmute, Add People, Group Info
- Group info panel: name (editable), avatar (editable), member list
- Add/remove member
- Create/copy/revoke invite link
- Leave/Delete group

### Typing Indicators
- Show "typing..." in header subtitle
- Multiple users: "A and B are typing..."
- 5s timeout auto-clear

### Header
- ← Back button
- Avatar (32px round)
- Name + subtitle (member count / online status / typing)
- Search icon (toggle in-chat search)
- Menu icon (ellipsis → dropdown)

## explore.js Changes (layout refactor)

### Header
- Native VS Code header: "GitChat" title
- Icons: Search, New Message, Profile

### Tabs
- Inbox | Friends | Channels (promoted from sub-tabs)
- Feed/Trending hidden by feature flags
- Tabs hide when chat view is open

### Chat List (Inbox)
- Conversation rows: avatar, name, preview, time, unread badge, pin/mute icons
- Draft preview "[Draft] ..."
- Sorting: pinned → recency → muted last
- Right-click context menu: Pin/Unpin, Mark Read, Delete
- Filter chips: All | Direct | Group | Requests
- Click → SidebarChat.open(convId)

### Friends Tab
- Friends list with online/offline status
- Search bar
- Click friend → SidebarChat.open() via DM creation

### Channels Tab
- Channel list
- Click → SidebarChat.open(channelConvId)

### New Chat
- Native header icon → dropdown (New Message / New Group)
- User picker overlay in sidebar (Telegram-style 3-step group creation)

### Settings
- Profile dropdown → Settings sub-panel
- Toggles: notifications, sound, debug

### Navigation
- Slide animation (CSS transform translateX, 0.25s ease)
- Reduced motion support
- State persistence via vscode.setState/getState

## CSS Guidelines

- `--gs-*` tokens only — NO hardcoded colors
- `gs-sc-` prefix for sidebar-chat.css classes (sc = sidebar chat)
- `gs-` prefix for explore.css classes
- Minimum font size 11px (`--gs-font-xs`)
- 4px spacing grid
- Codicons for all icons — no emoji in UI
- Must work across Dark, Light, High Contrast themes

## Provider Changes (explore.ts)

### Message Routing
- ALL `chat:*` messages forwarded to webview
- sidebar-chat.js handles via `SidebarChat.handleMessage()`
- Non-chat messages handled by explore.js as before

### Command Migration
- `trending.messageUser` → `navigateToChat()` (sidebar)
- `trending.openChat` → `navigateToChat()` (sidebar)
- `trending.createGroup` → user picker in sidebar
- `trending.openInbox` → focus explore sidebar

### Editor Panel
- `chat.ts` code kept but `ChatPanel.show()` never called
- `chatSidebar` view hidden via `when: "false"`
- Activation events kept (harmless)

## Testing Strategy

- Manual testing in Extension Development Host
- Test mỗi feature riêng lẻ trước khi test tích hợp
- Test scroll lifecycle kỹ: load older → position giữ nguyên
- Test webview restore: switch sidebar → switch back → state đúng
- Test tất cả 3 themes: Dark, Light, High Contrast
- Test edge cases: empty conversations, long messages, many attachments, offline

## Risks & Mitigations

1. **sidebar-chat.js file lớn** — Dự kiến ~2000-3000 dòng. Chấp nhận vì nó self-contained. Nếu quá lớn, tách internal modules (emoji-picker, search-manager).

2. **Webview lifecycle** — sidebar không có retainContextWhenHidden. Mitigation: vscode.setState/getState + re-fetch data on restore.

3. **300px width** — Một số UI elements (emoji picker, search results, forward modal) cần adapt. Mitigation: full-width overlays thay vì floating popups.

4. **Consistency với chat.js** — sidebar-chat.js viết mới nhưng phải handle cùng message types. Mitigation: dùng chat.ts provider handlers làm contract — cùng input/output format.
