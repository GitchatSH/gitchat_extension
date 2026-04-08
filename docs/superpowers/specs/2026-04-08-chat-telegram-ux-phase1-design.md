# Chat Telegram UX — Phase 1 Design

**Date:** 2026-04-08
**Goal:** Bring Telegram-like UX polish to chat, using only existing APIs (no backend changes).

---

## Delivered Features

1. **Scroll-to-Bottom Floating Button** — circular button with unread badge
2. **New Messages Divider** — "NEW MESSAGES" line between read/unread
3. **Draft Indicator** — save/restore input + "Draft:" label in inbox (explore panel)
4. **Pin Jump with Return** — jump to old pinned message, scroll down or click button to return to latest

## TODO: Phase 2 — Bidirectional Scroll (Option C)

**Blocked by:** Backend needs `direction=after` param on `GET /messages/conversations/{id}`

**What:** When viewing old message context (after pin jump), scroll down loads newer messages incrementally instead of jumping straight to latest.

**Backend requirement:**
- `GET /messages/conversations/{id}?cursor=xxx&direction=after` → returns messages **newer** than cursor
- Currently only supports loading older messages (default direction)

**Frontend work when backend ready:**
- Add `getMessagesAfter(conversationId, cursor)` to `src/api/index.ts`
- In `chat.ts`, add `loadNewer` message handler
- In `chat.js`, detect scroll-to-bottom in context mode → request newer messages → append to DOM
- Remove `_isViewingContext` reload-latest behavior, replace with incremental load

**Estimate:** ~100 lines frontend, ~30 min backend

## Removed Features (not needed)
- Keyboard shortcuts (R/E/Escape) — removed per user request
- Pinned messages list view — removed, pin redesign in progress
