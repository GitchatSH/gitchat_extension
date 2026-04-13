# Chat Feature Parity — Design Spec

**Date:** 2026-04-07
**Scope:** VS Code extension chat — bring to full feature parity with Gitchat web app
**Branch:** hiru-uiux (or new branch off it)

---

## Overview

The extension chat currently has basic send/receive, reactions, and group management. The web app has a significantly richer experience. This spec defines 10 features to implement, designed to match the web app's behavior exactly while respecting VS Code webview constraints (no right-click context menu, narrow sidebar, codicons only, no `confirm()`/`alert()`/`prompt()`, `File` objects not serializable over postMessage).

## ⚠️ Hard Constraint — No Customization

**This extension runs on VS Code, Cursor, Windsurf, Antigravity, Void, OpenCode — all with different color themes (Dark, Light, High Contrast, custom).**

Every UI element built in this spec MUST:

1. **Colors — `--gs-*` tokens ONLY.** Zero hardcoded hex/rgb values anywhere in CSS or JS. Zero direct `--vscode-*` usage in view CSS (only allowed in `shared.css` as token definitions). If a new color is needed, add a `--gs-*` token to `shared.css` with a `--vscode-*` fallback — never inline it.

2. **Icons — Codicons ONLY.** Use `<i class="codicon codicon-*">` exclusively. Full icon reference: https://microsoft.github.io/vscode-codicons/dist/codicon.html. No external icon libraries. No inline SVG except Gitchat logo/branding.

3. **Theme-aware by default.** All `--gs-*` tokens are already mapped to VS Code semantic tokens — they automatically adapt to any theme. Never override or assume a specific background/foreground color.

4. **No custom fonts.** Use `font-family: inherit` — picks up the user's VS Code font.

Violating any of these rules breaks the extension for users on non-default themes or non-VS Code editors. **These rules have no exceptions for this spec.**

All UI must follow `docs/design/DESIGN.md` — `--gs-*` tokens, `.gs-btn`, codicons.

---

## 1. Message Actions — Hover Floating Bar

**Trigger:** Mouse enters message bubble area → floating action bar appears above the bubble after 80ms debounce. Bar hides 150ms after pointer leaves both the bubble and the bar (use JS pointer events, not CSS-only hover, to avoid dead zone flicker).

**Bar contents (left to right):**
- 😊 React (opens emoji picker — see §4)
- ↩ Reply (sets reply context — see §2)
- 📋 Copy (copies text to clipboard — see §6)
- 📌 Pin/Unpin (see §1a below)
- ••• More (dropdown: Forward, Edit, Unsend, Delete — see §1b/§1c)

**Rules:**
- Own messages: React, Reply, Copy, Pin, More (Edit + Unsend + Delete in More)
- Others' messages: React, Reply, Copy, Pin, More (no Edit/Unsend/Delete in More)
- Outgoing bar: `top: -36px; right: 0` relative to bubble
- Incoming bar: `top: -36px; left: 0` relative to bubble content (not avatar)
- Bar uses `--gs-bg-secondary`, `--gs-border`, `--gs-shadow-sm`, `border-radius: --gs-radius-sm`
- Transition: `opacity var(--gs-duration) ease`
- z-index above messages, below modals

**Own vs. others' detection:** Each rendered message element has `data-own="true"` when `sender.login === currentUserLogin` (currentUserLogin stored as a JS module-level variable set when the webview receives the initial `init` message). The floating bar JS reads this attribute to determine which actions to show.

**Z-index:** Use `z-index: 10` for the floating bar (above message content at z-index 1, below modals at z-index 100, below emoji picker at z-index 20). Define these as CSS custom properties on `:root` in `chat.css`:
```css
:root {
  --z-msg-bar: 10;
  --z-picker: 20;
  --z-modal: 100;
}
```

**Accessibility:**
- Each bar button has `aria-label` (e.g., `aria-label="React"`)
- Bar is focusable via Tab when message is focused
- Escape key closes emoji picker / more dropdown if open

**Implementation (JS-based hover, no debounce on enter, 150ms delay on leave):**
```js
// No delay on show — bar appears immediately on mouseenter
// 150ms delay on hide — prevents flicker when moving between bubble and bar
let hideTimer = null;
msgEl.addEventListener('mouseenter', () => { clearTimeout(hideTimer); showBar(msgEl); });
msgEl.addEventListener('mouseleave', () => { hideTimer = setTimeout(() => hideBar(msgEl), 150); });
barEl.addEventListener('mouseenter', () => clearTimeout(hideTimer));
barEl.addEventListener('mouseleave', () => { hideTimer = setTimeout(() => hideBar(msgEl), 150); });
```

### §1a — Pin / Unpin

**Multiple pins supported** — no limit on pinned messages per conversation.

**Banner behavior (y hệt web app):**
- Banner shows below chat header when ≥ 1 message is pinned
- Displays: 📌 icon + message text preview (max 50 chars, truncated with "…") + **"#X of Y"** counter if multiple pins
- Clicking the banner: scrolls to & highlights the currently shown pinned message, then advances index (`currentPinIndex = (currentPinIndex + 1) % pinnedMessages.length`)
- Unpin button (📌 icon in banner): unpins the currently shown message → banner updates to show next pin (or disappears if last)
- When all pins removed (`pinnedMessages.length === 0`): banner disappears

**Data flow:**
- On chat load: TS fetches pinned messages → sends `{ type: 'initPinnedMessages', pinnedMessages: [{ id, senderName, text }] }`
- On pin: `postMessage({ type: 'pinMessage', messageId, conversationId })` → TS calls `POST /messages/conversations/{id}/pin`
- On unpin: `postMessage({ type: 'unpinMessage', messageId, conversationId })` → TS calls `DELETE /messages/conversations/{id}/pin`
- TS response (both pin and unpin):
  ```json
  { "type": "updatePinnedBanner", "pinnedMessages": [{ "id": "...", "senderName": "hiru", "text": "xem PR này..." }] }
  ```
  Empty array `[]` = hide banner.

**System messages are not pinnable.** The pin action in floating bar must be hidden for messages with `type === 'system'` (e.g. "X joined the group", "X left the group").

**Leave group and pins:** When user leaves a group, the extension navigates them away from the conversation immediately — they never see the banner again. Remaining members see pins unchanged. No pin cleanup on leave.

**Rejoin group:** When user is re-added to a group they previously left:
- Backend clears `left_at` and deletes the soft-delete threshold record — all message history and all pinned messages become visible again (including ones from before they left)
- Extension receives `member:added` WebSocket event → call `postMessage({ type: 'reloadConversation', conversationId })` → TS refetches messages + pinned messages → webview re-renders full history and pin banner
- No special frontend logic needed beyond listening to `member:added` and triggering a full reload of that conversation's data

### §1b — Edit Message

**Trigger:** ••• More → Edit (own messages only, within 15 minutes of `createdAt`).

- After 15 min: Edit option hidden from More dropdown (backend enforces, frontend also hides)
- UI: replace message bubble content with an inline `<textarea>` pre-filled with current text + Save / Cancel buttons (`.gs-btn-primary` / `.gs-btn-secondary`)
- Save: `postMessage({ type: 'editMessage', messageId, newText })` → TS: `PATCH /conversations/{id}/messages/{msgId}`
- On success: bubble updates in-place, shows "Edited" label (`--gs-font-xs`, `--gs-muted`) below text
- Cancel: reverts to original bubble without API call
- Escape key = Cancel

### §1c — Delete vs Unsend (distinct actions)

Both in ••• More dropdown for own messages:

**Unsend** ("Thu hồi" / "Unsend"):
- Removes message for ALL participants
- Confirmation modal (custom — no `confirm()`): "Remove this message for everyone?"
- On confirm: `postMessage({ type: 'unsendMessage', messageId })`
- Message element replaced with: `<span class="msg-unsent gs-text-muted gs-font-xs">[This message was unsent]</span>`

**Delete** ("Xóa phía tôi" / "Delete for me"):
- Removes message only for the current user (others still see it)
- No confirmation needed
- `postMessage({ type: 'deleteMessage', messageId })`
- Message element replaced with: `<span class="msg-deleted gs-text-muted gs-font-xs">[This message was deleted]</span>`

Both placeholders use `--gs-muted` color, `--gs-font-xs`, italic style. Never remove the element entirely (preserves scroll position and reply context).

### §1d — Sending / Failed Status

Every outgoing message has a transient `status` field managed in JS state:

- **`sending`**: spinner icon (`codicon-loading codicon-modifier-spin`, `--gs-font-xs`) shown next to timestamp while API call in flight
- **`sent`**: ✓ (single check, `--gs-muted`)
- **`seen`**: ✓✓ (double check, `--gs-link` color) — from existing `otherReadAt` logic
- **`failed`**: ⚠ icon + "Retry" inline button — click retry re-sends via same `postMessage({ type: 'sendMessage', ... })`

Status flows: `sending` → `sent` → `seen`. On error: `sending` → `failed`. Failed messages stay in DOM with retry affordance.

### §1e — New Messages Badge + Auto-scroll

**Auto-scroll rule:** When a new message arrives:
- If scroll position is within 100px of bottom → auto-scroll to bottom
- If scrolled up more than 100px → do NOT scroll; increment `newMessageCount` and show badge

**New messages badge:**
```
[ ↓  3 new messages ]
```
- Fixed position at bottom of message list area (above input bar)
- Background: `--gs-button-bg`, color: `--gs-button-fg`, `--gs-radius-pill`
- Click → scroll to bottom + clear badge
- Badge auto-hides when user scrolls to bottom manually

### §1f — Flash Highlight on Jump-to-Message

When scrolling to a message (reply quote click, pin banner click):
1. `msgEl.scrollIntoView({ behavior: 'smooth', block: 'center' })`
2. Add class `msg-highlight` to the element
3. Remove class after 1.5s

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

---

## 2. Reply / Quote

### Composing a reply
When user clicks Reply in the floating bar:
1. Set `replyingTo = { id, senderName, textPreview }` in JS state — `textPreview` is the message's `.textContent` (stripped of HTML, max 100 chars)
2. Show reply preview bar above the textarea:
   ```
   ┌─────────────────────────────────────┐
   │ ↩ Reply to hiru                 [✕] │
   │ xem PR này chưa? cần review gấp... │  ← truncated, white-space:nowrap, overflow:hidden, text-overflow:ellipsis
   └─────────────────────────────────────┘
   ```
   - Left border: `3px solid var(--gs-link)`
   - Background: `var(--gs-bg-secondary)`
   - Max-width: full width of input area; text truncated to 1 line via CSS ellipsis
   - ✕ button: clears `replyingTo`, hides bar, `aria-label="Cancel reply"`
3. On send: include `replyTo: { id: replyingTo.id, senderName, text: textPreview }` in message payload

### Displaying a quoted reply
Messages with `replyTo` data render a quoted block inside the bubble, above the message text:
```
▌ hiru
  xem PR này chưa?      ← 1 line, ellipsis
──────────────────
rồi, tao đang xem
```
- Quote block: `border-left: 2px solid var(--gs-link)`, `background: rgba(0,0,0,0.15)`, `border-radius: var(--gs-radius-xs)`, `padding: 4px 8px`, `margin-bottom: 6px`
- Sender name in `--gs-link` color, `--gs-font-xs`
- Text: 1 line, ellipsis

**Deleted original message:** If the original message element is not found in the DOM when user clicks the quote block, do not crash — show a VS Code-style inline notification via `postMessage({ type: 'showInfoMessage', text: 'Original message is no longer available.' })`. Do not attempt `scrollIntoView`.

**Pagination (message not yet in DOM):** The extension loads a fixed window of messages. If the original message is not in the DOM (scrolled out of the loaded range), treat it the same as deleted — show the info message. Deep pagination / load-on-scroll is out of scope for this spec.

**`replyTo.text` extraction:** Always use `msgEl.querySelector('.msg-text').textContent` (scoped to `.msg-text` only, not the whole message element) to exclude link preview card text nodes.

**Rich content in `replyTo.text`:** Always use `.textContent` of the message element (not `.innerHTML`) to extract the text preview — this strips HTML, images, and mentions to plain text automatically.

---

## 3. Message Grouping + Date Separators

### Grouping rules
Run `groupMessages(messages)` before rendering to annotate each message with position metadata.

Messages are grouped when:
- Same `sender.login` as the previous rendered message
- `createdAt` difference ≤ 2 minutes (use `createdAt` from server response, converted to JS `Date`)
- No date boundary between them

Each message gets a `groupPosition` annotation: `'single' | 'first' | 'middle' | 'last'`

**Visual changes:**
- `first` / `single`: show avatar + sender name above bubble
- `middle` / `last`: avatar area is an empty spacer (same 24px width for alignment)
- Timestamp shown only on `single` or `last` messages
- Gap between groups: `8px`; gap within group: `2px`

**Corner radius per position (incoming — left side flat):**
```
single:  border-radius: var(--gs-radius-pill)  (all corners round)
first:   border-bottom-left-radius: 2px
middle:  border-top-left-radius: 2px; border-bottom-left-radius: 2px
last:    border-top-left-radius: 2px
```
Mirror for outgoing (right side flat).

**Timestamp source:** Always use server-provided `createdAt` (ISO 8601 UTC string). Convert to local time with `new Date(createdAt)` for display — JS `Date` uses local timezone automatically.

**Outgoing corner radius (explicit):**
```
single:  border-radius: var(--gs-radius-pill)
first:   border-bottom-right-radius: 2px
middle:  border-top-right-radius: 2px; border-bottom-right-radius: 2px
last:    border-top-right-radius: 2px
```

### Date separators
Insert a `.date-separator` element between messages when the local calendar date changes:
- Format: "Today" / "Yesterday" / `"April 6"` / `"March 31, 2025"` (add year if not current year)
- Use local date for comparison: `new Date(createdAt).toDateString()` (locale-independent, good enough for equality check)
- Styling: `1px solid var(--gs-divider)` lines flanking centered date label, `--gs-font-xs`, `--gs-muted`

**`groupMessages()` handles both grouping and date boundaries in one pass** — the renderer only calls this function and uses its output, no duplication:
```js
function groupMessages(messages) {
  const toDateStr = d => new Date(d).toDateString();
  return messages.map((msg, i) => {
    const prev = messages[i - 1];
    const next = messages[i + 1];
    const newDay = !prev || toDateStr(msg.createdAt) !== toDateStr(prev.createdAt);
    const sameSender = prev && !newDay && prev.sender.login === msg.sender.login
                       && (new Date(msg.createdAt) - new Date(prev.createdAt)) <= 120000;
    const nextBreaks = !next || toDateStr(next.createdAt) !== toDateStr(msg.createdAt)
                       || next.sender.login !== msg.sender.login
                       || (new Date(next.createdAt) - new Date(msg.createdAt)) > 120000;
    const isFirst = !sameSender;
    const isLast = nextBreaks || !next || next.sender.login !== msg.sender.login;
    let groupPosition = 'single';
    if (!isFirst && !isLast) groupPosition = 'middle';
    else if (!isFirst) groupPosition = 'last';
    else if (!isLast) groupPosition = 'first';
    return { ...msg, showDateSeparator: newDay, groupPosition };
  });
}
```

---

## 4. Emoji Picker for Reactions

**Trigger:** Click 😊 in floating bar → picker appears anchored to the bar.

**Quick reactions (4 fixed, matching web app):** 👍 ❤️ 😂 🔥
- Each is a button with `aria-label` of the emoji name
- Clicking → `doAction('toggleReaction', { messageId, emoji })` → closes picker

**Reaction badges (displayed below message bubble):**
- Each unique emoji shows as a badge: `[😂 3]` with up to 3 user avatars (24px) stacked + "+N" overflow
- Badge has `--gs-border` outline; if current user reacted, border changes to `--gs-link` (highlighted)
- Clicking a badge toggles the reaction (add if not reacted, remove if already reacted)
- Badges update in real-time via existing WebSocket `reaction:updated` event

**Full picker (+ button):**
- Search `<input>` filters by emoji name/keywords
- Grid: 8 columns, ~200 curated emojis as inline JS constant with schema:
  ```js
  const EMOJIS = [
    { emoji: '👍', name: 'thumbs up', keywords: ['like', 'good', 'yes'] },
    // ...
  ]
  ```
  Search filters on `name` + `keywords` joined, case-insensitive
- Clicking any emoji → `doAction('toggleReaction', ...)` → closes picker

**Emoji list source:** Use a manually curated inline JS constant of ~200 common emojis copied from the Unicode CLDR common subset. The keyword schema is frozen: `{ emoji, name, keywords: string[] }`. No external library needed.

**Positioning (JS-computed, not CSS):**
- Measure `barEl.getBoundingClientRect()`
- Default: position picker above bar: `pickerEl.style.top = barRect.top - pickerHeight - 4 + 'px'`
- If `barRect.top < 260` (not enough room above): flip below: `pickerEl.style.top = barRect.bottom + 4 + 'px'`
- Horizontal: align left edge to bar left (`pickerEl.style.left = barRect.left + 'px'`), clamp so it doesn't overflow viewport right edge
- Horizontal: align to left edge of bar for incoming, right edge for outgoing

**Singleton:** Only one picker open at a time. Opening a new picker closes any existing one. Track with `currentOpenPicker` variable.

**Dismiss:** Click outside picker + bar → close. Escape key → close.

---

## 5. @Mention Suggestions

**Trigger:** Textarea `input` event — detect if the text before cursor matches `/@(\w*)$/`.

**Data source:** Use already-loaded group members (`conversationMembers` in state) — no extra API call.

**Dropdown:** Shows up to 6 filtered matches, sorted by `login`:
```
[ 🟢 [avatar 24px]  hiru       Hiếu Nguyễn  ]
[ ⚫ [avatar 24px]  slugmacro  Marco Slug    ]
```
- Online dot from presence state
- Keyboard: ↑↓ navigate, Enter/Tab select, Escape dismiss
- Click outside textarea (not on dropdown) → dismiss

**Positioning (JS-computed):**
- Measure `inputAreaEl.getBoundingClientRect()`
- Default: above textarea: `dropdownEl.style.top = inputRect.top - dropdownHeight - 4 + 'px'`
- If `inputRect.top < 160`: flip below: `dropdownEl.style.top = inputRect.bottom + 4 + 'px'`

**Multi-mention algorithm:**
Track `mentionStart` (cursor index where `@` was typed):
```js
textarea.addEventListener('input', () => {
  const cursor = textarea.selectionStart;
  const textBefore = textarea.value.slice(0, cursor);
  const match = textBefore.match(/@(\w*)$/);
  if (match) {
    mentionStart = cursor - match[0].length; // index of the '@'
    const query = match[1];
    showMentionDropdown(filterMembers(query));
  } else {
    closeMentionDropdown();
    mentionStart = -1;
  }
});
```
On select: replace `textarea.value.slice(mentionStart, cursor)` with `@login ` — only the active match, not the whole value.

**`conversationMembers` availability:** If state is empty on dropdown open, `postMessage({ type: 'getConversationMembers', conversationId })` — TS responds with member list. Show loading spinner while waiting.

**Search non-members (query ≥ 2 chars):** If query length ≥ 2, also call `postMessage({ type: 'searchUsers', query })` → TS: `GET /messages/search-users?q=...` → returns users not in conversation. Show results in two sections:
```
── Members ──
  🟢 hiru
── Others ──
  ⚫ somedev
```
"Others" section only shows if search returns non-members. Selecting a non-member from "Others" inserts the mention normally — no auto-add-to-group.

**Dismiss on cursor move:** `textarea.addEventListener('click', () => { if (mentionStart !== -1) closeMentionDropdown(); })` — any click in textarea resets the dropdown.

---

## 6. Copy Message Text

**Trigger:** Click 📋 Copy in floating bar.

**Behavior:**
1. `navigator.clipboard.writeText(msgEl.querySelector('.msg-text').textContent.trim())`
2. Copy icon in bar changes to a codicon checkmark (`codicon-check`) for 1.5s then reverts
3. No toast needed — icon feedback is sufficient

---

## 7. Animated Typing Dots

Replace existing plain-text typing indicator in header with animated dots.

**HTML structure:**
```html
<span class="typing-indicator">
  <span class="typing-label">hiru is typing</span>
  <span class="typing-dots" aria-hidden="true">
    <span class="typing-dot"></span>
    <span class="typing-dot"></span>
    <span class="typing-dot"></span>
  </span>
</span>
```

**Multi-typer:** Preserve existing logic that formats the label ("hiru and slugmacro are typing", "3 people are typing") — only the dots HTML is new. Update `typing-label` text content via existing path; dots are purely CSS.

**CSS:**
```css
@keyframes gs-typing-bounce {
  0%, 80%, 100% { transform: translateY(0); }
  40% { transform: translateY(-4px); }
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
```

---

## 8. Link Previews

**Trigger:** After a message renders, detect first URL in `.msg-text` via regex `/https?:\/\/[^\s]+/`.

**Flow:**
1. Check `linkPreviewCache[url]` — if hit, render immediately
2. If in-flight request already pending for this URL (`linkPreviewPending[url] = true`), skip — the first requester will render when resolved
3. Otherwise: set `linkPreviewPending[url] = true`, `postMessage({ type: 'fetchLinkPreview', url, messageId })`
4. TS handler: `GET /messages/link-preview?url=...` → responds with `{ type: 'linkPreviewResult', url, messageId, data }`
5. JS: set `linkPreviewCache[url] = data`, delete `linkPreviewPending[url]`, find message element by `data-msg-id`, append preview card

**Generic preview card:**
```html
<div class="link-preview-card">
  <img class="link-preview-img" src="..." />  <!-- hidden if no image -->
  <div class="link-preview-body">
    <div class="link-preview-title">Title</div>
    <div class="link-preview-domain gs-text-xs gs-text-muted">example.com</div>
    <div class="link-preview-desc gs-text-xs gs-text-muted">Description...</div>
  </div>
</div>
```

**GitHub card** (detected by `url.includes('github.com')`):
```html
<div class="link-preview-card link-preview-github">
  <i class="codicon codicon-github"></i>
  <div class="link-preview-body">
    <div class="link-preview-title">owner/repo</div>
    <div class="gs-text-xs gs-text-muted">⭐ 12.3k · 🍴 234 · Description</div>
  </div>
</div>
```

**Graceful degradation:** If `data` is null/error, do not render anything. No error state shown.

**Scroll anchoring:** Card appended via `appendChild` — no scroll position adjustment needed (card appends after existing content, existing messages do not shift).

**Rate limiting:** Max 5 concurrent in-flight requests. If `Object.keys(linkPreviewPending).length >= 5`, add the URL to a `linkPreviewQueue` array. When any pending request resolves, dequeue and process the next URL from `linkPreviewQueue`. This ensures no preview is permanently skipped.

**URL cleaning:** Strip trailing punctuation from the regex match before fetching: `url.replace(/[.,;:)!?]+$/, '')`.

**DOM not found on response:** If `document.querySelector('[data-msg-id="${messageId}"]')` returns null when the preview arrives (user navigated away), still populate `linkPreviewCache[url]` — the preview will render on next load via the cache. Silently skip the DOM append.

---

## 9. Forward Message

**Trigger:** ••• More dropdown → "Forward"

**Flow:**
1. Open forward modal (overlay + centered panel, same style as existing group member modal)
2. Header: "Forward to..." + ✕ close
3. Search input + scrollable conversation list (from already-loaded `conversations` state in explore sidebar — no extra API call)
4. Each row: avatar, conversation name, last message preview — **multi-select**: tap to toggle checkmark, can select multiple
5. "Forward" button shows count: "Forward (2)" — active when ≥ 1 selected
6. Click Forward:
   - Show loading spinner in button
   - `postMessage({ type: 'forwardMessage', messageId, targetConversationIds: ['id1', 'id2'] })` — array
   - TS: for each id in array, `POST /messages/conversations/{id}` with payload `{ text: originalMessage.text, forwardedFrom: { messageId, senderName, conversationId } }`
   - On success: close modal, change ••• icon to ✓ for 1.5s
   - On error: show inline error in modal ("Failed to forward. Try again.") with Retry button — do NOT use `confirm()`/`alert()`

**Conversations state empty:** If `conversations` list is not yet loaded when Forward modal opens, show a loading spinner and `postMessage({ type: 'getConversations' })` — TS responds with conversation list. If the list is empty, show empty state "No conversations yet".

---

## 10. Group Avatar Upload + Invite Links

### Group avatar upload

In group settings panel (header ••• → Group Info):
1. Show current group avatar with "Change photo" overlay button
2. Click → trigger hidden `<input type="file" accept="image/png,image/jpeg,image/gif" style="display:none">`
3. On file selected:
   - **Client-side size check first:** if `file.size > 5 * 1024 * 1024` (5MB), show inline error "Image must be under 5MB" and abort — do not read or send
   - Read as base64: `FileReader.readAsDataURL(file)` (do NOT pass `File` object over postMessage — not serializable)
4. **Optimistic update:** immediately set group avatar `<img>` src to `URL.createObjectURL(file)` (local blob URL) so user sees the change instantly
5. `postMessage({ type: 'uploadGroupAvatar', base64: reader.result, mimeType: file.type, conversationId })`
6. TS handler: decode base64 → `POST /messages/upload` (multipart) → get URL → `PATCH /messages/conversations/{id}/group` with new avatar URL
7. On success: TS sends `{ type: 'groupAvatarUpdated', avatarUrl }` → JS replaces blob URL with the permanent CDN URL (avoids memory leak from blob URL)
8. On error: TS sends `{ type: 'groupAvatarFailed' }` → JS reverts avatar `<img>` src to the previous CDN URL (stored before step 4), shows inline error "Upload failed. Try again."

### Invite links

In group settings panel, below member list:
1. "Invite link" section with `<input readonly>` showing the link + "Copy" button + "Revoke" button
2. On open: `postMessage({ type: 'getInviteLink', conversationId })` → TS fetches → JS populates the input
3. Copy: `navigator.clipboard.writeText(linkInput.value)` → "Copy" button text → "Copied!" for 2s → reverts
4. Revoke: Show a custom confirmation modal (NOT `confirm()`) — "Revoke invite link? This will invalidate the current link." with "Revoke" (`.gs-btn-primary`) and "Cancel" (`.gs-btn-secondary`) buttons → on confirm: `postMessage({ type: 'revokeInviteLink', conversationId })` → TS revokes + regenerates → JS updates the input with new link

---

## Implementation Order (Foundation First)

1. **Message grouping + date separators** (§3) — pure rendering logic, no API changes
2. **Hover floating bar** (§1) — JS pointer events, no API changes
3. **Pin/Unpin** (§1a) — wires into existing pin API
4. **Copy** (§6) + **Animated typing dots** (§7) — trivial additions
5. **Reply/Quote** (§2) — UI state + backend `replyTo` field
6. **Emoji picker** (§4) — self-contained, no API
7. **@mention suggestions** (§5) — uses existing members data
8. **Link previews** (§8) — new postMessage type + TS handler
9. **Forward** (§9) — new modal + postMessage type
10. **Group avatar + invite links** (§10) — extends existing group settings UI

---

## Files to Change

| File | Changes |
|------|---------|
| `media/webview/chat.js` | `groupMessages()`, `renderMessage()` updates, floating bar (JS hover), reply state, copy, forward modal, @mention dropdown, emoji picker, link preview cache |
| `media/webview/chat.css` | Floating bar, reply bar, grouped bubble radius, typing dots, link preview card, emoji picker, mention dropdown, pinned banner |
| `src/webviews/chat.ts` | Handle: `fetchLinkPreview`, `forwardMessage`, `uploadGroupAvatar`, `getInviteLink`, `revokeInviteLink`, `pinMessage`, `unpinMessage`, `showInfoMessage` |

No new files. No new npm dependencies (emoji list as inline JS constant, base64 FileReader for uploads).

---

## Out of Scope

- GIF picker (needs external API — deferred)
- Message search (separate feature)
- Mobile gesture support (desktop IDE only)
- Report message (needs backend moderation endpoint — deferred)
- BlurHash image placeholders (complexity not worth it)
