# Create DM/Group Flow — Design Spec

> **Date:** 2026-04-14
> **Author:** slugmacro
> **Type:** UI Design Spec
> **Status:** Approved

## Overview

Add Telegram-style create DM and create group flows to the sidebar. Triggered from VS Code title bar icon, implemented as full-page slides within the webview.

## Trigger

- User clicks existing 💬 icon on VS Code title bar (`trending.newChat` command)
- Extension sends `showNewChatMenu` message to webview
- Webview shows dropdown menu with 2 options: "New Message" and "New Group"
- Dropdown uses existing `gs-dropdown` component (`#new-chat-menu` already in HTML)

### Change from current behavior
- Currently: `showNewChatMenu` → `doAction("newChat")` → VS Code QuickPick
- New: `showNewChatMenu` → show `#new-chat-menu` dropdown in webview

---

## Flow 1: New Message (DM)

### Layout
Full-page slide panel (same pattern as group info panel):
- **Header**: `← New Message` (back button + title, 44px height)
- **Search input**: below header, same style as chat search (`gs-input` look)
- **User list**: scrollable list below search

### User List
- **Default (no query)**: show `chatFriends` sorted alphabetically
- **With query**: filter friends locally + call API search for additional users
- Each row: avatar (32px round) + name + @login
- Row hover: `--gs-hover` background
- **Click row** → send `newChat` message with `{ login }` → extension opens/creates DM → slide panel out → chat opens

### Search
- Input with `codicon-search` icon, same style as tab search bar
- Debounce 300ms before API call
- Local filter instant (no debounce)
- API: reuse `chat:searchUsersForGroup` message type (already exists)
- Results merge: friends first (filtered), then API results (deduplicated)

### Animation
- Slide in from right: `transform: translateX(100%) → translateX(0)`, 0.2s ease-out
- Slide out to right on back/select: reverse animation

### Empty/Loading States
- **Loading API search**: spinner in search input
- **No results**: "No users found"
- **No friends**: "Follow people on GitHub to see them here"

---

## Flow 2: New Group (2 Steps)

### Step 1: Pick Members

#### Layout
Full-page slide panel:
- **Header**: `← New Group` + `Next` button (right side, disabled when 0 members selected)
- **Selected chips**: horizontal scrollable row below header showing selected members as chips (avatar 20px + name + ✕ remove)
- **Search input**: below chips
- **User list**: scrollable, same as DM flow but with multi-select

#### Multi-select behavior
- Click user row → add to selected (row shows checkmark, chip appears)
- Click again → remove from selected (checkmark gone, chip removed)
- Click ✕ on chip → remove from selected
- `Next` button enables when ≥ 1 member selected

#### User list
- Same source as DM: friends + API search
- Selected users show checkmark icon on right
- Already-selected users highlighted with `--gs-hover` background

### Step 2: Group Info

#### Layout
Full-page slide (replaces Step 1 with slide animation):
- **Header**: `← New Group` + `Create` button (right side)
- **Group avatar**: 64px placeholder, centered (tap to change — future, disabled for now)
- **Group name input**: text input below avatar, placeholder "Group name"
- **Members list**: read-only list of selected members (avatar 24px + name), scrollable

#### Create action
- `Create` button disabled when group name is empty
- Click `Create` → send `createGroup` message with `{ name, memberLogins: [...] }`
- Extension creates group via API → opens chat → slide panel out
- If API error: show toast "Failed to create group"

### Animation
- Step 1 → Step 2: slide left (Step 1 slides out left, Step 2 slides in from right)
- Step 2 back → Step 1: reverse
- Step 1 back → close panel, restore chat list

---

## Implementation Details

### Files to modify
- `media/webview/explore.js` — dropdown toggle, panel show/hide
- `media/webview/sidebar-chat.js` — new DM/group panel functions (reuse pattern from group info panel)
- `media/webview/sidebar-chat.css` — panel styles
- `src/webviews/explore.ts` — message handlers for search results

### Reuse
- Dropdown: `#new-chat-menu` HTML already exists in explore.ts
- Search: `chat:searchUsersForGroup` message handler already exists
- Create group: `trending.createGroup` command already exists
- Panel pattern: same as `gs-sc-gi-panel` (group info)
- Animation: same keyframes as group info panel (`gs-sc-gi-slide-in/out`)

### New message types
- `showNewDMPanel` — extension → webview, trigger DM panel
- `showNewGroupPanel` — extension → webview, trigger Group panel
- `dmCreated` — extension → webview, DM conversation created, open chat
- `groupCreated` — extension → webview, group created, open chat
- `userSearchResults` — extension → webview, search results for user picker

### Design Tokens
All UI uses existing `--gs-*` tokens:
- Panel bg: `--gs-bg`
- Header: `--gs-bg-secondary`, 44px height
- Input: `--gs-input-bg`, `--gs-input-border`, `--gs-radius-sm`
- Chips: `--gs-button-secondary-bg`, `--gs-radius-pill`
- Checkmark: `--gs-success`
- Next/Create button: `--gs-button-bg`, `--gs-button-fg`
- Hover: `--gs-hover`
- Error: `--gs-error`
