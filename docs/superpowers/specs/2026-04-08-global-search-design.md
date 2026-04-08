# Global Search — Design Spec

**Date:** 2026-04-08
**Status:** Approved
**Branch:** hiru-uiux

---

## Overview

Add inline global search to the Explore panel. A custom header with logo + search input replaces the native VS Code title bar as the primary entry point. Search results replace tab content, showing repos and people in two sections.

## Requirements

### Header Layout
- Custom header row (36px) at top of webview, above existing tabs
- Left: `sidebar-icon.svg` logo (16x16), padding-left 12px
- Right: search input (flex-grow), margin-left 8px, margin-right 12px
- Input has `codicon-search` icon inside (left), `codicon-close` button (right, visible only when text present)
- Background: `--gs-bg`, border-bottom: 1px solid `--gs-divider`
- Sticky, z-index 21

### Native Title Bar
- Set view name to `" "` (minimal) in `package.json`
- Remove `view/title` menu actions for explore view
- Move sign-out into webview settings dropdown (already exists)

### Search Flow

**States:**
1. **Idle** — input empty, placeholder "Search repos & people...", tabs visible normally
2. **Typing** — debounce 300ms, then call API `/search?q={query}`
3. **Loading** — spinner replaces search icon in input
4. **Results** — tabs + tab content hidden, search results shown full-height below header
5. **Empty results** — message "No results for '{query}'"
6. **Error** — message "Search failed. Try again."
7. **Clear** (click X / delete all text / press Escape) — restore previous active tab + content

**Min query:** 2 characters before API call.

**Cancel:** new keystrokes cancel in-flight requests (debounce handles this).

### Search Results Layout

Results cover tabs bar entirely — full content area from header down.

Two collapsible sections:

```
▸ Repos (N)
┌────────────────────────────┐
│ ⊙ owner/name         ★123k│
│   Description text...      │
├────────────────────────────┤
│ ⊙ owner/name2        ★45k │
│   Description text...      │
└────────────────────────────┘

▸ People (N)
┌────────────────────────────┐
│ 👤 @username     [Follow]  │
│   Bio text...              │
├────────────────────────────┤
│ 👤 @username2      [Chat]  │
│   Bio text...              │
└────────────────────────────┘
```

### Result Interactions

| Element | Action |
|---|---|
| Repo row click | Open RepoDetailPanel |
| People row click | Open ProfilePanel |
| Follow button (not followed) | Call follow API, optimistic update to Chat button |
| Chat button (already followed) | Open DM panel |

### Keyboard
- `Enter` — trigger search immediately (skip debounce)
- `Escape` — clear input, return to tabs
- Arrow key navigation in results — v2 enhancement, not required for v1

## Technical Design

### HTML Structure (in `explore.ts`)

```
.explore-root
  ├── .explore-header          ← NEW
  │     ├── img.explore-logo
  │     └── .search-wrapper
  │           ├── span.codicon-search
  │           ├── input.gs-input#global-search
  │           └── button.codicon-close
  ├── .explore-tabs            ← hidden when searchMode
  ├── .explore-content         ← hidden when searchMode
  └── .search-results          ← NEW, hidden when !searchMode
        ├── .search-section "Repos"
        │     └── .search-repo-list
        └── .search-section "People"
              └── .search-people-list
```

### State Management (in `explore.js`)

- `searchMode: boolean` — toggles tabs content vs search results
- `previousActiveTab: string` — saved before entering search mode, restored on clear
- Debounce timer (300ms) for API calls
- Scroll position preserved per tab when switching

### Message Passing

- Webview → Extension: `{ type: "globalSearch", payload: { query } }`
- Extension → Webview: `{ type: "globalSearchResults", payload: { repos[], users[] } }`
- Extension → Webview: `{ type: "globalSearchError" }`
- Webview → Extension: `{ type: "followUser", payload: { login } }` (existing)
- Webview → Extension: `{ type: "openProfile", payload: { login } }` (existing)
- Webview → Extension: `{ type: "openRepo", payload: { owner, name } }` (existing)
- Webview → Extension: `{ type: "openDM", payload: { login } }`

### CSS (in `explore.css`)

- `.explore-header` — sticky top 0, z-index 21, height 36px, flex row, align-center
- `.search-wrapper` — flex-grow, position relative (for icon overlays)
- `.search-results` — overflow-y auto, fill remaining height
- `.search-section` — collapsible header with count, `--gs-font-sm`
- Reuse existing card/list styles from trending for repo items

### Files Changed

| File | Change |
|---|---|
| `src/webviews/explore.ts` | Add header HTML, search message handlers |
| `media/webview/explore.js` | Search state, debounce, render results, event handlers |
| `media/webview/explore.css` | Header, search wrapper, results styles |
| `package.json` | Minimize view name, remove view/title menu items |
| `src/api/index.ts` | No change (search API already exists) |
| `src/types/index.ts` | No change (SearchResult type already exists) |

## Out of Scope (v2+)

- Search history / recent searches
- Search suggestions / autocomplete
- Keyboard navigation in results list
- Advanced filters (language, stars, date)
- Search home with trending keywords
