# nakamoto-hiru

## Current
- **Branch:** develop
- **Working on:** GitChat rebrand & feature restructure spec — 12 work packages defined
- **Blockers:** None
- **Last updated:** 2026-04-13

## Decisions
- 2026-04-13: GitChat rebrand — cắt toàn bộ discovery/trending, focus chat layer cho GitHub (DM, Group, Community, Team)
- 2026-04-13: 3 tabs mới: Chat | Friends | Discover thay cho Chat | Feed | Trending
- 2026-04-13: Founder Agent (AI + human-in-the-loop via Telegram) auto-join mọi group với tag "GitChat Support"
- 2026-04-13: Wave/Say Hi feature — 1 lần duy nhất cho người lạ online, nếu respond → mở DM
- 2026-04-13: GitHub data cache 24h — fetch mutual follows, starred, contributions khi sign in
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
