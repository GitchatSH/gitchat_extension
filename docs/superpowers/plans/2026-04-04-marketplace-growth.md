# Marketplace Growth & Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Increase VS Code marketplace installs through metadata optimization, resource-efficient polling, and growth features (onboarding, invite, badge).

**Architecture:** Improve package.json metadata and README for discoverability. Add window focus tracking to ConfigManager, then use it across all polling modules to reduce resource usage when IDE is unfocused. Add 3 new commands for growth (onboarding reveal, invite link, profile badge).

**Tech Stack:** TypeScript, VS Code Extension API, esbuild

---

## Phase A: Marketplace Optimization

### Task 1: Update package.json metadata

**Files:**
- Modify: `package.json:15-27` (categories, keywords)
- Modify: `package.json:1-14` (add homepage, qna)

- [ ] **Step 1: Update categories and keywords**

In `package.json`, change:

```json
"categories": [
  "Other"
],
"keywords": [
  "github",
  "trending",
  "repositories",
  "developers",
  "social",
  "collaboration",
  "chat",
  "open-source"
],
```

To:

```json
"categories": [
  "Social"
],
"keywords": [
  "github",
  "trending",
  "repositories",
  "developers",
  "social",
  "collaboration",
  "chat",
  "open-source",
  "cursor",
  "windsurf",
  "networking",
  "messaging",
  "community"
],
```

- [ ] **Step 2: Add homepage and qna fields**

After the `"repository"` block in `package.json`, add:

```json
"homepage": "https://gitstar.ai",
"qna": "https://github.com/GitstarAI/top-github-trending-repo-and-people/issues",
```

- [ ] **Step 3: Verify package.json is valid**

Run: `cd /Users/leebot/top-github-trending-repo-and-people && node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('Valid JSON')"`
Expected: `Valid JSON`

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "chore: update marketplace category, keywords, homepage"
```

---

### Task 2: Add activation events

**Files:**
- Modify: `package.json:33` (activationEvents)

- [ ] **Step 1: Replace empty activationEvents with explicit triggers**

In `package.json`, change:

```json
"activationEvents": [],
```

To:

```json
"activationEvents": [
  "onView:trending.trendingRepos",
  "onView:trending.trendingPeople",
  "onView:trending.feed",
  "onView:trending.chatPanel",
  "onView:trending.whoToFollow",
  "onView:trending.myRepos",
  "onView:trending.notifications",
  "onCommand:trending.signIn",
  "onCommand:trending.search",
  "onCommand:trending.browseTrendingRepos",
  "onCommand:trending.browseTrendingPeople",
  "onCommand:trending.openFeed",
  "onCommand:trending.openInbox",
  "onCommand:trending.openNotifications",
  "onCommand:trending.messageUser",
  "onCommand:trending.createGroup"
],
```

- [ ] **Step 2: Verify JSON is still valid**

Run: `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('Valid JSON')"`
Expected: `Valid JSON`

- [ ] **Step 3: Build to verify no compilation errors**

Run: `npm run compile`
Expected: Build succeeds with no errors

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "perf: use explicit activation events instead of startup"
```

---

### Task 3: Overhaul README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace README with visual-first layout**

Replace the entire contents of `README.md` with:

```markdown
# Top GitHub Trending Repo & People

[![Version](https://img.shields.io/visual-studio-marketplace/v/GitstarAI.top-github-trending)](https://marketplace.visualstudio.com/items?itemName=GitstarAI.top-github-trending)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/GitstarAI.top-github-trending)](https://marketplace.visualstudio.com/items?itemName=GitstarAI.top-github-trending)
[![Rating](https://img.shields.io/visual-studio-marketplace/r/GitstarAI.top-github-trending)](https://marketplace.visualstudio.com/items?itemName=GitstarAI.top-github-trending)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**A social network inside your IDE** — discover trending repos, follow developers, and chat in real-time. Stop alt-tabbing to GitHub, Discord, or Slack.

> This is the beta. Install it, find **@leeknowsai** in the chat, and tell me what to build next — I ship updates within 24h.

---

<!-- TODO: Add GIF demo here — record: sign in → browse trending → follow dev → open chat -->
<!-- ![Demo](media/demo.gif) -->

## Features

### Discover

- **Trending Repos** — Browse what's hot on GitHub, refreshed every 5 minutes
- **Trending People** — Find top developers with star power scores
- **Activity Feed** — Personalized "For You" feed of what your network is building
- **Search** — Find repos and people from the command palette

### Connect

- **Follow & Star** — Follow devs and star repos without leaving your editor
- **Developer Profiles** — View profiles with stats, top repos, and star power
- **Who to Follow** — Smart suggestions based on your GitHub network

### Chat

- **Direct Messages** — Chat with any developer in real-time
- **Group Chat** — Create groups with your team or community
- **Rich Messaging** — Reactions, attachments, replies, link previews, typing indicators
- **Presence** — See who's online right now

<!-- TODO: Add screenshots here -->
<!-- ![Explore](media/screenshots/explore.png) -->
<!-- ![Chat](media/screenshots/chat.png) -->

## Works with

VS Code, Cursor, Windsurf, Antigravity, Void, OpenCode, and any IDE supporting VS Code extensions.

## Getting Started

1. Install the extension from the [Marketplace](https://marketplace.visualstudio.com/items?itemName=GitstarAI.top-github-trending)
2. Click the Explore icon in the activity bar
3. Browse trending repos and people — no login required
4. Sign in with GitHub to unlock social features

## Commands & Shortcuts

Open the command palette (`Cmd+Shift+P` / `Ctrl+Shift+P`) and type "Trending":

| Command | Shortcut | Description |
|---------|----------|-------------|
| Trending: Sign In | | Sign in with GitHub |
| Trending: Search | | Search repos & people |
| Trending: Browse Trending Repos | `Cmd+Shift+G T` | Open trending repos |
| Trending: Open Inbox | `Cmd+Shift+G M` | Open your messages |
| Toggle Sidebar | `Cmd+Shift+G G` | Show/hide the Explore sidebar |

## Privacy

This extension uses GitHub OAuth for authentication. See our [Privacy Policy](https://gitstar.ai/privacy).

## Feedback & Issues

Found a bug or have a feature request? [Open an issue](https://github.com/GitstarAI/top-github-trending-repo-and-people/issues).

## License

MIT
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: overhaul README with badges, structured features, visual placeholders"
```

---

### Task 4: Create CHANGELOG

**Files:**
- Create: `CHANGELOG.md`

- [ ] **Step 1: Create CHANGELOG from git history**

Create `CHANGELOG.md`:

```markdown
# Changelog

All notable changes to the "Top GitHub Trending Repo & People" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [1.3.2] - 2026-04-04

### Fixed
- Sort conversations by recent activity with unread badge debounce
- Clear unread badge when user reads messages
- Inbox status bar click opens chat panel correctly
- Only mark conversation read when chat panel is visible

### Added
- Send client/IDE metadata on sign-in for analytics

## [1.2.0] - 2026-04-02

### Added
- Sidebar badges for unread messages and notifications
- Multi-file attachments in chat
- Image grid layout for multiple attachments
- Attach menu with file picker

### Fixed
- Unread count sync issues

## [1.1.4] - 2026-03-31

### Fixed
- Debug logging for feed and notifications data loading
- Who-to-follow suggestions API response parsing

## [1.1.3] - 2026-03-30

### Changed
- Replace placeholder icon with Gitstar logo

## [1.1.2] - 2026-03-29

### Added
- For You personalized feed
- Redesigned profile and repo detail panels
- Filter chips for feed (All, Trending, Releases, Merged PRs, Notable Stars)
- Inbox-first chat layout with typing indicators and smart sorting
- Group chat management (info panel, add/remove members, leave, mute)

### Fixed
- Markdown README rendering in repo detail
- Profile fallback for missing data
- Duplicate messages on send

### Changed
- CI: trigger publish only on GitHub release

## [0.1.1] - 2026-03-25

### Added
- Initial release
- Trending repos and people discovery
- GitHub OAuth authentication
- Real-time messaging with WebSocket
- Follow/unfollow, star/unstar
- Notifications
- Search
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: add CHANGELOG backfilled from git history"
```

---

## Phase B: Product Polish

### Task 5: Add window focus tracking to ConfigManager

**Files:**
- Modify: `src/config/index.ts`

- [ ] **Step 1: Add focus state tracking**

In `src/config/index.ts`, add a `windowFocused` property and event to `ConfigManager`. After the `_onDidChange` event emitter (line 7), add focus tracking:

```typescript
class ConfigManager {
  private _config!: ExtensionConfig;
  private readonly _onDidChange = new vscode.EventEmitter<ExtensionConfig>();
  readonly onDidChange = this._onDidChange.event;

  private _windowFocused = true;
  private readonly _onDidChangeFocus = new vscode.EventEmitter<boolean>();
  readonly onDidChangeFocus = this._onDidChangeFocus.event;

  get windowFocused(): boolean {
    return this._windowFocused;
  }

  constructor() {
    this.reload();
  }

  // ... existing reload(), current getter, dispose() ...

  dispose(): void {
    this._onDidChange.dispose();
    this._onDidChangeFocus.dispose();
  }
}
```

- [ ] **Step 2: Register focus listener in activate**

In the `configModule.activate` function, add the window state change listener:

```typescript
export const configModule: ExtensionModule = {
  id: "config",
  activate(context) {
    context.subscriptions.push(
      vscode.window.onDidChangeWindowState((state) => {
        if (configManager._windowFocused !== state.focused) {
          configManager._windowFocused = state.focused;
          configManager._onDidChangeFocus.fire(state.focused);
          log(`Window focus: ${state.focused}`);
        }
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("trending")) {
          configManager.reload();
          log("Configuration reloaded");
        }
      }),
      configManager
    );
  },
};
```

Note: `_windowFocused` and `_onDidChangeFocus` need to be accessible from the module. Since they're in the same file, this works directly. But we need to expose the setter. Change the private fields to be writable from the module scope — simplest approach: keep them as non-private (no underscore prefix won't work with existing convention). Instead, add a method:

```typescript
// Add to ConfigManager class
setWindowFocused(focused: boolean): void {
  if (this._windowFocused !== focused) {
    this._windowFocused = focused;
    this._onDidChangeFocus.fire(focused);
    log(`Window focus: ${focused}`);
  }
}
```

Then in activate:

```typescript
vscode.window.onDidChangeWindowState((state) => {
  configManager.setWindowFocused(state.focused);
}),
```

- [ ] **Step 3: Build to verify**

Run: `npm run compile`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add src/config/index.ts
git commit -m "feat: add window focus tracking to config manager"
```

---

### Task 6: Smart polling for trending repos

**Files:**
- Modify: `src/tree-views/trending-repos.ts:62-72`

- [ ] **Step 1: Replace fixed interval with focus-aware polling**

Replace the `trendingReposModule` export at the bottom of `src/tree-views/trending-repos.ts`:

```typescript
export const trendingReposModule: ExtensionModule = {
  id: "trendingRepos",
  activate(context) {
    trendingReposProvider = new TrendingReposProvider();
    const treeView = vscode.window.createTreeView("trending.trendingRepos", { treeDataProvider: trendingReposProvider, showCollapseAll: false });
    trendingReposProvider.fetchAndRefresh();

    let interval = setInterval(() => trendingReposProvider.fetchAndRefresh(), configManager.current.trendingPollInterval);

    configManager.onDidChangeFocus((focused) => {
      clearInterval(interval);
      if (focused) {
        trendingReposProvider.fetchAndRefresh();
        interval = setInterval(() => trendingReposProvider.fetchAndRefresh(), configManager.current.trendingPollInterval);
      } else {
        interval = setInterval(() => trendingReposProvider.fetchAndRefresh(), configManager.current.trendingPollInterval * 3);
      }
    });

    context.subscriptions.push(treeView, trendingReposProvider, { dispose: () => clearInterval(interval) });
    log("Trending repos tree view registered");
  },
};
```

- [ ] **Step 2: Build to verify**

Run: `npm run compile`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add src/tree-views/trending-repos.ts
git commit -m "perf: reduce trending repos polling when window unfocused"
```

---

### Task 7: Smart polling for trending people

**Files:**
- Modify: `src/tree-views/trending-people.ts:61-71`

- [ ] **Step 1: Replace fixed interval with focus-aware polling**

Replace the `trendingPeopleModule` export at the bottom of `src/tree-views/trending-people.ts`:

```typescript
export const trendingPeopleModule: ExtensionModule = {
  id: "trendingPeople",
  activate(context) {
    trendingPeopleProvider = new TrendingPeopleProvider();
    const treeView = vscode.window.createTreeView("trending.trendingPeople", { treeDataProvider: trendingPeopleProvider, showCollapseAll: false });
    trendingPeopleProvider.fetchAndRefresh();

    let interval = setInterval(() => trendingPeopleProvider.fetchAndRefresh(), configManager.current.trendingPollInterval);

    configManager.onDidChangeFocus((focused) => {
      clearInterval(interval);
      if (focused) {
        trendingPeopleProvider.fetchAndRefresh();
        interval = setInterval(() => trendingPeopleProvider.fetchAndRefresh(), configManager.current.trendingPollInterval);
      } else {
        interval = setInterval(() => trendingPeopleProvider.fetchAndRefresh(), configManager.current.trendingPollInterval * 3);
      }
    });

    context.subscriptions.push(treeView, trendingPeopleProvider, { dispose: () => clearInterval(interval) });
    log("Trending people tree view registered");
  },
};
```

- [ ] **Step 2: Build to verify**

Run: `npm run compile`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add src/tree-views/trending-people.ts
git commit -m "perf: reduce trending people polling when window unfocused"
```

---

### Task 8: Smart polling for status bar and heartbeat

**Files:**
- Modify: `src/statusbar/index.ts:84-86` (poll interval)
- Modify: `src/realtime/index.ts:150-152` (heartbeat)

- [ ] **Step 1: Add focus-aware status bar polling**

In `src/statusbar/index.ts`, inside the `activate` function, replace the fixed poll timer (line 85-86):

```typescript
// Replace:
const pollTimer = setInterval(() => { fetchCounts(); }, 30_000);
context.subscriptions.push({ dispose: () => clearInterval(pollTimer) });
```

With:

```typescript
let pollTimer = setInterval(() => { fetchCounts(); }, 30_000);

configManager.onDidChangeFocus((focused) => {
  clearInterval(pollTimer);
  if (focused) {
    fetchCounts();
    pollTimer = setInterval(() => { fetchCounts(); }, 30_000);
  } else {
    pollTimer = setInterval(() => { fetchCounts(); }, 60_000);
  }
});

context.subscriptions.push({ dispose: () => clearInterval(pollTimer) });
```

- [ ] **Step 2: Add focus-aware heartbeat in realtime**

In `src/realtime/index.ts`, inside the `connect()` method, replace the heartbeat timer (lines 150-152):

```typescript
// Replace:
this._heartbeatTimer = setInterval(() => {
  this._socket?.emit("ping");
}, configManager.current.presenceHeartbeat);
```

With:

```typescript
this._startHeartbeat();
```

Then add a new method to `RealtimeClient`:

```typescript
private _startHeartbeat(): void {
  this._stopHeartbeat();
  this._heartbeatTimer = setInterval(() => {
    this._socket?.emit("ping");
  }, configManager.current.presenceHeartbeat);
}

private _stopHeartbeat(): void {
  if (this._heartbeatTimer) {
    clearInterval(this._heartbeatTimer);
    this._heartbeatTimer = null;
  }
}
```

And in `realtimeModule.activate`, add focus listener:

```typescript
export const realtimeModule: ExtensionModule = {
  id: "realtime",
  activate(context) {
    if (authManager.isSignedIn) {
      realtimeClient.connect();
    }

    authManager.onDidChangeAuth((signedIn) => {
      if (signedIn) {
        realtimeClient.connect();
      } else {
        realtimeClient.disconnect();
      }
    });

    configManager.onDidChangeFocus((focused) => {
      if (focused) {
        realtimeClient._startHeartbeat();
      } else {
        realtimeClient._stopHeartbeat();
      }
    });

    context.subscriptions.push(realtimeClient);
    log("Realtime module activated");
  },
  deactivate() {
    realtimeClient.disconnect();
  },
};
```

Note: `_startHeartbeat` and `_stopHeartbeat` need to be callable from outside. Remove the `private` modifier — make them public:

```typescript
startHeartbeat(): void { ... }
stopHeartbeat(): void { ... }
```

And update `connect()` to call `this.startHeartbeat()` and `disconnect()` to call `this.stopHeartbeat()`.

- [ ] **Step 3: Build to verify**

Run: `npm run compile`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add src/statusbar/index.ts src/realtime/index.ts
git commit -m "perf: pause heartbeat and reduce polling when window unfocused"
```

---

## Phase C: Growth Features

### Task 9: Post-signin onboarding

**Files:**
- Modify: `src/auth/index.ts:112-115` (after sync, reveal Who to Follow)

- [ ] **Step 1: Add onboarding reveal after sign-in sync**

In `src/auth/index.ts`, inside the `signIn()` method, after `this._syncToGitstar();` (line 113), add:

```typescript
// Sync GitHub follows to Gitstar in background
this._syncToGitstar();

// Onboarding: reveal Who to Follow panel and show welcome
setTimeout(() => {
  vscode.commands.executeCommand("trending.whoToFollow.focus");
  vscode.window.showInformationMessage(
    "Welcome to Gitstar! Check out trending repos and developers to follow.",
    "Browse Trending"
  ).then((action) => {
    if (action === "Browse Trending") {
      vscode.commands.executeCommand("trending.browseTrendingRepos");
    }
  });
}, 1500);
```

The 1500ms delay ensures the sync has started and the UI is ready.

- [ ] **Step 2: Build to verify**

Run: `npm run compile`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add src/auth/index.ts
git commit -m "feat: show onboarding welcome after first sign-in"
```

---

### Task 10: Invite link and profile badge commands

**Files:**
- Modify: `src/commands/index.ts` (add 2 new commands)
- Modify: `package.json` (register 2 new commands)

- [ ] **Step 1: Add command handlers**

In `src/commands/index.ts`, add these two entries to the `commands` array (before the closing `];` on line 267):

```typescript
  {
    id: "trending.copyInviteLink",
    handler: async () => {
      const text = "Hey! I've been using Gitstar to discover trending repos and chat with devs right in VS Code. Try it: https://marketplace.visualstudio.com/items?itemName=GitstarAI.top-github-trending";
      await vscode.env.clipboard.writeText(text);
      vscode.window.showInformationMessage("Invite link copied to clipboard!");
    },
  },
  {
    id: "trending.copyProfileBadge",
    handler: async () => {
      const login = authManager.login;
      const badge = `[![Chat on Gitstar](https://img.shields.io/badge/Chat%20on-Gitstar-blue?logo=github)](https://marketplace.visualstudio.com/items?itemName=GitstarAI.top-github-trending)`;
      await vscode.env.clipboard.writeText(badge);
      vscode.window.showInformationMessage(
        login
          ? `Badge markdown copied! Paste it in your GitHub README to let people find you on Gitstar.`
          : `Badge markdown copied! Sign in to personalize it.`
      );
    },
  },
```

- [ ] **Step 2: Register commands in package.json**

In `package.json`, inside the `"commands"` array, add:

```json
{
  "command": "trending.copyInviteLink",
  "title": "Copy Invite Link",
  "icon": "$(link)",
  "category": "Trending"
},
{
  "command": "trending.copyProfileBadge",
  "title": "Copy Profile Badge for README",
  "icon": "$(shield)",
  "category": "Trending"
}
```

- [ ] **Step 3: Build to verify**

Run: `npm run compile`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add src/commands/index.ts package.json
git commit -m "feat: add invite link and profile badge commands"
```

---

## Post-Implementation Checklist

### User actions required (cannot be automated):

1. **Record GIF demo:** Sign in → browse trending → follow a dev → open chat. Save as `media/demo.gif`
2. **Take screenshots:** Explore sidebar, Chat panel, Feed view, Profile view. Save in `media/screenshots/`
3. **Update README:** Uncomment the `![Demo]` and `![Screenshot]` lines after adding images
4. **Marketing posts:** Write and publish on Reddit (r/vscode, r/github), Dev.to, Twitter/X, Product Hunt
5. **Deploy production API** when ready — then update default URLs in package.json
6. **Ask early users for marketplace ratings** — first 5 ratings are critical for social proof
