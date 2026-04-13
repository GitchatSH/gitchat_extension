# nakamoto-hiru

## Current
- **Branch:** hiru-uiux
- **Working on:** WP6 Profile Card — spec + plan drafted, docs reorganized into docs/qa/, ready to execute via subagent-driven-development
- **Blockers:** None
- **Last updated:** 2026-04-14

## Decisions
- 2026-04-14: Added `.gs-main-tab` — segmented top-level tab component. Moved from explore.css → shared.css so any webview can reuse. Active state uses top-accent (`box-shadow: inset 0 1px 0 --gs-button-bg`) + background lift to `--gs-bg` to visually merge with content area. Divider between siblings via `+` combinator. Distinct from `.gs-sub-tab` (underline style for secondary grouping within a single surface). Documented in UI-PATTERNS.md.
- 2026-04-14: WP6 Profile Card implementation plan written at `docs/superpowers/plans/2026-04-14-profile-card.md` — 12 bite-sized tasks covering scaffold, github wrapper, mocks, enrichment, host router, overlay component (profile-card.js IIFE), CSS, 11 trigger bindings across explore.js + sidebar-chat.js, full smoke test, and BE requirements doc. Every task ends in a commit. Verification is `npm run check-types` + manual smoke (no webview JS test harness per spec §12.9).
- 2026-04-14: WP6 Profile Card design spec written at `docs/superpowers/specs/2026-04-14-profile-card-design.md`. Key decisions: (1) universal sidebar overlay attached to `document.body`, single `window.ProfileCard.show(username)` API, scope v1 = sidebar only (editor ProfilePanel stays for full view); (2) 4 states — self / eligible / stranger / not-on-gitchat, eligible rule = `follow_status.following && followed_by` (true mutual); (3) production feature not demo — real data via GitHub API intersection for `follow_status.followed_by`, `mutual_friends`, `mutual_groups` (communities only, star-based); (4) mocks isolated in `profile-card-mocks.ts` for only 2 fields that BE must provide: `on_gitchat` + `POST /waves`, strip paths documented; (5) all 11 trigger points wired via `bindTrigger(el, username)` helper across explore.js + sidebar-chat.js; (6) close via X / Escape / backdrop click, fade+slide-up 150ms animation matching existing sidebar-chat overlays.
- 2026-04-14: `--gs-msg-incoming` token changed from `--vscode-editor-inactiveSelectionBackground` (gave unwanted blue tint from theme selection color) to `color-mix(in srgb, var(--gs-button-bg) 16%, var(--gs-bg))` — subtle brand-tinted neutral lift above bg, theme-aware, replaces ~50% opacity themed tint with controlled mix. Affects both sidebar-chat and chat editor panel since they share the token.
- 2026-04-14: `.tab-badge` inside main tab uses 9px font — exception to the 11px minimum rule, only permitted for numeric counters inside a 16px pill. Not reusable for text.
- 2026-04-13: Drafted 15 GitChat sidebar screens in Pencil (300px width, VS Code dark) — Welcome, Onboarding overlay, Chat Inbox, Friends, Discover, 4 chat types (DM/Group/Community/Team), Group Create, Profile Card (eligible + stranger states), Wave, Founder Agent DM, Notifications. Built reusable components: ConvRow (universal list item), ChatHeader, ChatInput, TabBar, ChatHeader-Inbox
- 2026-04-13: Profile Card has 2 conditional states — eligible (Message + Following) vs stranger (Wave + Follow) — Wave is the fallback CTA when DM not allowed (covers spec gap where strangers had no way to start a conversation outside Discover)
- 2026-04-13: Tightened .claude/settings.json PreToolUse hook — blocks commit if any docs/contributors/*.md other than current user's is staged (cross-edit guard)
- 2026-04-13: Added husky pre-commit hook (.husky/pre-commit) — same guard but enforced for ALL clients (manual git commit, non-Claude users), installed via `prepare` script
- 2026-04-13: Created docs/contributors/akemi0x.md — moved 5 GitChat rebrand decisions Akemi mistakenly wrote into nakamoto-hiru.md back to her own doc
- 2026-04-10: Added PreToolUse hook in .claude/settings.json — blocks commit unless contributor doc is staged, enforces auto-update workflow
- 2026-04-10: Enhanced CLAUDE.md session instructions — detailed dau phien steps, explicit on-commit doc update rules
- 2026-04-10: Team workflow in CLAUDE.md — status+decisions format for user docs, rules in CLAUDE.md (no shared skills), all git actions require user confirmation
- 2026-04-08: Merge strategy for develop (210 commits) into hiru-uiux (158 commits, 27 conflicts) — keep hiru UI/UX files, keep develop features, manual merge for core files
- 2026-04-08: New shared components in shared.css: .gs-row-item, .gs-rank, .gs-sub-header/.gs-sub-tab, .gs-filter-bar, .gs-dropdown — replaced per-view duplicates
- 2026-04-08: Trending redesign — accordion → sub-tabs (Repos | People) with time range chips + search. Reuses gs-sub-tab from Chat
- 2026-04-08: .gs-row-item as single base class for all list rows — replaced .conv-item, .friend-item, .tr-card, .tp-card, .channel-item
- 2026-04-08: Rank badges — gold/silver/bronze top 3 with color-mix transparency, rank 4+ no background
- 2026-04-07: Unified Explore tabs (Chat | Feed | Trending) replacing 6 separate TreeView providers into single webview
- 2026-04-07: Tabbed navigation over split Activity Bar — VS Code API can't programmatically place views in secondary sidebar
- 2026-04-05: All view CSS must use --gs-* tokens exclusively, direct --vscode-* usage prohibited — enables consistent theming + single source of truth
- 2026-04-05: 3-tab Explore layout chosen over reducing density — each tab has clear focused concern
