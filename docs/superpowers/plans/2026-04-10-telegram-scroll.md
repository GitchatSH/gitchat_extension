# Telegram-Clone Scroll System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clone Telegram's scroll UX into the VS Code extension chat — 3-button stack, auto-scroll, scroll position memory, mark-as-read, and sidebar sync.

**Architecture:** Extend existing scroll-to-bottom button into a 3-button stack (Go Down / Mentions / Reactions). Refactor `renderMessages()` to open at first unread instead of always at bottom. Add `postMessage({ type: 'markRead' })` from webview scroll listener to extension-side handler with throttle. All new BE fields are optional with graceful fallback.

**Tech Stack:** Vanilla JS (webview), TypeScript (extension), CSS with `--gs-*` design tokens, VS Code Codicon icons.

**Spec:** `docs/superpowers/specs/2026-04-10-telegram-scroll-design.md`

---

## File Map

| File | Role | Changes |
|------|------|---------|
| `src/types/index.ts` | TypeScript interfaces | Add optional fields to `Conversation` |
| `media/webview/chat.css` | Chat styles | Button stack CSS, animations, muted badge |
| `media/webview/chat.js` | Chat webview logic | Button stack, scroll logic, mark-as-read, cycling state |
| `src/webviews/chat.ts` | Extension-side chat | Handle `markRead`, pass new fields, open-at-unread logic |
| `media/webview/chat-panel.js` | Sidebar chat list | Muted badge styling, mention @ indicator |
| `media/webview/chat-panel.css` | Sidebar styles | Muted badge gray variant |

---

### Task 1: Add optional fields to Conversation type

**Files:**
- Modify: `src/types/index.ts:89-104`

- [ ] **Step 1: Add new optional fields to Conversation interface**

In `src/types/index.ts`, add these fields to the `Conversation` interface after `updated_at`:

```typescript
export interface Conversation {
  id: string;
  type?: "direct" | "group";
  is_group?: boolean;
  group_name?: string;
  group_avatar_url?: string;
  participants: ConversationParticipant[];
  last_message: Message | null;
  last_message_preview?: string;
  last_message_at?: string;
  unread_count: number;
  pinned: boolean;
  pinned_at?: string;
  is_request: boolean;
  updated_at: string;
  // Telegram scroll system (optional — BE may not provide yet)
  is_muted?: boolean;
  last_read_message_id?: string;
  unread_mentions_count?: number;
  unread_reactions_count?: number;
}
```

- [ ] **Step 2: Verify types compile**

Run: `npm run check-types`
Expected: PASS (all new fields are optional, no breaking changes)

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "feat(types): add optional scroll-system fields to Conversation"
```

---

### Task 2: Button stack CSS — 3 buttons with animation

**Files:**
- Modify: `media/webview/chat.css:1432-1458`

- [ ] **Step 1: Replace existing scroll button CSS with button stack system**

Replace the `/* ── Scroll-to-bottom button ── */` block (lines 1432-1458) with:

```css
/* ── Scroll button stack (Go Down / Mentions / Reactions) ── */
.scroll-btn-stack {
  position: absolute;
  bottom: 16px;
  right: 16px;
  display: flex;
  flex-direction: column-reverse;
  align-items: center;
  gap: 8px;
  z-index: 10;
  pointer-events: none;
}

.scroll-stack-btn {
  position: relative;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 1px solid var(--gs-widget-border);
  background: var(--gs-bg);
  color: var(--gs-fg);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 6px rgba(0,0,0,0.2);
  pointer-events: auto;
  /* Animation: slide up 150ms ease-out, hide 150ms ease-in */
  opacity: 0;
  transform: translateY(20px);
  transition: opacity 150ms ease-in, transform 150ms ease-in, background 0.15s;
}

.scroll-stack-btn.is-visible {
  opacity: 1;
  transform: translateY(0);
  transition: opacity 150ms ease-out, transform 150ms ease-out, background 0.15s;
}

.scroll-stack-btn:hover {
  background: var(--gs-hover);
}

.scroll-stack-btn .scroll-badge {
  position: absolute;
  top: -4px;
  right: -4px;
  min-width: 18px;
  height: 18px;
  border-radius: 9px;
  background: var(--gs-error);
  color: var(--gs-overlay-fg);
  font-size: var(--gs-font-xs);
  font-weight: 600;
  display: none;
  align-items: center;
  justify-content: center;
  padding: 0 4px;
}

.scroll-stack-btn .scroll-badge.has-count {
  display: flex;
}

/* Muted variant: gray badge */
.scroll-stack-btn .scroll-badge.badge-muted {
  background: var(--gs-muted);
}

/* Mention button @ text icon */
.scroll-stack-btn .mention-icon {
  font-size: 16px;
  font-weight: 700;
  line-height: 1;
}

/* Flash highlight for mention/reaction jump */
@keyframes msg-flash-anim {
  0%, 100% { background: transparent; }
  50% { background: var(--gs-highlight); }
}
.msg-flash {
  animation: msg-flash-anim 1.5s ease;
}
```

- [ ] **Step 2: Verify CSS loads without syntax errors**

Run: `npm run compile`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add media/webview/chat.css
git commit -m "style(chat): add button stack CSS with slide-up animation"
```

---

### Task 3: Build button stack DOM in chat.js

**Files:**
- Modify: `media/webview/chat.js:718-763` (replace `getScrollBottomBtn`, `updateScrollBadge`, `incrementScrollBadge`)

- [ ] **Step 1: Add new state variables**

At the top of chat.js (after line 32, near the existing state vars), add:

```javascript
var _scrollStack = null; // container for 3 buttons
var _goDownBtn = null;
var _mentionBtn = null;
var _reactionBtn = null;
var _mentionIds = [];     // message IDs with unread mentions
var _mentionIndex = 0;
var _reactionIds = [];    // message IDs with unread reactions
var _reactionIndex = 0;
var _markReadTimer = null; // throttle for markRead calls
var _lastMarkReadTime = 0;
```

- [ ] **Step 2: Replace `getScrollBottomBtn` with `getScrollStack` builder**

Replace the entire `getScrollBottomBtn()` function (lines 718-743) with:

```javascript
function getScrollStack() {
  if (_scrollStack) return _scrollStack;

  _scrollStack = document.createElement('div');
  _scrollStack.className = 'scroll-btn-stack';

  // Go Down button (bottom of stack — first in column-reverse)
  _goDownBtn = createStackBtn('scroll-go-down', '<span class="codicon codicon-chevron-down"></span>');
  _goDownBtn.addEventListener('click', onGoDownClick);

  // Mentions button
  _mentionBtn = createStackBtn('scroll-mention-btn', '<span class="mention-icon">@</span>');
  _mentionBtn.addEventListener('click', onMentionClick);

  // Reactions button
  _reactionBtn = createStackBtn('scroll-reaction-btn', '<span class="codicon codicon-heart"></span>');
  _reactionBtn.addEventListener('click', onReactionClick);

  // Stack order: reactions (top) → mentions → go-down (bottom)
  // column-reverse means first child = bottom, so: go-down first, mention second, reaction third
  _scrollStack.appendChild(_goDownBtn);
  _scrollStack.appendChild(_mentionBtn);
  _scrollStack.appendChild(_reactionBtn);

  var container = document.getElementById('messages');
  if (container) container.appendChild(_scrollStack);

  return _scrollStack;
}

function createStackBtn(id, innerHtml) {
  var btn = document.createElement('button');
  btn.id = id;
  btn.className = 'scroll-stack-btn';
  btn.innerHTML = innerHtml + '<span class="scroll-badge">0</span>';
  return btn;
}
```

- [ ] **Step 3: Implement click handlers**

Add after the `getScrollStack` function:

```javascript
function onGoDownClick() {
  if (_isViewingContext) {
    _isViewingContext = false;
    vscode.postMessage({ type: 'reloadConversation' });
    return;
  }
  var container = document.getElementById('messages');
  if (!container) return;
  var divider = document.getElementById('unread-divider');
  if (divider) {
    // Unread divider exists in DOM — scroll to it
    divider.scrollIntoView({ block: 'start' });
    return;
  }
  // No unread — scroll to bottom
  var dist = container.scrollHeight - container.scrollTop - container.clientHeight;
  if (dist > 1000) {
    container.scrollTop = container.scrollHeight;
  } else {
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
  }
  _newMsgCount = 0;
  updateGoDownBadge();
}

function onMentionClick() {
  if (_mentionIds.length === 0) return;
  var msgId = _mentionIds[_mentionIndex];
  var el = document.querySelector('[data-msg-id="' + msgId + '"]');
  if (el) {
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.add('msg-flash');
    setTimeout(function() { el.classList.remove('msg-flash'); }, 1500);
    _mentionIndex = (_mentionIndex + 1) % _mentionIds.length;
  } else {
    // Message not in DOM — request fetch around this message
    vscode.postMessage({ type: 'jumpToMessage', messageId: msgId });
  }
}

function onReactionClick() {
  if (_reactionIds.length === 0) return;
  var msgId = _reactionIds[_reactionIndex];
  var el = document.querySelector('[data-msg-id="' + msgId + '"]');
  if (el) {
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.add('msg-flash');
    setTimeout(function() { el.classList.remove('msg-flash'); }, 1500);
    _reactionIndex = (_reactionIndex + 1) % _reactionIds.length;
  } else {
    vscode.postMessage({ type: 'jumpToMessage', messageId: msgId });
  }
}
```

- [ ] **Step 4: Replace `updateScrollBadge` and `incrementScrollBadge`**

Replace the existing `updateScrollBadge()` (lines 745-756) and `incrementScrollBadge()` (lines 758-763) with:

```javascript
function updateGoDownBadge() {
  if (!_goDownBtn) return;
  var badge = _goDownBtn.querySelector('.scroll-badge');
  if (!badge) return;
  if (_newMsgCount > 0) {
    badge.textContent = _newMsgCount;
    badge.classList.add('has-count');
    badge.classList.toggle('badge-muted', isMuted);
  } else {
    badge.classList.remove('has-count');
    badge.textContent = '0';
  }
}

function incrementScrollBadge() {
  _newMsgCount++;
  showGoDownBtn();
  updateGoDownBadge();
}

function showGoDownBtn() {
  getScrollStack();
  if (_goDownBtn) _goDownBtn.classList.add('is-visible');
}

function hideGoDownBtn() {
  if (_goDownBtn) _goDownBtn.classList.remove('is-visible');
}

function updateMentionBtn(count, ids) {
  getScrollStack();
  _mentionIds = ids || [];
  _mentionIndex = 0;
  if (!_mentionBtn) return;
  var badge = _mentionBtn.querySelector('.scroll-badge');
  if (count > 0 && _mentionIds.length > 0) {
    _mentionBtn.classList.add('is-visible');
    badge.textContent = count;
    badge.classList.add('has-count');
  } else {
    _mentionBtn.classList.remove('is-visible');
    badge.classList.remove('has-count');
  }
}

function updateReactionBtn(count, ids) {
  getScrollStack();
  _reactionIds = ids || [];
  _reactionIndex = 0;
  if (!_reactionBtn) return;
  var badge = _reactionBtn.querySelector('.scroll-badge');
  if (count > 0 && _reactionIds.length > 0) {
    _reactionBtn.classList.add('is-visible');
    badge.textContent = count;
    badge.classList.add('has-count');
  } else {
    _reactionBtn.classList.remove('is-visible');
    badge.classList.remove('has-count');
  }
}

function resetScrollState() {
  _newMsgCount = 0;
  _mentionIds = [];
  _mentionIndex = 0;
  _reactionIds = [];
  _reactionIndex = 0;
  updateGoDownBadge();
  if (_mentionBtn) _mentionBtn.classList.remove('is-visible');
  if (_reactionBtn) _reactionBtn.classList.remove('is-visible');
}
```

- [ ] **Step 5: Verify build compiles**

Run: `npm run compile`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add media/webview/chat.js
git commit -m "feat(chat): build 3-button scroll stack with click handlers"
```

---

### Task 4: Refactor scroll listener for hysteresis + mark-as-read

**Files:**
- Modify: `media/webview/chat.js:765-795` (scroll listener IIFE)

- [ ] **Step 1: Replace scroll listener with new logic**

Replace the entire scroll listener IIFE (lines 765-795) with:

```javascript
// Scroll listener: button visibility (hysteresis) + mark-as-read
(function() {
  var container = document.getElementById('messages');
  if (!container) return;
  var _rafPending = false;

  container.addEventListener('scroll', function() {
    if (_rafPending) return;
    _rafPending = true;
    requestAnimationFrame(function() {
      _rafPending = false;
      var distFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;

      // --- Hysteresis: show at >300, hide at ≤100, retain in 100-300 ---
      if (distFromBottom > 300) {
        showGoDownBtn();
      } else if (distFromBottom <= 100) {
        // Handle context viewing mode (bidirectional scroll)
        if (_isViewingContext) {
          if (_hasMoreAfter) {
            if (_loadingNewer) { return; }
            _loadingNewer = true;
            vscode.postMessage({ type: 'loadNewer' });
            return;
          }
          _isViewingContext = false;
          vscode.postMessage({ type: 'reloadConversation' });
          return;
        }

        hideGoDownBtn();
        _newMsgCount = 0;
        updateGoDownBadge();

        // Remove one-shot unread divider
        var divider = document.getElementById('unread-divider');
        if (divider) { divider.remove(); }

        // Mark as read (throttled: max 1 per 500ms)
        var now = Date.now();
        if (now - _lastMarkReadTime >= 500) {
          _lastMarkReadTime = now;
          vscode.postMessage({ type: 'markRead' });
        } else if (!_markReadTimer) {
          _markReadTimer = setTimeout(function() {
            _markReadTimer = null;
            _lastMarkReadTime = Date.now();
            vscode.postMessage({ type: 'markRead' });
          }, 500 - (now - _lastMarkReadTime));
        }
      }
      // 100-300 range: retain current visibility (hysteresis)
    });
  }, { passive: true });
})();
```

- [ ] **Step 2: Verify build compiles**

Run: `npm run compile`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add media/webview/chat.js
git commit -m "feat(chat): refactor scroll listener with hysteresis and mark-as-read"
```

---

### Task 5: Auto-scroll on send for all paths

**Files:**
- Modify: `media/webview/chat.js:2048-2065` (sendMessage function)

- [ ] **Step 1: Add scroll-to-bottom after ALL send paths**

In the `sendMessage()` function, there are TWO `vscode.postMessage({ type: "send" })` paths — one for reply (around line 2086) and one for regular send (around line 2089). The scroll must cover BOTH paths.

Add this block **immediately after the optimistic render block** (after line 2065, before the payload construction at line 2067), so it runs for all send paths (text, attachment, reply):

```javascript
// Telegram behavior: sending always scrolls to bottom (all paths)
var sendScrollContainer = document.getElementById('messages');
if (sendScrollContainer) { sendScrollContainer.scrollTop = sendScrollContainer.scrollHeight; }
_newMsgCount = 0;
updateGoDownBadge();
```

This placement is BEFORE the reply/regular branch, so it covers both paths.

- [ ] **Step 2: Verify build compiles**

Run: `npm run compile`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add media/webview/chat.js
git commit -m "feat(chat): auto-scroll to bottom on all send paths"
```

---

### Task 6: Scroll to first unread on conversation open

**Files:**
- Modify: `media/webview/chat.js:604-625` (renderMessages function)
- Modify: `media/webview/chat.js:170-196` (init message handler)

- [ ] **Step 1: Refactor `renderMessages` to scroll to unread divider**

Replace the `renderMessages` function (lines 604-625) with:

```javascript
function renderMessages(messages, unreadCount) {
  var seen = {};
  var unique = messages.filter(function(m) {
    if (!m.id || seen[m.id]) return false;
    seen[m.id] = true;
    return true;
  });
  var grouped = groupMessages(unique);
  var container = document.getElementById("messages");
  var dividerIndex = unreadCount > 0 ? grouped.length - unreadCount : -1;
  container.innerHTML = grouped.map(function(msg, i) {
    var dividerHtml = '';
    if (i === dividerIndex && dividerIndex > 0) {
      dividerHtml = '<div class="unread-divider" id="unread-divider"><span>New Messages</span></div>';
    }
    return dividerHtml + (msg.showDateSeparator ? renderDateSeparator(msg.created_at) : '') + renderMessage(msg);
  }).join("");

  // Reset button stack
  if (_scrollStack) { _scrollStack.remove(); _scrollStack = null; _goDownBtn = null; _mentionBtn = null; _reactionBtn = null; }
  _newMsgCount = 0;
  getScrollStack();

  // Scroll: if unread divider exists, scroll to it. Otherwise scroll to bottom.
  var divider = document.getElementById('unread-divider');
  if (divider && unreadCount > 0) {
    divider.scrollIntoView({ block: 'start' });
  } else {
    container.scrollTop = container.scrollHeight;
  }

  bindSenderClicks(container);
  bindFloatingBarEvents(container);
```

Note: preserve whatever other code follows in the original function (e.g. link preview queue, etc.).

- [ ] **Step 2: Update init handler to remove forced scroll-to-bottom**

In the init message handler (around lines 187-194), remove the triple `scrollToBottom()` calls:

```javascript
// Remove these lines:
// var scrollToBottom = function() { ... };
// scrollToBottom();
// setTimeout(scrollToBottom, 150);
// setTimeout(scrollToBottom, 500);
```

Replace with a single delayed re-scroll for media loading:

```javascript
// Re-scroll after images load (preserve position at unread divider or bottom)
setTimeout(function() {
  var divider = document.getElementById('unread-divider');
  if (divider) {
    divider.scrollIntoView({ block: 'start' });
  } else {
    var c = document.getElementById('messages');
    if (c) c.scrollTop = c.scrollHeight;
  }
}, 300);
```

- [ ] **Step 3: Verify build compiles**

Run: `npm run compile`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add media/webview/chat.js
git commit -m "feat(chat): open conversation at first unread message"
```

---

### Task 7: Handle `markRead` in extension-side chat.ts

**Files:**
- Modify: `src/webviews/chat.ts:230` (onMessage switch)

- [ ] **Step 1: Add `markRead` case to the onMessage switch**

In `chat.ts`, inside the `onMessage` method's switch statement (line 230), add a new case:

```typescript
case "markRead": {
  await apiClient.markConversationRead(this._conversationId).catch(() => {});
  import("./chat-panel").then(m => m.chatPanelWebviewProvider?.debouncedRefresh()).catch(() => {});
  import("../statusbar").then(m => m.fetchCounts()).catch(() => {});
  break;
}
```

- [ ] **Step 2: Remove auto-markRead on new message arrival**

In the constructor (lines 42-47), the current code marks conversation as read immediately when a new message arrives AND the panel is visible. This conflicts with the new scroll-based read logic. Replace:

```typescript
// Only mark read if this chat panel is actually visible
if (this._panel.visible) {
  apiClient.markConversationRead(this._conversationId).then(() => {
    import("./chat-panel").then(m => m.chatPanelWebviewProvider?.debouncedRefresh()).catch(() => {});
  }).catch(() => {});
}
```

With:

```typescript
// Mark-as-read is now handled by webview scroll listener (markRead message)
// Only auto-mark if panel is visible AND webview reports being at bottom
// The webview's scroll listener will send markRead when appropriate
```

This removes the always-mark-read behavior. The webview scroll listener now controls when to mark as read.

- [ ] **Step 3: Also remove auto-markRead on conversation open**

In `loadData()` (lines 224-226), remove ALL three lines:

```typescript
await apiClient.markConversationRead(this._conversationId).catch(() => {});
import("./chat-panel").then(m => m.chatPanelWebviewProvider?.debouncedRefresh()).catch(() => {});
import("../statusbar").then(m => m.fetchCounts()).catch(() => {});
```

The new `markRead` case (Step 1) already includes the refresh and fetchCounts calls. Leaving these would cause double-refresh on first open.

- [ ] **Step 4: Verify types compile**

Run: `npm run check-types`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/webviews/chat.ts
git commit -m "feat(chat): handle markRead from webview, remove auto-mark-read"
```

---

### Task 8: Pass new Conversation fields to webview init

**Files:**
- Modify: `src/webviews/chat.ts:195-217` (init payload)

- [ ] **Step 1: Add new fields to init payload**

In the `loadData()` method, inside the `postMessage({ type: "init" ... })` call, add these fields to the payload object. Since Task 1 already added these fields to the `Conversation` interface, access them directly:

```typescript
// Add after existing fields (unreadCount, etc.):
lastReadMessageId: conv?.last_read_message_id,
unreadMentionsCount: conv?.unread_mentions_count ?? 0,
unreadReactionsCount: conv?.unread_reactions_count ?? 0,
```

Note: `conv` may still need casting since `getConversations()` return type might not be updated. If so, use the same `(conv as Record<string, unknown>)` pattern already used for `is_muted` in this file.

- [ ] **Step 2: Handle new fields in webview init handler**

In `chat.js`, in the `init` case (around line 170), add after existing field reads:

```javascript
// Mention/Reaction buttons — hidden until BE provides endpoints + IDs
// When BE adds GET /conversations/:id/unread-mentions, call:
//   updateMentionBtn(msg.payload.unreadMentionsCount, mentionMsgIds);
// When BE adds GET /conversations/:id/unread-reactions, call:
//   updateReactionBtn(msg.payload.unreadReactionsCount, reactionMsgIds);
```

No variables assigned — avoids unused-var linter warnings. The `updateMentionBtn`/`updateReactionBtn` functions (Task 3) are ready to be called once BE provides the data.

- [ ] **Step 3: Verify build compiles**

Run: `npm run compile`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/webviews/chat.ts media/webview/chat.js
git commit -m "feat(chat): pass new conversation fields to webview init"
```

---

### Task 9: Sidebar muted badge + mention @ indicator

**Files:**
- Modify: `media/webview/chat-panel.js:297` (badge rendering)
- Modify: `media/webview/chat-panel.css` (add muted badge + mention indicator styles)

- [ ] **Step 1: Update badge HTML to add muted class + mention @ indicator**

In `chat-panel.js`, find the unreadBadge line (line 297):

```javascript
var unreadBadge = unread ? '<span class="gs-badge">' + (c.unread_count || '') + '</span>' : '';
```

Replace with:

```javascript
var hasMentions = c.unread_mentions_count > 0;
var badgeClass = 'gs-badge' + (c.is_muted && !hasMentions ? ' gs-badge-muted' : '');
var mentionIndicator = hasMentions ? '<span class="gs-badge-mention">@</span>' : '';
var unreadBadge = unread ? mentionIndicator + '<span class="' + badgeClass + '">' + (c.unread_count || '') + '</span>' : '';
```

Note: Mention `@` indicator pierces mute — when `hasMentions` is true, badge stays red/colored even for muted chats (per spec). The `@` indicator is a separate element shown alongside the number badge. When BE doesn't provide `unread_mentions_count`, `hasMentions` will be false and no `@` indicator shows (graceful fallback).

- [ ] **Step 2: Add muted badge + mention indicator CSS**

In `media/webview/chat-panel.css`, add:

```css
/* Muted conversation badge — gray instead of red */
.gs-badge-muted {
  background: var(--gs-muted) !important;
}

/* Mention @ indicator (pierces mute) */
.gs-badge-mention {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 9px;
  background: var(--gs-info);
  color: var(--gs-overlay-fg);
  font-size: var(--gs-font-xs);
  font-weight: 700;
  margin-right: 2px;
}
```

- [ ] **Step 3: Verify build compiles**

Run: `npm run compile`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add media/webview/chat-panel.js media/webview/chat-panel.css
git commit -m "style(sidebar): gray badge for muted conversations"
```

---

### Task 10: Note — fetch-around-unread (deferred until BE provides `last_read_message_id`)

The spec describes fetching messages *around* the first unread position using `last_read_message_id` + cursor-based API. This requires extension-side changes in `chat.ts` `loadData()`:

1. If `conv.last_read_message_id` exists → `getMessages(id, 1, last_read_message_id, 'after')` to get unread messages, then `getMessages(id, 1, last_read_message_id, 'before')` for context above divider
2. Set `_isViewingContext = true` and `_hasMoreAfter = true` if there are newer messages beyond loaded page
3. Current fallback (no `last_read_message_id`): the `unread_count`-based divider placement in `renderMessages` works when all unreads fit in first page. For conversations where `unread_count` > 1 page of messages, the fallback scrolls to bottom.

**This task is NOT implemented now** because BE doesn't provide `last_read_message_id` yet. The current fallback (Task 6) handles the common case. When BE adds the field, implement this as a follow-up task.

---

### Task 11: Update appendMessage to use new badge system

**Files:**
- Modify: `media/webview/chat.js:672-716` (appendMessage function)

- [ ] **Step 1: Update appendMessage to use new functions**

In the `appendMessage` function, the auto-scroll section (lines 711-715) already calls `incrementScrollBadge()`. Since we replaced that function in Task 3, verify it still works. The key change: replace any remaining references to the old `scrollBtnEl` variable.

Find (around line 711-715):

```javascript
if (distFromBottom <= 100) {
  container.scrollTop = container.scrollHeight;
} else {
  incrementScrollBadge();
}
```

This should remain as-is — `incrementScrollBadge()` was already updated in Task 3 to call `showGoDownBtn()` and `updateGoDownBadge()`.

- [ ] **Step 2: Clean up old scrollBtnEl reference in renderMessages**

In `renderMessages` (modified in Task 6), ensure the old `scrollBtnEl = null` cleanup is replaced with the new `_scrollStack` cleanup (already done in Task 6 step 1).

Remove all remaining references to `scrollBtnEl` in chat.js. Complete list:

1. **Line 20:** `var scrollBtnEl = null;` — DELETE this line (replaced by `_goDownBtn` etc. from Task 3)
2. **Line 621 (in renderMessages):** `if (scrollBtnEl) { scrollBtnEl = null; }` — Already replaced in Task 6 with `_scrollStack` cleanup

Verify no other references remain by searching for `scrollBtnEl` in chat.js.

- [ ] **Step 3: Verify build compiles**

Run: `npm run compile`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add media/webview/chat.js
git commit -m "refactor(chat): clean up old scroll button references"
```

---

### Task 12: Integration test — full manual verification

**Files:** None (manual testing)

- [ ] **Step 1: Full build**

Run: `npm run compile`
Expected: PASS with 0 errors

- [ ] **Step 2: Manual test checklist**

Press F5 in VS Code to launch extension host. Test:

1. Open a conversation with unread messages → should scroll to "New Messages" divider (not bottom)
2. Scroll up >300px → Go Down button appears with slide-up animation
3. Scroll back to ≤100px → Go Down button hides
4. Scroll up, receive new message → badge increments on Go Down button
5. Click Go Down → scrolls to unread divider (if exists) or bottom
6. Send message while scrolled up → auto-scrolls to bottom
7. Muted conversation in sidebar → gray badge instead of red
8. Scroll to bottom of conversation → `markRead` fires (check Network/console)
9. Go Down button in muted chat → badge is gray

- [ ] **Step 3: Update contributor doc and commit**

Update `docs/contributors/slugmacro.md` with current status, then:

```bash
git add docs/contributors/slugmacro.md
git commit -m "docs: update contributor status after scroll implementation"
```
