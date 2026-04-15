# BE Requirements: Scroll Buttons & Conversation Badges

**Date:** 2026-04-15
**Status:** Blocked — FE done, waiting for BE fixes
**FE Branch:** slug-qa-4

## Context

FE implemented Telegram-style scroll button stack (Go Down / Mentions / Reactions) in sidebar chat, and conversation list badges (reaction/mention indicators). Both depend on BE endpoints and conversation fields.

---

## 1. `GET /messages/conversations/:id/unread-reactions` — 500 Error

**Priority:** P0

**Current behavior:** Returns HTTP 500.

**Expected:** Return `{ message_ids: ["id1", "id2", ...] }` — list of message IDs in this conversation that have reactions the user hasn't seen yet.

**FE usage:** On chat open, fetch IDs to populate the Reactions floating button. User clicks button to jump through each reacted message, then button disappears.

**Log:**
```
[SidebarChat] reactions=2
[SidebarChat] getUnreadReactions failed: AxiosError: Request failed with status code 500
```

Note: `unread_reactions_count=2` on the conversation object works correctly. Only the message IDs endpoint fails.

---

## 2. `GET /messages/conversations/:id/unread-mentions` — Count always 0

**Priority:** P0

**Current behavior:** `unread_mentions_count` on conversation object is always 0, even when the user has been @mentioned in unread messages. So the FE never calls the endpoint.

**Expected:** `unread_mentions_count` should reflect actual unread @mentions. When > 0, FE calls `GET /messages/conversations/:id/unread-mentions` to get message IDs.

**FE usage:** Same as reactions — populate Mentions (@) floating button, user clicks to jump to each mention.

---

## 3. Conversation fields used by FE (for reference)

These fields on the conversation object are used for badges in the conversation list:

| Field | Used for | Status |
|---|---|---|
| `unread_count` | Numeric badge on conversation row | Working |
| `unread_mentions_count` | @ indicator badge (replaces count) | **Always 0 — needs fix** |
| `unread_reactions_count` | Smiley indicator badge (replaces count) | Working |
| `is_muted` | Muted badge style | Working |

---

## 4. Realtime events (working)

These realtime events ARE working correctly:

- `mention:new` → `{ conversationId, messageId }` — FE adds to mention button list
- `reaction:new` → `{ conversationId, messageId }` — FE adds to reaction button list

So the floating buttons DO appear for **new** mentions/reactions received while chat is open. The issue is only with **initial load** (opening a chat that already has unread mentions/reactions).
