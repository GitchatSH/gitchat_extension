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
  open(conversationId, convData),  // Mở chat view, pass conversation data từ list (tránh re-fetch)
  close(),                         // Đóng chat view, save draft, leave WS room
  isOpen(),                        // Trả boolean
  getConversationId(),             // Trả active conversationId (for event filtering)
  handleMessage(data),             // Route ALL chat messages từ provider
  destroy(),                       // Cleanup khi webview bị destroy
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

Provider sends messages to webview with various type names. Some have `chat:` prefix (from onMessage handlers), some don't (from realtime events like `newMessage`, `typing`, `reactionUpdated`, etc.).

```typescript
// In explore.ts — realtime events posted to webview with chat: prefix
realtimeClient.onNewMessage((msg) => {
  this.postToWebview({ type: "chat:newMessage", ...msg });
});
realtimeClient.onTyping((data) => {
  this.postToWebview({ type: "chat:typing", ...data });
});
// ... all realtime events get chat: prefix when posting to webview
```

```javascript
// In explore.js message listener:
// Chat-related messages go to sidebar-chat.js
var CHAT_MESSAGE_TYPES = [
  "chat:init", "chat:newMessage", "chat:olderMessages", "chat:newerMessages",
  "chat:typing", "chat:reactionUpdated", "chat:readReceipt",
  "chat:messagePinned", "chat:messageUnpinned", "chat:messageEdited",
  "chat:messageDeleted", "chat:searchResults", "chat:uploadComplete",
  "chat:uploadFailed", "chat:linkPreviewResult", "chat:forwardSuccess",
  "chat:jumpToMessageResult", "chat:setDraft", "chat:showToast",
  // ... all chat:* types
];

window.addEventListener("message", function(e) {
  var data = e.data;
  if (data.type && data.type.startsWith("chat:") && SidebarChat.isOpen()) {
    SidebarChat.handleMessage(data);
    return;
  }
  // ... explore.js handles non-chat messages (setChatData, settings, etc.)
});
```

### Shared Chat Handlers (chat-handlers.ts)

Extract chat message handlers from chat.ts into a shared module. sidebar-chat.js is written from scratch (frontend UI). chat-handlers.ts is extracted/refactored from chat.ts (backend API logic).

```
src/webviews/
  chat-handlers.ts    ── NEW: shared handler functions
  explore.ts          ── imports chat-handlers, routes onMessage to them
  chat.ts             ── imports chat-handlers (keeps working as fallback)
```

**Interface design:**

```typescript
// chat-handlers.ts
interface ChatContext {
  conversationId: string;
  postToWebview(msg: unknown): void;
  recentlySentIds: Set<string>;
}

export async function handleChatMessage(
  type: string,
  payload: Record<string, unknown>,
  ctx: ChatContext
): Promise<void> {
  switch (type) {
    case "chat:send": { ... apiClient.sendMessage(...); break; }
    case "chat:react": { ... apiClient.addReaction(...); break; }
    // ... all 50+ handlers
  }
}
```

Both chat.ts and explore.ts create a `ChatContext` with their own `postToWebview` implementation and call `handleChatMessage()`.

### Message Type Inventory

**Naming convention:** All realtime events are normalized with `chat:` prefix. Original names like `wsPinned` become `chat:messagePinned` for clarity.

**Provider → Webview (explore.ts sends these to sidebar-chat.js):**

| Realtime event | Webview message type | Purpose |
|---|---|---|
| `onNewMessage` | `chat:newMessage` | New incoming message |
| `onTyping` | `chat:typing` | User typing indicator |
| `onPresence` | `chat:presence` | Online/offline status |
| `onReactionUpdated` | `chat:reactionUpdated` | Reaction changed |
| `onConversationRead` | `chat:conversationRead` | Read receipt |
| `onMessagePinned` | `chat:messagePinned` | Message pinned |
| `onMessageUnpinned` | `chat:messageUnpinned` | Message unpinned |
| `onMessagesUnpinnedAll` | `chat:messagesUnpinnedAll` | All unpinned |
| `onMentionNew` | `chat:mentionNew` | New mention |
| `onReactionNew` | `chat:reactionNew` | New reaction |

**Provider → Webview (API response messages):**

| Message type | Purpose |
|---|---|
| `chat:init` | Full conversation data (messages, pins, members, etc.) |
| `chat:olderMessages` | Load more response |
| `chat:newerMessages` | Load newer response (context viewing) |
| `chat:searchResults` | Search results + pagination |
| `chat:searchError` | Search failed |
| `chat:uploadComplete` | File upload success |
| `chat:uploadFailed` | File upload failed |
| `chat:addPickedFile` | File picked from native dialog |
| `chat:linkPreviewResult` | Link preview data |
| `chat:inputLinkPreviewResult` | Input link preview data |
| `chat:jumpToMessageResult` | Jump to message context loaded |
| `chat:jumpToMessageFailed` | Jump failed |
| `chat:jumpToDateResult` | Jump to date context loaded |
| `chat:jumpToDateFailed` | Jump to date failed |
| `chat:conversationsLoaded` | Conversations for forward modal |
| `chat:forwardSuccess` | Forward succeeded |
| `chat:forwardError` | Forward failed |
| `chat:messageFailed` | Send failed |
| `chat:replyFailed` | Reply failed |
| `chat:messageUnsent` | Unsend confirmed |
| `chat:messageRemoved` | Delete confirmed |
| `chat:messageEdited` | Edit confirmed |
| `chat:members` | Group members list |
| `chat:showGroupInfo` | Group info data |
| `chat:groupSearchResults` | User search for group |
| `chat:groupAvatarUpdated` | Avatar upload success |
| `chat:groupAvatarFailed` | Avatar upload failed |
| `chat:inviteLinkResult` | Invite link created |
| `chat:inviteLinkRevoked` | Invite link revoked |
| `chat:mentionSuggestions` | @mention search results |
| `chat:pinReverted` | Pin action reverted |
| `chat:muteUpdated` | Mute toggle confirmed |
| `chat:showToast` | Toast notification |
| `chat:setDraft` | Restore draft text |
| `chat:updatePinnedBanner` | Pinned messages updated |
| `chat:insertText` | Insert text into input |

**Webview → Provider (sidebar-chat.js sends these via doAction):**

| Message type | Purpose |
|---|---|
| `chat:open` | Open conversation |
| `chat:close` | Close conversation |
| `chat:send` | Send message |
| `chat:reply` | Reply to message |
| `chat:typing` | Emit typing indicator |
| `chat:markRead` | Mark as read |
| `chat:saveDraft` | Save draft |
| `chat:loadMore` | Load older messages |
| `chat:loadNewer` | Load newer messages |
| `chat:react` | Add reaction |
| `chat:removeReaction` | Remove reaction |
| `chat:editMessage` | Edit message |
| `chat:deleteMessage` | Delete for self |
| `chat:unsendMessage` | Unsend for everyone |
| `chat:forwardMessage` | Forward message |
| `chat:pinMessage` | Pin message |
| `chat:unpinMessage` | Unpin message |
| `chat:unpinAllMessages` | Unpin all |
| `chat:searchMessages` | Search in chat |
| `chat:jumpToMessage` | Jump to message |
| `chat:jumpToDate` | Jump to date |
| `chat:upload` | Upload file (base64) |
| `chat:pickFile` | Open file picker |
| `chat:pickPhoto` | Open photo picker |
| `chat:fetchLinkPreview` | Fetch link preview |
| `chat:fetchInputLinkPreview` | Fetch input link preview |
| `chat:searchUsers` | Search users (@mention) |
| `chat:searchUsersForGroup` | Search users for group |
| `chat:getMembers` | Get group members |
| `chat:addMember` | Add member to group |
| `chat:removeMember` | Remove member |
| `chat:updateGroupName` | Rename group |
| `chat:leaveGroup` | Leave group |
| `chat:deleteGroup` | Delete group |
| `chat:groupInfo` | Fetch group info |
| `chat:addPeople` | Add people to group |
| `chat:togglePin` | Toggle conversation pin |
| `chat:toggleMute` | Toggle conversation mute |
| `chat:uploadGroupAvatar` | Upload group avatar |
| `chat:getConversations` | Get conversations (forward) |
| `chat:reportMessage` | Report message |
| `chat:reloadConversation` | Reload full conversation |
| `chat:createInviteLink` | Create invite link |
| `chat:revokeInviteLink` | Revoke invite link |
| `chat:copyInviteLink` | Copy invite link |

### WebSocket Subscription Lifecycle

```
SidebarChat.open(convId):
  → realtimeClient.joinConversation(convId)
  → Subscribe to per-conversation events

SidebarChat.close():
  → Save draft via doAction("chat:saveDraft")
  → realtimeClient.leaveConversation(convId)
  → Unsubscribe per-conversation events
  → Reset _state

SidebarChat.destroy():
  → Same as close() but no draft save
```

### Navigation Flow

```
User mở app
  → explore.js: render tabs (Inbox | Friends | Channels) + chat list

User click conversation
  → explore.js: SidebarChat.open(convId, convData)
  → sidebar-chat.js: slide animation, show chat container, render header from convData
  → sidebar-chat.js: doAction("chat:open", { conversationId })
  → explore.ts: loadConversationData(convId) → joinConversation WS → postToWebview("chat:init")
  → sidebar-chat.js: renderMessages(), renderInput(), attachScrollListener()

User bấm ← Back
  → sidebar-chat.js: doAction("chat:saveDraft", { conversationId, text })
  → sidebar-chat.js: doAction("chat:close") → explore.ts: leaveConversation WS
  → sidebar-chat.js: reset _state
  → explore.js: slide animation back, show chat list + tabs, restore scroll

New message arrives (WebSocket)
  → explore.ts: check if for active conversation
  → YES + chat open: postToWebview("chat:newMessage") → sidebar-chat.js: appendMessage()
  → NO or chat closed: update conversation list badge
```

### State Persistence (webview lifecycle)

Sidebar webviews KHÔNG có `retainContextWhenHidden`. Khi user switch sang Explorer sidebar rồi switch lại, webview bị destroy + recreate.

**Persist via vscode.setState/getState:**
- `conversationId` — đang mở chat nào
- `navStack` — 'list' hoặc 'chat'
- `activeTab` — inbox/friends/channels
- `draft` — text đang gõ

**KHÔNG persist (re-fetch):**
- Messages, pinned, members — fetch lại từ API
- Scroll position — scroll to bottom on restore
- Emoji picker, search overlay — reset (ephemeral UI)

**On restore:**
```javascript
var saved = vscode.getState();
if (saved && saved.navStack === 'chat' && saved.conversationId) {
  SidebarChat.open(saved.conversationId);
}
```

### Draft Management

Drafts lưu qua provider (explore.ts → globalState), không trong client:

```
Gõ text → 500ms debounce → doAction("chat:saveDraft", { conversationId, text })
             → explore.ts: this._drafts.set(convId, text) + saveDrafts()
Back     → doAction("chat:saveDraft", ...) → save
Send     → doAction("chat:saveDraft", { text: "" }) → clear
```

Khi mở lại conversation, provider gửi draft trong `chat:init` payload.

### DOM Lifecycle (slide animation)

```
Chat list và chat view CẢ HAI tồn tại trong DOM:

<div class="gs-nav-container" id="gs-nav">
  <div class="gs-chat-list">...</div>       ← always in DOM
  <div class="gs-chat-view">...</div>        ← always in DOM
</div>

Khi mở chat:
  .gs-nav-container.chat-active .gs-chat-list  → translateX(-100%)
  .gs-nav-container.chat-active .gs-chat-view  → translateX(0)

Khi đóng chat:
  .gs-chat-list  → translateX(0)
  .gs-chat-view  → translateX(100%)

KHÔNG dùng display:none — cả hai panel luôn render.
Chat view content được clear khi close (reset innerHTML) để giải phóng memory.
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

1. **sidebar-chat.js file lớn** — Dự kiến ~3000-4000 dòng (revised). Tách internal modules từ đầu nếu cần: emoji-picker, search-manager, attachment-handler.

2. **Webview lifecycle** — sidebar không có retainContextWhenHidden. Mitigation: vscode.setState/getState + re-fetch data on restore.

3. **300px width** — Một số UI elements (emoji picker, search results, forward modal) cần adapt. Mitigation: full-width overlays thay vì floating popups.

4. **Consistency với chat.js** — sidebar-chat.js viết mới nhưng phải handle cùng message types. Mitigation: dùng chat.ts provider handlers làm contract — cùng input/output format.
