# Unified Explore Tabbed Webview — Design Spec

**Date:** 2026-04-07
**Branch:** `hiru-uiux`
**Status:** Approved

## Summary

Replace the current multi-view Explore sidebar (6 separate views) + separate Chat sidebar (1 view) with a single unified webview containing 3 tabs: **Chat | Feed | Trending**.

## Goals

- Consolidate 7 separate views into 1 tabbed webview
- Remove Chat from its own activity bar container — merge into Explore
- Convert TreeView-based sections (trending repos, trending people, my repos) to HTML rendering within the webview
- Keep all existing functionality, API calls, and realtime features intact
- Layout change only — content improvements deferred

## Current Architecture

### Activity Bar Containers
- `trendingSidebar` ("Explore") — 6 views:
  - `trending.welcome` (webview, when !isSignedIn)
  - `trending.feed` (webview)
  - `trending.trendingRepos` (tree view)
  - `trending.trendingPeople` (tree view)
  - `trending.whoToFollow` (webview)
  - `trending.myRepos` (tree view)
- `chatSidebar` ("Chat") — 1 view:
  - `trending.chatPanel` (webview)

### Key Providers
| Provider | Type | File |
|----------|------|------|
| FeedWebviewProvider | WebviewViewProvider | `src/webviews/feed.ts` |
| ChatPanelWebviewProvider | WebviewViewProvider | `src/webviews/chat-panel.ts` |
| WhoToFollowWebviewProvider | WebviewViewProvider | `src/webviews/who-to-follow.ts` |
| TrendingReposProvider | TreeDataProvider | `src/tree-views/trending-repos.ts` |
| TrendingPeopleProvider | TreeDataProvider | `src/tree-views/trending-people.ts` |
| MyReposProvider | TreeDataProvider | `src/tree-views/my-repos.ts` |
| ChatPanel | WebviewPanel | `src/webviews/chat.ts` (conversation window) |

## Target Architecture

### Single Webview: `trending.explore`

One `ExploreWebviewProvider` (WebviewViewProvider) renders a tabbed UI with 3 tabs.

```
┌──────────────────────────────────┐
│  💬 Chat  │  📰 Feed  │ 🔥 Trending │
├──────────────────────────────────┤
│                                  │
│  [Tab content area]              │
│                                  │
└──────────────────────────────────┘
```

### Tab Content

#### Chat Tab (from `chat-panel.ts`)
- Sub-tabs: Inbox | Friends
- Filter chips: All / Direct / Group / Requests / Unread
- Chat list with avatars, badges, last message preview
- Click → opens `ChatPanel` (conversation in editor area, unchanged)
- Realtime: presence dots, typing indicators, new message updates
- **Reuses**: existing `chat-panel.css`, `chat-panel.js` logic (embedded, not imported)

#### Feed Tab (from `feed.ts` + `my-repos.ts`)
- Filter chips: All / Repos / Released / Merged / Notable
- Activity cards (trending, release, PR merged, notable star)
- "Load more" pagination
- **Added section**: MY REPOS (converted from TreeView)
  - Grouped: Public (📁), Private (🔒)
  - Star count, open-in-browser link
- **Reuses**: existing `feed.css`, `feed.js` logic

#### Trending Tab (from tree-views + `who-to-follow.ts`)
- **REPOS section** (converted from TreeView → HTML)
  - Ranked list with star counts
  - Context menu: Star/Unstar, Open in browser, Copy URL
  - Refresh button
- **PEOPLE section** (converted from TreeView → HTML)
  - Ranked list with online status dots, star power
  - Context menu: Follow/Unfollow, View Profile, Message
  - Refresh button
- **WHO TO FOLLOW section** (from webview)
  - Suggestion cards with Follow button
- **Reuses**: API calls from existing providers, `who-to-follow.css/js` logic

### Welcome State

When `!isSignedIn`, show existing welcome/sign-in view instead of tabs. Keep `trending.welcome` as a separate view or embed the welcome HTML in ExploreWebviewProvider — TBD based on simplicity.

**Decision**: Embed welcome HTML directly in `ExploreWebviewProvider`. When signed in → show tabs. When not → show sign-in prompt. Simpler than managing 2 views.

## File Changes

### New Files
| File | Purpose |
|------|---------|
| `src/webviews/explore.ts` | Unified ExploreWebviewProvider — consolidates data fetching + message routing from chat-panel, feed, tree-views, who-to-follow |
| `media/webview/explore.css` | Tab layout + all section styles (consolidates chat-panel.css, feed.css, who-to-follow.css + new trending/my-repos styles) |
| `media/webview/explore.js` | Tab switching + all message handlers (consolidates chat-panel.js, feed.js, who-to-follow.js + new trending/my-repos handlers) |

### Modified Files
| File | Changes |
|------|---------|
| `package.json` | Remove `chatSidebar` container. Replace 6 views under `trendingSidebar` with 1 `trending.explore` webview. Update activation events. Remove TreeView-specific context menus (re-implement as webview context menus or inline buttons). |
| `src/extension.ts` | Replace 6 modules (trendingReposModule, trendingPeopleModule, whoToFollowWebviewModule, myReposModule, chatPanelWebviewModule, feedWebviewModule) with 1 `exploreModule`. Keep welcomeModule if separate, or fold into explore. |

### Deprecated Files (keep in repo, remove in follow-up)
- `src/webviews/chat-panel.ts`
- `src/webviews/feed.ts`
- `src/webviews/who-to-follow.ts`
- `src/tree-views/trending-repos.ts`
- `src/tree-views/trending-people.ts`
- `src/tree-views/my-repos.ts`
- `media/webview/chat-panel.css`, `chat-panel.js`
- `media/webview/feed.css`, `feed.js`
- `media/webview/who-to-follow.css`, `who-to-follow.js`

### Untouched Files
- `src/webviews/chat.ts` — conversation panel (opens in editor)
- `media/webview/chat.css`, `chat.js` — conversation UI
- `src/api/` — all API methods
- `src/realtime/` — socket.io client
- `src/auth/` — authentication
- `src/commands/` — command handlers (may need minor updates for context)
- `media/webview/shared.css`, `shared.js` — design system base

## Message Flow

```
explore.js (webview)
  ├─ Tab switch → local DOM manipulation, no extension round-trip
  ├─ Data requests → vscode.postMessage({ type, tab, ... })
  │   • "refreshChat" → fetch conversations + friends
  │   • "refreshFeed" → fetch feed items
  │   • "refreshTrending" → fetch repos + people + suggestions
  │   • "loadMoreFeed" → paginated feed fetch
  └─ User actions → vscode.postMessage({ type, ... })
      • "openChat" → opens ChatPanel in editor
      • "starRepo" / "unstarRepo"
      • "followUser" / "unfollowUser"
      • "openUrl" → vscode.env.openExternal
      • "viewProfile" → opens profile panel
      • Chat actions: "clearUnread", "pinChat", "muteChat", etc.

ExploreWebviewProvider (explore.ts)
  ├─ onMessage() → routes by message type
  ├─ Calls apiClient methods (unchanged)
  ├─ Subscribes to realtime events:
  │   • newMessage → update chat list + badge
  │   • presenceChange → update online dots
  │   • typing → show typing indicator
  │   • trendingUpdate → refresh trending data
  └─ postMessage() back to webview with data
```

## Badge / Status Bar

- Unread message count badge moves from `chatSidebar` icon to `trendingSidebar` icon
- Status bar items (Trending count, unread messages) — unchanged
- When Chat tab has unread, show badge on the Explore activity bar icon

## Context Menus

TreeView context menus (right-click star/follow/open) will be replaced with:
- Inline action buttons in the webview HTML (star ☆/★, follow, message ✉)
- No VS Code native context menus needed — webview handles its own

## Constraints

- **No content changes** — same data, same layout within each section
- **No API changes** — all existing endpoints used as-is
- **No realtime changes** — socket.io subscriptions stay the same
- **Styling** — use existing `shared.css` design tokens (`--gs-*`)
- **CSP** — follow existing pattern (nonce-based, same-origin assets)

## Testing

- F5 → Extension Development Host
- Verify: tab switching, data loading per tab, chat open, star/follow actions
- Verify: realtime updates (presence, new messages) while on Chat tab
- Verify: welcome state when not signed in
- Verify: badge count on Explore icon
