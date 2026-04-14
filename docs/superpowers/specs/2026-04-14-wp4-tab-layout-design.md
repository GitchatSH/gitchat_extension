# WP4 Tab Layout — Design Spec

> **Date:** 2026-04-14
> **Author:** slugmacro
> **Branch:** (new branch from develop)
> **Approach:** Monolith — all logic in explore.js/explore.css, rewrite from scratch

## Overview

Restructure the main Explore panel from `Inbox | Friends | Channels` to **Chat | Friends | Discover**. Remove all Feed/Trending dead code. Add filter chips, accordion sections, type-aware conversation display, and tab-aware search.

## 1. Tab Structure

### Tabs
- Three main tabs: **Chat** | **Friends** | **Discover**
- HTML: `data-tab="chat"`, `data-tab="friends"`, `data-tab="discover"`
- Default active: **Chat**
- Use existing `.gs-main-tab` / `.gs-main-tab.active` from shared.css

### State Persistence
- `chatMainTab` persisted via `vscode.setState()`
- Backward compat: old `"inbox"` migrates to `"chat"`, `"channels"` migrates to `"discover"`
- Fallback: if `chatMainTab` is not one of `"chat"`, `"friends"`, `"discover"`, default to `"chat"`
- Accordion state stored separately: `accordionState.friends`, `accordionState.discover`

## 2. Chat Tab

### Filter Chips
- Bar: **All** | **DM** | **Groups** | **Communities** | **Teams**
- **"All" is active by default**
- Single-select, client-side filtering by `conversation.type`
  - `"direct"` → DM chip
  - `"group"` → Groups chip
  - `"community"` → Communities chip (WP5 extends `Conversation.type` to include this)
  - `"team"` → Teams chip (WP5 extends `Conversation.type` to include this)
- Each chip shows count badge
- Use `.gs-chip` / `.gs-chip.active` from shared.css
- Filter bar visible only on Chat tab
- Keyboard: Tab focuses chip bar, arrow keys move between chips, Enter/Space activates
- ARIA: `role="radiogroup"` on bar, `role="radio"` + `aria-checked` on each chip

### Conversation List
- Sorted by `lastMessageAt` (newest first)
- Pinned conversations at top (keep existing logic, with pin icon indicator)
- Unread badge using existing `.gs-badge` class (uses `--gs-badge-bg` / `--gs-badge-fg` tokens)
- Last message preview with ellipsis overflow
- Relative timestamp (2m, 15m, 1h, 2d, etc.)

### Type Display
Conversations are visually differentiated by avatar shape and name prefix icon:

| Type | Avatar Shape | Name Prefix Icon | Icon Color |
|------|-------------|-------------------|------------|
| DM | Round `.gs-avatar-md` (`border-radius: 50%`) | None | — |
| Group | Square rounded `.gs-avatar-md` (`border-radius: 6px` override) | Keep current group icon | `--gs-muted` (text color) |
| Community | Square rounded `.gs-avatar-md` (`border-radius: 6px` override) | `codicon-star` | `--gs-muted` (text color) |
| Team | Square rounded `.gs-avatar-md` (`border-radius: 6px` override) | `codicon-git-pull-request` | `--gs-muted` (text color) |

### DM Online/Offline Indicator
- Online: green dot (8px) on avatar bottom-right — use existing `.gs-dot-online` from shared.css
- Offline: gray dot (8px) on avatar bottom-right — use existing `.gs-dot-offline` from shared.css
- Dot positioned via a wrapper div (see Section 9 for CSS pattern)

### Search + Filter Interaction
- When a filter chip is active AND search is used: search results are further filtered by the active chip type
- Chat search calls BE `searchInboxMessages` (debounce 300ms). BE results are not type-filtered (BE doesn't support it), so client-side post-filter applies the active chip
- On tab switch: cancel any inflight search, clear search input and state

### Empty States
- No conversations: "No conversations yet"
- Filter active, no matches: "No [type] conversations"

## 3. Friends Tab — Accordion

Three collapsible accordion sections, each independent:

| Section | Header Text | Header Color | Default State | Sort Order |
|---------|------------|-------------|---------------|------------|
| Online | `ONLINE` | Green (`--gs-success`) | Expanded | Alphabetical |
| Offline | `OFFLINE` | Muted (`--gs-muted`) | Expanded | Last seen (most recent first) |
| Not on GitChat | `NOT ON GITCHAT` | `--gs-muted` at `opacity: 0.5` | Collapsed | Alphabetical |

### Row Content

| Section | Layout |
|---------|--------|
| Online | Round avatar + green dot + username + DM button (`.gs-btn-ghost`) |
| Offline | Round avatar at `opacity: 0.5` + username + `· Xh ago` + DM button (`.gs-btn-ghost`) |
| Not on GitChat | Avatar with `filter: grayscale(1)` + username + Invite button (`.gs-btn-primary`) |

### Section Headers
- Count badge on each header
- Online count badge has green tint background: `background: color-mix(in srgb, var(--gs-success) 15%, transparent)`
- Use `.gs-accordion-header`, `.gs-accordion-chevron`, `.gs-accordion-body` from shared.css

### Behavior
- Click header toggles `.collapsed` class on **both** header (for chevron) and body (for content hide)
- Multiple sections can be open simultaneously
- State persisted via `vscode.setState()` → `accordionState.friends`
- State persists across: tab switching, sidebar hide/show
- Keyboard: Tab to header, Enter/Space toggles
- ARIA: `role="button"`, `aria-expanded`, `aria-controls` on headers
- Collapse/expand is instant (`display: none` toggle), no animation

### Interactions
- Row click → open profile view
- DM button click → open chat (does NOT navigate to profile — must `stopPropagation`)
- Invite button click → tooltip "Coming soon" (placeholder)

### Data Source
- `chatFriends` array from `setChatData` message
- Online/Offline determined by `friend.online` boolean
- "Not on GitChat" — placeholder accordion section, shows empty state: "Coming soon" inside body (needs BE mutual follow API)

### Tab-level Empty State
- If `chatFriends` is empty (no friends at all): show centered empty state "Follow people on GitHub to see them here" with `codicon-person-add` icon

## 4. Discover Tab — Accordion

Four collapsible accordion sections:

| Section | Header Text | Default State | Data Source |
|---------|------------|---------------|-------------|
| People | `PEOPLE` | Expanded | GitHub followings (reuse `chatFriends` for now — intentionally same as Friends until dedicated suggestions API) |
| Communities | `COMMUNITIES` | Expanded | `channels` from `setChannelData` |
| Teams | `TEAMS` | Collapsed | Placeholder (needs BE API) |
| Online Now | `ONLINE NOW` | Expanded | `chatFriends.filter(f => f.online)` |

### Row Content

| Section | Layout |
|---------|--------|
| People | Round avatar + username + DM button (`.gs-btn-ghost`) |
| Communities | `codicon-star` (muted) + repo name + member count + Join/Joined button |
| Teams | Placeholder empty state: "Contribute to repos to join their teams" |
| Online Now | Round avatar + green dot + username + Wave button (`.gs-btn-ghost[disabled]`, `opacity: 0.5`, `cursor: not-allowed`, native `title="Coming soon"` tooltip) |

### Behavior
- Same accordion behavior as Friends tab (collapse class, persist, keyboard, ARIA)
- State persisted separately: `accordionState.discover`
- Click community row → open channel
- Click people row → open profile
- DM button click → open chat (must `stopPropagation`)

### Empty States
- Each section has its own empty state with Codicon icon + descriptive message

## 5. Search

### Single Search Bar
- Always visible below tabs, above content
- Placeholder changes per active tab:
  - Chat: `"Search messages..."`
  - Friends: `"Search friends..."`
  - Discover: `"Search..."`

### Search Behavior
- **Chat tab**: calls BE `searchInboxMessages` (debounce 300ms, keep existing logic). Results post-filtered by active chip type
- **Friends tab**: client-side filter by username across all 3 accordion sections (instant, no debounce)
- **Discover tab**: client-side filter by name across all 4 sections (instant, no debounce)
- Clear search restores full list
- **On tab switch**: clear search input, cancel inflight requests, reset search state

### Search Empty States
- Chat search no results: "No messages found"
- Friends/Discover search no results: "No results for '[query]'"

## 6. Navigation & State

- Click conversation → chat opens → back button → returns to correct tab
- Tab state persists after closing/reopening sidebar
- Old persisted state migrates gracefully (`"inbox"` → `"chat"`, `"channels"` → `"discover"`, unknown values → `"chat"`)
- Main tab badge (unread count) still works on Chat tab
- **Scroll position**: each tab has its own scrollable container. Scroll position is preserved when switching tabs (save on leave, restore on enter)

## 7. Cleanup

- Remove all "Feed" and "Trending" references from UI
- Remove dead code: Feed/Trending variables, render functions, message handlers
- Remove "Requests" and "Unread" filter chips (replaced by new chip set)
- Keep code that serves other purposes (e.g., trending data used elsewhere)
- Replace any emoji in UI with Codicons
- Verify no broken references in console (DevTools)
- Verify no dead click handlers or broken navigation

## 8. Existing Behaviors to Preserve

These features exist in the current `explore.js` and **must be kept** in the rewrite:

| Feature | Current Location | Notes |
|---------|-----------------|-------|
| **Context menu** (right-click conversation) | Pin/Unpin, Mark as read, Delete | Keep as-is |
| **Typing indicator** | `chatTypingUsers`, `friendTyping` handler | Show "typing..." in conversation preview |
| **Draft display** | "Draft:" prefix on conversation row | Keep as-is |
| **Muted conversations** | `conv-muted` class, bell-slash icon, sort deprioritization | Keep as-is |
| **Profile card hover** | Hover on avatar shows profile popover | Keep binding on avatars |
| **SidebarChat integration** | `pushChatView()` / `popChatView()`, nav stack slide | Keep slide transition and scroll save/restore |
| **Notification system** | `setNotifications` handler, notification section | Keep as-is |
| **User menu** | Settings toggle, sign out | Keep as-is |
| **Presence updates** | Real-time online/offline via `setChatData` refresh | Rows update in real-time on Friends/Discover tabs |

## 9. Loading & Error States

### Loading States
- **Chat tab**: skeleton rows (3-4 placeholder conversation rows with pulsing animation) while `setChatData` loads
- **Friends tab**: skeleton rows per accordion section while friend data loads
- **Discover tab**: skeleton rows per section while data loads
- Skeleton pattern: gray bars pulsing with `@keyframes` and `@media (prefers-reduced-motion: reduce)` guard to disable animation
- **Chat search loading**: show "Searching..." text below search bar while BE request is in-flight

### Error States
- **Chat search fails**: inline error message "Search failed" with retry link below search bar
- **Data fetch fails**: empty state with `codicon-warning` + "Something went wrong" + retry button
- Retry button uses `.gs-btn.gs-btn-secondary`

## 10. DM Online/Offline Dot — CSS Pattern

The online/offline dot on DM avatars uses existing `.gs-dot-online` / `.gs-dot-offline` from shared.css, positioned via a wrapper:

```css
.conv-avatar-wrap {
  position: relative;
  display: inline-flex;
  width: 36px;
  height: 36px;
  flex-shrink: 0;
}
.conv-avatar-wrap .gs-dot-online,
.conv-avatar-wrap .gs-dot-offline {
  position: absolute;
  bottom: -1px;
  right: -1px;
  border: 1.5px solid var(--gs-bg);
}
```

This wraps the avatar `<img>` in a sized `position: relative` div and positions the existing dot classes absolutely.

## 11. Visual / Design System Compliance

- No hardcoded colors — all `--gs-*` tokens
- No emoji — Codicons only
- Font sizes >= 11px
- Spacing follows 4px grid
- Must look correct in both dark and light VS Code themes
- Extension must look native to VS Code
- `@media (prefers-reduced-motion: reduce)` guard on all animations

## 12. Files to Modify

| File | Changes |
|------|---------|
| `src/webviews/explore.ts` | Tab HTML, filter chip HTML, postMessage data flow |
| `media/webview/explore.js` | Tab switching, accordion logic, render functions, state persistence |
| `media/webview/explore.css` | Accordion colors, avatar shapes, icon prefix, filter chips, skeleton loading |
| `media/webview/shared.css` | No changes expected (reuse existing components) |

## 13. Out of Scope (Blocked by BE)

- "Not on GitChat" friends section — needs mutual follow detection API
- Communities in Discover — partially available via `setChannelData`, full list needs starred repos API
- Teams in Discover — needs contributed repos API
- ~~Communities/Teams filter chips~~ — resolved: WP5 adds `community`/`team` to `Conversation.type`
- Online Now global endpoint — currently reuses `chatFriends` online subset
- Wave button functionality — needs WP5+WP8
