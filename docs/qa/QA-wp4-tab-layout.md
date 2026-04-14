# QA: WP4 Tab Layout

> **Branch:** slug-wp4-tab-layout
> **Date:** 2026-04-13
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
- [ ] 1.4 Tab underline indicator shows on active tab
- [ ] 1.5 Clicking each tab switches content correctly

## 2. Chat Tab — Filter Chips

- [ ] 2.1 Filter bar shows: **All** | **DM** | **Groups** | **Communities** | **Teams**
- [ ] 2.2 "All" is active by default (highlighted)
- [ ] 2.3 Clicking "DM" shows only DM conversations
- [ ] 2.4 Clicking "Groups" shows only group conversations
- [ ] 2.5 Clicking "Communities" shows only community conversations (may be empty)
- [ ] 2.6 Clicking "Teams" shows only team conversations (may be empty)
- [ ] 2.7 Clicking "All" again shows all conversations
- [ ] 2.8 Only one chip active at a time
- [ ] 2.9 Count badges update correctly per filter

## 3. Chat Tab — Type Badges

- [ ] 3.1 DM conversations: round avatar, **no** badge (green dot if online)
- [ ] 3.2 Group conversations: square-ish avatar + **purple organization** badge
- [ ] 3.3 Community conversations: square-ish avatar + **orange star** badge
- [ ] 3.4 Team conversations: square-ish avatar + **gold gear** badge
- [ ] 3.5 Badge is 12-14px, positioned bottom-right of avatar
- [ ] 3.6 Clicking conversation still opens chat view correctly

## 4. Chat Tab — Conversation List

- [ ] 4.1 Conversations sorted by last message time (newest first)
- [ ] 4.2 Unread badge (teal circle with count) shows on unread conversations
- [ ] 4.3 Last message preview with ellipsis overflow
- [ ] 4.4 Timestamp shows (2m, 15m, 1h, 2d, etc.)
- [ ] 4.5 Empty state shows when no conversations: "No conversations yet"
- [ ] 4.6 Empty state when filter active, no matches: "No [type] conversations"

## 5. Friends Tab — Accordion

- [ ] 5.1 Three sections visible: **Online** | **Offline** | **Not on GitChat**
- [ ] 5.2 "Online" section header is **green** text
- [ ] 5.3 "Offline" section header is **gray/muted** text
- [ ] 5.4 "Not on GitChat" section header is **dimmed** text
- [ ] 5.5 Count badge visible on each section header
- [ ] 5.6 Online count badge has green tint background

## 6. Friends Tab — Accordion Behavior

- [ ] 6.1 Click header to collapse section (chevron rotates)
- [ ] 6.2 Click header again to expand (chevron rotates back)
- [ ] 6.3 Multiple sections can be open simultaneously
- [ ] 6.4 Collapsed sections still show count badge
- [ ] 6.5 **State persists:** collapse a section → switch to Chat tab → switch back to Friends → section still collapsed
- [ ] 6.6 **State persists across sidebar hide/show:** collapse sections → hide sidebar → show sidebar → state preserved
- [ ] 6.7 Keyboard: Tab to header, Enter/Space toggles expand/collapse

## 7. Friends Tab — Content

- [ ] 7.1 Online friends: avatar with green dot + username + DM button
- [ ] 7.2 Offline friends: dimmed avatar + username + "· Xh ago" + DM button
- [ ] 7.3 Not on GitChat: grayscale avatar + username + **Invite** button (blue)
- [ ] 7.4 DM button click opens new chat (doesn't navigate to profile)
- [ ] 7.5 Row click opens profile view
- [ ] 7.6 "Not on GitChat" section collapsed by default

## 8. Discover Tab — Accordion

- [ ] 8.1 Four sections: **People** | **Communities** | **Teams** | **Online Now**
- [ ] 8.2 People section shows people you follow
- [ ] 8.3 Communities section shows repo channels (if any)
- [ ] 8.4 Teams section shows placeholder: "Contribute to repos to join their teams"
- [ ] 8.5 Online Now section shows online friends with green dot
- [ ] 8.6 Count badges on each section header

## 9. Discover Tab — Accordion Behavior

- [ ] 9.1 Same collapse/expand behavior as Friends tab
- [ ] 9.2 State persists separately from Friends tab accordion state
- [ ] 9.3 "Teams" section collapsed by default
- [ ] 9.4 Keyboard accessibility (Enter/Space toggles)

## 10. Discover Tab — Content

- [ ] 10.1 People: avatar + username + DM button
- [ ] 10.2 Communities: star icon (orange) + repo name + member count + Join/Joined button
- [ ] 10.3 Clicking community row opens channel
- [ ] 10.4 Online Now: avatar with green dot + username + **Wave** button (disabled, "Coming soon" tooltip)
- [ ] 10.5 Empty states show with Codicon icons and helpful messages

## 11. Search

- [ ] 11.1 Search placeholder changes per tab: "Search messages..." / "Search friends..." / "Search communities..."
- [ ] 11.2 Search on Chat tab filters conversations
- [ ] 11.3 Search on Friends tab filters friends across all 3 sections
- [ ] 11.4 Clear search restores full list

## 12. Navigation & State

- [ ] 12.1 Click conversation → chat opens → back button → returns to correct tab
- [ ] 12.2 Tab state persists after closing/reopening sidebar
- [ ] 12.3 Old persisted state ("inbox"/"channels") migrates gracefully to "chat"/"discover"
- [ ] 12.4 Main tab badge (unread count) still works on Chat tab

## 13. Visual / Design System

- [ ] 13.1 No hardcoded colors (everything uses --gs-* tokens)
- [ ] 13.2 Looks correct in both dark and light VS Code themes
- [ ] 13.3 No emoji in UI (only Codicons)
- [ ] 13.4 Font sizes ≥ 11px everywhere
- [ ] 13.5 Spacing follows 4px grid
- [ ] 13.6 Extension looks native to VS Code (not like embedded web app)

## 14. Cleanup Verification

- [ ] 14.1 No "Feed" or "Trending" references in UI
- [ ] 14.2 No broken references in console (open DevTools: Help → Toggle Developer Tools)
- [ ] 14.3 No dead click handlers or broken navigation

---

## Bug Log

| # | Area | Description | Status |
|---|------|-------------|--------|
| | | | |
