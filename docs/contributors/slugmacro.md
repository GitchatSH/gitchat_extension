# SlugMacro

## Current
- **Branch:** slug-scroll
- **Working on:** Telegram-clone scroll system — Task 9 done (sidebar muted badge + mention @ indicator)
- **Blockers:** None — ready for Task 10 (clean up old scrollBtnEl references)
- **Last updated:** 2026-04-10

## Decisions
- 2026-04-10: Full Telegram scroll clone (option A) — 3-button stack (Go Down / Mentions / Reactions), scroll position memory, sidebar sync
- 2026-04-10: Desktop-style animation (slide up 150ms + easeOut) over Web/iOS styles — better fit for VS Code desktop context
- 2026-04-10: Go Down badge uses local `_newMsgCount` counter (not `unread_count` from conversation) — tracks messages since user scrolled up in current session
- 2026-04-10: Mark-as-read only at bottom (all-or-nothing API constraint) — future granular tracking when BE adds `markReadUpTo`
- 2026-04-10: Design FE with graceful fallbacks for missing BE fields — ship immediately, note BE requirements separately
- 2026-04-10: renderMessages scroll-to-unread via scrollIntoView on #unread-divider; init handler uses single 300ms retry instead of triple forced scroll-to-bottom
- 2026-04-10: Muted badge uses gray (--gs-muted) background; mention @ indicator (--gs-info blue) pierces mute state — separate visual affordances for quiet conversations with important mentions
