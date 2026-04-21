# Phase 1: LinkedIn-Style Layout Restructure

## Overview

Shift GitChat from chat-centric to community-centric layout. Demote Chat/Noti from main tabs to header icons with push view navigation. Add Feed tab as home screen with aggregated content from channel feeds + notifications.

**Branch:** `slug-linkedin-refactor` (LOCAL ONLY — never push to remote)

**Constraint:** No BE API changes. FE-only, using existing endpoints.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Layout | 3 tabs + header icons | Feed/Network/Explore as tabs, Chat/Noti/Profile as header push views |
| Sidebar-only | All UI in sidebar (300px) | VS Code sidebar is where devs glance — like LinkedIn mobile |
| Chat UX | Push view from header icon | Demotes chat from main tab, ← back returns to previous tab |
| Feed data | FE aggregation from existing APIs | Channel feeds (X/YouTube/Gitchat) + notifications, no new BE endpoint |
| Network tab | Rename Friends, keep accordion | Minimal change, save effort for Phase 3 |
| Explore tab | Rename Discover, keep accordion | Minimal change, save effort for Phase 4 |

## Header

```
┌──────────────────────────────────────────┐
│  GitChat              💬(2)  🔔(●)  [S]  │
└──────────────────────────────────────────┘
```

- **GitChat** — app title (left)
- **💬** — codicon-comment, chat badge (unread count). Tap → push Messaging view.
- **🔔** — codicon-bell, noti dot (red when unread). Tap → push Notifications view.
- **[S]** — user avatar (letter avatar fallback). Tap → push Profile menu.
- All icons use codicons, not emoji (emoji used here for readability only)
- Badge on 💬: same logic as current chat tab badge (`unread_count` from conversations)
- Dot on 🔔: red dot when `notificationStore.unreadCount > 0`

### Header HTML (in explore.ts)

Replace current header. Keep existing icon handlers (new chat, user menu) but restructure:

```html
<div class="gs-header">
  <span class="gs-header-title">GitChat</span>
  <div class="gs-header-actions">
    <button class="gs-header-icon" id="header-chat-btn" title="Messaging">
      <span class="codicon codicon-comment"></span>
      <span class="gs-header-badge" id="header-chat-badge" style="display:none"></span>
    </button>
    <button class="gs-header-icon" id="header-noti-btn" title="Notifications">
      <span class="codicon codicon-bell"></span>
      <span class="gs-header-dot" id="header-noti-dot" style="display:none"></span>
    </button>
    <button class="gs-header-icon gs-header-avatar" id="header-profile-btn" title="Profile">
      <!-- letter avatar or img -->
    </button>
  </div>
</div>
```

## Tabs

```
┌─────────┬─────────┬─────────┐
│  Feed   │ Network │ Explore │
└─────────┴─────────┴─────────┘
```

- **Feed** — default active tab (home screen)
- **Network** — current Friends tab content (renamed)
- **Explore** — current Discover tab content (renamed)
- Tab data attributes: `data-tab="feed"`, `data-tab="network"`, `data-tab="explore"`
- Remove `data-tab="chat"` and `data-tab="notifications"` from tab bar

### Tab State Migration

The current persisted state uses `chatMainTab` (not `chatSubTab`) in explore.js (line 2744). Values: `chat`, `friends`, `discover`.

**State key mapping:**
- `chatMainTab="chat"` → `activeTab="feed"` (feed is new default)
- `chatMainTab="friends"` → `activeTab="network"`
- `chatMainTab="discover"` → `activeTab="explore"`

**Scroll position key migration:**
- Current: `tabScrollPositions: { chat: 0, friends: 0, discover: 0 }`
- New: `tabScrollPositions: { feed: 0, network: 0, explore: 0 }`

**Nav stack migration:**
- Current: `navStack` is a string (`"list"` or `"chat"`)
- New: `navStack` is an array (`[{ type: "tab" }]`)
- Migration: if old string value detected, reset to `[{ type: "tab" }]`

`restoreState()` must detect old format and migrate. If `chatMainTab` exists but `activeTab` does not → apply mapping above.

## Push View Navigation

### Architecture

Extend existing `gs-nav-container` to support a **nav stack** with 3+ levels:

```
Level 0: Tab content (Feed / Network / Explore)
Level 1: Push view (Messaging inbox / Notifications / Profile menu)
Level 2: Push from push (Chat conversation from Messaging)
```

### Nav Stack Implementation

```javascript
// navStack = array of { type, data }
// type: "tab" | "messaging" | "notifications" | "profile" | "chat"
var _navStack = [{ type: "tab" }]; // always starts with tab

function pushView(type, data) {
  // Save current scroll position
  saveCurrentScrollPosition();
  // Hide current view
  hideCurrentView();
  // Push new view
  _navStack.push({ type, data });
  showView(type, data);
}

function popView() {
  if (_navStack.length <= 1) return; // can't pop tab level
  _navStack.pop();
  var current = _navStack[_navStack.length - 1];
  showView(current.type, current.data);
  restoreScrollPosition(current);
}
```

### CSS: Replace translateX Sliding with Show/Hide Stack

The current `gs-nav-container` uses `translateX(-100%)` CSS sliding between `gs-chat-list` and `gs-chat-view` (explore.css lines 379-413). This two-panel slide mechanism must be **completely replaced** with a show/hide stack system:

- Remove all `translateX` transitions and `.chat-active` class logic
- Remove `gs-chat-list` / `gs-chat-view` as direct children of `gs-nav-container`
- New system: each view is a `display:none`/`display:flex` div, the nav stack controls which one is visible
- No animation — instant swap (sidebar is too narrow for meaningful slide animations)

### Push View Transitions

- Push: hide current view (`display:none`), show new view (`display:flex`) — instant
- Pop (← back): hide current, show previous, restore scroll position

### DOM Structure

```html
<div class="gs-nav-container" id="gs-nav">
  <!-- Level 0: Tab content -->
  <div class="gs-tab-content" id="gs-tab-content">
    <div id="feed-content" style="display:flex; flex-direction:column;"></div>
    <div id="network-content" style="display:none; flex-direction:column;"></div>
    <div id="explore-content" style="display:none; flex-direction:column;"></div>
  </div>

  <!-- Level 1+: Push views (shown/hidden by nav stack) -->
  <div class="gs-push-view" id="push-messaging" style="display:none">
    <!-- Messaging inbox — reuses existing chat list rendering -->
  </div>
  <div class="gs-push-view" id="push-notifications" style="display:none">
    <!-- Notifications pane — reuses notifications-pane.js -->
  </div>
  <div class="gs-push-view" id="push-profile" style="display:none">
    <!-- Profile menu -->
  </div>
  <div class="gs-push-view" id="push-chat" style="display:none">
    <!-- Chat conversation container — MUST use id="gs-chat-view" because
         sidebar-chat.js hardcodes getContainer() → getElementById('gs-chat-view').
         All $(sel) queries resolve against this container. Keeping the same ID
         avoids modifying any sidebar-chat.js internals. -->
    <div id="gs-chat-view"></div>
  </div>
</div>
```

When a push view is active:
- `gs-tab-content` gets `display:none`
- Active push view gets `display:flex`
- Tab bar indicators all deselect (no active tab)
- Clicking any tab → popAll back to Level 0, activate that tab

## Feed Tab

### Data Sources (all existing APIs)

| Source | API | Content Type | Items |
|--------|-----|-------------|-------|
| Channel X posts | `getChannelFeedX(channelId)` per channel | Social posts from X/Twitter | author, body, engagement |
| Channel YouTube | `getChannelFeedYouTube(channelId)` per channel | Video posts | thumbnail, title, views, duration |
| Channel Gitchat | `getChannelFeedGitchat(channelId)` per channel | Community discussion posts | author, body, images, repo tags |
| Notifications | `getNotifications()` | repo_activity, follow, wave, mention | actor, type, preview |

### Aggregation Flow

```
1. getMyChannels() → list of user's subscribed channels
2. For each channel (parallel):
   - getChannelFeedX(id, limit=5)
   - getChannelFeedYouTube(id, limit=5)
   - getChannelFeedGitchat(id, limit=5)
3. getNotifications() → repo_activity + follow + wave + mention items
4. Merge all into unified array
5. Sort by createdAt descending
6. Render as feed cards
```

### Timestamp Normalization

Different sources use different field names for timestamps:
- `ChannelSocialPost` → `platformCreatedAt`
- `ChannelGitchatPost` → `createdAt`
- `Notification` → `created_at`

The aggregation step must normalize to a common `sortTime` field:
```javascript
function getSortTime(item) {
  return item.platformCreatedAt || item.createdAt || item.created_at || "";
}
```

### Engagement Field Mapping

`ChannelSocialPost.engagement` is typed as `Record<string, unknown>`. Render defensively:
- X posts: try `engagement.likes`, `engagement.retweets`, `engagement.replies` — fallback to empty
- YouTube: try `engagement.views`, `engagement.duration` — fallback to empty
- If keys are missing, hide the engagement row entirely

### YouTube Card Field Mapping

YouTube uses `ChannelSocialPost` (same type as X). Map fields:
- Thumbnail: `mediaUrls[0]` (first media URL) — fallback to placeholder
- Title: `body` field
- Views: `engagement.views` — fallback to empty
- Duration: `engagement.duration` — fallback to empty

### Performance Considerations

- **Limit per source:** 5 items per feed type per channel (prevents N*3*50 explosion)
- **Parallel fetching:** `Promise.all` for all channel feeds
- **Cache:** Store aggregated feed in memory, refresh on tab switch or pull-down
- **Incremental:** First render from notifications (instant), then append channel feeds as they load
- **Max channels:** Process first 10 channels max (user's most recently subscribed)

### Feed Card Types

**1. Social Post Card (X/YouTube/Gitchat)**

```
┌─────────────────────────────────────────┐
│  [𝕏] vercel/next.js · X                │
│  [Avatar] Author Name                   │
│           @handle · 2h ago              │
│                                         │
│  Post body text...                      │
│                                         │
│  [tags if gitchat]                      │
│  ─────────────────────────────────────  │
│  ♡ 2.4k    ↻ 812    💬 156             │
└─────────────────────────────────────────┘
```

- Source badge: small icon + channel name + platform
- Author: avatar + name + handle + time
- Body: text content, max 3 lines with clamp
- Tags: repo tags for gitchat posts only
- Engagement: platform-specific metrics
- YouTube: video thumbnail with play button + duration overlay

**2. Network Activity Card (from notifications)**

```
┌─────────────────────────────────────────┐
│  [Avatar] nakamoto-hiru followed you    │
│           5h ago              [Wave]    │
└─────────────────────────────────────────┘
```

- Compact single row
- Action button: Wave (for follow), Reply (for mention)

**3. Repo Activity Card (from notifications)**

```
┌─────────────────────────────────────────┐
│  [🚀] tailwindlabs/tailwindcss          │
│       New release · 8h ago              │
│                                         │
│  v4.1.0 — Container queries, 3D...     │
└─────────────────────────────────────────┘
```

- Square avatar for repos
- Event type label (release, PR merged, commit)
- Title/description

**4. Mention Card (from notifications)**

```
┌─ ┌───────────────────────────────────────┐
│▌ │  [Avatar] leeknowsai mentioned you   │
│▌ │           @SlugMacro check this out   │
│▌ │           1d ago                      │
└─ └───────────────────────────────────────┘
```

- Left accent border (amber for mentions)
- Preview text

### Feed Empty State

```
codicon-rss (48px, muted, 0.4 opacity)
"Your feed is empty"
"Star repos on GitHub or join communities to see updates here"
```

## Message Protocol — New Messages

### Extension → Webview (new)

| Message Type | Payload | When |
|---|---|---|
| `setFeedData` | `{ items: FeedItem[], hasMore: boolean }` | After feed aggregation completes |
| `appendFeedData` | `{ items: FeedItem[] }` | Incremental feed update (new WS notification) |
| `setHeaderBadges` | `{ chatUnread: number, notiUnread: number }` | On any unread count change |
| `setProfileData` | `{ login, name, avatarUrl, bio, followers, publicRepos }` | After profile fetch for push view |

### Webview → Extension (new)

| Message Type | Payload | When |
|---|---|---|
| `feed:fetch` | (none) | Feed tab activated, or pull-to-refresh |
| `feed:fetchMore` | `{ cursor? }` | Scroll near bottom of feed |
| `header:openChat` | (none) | 💬 icon clicked |
| `header:openNoti` | (none) | 🔔 icon clicked |
| `header:openProfile` | (none) | Avatar clicked |
| `push:back` | (none) | ← back button clicked |

### Feed fetch orchestration in explore.ts

```typescript
case "feed:fetch": {
  const channels = await apiClient.getMyChannels(undefined, 10);
  const feedPromises = channels.channels.slice(0, 10).flatMap(ch => [
    apiClient.getChannelFeedX(ch.id, undefined, 5).catch(() => ({ posts: [] })),
    apiClient.getChannelFeedYouTube(ch.id, undefined, 5).catch(() => ({ posts: [] })),
    apiClient.getChannelFeedGitchat(ch.id, undefined, 5).catch(() => ({ posts: [] })),
  ]);
  const notiResult = await apiClient.getNotifications();
  const channelResults = await Promise.all(feedPromises);
  // Normalize, merge, sort → post to webview as setFeedData
  break;
}
```

### Back button HTML

Each push view header includes a back button:
```html
<div class="gs-push-header">
  <button class="gs-push-back" id="push-back-btn">
    <span class="codicon codicon-arrow-left"></span>
  </button>
  <span class="gs-push-title">Messaging</span>
  <!-- optional right-side actions -->
</div>
```

Click handler: `pushBackBtn.addEventListener("click", () => popView())`

## Messaging Push View

### Layout

```
┌─────────────────────────────────────────┐
│  ←  Messaging                      ✏️  │
├─────────────────────────────────────────┤
│  🔍 Search messages...                  │
├─────────────────────────────────────────┤
│  [Conversation list — existing UI]      │
│  ...                                    │
└─────────────────────────────────────────┘
```

- **← back** → pop to previous tab view
- **✏️** → create new DM or group (existing modal)
- **Search bar** → existing inbox search functionality
- **Conversation list** → reuse existing `renderChat()` from explore.js (the conversation list rendering, filter chips, etc.)
- Tap conversation → push Chat view (Level 2)

### Reuse Strategy

The current Chat tab renders:
1. Filter bar (All/DM/Groups/Communities/Teams)
2. Conversation list
3. Chat view (on conversation click)

For Messaging push view:
- Filter bar + conversation list → move into `#push-messaging`
- Chat view → move into `#push-chat`
- Same JS, same rendering, just different DOM containers

## Notifications Push View

### Layout

```
┌─────────────────────────────────────────┐
│  ←  Notifications          Mark all read│
├─────────────────────────────────────────┤
│  [Notification list — from noti redesign]│
│  ...                                    │
└─────────────────────────────────────────┘
```

- **← back** → pop to previous tab view
- Reuse `notifications-pane.js` code from `slug-noti-redesign` branch
- Header with back button replaces the toolbar that was removed in noti redesign
- All noti features preserved: NEW/EARLIER buckets, letter avatars, unread dots, infinite scroll, viewport mark-read

### notifications-pane.js Refactor Required

The current `showPane()` hardcodes hiding sibling elements by ID:
```javascript
var siblings = ["chat-content", "chat-empty", "friends-content", "discover-content", "chat-pane-channels"];
```

This is incompatible with push view navigation. Changes needed:
1. **Remove sibling-hiding logic** from `showPane()` — the nav stack handles visibility
2. **Remove `bindTabSwitching()`** — noti is no longer a tab, it's triggered by nav stack
3. **Export `showPane()`/`hidePane()`** so the nav stack can call them (or replace with simpler `activate()`/`deactivate()` that only toggle `state.isActive` + observer)
4. **`notif-pane` div** moves inside `#push-notifications` container — keep same ID so `getElementById("notif-pane")` still works
5. **`showPane()` simplified:** just set `state.isActive = true`, render if needed, start observer. No DOM hiding.

## Profile Push View

### Layout

```
┌─────────────────────────────────────────┐
│  ←  Profile                             │
├─────────────────────────────────────────┤
│        [Avatar 56px]                    │
│        SlugMacro                        │
│        @slugmacro · Full Stack Dev      │
│        42 connections · 128 repos       │
├─────────────────────────────────────────┤
│  👤  View Profile                       │
│  ⭐  Starred Repos                      │
│  ⚙️  Settings                           │
│  ──────────────────────────────         │
│  🔔  Notification Preferences           │
│  🔇  Do Not Disturb                     │
│  ──────────────────────────────         │
│  🚪  Sign Out                           │
└─────────────────────────────────────────┘
```

- All icons = codicons (emoji shown for readability)
- User data from `authManager` (login, avatar) + `GET /github/data/profile/me`
- Settings items → reuse existing settings panel toggles
- Sign Out → existing auth flow

## Create DM/Group — Entry Points

| Entry Point | Location | Action |
|-------------|----------|--------|
| ✏️ icon | Messaging push view header | Open create modal (existing) → pick DM or Group → push chat view |
| 💬 button | Network tab, friend row | Push directly to chat view with that user (createConversation if needed) |
| DM button | Profile card (anywhere) | Push to chat view with that user |
| Message button | Feed card author tap | Push to chat view with author |

All entry points use same flow: `pushView("chat", { conversationId })` or `pushView("chat", { recipientLogin })`.

## Network Tab

Rename current Friends tab:
- `data-tab="friends"` → `data-tab="network"`
- Tab label "Friends" → "Network"
- Content container `#friends-content` → `#network-content`
- All accordion logic preserved (Online/Offline/Not on GitChat)
- DM buttons on rows → trigger `pushView("chat", ...)` instead of tab switch

## Explore Tab

Rename current Discover tab:
- `data-tab="discover"` → `data-tab="explore"` (note: current code already uses `data-tab="discover"`)
- Tab label "Discover" → "Explore"
- Content container `#discover-content` → `#explore-content`
- All accordion logic preserved (Communities/Teams/Online Now)

## Files to Modify

| File | Changes |
|------|---------|
| `src/webviews/explore.ts` | Header HTML restructure, tab changes (3 tabs), push view containers, nav stack orchestration, feed aggregation logic, header icon handlers, badge/dot updates |
| `media/webview/explore.js` | Tab switching (3 tabs + push views), nav stack JS, feed rendering, state migration, scroll position save/restore, header icon click handlers |
| `media/webview/explore.css` | Header styles, push view styles, feed card styles, tab updates |
| `media/webview/shared.css` | New gs-header-*, gs-push-view, gs-feed-card tokens if needed |
| `media/webview/notifications-pane.js` | Adapt to work inside push view container instead of tab pane |
| `media/webview/notifications-pane.css` | Minor adjustments for push view context |
| `media/webview/sidebar-chat.js` | Mount into push-chat container, back button support |
| `src/notifications/notification-store.ts` | No changes (merge from slug-noti-redesign if needed) |

## What Changes vs What Stays

### Changes
- Header: redesign with 3 action icons
- Tabs: 4 → 3 (Chat/Noti removed from tab bar)
- Feed tab: NEW — aggregated channel feeds + notifications
- Navigation: push view system for Chat/Noti/Profile
- Tab names: Friends → Network, Discover → Explore
- Chat trigger: tab click → header icon push

### Stays (~80% code preserved — internals intact, integration layer changes)

**Fully preserved (no changes):**
- sidebar-chat.js internals (messages, scroll, search, pin, attachments, groups, reactions, mentions)
- chat-handlers.ts (all message handlers)
- Auth system, realtime, API layer
- Notification store, toast coordinator

**Preserved with minor container/trigger changes:**
- Conversation list rendering (same JS, renders into `#push-messaging` instead of `#chat-content`)
- notifications-pane.js (remove sibling-hiding in showPane, keep everything else)
- sidebar-chat.js (no internal changes — container ID `gs-chat-view` preserved inside push-chat div)
- Friends accordion logic (rename container ID only)
- Discover accordion logic (rename container ID only)

**Rewritten (~20%):**
- explore.js: tab switching logic, nav stack (replaces pushChatView/popChatView), persistState/restoreState
- explore.css: replace translateX slide system with show/hide stack
- explore.ts: header HTML, feed fetch orchestration, new message handlers

## Design System Compliance

- All colors via `--gs-*` tokens
- Font sizes via `--gs-font-*`
- Spacing: 4px grid
- Icons: codicons only
- Min font size: 11px
- Components: reuse existing `.gs-*` classes, new `.gs-feed-*` for feed cards
- Follow existing BEM-like naming within webview CSS
