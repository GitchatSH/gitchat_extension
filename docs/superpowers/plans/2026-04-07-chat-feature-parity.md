# Chat Feature Parity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring VS Code extension chat to full feature parity with the Gitchat web app across 10 features.

**Architecture:** All changes are confined to 3 files: `media/webview/chat.js` (webview JS), `media/webview/chat.css` (webview styles), and `src/webviews/chat.ts` (extension-side message handler). New CSS uses `--gs-*` tokens from `shared.css` (which must be linked in the webview HTML). No new files, no new npm dependencies.

**Tech Stack:** VS Code Webview API, vanilla JS (IIFE), Codicons, `--gs-*` design tokens, Mocha tests for pure functions.

**Constraint:** All colors must use `--gs-*` tokens. All icons must be Codicons. No `confirm()`/`alert()`/`prompt()` in webview.

---

## Pre-flight: Create branch

- [ ] `cd /Users/slugmacro/Desktop/projects/top-github-trending-repo-and-people && git checkout -b feat/chat-feature-parity`

---

## Task 1: Link shared.css + CSS foundation tokens

**Files:**
- Modify: `src/webviews/chat.ts` (getHtml method, ~line 620)
- Modify: `media/webview/chat.css` (prepend to file)

- [ ] **Step 1: Add shared.css link to chat webview HTML**

In `src/webviews/chat.ts`, find `getHtml()`. Add shared.css link alongside chat.css:

```typescript
const sharedCss = getUri(webview, this._extensionUri, ["media", "webview", "shared.css"]);
// In return string, add: <link href="${sharedCss}" rel="stylesheet">
```

Full change — in the return template string, add after the existing `<link href="${codiconCss}" rel="stylesheet">`:
```
<link href="${sharedCss}" rel="stylesheet">
```

- [ ] **Step 2: Add z-index tokens and foundation CSS to chat.css**

Prepend to `media/webview/chat.css`:
```css
:root {
  --z-msg-bar: 10;
  --z-picker: 20;
  --z-modal: 100;
}
```

- [ ] **Step 3: Add flash highlight animation to chat.css**

```css
.msg-highlight {
  animation: gs-flash 1.5s ease forwards;
}
@keyframes gs-flash {
  0%   { background: var(--gs-active); }
  100% { background: transparent; }
}
@media (prefers-reduced-motion: reduce) {
  .msg-highlight { animation: none; outline: 2px solid var(--gs-link); }
}
```

- [ ] **Step 4: Build and verify no errors**

```bash
cd /Users/slugmacro/Desktop/projects/top-github-trending-repo-and-people && npm run compile 2>&1 | tail -20
```
Expected: clean compile.

- [ ] **Step 5: Commit**

```bash
git add src/webviews/chat.ts media/webview/chat.css
git commit -m "feat(chat): link shared.css + add z-index tokens and flash highlight CSS"
```

---

## Task 2: Message grouping + date separators

**Files:**
- Modify: `media/webview/chat.js` — add `groupMessages()`, update `renderMessages()`, add `renderDateSeparator()`
- Modify: `media/webview/chat.css` — grouped bubble corner radii, date separator
- Create: `src/test/suite/chat-group-messages.test.ts` — unit tests for `groupMessages()`

- [ ] **Step 1: Write failing test for groupMessages() logic**

Create `src/test/suite/chat-group-messages.test.ts`:
```typescript
import * as assert from "assert";

// Mirror of groupMessages() from chat.js for testing
function groupMessages(messages: Array<{ id: string; sender_login: string; created_at: string; type?: string }>) {
  const toDateStr = (d: string) => new Date(d).toDateString();
  return messages.map((msg, i) => {
    const prev = messages[i - 1];
    const next = messages[i + 1];
    const newDay = !prev || toDateStr(msg.created_at) !== toDateStr(prev.created_at);
    const sameSender = prev && !newDay && prev.sender_login === msg.sender_login
      && (new Date(msg.created_at).getTime() - new Date(prev.created_at).getTime()) <= 120000;
    const nextBreaks = !next || toDateStr(next.created_at) !== toDateStr(msg.created_at)
      || next.sender_login !== msg.sender_login
      || (new Date(next.created_at).getTime() - new Date(msg.created_at).getTime()) > 120000;
    const isFirst = !sameSender;
    const isLast = nextBreaks || !next || next.sender_login !== msg.sender_login;
    let groupPosition: "single" | "first" | "middle" | "last" = "single";
    if (!isFirst && !isLast) groupPosition = "middle";
    else if (!isFirst) groupPosition = "last";
    else if (!isLast) groupPosition = "first";
    return { ...msg, showDateSeparator: newDay, groupPosition };
  });
}

suite("groupMessages", () => {
  test("single message is 'single'", () => {
    const msgs = [{ id: "1", sender_login: "hiru", created_at: "2026-04-07T10:00:00Z" }];
    const result = groupMessages(msgs);
    assert.strictEqual(result[0].groupPosition, "single");
    assert.strictEqual(result[0].showDateSeparator, true);
  });

  test("two messages same sender within 2min → first + last", () => {
    const msgs = [
      { id: "1", sender_login: "hiru", created_at: "2026-04-07T10:00:00Z" },
      { id: "2", sender_login: "hiru", created_at: "2026-04-07T10:01:00Z" },
    ];
    const result = groupMessages(msgs);
    assert.strictEqual(result[0].groupPosition, "first");
    assert.strictEqual(result[1].groupPosition, "last");
  });

  test("three messages same sender within 2min → first + middle + last", () => {
    const msgs = [
      { id: "1", sender_login: "hiru", created_at: "2026-04-07T10:00:00Z" },
      { id: "2", sender_login: "hiru", created_at: "2026-04-07T10:00:30Z" },
      { id: "3", sender_login: "hiru", created_at: "2026-04-07T10:01:00Z" },
    ];
    const result = groupMessages(msgs);
    assert.strictEqual(result[0].groupPosition, "first");
    assert.strictEqual(result[1].groupPosition, "middle");
    assert.strictEqual(result[2].groupPosition, "last");
  });

  test("messages > 2min apart → both single", () => {
    const msgs = [
      { id: "1", sender_login: "hiru", created_at: "2026-04-07T10:00:00Z" },
      { id: "2", sender_login: "hiru", created_at: "2026-04-07T10:03:00Z" },
    ];
    const result = groupMessages(msgs);
    assert.strictEqual(result[0].groupPosition, "single");
    assert.strictEqual(result[1].groupPosition, "single");
  });

  test("date boundary resets group", () => {
    const msgs = [
      { id: "1", sender_login: "hiru", created_at: "2026-04-06T23:59:00Z" },
      { id: "2", sender_login: "hiru", created_at: "2026-04-07T00:00:30Z" },
    ];
    const result = groupMessages(msgs);
    assert.strictEqual(result[0].groupPosition, "single");
    assert.strictEqual(result[1].groupPosition, "single");
    assert.strictEqual(result[1].showDateSeparator, true);
  });

  test("different senders → both single", () => {
    const msgs = [
      { id: "1", sender_login: "hiru", created_at: "2026-04-07T10:00:00Z" },
      { id: "2", sender_login: "slugmacro", created_at: "2026-04-07T10:00:30Z" },
    ];
    const result = groupMessages(msgs);
    assert.strictEqual(result[0].groupPosition, "single");
    assert.strictEqual(result[1].groupPosition, "single");
  });
});
```

- [ ] **Step 2: Run test to verify it fails (function not wired yet)**

```bash
cd /Users/slugmacro/Desktop/projects/top-github-trending-repo-and-people && npm test 2>&1 | tail -30
```
Expected: tests pass (the function is defined inline in the test file, so it tests the algorithm).

- [ ] **Step 3: Add groupMessages() to chat.js**

In `media/webview/chat.js`, after the `(function () {` IIFE opening and state variable declarations, add:

```js
function groupMessages(messages) {
  var toDateStr = function(d) { return new Date(d).toDateString(); };
  return messages.map(function(msg, i) {
    var prev = messages[i - 1];
    var next = messages[i + 1];
    var newDay = !prev || toDateStr(msg.created_at) !== toDateStr(prev.created_at);
    var sameSender = prev && !newDay && prev.sender_login === msg.sender_login
      && (new Date(msg.created_at) - new Date(prev.created_at)) <= 120000;
    var nextBreaks = !next || toDateStr(next.created_at) !== toDateStr(msg.created_at)
      || next.sender_login !== msg.sender_login
      || (new Date(next.created_at) - new Date(msg.created_at)) > 120000;
    var isFirst = !sameSender;
    var isLast = nextBreaks || !next || next.sender_login !== msg.sender_login;
    var groupPosition = 'single';
    if (!isFirst && !isLast) groupPosition = 'middle';
    else if (!isFirst) groupPosition = 'last';
    else if (!isLast) groupPosition = 'first';
    return Object.assign({}, msg, { showDateSeparator: newDay, groupPosition: groupPosition });
  });
}

function formatDateSeparator(isoDate) {
  var d = new Date(isoDate);
  var now = new Date();
  var today = now.toDateString();
  var yesterday = new Date(now - 86400000).toDateString();
  if (d.toDateString() === today) return 'Today';
  if (d.toDateString() === yesterday) return 'Yesterday';
  var opts = { month: 'long', day: 'numeric' };
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString(undefined, opts);
}
```

- [ ] **Step 4: Update renderMessages() to use groupMessages()**

Find the `renderMessages` function (~line 177) and update:
```js
function renderMessages(messages) {
  var seen = {};
  var unique = messages.filter(function(m) {
    if (!m.id || seen[m.id]) return false;
    seen[m.id] = true;
    return true;
  });
  var grouped = groupMessages(unique);
  var container = document.getElementById("messages");
  container.innerHTML = grouped.map(function(msg) {
    return (msg.showDateSeparator ? renderDateSeparator(msg.created_at) : '') + renderMessage(msg);
  }).join("");
  container.scrollTop = container.scrollHeight;
  bindSenderClicks(container);
  bindFloatingBarEvents(container);
}
```

- [ ] **Step 5: Add renderDateSeparator() to chat.js**

```js
function renderDateSeparator(isoDate) {
  return '<div class="date-separator"><span class="date-separator-label">' +
    escapeHtml(formatDateSeparator(isoDate)) +
    '</span></div>';
}
```

- [ ] **Step 6: Update renderMessage() to use groupPosition**

In `renderMessage(msg)`, add `groupPosition` handling. Replace the existing class/border-radius assignment:

The function currently builds:
```js
return '<div class="message ' + cls + '" data-msg-id-block="..."...>'
```

Change to add `data-group` and `data-own` attributes:
```js
var isOwn = isMe; // already computed
var groupPos = msg.groupPosition || 'single';
var showAvatar = !isMe && (groupPos === 'first' || groupPos === 'single');
var showSenderName = showAvatar; // only show sender name on first/single
var showTimestamp = groupPos === 'single' || groupPos === 'last';

// Build senderHtml only for first/single
var senderHtml = showSenderName && (!isMe && (isGroup || sender))
  ? '<div class="msg-sender" data-login="' + escapeHtml(sender) + '">@' + escapeHtml(sender) + '</div>'
  : "";

// Avatar spacer for middle/last incoming
var avatarArea = !isMe
  ? (showAvatar
    ? '<img class="msg-group-avatar gs-avatar gs-avatar-sm" src="https://github.com/' + encodeURIComponent(sender) + '.png?size=48" alt=""/>'
    : '<span class="msg-group-avatar-spacer"></span>')
  : "";

// Status only on last/single
var statusIcon = "";
if (isMe && showTimestamp) {
  var isSeen = otherReadAt && msg.created_at && msg.created_at <= otherReadAt;
  statusIcon = isSeen
    ? '<span class="msg-status seen" title="Seen">✓✓</span>'
    : '<span class="msg-status sent" title="Sent">✓</span>';
}

return '<div class="message ' + cls + ' msg-group-' + groupPos + '" ' +
  'data-msg-id-block="' + escapeHtml(String(msg.id)) + '" ' +
  'data-msg-id="' + escapeHtml(String(msg.id)) + '" ' +
  'data-sender="' + escapeHtml(sender) + '" ' +
  'data-own="' + (isMe ? 'true' : 'false') + '" ' +
  'data-type="' + escapeHtml(msg.type || 'message') + '">' +
  (isMe ? '' : '<div class="msg-row">' + avatarArea + '<div class="msg-bubble-col">') +
  senderHtml + replyHtml + attachments + textHtml +
  (reactions ? '<div class="reactions">' + reactions + '</div>' : '') +
  (showTimestamp ? '<div class="meta">' + time + (msg.edited_at ? " (edited)" : "") + ' ' + statusIcon + '</div>' : '') +
  (isMe ? '' : '</div></div>');
```

- [ ] **Step 7: Add CSS for grouped messages to chat.css**

```css
/* ── Message grouping ── */
.msg-row { display: flex; align-items: flex-end; gap: 6px; }
.msg-bubble-col { display: flex; flex-direction: column; min-width: 0; }
.msg-group-avatar { width: 24px; height: 24px; border-radius: var(--gs-radius-full); flex-shrink: 0; }
.msg-group-avatar-spacer { width: 24px; flex-shrink: 0; display: inline-block; }

/* Grouped bubble gap: 2px within group, 8px between groups */
.message.msg-group-first,
.message.msg-group-single { margin-top: 8px; }
.message.msg-group-middle,
.message.msg-group-last { margin-top: 2px; }

/* Incoming corner radius by position */
.message.incoming.msg-group-single { border-radius: var(--gs-radius-pill); }
.message.incoming.msg-group-first { border-bottom-left-radius: 2px; }
.message.incoming.msg-group-middle { border-top-left-radius: 2px; border-bottom-left-radius: 2px; }
.message.incoming.msg-group-last { border-top-left-radius: 2px; }

/* Outgoing corner radius by position */
.message.outgoing.msg-group-single { border-radius: var(--gs-radius-pill); }
.message.outgoing.msg-group-first { border-bottom-right-radius: 2px; }
.message.outgoing.msg-group-middle { border-top-right-radius: 2px; border-bottom-right-radius: 2px; }
.message.outgoing.msg-group-last { border-top-right-radius: 2px; }

/* Date separator */
.date-separator {
  display: flex; align-items: center; gap: 8px;
  margin: 12px 0; color: var(--gs-muted); font-size: var(--gs-font-xs);
}
.date-separator::before,
.date-separator::after {
  content: ''; flex: 1; height: 1px; background: var(--gs-divider);
}
.date-separator-label { white-space: nowrap; padding: 0 4px; }
```

- [ ] **Step 8: Run compile**

```bash
cd /Users/slugmacro/Desktop/projects/top-github-trending-repo-and-people && npm run compile 2>&1 | tail -20
```
Expected: clean compile.

- [ ] **Step 9: Commit**

```bash
git add media/webview/chat.js media/webview/chat.css src/test/suite/chat-group-messages.test.ts
git commit -m "feat(chat): message grouping (Telegram-style) + date separators"
```

---

## Task 3: Hover floating action bar

**Files:**
- Modify: `media/webview/chat.js` — remove old reaction picker, add floating bar JS
- Modify: `media/webview/chat.css` — floating bar styles

The existing `createReactionPicker`/`showReactionPicker`/`hideReactionPicker` + mouseover/mouseout event delegation implements a similar concept but with different layout/content. Replace it with the spec's floating bar.

- [ ] **Step 1: Remove old reaction picker code from chat.js**

Delete the following sections from `media/webview/chat.js`:
- The `QUICK_REACTIONS` constant
- `createReactionPicker()` function
- `showReactionPicker()` function
- `hideReactionPicker()` function
- The `messagesContainer.addEventListener("mouseover", ...)` and `messagesContainer.addEventListener("mouseout", ...)` block for the reaction picker (~lines 1027–1160)

Keep everything else (mention dropdown, header menu, group info panel).

- [ ] **Step 2: Add floating bar HTML inside renderMessage()**

Inside `renderMessage()`, build the floating bar HTML. Place it as the first child of the message wrapper div:

```js
// Floating action bar (hidden by default, shown on hover via JS)
var isSystem = msg.type === 'system';
var floatingBar = '';
if (!isSystem) {
  var barBtns = '';
  barBtns += '<button class="fbar-btn" data-action="react" aria-label="React"><i class="codicon codicon-smiley"></i></button>';
  barBtns += '<button class="fbar-btn" data-action="reply" aria-label="Reply"><i class="codicon codicon-reply"></i></button>';
  barBtns += '<button class="fbar-btn" data-action="copy" aria-label="Copy"><i class="codicon codicon-copy"></i></button>';
  barBtns += '<button class="fbar-btn" data-action="pin" aria-label="Pin"><i class="codicon codicon-pin"></i></button>';
  barBtns += '<button class="fbar-btn fbar-more-btn" data-action="more" aria-label="More"><i class="codicon codicon-ellipsis"></i></button>';
  var barPos = isMe ? 'fbar-outgoing' : 'fbar-incoming';
  floatingBar = '<div class="msg-floating-bar ' + barPos + '" role="toolbar" aria-label="Message actions">' + barBtns + '</div>';
}

return '<div class="message ' + cls + ' msg-group-' + groupPos + '" ...>' +
  floatingBar +   // ← add before senderHtml
  ...rest
```

- [ ] **Step 3: Add `bindFloatingBarEvents()` to chat.js**

```js
var _hideTimers = new WeakMap();

function bindFloatingBarEvents(container) {
  container.querySelectorAll('.message[data-msg-id]').forEach(function(msgEl) {
    if (msgEl.dataset.fbarBound) return;
    msgEl.dataset.fbarBound = '1';
    var bar = msgEl.querySelector('.msg-floating-bar');
    if (!bar) return;

    function showBar() {
      clearTimeout(_hideTimers.get(msgEl));
      bar.classList.add('fbar-visible');
    }
    function scheduleHide() {
      _hideTimers.set(msgEl, setTimeout(function() { bar.classList.remove('fbar-visible'); }, 150));
    }

    msgEl.addEventListener('mouseenter', showBar);
    msgEl.addEventListener('mouseleave', scheduleHide);
    bar.addEventListener('mouseenter', function() { clearTimeout(_hideTimers.get(msgEl)); });
    bar.addEventListener('mouseleave', scheduleHide);
  });
}
```

Call `bindFloatingBarEvents(container)` at the end of `renderMessages()` and `appendMessage()`.

- [ ] **Step 4: Add floating bar click handler (event delegation on messages container)**

```js
document.getElementById('messages').addEventListener('click', function(e) {
  var btn = e.target.closest('.fbar-btn');
  if (!btn) return;
  var msgEl = btn.closest('.message');
  if (!msgEl) return;
  var msgId = msgEl.dataset.msgId;
  var action = btn.dataset.action;
  var isOwn = msgEl.dataset.own === 'true';
  var textEl = msgEl.querySelector('.msg-text');
  var text = textEl ? textEl.textContent.trim() : '';

  if (action === 'react') {
    openEmojiPicker(btn, msgId);
  } else if (action === 'reply') {
    var sender = msgEl.dataset.sender || '';
    startReply(msgId, sender, text.slice(0, 100));
  } else if (action === 'copy') {
    doCopy(btn, text);
  } else if (action === 'pin') {
    if (msgEl.dataset.type === 'system') return;
    vscode.postMessage({ type: 'pinMessage', payload: { messageId: msgId } });
  } else if (action === 'more') {
    openMoreDropdown(btn, msgId, isOwn, text, msgEl);
  }
});
```

- [ ] **Step 5: Add openMoreDropdown() to chat.js**

```js
var _currentMoreDropdown = null;

function openMoreDropdown(btn, msgId, isOwn, text, msgEl) {
  if (_currentMoreDropdown) { _currentMoreDropdown.remove(); _currentMoreDropdown = null; }

  var menu = document.createElement('div');
  menu.className = 'more-dropdown';
  var items = '';
  items += '<button class="more-item" data-action="forward"><i class="codicon codicon-export"></i> Forward</button>';
  if (isOwn) {
    var createdAt = msgEl.dataset.createdAt ? new Date(msgEl.dataset.createdAt) : null;
    var canEdit = !createdAt || (Date.now() - createdAt.getTime() < 15 * 60 * 1000);
    if (canEdit) {
      items += '<button class="more-item" data-action="edit"><i class="codicon codicon-edit"></i> Edit</button>';
    }
    items += '<button class="more-item" data-action="unsend"><i class="codicon codicon-discard"></i> Unsend</button>';
    items += '<button class="more-item more-item-danger" data-action="delete"><i class="codicon codicon-trash"></i> Delete for me</button>';
  }
  menu.innerHTML = items;

  // Position below the ••• button
  document.body.appendChild(menu);
  var rect = btn.getBoundingClientRect();
  menu.style.top = (rect.bottom + 4) + 'px';
  menu.style.left = Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8) + 'px';
  _currentMoreDropdown = menu;

  menu.addEventListener('click', function(e) {
    var item = e.target.closest('.more-item');
    if (!item) return;
    var act = item.dataset.action;
    menu.remove(); _currentMoreDropdown = null;
    if (act === 'forward') { openForwardModal(msgId, text); }
    else if (act === 'edit') { doEditMessage(msgId, text, msgEl); }
    else if (act === 'unsend') { doUnsend(msgId, msgEl); }
    else if (act === 'delete') { doDelete(msgId, msgEl); }
  });

  setTimeout(function() {
    document.addEventListener('click', function closeDrop(ev) {
      if (!menu.contains(ev.target)) { menu.remove(); _currentMoreDropdown = null; document.removeEventListener('click', closeDrop); }
    });
  }, 0);
}
```

Note: `openEmojiPicker`, `openForwardModal`, `doEditMessage`, `doUnsend`, `doDelete`, `doCopy` are stubs — implemented in later tasks.

- [ ] **Step 6: Add floating bar CSS to chat.css**

```css
/* ── Floating action bar ── */
.msg-floating-bar {
  position: absolute;
  top: -36px;
  display: flex; align-items: center; gap: 2px;
  background: var(--gs-bg-secondary);
  border: 1px solid var(--gs-border);
  border-radius: var(--gs-radius-sm);
  padding: 2px;
  box-shadow: var(--gs-shadow-sm);
  z-index: var(--z-msg-bar);
  opacity: 0; pointer-events: none;
  transition: opacity var(--gs-duration) ease;
}
.msg-floating-bar.fbar-visible { opacity: 1; pointer-events: auto; }
.msg-floating-bar.fbar-outgoing { right: 0; }
.msg-floating-bar.fbar-incoming { left: 0; }

.fbar-btn {
  display: flex; align-items: center; justify-content: center;
  width: 28px; height: 28px;
  background: transparent; border: none; cursor: pointer;
  border-radius: var(--gs-radius-xs);
  color: var(--gs-muted); font-size: 14px;
}
.fbar-btn:hover { background: var(--gs-hover); color: var(--gs-fg); }

/* Ensure message wrapper has position:relative for bar positioning */
.message { position: relative; }

/* More dropdown */
.more-dropdown {
  position: fixed;
  background: var(--gs-bg-secondary);
  border: 1px solid var(--gs-border);
  border-radius: var(--gs-radius-sm);
  box-shadow: var(--gs-shadow-md);
  z-index: var(--z-modal);
  min-width: 160px; padding: 4px;
}
.more-item {
  display: flex; align-items: center; gap: 8px;
  width: 100%; padding: 6px 10px;
  background: transparent; border: none; cursor: pointer;
  color: var(--gs-fg); font-size: var(--gs-font-sm);
  border-radius: var(--gs-radius-xs); text-align: left;
}
.more-item:hover { background: var(--gs-hover); }
.more-item-danger { color: var(--gs-error); }
```

- [ ] **Step 7: Compile**

```bash
cd /Users/slugmacro/Desktop/projects/top-github-trending-repo-and-people && npm run compile 2>&1 | tail -10
```

- [ ] **Step 8: Commit**

```bash
git add media/webview/chat.js media/webview/chat.css
git commit -m "feat(chat): replace reaction picker with spec floating action bar"
```

---

## Task 4: Copy + Animated typing dots

**Files:**
- Modify: `media/webview/chat.js`
- Modify: `media/webview/chat.css`

- [ ] **Step 1: Add doCopy() to chat.js**

```js
function doCopy(btn, text) {
  if (!text) return;
  navigator.clipboard.writeText(text).then(function() {
    var icon = btn.querySelector('i');
    if (icon) {
      icon.className = 'codicon codicon-check';
      setTimeout(function() { icon.className = 'codicon codicon-copy'; }, 1500);
    }
  });
}
```

- [ ] **Step 2: Refactor updateHeaderTyping() to use animated dots**

Find `updateHeaderTyping()` in chat.js. Replace the HTML string it builds:

```js
// Old:
var html = '<span class="header-typing-text">' + text + '<span class="header-typing-dots">...';

// New:
var html = '<span class="header-typing-indicator">' +
  '<span class="typing-label">' + text + '</span>' +
  '<span class="typing-dots" aria-hidden="true">' +
    '<span class="typing-dot"></span>' +
    '<span class="typing-dot"></span>' +
    '<span class="typing-dot"></span>' +
  '</span>' +
'</span>';
```

- [ ] **Step 3: Add animated typing CSS to chat.css**

```css
/* ── Animated typing dots ── */
@keyframes gs-typing-bounce {
  0%, 80%, 100% { transform: translateY(0); }
  40%            { transform: translateY(-4px); }
}
.typing-dot {
  width: 4px; height: 4px;
  border-radius: var(--gs-radius-full);
  background: var(--gs-muted);
  display: inline-block;
  margin: 0 1px;
  animation: gs-typing-bounce 1s infinite;
}
.typing-dot:nth-child(2) { animation-delay: 0.2s; }
.typing-dot:nth-child(3) { animation-delay: 0.4s; }
@media (prefers-reduced-motion: reduce) {
  .typing-dot { animation: none; opacity: 0.5; }
}
.header-typing-indicator { display: inline-flex; align-items: center; gap: 4px; }
.typing-dots { display: inline-flex; align-items: center; }
```

- [ ] **Step 4: Compile**

```bash
cd /Users/slugmacro/Desktop/projects/top-github-trending-repo-and-people && npm run compile 2>&1 | tail -10
```

- [ ] **Step 5: Commit**

```bash
git add media/webview/chat.js media/webview/chat.css
git commit -m "feat(chat): copy action + animated typing dots"
```

---

## Task 5: Edit message inline + Delete/Unsend refactor

**Files:**
- Modify: `media/webview/chat.js` — `doEditMessage()`, `doDelete()`, `doUnsend()`, custom confirm modal
- Modify: `media/webview/chat.css` — inline edit, confirm modal styles
- Modify: `src/webviews/chat.ts` — remove VS Code modal from deleteMessage, fix unsend to send placeholder response

- [ ] **Step 1: Remove VS Code confirm from deleteMessage in chat.ts**

Find the `case "deleteMessage":` handler (~line 417). Remove the `vscode.window.showWarningMessage` confirm. Make it call the API directly:

```typescript
case "deleteMessage": {
  const dp = msg.payload as { messageId: string };
  if (dp?.messageId) {
    try {
      await apiClient.deleteMessage(this._conversationId, dp.messageId);
      this._panel.webview.postMessage({ type: "messageDeleted", messageId: dp.messageId });
    } catch { vscode.window.showErrorMessage("Failed to delete message"); }
  }
  break;
}
```

- [ ] **Step 2: Fix unsendMessage in chat.ts to send placeholder response**

Find `case "unsendMessage":` (~line 430). Change `messageRemoved` to `messageUnsent`:

```typescript
case "unsendMessage": {
  const up = msg.payload as { messageId: string };
  if (up?.messageId) {
    try {
      await apiClient.unsendMessage(this._conversationId, up.messageId);
      this._panel.webview.postMessage({ type: "messageUnsent", messageId: up.messageId });
    } catch { vscode.window.showErrorMessage("Failed to unsend message"); }
  }
  break;
}
```

- [ ] **Step 3: Update webview message handler in chat.js**

In the `window.addEventListener("message", ...)` switch, change:
- `case "messageRemoved"` — keep for any legacy path, but also handle:
- Add `case "messageDeleted"`: replace with deleted placeholder
- Add `case "messageUnsent"`: replace with unsent placeholder

```js
case "messageDeleted": {
  var el = document.querySelector('[data-msg-id-block="' + msg.messageId + '"]');
  if (el) {
    el.innerHTML = '<span class="msg-placeholder msg-deleted">[This message was deleted]</span>';
  }
  break;
}
case "messageUnsent": {
  var el2 = document.querySelector('[data-msg-id-block="' + msg.messageId + '"]');
  if (el2) {
    el2.innerHTML = '<span class="msg-placeholder msg-unsent">[This message was unsent]</span>';
  }
  break;
}
```

- [ ] **Step 4: Add doDelete() and doUnsend() to chat.js**

```js
function doDelete(msgId, msgEl) {
  // No confirmation needed per spec
  vscode.postMessage({ type: 'deleteMessage', payload: { messageId: msgId } });
}

function showConfirmModal(opts) {
  // opts: { message, confirmLabel, onConfirm }
  var existing = document.querySelector('.confirm-modal-overlay');
  if (existing) existing.remove();

  var overlay = document.createElement('div');
  overlay.className = 'confirm-modal-overlay';
  overlay.innerHTML =
    '<div class="confirm-modal" role="dialog" aria-modal="true">' +
      '<div class="confirm-modal-body">' + escapeHtml(opts.message) + '</div>' +
      '<div class="confirm-modal-actions">' +
        '<button class="gs-btn gs-btn-primary confirm-ok">' + escapeHtml(opts.confirmLabel || 'Confirm') + '</button>' +
        '<button class="gs-btn gs-btn-secondary confirm-cancel">Cancel</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);

  overlay.querySelector('.confirm-ok').addEventListener('click', function() {
    overlay.remove(); opts.onConfirm();
  });
  overlay.querySelector('.confirm-cancel').addEventListener('click', function() { overlay.remove(); });
  overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', esc); }
  });
}

function doUnsend(msgId, msgEl) {
  showConfirmModal({
    message: 'Remove this message for everyone?',
    confirmLabel: 'Unsend',
    onConfirm: function() {
      vscode.postMessage({ type: 'unsendMessage', payload: { messageId: msgId } });
    }
  });
}
```

- [ ] **Step 5: Add doEditMessage() to chat.js**

```js
function doEditMessage(msgId, currentText, msgEl) {
  var textEl = msgEl.querySelector('.msg-text');
  if (!textEl) return;
  var originalHtml = textEl.innerHTML;

  var textarea = document.createElement('textarea');
  textarea.className = 'edit-textarea';
  textarea.value = currentText;
  var actions = document.createElement('div');
  actions.className = 'edit-actions';
  actions.innerHTML =
    '<button class="gs-btn gs-btn-primary edit-save">Save</button>' +
    '<button class="gs-btn gs-btn-secondary edit-cancel">Cancel</button>';

  textEl.innerHTML = '';
  textEl.appendChild(textarea);
  textEl.appendChild(actions);
  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);

  function save() {
    var newText = textarea.value.trim();
    if (newText && newText !== currentText) {
      vscode.postMessage({ type: 'editMessage', payload: { messageId: msgId, body: newText } });
    }
    textEl.innerHTML = originalHtml;
  }
  function cancel() { textEl.innerHTML = originalHtml; }

  actions.querySelector('.edit-save').addEventListener('click', save);
  actions.querySelector('.edit-cancel').addEventListener('click', cancel);
  textarea.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') cancel();
  });
}
```

- [ ] **Step 6: Add CSS for edit textarea, confirm modal, placeholders**

```css
/* ── Inline edit ── */
.edit-textarea {
  width: 100%; box-sizing: border-box;
  background: var(--gs-input-bg); color: var(--gs-input-fg);
  border: 1px solid var(--gs-input-border);
  border-radius: var(--gs-radius-sm);
  padding: 4px 8px; font-size: var(--gs-font-base);
  font-family: inherit; resize: vertical; min-height: 60px;
}
.edit-actions { display: flex; gap: 6px; margin-top: 6px; }

/* ── Message placeholders ── */
.msg-placeholder {
  font-style: italic;
  font-size: var(--gs-font-xs);
  color: var(--gs-muted);
  display: block;
  padding: 4px 0;
}

/* ── Confirm modal ── */
.confirm-modal-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.5);
  display: flex; align-items: center; justify-content: center;
  z-index: var(--z-modal);
}
.confirm-modal {
  background: var(--gs-bg-secondary);
  border: 1px solid var(--gs-border);
  border-radius: var(--gs-radius);
  padding: 20px 24px;
  min-width: 240px; max-width: 320px;
  box-shadow: var(--gs-shadow-lg);
}
.confirm-modal-body { font-size: var(--gs-font-base); margin-bottom: 16px; color: var(--gs-fg); }
.confirm-modal-actions { display: flex; gap: 8px; justify-content: flex-end; }
```

- [ ] **Step 7: Compile**

```bash
cd /Users/slugmacro/Desktop/projects/top-github-trending-repo-and-people && npm run compile 2>&1 | tail -10
```

- [ ] **Step 8: Commit**

```bash
git add media/webview/chat.js media/webview/chat.css src/webviews/chat.ts
git commit -m "feat(chat): inline edit, delete/unsend with placeholders, custom confirm modal"
```

---

## Task 6: Sending/Failed status + New messages badge

**Files:**
- Modify: `media/webview/chat.js`
- Modify: `media/webview/chat.css`

- [ ] **Step 1: Add sending status to sendMessage() in chat.js**

Wrap the `vscode.postMessage` call with an optimistic temp message. The temp message has a `_tempId` and `status: 'sending'`. When the real message arrives via `newMessage`, match and replace.

Add these state variables near the top:
```js
var _tempIdCounter = 0;
var _pendingTempIds = {}; // tempId → element
```

Modify `sendMessage()` — after clearing input, append a temp message:
```js
function sendMessage() {
  var content = input.value.trim();
  // ... existing guard checks ...

  var tempId = 'temp-' + (++_tempIdCounter);
  var tempMsg = {
    id: tempId,
    sender_login: currentUser,
    created_at: new Date().toISOString(),
    body: content,
    _temp: true,
    _status: 'sending',
    groupPosition: 'single',
  };

  var container = document.getElementById('messages');
  var tempHtml = renderTempMessage(tempMsg);
  container.insertAdjacentHTML('beforeend', tempHtml);
  container.scrollTop = container.scrollHeight;
  bindFloatingBarEvents(container);

  var payload = { content: content, _tempId: tempId };
  // ... attachments handling ...

  if (replyingTo) {
    payload.replyToId = replyingTo.id;
    vscode.postMessage({ type: 'reply', payload: payload });
    cancelReply();
  } else {
    vscode.postMessage({ type: 'send', payload: payload });
  }
  input.value = '';
  clearAllAttachments();
}
```

- [ ] **Step 2: Add renderTempMessage() to chat.js**

```js
function renderTempMessage(msg) {
  var time = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  var statusHtml = '<span class="msg-status sending" title="Sending"><i class="codicon codicon-loading codicon-modifier-spin"></i></span>';
  return '<div class="message outgoing msg-group-single" data-msg-id-block="' + escapeHtml(msg.id) + '" data-msg-id="' + escapeHtml(msg.id) + '" data-sender="' + escapeHtml(currentUser) + '" data-own="true" data-temp="true">' +
    '<div class="msg-floating-bar fbar-outgoing" role="toolbar"></div>' +
    '<div class="msg-text">' + highlightMentions(escapeHtml(msg.body || '')) + '</div>' +
    '<div class="meta">' + time + ' ' + statusHtml + '</div>' +
  '</div>';
}
```

- [ ] **Step 3: Handle newMessage replacing temp in chat.js**

In the `appendMessage()` function, check for pending temp messages:
```js
function appendMessage(message) {
  var container = document.getElementById('messages');
  var msgId = message.id || message.message_id;

  // Replace temp message if present
  var tempEl = container.querySelector('[data-temp="true"][data-sender="' + escapeHtml(currentUser) + '"]');
  if (tempEl && msgId) {
    // Replace temp with real message
    var grouped = groupMessages([message]);
    tempEl.outerHTML = renderMessage(grouped[0]);
    bindFloatingBarEvents(container);
    bindSenderClicks(container);
    return;
  }

  // Skip if already rendered
  if (msgId && container.querySelector('[data-msg-id-block="' + msgId + '"]')) return;
  if (msgId && container.querySelector('[data-msg-id="' + msgId + '"]')) return;

  // Check scroll position for new messages badge
  var distFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
  var grouped = groupMessages([message]);
  container.insertAdjacentHTML('beforeend', renderMessage(grouped[0]));
  bindFloatingBarEvents(container);
  bindSenderClicks(container);
  hideTyping();

  if (distFromBottom <= 100) {
    container.scrollTop = container.scrollHeight;
  } else {
    incrementNewMessagesBadge();
  }
}
```

- [ ] **Step 4: Add new messages badge to chat.js**

Add badge HTML dynamically when first needed:
```js
var _newMsgCount = 0;
var _newMsgBadge = null;

function getNewMsgBadge() {
  if (!_newMsgBadge) {
    _newMsgBadge = document.createElement('div');
    _newMsgBadge.className = 'new-msg-badge';
    _newMsgBadge.style.display = 'none';
    _newMsgBadge.innerHTML = '<i class="codicon codicon-arrow-down"></i> <span class="new-msg-count"></span>';
    document.querySelector('.chat-input').before(_newMsgBadge);
    _newMsgBadge.addEventListener('click', function() {
      var container = document.getElementById('messages');
      container.scrollTop = container.scrollHeight;
      clearNewMessagesBadge();
    });
    // Auto-hide when user scrolls to bottom
    document.getElementById('messages').addEventListener('scroll', function() {
      var c = document.getElementById('messages');
      if (c.scrollHeight - c.scrollTop - c.clientHeight <= 100) clearNewMessagesBadge();
    });
  }
  return _newMsgBadge;
}

function incrementNewMessagesBadge() {
  _newMsgCount++;
  var badge = getNewMsgBadge();
  badge.querySelector('.new-msg-count').textContent = _newMsgCount + ' new message' + (_newMsgCount > 1 ? 's' : '');
  badge.style.display = 'flex';
}

function clearNewMessagesBadge() {
  _newMsgCount = 0;
  if (_newMsgBadge) _newMsgBadge.style.display = 'none';
}
```

- [ ] **Step 5: Add CSS for sending status and new messages badge**

```css
/* ── Sending / failed status ── */
.msg-status.sending { opacity: 0.6; }
.msg-status.failed { color: var(--gs-error); cursor: pointer; }

/* ── New messages badge ── */
.new-msg-badge {
  display: flex; align-items: center; gap: 6px;
  margin: 4px auto;
  padding: 6px 14px;
  background: var(--gs-button-bg); color: var(--gs-button-fg);
  border-radius: var(--gs-radius-pill);
  font-size: var(--gs-font-sm);
  cursor: pointer; width: fit-content;
  box-shadow: var(--gs-shadow-sm);
}
.new-msg-badge:hover { opacity: 0.9; }
```

- [ ] **Step 6: Compile**

```bash
cd /Users/slugmacro/Desktop/projects/top-github-trending-repo-and-people && npm run compile 2>&1 | tail -10
```

- [ ] **Step 7: Commit**

```bash
git add media/webview/chat.js media/webview/chat.css
git commit -m "feat(chat): sending status indicator + new messages badge with auto-scroll"
```

---

## Task 7: Pin/Unpin with banner + TS refactor

**Files:**
- Modify: `media/webview/chat.js` — `initPinnedMessages`/`updatePinnedBanner` handlers, banner logic
- Modify: `media/webview/chat.css` — pinned banner
- Modify: `src/webviews/chat.ts` — update `pinMessage`/`unpinMessage` to return banner state

- [ ] **Step 1: Update pinMessage handler in chat.ts**

Replace the existing `case "pinMessage":` to fetch and return updated pinned list:

```typescript
case "pinMessage": {
  const pp = msg.payload as { messageId: string };
  if (pp?.messageId) {
    try {
      await apiClient.pinMessage(this._conversationId, pp.messageId);
      const pinned = await apiClient.getPinnedMessages(this._conversationId).catch(() => []);
      const pinnedMessages = (pinned as Array<Record<string, unknown>>).map(m => ({
        id: m.id,
        senderName: (m.sender as Record<string, string>)?.login || "",
        text: (m.body as string || m.content as string || "").slice(0, 100),
      }));
      this._panel.webview.postMessage({ type: "updatePinnedBanner", pinnedMessages });
    } catch { vscode.window.showErrorMessage("Failed to pin message"); }
  }
  break;
}
```

- [ ] **Step 2: Update unpinMessage handler in chat.ts similarly**

```typescript
case "unpinMessage": {
  const upp = msg.payload as { messageId: string };
  if (upp?.messageId) {
    try {
      await apiClient.unpinMessage(this._conversationId, upp.messageId);
      const pinned = await apiClient.getPinnedMessages(this._conversationId).catch(() => []);
      const pinnedMessages = (pinned as Array<Record<string, unknown>>).map(m => ({
        id: m.id,
        senderName: (m.sender as Record<string, string>)?.login || "",
        text: (m.body as string || m.content as string || "").slice(0, 100),
      }));
      this._panel.webview.postMessage({ type: "updatePinnedBanner", pinnedMessages });
    } catch { vscode.window.showErrorMessage("Failed to unpin message"); }
  }
  break;
}
```

Check if `apiClient.getPinnedMessages` exists — if not, add a stub call or use the existing API. Check `src/api.ts` for the API client methods.

- [ ] **Step 3: Check apiClient for getPinnedMessages**

```bash
grep -n "pinned\|PinnedMessage\|pin_message" /Users/slugmacro/Desktop/projects/top-github-trending-repo-and-people/src/api.ts | head -20
```

If `getPinnedMessages` doesn't exist, add it to the API client (see sub-step below).

- [ ] **Step 3a (if needed): Add getPinnedMessages to api.ts**

Find the existing `pinMessage`/`unpinMessage` methods in `src/api.ts`. Add nearby:
```typescript
async getPinnedMessages(conversationId: string): Promise<unknown[]> {
  const res = await this.client.get(`/messages/conversations/${conversationId}/pins`);
  return res.data?.pins || res.data || [];
}
```

- [ ] **Step 4: Add initPinnedMessages sending in loadData() in chat.ts**

In `loadData()`, after fetching messages, also fetch pinned messages:
```typescript
const pins = await apiClient.getPinnedMessages(this._conversationId).catch(() => []);
const pinnedMessages = (pins as Array<Record<string, unknown>>).map(m => ({
  id: m.id,
  senderName: (m.sender as Record<string, string>)?.login || "",
  text: (m.body as string || m.content as string || "").slice(0, 100),
}));
```

Add `pinnedMessages` to the `init` postMessage payload.

- [ ] **Step 5: Add pinned banner HTML and JS to chat.js**

Add these state variables:
```js
var pinnedMessages = []; // [{ id, senderName, text }]
var currentPinIndex = 0;
```

Handle in the `init` case:
```js
case "init":
  // ... existing ...
  pinnedMessages = msg.payload.pinnedMessages || [];
  currentPinIndex = 0;
  renderPinnedBanner();
  // ...
```

Handle `updatePinnedBanner`:
```js
case "updatePinnedBanner":
  pinnedMessages = msg.pinnedMessages || [];
  currentPinIndex = Math.min(currentPinIndex, Math.max(0, pinnedMessages.length - 1));
  renderPinnedBanner();
  break;
```

- [ ] **Step 6: Add renderPinnedBanner() to chat.js**

```js
function getPinnedBannerEl() {
  var el = document.getElementById('pinned-banner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'pinned-banner';
    el.className = 'pinned-banner';
    var header = document.getElementById('header');
    header.after(el);
  }
  return el;
}

function renderPinnedBanner() {
  var banner = getPinnedBannerEl();
  if (!pinnedMessages.length) {
    banner.style.display = 'none';
    return;
  }
  var pin = pinnedMessages[currentPinIndex];
  var preview = pin.text.length > 50 ? pin.text.slice(0, 50) + '…' : pin.text;
  var counter = pinnedMessages.length > 1
    ? '<span class="pinned-counter">#' + (currentPinIndex + 1) + ' of ' + pinnedMessages.length + '</span>'
    : '';
  banner.innerHTML =
    '<i class="codicon codicon-pin pinned-icon"></i>' +
    '<div class="pinned-text" data-pin-id="' + escapeHtml(String(pin.id)) + '">' +
      '<span class="pinned-preview">' + escapeHtml(preview) + '</span>' +
      counter +
    '</div>' +
    '<button class="pinned-unpin-btn" data-action="unpin" data-pin-id="' + escapeHtml(String(pin.id)) + '" aria-label="Unpin">' +
      '<i class="codicon codicon-pin"></i>' +
    '</button>';
  banner.style.display = 'flex';

  banner.querySelector('.pinned-text').addEventListener('click', function() {
    var msgEl = document.querySelector('[data-msg-id-block="' + escapeHtml(String(pin.id)) + '"]');
    if (msgEl) {
      msgEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      msgEl.classList.add('msg-highlight');
      setTimeout(function() { msgEl.classList.remove('msg-highlight'); }, 1500);
    }
    currentPinIndex = (currentPinIndex + 1) % pinnedMessages.length;
    renderPinnedBanner();
  });

  banner.querySelector('.pinned-unpin-btn').addEventListener('click', function(e) {
    e.stopPropagation();
    var pinId = e.currentTarget.dataset.pinId;
    vscode.postMessage({ type: 'unpinMessage', payload: { messageId: pinId } });
  });
}
```

- [ ] **Step 7: Add pinned banner CSS to chat.css**

```css
/* ── Pinned banner ── */
.pinned-banner {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 12px;
  background: var(--gs-bg-secondary);
  border-bottom: 1px solid var(--gs-border);
  cursor: pointer; flex-shrink: 0;
  font-size: var(--gs-font-xs);
}
.pinned-icon { color: var(--gs-link); flex-shrink: 0; }
.pinned-text { flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; }
.pinned-preview { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--gs-fg); }
.pinned-counter { color: var(--gs-muted); flex-shrink: 0; }
.pinned-unpin-btn {
  background: transparent; border: none; cursor: pointer;
  color: var(--gs-muted); padding: 2px 4px; border-radius: var(--gs-radius-xs);
  flex-shrink: 0;
}
.pinned-unpin-btn:hover { background: var(--gs-hover); color: var(--gs-error); }
```

- [ ] **Step 8: Compile**

```bash
cd /Users/slugmacro/Desktop/projects/top-github-trending-repo-and-people && npm run compile 2>&1 | tail -10
```

- [ ] **Step 9: Commit**

```bash
git add media/webview/chat.js media/webview/chat.css src/webviews/chat.ts src/api.ts
git commit -m "feat(chat): pin banner with cycling + unpin, TS returns banner state"
```

---

## Task 8: Reply/Quote refactor

**Files:**
- Modify: `media/webview/chat.js` — update `startReply()`, `showReplyBar()`, update quote block in `renderMessage()`
- Modify: `media/webview/chat.css` — reply bar and quote block styles

- [ ] **Step 1: Update showReplyBar() in chat.js**

The existing function and `startReply()` both exist. Consolidate into `startReply()` which is the one called from the floating bar:

```js
function startReply(msgId, sender, text) {
  replyingTo = { id: msgId, sender: sender, text: text.slice(0, 100) };
  var replyBar = document.getElementById('replyBar');
  if (!replyBar) {
    replyBar = document.createElement('div');
    replyBar.id = 'replyBar';
    replyBar.className = 'reply-bar';
    document.querySelector('.chat-input').before(replyBar);
  }
  replyBar.innerHTML =
    '<div class="reply-bar-content">' +
      '<i class="codicon codicon-reply reply-bar-icon"></i>' +
      '<div class="reply-bar-info">' +
        '<span class="reply-bar-sender">Reply to ' + escapeHtml(sender) + '</span>' +
        '<span class="reply-bar-text">' + escapeHtml(text.slice(0, 100)) + '</span>' +
      '</div>' +
    '</div>' +
    '<button class="reply-bar-close" id="replyClose" aria-label="Cancel reply">' +
      '<i class="codicon codicon-close"></i>' +
    '</button>';
  replyBar.style.display = 'flex';
  document.getElementById('replyClose').addEventListener('click', cancelReply);
  input.focus();
}
```

- [ ] **Step 2: Update quote block rendering in renderMessage()**

Find the existing `replyHtml` block:
```js
if (msg.reply_to_id && msg.reply) {
  // ...
}
```

Replace with:
```js
var replyHtml = '';
if (msg.reply_to_id && msg.reply) {
  var replyText = (msg.reply.body || msg.reply.content || '').slice(0, 100);
  var replySender = msg.reply.sender_login || msg.reply.sender || '';
  replyHtml =
    '<div class="quote-block" data-reply-id="' + escapeHtml(String(msg.reply_to_id)) + '" tabindex="0" role="button" aria-label="Jump to original message">' +
      '<span class="quote-sender">' + escapeHtml(replySender) + '</span>' +
      '<span class="quote-text">' + escapeHtml(replyText) + '</span>' +
    '</div>';
}
```

- [ ] **Step 3: Add quote block click handler (event delegation)**

```js
document.getElementById('messages').addEventListener('click', function(e) {
  var quoteEl = e.target.closest('.quote-block');
  if (!quoteEl) return;
  var replyId = quoteEl.dataset.replyId;
  var origEl = replyId ? document.querySelector('[data-msg-id-block="' + replyId + '"]') : null;
  if (origEl) {
    origEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    origEl.classList.add('msg-highlight');
    setTimeout(function() { origEl.classList.remove('msg-highlight'); }, 1500);
  } else {
    vscode.postMessage({ type: 'showInfoMessage', text: 'Original message is no longer available.' });
  }
});
```

- [ ] **Step 4: Add showInfoMessage handler to chat.ts**

```typescript
case "showInfoMessage": {
  const infoText = (msg as { text?: string }).text;
  if (infoText) { vscode.window.showInformationMessage(infoText); }
  break;
}
```

- [ ] **Step 5: Update reply bar and quote CSS in chat.css**

```css
/* ── Reply bar ── */
.reply-bar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 6px 12px;
  background: var(--gs-bg-secondary);
  border-left: 3px solid var(--gs-link);
  border-top: 1px solid var(--gs-border);
  gap: 8px;
}
.reply-bar-content { display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1; }
.reply-bar-icon { color: var(--gs-link); flex-shrink: 0; }
.reply-bar-info { display: flex; flex-direction: column; min-width: 0; }
.reply-bar-sender { font-size: var(--gs-font-xs); font-weight: 600; color: var(--gs-link); }
.reply-bar-text {
  font-size: var(--gs-font-xs); color: var(--gs-muted);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.reply-bar-close {
  background: transparent; border: none; cursor: pointer;
  color: var(--gs-muted); padding: 2px; border-radius: var(--gs-radius-xs);
  flex-shrink: 0;
}
.reply-bar-close:hover { background: var(--gs-hover); color: var(--gs-fg); }

/* ── Quote block ── */
.quote-block {
  border-left: 2px solid var(--gs-link);
  background: rgba(0,0,0,0.1);
  border-radius: var(--gs-radius-xs);
  padding: 4px 8px; margin-bottom: 6px;
  cursor: pointer;
}
.quote-block:hover { opacity: 0.8; }
.quote-sender {
  display: block;
  color: var(--gs-link); font-size: var(--gs-font-xs);
  font-weight: 600; margin-bottom: 2px;
}
.quote-text {
  display: block;
  font-size: var(--gs-font-xs); color: var(--gs-muted);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
```

- [ ] **Step 6: Compile**

```bash
cd /Users/slugmacro/Desktop/projects/top-github-trending-repo-and-people && npm run compile 2>&1 | tail -10
```

- [ ] **Step 7: Commit**

```bash
git add media/webview/chat.js media/webview/chat.css src/webviews/chat.ts
git commit -m "feat(chat): reply bar + quote block with jump-to-message highlight"
```

---

## Task 9: Emoji picker

**Files:**
- Modify: `media/webview/chat.js` — `EMOJIS` constant, `createEmojiPicker()`, `openEmojiPicker()`
- Modify: `media/webview/chat.css` — emoji picker styles

- [ ] **Step 1: Add EMOJIS constant to chat.js**

Add near top of IIFE (after state vars):
```js
var EMOJIS = [
  {e:'👍',n:'thumbs up',k:['like','good','yes','ok']},
  {e:'❤️',n:'red heart',k:['love','heart']},
  {e:'😂',n:'face with tears of joy',k:['laugh','lol','haha','funny']},
  {e:'🔥',n:'fire',k:['hot','lit','amazing']},
  {e:'😊',n:'smiling face',k:['smile','happy','pleased']},
  {e:'😍',n:'heart eyes',k:['love','adore']},
  {e:'🤔',n:'thinking face',k:['think','hmm','wonder']},
  {e:'😢',n:'crying face',k:['sad','cry','tears']},
  {e:'😮',n:'face with open mouth',k:['wow','surprised','omg']},
  {e:'🎉',n:'party popper',k:['celebrate','congrats','party']},
  {e:'💯',n:'hundred points',k:['perfect','100','score']},
  {e:'🚀',n:'rocket',k:['launch','fast','ship']},
  {e:'👀',n:'eyes',k:['look','see','watching']},
  {e:'🤣',n:'rolling on floor laughing',k:['laugh','lmao','rofl']},
  {e:'😭',n:'loudly crying',k:['cry','sob','sad']},
  {e:'🥺',n:'pleading face',k:['please','beg','puppy']},
  {e:'😤',n:'face with steam from nose',k:['angry','frustrated']},
  {e:'😎',n:'smiling face with sunglasses',k:['cool','awesome','chill']},
  {e:'🤯',n:'exploding head',k:['mindblown','wow','shocked']},
  {e:'😳',n:'flushed face',k:['embarrassed','shocked','blush']},
  {e:'🥳',n:'partying face',k:['celebrate','party','birthday']},
  {e:'😴',n:'sleeping face',k:['sleep','tired','zzz']},
  {e:'🤦',n:'face palm',k:['facepalm','ugh','sigh']},
  {e:'🤷',n:'shrug',k:['shrug','idk','whatever']},
  {e:'👏',n:'clapping hands',k:['clap','applause','bravo']},
  {e:'🙏',n:'folded hands',k:['pray','please','thank']},
  {e:'💪',n:'flexed biceps',k:['strong','muscle','power']},
  {e:'✨',n:'sparkles',k:['stars','magic','amazing']},
  {e:'💀',n:'skull',k:['dead','dying','skull']},
  {e:'😅',n:'grinning face with sweat',k:['nervous','relieved','phew']},
  {e:'🫡',n:'saluting face',k:['salute','respect']},
  {e:'🤌',n:'pinched fingers',k:['chef','kiss','perfect']},
  {e:'⚡',n:'high voltage',k:['lightning','fast','electric']},
  {e:'🎯',n:'bullseye',k:['target','goal','aim']},
  {e:'🏆',n:'trophy',k:['win','winner','champion']},
  {e:'💡',n:'light bulb',k:['idea','bright']},
  {e:'🔑',n:'key',k:['key','unlock','important']},
  {e:'💰',n:'money bag',k:['money','cash','rich']},
  {e:'🎁',n:'wrapped gift',k:['gift','present','surprise']},
  {e:'🍕',n:'pizza',k:['food','pizza']},
  {e:'🍺',n:'beer mug',k:['beer','drink','cheers']},
  {e:'☕',n:'hot beverage',k:['coffee','tea','drink']},
  {e:'🌙',n:'crescent moon',k:['moon','night','sleep']},
  {e:'⭐',n:'star',k:['star','favorite','good']},
  {e:'🌈',n:'rainbow',k:['rainbow','colorful','hope']},
  {e:'🔥',n:'fire',k:['fire','hot']},
  {e:'💣',n:'bomb',k:['bomb','explosion']},
  {e:'🎵',n:'musical note',k:['music','song','note']},
  {e:'🔔',n:'bell',k:['notification','bell','ring']},
  {e:'📌',n:'pushpin',k:['pin','mark','important']},
  {e:'✅',n:'check mark button',k:['done','check','complete']},
  {e:'❌',n:'cross mark',k:['no','wrong','cancel']},
  {e:'⚠️',n:'warning',k:['warning','caution','alert']},
  {e:'💬',n:'speech bubble',k:['chat','message','talk']},
  {e:'👋',n:'waving hand',k:['wave','hello','bye']},
  {e:'🤝',n:'handshake',k:['deal','agree','partner']},
  {e:'🫶',n:'heart hands',k:['love','care','support']},
  {e:'🤗',n:'hugging face',k:['hug','warm','friendly']},
  {e:'😌',n:'relieved face',k:['relieved','calm','peace']},
  {e:'🧐',n:'face with monocle',k:['curious','inspect','hmm']},
  {e:'🤓',n:'nerd face',k:['nerd','smart','geek']},
  {e:'👌',n:'ok hand',k:['ok','perfect','fine']},
  {e:'🤞',n:'crossed fingers',k:['luck','hope','wish']},
  {e:'👊',n:'oncoming fist',k:['punch','fist','bump']},
  {e:'🙌',n:'raising hands',k:['praise','celebrate','yeah']},
  {e:'🫂',n:'people hugging',k:['hug','comfort','support']},
  {e:'❤️‍🔥',n:'heart on fire',k:['love','passion']},
  {e:'💔',n:'broken heart',k:['heartbreak','sad','lost']},
  {e:'💙',n:'blue heart',k:['love','blue','calm']},
  {e:'💚',n:'green heart',k:['nature','health','love']},
  {e:'💜',n:'purple heart',k:['love','purple']},
  {e:'🖤',n:'black heart',k:['dark','love','aesthetic']},
  {e:'🤍',n:'white heart',k:['pure','love','clean']},
  {e:'🧡',n:'orange heart',k:['energy','warmth','love']},
  {e:'💛',n:'yellow heart',k:['happy','sunny','love']},
  {e:'🩷',n:'pink heart',k:['cute','love','pink']},
];
var QUICK_EMOJIS = ['👍','❤️','😂','🔥'];
```

- [ ] **Step 2: Add openEmojiPicker() to chat.js**

```js
var _currentEmojiPicker = null;
var _emojiPickerMsgId = null;

function openEmojiPicker(anchorBtn, msgId) {
  if (_currentEmojiPicker) { _currentEmojiPicker.remove(); _currentEmojiPicker = null; }

  _emojiPickerMsgId = msgId;
  var picker = document.createElement('div');
  picker.className = 'emoji-picker';

  // Quick reactions
  var quickHtml = QUICK_EMOJIS.map(function(e) {
    return '<button class="ep-quick" data-emoji="' + escapeHtml(e) + '" aria-label="' + escapeHtml(e) + '">' + e + '</button>';
  }).join('');

  // Search input
  var searchHtml = '<div class="ep-search-row"><input class="gs-input ep-search" placeholder="Search emojis..." /></div>';

  // Grid
  var gridHtml = '<div class="ep-grid">' +
    EMOJIS.map(function(item) {
      return '<button class="ep-emoji" data-emoji="' + escapeHtml(item.e) + '" title="' + escapeHtml(item.n) + '" aria-label="' + escapeHtml(item.n) + '">' + item.e + '</button>';
    }).join('') +
  '</div>';

  picker.innerHTML =
    '<div class="ep-quick-row">' + quickHtml + '</div>' +
    searchHtml +
    gridHtml;

  document.body.appendChild(picker);
  _currentEmojiPicker = picker;

  // Position
  var barRect = anchorBtn.closest('.msg-floating-bar').getBoundingClientRect();
  var ph = picker.offsetHeight || 260;
  if (barRect.top < 260) {
    picker.style.top = (barRect.bottom + 4) + 'px';
  } else {
    picker.style.top = (barRect.top - ph - 4) + 'px';
  }
  var msgEl = anchorBtn.closest('.message');
  var isOut = msgEl && msgEl.classList.contains('outgoing');
  if (isOut) {
    picker.style.right = (window.innerWidth - barRect.right) + 'px';
    picker.style.left = 'auto';
  } else {
    picker.style.left = Math.min(barRect.left, window.innerWidth - 240 - 8) + 'px';
  }

  // Search filter
  var searchInput = picker.querySelector('.ep-search');
  var grid = picker.querySelector('.ep-grid');
  searchInput.addEventListener('input', function() {
    var q = searchInput.value.toLowerCase();
    grid.querySelectorAll('.ep-emoji').forEach(function(btn) {
      var item = EMOJIS.find(function(i) { return i.e === btn.dataset.emoji; });
      if (!item) return;
      var matches = !q || item.n.includes(q) || item.k.some(function(k) { return k.includes(q); });
      btn.style.display = matches ? '' : 'none';
    });
  });

  // Click handlers
  function selectEmoji(emoji) {
    vscode.postMessage({ type: 'react', payload: { messageId: _emojiPickerMsgId, emoji: emoji } });
    addReactionToMessage(_emojiPickerMsgId, emoji);
    _currentEmojiPicker.remove(); _currentEmojiPicker = null;
  }
  picker.querySelectorAll('.ep-quick').forEach(function(btn) {
    btn.addEventListener('click', function() { selectEmoji(btn.dataset.emoji); });
  });
  picker.querySelectorAll('.ep-emoji').forEach(function(btn) {
    btn.addEventListener('click', function() { selectEmoji(btn.dataset.emoji); });
  });

  // Dismiss on outside click
  setTimeout(function() {
    document.addEventListener('click', function closePicker(e) {
      if (_currentEmojiPicker && !_currentEmojiPicker.contains(e.target)) {
        _currentEmojiPicker.remove(); _currentEmojiPicker = null;
        document.removeEventListener('click', closePicker);
      }
    });
  }, 0);

  // Escape key
  document.addEventListener('keydown', function escPicker(e) {
    if (e.key === 'Escape' && _currentEmojiPicker) {
      _currentEmojiPicker.remove(); _currentEmojiPicker = null;
      document.removeEventListener('keydown', escPicker);
    }
  });
}
```

- [ ] **Step 3: Add emoji picker CSS to chat.css**

```css
/* ── Emoji picker ── */
.emoji-picker {
  position: fixed;
  background: var(--gs-bg-secondary);
  border: 1px solid var(--gs-border);
  border-radius: var(--gs-radius);
  box-shadow: var(--gs-shadow-md);
  z-index: var(--z-picker);
  width: 240px; padding: 8px;
}
.ep-quick-row { display: flex; gap: 4px; margin-bottom: 8px; }
.ep-quick {
  flex: 1; background: var(--gs-hover); border: none; border-radius: var(--gs-radius-xs);
  font-size: 20px; cursor: pointer; padding: 4px;
}
.ep-quick:hover { transform: scale(1.15); }
.ep-search-row { margin-bottom: 8px; }
.ep-search { width: 100%; box-sizing: border-box; }
.ep-grid {
  display: grid; grid-template-columns: repeat(8, 1fr);
  gap: 2px; max-height: 160px; overflow-y: auto;
}
.ep-emoji {
  background: transparent; border: none; cursor: pointer;
  font-size: 16px; padding: 3px; border-radius: var(--gs-radius-xs);
  line-height: 1;
}
.ep-emoji:hover { background: var(--gs-hover); transform: scale(1.1); }
```

- [ ] **Step 4: Compile**

```bash
cd /Users/slugmacro/Desktop/projects/top-github-trending-repo-and-people && npm run compile 2>&1 | tail -10
```

- [ ] **Step 5: Commit**

```bash
git add media/webview/chat.js media/webview/chat.css
git commit -m "feat(chat): emoji picker with quick reactions + full searchable grid"
```

---

## Task 10: Link previews enhancement

**Files:**
- Modify: `media/webview/chat.js` — rate limiting, queue, URL cleaning, GitHub card, rename message types
- Modify: `media/webview/chat.css` — GitHub card styles
- Modify: `src/webviews/chat.ts` — rename `getLinkPreview` → `fetchLinkPreview`

- [ ] **Step 1: Update chat.ts handler to use new message type**

Find `case "getLinkPreview":` (~line 178) and rename to `"fetchLinkPreview"`. Also update the response type from `"linkPreview"` to `"linkPreviewResult"` and change payload structure:

```typescript
case "fetchLinkPreview": {
  const { url, messageId } = msg.payload as { url: string; messageId: string };
  try {
    const data = await apiClient.getLinkPreview(url);
    this._panel.webview.postMessage({ type: "linkPreviewResult", url, messageId, data });
  } catch {
    this._panel.webview.postMessage({ type: "linkPreviewResult", url, messageId, data: null });
  }
  break;
}
```

- [ ] **Step 2: Update fetchLinkPreview() in chat.js**

Add state vars:
```js
var linkPreviewCache = {};
var linkPreviewPending = {};
var linkPreviewQueue = [];
var MAX_CONCURRENT_PREVIEWS = 5;
```

Replace existing `fetchLinkPreview` function:
```js
function fetchLinkPreview(msgId, rawUrl) {
  var url = rawUrl.replace(/[.,;:)!?]+$/, '');
  if (linkPreviewCache[url]) {
    renderLinkPreview(msgId, url, linkPreviewCache[url]);
    return;
  }
  if (linkPreviewPending[url]) return; // already in-flight

  if (Object.keys(linkPreviewPending).length >= MAX_CONCURRENT_PREVIEWS) {
    linkPreviewQueue.push({ msgId: msgId, url: url });
    return;
  }

  linkPreviewPending[url] = true;
  vscode.postMessage({ type: 'fetchLinkPreview', payload: { url: url, messageId: msgId } });
}

function drainLinkPreviewQueue() {
  while (linkPreviewQueue.length > 0 && Object.keys(linkPreviewPending).length < MAX_CONCURRENT_PREVIEWS) {
    var next = linkPreviewQueue.shift();
    fetchLinkPreview(next.msgId, next.url);
  }
}
```

- [ ] **Step 3: Update linkPreviewResult handler in chat.js message listener**

Replace the existing `case "linkPreview":` in the switch:
```js
case "linkPreviewResult": {
  var url = msg.url;
  var data = msg.data;
  delete linkPreviewPending[url];
  if (data) { linkPreviewCache[url] = data; }
  var msgEl = document.querySelector('[data-msg-id-block="' + escapeHtml(String(msg.messageId)) + '"]');
  if (msgEl && data) { appendLinkPreviewCard(msgEl, url, data); }
  drainLinkPreviewQueue();
  break;
}
```

- [ ] **Step 4: Update renderLinkPreview() → appendLinkPreviewCard()**

```js
function appendLinkPreviewCard(msgEl, url, data) {
  if (msgEl.querySelector('.link-preview-card')) return; // already appended

  var isGitHub = url.includes('github.com');
  var html;
  if (isGitHub && data.title) {
    html = '<div class="link-preview-card link-preview-github">' +
      '<i class="codicon codicon-github lp-gh-icon"></i>' +
      '<div class="link-preview-body">' +
        '<div class="link-preview-title">' + escapeHtml(data.title) + '</div>' +
        (data.description ? '<div class="link-preview-desc gs-text-xs">' + escapeHtml(data.description.slice(0, 80)) + '</div>' : '') +
      '</div>' +
    '</div>';
  } else {
    html = '<div class="link-preview-card">';
    if (data.image) {
      html += '<img class="link-preview-img" src="' + escapeHtml(data.image) + '" alt="" />';
    }
    html += '<div class="link-preview-body">';
    if (data.title) html += '<div class="link-preview-title">' + escapeHtml(data.title) + '</div>';
    var domain = '';
    try { domain = new URL(url).hostname; } catch(e) {}
    if (domain) html += '<div class="link-preview-domain">' + escapeHtml(domain) + '</div>';
    if (data.description) html += '<div class="link-preview-desc">' + escapeHtml(data.description.slice(0, 120)) + '</div>';
    html += '</div></div>';
  }

  var textEl = msgEl.querySelector('.msg-text');
  if (textEl) { textEl.insertAdjacentHTML('afterend', html); }
}
```

Also update the call in renderMessage() to use the new function name and send the right postMessage type:
```js
// In renderMessage(), change:
setTimeout(function() { fetchLinkPreview(String(msg.id), urlMatch[0]); }, 100);
```

- [ ] **Step 5: Update link preview CSS in chat.css**

```css
/* ── Link preview card ── */
.link-preview-card {
  display: flex; gap: 10px;
  margin-top: 6px; padding: 8px;
  background: var(--gs-bg-secondary);
  border: 1px solid var(--gs-border);
  border-radius: var(--gs-radius-sm);
  max-width: 280px; overflow: hidden;
}
.link-preview-img {
  width: 64px; height: 64px; object-fit: cover;
  border-radius: var(--gs-radius-xs); flex-shrink: 0;
}
.link-preview-body { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.link-preview-title { font-size: var(--gs-font-sm); font-weight: 600; color: var(--gs-fg); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.link-preview-domain { font-size: var(--gs-font-xs); color: var(--gs-muted); }
.link-preview-desc { font-size: var(--gs-font-xs); color: var(--gs-muted); overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.link-preview-github { align-items: center; }
.lp-gh-icon { font-size: 24px; color: var(--gs-fg); flex-shrink: 0; }
```

- [ ] **Step 6: Compile**

```bash
cd /Users/slugmacro/Desktop/projects/top-github-trending-repo-and-people && npm run compile 2>&1 | tail -10
```

- [ ] **Step 7: Commit**

```bash
git add media/webview/chat.js media/webview/chat.css src/webviews/chat.ts
git commit -m "feat(chat): link preview rate limiting, queue, URL cleaning, GitHub card"
```

---

## Task 11: Forward message

**Files:**
- Modify: `media/webview/chat.js` — `openForwardModal()`
- Modify: `media/webview/chat.css` — forward modal styles
- Modify: `src/webviews/chat.ts` — `forwardMessage` handler

- [ ] **Step 1: Add forwardMessage handler to chat.ts**

```typescript
case "forwardMessage": {
  const fp = msg.payload as { messageId: string; targetConversationIds: string[] };
  if (fp?.messageId && fp?.targetConversationIds?.length) {
    try {
      const convs = await apiClient.getConversations();
      const origConv = convs.find((c) => c.id === this._conversationId) as Record<string, unknown> | undefined;
      const [srcMsg] = await apiClient.getMessages(this._conversationId, 1).then(r =>
        r.messages.filter((m: Record<string, unknown>) => m.id === fp.messageId)
      ).catch(() => [undefined]);

      for (const targetId of fp.targetConversationIds) {
        try {
          await apiClient.sendMessage(targetId, (srcMsg as Record<string, string>)?.body || (srcMsg as Record<string, string>)?.content || "");
        } catch { /* skip failed targets */ }
      }
      this._panel.webview.postMessage({ type: "forwardSuccess", count: fp.targetConversationIds.length });
    } catch {
      this._panel.webview.postMessage({ type: "forwardError" });
    }
  }
  break;
}
```

- [ ] **Step 2: Add openForwardModal() to chat.js**

```js
var _conversations = []; // populated from init or getConversations response

function openForwardModal(msgId, text) {
  var existing = document.getElementById('forward-modal-overlay');
  if (existing) existing.remove();

  var overlay = document.createElement('div');
  overlay.id = 'forward-modal-overlay';
  overlay.className = 'forward-modal-overlay';

  var selectedIds = {};
  var conversationsToShow = _conversations.filter(function(c) { return c.id !== currentConversationId; });

  function renderModal() {
    var listHtml = conversationsToShow.length === 0
      ? '<div class="forward-empty">No conversations yet</div>'
      : conversationsToShow.map(function(c) {
          var name = escapeHtml(c.name || c.group_name || c.other_login || 'Chat');
          var isSelected = !!selectedIds[c.id];
          return '<div class="forward-conv-item' + (isSelected ? ' selected' : '') + '" data-conv-id="' + escapeHtml(c.id) + '">' +
            '<span class="forward-conv-name">' + name + '</span>' +
            (isSelected ? '<i class="codicon codicon-check forward-check"></i>' : '') +
          '</div>';
        }).join('');

    var selectedCount = Object.keys(selectedIds).length;
    overlay.innerHTML =
      '<div class="forward-modal" role="dialog">' +
        '<div class="forward-header">' +
          '<span class="forward-title">Forward to...</span>' +
          '<button class="forward-close" aria-label="Close"><i class="codicon codicon-close"></i></button>' +
        '</div>' +
        '<div class="forward-list">' + listHtml + '</div>' +
        '<div class="forward-footer">' +
          '<button class="gs-btn gs-btn-primary forward-send" ' + (selectedCount === 0 ? 'disabled' : '') + '>' +
            'Forward' + (selectedCount > 0 ? ' (' + selectedCount + ')' : '') +
          '</button>' +
        '</div>' +
        '<div class="forward-error" style="display:none;color:var(--gs-error);padding:8px 12px;font-size:var(--gs-font-xs)"></div>' +
      '</div>';

    overlay.querySelector('.forward-close').addEventListener('click', function() { overlay.remove(); });
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });

    overlay.querySelectorAll('.forward-conv-item').forEach(function(item) {
      item.addEventListener('click', function() {
        var id = item.dataset.convId;
        if (selectedIds[id]) { delete selectedIds[id]; } else { selectedIds[id] = true; }
        renderModal();
      });
    });

    var sendBtn = overlay.querySelector('.forward-send');
    if (sendBtn && !sendBtn.disabled) {
      sendBtn.addEventListener('click', function() {
        sendBtn.innerHTML = '<i class="codicon codicon-loading codicon-modifier-spin"></i> Forwarding...';
        sendBtn.disabled = true;
        vscode.postMessage({ type: 'forwardMessage', payload: { messageId: msgId, targetConversationIds: Object.keys(selectedIds) } });
      });
    }
  }

  document.body.appendChild(overlay);

  if (_conversations.length > 0) {
    renderModal();
  } else {
    overlay.innerHTML = '<div class="forward-modal"><div style="padding:16px;text-align:center"><i class="codicon codicon-loading codicon-modifier-spin"></i></div></div>';
    document.body.appendChild(overlay);
    vscode.postMessage({ type: 'getConversations' });
  }
}
```

Also add state:
```js
var currentConversationId = ''; // set in init handler
```

In `case "init":`, add:
```js
currentConversationId = msg.payload.conversationId || '';
_conversations = msg.payload.conversations || [];
```

Update `loadData()` in chat.ts to pass `conversationId` and `conversations` in the init payload.

- [ ] **Step 3: Handle forwardSuccess/forwardError in chat.js**

In the window message listener:
```js
case "forwardSuccess":
  var fwdOverlay = document.getElementById('forward-modal-overlay');
  if (fwdOverlay) fwdOverlay.remove();
  break;
case "forwardError":
  var fwdErr = document.querySelector('.forward-error');
  if (fwdErr) {
    fwdErr.textContent = 'Failed to forward. Try again.';
    fwdErr.style.display = 'block';
    var retryBtn = document.querySelector('.forward-send');
    if (retryBtn) { retryBtn.disabled = false; retryBtn.textContent = 'Forward'; }
  }
  break;
```

- [ ] **Step 4: Add forward modal CSS to chat.css**

```css
/* ── Forward modal ── */
.forward-modal-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.5);
  display: flex; align-items: center; justify-content: center;
  z-index: var(--z-modal);
}
.forward-modal {
  background: var(--gs-bg-secondary);
  border: 1px solid var(--gs-border);
  border-radius: var(--gs-radius);
  box-shadow: var(--gs-shadow-lg);
  width: 300px; max-height: 480px;
  display: flex; flex-direction: column;
  overflow: hidden;
}
.forward-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px; border-bottom: 1px solid var(--gs-border);
  flex-shrink: 0;
}
.forward-title { font-weight: 600; font-size: var(--gs-font-base); color: var(--gs-fg); }
.forward-close {
  background: transparent; border: none; cursor: pointer;
  color: var(--gs-muted); padding: 4px; border-radius: var(--gs-radius-xs);
}
.forward-close:hover { background: var(--gs-hover); color: var(--gs-fg); }
.forward-list { flex: 1; overflow-y: auto; padding: 4px 0; }
.forward-conv-item {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 16px; cursor: pointer;
  color: var(--gs-fg); font-size: var(--gs-font-sm);
}
.forward-conv-item:hover { background: var(--gs-hover); }
.forward-conv-item.selected { background: var(--gs-active); }
.forward-check { color: var(--gs-link); }
.forward-empty { padding: 16px; text-align: center; color: var(--gs-muted); font-size: var(--gs-font-sm); }
.forward-footer {
  padding: 10px 16px; border-top: 1px solid var(--gs-border);
  flex-shrink: 0;
}
.forward-footer .gs-btn { width: 100%; }
```

- [ ] **Step 5: Compile**

```bash
cd /Users/slugmacro/Desktop/projects/top-github-trending-repo-and-people && npm run compile 2>&1 | tail -10
```

- [ ] **Step 6: Commit**

```bash
git add media/webview/chat.js media/webview/chat.css src/webviews/chat.ts
git commit -m "feat(chat): forward message modal with multi-select"
```

---

## Task 12: Group avatar upload + invite link enhancement

**Files:**
- Modify: `media/webview/chat.js` — avatar upload UI in group info panel, invite link readonly input
- Modify: `media/webview/chat.css` — avatar upload overlay, invite input styles
- Modify: `src/webviews/chat.ts` — `uploadGroupAvatar` handler, `getConversationAvatar`

- [ ] **Step 1: Add uploadGroupAvatar handler to chat.ts**

```typescript
case "uploadGroupAvatar": {
  const avp = msg.payload as { base64: string; mimeType: string; conversationId: string };
  if (avp?.base64) {
    try {
      const buffer = Buffer.from(avp.base64.split(",")[1] || avp.base64, "base64");
      const ext = avp.mimeType === "image/png" ? "png" : avp.mimeType === "image/gif" ? "gif" : "jpg";
      const result = await apiClient.uploadAttachment(this._conversationId, buffer, `avatar.${ext}`, avp.mimeType);
      const avatarUrl = (result as Record<string, string>).url;
      await apiClient.updateGroup(this._conversationId, undefined, avatarUrl);
      this._panel.webview.postMessage({ type: "groupAvatarUpdated", avatarUrl });
    } catch {
      this._panel.webview.postMessage({ type: "groupAvatarFailed" });
    }
  }
  break;
}
```

Check if `apiClient.updateGroup` accepts an avatar URL parameter. If not, check `src/api.ts` and add if needed.

- [ ] **Step 2: Update showGroupInfoPanel() to add avatar upload UI**

In the group info panel HTML, before the group name div, add avatar section:
```js
var currentAvatar = (conv && conv.avatar_url) ? escapeHtml(conv.avatar_url) : '';
var avatarSection = isCreator
  ? '<div class="gip-avatar-section">' +
      '<div class="gip-avatar-wrapper">' +
        '<img class="gip-group-avatar" id="gip-avatar-img" src="' + (currentAvatar || '') + '" alt="Group avatar" style="' + (currentAvatar ? '' : 'display:none') + '">' +
        '<div class="gip-avatar-placeholder" id="gip-avatar-placeholder"' + (currentAvatar ? ' style="display:none"' : '') + '><i class="codicon codicon-organization"></i></div>' +
        '<button class="gip-avatar-change-btn" id="gip-avatar-change-btn" aria-label="Change group avatar"><i class="codicon codicon-camera"></i></button>' +
      '</div>' +
      '<div class="gip-avatar-error" id="gip-avatar-error" style="display:none;color:var(--gs-error);font-size:var(--gs-font-xs)"></div>' +
    '</div>'
  : '';
```

Then wire up the hidden file input:
```js
if (isCreator) {
  var changeBtn = document.getElementById('gip-avatar-change-btn');
  var fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/png,image/jpeg,image/gif';
  fileInput.style.display = 'none';
  document.body.appendChild(fileInput);

  changeBtn.addEventListener('click', function() { fileInput.click(); });

  fileInput.addEventListener('change', function() {
    var file = fileInput.files && fileInput.files[0];
    if (!file) return;
    var errEl = document.getElementById('gip-avatar-error');

    if (file.size > 5 * 1024 * 1024) {
      errEl.textContent = 'Image must be under 5MB';
      errEl.style.display = 'block';
      return;
    }
    errEl.style.display = 'none';

    // Optimistic update
    var avatarImg = document.getElementById('gip-avatar-img');
    var placeholder = document.getElementById('gip-avatar-placeholder');
    var prevSrc = avatarImg ? avatarImg.src : '';
    var blobUrl = URL.createObjectURL(file);
    if (avatarImg) { avatarImg.src = blobUrl; avatarImg.style.display = ''; }
    if (placeholder) { placeholder.style.display = 'none'; }

    var reader = new FileReader();
    reader.onload = function() {
      vscode.postMessage({ type: 'uploadGroupAvatar', payload: { base64: reader.result, mimeType: file.type } });
    };
    reader.readAsDataURL(file);
    fileInput.value = '';

    // Handle response
    function onAvatarMsg(event) {
      if (event.data.type === 'groupAvatarUpdated') {
        if (avatarImg) { URL.revokeObjectURL(blobUrl); avatarImg.src = event.data.avatarUrl; }
        window.removeEventListener('message', onAvatarMsg);
      } else if (event.data.type === 'groupAvatarFailed') {
        if (avatarImg) { avatarImg.src = prevSrc; }
        errEl.textContent = 'Upload failed. Try again.';
        errEl.style.display = 'block';
        window.removeEventListener('message', onAvatarMsg);
      }
    }
    window.addEventListener('message', onAvatarMsg);
  });
}
```

- [ ] **Step 3: Enhance invite link UI in showGroupInfoPanel()**

The existing invite section uses `<button class="gip-create-invite-btn">`. Enhance with the spec's readonly input:

Replace the invite section HTML with:
```js
'<div class="gip-invite-section">' +
  '<div class="gip-section-title">Invite Link</div>' +
  '<div class="gip-invite-content" id="gip-invite-content">' +
    '<button class="gs-btn gs-btn-secondary gip-create-invite-btn">Create Invite Link</button>' +
  '</div>' +
'</div>'
```

Update `inviteLinkResult` handler (already in window.addEventListener) to show readonly input:
```js
if (event.data.type === 'inviteLinkResult') {
  var ic = document.getElementById('gip-invite-content');
  if (ic && event.data.payload && event.data.payload.code) {
    var invUrl = event.data.payload.url || 'https://gitchat.sh/join/' + event.data.payload.code;
    ic.innerHTML =
      '<div class="gip-invite-row">' +
        '<input type="text" class="gs-input gip-invite-input" readonly value="' + escapeHtml(invUrl) + '" />' +
      '</div>' +
      '<div class="gip-invite-actions">' +
        '<button class="gs-btn gs-btn-secondary gip-copy-invite-btn" data-url="' + escapeHtml(invUrl) + '">Copy</button>' +
        '<button class="gs-btn gip-revoke-invite-btn" style="color:var(--gs-error)">Revoke</button>' +
      '</div>';
  }
}
```

Revoke should use `showConfirmModal`:
```js
// In gip-invite-section click handler, replace revoke logic:
} else if (target.classList.contains('gip-revoke-invite-btn')) {
  showConfirmModal({
    message: 'Revoke invite link? This will invalidate the current link.',
    confirmLabel: 'Revoke',
    onConfirm: function() { vscode.postMessage({ type: 'revokeInviteLink' }); }
  });
}
```

Copy button: change from postMessage to clipboard:
```js
} else if (target.classList.contains('gip-copy-invite-btn')) {
  navigator.clipboard.writeText(target.dataset.url).then(function() {
    var orig = target.textContent;
    target.textContent = 'Copied!';
    setTimeout(function() { target.textContent = orig; }, 2000);
  });
}
```

- [ ] **Step 4: Add avatar upload CSS to chat.css**

```css
/* ── Group avatar upload ── */
.gip-avatar-section { display: flex; flex-direction: column; align-items: center; padding: 12px 0 8px; }
.gip-avatar-wrapper { position: relative; width: 64px; height: 64px; }
.gip-group-avatar { width: 64px; height: 64px; border-radius: var(--gs-radius-full); object-fit: cover; }
.gip-avatar-placeholder {
  width: 64px; height: 64px; border-radius: var(--gs-radius-full);
  background: var(--gs-hover); display: flex; align-items: center; justify-content: center;
  color: var(--gs-muted); font-size: 28px;
}
.gip-avatar-change-btn {
  position: absolute; bottom: 0; right: 0;
  width: 22px; height: 22px;
  background: var(--gs-button-bg); color: var(--gs-button-fg);
  border: none; border-radius: var(--gs-radius-full);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; font-size: 12px;
}
.gip-invite-row { margin-bottom: 6px; }
.gip-invite-input { width: 100%; box-sizing: border-box; font-size: var(--gs-font-xs); }
.gip-invite-actions { display: flex; gap: 6px; }
```

- [ ] **Step 5: Compile**

```bash
cd /Users/slugmacro/Desktop/projects/top-github-trending-repo-and-people && npm run compile 2>&1 | tail -10
```

- [ ] **Step 6: Commit**

```bash
git add media/webview/chat.js media/webview/chat.css src/webviews/chat.ts
git commit -m "feat(chat): group avatar upload + invite link with copy/revoke"
```

---

## Task 13: Final cleanup + run tests

**Files:**
- Review all modified files
- Verify no `prompt()`/`alert()`/`confirm()` in webview files
- Verify no hardcoded hex/rgb in new CSS
- Verify all new icons use Codicons

- [ ] **Step 1: Check for prompt/alert/confirm in chat.js**

```bash
grep -n "prompt\|alert\b\|confirm\b" /Users/slugmacro/Desktop/projects/top-github-trending-repo-and-people/media/webview/chat.js | grep -v "//\|showConfirmModal"
```
Expected: no results (other than `showConfirmModal` which is allowed).

- [ ] **Step 2: Check for hardcoded hex/rgb in new CSS additions**

```bash
grep -n "rgb\b\|#[0-9a-fA-F]\{3,6\}" /Users/slugmacro/Desktop/projects/top-github-trending-repo-and-people/media/webview/chat.css | grep -v "rgba(0,0,0"
```
Expected: only `rgba(0,0,0,...)` for quote block bg (which is an intentional semi-transparent black, acceptable per spec).

- [ ] **Step 3: Run test suite**

```bash
cd /Users/slugmacro/Desktop/projects/top-github-trending-repo-and-people && npm test 2>&1
```
Expected: all tests pass including `groupMessages` suite.

- [ ] **Step 4: Final compile**

```bash
cd /Users/slugmacro/Desktop/projects/top-github-trending-repo-and-people && npm run compile 2>&1
```
Expected: clean, no errors.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "chore(chat): final cleanup + verification"
```

- [ ] **Step 6: Summary of commits for review**

```bash
git log feat/chat-feature-parity --oneline
```

---

## Post-implementation notes

**Known limitations to communicate to hiru/slugmarco:**
1. `reloadConversation` (§1a rejoin) — fires when extension receives `member:added` WebSocket event. This requires adding a listener in `chat.ts` to the realtime client. Not in this plan; add as a follow-up.
2. `data-created-at` on message elements — needed for the 15-minute edit window check. Must be added to `renderMessage()` as `data-created-at="..."` on the message div.
3. Forward modal uses loaded `_conversations` state — this requires the `init` message to pass `conversations` and `conversationId`. Update `loadData()` in `chat.ts` to include these.
4. `apiClient.updateGroup()` may need an optional `avatarUrl` parameter — check signature in `src/api.ts`.

**Quick fixes needed during execution:**
- Add `data-created-at` attribute in `renderMessage()` for edit window check
- Add `conversationId` to init payload in `loadData()`
- Add `conversations` to init payload (already fetched in loadData)
