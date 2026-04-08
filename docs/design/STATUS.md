# Project Status

## Current State
- Branch: `hiru-uiux`
- Base: `main`
- Last updated: 2026-04-07

## Completed
- Full UI audit (CSS, JS, TS providers)
- Design guidelines document (`docs/design/DESIGN.md`)
- Mockup for Explore tabs redesign (3 tabs: Chat | Feed | Trending)
- Updated mockup: Social → Chat tab, content redistribution
- **Unified Explore tabs implementation:**
  - Single `ExploreWebviewProvider` replacing 7 separate views
  - Removed `chatSidebar` — Chat merged into Explore tabs
  - Converted TreeViews (trending repos, people, my repos) to HTML rendering
  - VS Code-style tab bar with codicon icons (comment-discussion, rss, rocket)
  - Collapsible accordion sections with codicon chevrons
  - VS Code Explorer-style layout: sticky headers, independent scroll per section
  - My Repos sticky bottom in Feed tab (collapsed by default)
  - Chat input font size increased (14px)
  - Focus outlines removed from interactive elements
  - Feed filter chips aligned with flex

## In Progress
- UI polish and testing

## Next Up
- Migrate CSS files to `--gs-*` tokens (chat.css, welcome.css, profile.css, repo-detail.css)
- Fix sanitizeReadme XSS vulnerability
- Unify button system to `.gs-btn`
- Remove deprecated files (inbox.js/css, friends.js/css, old provider files)

## Blockers
- None
