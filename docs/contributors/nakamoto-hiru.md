# nakamoto-hiru

## Current
- **Branch:** hiru-uiux (branched from develop after GitChat rebrand wave + notifications module merged)
- **Working on:** Promoting shared UI components to shared.css — starting with main tabs
- **Blockers:** None
- **Last updated:** 2026-04-14

## Decisions
- 2026-04-14: Added `.gs-main-tab` — segmented top-level tab component. Moved from explore.css → shared.css so any webview can reuse. Active state uses top-accent (`box-shadow: inset 0 1px 0 --gs-button-bg`) + background lift to `--gs-bg` to visually merge with content area. Divider between siblings via `+` combinator. Distinct from `.gs-sub-tab` (underline style for secondary grouping within a single surface). Documented in UI-PATTERNS.md.
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
