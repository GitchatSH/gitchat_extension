# QA: WP4 Tab Layout

> **Branch:** slug-wp4-tab-layout-v2
> **Date:** 2026-04-14
> **Tester:** slugmacro

## How to test

1. `npm run compile` (must pass)
2. Press **F5** in VS Code to launch Extension Development Host
3. Sign in with GitHub
4. Walk through checklist below

---

## 1. Tab Structure

- [ ] 1.1 Three tabs visible: **Chat** | **Friends** | **Discover**
- [ ] 1.2 No "Inbox", "Channels", "Feed", "Trending" text anywhere
- [ ] 1.3 Chat tab is active by default on fresh launch
- [ ] 1.4 Tab underline/accent indicator shows on active tab
- [ ] 1.5 Clicking each tab switches content correctly

## 2. Chat Tab — Filter Chips

- [ ] 2.1 Filter bar shows: **All** | **DM** | **Groups** | **Communities** | **Teams**
- [ ] 2.2 "All" is active by default (highlighted)
- [ ] 2.3 Clicking "DM" shows only DM conversations (`type === "direct"`)
- [ ] 2.4 Clicking "Groups" shows only group conversations (`type === "group"`)
- [ ] 2.5 Clicking "Communities" shows only community conversations (may be empty)
- [ ] 2.6 Clicking "Teams" shows only team conversations (may be empty)
- [ ] 2.7 Clicking "All" again shows all conversations
- [ ] 2.8 Only one chip active at a time
- [ ] 2.9 Count badges update correctly per filter (format: "(N)")

## 3. Chat Tab — Type Display

- [ ] 3.1 DM conversations: **round** avatar + green dot (online) or gray dot (offline)
- [ ] 3.2 Group conversations: **square rounded** avatar (6px radius) + `codicon-organization` prefix before name (muted color)
- [ ] 3.3 Community conversations: **square rounded** avatar + `codicon-star` prefix before name (muted color)
- [ ] 3.4 Team conversations: **square rounded** avatar + `codicon-git-pull-request` prefix before name (muted color)
- [ ] 3.5 Icons are muted color (`--gs-muted`), not colored
- [ ] 3.6 Clicking conversation still opens chat view correctly

## 4. Chat Tab — Conversation List

- [ ] 4.1 Conversations sorted by last message time (newest first)
- [ ] 4.2 Pinned conversations at top, pin icon next to timestamp (not before name)
- [ ] 4.3 Unread badge (`.gs-badge` styling) shows on unread conversations
- [ ] 4.4 Last message preview with ellipsis overflow
- [ ] 4.5 Timestamp shows (2m, 15m, 1h, 2d, etc.)
- [ ] 4.6 Draft prefix "Draft:" shows on conversations with unsent text
- [ ] 4.7 Muted conversations appear dimmed with bell-slash icon
- [ ] 4.8 Typing indicator shows "typing..." in conversation preview
- [ ] 4.9 Empty state shows when no conversations
- [ ] 4.10 Empty state when filter active, no matches: "No [type] conversations"
- [ ] 4.11 Right-click context menu works (Pin/Unpin, Mark as read, Delete)

## 5. Friends Tab — Accordion

- [ ] 5.1 Three sections visible: **ONLINE** | **OFFLINE** | **NOT ON GITCHAT**
- [ ] 5.2 "ONLINE" section header is **green** text (`--gs-success`)
- [ ] 5.3 "OFFLINE" section header is **muted** text (`--gs-muted`)
- [ ] 5.4 "NOT ON GITCHAT" section header is **dimmed** text (muted + opacity 0.5)
- [ ] 5.5 Count badge visible on each section header
- [ ] 5.6 Online count badge has green tint background

## 6. Friends Tab — Accordion Behavior

- [ ] 6.1 Click header to collapse section (chevron rotates -90deg)
- [ ] 6.2 Click header again to expand (chevron rotates back)
- [ ] 6.3 Multiple sections can be open simultaneously
- [ ] 6.4 Collapsed sections still show count badge
- [ ] 6.5 **State persists:** collapse section → switch to Chat tab → back to Friends → still collapsed
- [ ] 6.6 **State persists across sidebar hide/show:** collapse → hide sidebar → show → preserved
- [ ] 6.7 Keyboard: Tab to header, Enter/Space toggles expand/collapse

## 7. Friends Tab — Content

- [ ] 7.1 Online friends: avatar with green dot + username + DM button (ghost)
- [ ] 7.2 Offline friends: dimmed avatar (opacity 0.5) + username + "· Xh ago" + DM button
- [ ] 7.3 Not on GitChat: placeholder "Coming soon" (section collapsed by default)
- [ ] 7.4 DM button click opens new chat (doesn't navigate to profile)
- [ ] 7.5 Row click opens profile view
- [ ] 7.6 Profile card hover works on avatars
- [ ] 7.7 "Not on GitChat" section collapsed by default
- [ ] 7.8 Tab-level empty state: "Follow people on GitHub to see them here" (when no friends)

## 8. Discover Tab — Accordion

- [ ] 8.1 Four sections: **PEOPLE** | **COMMUNITIES** | **TEAMS** | **ONLINE NOW**
- [ ] 8.2 People section shows people you follow (same data as Friends)
- [ ] 8.3 Communities section shows repo channels (from `setChannelData`)
- [ ] 8.4 Teams section shows placeholder: "Contribute to repos to join their teams"
- [ ] 8.5 Online Now section shows online friends with green dot
- [ ] 8.6 Count badges on each section header

## 9. Discover Tab — Accordion Behavior

- [ ] 9.1 Same collapse/expand behavior as Friends tab
- [ ] 9.2 State persists separately from Friends tab accordion state
- [ ] 9.3 "Teams" section collapsed by default
- [ ] 9.4 Keyboard accessibility (Enter/Space toggles)

## 10. Discover Tab — Content

- [ ] 10.1 People: avatar + username + DM button (ghost)
- [ ] 10.2 Communities: `codicon-star` (muted) + repo name + member count + Join/Joined button
- [ ] 10.3 Clicking community row calls joinCommunity handler
- [ ] 10.4 Online Now: avatar with green dot + username + **Wave** button (disabled, "Coming soon" tooltip)
- [ ] 10.5 Empty states show with Codicon icons and helpful messages
- [ ] 10.6 DM button click opens chat (stopPropagation, doesn't trigger row click)

## 11. Search

- [ ] 11.1 Search placeholder changes per tab: "Search messages..." / "Search friends..." / "Search..."
- [ ] 11.2 Search on Chat tab calls BE search (debounced 300ms)
- [ ] 11.3 Search on Friends tab filters friends across all sections (instant, client-side)
- [ ] 11.4 Search on Discover tab filters across all sections (instant, client-side)
- [ ] 11.5 Clear search restores full list
- [ ] 11.6 Switching tabs clears search input and resets state
- [ ] 11.7 Search + chip filter: when chip active, search results post-filtered by type

## 12. Navigation & State

- [ ] 12.1 Click conversation → chat opens → back button → returns to correct tab
- [ ] 12.2 Tab state persists after closing/reopening sidebar
- [ ] 12.3 Old persisted state ("inbox"/"channels") migrates gracefully to "chat"/"discover"
- [ ] 12.4 Main tab badge (unread count) still works on Chat tab
- [ ] 12.5 Scroll position preserved per tab (switch away, switch back = same scroll)

## 13. Loading & Error States

- [ ] 13.1 Skeleton loading rows show while chat data loads (pulsing animation)
- [ ] 13.2 "Searching..." shows while Chat search is in-flight
- [ ] 13.3 Error state with Retry button shows when Chat search fails
- [ ] 13.4 Retry button re-triggers search

## 14. Existing Features Preserved

- [ ] 14.1 Right-click context menu on conversations (Pin/Unpin, Mark as read, Delete)
- [ ] 14.2 Typing indicator shows in conversation preview
- [ ] 14.3 Draft prefix shows on conversations with unsent text
- [ ] 14.4 Muted conversations appear dimmed with bell-slash icon
- [ ] 14.5 Profile card hover popover works on avatars
- [ ] 14.6 User menu (settings, sign out) works
- [ ] 14.7 Notification section works (if present)

## 15. Visual / Design System

- [ ] 15.1 No hardcoded colors (everything uses --gs-* tokens)
- [ ] 15.2 Looks correct in both dark and light VS Code themes
- [ ] 15.3 No emoji in UI (only Codicons)
- [ ] 15.4 Font sizes >= 11px everywhere
- [ ] 15.5 Spacing follows 4px grid
- [ ] 15.6 Extension looks native to VS Code (not like embedded web app)

## 16. Cleanup Verification

- [ ] 16.1 No "Feed" or "Trending" references in UI
- [ ] 16.2 No broken references in console (open DevTools: Help → Toggle Developer Tools)
- [ ] 16.3 No dead click handlers or broken navigation

---

## Bug Log

| # | Area | Description | Status |
|---|------|-------------|--------|
| | | | |
