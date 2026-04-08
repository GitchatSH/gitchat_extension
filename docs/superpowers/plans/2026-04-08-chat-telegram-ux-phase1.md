# Chat Telegram UX Phase 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 5 Telegram-like UX features to chat: scroll-to-bottom button, new messages divider, draft indicator, keyboard shortcuts, pinned messages list view.

**Architecture:** All changes are frontend-only (no new API endpoints). Features touch `chat.js`/`chat.css` (chat webview), `chat-panel.js`/`chat-panel.css` (inbox webview), and `chat.ts`/`chat-panel.ts` (extension-side providers). Draft feature requires cross-webview relay through `chat.ts`.

**IMPORTANT:** `chat.js` is wrapped in an IIFE `(function() { ... })();`. ALL new code must go **inside** this IIFE as siblings to existing functions. Never place code outside the IIFE closure.

**Tech Stack:** VS Code Webview API, vanilla JS (no framework), CSS with VS Code theme tokens, TypeScript extension host.

**Spec:** `docs/superpowers/specs/2026-04-08-chat-telegram-ux-phase1-design.md`

---

## File Map

| File | Responsibility | Tasks |
|------|---------------|-------|
| `media/webview/chat.js` | Chat UI logic | 1, 2, 4, 5 |
| `media/webview/chat.css` | Chat styles | 1, 2, 4, 5 |
| `media/webview/chat-panel.js` | Inbox UI logic | 3 |
| `media/webview/chat-panel.css` | Inbox styles | 3 |
| `src/webviews/chat.ts` | Chat panel provider | 2, 3 |
| `src/webviews/chat-panel.ts` | Inbox panel provider | 3 |

---

### Task 1: Scroll-to-Bottom Floating Button

**Files:**
- Modify: `media/webview/chat.js:583-611` (replace `getNewMsgBadge()` with scroll button)
- Modify: `media/webview/chat.css:1075-1089` (replace `.new-msg-badge` styles)

- [ ] **Step 1: Add scroll-to-bottom button HTML**

In `chat.js`, add a function to create the scroll button. This replaces the existing `getNewMsgBadge()` at line 583.

```javascript
// Replace getNewMsgBadge() (line 583-611) with:
var scrollBtnEl = null;
var scrollBadgeCount = 0;

function getScrollBottomBtn() {
  if (scrollBtnEl) return scrollBtnEl;
  scrollBtnEl = document.createElement('button');
  scrollBtnEl.id = 'scroll-bottom-btn';
  scrollBtnEl.className = 'scroll-bottom-btn';
  scrollBtnEl.style.display = 'none';
  scrollBtnEl.innerHTML = '<span class="codicon codicon-chevron-down"></span><span class="scroll-badge" id="scroll-badge" style="display:none">0</span>';
  document.getElementById('messages').appendChild(scrollBtnEl);
  scrollBtnEl.addEventListener('click', function() {
    var c = document.getElementById('messages');
    c.scrollTo({ top: c.scrollHeight, behavior: 'smooth' });
    scrollBadgeCount = 0;
    updateScrollBadge();
  });
  return scrollBtnEl;
}

function updateScrollBadge() {
  var badge = document.getElementById('scroll-badge');
  if (!badge) return;
  if (scrollBadgeCount > 0) {
    badge.textContent = scrollBadgeCount > 99 ? '99+' : String(scrollBadgeCount);
    badge.style.display = '';
  } else {
    badge.style.display = 'none';
  }
}

function incrementScrollBadge() {
  var c = document.getElementById('messages');
  var distFromBottom = c.scrollHeight - c.scrollTop - c.clientHeight;
  if (distFromBottom > 100) {
    scrollBadgeCount++;
    updateScrollBadge();
    getScrollBottomBtn().style.display = '';
  }
}
```

- [ ] **Step 2: Add standalone scroll listener**

In `chat.js`, after the button creation code, add a scroll listener at the IIFE top-level scope (sibling to the function definitions, NOT inside any function):

```javascript
// Add at IIFE top-level scope, after getScrollBottomBtn definition
document.getElementById('messages').addEventListener('scroll', function() {
  var c = document.getElementById('messages');
  var distFromBottom = c.scrollHeight - c.scrollTop - c.clientHeight;
  var btn = getScrollBottomBtn();
  if (distFromBottom > 300) {
    btn.style.display = '';
  } else {
    btn.style.display = 'none';
    scrollBadgeCount = 0;
    updateScrollBadge();
  }
}, { passive: true });
```

- [ ] **Step 3: Update new message handler to use scroll button**

Find the existing code that calls `getNewMsgBadge()` (around line 577) in the `appendMessage` flow and replace with `incrementScrollBadge()`. The existing auto-scroll logic at line 577 (`if (distFromBottom <= 100) { container.scrollTop = container.scrollHeight; }`) stays — only the badge part changes.

- [ ] **Step 3b: Re-attach scroll button after `renderMessages()`**

**CRITICAL:** `renderMessages()` at line 486 uses `container.innerHTML = ...` which wipes all children of `#messages`, including the scroll button. After `renderMessages()` completes, re-attach the button:

```javascript
// After container.innerHTML = ... in renderMessages(), add:
if (scrollBtnEl) {
  scrollBtnEl = null; // force re-creation
  getScrollBottomBtn(); // re-append to DOM
}
```

Also ensure this runs in the `init` handler (line 170) after `renderMessages(msg.payload.messages)` is called.

- [ ] **Step 4: Add CSS styles**

In `chat.css`, replace `.new-msg-badge` styles (lines 1075-1089) with:

```css
/* Scroll-to-bottom floating button — #messages has position:relative */
.scroll-bottom-btn {
  position: absolute;
  bottom: 16px;
  right: 16px;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.3));
  background: var(--vscode-editor-background);
  color: var(--vscode-foreground);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
  box-shadow: 0 2px 6px rgba(0,0,0,0.2);
  transition: opacity 0.2s;
}
.scroll-bottom-btn:hover {
  background: var(--vscode-list-hoverBackground);
}
.scroll-badge {
  position: absolute;
  top: -4px;
  right: -4px;
  min-width: 18px;
  height: 18px;
  border-radius: 9px;
  background: var(--vscode-notificationsErrorIcon-foreground, #f44);
  color: #fff;
  font-size: 10px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 4px;
}
```

- [ ] **Step 5: Test manually**

1. Open a chat conversation
2. Scroll up > 300px → button should appear at bottom-right
3. Receive a new message while scrolled up → badge count should show
4. Click button → smooth scroll to bottom, badge clears
5. Scroll to bottom manually → button hides

- [ ] **Step 6: Commit**

```bash
git add media/webview/chat.js media/webview/chat.css
git commit -m "feat(chat): scroll-to-bottom floating button with unread badge"
```

---

### Task 2: New Messages Divider

**Files:**
- Modify: `src/webviews/chat.ts:155-176` (add `unread_count` to init payload)
- Modify: `media/webview/chat.js:153-173` (receive `unread_count` in init handler)
- Modify: `media/webview/chat.js:477` (insert divider in `renderMessages()`)
- Modify: `media/webview/chat.css` (add `.unread-divider` styles)

- [ ] **Step 1: Pass `unread_count` from extension to webview**

In `chat.ts`, inside `loadData()` at line 155-176, add `unreadCount` to the init payload:

```typescript
// In the postMessage call at line 155, add to payload object:
unreadCount: (conv as Record<string, number>)?.unread_count ?? 0,
```

**NOTE:** `conv` is fetched from `apiClient.getConversations()` (list endpoint) at line 99. The `unread_count` field is used in `chat-panel.js:286` from the same source, so it's confirmed available. If the field is missing for some reason, `?? 0` ensures the divider simply won't show (safe fallback).

- [ ] **Step 2: Receive `unread_count` in chat webview**

In `chat.js`, in the `case "init":` handler (line 153), add:

```javascript
// After line 167 (currentConversationId = ...)
var initialUnreadCount = msg.payload.unreadCount || 0;
```

- [ ] **Step 3: Insert divider in `renderMessages()`**

In `chat.js`, modify `renderMessages()` (line 477) to insert a divider. Find where messages are iterated and HTML is built. Insert divider before the first unread message:

```javascript
// Inside renderMessages(), after building the messages HTML loop,
// before inserting into DOM:
// Calculate divider position
var unreadDividerInserted = false;
var dividerIndex = initialUnreadCount > 0 ? msgs.length - initialUnreadCount : -1;

// In the message loop, when index === dividerIndex and dividerIndex > 0:
if (i === dividerIndex && dividerIndex > 0 && !unreadDividerInserted) {
  html += '<div class="unread-divider" id="unread-divider"><span>New Messages</span></div>';
  unreadDividerInserted = true;
}
```

- [ ] **Step 4: Auto-scroll to divider on load**

After `renderMessages()` completes in the init handler (line 170), scroll to the divider if it exists:

```javascript
// After renderMessages (line 170), add:
setTimeout(function() {
  var divider = document.getElementById('unread-divider');
  if (divider) {
    divider.scrollIntoView({ behavior: 'auto', block: 'center' });
  }
}, 100);
```

- [ ] **Step 5: Remove divider after reading**

In the existing scroll listener (the one that checks scroll-to-bottom), add divider removal:

```javascript
// When user scrolls to bottom (distFromBottom <= 100):
var divider = document.getElementById('unread-divider');
if (divider) { divider.remove(); }
initialUnreadCount = 0;
```

- [ ] **Step 6: Add CSS styles**

In `chat.css`, add:

```css
/* New messages divider */
.unread-divider {
  display: flex;
  align-items: center;
  margin: 12px 0;
  gap: 12px;
}
.unread-divider::before,
.unread-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--vscode-textLink-foreground);
}
.unread-divider span {
  font-size: 11px;
  font-weight: 600;
  color: var(--vscode-textLink-foreground);
  white-space: nowrap;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
```

- [ ] **Step 7: Test manually**

1. Have someone send messages to you while you're not in the conversation
2. Open the conversation → should see "NEW MESSAGES" divider
3. View should auto-scroll to the divider
4. Scroll to bottom → divider disappears

- [ ] **Step 8: Commit**

```bash
git add media/webview/chat.js media/webview/chat.css src/webviews/chat.ts
git commit -m "feat(chat): new messages divider between read and unread"
```

---

### Task 3: Draft Indicator

**Files:**
- Modify: `src/webviews/chat-panel.ts:332` (add `_drafts` Map + `setDraft`/`getDraft` methods)
- Modify: `src/webviews/chat.ts:182` (handle `saveDraft` message, relay to chat-panel)
- Modify: `src/webviews/chat.ts:155` (send existing draft on init)
- Modify: `media/webview/chat.js` (debounced input listener + setDraft handler)
- Modify: `media/webview/chat-panel.js:267` (render draft in conversation list)
- Modify: `media/webview/chat-panel.css` (draft label style)

- [ ] **Step 1: Add draft storage to `chat-panel.ts`**

In `chat-panel.ts`, add to `ChatPanelWebviewProvider` class (after line 17):

```typescript
private _drafts = new Map<string, string>();

setDraft(conversationId: string, text: string): void {
  if (text.trim()) {
    this._drafts.set(conversationId, text);
  } else {
    this._drafts.delete(conversationId);
  }
  this.debouncedRefresh(); // update inbox to show/hide draft label
}

getDraft(conversationId: string): string {
  return this._drafts.get(conversationId) ?? "";
}

clearDraft(conversationId: string): void {
  this._drafts.delete(conversationId);
}
```

- [ ] **Step 2: Include drafts in `setData` payload**

In `chat-panel.ts`, modify the `postMessage` at line 123 to include drafts:

```typescript
// Change line 123-128 to:
this.view.webview.postMessage({
  type: "setData",
  friends,
  conversations: convData,
  currentUser: authManager.login,
  drafts: Object.fromEntries(this._drafts),
});
```

- [ ] **Step 3: Handle `saveDraft` in `chat.ts`**

In `chat.ts`, in `onMessage()` (line 182), add a new case:

```typescript
case "saveDraft": {
  const { conversationId, text } = msg.payload as { conversationId: string; text: string };
  const { chatPanelWebviewProvider: cp } = await import("./chat-panel");
  cp.setDraft(conversationId, text);
  break;
}
```

- [ ] **Step 4: Send existing draft on conversation open**

In `chat.ts`, in `loadData()`, after the `postMessage` at line 155, add:

```typescript
// After line 176 (end of postMessage), add:
const { chatPanelWebviewProvider: cp } = await import("./chat-panel");
const draft = cp.getDraft(this._conversationId);
if (draft) {
  this._panel.webview.postMessage({ type: "setDraft", text: draft });
}
```

- [ ] **Step 5: Clear draft on message send in `chat.ts`**

In `chat.ts`, in the `"send"` case handler (line 184), after successful send, add:

```typescript
// After the message is sent successfully:
const { chatPanelWebviewProvider: cp } = await import("./chat-panel");
cp.clearDraft(this._conversationId);
```

- [ ] **Step 6: Add debounced input listener in `chat.js`**

In `chat.js`, add after the existing input event listeners (near the input setup area):

```javascript
// Debounced draft saving
var draftTimer = null;
document.getElementById('messageInput').addEventListener('input', function() {
  clearTimeout(draftTimer);
  var text = this.value;
  draftTimer = setTimeout(function() {
    vscode.postMessage({ type: 'saveDraft', payload: { conversationId: currentConversationId, text: text } });
  }, 500);
});
```

- [ ] **Step 7: Handle `setDraft` message in `chat.js`**

In `chat.js`, in the message handler switch (line 150), add a case:

```javascript
case "setDraft": {
  var input = document.getElementById('messageInput');
  if (input && msg.text) {
    input.value = msg.text;
    input.focus();
  }
  break;
}
```

- [ ] **Step 8: Render draft in inbox conversation list**

In `chat-panel.js`, add `drafts` at **module scope** (near existing `var friends = []` and `var conversations = []` at top of file):

```javascript
// At module scope, near line 2-4:
var drafts = {};
```

Then in the `setData` handler (line 87-91), assign it:

```javascript
// Inside the setData handler, after conversations = ...:
drafts = data.drafts || {};
```

Then in `renderConversation()` (line 267), modify the preview line. Find where `preview` is rendered (line 307 area) and add draft check:

```javascript
// Before the preview line, add:
var draft = drafts[c.id] || "";
var previewHtml;
if (draft) {
  previewHtml = '<div class="conv-preview gs-text-sm gs-truncate"><span class="draft-label">Draft: </span>' + escapeHtml(draft.slice(0, 60)) + '</div>';
} else {
  previewHtml = '<div class="conv-preview gs-text-sm gs-text-muted gs-truncate">' + escapeHtml(preview.slice(0, 80)) + '</div>';
}
// Use previewHtml instead of the original preview div
```

- [ ] **Step 9: Add draft label CSS**

In `chat-panel.css`, add:

```css
.draft-label {
  color: var(--vscode-errorForeground, #f44);
  font-weight: 600;
}
```

- [ ] **Step 10: Test manually**

1. Open a conversation, type some text (don't send)
2. Switch to another conversation
3. Check inbox → should show "Draft: ..." in red on the first conversation
4. Go back to first conversation → input should be restored with draft text
5. Send the message → draft disappears from inbox
6. Type and clear all text → draft disappears from inbox

- [ ] **Step 11: Build and verify no type errors**

```bash
npm run check-types
```

- [ ] **Step 12: Commit**

```bash
git add src/webviews/chat-panel.ts src/webviews/chat.ts media/webview/chat.js media/webview/chat-panel.js media/webview/chat-panel.css
git commit -m "feat(chat): draft indicator — save/restore input + show in inbox"
```

---

### Task 4: Keyboard Shortcuts

**Files:**
- Modify: `media/webview/chat.js` (add keydown handler + hover tracking)
- Modify: `media/webview/chat.css` (optional: hover highlight for active target)

- [ ] **Step 1: Add hover tracking on message rows**

In `chat.js`, add at the IIFE top-level scope (after the scroll listener area):

**NOTE:** The element with `data-msg-id-block` is `.message`, NOT `.msg-row`. The `.msg-row` is an inner div without data attributes. Use `.message` for hover tracking.

```javascript
// Track last hovered message for keyboard shortcuts
var lastHoveredMsgId = null;
var lastHoveredMsgEl = null;

document.getElementById('messages').addEventListener('mouseover', function(e) {
  var row = e.target.closest('.message');
  if (row && row.dataset.msgIdBlock) {
    lastHoveredMsgId = row.dataset.msgIdBlock;
    lastHoveredMsgEl = row;
  }
});

document.getElementById('messages').addEventListener('mouseout', function(e) {
  var row = e.target.closest('.message');
  if (row) {
    lastHoveredMsgId = null;
    lastHoveredMsgEl = null;
  }
});
```

- [ ] **Step 2: Add keydown handler**

In `chat.js`, add after hover tracking:

```javascript
document.addEventListener('keydown', function(e) {
  var key = e.key.toLowerCase();

  // Escape — cancel reply/edit mode (works regardless of hover/focus state)
  if (key === 'escape') {
    if (typeof cancelReply === 'function') { cancelReply(); }
    return;
  }

  // Skip if user is typing in input
  var input = document.getElementById('messageInput');
  if (document.activeElement === input) return;
  // Skip if any other input/textarea is focused
  if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) return;
  // Skip if no message is hovered
  if (!lastHoveredMsgId || !lastHoveredMsgEl) return;

  if (key === 'r') {
    e.preventDefault();
    // Extract sender and text from DOM
    var senderEl = lastHoveredMsgEl.querySelector('.msg-sender');
    var textEl = lastHoveredMsgEl.querySelector('.msg-text');
    var sender = senderEl ? senderEl.textContent : '';
    var text = textEl ? textEl.textContent : '';
    startReply(lastHoveredMsgId, sender, text.slice(0, 100));
  }

  if (key === 'e') {
    e.preventDefault();
    // Check if it's own message
    if (!lastHoveredMsgEl.classList.contains('outgoing')) return;
    // Check 15-minute edit window
    var timeEl = lastHoveredMsgEl.querySelector('.meta');
    var createdAt = lastHoveredMsgEl.dataset.createdAt;
    if (createdAt) {
      var msgTime = new Date(createdAt).getTime();
      if (Date.now() - msgTime > 15 * 60 * 1000) {
        vscode.postMessage({ type: 'showInfoMessage', text: 'Messages older than 15 minutes cannot be edited.' });
        return;
      }
    }
    var editTextEl = lastHoveredMsgEl.querySelector('.msg-text');
    var currentText = editTextEl ? editTextEl.textContent : '';
    doEditMessage(lastHoveredMsgId, currentText, lastHoveredMsgEl);
  }
});
```

- [ ] **Step 3: Verify `data-created-at` exists on message rows**

Check if `.message` elements have a `data-created-at` attribute. If not, add it in the message rendering function (`renderMessages()` at line 477). Find where `data-msg-id-block` is set on the `.message` element and add:

```javascript
// In the message HTML template, on the .message element (same element that has data-msg-id-block):
' data-created-at="' + escapeHtml(msg.created_at || '') + '"'
```

- [ ] **Step 4: Test manually**

1. Open a conversation with messages
2. Hover over someone else's message, press `R` → should activate reply mode
3. Hover over your own recent message, press `E` → should activate edit mode
4. Hover over your own old message (>15min), press `E` → should show info toast
5. While typing in input, press `R` or `E` → should do nothing (not intercept)
6. Move mouse away from messages, press `R` → should do nothing

- [ ] **Step 5: Commit**

```bash
git add media/webview/chat.js
git commit -m "feat(chat): keyboard shortcuts — R to reply, E to edit hovered message"
```

---

### Task 5: Pinned Messages List View

**Files:**
- Modify: `media/webview/chat.js:667-707` (add list toggle to pin banner)
- Modify: `media/webview/chat.css:1096-1124` (add pinned list panel styles)

- [ ] **Step 1: Add pinned list panel HTML and render function**

In `chat.js`, add after `renderPinnedBanner()` (after line 707):

```javascript
function renderPinnedList() {
  var existing = document.getElementById('pinned-list-panel');
  if (existing) { existing.remove(); }

  if (!pinnedMessages.length) return;

  var panel = document.createElement('div');
  panel.id = 'pinned-list-panel';
  panel.className = 'pinned-list-panel';

  var headerHtml = '<div class="pinned-list-header">' +
    '<span class="pinned-list-title">Pinned Messages (' + pinnedMessages.length + ')</span>' +
    '<button class="gs-btn-icon" id="close-pinned-list" title="Close"><span class="codicon codicon-close"></span></button>' +
    '</div>';

  var itemsHtml = pinnedMessages.map(function(pin) {
    var msgId = pin.messageId || pin.id || (pin.message && (pin.message.id || pin.message.messageId));
    var sender = pin.senderName || pin.sender_name || (pin.message && (pin.message.senderName || pin.message.sender_name)) || 'Unknown';
    var text = pin.text || pin.body || (pin.message && (pin.message.body || pin.message.text || pin.message.content)) || '';
    var time = pin.created_at || pin.pinned_at || (pin.message && pin.message.created_at) || '';
    var timeStr = time ? timeAgo(time) : '';

    return '<div class="pinned-list-item" data-msg-id="' + escapeHtml(msgId || '') + '">' +
      '<div class="pinned-list-item-content">' +
        '<div class="pinned-list-item-header">' +
          '<span class="pinned-list-sender">' + escapeHtml(sender) + '</span>' +
          '<span class="pinned-list-time gs-text-muted">' + escapeHtml(timeStr) + '</span>' +
        '</div>' +
        '<div class="pinned-list-text gs-text-muted">' + escapeHtml(text.slice(0, 100)) + '</div>' +
      '</div>' +
      '<button class="gs-btn-icon pinned-list-unpin" data-msg-id="' + escapeHtml(msgId || '') + '" title="Unpin">' +
        '<span class="codicon codicon-pinned"></span>' +
      '</button>' +
    '</div>';
  }).join('');

  panel.innerHTML = headerHtml + '<div class="pinned-list-items">' + itemsHtml + '</div>';

  // Insert after pinned banner
  var banner = document.querySelector('.pinned-banner');
  if (banner) {
    banner.parentNode.insertBefore(panel, banner.nextSibling);
  }

  // Event listeners
  panel.querySelector('#close-pinned-list').addEventListener('click', function() {
    panel.remove();
  });

  panel.querySelectorAll('.pinned-list-item').forEach(function(item) {
    item.addEventListener('click', function() {
      var msgId = item.dataset.msgId;
      if (msgId) { jumpToMessageById(msgId); }
      panel.remove();
    });
  });

  panel.querySelectorAll('.pinned-list-unpin').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      var msgId = btn.dataset.msgId;
      if (msgId) {
        vscode.postMessage({ type: 'unpinMessage', messageId: msgId });
      }
    });
  });

  // Close on outside click
  setTimeout(function() {
    document.addEventListener('click', function closePanel(e) {
      if (!panel.contains(e.target) && !e.target.closest('.pinned-banner')) {
        panel.remove();
        document.removeEventListener('click', closePanel);
      }
    });
  }, 0);
}
```

- [ ] **Step 2: Add toggle trigger to pin banner**

In `renderPinnedBanner()` (line 667), find where the banner counter/label is rendered. Add a click handler to toggle the list:

```javascript
// After the banner is rendered, add click handler on the counter/label:
var counterEl = bannerEl.querySelector('.pinned-counter') || bannerEl.querySelector('.pinned-label');
if (counterEl) {
  counterEl.style.cursor = 'pointer';
  counterEl.addEventListener('click', function(e) {
    e.stopPropagation();
    var existing = document.getElementById('pinned-list-panel');
    if (existing) {
      existing.remove();
    } else {
      renderPinnedList();
    }
  });
}
```

- [ ] **Step 3: Add CSS styles**

In `chat.css`, add after the `.pinned-banner` styles (after line 1124):

```css
/* Pinned messages list panel */
.pinned-list-panel {
  background: var(--vscode-editor-background);
  border-bottom: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.3));
  max-height: 50vh;
  overflow-y: auto;
  z-index: 5;
}
.pinned-list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.2));
}
.pinned-list-title {
  font-weight: 600;
  font-size: 12px;
}
.pinned-list-items {
  padding: 4px 0;
}
.pinned-list-item {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  gap: 8px;
  cursor: pointer;
  transition: background 0.15s;
}
.pinned-list-item:hover {
  background: var(--vscode-list-hoverBackground);
}
.pinned-list-item-content {
  flex: 1;
  min-width: 0;
}
.pinned-list-item-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 2px;
}
.pinned-list-sender {
  font-weight: 600;
  font-size: 12px;
}
.pinned-list-time {
  font-size: 10px;
}
.pinned-list-text {
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pinned-list-unpin {
  opacity: 0;
  transition: opacity 0.15s;
}
.pinned-list-item:hover .pinned-list-unpin {
  opacity: 1;
}
```

- [ ] **Step 4: Test manually**

1. Open a conversation with pinned messages
2. Click the pin counter on the banner → list panel should slide open
3. Verify all pinned messages show with sender, preview, timestamp
4. Click a pinned message → should jump to it in chat + panel closes
5. Hover over item → unpin button appears
6. Click unpin → message unpins, list updates
7. Click outside panel → panel closes
8. Click counter again → panel toggles

- [ ] **Step 5: Commit**

```bash
git add media/webview/chat.js media/webview/chat.css
git commit -m "feat(chat): pinned messages list view — expandable panel from banner"
```

---

### Task 6: Final Build & Integration Test

- [ ] **Step 1: Run full build**

```bash
npm run compile
```

Expected: 0 errors (warnings in test file are ok).

- [ ] **Step 2: Full integration test**

Open Extension Development Host (F5) and verify all 5 features work together:

1. Scroll-to-bottom button shows/hides correctly
2. New messages divider appears on unread conversations
3. Draft saves across conversations and shows in inbox
4. R/E keyboard shortcuts work on hovered messages
5. Pinned messages list opens/closes from banner

- [ ] **Step 3: Verify no regressions**

Check existing features still work:
- Send/receive messages
- Reply/quote (click quote block → jump)
- Reactions (add/remove)
- Forward message
- Pin/unpin from floating bar
- Group info panel
- Typing indicator
- File attachments

- [ ] **Step 4: Final commit if any fixups needed**

```bash
git add -A
git commit -m "fix(chat): phase 1 integration fixups"
```
