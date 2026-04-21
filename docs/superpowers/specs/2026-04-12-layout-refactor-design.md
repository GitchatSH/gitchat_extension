# GitChat Layout Refactor — Telegram-Style Sidebar Chat

> Move the entire chat experience from the editor panel to the sidebar (~300px). Write sidebar-chat.js from scratch — do not port from chat.js. Preserve all existing functionality.

## Goals

1. All chat works inside the sidebar — no editor panel opens
2. Reproduce a compact Telegram-style experience: chat list → slide → chat view → back
3. Write a new `sidebar-chat.js` for the 300px context — self-contained, no shared state
4. Preserve 100% of existing chat functionality
5. Hide Feed/Trending tabs via feature flags; keep the code intact

## Non-Goals

- Do not port code from chat.js — write from scratch
- Do not modify backend APIs — use them as-is
- Do not add new features — layout move only

## Architecture

### File Structure

```
src/webviews/
  explore.ts        ── Sidebar provider (tabs + chat list + chat view message routing)
  chat.ts           ── Editor panel (DISABLED — code kept, not activated)
  chat-panel.ts     ── Draft management + badge (kept as utility)

media/webview/
  shared.js         ── vscode API, escapeHtml, timeAgo, doAction (NO CHANGES)
  explore.js        ── Sidebar layout: tabs, chat list, navigation (LAYOUT CHANGES)
  sidebar-chat.js   ── NEW: Self-contained chat view
  shared.css        ── Design tokens (NO CHANGES)
  explore.css       ── Sidebar layout styles (LAYOUT CHANGES)
  sidebar-chat.css  ── NEW: Chat view styles
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

- **explore.js** knows nothing about messages, scroll, or emoji
- **sidebar-chat.js** knows nothing about tabs, chat list, or filters
- Communication via `SidebarChat.open(id)` / `SidebarChat.close()` / `SidebarChat.handleMessage(data)`

### Public API (sidebar-chat.js exports)

```javascript
window.SidebarChat = {
  open(conversationId, convData),  // Open chat view, pass conversation data from list (avoids re-fetch)
  close(),                         // Close chat view, save draft, leave WS room
  isOpen(),                        // Returns boolean
  getConversationId(),             // Returns active conversationId (for event filtering)
  handleMessage(data),             // Route ALL chat messages from provider
  destroy(),                       // Cleanup when webview is destroyed
};
```

### State Management

sidebar-chat.js uses **a single state object**:

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
  conversation: null,     // participant info (name, avatar, login) — unchanged
  pendingAttachments: [],
  draft: '',
};
```

No state exists outside this object. explore.js does not access `_state`.

### Scroll System (1 listener, tất cả cases)

```javascript
function attachScrollListener() {
  // RAF-throttled, single listener on messages container
  // Cases handled:
  // 1. scrollTop < 200  → loadOlder() (infinite scroll up)
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
User opens app
  → explore.js: render tabs (Inbox | Friends | Channels) + chat list

User clicks conversation
  → explore.js: SidebarChat.open(convId, convData)
  → sidebar-chat.js: slide animation, show chat container, render header from convData
  → sidebar-chat.js: doAction("chat:open", { conversationId })
  → explore.ts: loadConversationData(convId) → joinConversation WS → postToWebview("chat:init")
  → sidebar-chat.js: renderMessages(), renderInput(), attachScrollListener()

User taps ← Back
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

Sidebar webviews do NOT have `retainContextWhenHidden`. When a user switches to the Explorer sidebar and back, the webview is destroyed and recreated.

**Persisted via vscode.setState/getState:**
- `conversationId` — which chat is currently open
- `navStack` — 'list' or 'chat'
- `activeTab` — inbox/friends/channels
- `draft` — text currently being typed

**NOT persisted (re-fetched):**
- Messages, pinned messages, members — re-fetched from API
- Scroll position — scrolls to bottom on restore
- Emoji picker, search overlay — reset (ephemeral UI)

**On restore:**
```javascript
var saved = vscode.getState();
if (saved && saved.navStack === 'chat' && saved.conversationId) {
  SidebarChat.open(saved.conversationId);
}
```

### Draft Management

Drafts are saved via the provider (explore.ts → globalState), not on the client:

```
Type text → 500ms debounce → doAction("chat:saveDraft", { conversationId, text })
              → explore.ts: this._drafts.set(convId, text) + saveDrafts()
Back      → doAction("chat:saveDraft", ...) → save
Send      → doAction("chat:saveDraft", { text: "" }) → clear
```

When a conversation is reopened, the provider sends the draft in the `chat:init` payload.

### DOM Lifecycle (slide animation)

```
Both the chat list and chat view exist in the DOM at all times:

<div class="gs-nav-container" id="gs-nav">
  <div class="gs-chat-list">...</div>       ← always in DOM
  <div class="gs-chat-view">...</div>        ← always in DOM
</div>

When opening chat:
  .gs-nav-container.chat-active .gs-chat-list  → translateX(-100%)
  .gs-nav-container.chat-active .gs-chat-view  → translateX(0)

When closing chat:
  .gs-chat-list  → translateX(0)
  .gs-chat-view  → translateX(100%)

Do NOT use display:none — both panels always render.
Chat view content is cleared on close (reset innerHTML) to free memory.
```

### Feature Flags

```typescript
const SHOW_FEED_TAB = false;
const SHOW_TRENDING_TAB = false;
```

ALL render functions for Feed/Trending have a null guard (`if (!container) return;`).

## sidebar-chat.js Features (written from scratch)

### Messages
- Message bubbles: sent (right, accent bg) / received (left, secondary bg)
- Message grouping (consecutive from same sender within 2min)
- Date separators
- Status icons: sending → sent ✓ → seen ✓✓
- System messages
- Unread divider

### Scroll
- Infinite scroll up (auto-load older when scrollTop < 200)
- Go Down button with badge (hysteresis: show >300, hide <=100)
- Bidirectional scroll (context viewing after pin/search jump)
- Mark-as-read at bottom (throttled 500ms)
- Smart auto-scroll on new message (only if already at bottom)

### Input
- Auto-expand textarea (max 5 lines)
- Enter to send, Shift+Enter new line
- IME composition handling
- Up arrow edit last message
- Draft auto-save (500ms debounce)

### Emoji and Reactions
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
- Test each feature individually before integration testing
- Test scroll lifecycle carefully: load older → position preserved
- Test webview restore: switch sidebar → switch back → state is correct
- Test all 3 themes: Dark, Light, High Contrast
- Test edge cases: empty conversations, long messages, many attachments, offline

## Risks & Mitigations

1. **sidebar-chat.js file size** — Estimated ~3000-4000 lines (revised). Split into internal modules from the start if needed: emoji-picker, search-manager, attachment-handler.

2. **Webview lifecycle** — sidebar does not have retainContextWhenHidden. Mitigation: vscode.setState/getState + re-fetch data on restore.

3. **300px width** — Some UI elements (emoji picker, search results, forward modal) need to adapt. Mitigation: use full-width overlays instead of floating popups.

4. **Consistency with chat.js** — sidebar-chat.js is written from scratch but must handle the same message types. Mitigation: use chat.ts provider handlers as the contract — same input/output format.
