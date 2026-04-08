# Decisions Log

Key technical and design decisions with rationale.

## 2026-04-08

### Decision: Merge develop branch + unify design system components

**Context:** `develop` branch had 210 commits with new features (Channels, Telegram-style chat, Discussions, auth scope). `hiru-uiux` had 158 commits with design system + global search + UI polish. 27 files conflicted.

**Merge strategy:**
- UI/UX files: keep hiru (design system owner)
- Chat panel (right side): keep develop (Telegram UX)
- Core files (extension, commands, api): merge both
- Explore panel: combine all tabs from both sides, then consolidate

**Design system changes:**
- New generic components in `shared.css`: `.gs-row-item`, `.gs-rank`, `.gs-sub-header/.gs-sub-tab`, `.gs-filter-bar`, `.gs-dropdown`
- New tokens: `--gs-divider-muted` (subtle row dividers), `--gs-inset-x` (horizontal section padding)
- Replaced all hardcoded font sizes (11-14px) with `--gs-font-*` variables across all CSS files
- Trending tab redesigned: accordion layout → sub-tabs (Repos | People) with time range chips + search

### Decision: Consolidate Trending into sub-tabbed layout

**Context:** Hiru had Trending as 3 accordion sections (Repos, People, Who to Follow). Develop had separate Repos and People tabs with search + time range filters.

**Chosen:** Sub-tabbed Trending (Repos | People) with search + time range chips in each. Reuses `gs-sub-tab` component from Chat. Eliminates duplicate tabs.

### Decision: Use `gs-row-item` as base layout for all list rows

**Context:** Multiple row styles existed: `.conv-item`, `.friend-item`, `.tr-card`, `.tp-card`, `.channel-item` — each with slightly different margins, padding, dividers.

**Chosen:** Single `.gs-row-item` base class (gap 12px, `--gs-inset-x` margin, `--gs-divider-muted` border, no radius). Modifier classes add view-specific styling only (unread bold, rank badges, etc).

### Decision: Rank badges with medal colors

**Chosen:** Gold (#fbbf24), Silver (#e2e8f0), Bronze (#92400e) with `color-mix` transparency for top 3. Rank 4+ has no background. Reusable `.gs-rank` component.

## 2026-04-05

### Decision: Use tabbed navigation for Explore sidebar

**Context:** The Explore sidebar currently stacks 5 sections (For You, Trending Repos, Trending People, Who to Follow, My Repos) in a single scrollable view, making it too dense.

**Options considered:**
1. Split into multiple Activity Bar containers (Discover + Social + Chat) — rejected because VS Code API cannot programmatically place views in the secondary sidebar; only 1 sidebar visible at a time
2. Tabbed navigation within a single webview — **chosen**
3. Reduce density by showing fewer items — not sufficient

**Decision:** Convert Explore sidebar into a single webview with 3 tabs:
- **Feed** — personalized activity stream (For You cards + filter chips)
- **Trending** — global rankings (Repos + People)
- **Social** — personal network (Who to Follow + Following + My Repos + Starred Repos)

**Rationale:**
- Pattern already proven in codebase (`chat-panel.js` uses tabs for Friends/Inbox)
- No additional Activity Bar icons needed
- Each tab has a clear, focused concern
- Requires converting TreeViews to webview rendering (trade-off: lose native feel, gain UX control)

### Decision: Design system must use `--gs-*` token layer

**Context:** `shared.css` defines a `--gs-*` token layer mapping from `--vscode-*`, but only ~50% of view CSS files actually use it.

**Decision:** All view CSS must use `--gs-*` tokens exclusively. Direct `--vscode-*` usage in view CSS is prohibited.

**Rationale:** The abstraction layer enables consistent theming, easier refactoring, and a single source of truth for design values.
