# Telegram-Clone Scroll System — Design Spec

## Overview

Clone Telegram's scroll UX for the chat conversation view. Covers the full button stack (Go Down / Mentions / Reactions), auto-scroll behavior, scroll position memory on conversation open, and real-time sidebar badge sync.

**Branch:** `slug-scroll` (off `develop`)
**Scope:** `media/webview/chat.js`, `media/webview/chat.css`, `src/webviews/chat.ts`, `media/webview/chat-panel.js`, `media/webview/chat-panel.css`, `src/types/index.ts`

---

## Section 1: Button Stack System

Three circular buttons stacked vertically at bottom-right of `.messages` container, 8px spacing between buttons.

### Stack Order (bottom to top)

1. **Go Down** — `codicon-chevron-down`, always at bottom of stack
2. **Mentions** — `@` text icon, above Go Down
3. **Reactions** — `codicon-heart` icon, above Mentions

### Visibility Rules

| Button | Show when | Hide when |
|--------|-----------|-----------|
| Go Down | Scrolled up > 300px from bottom | Scrolled back to ≤ 100px from bottom |
| Mentions | `unread_mentions_count > 0` | Count reaches 0 or BE field unavailable |
| Reactions | `unread_reactions_count > 0` | Count reaches 0 or BE field unavailable |

### Badge

- **Go Down:** Shows a **local counter `_newMsgCount`** that tracks messages arriving while user is scrolled up. This is NOT `unread_count` from the conversation object — it represents "messages you haven't scrolled to yet in this session." Red (`--gs-error`) for normal chats, gray (`--gs-muted`) for muted chats. Hidden when count = 0. Resets to 0 when user scrolls to bottom or sends a message.
- **Mentions:** Shows unread mention count number (from `unread_mentions_count` if BE provides, else hidden).
- **Reactions:** Shows unread reaction count number (from `unread_reactions_count` if BE provides, else hidden).

### Click Behavior

- **Go Down:**
  - If `_isViewingContext` (jumped to pinned msg) → reload conversation to latest
  - If `unread_count > 0` AND unread messages are in DOM → scroll to unread divider
  - If `unread_count > 0` AND unread messages NOT in DOM → use `last_read_message_id` to fetch around first unread, then scroll to divider
  - If `unread_count = 0` → scroll to bottom (instant if >1000px, smooth if ≤1000px)
- **Mentions:** Jump to oldest unread mention. Requires BE endpoint `GET /conversations/:id/unread-mentions` returning message IDs. Client-side fallback: scan loaded messages for `@currentUser` — if target not loaded, fetch around that message ID. Subsequent clicks cycle through mentions.
- **Reactions:** Jump to oldest unread reaction. Requires BE endpoint `GET /conversations/:id/unread-reactions` returning message IDs. Same fetch-around fallback. Subsequent clicks cycle through reactions.

### Mention/Reaction Cycling State

- **`_mentionIds: string[]`** — array of unread mention message IDs, populated from BE endpoint or client-side scan
- **`_mentionIndex: number`** — current position in `_mentionIds`, starts at 0, increments on each click
- **`_reactionIds: string[]`** / **`_reactionIndex: number`** — same pattern for reactions
- **Reset when:** conversation changes, all mentions/reactions read, or user scrolls to bottom and `markConversationRead()` is called
- **When cycling reaches end of array:** wrap to index 0 (loop) or hide button if all have been marked read

### Hysteresis (100-300px dead zone)

The Go Down button shows at >300px and hides at ≤100px. In the 100-300px range, the button **retains its current visibility state** (no flicker). This means: if it was visible, it stays visible until ≤100px. If it was hidden, it stays hidden until >300px.

### Animation

- **Show:** Slide up from +20px translateY to 0, opacity 0→1, 150ms ease-out
- **Hide:** Reverse — slide down + fade out, 150ms ease-in

### Sizing

- 36x36px per button (fits VS Code compact UI)
- Badge: 18px min-width, positioned top-right (-4px, -4px)

---

## Section 2: Auto-Scroll & New Message Behavior

### User at bottom (≤100px from bottom)

- New incoming message → auto-scroll down, **instant** (no smooth)
- New reaction → update inline on message, no scroll

### User scrolled up (>100px from bottom)

- New incoming message → **no scroll**, Go Down badge increments
- New reaction → update inline if message visible, Reactions badge increments (if BE provides count)
- New mention → Mentions badge increments (if BE provides count)

### User sends message while scrolled up

- **Auto-scroll to bottom immediately** for ALL send paths: text, attachment, reply (Telegram behavior: sending = intent to see latest)
- Reset Go Down badge to 0
- Note: current `sendMessage()` only scrolls for text-only optimistic renders — implementation must ensure all send paths trigger scroll

### Unread Divider

- Text: `"New Messages"` (no count — matches Telegram)
- Position: inserted before first unread message when opening conversation
- Not clickable (passive visual indicator)
- Removed when user scrolls to bottom (≤100px from bottom)
- Removed when leaving conversation
- **One-shot per conversation open:** divider appears once when conversation opens with unreads. Once removed (by scrolling to bottom), it does NOT re-appear if new messages arrive during the same session. New messages while in-conversation use the Go Down badge instead.

---

## Section 3: Scroll Position Memory & Conversation Open

### Opening conversation with unreads (`unread_count > 0`)

1. Use `last_read_message_id` from BE to determine first unread message
2. Fetch messages around that position using existing cursor-based API: first `getMessages(conversationId, 1, last_read_message_id, 'after')` to get messages after the last read, then optionally `getMessages(..., 'before')` to get a few messages of context above the divider
3. Render "New Messages" divider above first unread
4. Scroll viewport so divider is at **top** of viewport
5. Set `_isViewingContext = true` and `_hasMoreAfter = true` if there are newer messages beyond the loaded page (reuses existing bidirectional scroll infrastructure)
6. **Fallback** (no `last_read_message_id`): estimate from `unread_count` — insert divider at `messages.length - unread_count`. If unread_count exceeds 1 page → fall back to scroll-to-bottom.

### Opening conversation without unreads (`unread_count = 0`)

- Scroll to bottom (most recent message) — current behavior preserved

### Leaving conversation

- No pixel-level scroll position saved (Telegram doesn't either)
- Unread state resets via `markConversationRead()` when user has scrolled through all messages

### Mark-as-read logic

The current `markConversationRead()` API is all-or-nothing (PATCH). Given this constraint:

- Mark as read **only when user scrolls to bottom** (≤100px from bottom)
- Implementation: add `postMessage({ type: 'markRead' })` from `chat.js` scroll listener → handle in `chat.ts` → call `markConversationRead()` API
- **Throttle:** max 1 markRead call per 500ms to avoid spamming API on scroll bounce
- Partial scroll (user reads some but not all) → do NOT mark as read — unread badge persists
- Future improvement: if BE adds `markReadUpTo(messageId)`, switch to granular tracking

---

## Section 4: Sidebar Chat List Sync

### Badge display per conversation item

| Condition | Badge |
|-----------|-------|
| `unread_count > 0` | Red number badge (`--gs-error`) |
| `is_muted && unread_count > 0` | Gray number badge (`--gs-muted`) |
| `unread_mentions_count > 0` | `@` indicator on badge (pierces mute — always visible) |
| `unread_count = 0` | No badge |

### Real-time sync while inside a conversation

- User scrolls to bottom → `markConversationRead()` → sidebar badge clears
- New message in **other** conversation → sidebar badge increments (existing WebSocket behavior)
- New message in **current** conversation + user at bottom → no badge increase (auto-read)
- New message in **current** conversation + user scrolled up → sidebar badge **increases** (unread). Mechanism: WebSocket `newMessage` event already pushes updated conversation data to sidebar via `onNewMessage` → `chat-panel.ts` refreshes conversation list from state. The sidebar reads `unread_count` from the conversation object which the BE increments server-side on each new message. No FE manual +1 needed.

### Tab count

- "Inbox (N)" — N = total conversations with `unread_count > 0`
- Existing logic preserved, muted conversations included in count but styled differently

### Sort order unchanged

- Pinned first → most recent

---

## Section 5: Error Handling & Fallbacks

### Missing BE fields — graceful degradation

| Missing Field | Fallback |
|---------------|----------|
| `last_read_message_id` | Estimate divider position from `unread_count`. If count > 1 page → scroll to bottom |
| `unread_mentions_count` | Hide Mentions button entirely |
| `unread_reactions_count` | Hide Reactions button entirely |

### Edge cases

- **Message deleted while scrolling** → anchor scroll to nearest surviving message
- **Media loading changes container height** → scroll position compensation (extend existing prepend logic to cover media load events)
- **WebSocket disconnects while in conversation** → preserve UI state, re-sync badges from API on reconnect
- **Click mention/reaction button but target message deleted** → skip to next, hide button if none remain

### Performance

- Scroll listener: `passive: true` (already implemented)
- Scroll handler throttling: visibility checks via `requestAnimationFrame` to avoid per-frame overhead
- Mark-as-read throttle: max 1 call per 500ms
- Badge updates: event-driven only (no polling)
- Button show/hide: CSS transitions, no JS animation loops
- z-index: button stack at `z-index: 10` (above messages, below pin banner and context menus)

---

## BE Requirements (to be communicated to backend team)

### New fields on Conversation object

1. `last_read_message_id: string` — ID of last message read by current user
2. `unread_mentions_count: number` — Count of unread @mentions in conversation
3. `unread_reactions_count: number` — Count of unread reactions on user's messages

### Existing field to type

4. `is_muted: boolean` — Already returned by API (used in `chat-panel.js` as untyped access), needs to be added to the `Conversation` TypeScript interface in `src/types/index.ts`

### New endpoints

5. `GET /conversations/:id/unread-mentions` — Returns array of message IDs with unread @mentions
6. `GET /conversations/:id/unread-reactions` — Returns array of message IDs with unread reactions

Without these fields/endpoints, the system degrades gracefully as described in Section 5.

---

## Files to Modify

| File | Changes |
|------|---------|
| `media/webview/chat.js` | Button stack, auto-scroll logic, scroll position memory, mark-as-read, mention/reaction cycling |
| `media/webview/chat.css` | Button stack styles, animation, muted badge variant |
| `src/webviews/chat.ts` | Conversation open logic (fetch around unread), pass new fields to webview |
| `media/webview/chat-panel.js` | Muted badge styling, mention @ indicator |
| `media/webview/chat-panel.css` | Muted badge gray variant |
| `src/types/index.ts` | Add optional `last_read_message_id`, `unread_mentions_count`, `unread_reactions_count` to Conversation type |
