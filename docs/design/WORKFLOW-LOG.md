# Workflow Log

Chronological record of design & development sessions.

## 2026-04-08

### Session: Merge Develop + Design System Standardization

**Duration:** ~3 hours

**What was done:**
- Merged `develop` branch (210 commits) into `hiru-uiux` (158 commits), resolved 27 file conflicts
- Merge strategy: keep hiru UI/UX files, keep develop features (Channels, Telegram chat, auth), manual merge for core files
- Trending tab redesign: replaced accordion layout with sub-tabs (Repos | People) + search + time range chips
- Standardized design system components in `shared.css`:
  - `.gs-row-item` — base list row with inset margins and subtle dividers
  - `.gs-rank` — ranked list badges (theme-aware primary color gradient)
  - `.gs-sub-header` / `.gs-sub-tab` — underline sub-tab navigation
  - `.gs-filter-bar` — horizontal chip row
  - `.gs-dropdown` — overlay popup menu
- New tokens: `--gs-inset-x` (8px), `--gs-divider-muted` (8% opacity)
- Replaced all hardcoded font sizes (11-14px) with `--gs-font-*` variables across all CSS files
- Added Channels sub-tab + drafts display to Chat tab
- Added user menu dropdown (account icon in title bar)
- Fixed follow/star sync between sidebar panels and main content panels
- Fixed feed filter chip scoping (was affecting trending chips)
- Settings dropdown: removed Sign Out (in User Menu now), Debug logs dev-mode only
- Updated UI-PATTERNS.md, DECISIONS-LOG.md, STATUS.md, DESIGN.md

**Key changes:**
- `media/webview/shared.css` — +80 lines (new components + tokens)
- `media/webview/explore.css` — refactored (removed duplicates, added dev card styles)
- `media/webview/explore.js` — +600 lines (trending sub-tabs, repos/people/channels rendering)
- `src/webviews/explore.ts` — +300 lines (dev handlers, HTML panes, user menu)
- `src/webviews/profile.ts` — added unfollow handler + event sync
- `src/webviews/repo-detail.ts` — added star sync to explore sidebar

---

## 2026-04-07

### Session: Unified Explore Tabs Implementation

**Duration:** ~3 hours

**What was done:**
- Updated Pencil mockup: replaced Social tab with Chat, redistributed content (Who to Follow → Trending, My Repos → Feed)
- Designed and implemented unified Explore webview with 3 tabs: Chat | Feed | Trending
- Created `ExploreWebviewProvider` consolidating 6 old providers (chat-panel, feed, trending-repos, trending-people, who-to-follow, my-repos)
- Removed `chatSidebar` activity bar container — Chat merged into Explore
- Converted TreeView-based sections to HTML rendering in webview
- Iterative UI polish:
  - VS Code-style tab bar (solid bg, top accent, side dividers)
  - Visual hierarchy: main tabs vs sub-tabs vs filter chips
  - Codicon icons (comment-discussion, rss, rocket)
  - Collapsible accordion sections with chevron indicators
  - VS Code Explorer-style independent scroll per section
  - My Repos sticky bottom in Feed tab
  - Feed chip alignment, chat input font size, focus outline removal
- Resolved merge conflicts with main branch
- Created PR with full documentation

**Key files created:**
- `src/webviews/explore.ts` — Unified provider (548 lines)
- `media/webview/explore.css` — Consolidated styles (585 lines)
- `media/webview/explore.js` — Consolidated JS (672 lines)
- `docs/superpowers/specs/2026-04-07-unified-explore-tabs-design.md`
- `docs/superpowers/plans/2026-04-07-unified-explore-tabs.md`

**Key files modified:**
- `package.json` — Views consolidation (-184 lines)
- `src/extension.ts` — Module replacement
- `src/commands/index.ts`, `src/statusbar/index.ts`, `src/webviews/chat.ts` — Provider references

---

## 2026-04-05

### Session: UI Audit + Explore Tabs Redesign

**Duration:** ~2 hours

**What was done:**
- Full UI audit of all webview CSS (13 files), JS (11 files), and TS providers (10 files)
- Created `docs/design/DESIGN.md` — comprehensive design guidelines
- Identified top issues: XSS in sanitizeReadme, 50% files not using design tokens, duplicate code, fragmented button system
- Explored sidebar density problem — current Explore sidebar has 5 sections stacked
- Evaluated options: split Activity Bar containers (rejected — API limitation for secondary sidebar), tabbed navigation (chosen)
- Designed 3-tab Explore layout: Feed | Trending | Social
- Created mockup in Pencil (`docs/pencil/ideas.pen`) with all 3 tab states
- Set up dev environment: `npm install`, `npm run compile` verified

**Key files created:**
- `docs/design/DESIGN.md` — Design guidelines and token reference
- `docs/pencil/ideas.pen` — Explore tabs redesign mockup
- `docs/design/WORKFLOW-LOG.md` — This file
- `docs/design/STATUS.md` — Project status tracker
