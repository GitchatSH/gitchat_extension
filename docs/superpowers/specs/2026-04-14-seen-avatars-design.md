# Seen Avatars (Telegram-style Read Receipts) — Design Spec

> **Date:** 2026-04-14
> **Author:** norwayisworking
> **Type:** UI + Backend Integration Design Spec
> **Status:** Draft

## Overview

Upgrade read receipts from plain `✓✓` text to **Telegram-style seen avatars** — small avatar circles shown below/beside the last-read message, indicating exactly who has seen it. In group chats, avatars stack inline showing who has read the message.

### Current State

| What exists | Where |
|---|---|
| `otherReadAt` (single timestamp) | API response from `getMessages()`, WebSocket `conversation:read` event |
| `✓` / `✓✓` text icons | `media/webview/chat.js` lines 2276–2279 |
| `.seen-avatar` CSS class (16px round) | `media/webview/chat.css` line 393 — **unused in JS** |
| `conversationRead` event handler | `media/webview/chat.js` lines 414–428 — updates `✓` → `✓✓` |
| WebSocket `CONVERSATION_READ` | `src/realtime/index.ts` line 145 — fires `{ login, readAt }` |

### What's Missing

1. **Avatar display** next to `✓✓` — no avatars rendered, only text checkmarks
2. **Multi-reader tracking** — `otherReadAt` is a single string, only works for DM (1 other person)
3. **Backend: per-user read positions** — API returns one `otherReadAt`, not an array of `{ login, readAt }` per participant

---

## Design

### §1 — DM (1:1 Chat)

DMs only have 1 other participant, so the existing `otherReadAt` is sufficient.

#### §1a — Avatar Below Last-Seen Message

When the other person has read up to message X:
- Show their **avatar (14px round)** right-aligned below the last outgoing message they've read
- Avatar sits in the `.meta` row, after the `✓✓` icon
- Replaces the plain `✓✓` with: `✓✓` + `<img class="seen-avatar" src="{avatar_url}">`
- Only the **most recent seen position** shows the avatar — older messages show plain `✓✓`

```html
<!-- Outgoing message that has been seen -->
<div class="meta">
  <span class="msg-time">16:48</span>
  <span class="msg-status seen">✓✓</span>
  <img class="seen-avatar" src="https://avatars.githubusercontent.com/u/123" alt="ryan" title="Seen by ryan">
</div>
```

#### §1b — Status Icon Flow (updated)

| State | Display |
|---|---|
| `sending` | `⏳` spinner |
| `sent` | `✓` (opacity 0.5) |
| `seen` (latest msg) | `✓✓` + avatar (14px) |
| `seen` (older msg) | `✓✓` only (no avatar) |
| `failed` | `⚠ Retry` |

---

### §2 — Group Chat (3+ participants)

Groups have N participants. Need **per-user read positions** from the backend.

#### §2a — Seen Avatars Row

Below the last outgoing message, show a row of avatars for everyone who has read up to that point:

```
[ message content ]
                              16:48 ✓✓  (😀)(🧑)(👤)
```

- Max **3 avatars** shown inline, then `+N` overflow badge
- Avatars are 14px round, stacked with -4px `margin-left` overlap (first avatar no offset)
- Order: most recent reader first (left to right)
- Only show on the **latest message with readers** — older messages get plain `✓✓`

```html
<div class="meta">
  <span class="msg-time">16:48</span>
  <span class="msg-status seen">✓✓</span>
  <span class="seen-avatars" data-conv-id="{id}" data-msg-id="{id}">
    <img class="seen-avatar" src="{url}" alt="{login}" title="Seen by {name}">
    <img class="seen-avatar" src="{url}" alt="{login}" title="Seen by {name}">
    <img class="seen-avatar" src="{url}" alt="{login}" title="Seen by {name}">
    <span class="seen-overflow">+2</span>
  </span>
</div>
```

#### §2b — Real-time Updates

When a new `conversation:read` event arrives for a group:
1. Add/update that user's `readAt` in the local `seenMap`
2. Re-render seen avatars on the affected message

---

### §3 — Backend API Requirements

#### §3a — Enhanced WebSocket Event

Current `conversation:read` payload: `{ login, readAt }`

**Keep as-is** — it already contains enough info for real-time updates. The client maintains a local `seenMap` that accumulates events.

#### §3b — Enhanced `getMessages` Response

Current: `otherReadAt` (single string)

**Add**: `readReceipts` array alongside `otherReadAt` for backward compatibility:

```json
{
  "messages": [...],
  "otherReadAt": "2026-04-14T20:29:00Z",
  "readReceipts": [
    { "login": "ryan", "avatar_url": "...", "readAt": "2026-04-14T20:29:00Z" },
    { "login": "brian", "avatar_url": "...", "readAt": "2026-04-14T19:30:00Z" }
  ]
}
```

---

### §4 — Data Model (Client-side)

#### §4a — SeenMap

In-memory map per conversation, maintained in `chat.js`:

```js
// Map<login, { name, avatar_url, readAt }>
let seenMap = {};
```

- Populated from `readReceipts` on initial load
- Updated in real-time from `conversationRead` events
- Cleared when switching conversations

#### §4b — Helper: Get Seen Avatars for a Message

```js
function getSeenAvatarsForMessage(msgCreatedAt) {
  // Return users whose readAt >= msgCreatedAt
  // but readAt < nextMessage.created_at (so avatar only appears on the latest-read message)
  return Object.entries(seenMap)
    .filter(([login, info]) => info.readAt >= msgCreatedAt)
    .sort((a, b) => b[1].readAt.localeCompare(a[1].readAt));
}
```

In practice, avatars **only render on the last message** the person has read — not on every message above it. This keeps the UI clean (same as Telegram).

---

### §5 — CSS

Reuse existing `.seen-avatar` class, add new classes:

```css
/* Already exists */
.seen-avatar { width: 14px; height: 14px; border-radius: 50%; vertical-align: middle; margin-left: 2px; }

/* New: avatar stack in group */
.seen-avatars { display: inline-flex; align-items: center; cursor: pointer; margin-left: 4px; }
.seen-avatars .seen-avatar { margin-left: -4px; border: 1.5px solid var(--gs-bg); }
.seen-avatars .seen-avatar:first-child { margin-left: 2px; }
.seen-overflow { font-size: var(--gs-font-xs); color: var(--gs-muted); margin-left: 4px; }

```

---

## Files to Modify

### Extension (TypeScript)

| File | Changes |
|---|---|
| `src/api/index.ts` | Add `getReadReceipts(conversationId)` method; parse `readReceipts` from `getMessages` response |
| `src/types/index.ts` | Add `ReadReceipt` interface: `{ login, name?, avatar_url, readAt }` |
| `src/webviews/chat.ts` | Pass `readReceipts` to webview in `loadMessages` payload |
| `src/webviews/explore.ts` | Same as chat.ts for embedded chat view |
| `src/webviews/chat-handlers.ts` | Add `readReceipts` to message load flow |
| `src/realtime/index.ts` | No changes needed — existing `conversation:read` event is sufficient |

### Webview (JS/CSS)

| File | Changes |
|---|---|
| `media/webview/chat.js` | Add `seenMap` state; render seen avatars in `renderMessage()`; update on `conversationRead` event |
| `media/webview/chat.css` | Update `.seen-avatar` to 14px; add `.seen-avatars`, `.seen-overflow` classes |
| `media/webview/sidebar-chat.js` | Same seen avatar rendering for embedded sidebar chat |
| `media/webview/sidebar-chat.css` | Same CSS additions |

---

## Implementation Phases

### Phase 1: DM Seen Avatar (no backend changes)
- Use existing `otherReadAt` + participant info already available
- Render avatar next to `✓✓` on the last-read outgoing message
- **Files:** `chat.js`, `chat.css`, `chat.ts`
- **Effort:** Small — data already exists, just render it

### Phase 2: Group Seen Avatars (needs backend)
- Backend adds `readReceipts` array to `getMessages` response
- Backend adds `GET /read-receipts` endpoint
- Client renders avatar stack on last-read message per user
- **Files:** `api/index.ts`, `types/index.ts`, `chat.js`, `chat.css`, `chat.ts`
- **Effort:** Medium — needs backend coordination

---

## Edge Cases

| Case | Behavior |
|---|---|
| User is only participant (self-chat) | No seen avatars shown |
| 50+ members group | Show max 3 avatars + `+N` overflow badge |
| Participant leaves group | Remove from seenMap; don't show avatar |
| Message deleted | Seen avatars follow to the previous visible message |
| Offline → reconnect | Re-fetch `readReceipts` on reconnect (existing reconnect flow) |
| Very old messages | Only fetch receipts for visible/recent messages, not full history |
| Backend doesn't support `readReceipts` yet | Graceful fallback — if `readReceipts` missing, use `otherReadAt` for DM, skip avatars for group |

---

## Design Tokens Used

All from existing `--gs-*` system:
- `--gs-bg`, `--gs-bg-secondary` — panel backgrounds
- `--gs-fg`, `--gs-muted` — text colors
- `--gs-border` — divider lines
- `--gs-hover` — row hover state
- `--gs-font-xs`, `--gs-font-sm` — font sizes
- `--gs-radius-pill` — avatar border-radius (50%)
- `--gs-inset-x` — horizontal padding
- `--gs-button-fg` — status icon color on outgoing messages

---

## Open Questions

1. **Backend timeline** — When can `readReceipts` array be added to `getMessages` response?
2. **Privacy** — Should users be able to disable read receipts? (Telegram allows this)
3. **Channel/community chats** — Should repo channels show seen avatars? (Telegram doesn't for large groups >100)
