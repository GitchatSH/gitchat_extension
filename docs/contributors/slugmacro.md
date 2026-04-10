# SlugMacro

## Current
- **Branch:** slug-scroll (pushed to remote)
- **Working on:** Telegram-clone scroll system — FE done, waiting BE fix endpoint 500 error
- **Blockers:** BE endpoints `/unread-mentions` and `/unread-reactions` returning HTTP 500. Sent `docs/be-remaining-scroll.md` to BE team.
- **Last updated:** 2026-04-10

## Decisions
- 2026-04-10: Full Telegram scroll clone (option A) — 3-button stack (Go Down / Mentions / Reactions), scroll position memory, sidebar sync
- 2026-04-10: Desktop-style animation (slide up 150ms + easeOut) over Web/iOS styles — better fit for VS Code desktop context
- 2026-04-10: Go Down badge uses local `_newMsgCount` counter (not `unread_count` from conversation) — tracks messages since user scrolled up in current session
- 2026-04-10: Mark-as-read only at bottom (all-or-nothing API constraint) — future granular tracking when BE adds `markReadUpTo`
- 2026-04-10: Design FE with graceful fallbacks for missing BE fields — ship immediately, note BE requirements separately
- 2026-04-10: renderMessages scroll-to-unread via scrollIntoView on #unread-divider; init handler uses single 300ms retry instead of triple forced scroll-to-bottom
- 2026-04-10: Muted badge uses gray (--gs-muted) background; mention @ indicator (--gs-link blue) pierces mute state — separate visual affordances for quiet conversations with important mentions
- 2026-04-10: Sidebar badge priority — ❤️ @ indicators replace count badge when present (Telegram behavior)
- 2026-04-10: Button stack must live in wrapper div (#messages-area) not inside scrollable #messages — absolute positioning inside overflow:auto clips the button off-screen
- 2026-04-10: Isolated try/catch per endpoint (mention/reaction) so one 500 doesn't block the other
