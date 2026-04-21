# GitChat Layout Refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move all chat functionality from editor panel into sidebar (~300px), Telegram-style. Write sidebar-chat.js from scratch.

**Architecture:** Two independent frontend modules (explore.js for list, sidebar-chat.js for chat view) communicating through `SidebarChat.open/close/handleMessage` API. Shared backend handlers extracted into `chat-handlers.ts`. All chat messages use `chat:` prefix.

**Tech Stack:** TypeScript, vanilla JS/CSS, VS Code Webview API, WebSocket (Socket.IO)

**Spec:** `docs/superpowers/specs/2026-04-12-layout-refactor-design.md`

**Lessons from the previous branch (slug-gitchat-refactor):**
- Do NOT port function-by-function from chat.js
- sidebar-chat.js is a BLACK BOX — explore.js only knows open/close/handleMessage
- Single state object, single scroll listener
- Test EACH task before moving to the next

---

## File Structure

```
CREATE:
  src/webviews/chat-handlers.ts     — Shared chat message handler functions (~600 lines)
  media/webview/sidebar-chat.js     — Self-contained chat view module (~3000-4000 lines)
  media/webview/sidebar-chat.css    — Chat view styles (~500 lines)

MODIFY:
  src/webviews/explore.ts           — Add chat: message routing, load sidebar-chat.js/css, HTML skeleton
  media/webview/explore.js          — Layout refactor (tabs, navigation, SidebarChat integration)
  media/webview/explore.css         — Layout styles (header, tabs, nav container, slide animation)
  src/commands/index.ts             — Redirect chat commands to sidebar
  package.json                      — Rename title, hide chatSidebar, add new chat command

KEEP (disable):
  src/webviews/chat.ts              — Import chat-handlers.ts instead of inline handlers
  media/webview/chat.js             — Untouched
  media/webview/chat.css            — Untouched
```

---

## Task 1: Extract chat-handlers.ts

**Files:**
- Create: `src/webviews/chat-handlers.ts`
- Modify: `src/webviews/chat.ts:256-894` (replace inline handlers with imports)

This is the foundation — shared handler logic used by both chat.ts (fallback) and explore.ts (sidebar).

- [ ] **Step 1: Read chat.ts onMessage handler**

Read `src/webviews/chat.ts` lines 256-894. Understand every `case` statement, what API it calls, and what it posts back to webview.

- [ ] **Step 2: Create chat-handlers.ts with ChatContext interface**

Create `src/webviews/chat-handlers.ts`:

```typescript
import * as vscode from "vscode";

export interface ChatContext {
  conversationId: string;
  postToWebview(msg: unknown): void;
  recentlySentIds: Set<string>;
  extensionUri: vscode.Uri;
}

export async function handleChatMessage(
  type: string,
  payload: Record<string, unknown>,
  ctx: ChatContext
): Promise<boolean> {
  // Returns true if handled, false if not recognized
  const { apiClient } = await import("../api");

  switch (type) {
    // Port each case from chat.ts, replacing:
    //   this._conversationId → ctx.conversationId
    //   this._panel.webview.postMessage → ctx.postToWebview
    //   this._recentlySentIds → ctx.recentlySentIds

    case "chat:send": {
      // ... port from chat.ts line 258
      break;
    }
    // ... all 50 cases
    default:
      return false;
  }
  return true;
}
```

Port ALL case statements from chat.ts. Each case:
1. Read the original in chat.ts
2. Replace `this._conversationId` with `ctx.conversationId`
3. Replace `this._panel.webview.postMessage(...)` with `ctx.postToWebview(...)`
4. Replace `this._recentlySentIds` with `ctx.recentlySentIds`
5. Keep exact same API calls and response format
6. Add `chat:` prefix to all postToWebview type names

- [ ] **Step 3: Update chat.ts to use chat-handlers.ts**

In chat.ts onMessage(), replace inline case statements with:
```typescript
import { handleChatMessage, ChatContext } from "./chat-handlers";

// In onMessage:
const ctx: ChatContext = {
  conversationId: this._conversationId,
  postToWebview: (msg) => this._panel.webview.postMessage(msg),
  recentlySentIds: this._recentlySentIds,
  extensionUri: this._extensionUri,
};
const handled = await handleChatMessage(msg.type, msg.payload || {}, ctx);
if (!handled) {
  // Handle chat.ts-specific cases (ready, showWarning, etc.)
}
```

- [ ] **Step 4: Verify chat.ts still works**

Run: `npm run compile`
Test: Open extension, open a chat in editor panel, send message, verify it works.

- [ ] **Step 5: Commit**

```bash
git add src/webviews/chat-handlers.ts src/webviews/chat.ts
git commit -m "refactor: extract chat handlers into shared chat-handlers.ts"
```

---

## Task 2: Package.json & Config Changes

**Files:**
- Modify: `package.json:234-296`
- Modify: `src/commands/index.ts:147-183`

- [ ] **Step 1: Rename view container title**

`package.json` line 238: `"title": "Gitchat"` → `"title": "GitChat"`

- [ ] **Step 2: Hide chatSidebar view**

`package.json` line 273: change `"when": "trending.isSignedIn"` → `"when": "false"` for trending.chatPanel.

- [ ] **Step 3: Add new chat command to package.json**

Add `trending.newChat` command definition and activation event (copy pattern from the previous branch).

Add to `view/title` menus between search and userMenu:
```json
{
  "command": "trending.newChat",
  "when": "view == trending.explore && trending.isSignedIn",
  "group": "navigation@2"
}
```
Update userMenu to `navigation@3`.

- [ ] **Step 4: Update commands/index.ts**

Replace `ChatPanel.show(...)` in `trending.messageUser` and `trending.openChat` with:
```typescript
const { exploreWebviewProvider } = await import("../webviews/explore");
await exploreWebviewProvider.navigateToChat(conv.id, username);
```

Add `trending.newChat` command:
```typescript
{ id: "trending.newChat", handler: () => {
  exploreWebviewProvider?.postToWebview({ type: "showNewChatMenu" });
}},
```

Update `trending.openInbox` to focus explore sidebar.

- [ ] **Step 5: Verify & commit**

Run: `npm run check-types`

```bash
git add package.json src/commands/index.ts
git commit -m "refactor(config): rename Gitchat to GitChat, redirect commands to sidebar"
```

---

## Task 3: Explore.ts — HTML, Routing, Chat Integration

**Files:**
- Modify: `src/webviews/explore.ts`

- [ ] **Step 1: Add feature flags**

After imports (~line 5):
```typescript
const SHOW_FEED_TAB = false;
const SHOW_TRENDING_TAB = false;
```

- [ ] **Step 2: Add sidebar-chat.js and sidebar-chat.css to HTML template**

In getHtml() (~line 745), add new file URIs:
```typescript
const chatJs = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, "media", "webview", "sidebar-chat.js"));
const chatCss = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, "media", "webview", "sidebar-chat.css"));
```

Add CSS link in `<head>`:
```html
<link rel="stylesheet" href="${chatCss}">
```

Add script tag BETWEEN shared.js and explore.js (sidebar-chat.js must load before explore.js so `SidebarChat` is available):
```html
<script nonce="${nonce}" src="${sharedJs}"></script>
<script nonce="${nonce}" src="${chatJs}"></script>
<script nonce="${nonce}" src="${exploreJs}"></script>
```

- [ ] **Step 3: Restructure HTML template**

Replace the main tab bar (Chat|Feed|Trending) with Inbox|Friends|Channels tabs. Wrap content in nav container with chat view skeleton. Conditionally hide Feed/Trending panes. Add null guards for ALL Feed/Trending render-related elements.

Key HTML structure:
```html
<!-- New Chat dropdown + User Picker overlays -->

<div class="gs-main-tabs">
  <button class="gs-main-tab active" data-tab="inbox">Inbox</button>
  <button class="gs-main-tab" data-tab="friends">Friends</button>
  <button class="gs-main-tab" data-tab="channels">Channels</button>
</div>

<div id="pane-chat" class="tab-pane active">
  <div class="gs-nav-container" id="gs-nav">
    <div class="gs-chat-list">
      <!-- filter bar, chat-content, chat-empty, channels pane -->
    </div>
    <div class="gs-chat-view" id="gs-chat-view">
      <!-- sidebar-chat.js populates this -->
    </div>
  </div>
</div>

${SHOW_FEED_TAB ? `<div class="tab-pane" ...>...</div>` : ''}
${SHOW_TRENDING_TAB ? `<div class="tab-pane" ...>...</div>` : ''}
```

- [ ] **Step 4: Add navigateToChat method and chat message routing**

Add `navigateToChat()` public method:
```typescript
async navigateToChat(conversationId: string, recipientLogin?: string): Promise<void> {
  await vscode.commands.executeCommand('trending.explore.focus');
  if (!conversationId && recipientLogin) {
    const conv = await apiClient.createConversation(recipientLogin);
    conversationId = conv.id;
  }
  this.postToWebview({ type: 'chat:navigate', conversationId });
}
```

In onMessage(), add chat handler routing:
```typescript
// Route chat: messages through shared handlers
if (msg.type.startsWith("chat:")) {
  const ctx: ChatContext = {
    conversationId: this._activeConversationId || (msg.payload as any)?.conversationId || (msg as any).conversationId || "",
    postToWebview: (m) => this.postToWebview(m),
    recentlySentIds: this._recentlySentIds,
    extensionUri: this._extensionUri,
  };

  // Handle open/close specially
  if (msg.type === "chat:open") {
    this._activeConversationId = ctx.conversationId;
    await this.loadConversationData(ctx.conversationId);
    // Subscribe to WS events
    return;
  }
  if (msg.type === "chat:close") {
    // Leave WS room, cleanup
    this._activeConversationId = null;
    return;
  }

  ctx.conversationId = this._activeConversationId || "";
  await handleChatMessage(msg.type, msg.payload || {}, ctx);
  return;
}
```

Add `loadConversationData()` — port from chat.ts `loadData()` (lines 143-253), using same API calls but posting `chat:init` to webview.

Add realtime event subscriptions that post with `chat:` prefix.

- [ ] **Step 5: Add CSP data: for image previews**

In CSP meta tag, ensure `img-src` includes `data:`:
```
img-src ${webview.cspSource} https: data:;
```

- [ ] **Step 6: Verify & commit**

Run: `npm run check-types`

```bash
git add src/webviews/explore.ts
git commit -m "feat(explore): restructure HTML, add chat routing, load sidebar-chat"
```

---

## Task 4: Explore.js — Layout Refactor

**Files:**
- Modify: `media/webview/explore.js`

- [ ] **Step 1: Add SidebarChat integration**

At the top, add navigation state and SidebarChat bridge:
```javascript
var navStack = 'list';

function pushChatView(conversationId, convData) {
  navStack = 'chat';
  document.getElementById('gs-nav')?.classList.add('chat-active');
  document.querySelector('.gs-main-tabs').style.display = 'none';
  SidebarChat.open(conversationId, convData);
  persistState();
}

function popChatView() {
  navStack = 'list';
  document.getElementById('gs-nav')?.classList.remove('chat-active');
  document.querySelector('.gs-main-tabs').style.display = 'flex';
  persistState();
}
```

- [ ] **Step 2: Update tab switching**

Replace old `.explore-tab` handlers with `.gs-main-tab` handlers for Inbox|Friends|Channels.

- [ ] **Step 3: Wire conversation clicks to pushChatView**

In `renderChatInbox()`, change click handler:
```javascript
el.addEventListener("click", function() {
  pushChatView(el.dataset.id, { /* convData from list */ });
});
```

Same for Friends tab (click friend → pushChatView via DM creation).

- [ ] **Step 4: Route chat messages to SidebarChat**

In message handler:
```javascript
window.addEventListener("message", function(e) {
  var data = e.data;

  // Route chat: messages to sidebar-chat.js
  if (data.type && data.type.startsWith("chat:")) {
    if (typeof SidebarChat !== 'undefined' && SidebarChat.isOpen()) {
      SidebarChat.handleMessage(data);
    }
    // Special: chat:navigate from provider
    if (data.type === "chat:navigate") {
      pushChatView(data.conversationId);
    }
    return;
  }

  // ... existing handlers for setChatData, settings, etc.
});
```

- [ ] **Step 5: Add state persistence**

```javascript
function persistState() {
  vscode.setState({
    navStack: navStack,
    activeTab: chatSubTab,
    activeConversationId: SidebarChat.isOpen() ? SidebarChat.getConversationId() : null,
  });
}

function restoreState() {
  var saved = vscode.getState();
  if (!saved) return;
  chatSubTab = saved.activeTab || 'inbox';
  if (saved.navStack === 'chat' && saved.activeConversationId) {
    pushChatView(saved.activeConversationId);
  }
}
```

- [ ] **Step 6: Add null guards for Feed/Trending**

Add `if (!container) return;` at the top of:
- `initFeed()`
- `renderFeed()`
- `renderTrendingRepos()`
- `renderTrendingPeople()`
- `renderTrendingSuggestions()`

- [ ] **Step 7: Add closeAllPopups**

```javascript
function closeAllPopups() {
  document.querySelectorAll(".gs-dropdown").forEach(function(dd) { dd.style.display = "none"; });
  document.querySelectorAll(".context-menu").forEach(function(cm) { cm.remove(); });
}
window.addEventListener("blur", closeAllPopups);
```

- [ ] **Step 8: Verify & commit**

Run: `npm run compile`

```bash
git add media/webview/explore.js
git commit -m "feat(explore): layout refactor with SidebarChat integration"
```

---

## Task 5: Explore.css — Layout Styles

**Files:**
- Modify: `media/webview/explore.css`

- [ ] **Step 1: Add nav container and slide animation**

```css
.gs-nav-container { position: relative; overflow: hidden; width: 100%; height: calc(100vh - 36px); flex: 1; }
.gs-chat-list, .gs-chat-view { position: absolute; top: 0; left: 0; width: 100%; height: 100%; overflow-y: auto; transition: transform 0.25s ease; will-change: transform; }
.gs-chat-list { transform: translateX(0); }
.gs-chat-view { transform: translateX(100%); display: flex; flex-direction: column; overflow: hidden; }
.gs-nav-container.chat-active .gs-chat-list { transform: translateX(-100%); }
.gs-nav-container.chat-active .gs-chat-view { transform: translateX(0); }
@media (prefers-reduced-motion: reduce) { .gs-chat-list, .gs-chat-view { transition: none; } }
```

- [ ] **Step 2: Add main tabs styles**

```css
.gs-main-tabs { display: flex; border-bottom: 1px solid var(--gs-divider); }
.gs-main-tab { flex: 1; padding: 8px; text-align: center; font-size: var(--gs-font-sm); color: var(--gs-muted); background: none; border: none; border-bottom: 2px solid transparent; cursor: pointer; }
.gs-main-tab.active { color: var(--gs-fg); border-bottom-color: var(--gs-link); font-weight: 600; }
```

- [ ] **Step 3: Add sidebar border**

```css
body::after { content: ""; position: fixed; top: 0; right: 0; width: 1px; height: 100%; background: var(--gs-divider); z-index: 9999; pointer-events: none; }
```

- [ ] **Step 4: Verify & commit**

Run: `npm run compile`

```bash
git add media/webview/explore.css
git commit -m "style(explore): layout styles, nav container, slide animation"
```

---

## Task 6: sidebar-chat.js — Core (State, Render, Scroll)

**Files:**
- Create: `media/webview/sidebar-chat.js`

This is the largest task. Write the CORE of sidebar-chat.js: state management, message rendering, scroll system, input handling.

- [ ] **Step 1: Create sidebar-chat.js with module structure**

```javascript
// sidebar-chat.js — Self-contained chat view for sidebar
// Depends on shared.js (vscode, escapeHtml, doAction, timeAgo, avatarUrl)

(function() {
  'use strict';

  // === STATE ===
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
    conversation: null,
    pendingAttachments: [],
    draft: '',
  };

  var _scrollListenerAttached = false;
  var _goDownBtn = null;
  var _newMsgCount = 0;
  var _markReadTimer = null;

  // === CONTAINER ===
  function getContainer() { return document.getElementById('gs-chat-view'); }
  function getMsgsEl() { return getContainer()?.querySelector('.gs-sc-messages'); }
  function getInputEl() { return getContainer()?.querySelector('.gs-sc-input'); }

  // ... (rest of implementation)

  // === PUBLIC API ===
  window.SidebarChat = {
    open: open,
    close: close,
    isOpen: function() { return _state.conversationId !== null; },
    getConversationId: function() { return _state.conversationId; },
    handleMessage: handleMessage,
    destroy: destroy,
  };
})();
```

- [ ] **Step 2: Implement open/close lifecycle**

```javascript
function open(conversationId, convData) {
  _state.conversationId = conversationId;
  _state.conversation = convData || null;

  var container = getContainer();
  if (!container) return;

  // Render initial HTML structure
  container.innerHTML = buildChatHTML();

  // Render header from convData (immediate, before API response)
  if (convData) renderHeader();

  // Request full data from provider
  doAction('chat:open', { conversationId: conversationId });
}

function close() {
  // Save draft
  var inputEl = getInputEl();
  if (inputEl && inputEl.value.trim()) {
    doAction('chat:saveDraft', { conversationId: _state.conversationId, text: inputEl.value });
  }

  // Tell provider to leave WS room
  doAction('chat:close', { conversationId: _state.conversationId });

  // Reset state
  resetState();

  // Clear DOM
  var container = getContainer();
  if (container) container.innerHTML = '';

  // Tell explore.js to show list
  if (typeof popChatView === 'function') popChatView();
}
```

- [ ] **Step 3: Implement buildChatHTML**

Returns the full HTML structure for chat view (header, messages area, input area). All elements use `gs-sc-` prefix.

```javascript
function buildChatHTML() {
  return '<div class="gs-sc-header">' +
    '<button class="gs-btn-icon gs-sc-back"><span class="codicon codicon-arrow-left"></span></button>' +
    '<div class="gs-sc-avatar"></div>' +
    '<div class="gs-sc-info"><div class="gs-sc-name"></div><div class="gs-sc-subtitle"></div></div>' +
    '<button class="gs-btn-icon gs-sc-search-btn"><span class="codicon codicon-search"></span></button>' +
    '<button class="gs-btn-icon gs-sc-menu-btn"><span class="codicon codicon-ellipsis"></span></button>' +
  '</div>' +
  '<div class="gs-sc-pinned-banner" style="display:none"></div>' +
  '<div class="gs-sc-messages"></div>' +
  '<div class="gs-sc-input-area">' +
    '<div class="gs-sc-reply-bar" style="display:none"></div>' +
    '<div class="gs-sc-lp-bar" style="display:none"></div>' +
    '<div class="gs-sc-attach-preview" style="display:none"></div>' +
    '<div class="gs-sc-input-row">' +
      '<button class="gs-btn-icon gs-sc-attach-btn"><span class="codicon codicon-attach"></span></button>' +
      '<div class="gs-sc-input-wrap"><textarea class="gs-sc-input" placeholder="Write a message..." rows="1"></textarea></div>' +
      '<button class="gs-btn-icon gs-sc-emoji-btn"><span class="codicon codicon-smiley"></span></button>' +
      '<button class="gs-btn-icon gs-sc-send-btn" style="display:none"><span class="codicon codicon-send"></span></button>' +
    '</div>' +
  '</div>';
}
```

- [ ] **Step 4: Implement message rendering**

Write from scratch for 300px. Reference chat.js for behavior but write new code:

- `groupMessages(msgs)` — group consecutive msgs from same sender within 2min
- `renderDateSeparator(date)` — date pill HTML
- `renderMessage(msg)` — single message bubble (sender, text, reactions, attachments, status, reply quote)
- `renderMessages()` — orchestrator: dedup → group → render all with date separators + unread divider
- `appendMessage(msg)` — add new message, smart scroll (only if at bottom)

- [ ] **Step 5: Implement scroll system**

Single listener, all cases:

```javascript
function attachScrollListener() {
  var container = getMsgsEl();
  if (!container || _scrollListenerAttached) return;
  _scrollListenerAttached = true;
  var rafPending = false;

  container.addEventListener('scroll', function() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(function() {
      rafPending = false;
      var distFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;

      // 1. Infinite scroll up
      if (container.scrollTop < 200 && _state.hasMoreOlder && !_state.loadingOlder) {
        _state.loadingOlder = true;
        doAction('chat:loadMore', { conversationId: _state.conversationId });
      }

      // 2-3. Go Down button hysteresis
      if (distFromBottom > 300) showGoDown();
      else if (distFromBottom <= 100) {
        hideGoDown();
        _newMsgCount = 0;
        updateGoDownBadge();

        // 4. Context mode: load newer
        if (_state.isViewingContext) {
          if (_state.hasMoreAfter && !_state.loadingNewer) {
            _state.loadingNewer = true;
            doAction('chat:loadNewer', { conversationId: _state.conversationId });
          } else if (!_state.hasMoreAfter) {
            _state.isViewingContext = false;
            doAction('chat:reloadConversation', { conversationId: _state.conversationId });
          }
          return;
        }

        // Mark as read (throttled 500ms)
        clearTimeout(_markReadTimer);
        _markReadTimer = setTimeout(function() {
          doAction('chat:markRead', { conversationId: _state.conversationId });
        }, 500);
      }
      // 5. Dead zone 100-300: retain current state
    });
  });
}
```

- [ ] **Step 6: Implement input handling**

- Auto-expand textarea
- Enter to send, Shift+Enter newline
- IME composition handling
- Up arrow edit last message
- Draft auto-save (500ms debounce)
- Send button show/hide

- [ ] **Step 7: Implement handleMessage router**

```javascript
function handleMessage(data) {
  var type = data.type;
  var payload = data.payload || data;

  switch (type) {
    case 'chat:init': onInit(payload); break;
    case 'chat:newMessage': onNewMessage(payload); break;
    case 'chat:olderMessages': onOlderMessages(payload); break;
    case 'chat:newerMessages': onNewerMessages(payload); break;
    case 'chat:typing': onTyping(payload); break;
    case 'chat:reactionUpdated': onReactionUpdated(payload); break;
    case 'chat:conversationRead': onConversationRead(payload); break;
    case 'chat:messagePinned': onMessagePinned(payload); break;
    case 'chat:messageUnpinned': onMessageUnpinned(payload); break;
    case 'chat:messageEdited': onMessageEdited(payload); break;
    case 'chat:messageDeleted': onMessageDeleted(payload); break;
    case 'chat:uploadComplete': onUploadComplete(payload); break;
    case 'chat:uploadFailed': onUploadFailed(payload); break;
    case 'chat:searchResults': onSearchResults(payload); break;
    // ... all other types from spec inventory
    default: break;
  }
}
```

- [ ] **Step 8: Wire up event handlers**

After `buildChatHTML()`, attach click handlers:
- Back button → `close()`
- Send button → `sendMessage()`
- Attach button → show attach menu
- Emoji button → open emoji picker (stub for now)
- Menu button → toggle header menu (stub for now)

- [ ] **Step 9: Verify & commit**

Run: `npm run compile`
Test: Open extension, click conversation → chat view should appear with messages, back button works, scroll works, send message works.

```bash
git add media/webview/sidebar-chat.js
git commit -m "feat: create sidebar-chat.js core — state, render, scroll, input"
```

---

## Task 7: sidebar-chat.css — Chat View Styles

**Files:**
- Create: `media/webview/sidebar-chat.css`

- [ ] **Step 1: Write all chat view styles**

All classes use `gs-sc-` prefix. All colors use `--gs-*` tokens. Write styles for:
- Header (back, avatar, name, subtitle, icons)
- Messages container
- Message bubbles (sent/received, grouping radius)
- Message text, sender, meta, status icons
- Date separators
- Reactions (pills, emoji, count)
- Reply quotes
- Attachments (image grid, file links)
- Input area (textarea, buttons)
- Reply bar
- Go Down button + badge
- Typing indicator
- Unread divider

Reference `media/webview/chat.css` for visual behavior but write new CSS optimized for 300px.

- [ ] **Step 2: Verify & commit**

Run: `npm run compile`

```bash
git add media/webview/sidebar-chat.css
git commit -m "style: create sidebar-chat.css — chat view styles for 300px sidebar"
```

---

## Task 8: sidebar-chat.js — Features (Emoji, Pinned, Search, Attach, Actions)

**Files:**
- Modify: `media/webview/sidebar-chat.js`
- Modify: `media/webview/sidebar-chat.css`

Add remaining features to sidebar-chat.js. Each feature is self-contained within the IIFE.

- [ ] **Step 1: Emoji picker + reactions**

- QUICK_EMOJIS (4 quick reactions) + EMOJIS (73 with search keywords)
- `openEmojiPicker(anchorEl, onSelect)` — overlay positioned above anchor
- `addReaction(msgId, emoji)` — optimistic update + doAction
- Input emoji insert

- [ ] **Step 2: Floating action bar**

- Hover message → show React, Reply, Copy, More buttons
- Event delegation on messages container
- 150ms show/hide delay

- [ ] **Step 3: Pinned messages**

- Pinned banner (compact, accent bar, click to cycle)
- Pinned view overlay (full list + search)
- Jump to pinned message
- Pin/unpin handlers

- [ ] **Step 4: In-chat search**

- Search bar replaces header
- Results overlay with infinite scroll
- Navigate prev/next
- Jump to result (loads context, sets isViewingContext)
- User filter (groups)
- Keyword highlighting

- [ ] **Step 5: Attachments + link previews**

- Attach menu (photo/document)
- File upload (FileReader → base64 → doAction)
- Drag-drop + paste
- Preview strip
- Link preview detection + render
- Image lightbox (overlay full-sidebar)

- [ ] **Step 6: Message actions (More menu)**

- Forward modal (conversation picker)
- Edit (inline textarea, 15min window)
- Unsend/Delete (confirm dialog)
- Copy to clipboard
- Header menu (pin/mute conversation, add people, group info)

- [ ] **Step 7: @Mention autocomplete**

- `@` trigger in input
- Dropdown above input
- Group members / friends list
- API search

- [ ] **Step 8: Group info panel**

- Panel overlay in chat view
- Name/avatar edit (creator)
- Member list
- Add/remove member
- Invite link
- Leave/delete group

- [ ] **Step 9: Add CSS for all features**

Add to sidebar-chat.css:
- Emoji picker overlay
- Floating bar
- Pinned banner + view
- Search bar + results
- Attach menu + preview
- More dropdown
- Forward modal
- Mention dropdown
- Group info panel
- Confirm modal

- [ ] **Step 10: Verify & commit**

Run: `npm run compile`
Test: Every feature individually.

```bash
git add media/webview/sidebar-chat.js media/webview/sidebar-chat.css
git commit -m "feat: sidebar-chat.js features — emoji, pinned, search, attach, actions, groups"
```

---

## Task 9: Integration Testing & Polish

**Files:**
- All modified files

- [ ] **Step 1: Full QA checklist test**

Test every item in `docs/QA-gitchat-refactor.md` (create updated version):
1. Layout & Navigation
2. Chat List (Inbox)
3. Friends Tab
4. Channels Tab
5. Chat View — Messages (send, receive, scroll, load older)
6. Chat View — Input (Enter, Shift+Enter, IME, draft)
7. Reactions & Emoji
8. Reply
9. Pinned Messages
10. Attachments & Link Previews
11. Message Actions
12. @Mentions
13. Group Management
14. Real-time (new messages, typing, reactions, read receipts)
15. State Persistence (switch sidebar, restore)
16. Theme Compatibility (Dark, Light, High Contrast)

- [ ] **Step 2: Fix bugs found during QA**

- [ ] **Step 3: Remove debug console.log statements**

- [ ] **Step 4: Final compile check**

Run: `npm run compile` — 0 errors.

- [ ] **Step 5: Commit**

```bash
git add -u
git commit -m "fix: QA polish and bug fixes for sidebar chat"
```
