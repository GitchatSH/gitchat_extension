# Project Status

## Current State
- Branch: `hiru-uiux`
- Base: `main` (merged `develop` on 2026-04-08)
- Last updated: 2026-04-08

## Completed
- Full UI audit (CSS, JS, TS providers)
- Design guidelines document (`docs/design/DESIGN.md`)
- **Merged `develop` branch** (Channels, Telegram chat, Discussions, auth scope)
- **Unified Explore tabs:** Chat | Feed | Trending (3 main tabs)
- **Trending redesign:** sub-tabs (Repos | People) with search + time range chips
- **Design system components standardized in `shared.css`:**
  - `.gs-row-item` — base list row (inset margins, subtle dividers, 12px gap)
  - `.gs-rank` — ranked list badge (gold/silver/bronze top 3)
  - `.gs-sub-header` / `.gs-sub-tab` — underline sub-tab navigation
  - `.gs-filter-bar` — horizontal chip row for filters
  - `.gs-dropdown` — overlay popup menu
  - `--gs-inset-x` — horizontal padding token (8px)
  - `--gs-divider-muted` — subtle divider token (8% opacity)
- **Font standardization:** all hardcoded 11-14px replaced with `--gs-font-*` variables
- **Chat tab:** added Channels sub-tab + drafts display in inbox
- **User menu:** account button in title bar, dropdown with profile + sign out
- **Sync fixes:** follow state syncs between profile panel and sidebar, star state syncs between repo-detail and sidebar
- **Feed fixes:** filter chips scoped correctly, click active filter resets to All
- Global search with header overlay
- Feed filter chips, accordion layout for My Repos
- UI-PATTERNS.md documented all new components

## In Progress
- UI polish and testing across all tabs

## Next Up
- Verify time range filter works with backend API (repos + people)
- Add Topics sub-tab to Trending (pending API endpoint)
- Migrate remaining CSS files to `--gs-*` tokens (chat.css, welcome.css, profile.css, repo-detail.css)
- Fix sanitizeReadme XSS vulnerability
- Remove deprecated files (inbox.js/css, friends.js/css, old provider files)

## Blockers
- Time range filter may not work — backend API might return same data for all ranges (needs verification)
