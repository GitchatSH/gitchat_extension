# Repo Channels — Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Channels" sub-tab to the Chat pane in the Explore panel. Users see their subscribed repo channels, click into a channel to view content from 4 sources (X, YouTube, Gitchat, GitHub) in separate tabs — matching the web UI. Admins can post Gitchat community posts directly.

**Architecture:** Add "Channels" as a third chat sub-tab (alongside Inbox/Friends). Channel list rendered in explore.js. Clicking a channel opens a new webview panel (ChannelPanel) with 4 content tabs. Reuses existing API client pattern and realtime subscription.

**Tech Stack:** TypeScript, VS Code Webview API, vanilla JS/CSS

**Codebase:** `/Users/leebot/top-github-trending-repo-and-people/`

**Depends on:** Backend plan (`2026-04-08-repo-channels-backend.md`) — API endpoints must exist.

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `src/types/index.ts` | Add Channel, ChannelMember, ChannelFeedItem types |
| Modify | `src/api/index.ts` | Add channel API methods |
| Modify | `src/webviews/explore.ts:370-420` | Add "Channels" sub-tab HTML + data fetching |
| Modify | `media/webview/explore.js:496+` | Render channel list + handle clicks |
| Modify | `media/webview/explore.css:406+` | Channel list styles |
| Create | `src/webviews/channel.ts` | ChannelPanel webview provider — detail view |
| Create | `media/webview/channel.js` | Channel detail UI: 4 content tabs + admin posting |
| Create | `media/webview/channel.css` | Channel detail styles |
| Modify | `src/commands/index.ts` | Register openChannel command |
| Modify | `package.json` | Add channel view + command declarations |

---

### Task 1: Type Definitions

**Files:**
- Modify: `src/types/index.ts`

- [ ] **Step 1: Add channel types**

Append to `src/types/index.ts`:

```typescript
// ── Repo Channels ─────────────────────────────────────────

export interface RepoChannel {
  id: string;
  repoOwner: string;
  repoName: string;
  displayName: string | null;
  description: string | null;
  avatarUrl: string | null;
  subscriberCount: number;
  role: string; // 'owner' | 'admin' | 'subscriber'
}

export interface ChannelMember {
  id: string;
  userLogin: string;
  role: string;
  joinedAt: string;
  source: string | null;
}

export interface ChannelSocialPost {
  id: string;
  platform: string;
  platformPostId: string;
  authorHandle: string | null;
  authorName: string | null;
  authorAvatar: string | null;
  body: string | null;
  mediaUrls: string[];
  engagement: Record<string, unknown>;
  platformCreatedAt: string;
}

export interface ChannelGitchatPost {
  id: string;
  authorLogin: string;
  authorName: string | null;
  authorAvatar: string | null;
  body: string;
  imageUrls: string[];
  repoTags: string[];
  createdAt: string;
}

export interface ChannelGitHubEvent {
  id: string;
  type: string;
  actorLogin: string;
  actorAvatar: string | null;
  repoOwner: string;
  repoName: string;
  releaseTag: string | null;
  prTitle: string | null;
  issueTitle: string | null;
  narrationBody: string | null;
  eventCreatedAt: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/types/index.ts
git commit -m "feat(channels): add channel type definitions"
```

---

### Task 2: API Client Methods

**Files:**
- Modify: `src/api/index.ts`

- [ ] **Step 1: Add channel API methods**

Add to the `ApiClient` class in `src/api/index.ts` (after the existing message methods):

```typescript
  // ── Repo Channels ─────────────────────────────────────────

  async getMyChannels(cursor?: string, limit?: number): Promise<{ channels: RepoChannel[]; nextCursor: string | null }> {
    const params: Record<string, string | number> = {};
    if (cursor) { params.cursor = cursor; }
    if (limit) { params.limit = limit; }
    const { data } = await this._http.get("/channels", { params });
    const d = data.data ?? data;
    return { channels: d.channels ?? [], nextCursor: d.nextCursor ?? null };
  }

  async getChannelByRepo(owner: string, name: string): Promise<RepoChannel | null> {
    const { data } = await this._http.get(`/channels/repo/${owner}/${name}`);
    const d = data.data ?? data;
    return d.channel ?? null;
  }

  async getChannel(channelId: string): Promise<RepoChannel> {
    const { data } = await this._http.get(`/channels/${channelId}`);
    const d = data.data ?? data;
    return d.channel;
  }

  async subscribeChannel(channelId: string): Promise<void> {
    await this._http.post(`/channels/${channelId}/subscribe`);
  }

  async unsubscribeChannel(channelId: string): Promise<void> {
    await this._http.delete(`/channels/${channelId}/subscribe`);
  }

  async getChannelFeedX(channelId: string, cursor?: string, limit?: number): Promise<{ posts: ChannelSocialPost[]; nextCursor: string | null }> {
    const params: Record<string, string | number> = {};
    if (cursor) { params.cursor = cursor; }
    if (limit) { params.limit = limit; }
    const { data } = await this._http.get(`/channels/${channelId}/feed/x`, { params });
    const d = data.data ?? data;
    return { posts: d.posts ?? [], nextCursor: d.nextCursor ?? null };
  }

  async getChannelFeedYouTube(channelId: string, cursor?: string, limit?: number): Promise<{ posts: ChannelSocialPost[]; nextCursor: string | null }> {
    const params: Record<string, string | number> = {};
    if (cursor) { params.cursor = cursor; }
    if (limit) { params.limit = limit; }
    const { data } = await this._http.get(`/channels/${channelId}/feed/youtube`, { params });
    const d = data.data ?? data;
    return { posts: d.posts ?? [], nextCursor: d.nextCursor ?? null };
  }

  async getChannelFeedGitchat(channelId: string, cursor?: string, limit?: number): Promise<{ posts: ChannelGitchatPost[]; nextCursor: string | null }> {
    const params: Record<string, string | number> = {};
    if (cursor) { params.cursor = cursor; }
    if (limit) { params.limit = limit; }
    const { data } = await this._http.get(`/channels/${channelId}/feed/gitchat`, { params });
    const d = data.data ?? data;
    return { posts: d.posts ?? [], nextCursor: d.nextCursor ?? null };
  }

  async getChannelFeedGitHub(channelId: string, cursor?: string, limit?: number): Promise<{ events: ChannelGitHubEvent[]; nextCursor: string | null }> {
    const params: Record<string, string | number> = {};
    if (cursor) { params.cursor = cursor; }
    if (limit) { params.limit = limit; }
    const { data } = await this._http.get(`/channels/${channelId}/feed/github`, { params });
    const d = data.data ?? data;
    return { events: d.events ?? [], nextCursor: d.nextCursor ?? null };
  }
```

Add the type imports at the top of the file:

```typescript
import type { RepoChannel, ChannelSocialPost, ChannelGitchatPost, ChannelGitHubEvent } from "../types";
```

- [ ] **Step 2: Commit**

```bash
git add src/api/index.ts
git commit -m "feat(channels): add channel API client methods"
```

---

### Task 3: Explore Panel — Channels Sub-Tab HTML

**Files:**
- Modify: `src/webviews/explore.ts`

- [ ] **Step 1: Add "Channels" sub-tab in chat pane HTML**

Find the chat sub-tabs section (around line 400-402 where Inbox/Friends tabs are defined). Add Channels tab:

```html
<div class="chat-sub-tabs">
  <button class="chat-sub-tab active" data-tab="inbox">Inbox <span id="chat-tab-inbox-count"></span></button>
  <button class="chat-sub-tab" data-tab="friends">Friends <span id="chat-tab-friends-count"></span></button>
  <button class="chat-sub-tab" data-tab="channels">Channels</button>
</div>
```

Add channels pane container after the friends pane:

```html
<!-- Channels pane -->
<div id="chat-pane-channels" class="chat-pane" style="display:none">
  <div id="channels-list" class="channels-list"></div>
  <div id="channels-empty" class="chat-empty" style="display:none">
    <span class="codicon codicon-megaphone"></span>
    <p>No channel subscriptions yet</p>
  </div>
</div>
```

- [ ] **Step 2: Add channel data fetching in explore.ts**

In the explore provider class, add state and fetch method:

```typescript
// Channel state
private _channels: RepoChannel[] = [];

async fetchChannels(): Promise<void> {
  try {
    const result = await apiClient.getMyChannels(undefined, 50);
    this._channels = result.channels;
    this.view.webview.postMessage({
      type: "setChannelData",
      channels: this._channels,
    });
  } catch (err) {
    log(`[Explore/Channels] fetch failed: ${err}`, "warn");
  }
}
```

In the `onMessage` handler, add case for when channels tab is activated:

```typescript
case "fetchChannels": {
  await this.fetchChannels();
  break;
}
case "openChannel": {
  const cp = msg.payload as { channelId: string; repoOwner: string; repoName: string };
  vscode.commands.executeCommand("trending.openChannel", cp.channelId, cp.repoOwner, cp.repoName);
  break;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/webviews/explore.ts
git commit -m "feat(channels): add Channels sub-tab HTML and data fetching in explore"
```

---

### Task 4: Explore Panel — Channel List Rendering (JS)

**Files:**
- Modify: `media/webview/explore.js`

- [ ] **Step 1: Add channel rendering logic**

Add after the existing chat rendering code (around line 760+):

```javascript
// ── Channels ────────────────────────────────────────────

var channelsList = [];

function renderChannels() {
  var listEl = document.getElementById('channels-list');
  var emptyEl = document.getElementById('channels-empty');
  if (!listEl || !emptyEl) { return; }

  if (channelsList.length === 0) {
    listEl.innerHTML = '';
    emptyEl.style.display = '';
    return;
  }
  emptyEl.style.display = 'none';

  listEl.innerHTML = channelsList.map(function (ch) {
    var avatar = ch.avatarUrl
      ? '<img class="channel-avatar" src="' + esc(ch.avatarUrl) + '" alt="" />'
      : '<div class="channel-avatar channel-avatar-placeholder"><span class="codicon codicon-megaphone"></span></div>';
    var badge = ch.role === 'owner' ? '<span class="channel-role-badge">Owner</span>'
      : ch.role === 'admin' ? '<span class="channel-role-badge">Admin</span>'
      : '';
    return '<div class="channel-item" data-channel-id="' + esc(ch.id) + '" data-repo-owner="' + esc(ch.repoOwner) + '" data-repo-name="' + esc(ch.repoName) + '">'
      + avatar
      + '<div class="channel-info">'
      + '<div class="channel-name">' + esc(ch.displayName || ch.repoOwner + '/' + ch.repoName) + ' ' + badge + '</div>'
      + '<div class="channel-meta">' + fmt(ch.subscriberCount) + ' subscribers</div>'
      + '</div>'
      + '</div>';
  }).join('');

  // Click handler
  listEl.querySelectorAll('.channel-item').forEach(function (el) {
    el.addEventListener('click', function () {
      vscode.postMessage({
        type: 'openChannel',
        payload: {
          channelId: el.dataset.channelId,
          repoOwner: el.dataset.repoOwner,
          repoName: el.dataset.repoName,
        },
      });
    });
  });
}
```

- [ ] **Step 2: Handle tab switching to channels**

In the existing chat sub-tab click handler (around line 523-531), add channels case:

```javascript
// Inside the chat-sub-tab click handler, after switching chatActiveTab:
if (chatActiveTab === 'channels' && channelsList.length === 0) {
  vscode.postMessage({ type: 'fetchChannels' });
}
if (chatActiveTab === 'channels') { renderChannels(); }
```

- [ ] **Step 3: Handle setChannelData message**

In the `window.addEventListener('message', ...)` handler:

```javascript
case 'setChannelData':
  channelsList = msg.channels || [];
  renderChannels();
  break;
```

- [ ] **Step 4: Commit**

```bash
git add media/webview/explore.js
git commit -m "feat(channels): render channel list in explore Channels sub-tab"
```

---

### Task 5: Explore Panel — Channel List Styles (CSS)

**Files:**
- Modify: `media/webview/explore.css`

- [ ] **Step 1: Add channel list styles**

Append to `media/webview/explore.css`:

```css
/* ── Channels List ─────────────────────────────────────── */

.channels-list {
  display: flex;
  flex-direction: column;
}

.channel-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  border-bottom: 1px solid var(--gs-border, var(--vscode-widget-border));
}

.channel-item:hover {
  background: var(--gs-hover, var(--vscode-list-hoverBackground));
}

.channel-avatar {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  object-fit: cover;
  flex-shrink: 0;
}

.channel-avatar-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--gs-surface, var(--vscode-badge-background));
  color: var(--gs-text-secondary, var(--vscode-badge-foreground));
}

.channel-info {
  flex: 1;
  min-width: 0;
}

.channel-name {
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.channel-meta {
  font-size: 11px;
  color: var(--gs-text-secondary, var(--vscode-descriptionForeground));
  margin-top: 2px;
}

.channel-role-badge {
  display: inline-block;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 8px;
  background: var(--gs-accent, var(--vscode-badge-background));
  color: var(--gs-on-accent, var(--vscode-badge-foreground));
  vertical-align: middle;
  margin-left: 4px;
}
```

- [ ] **Step 2: Commit**

```bash
git add media/webview/explore.css
git commit -m "style(channels): add channel list styles in explore panel"
```

---

### Task 6: Channel Detail Panel — TypeScript Provider

**Files:**
- Create: `src/webviews/channel.ts`

- [ ] **Step 1: Create ChannelPanel webview provider**

```typescript
// src/webviews/channel.ts
import * as vscode from "vscode";
import { apiClient } from "../api";
import { log } from "../utils/log";
import type { RepoChannel } from "../types";

export class ChannelPanel {
  public static readonly viewType = "trending.channelPanel";
  private static instances = new Map<string, ChannelPanel>();

  private readonly _panel: vscode.WebviewPanel;
  private readonly _channelId: string;
  private readonly _repoOwner: string;
  private readonly _repoName: string;
  private _disposables: vscode.Disposable[] = [];

  static show(
    extensionUri: vscode.Uri,
    channelId: string,
    repoOwner: string,
    repoName: string,
  ): ChannelPanel {
    const key = channelId;
    const existing = ChannelPanel.instances.get(key);
    if (existing) {
      existing._panel.reveal();
      return existing;
    }

    const panel = vscode.window.createWebviewPanel(
      ChannelPanel.viewType,
      `📢 ${repoOwner}/${repoName}`,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "media")],
      },
    );

    const instance = new ChannelPanel(panel, extensionUri, channelId, repoOwner, repoName);
    ChannelPanel.instances.set(key, instance);
    return instance;
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    channelId: string,
    repoOwner: string,
    repoName: string,
  ) {
    this._panel = panel;
    this._channelId = channelId;
    this._repoOwner = repoOwner;
    this._repoName = repoName;

    this._panel.webview.html = this.getHtml(extensionUri);
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._panel.webview.onDidReceiveMessage(
      (msg) => this.onMessage(msg),
      null,
      this._disposables,
    );

    // Load initial data
    this.fetchFeed("x");
  }

  private async onMessage(msg: { type: string; payload?: any }): Promise<void> {
    const p = msg.payload;
    switch (msg.type) {
      case "fetchFeed": {
        await this.fetchFeed(p?.source, p?.cursor);
        break;
      }
      case "subscribe": {
        try {
          await apiClient.subscribeChannel(this._channelId);
          this._panel.webview.postMessage({ type: "subscribed" });
        } catch (err) {
          log(`[Channel] subscribe failed: ${err}`, "warn");
        }
        break;
      }
      case "unsubscribe": {
        try {
          await apiClient.unsubscribeChannel(this._channelId);
          this._panel.webview.postMessage({ type: "unsubscribed" });
        } catch (err) {
          log(`[Channel] unsubscribe failed: ${err}`, "warn");
        }
        break;
      }
      case "adminPost": {
        try {
          // Reuse existing Gitchat community post creation
          // This posts to the backend which will auto-tag with repoTags
          await apiClient.createPost({
            body: p.body,
            imageUrls: p.imageUrls,
            repoTags: [`${this._repoOwner}/${this._repoName}`],
          });
          this._panel.webview.postMessage({ type: "postCreated" });
          // Refresh gitchat feed
          await this.fetchFeed("gitchat");
        } catch (err) {
          log(`[Channel] post failed: ${err}`, "warn");
        }
        break;
      }
    }
  }

  private async fetchFeed(source: string, cursor?: string): Promise<void> {
    try {
      let result: any;
      switch (source) {
        case "x":
          result = await apiClient.getChannelFeedX(this._channelId, cursor);
          this._panel.webview.postMessage({ type: "feedData", source: "x", ...result });
          break;
        case "youtube":
          result = await apiClient.getChannelFeedYouTube(this._channelId, cursor);
          this._panel.webview.postMessage({ type: "feedData", source: "youtube", ...result });
          break;
        case "gitchat":
          result = await apiClient.getChannelFeedGitchat(this._channelId, cursor);
          this._panel.webview.postMessage({ type: "feedData", source: "gitchat", ...result });
          break;
        case "github":
          result = await apiClient.getChannelFeedGitHub(this._channelId, cursor);
          this._panel.webview.postMessage({ type: "feedData", source: "github", events: result.events, nextCursor: result.nextCursor });
          break;
      }
    } catch (err) {
      log(`[Channel] feed fetch failed (${source}): ${err}`, "warn");
    }
  }

  private getHtml(extensionUri: vscode.Uri): string {
    const webview = this._panel.webview;
    const mediaUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "webview"));
    const sharedCss = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "webview", "shared.css"));
    const channelCss = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "webview", "channel.css"));
    const sharedJs = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "webview", "shared.js"));
    const channelJs = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "webview", "channel.js"));
    const codiconCss = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "codicon", "codicon.css"));

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource}; img-src ${webview.cspSource} https:; font-src ${webview.cspSource};" />
  <link rel="stylesheet" href="${codiconCss}" />
  <link rel="stylesheet" href="${sharedCss}" />
  <link rel="stylesheet" href="${channelCss}" />
</head>
<body>
  <div class="channel-container">
    <!-- Header -->
    <div class="channel-header">
      <div class="channel-header-info">
        <span class="codicon codicon-megaphone"></span>
        <span class="channel-title">${this._repoOwner}/${this._repoName}</span>
      </div>
      <button id="subscribe-btn" class="channel-subscribe-btn">Subscribe</button>
    </div>

    <!-- Source Tabs (matching web UI) -->
    <div class="channel-tabs">
      <button class="channel-tab active" data-source="x"><span class="codicon codicon-twitter"></span> X</button>
      <button class="channel-tab" data-source="youtube"><span class="codicon codicon-play"></span> YouTube</button>
      <button class="channel-tab" data-source="gitchat"><span class="codicon codicon-comment-discussion"></span> Gitchat</button>
      <button class="channel-tab" data-source="github"><span class="codicon codicon-github"></span> GitHub</button>
    </div>

    <!-- Feed Content -->
    <div id="channel-feed" class="channel-feed"></div>
    <div id="channel-loading" class="channel-loading" style="display:none">Loading...</div>
    <div id="channel-empty" class="channel-empty" style="display:none">
      <span class="codicon codicon-inbox"></span>
      <p>No content yet</p>
    </div>

    <!-- Load More -->
    <button id="load-more-btn" class="channel-load-more" style="display:none">Load more</button>

    <!-- Admin Post Box (hidden for subscribers) -->
    <div id="admin-post-box" class="channel-admin-post" style="display:none">
      <textarea id="admin-post-input" placeholder="Post an update to this channel..." rows="2"></textarea>
      <button id="admin-post-send" class="channel-post-btn">Post</button>
    </div>
  </div>

  <script src="${sharedJs}"></script>
  <script src="${channelJs}"></script>
  <script>
    window.channelConfig = {
      channelId: "${this._channelId}",
      repoOwner: "${this._repoOwner}",
      repoName: "${this._repoName}",
    };
  </script>
</body>
</html>`;
  }

  private dispose(): void {
    ChannelPanel.instances.delete(this._channelId);
    this._disposables.forEach((d) => d.dispose());
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/webviews/channel.ts
git commit -m "feat(channels): add ChannelPanel webview provider with 4-source feed tabs"
```

---

### Task 7: Channel Detail — Frontend JS

**Files:**
- Create: `media/webview/channel.js`

- [ ] **Step 1: Create channel detail JavaScript**

```javascript
// media/webview/channel.js
(function () {
  var activeSource = 'x';
  var feedData = { x: [], youtube: [], gitchat: [], github: [] };
  var cursors = { x: null, youtube: null, gitchat: null, github: null };
  var isAdmin = false;

  function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function timeAgo(d) {
    var s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
    if (s < 60) { return s + 's'; }
    if (s < 3600) { return Math.floor(s / 60) + 'm'; }
    if (s < 86400) { return Math.floor(s / 3600) + 'h'; }
    return Math.floor(s / 86400) + 'd';
  }

  // ── Tab Switching ─────────────────────────────────────────

  document.querySelectorAll('.channel-tab').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var source = btn.dataset.source;
      if (source === activeSource) { return; }
      activeSource = source;
      document.querySelectorAll('.channel-tab').forEach(function (b) {
        b.classList.toggle('active', b.dataset.source === source);
      });
      if (feedData[source].length === 0) {
        vscode.postMessage({ type: 'fetchFeed', payload: { source: source } });
        showLoading();
      } else {
        renderFeed();
      }
    });
  });

  // ── Rendering ─────────────────────────────────────────────

  function showLoading() {
    document.getElementById('channel-feed').innerHTML = '';
    document.getElementById('channel-loading').style.display = '';
    document.getElementById('channel-empty').style.display = 'none';
    document.getElementById('load-more-btn').style.display = 'none';
  }

  function renderFeed() {
    var feedEl = document.getElementById('channel-feed');
    var loadingEl = document.getElementById('channel-loading');
    var emptyEl = document.getElementById('channel-empty');
    var loadMoreEl = document.getElementById('load-more-btn');

    loadingEl.style.display = 'none';

    var items = feedData[activeSource];
    if (items.length === 0) {
      feedEl.innerHTML = '';
      emptyEl.style.display = '';
      loadMoreEl.style.display = 'none';
      return;
    }
    emptyEl.style.display = 'none';

    var html = '';
    if (activeSource === 'x' || activeSource === 'youtube') {
      html = items.map(renderSocialPost).join('');
    } else if (activeSource === 'gitchat') {
      html = items.map(renderGitchatPost).join('');
    } else if (activeSource === 'github') {
      html = items.map(renderGitHubEvent).join('');
    }
    feedEl.innerHTML = html;

    loadMoreEl.style.display = cursors[activeSource] ? '' : 'none';
  }

  function renderSocialPost(post) {
    var avatar = post.author_avatar || post.authorAvatar;
    var handle = post.author_handle || post.authorHandle || '';
    var name = post.author_name || post.authorName || handle;
    var body = post.body || '';
    var time = post.platform_created_at || post.platformCreatedAt;
    var platform = post.platform || activeSource;

    return '<div class="channel-post">'
      + '<div class="channel-post-header">'
      + (avatar ? '<img class="channel-post-avatar" src="' + esc(avatar) + '" />' : '')
      + '<div class="channel-post-author">'
      + '<span class="channel-post-name">' + esc(name) + '</span>'
      + '<span class="channel-post-handle">@' + esc(handle) + '</span>'
      + '</div>'
      + '<span class="channel-post-badge">' + esc(platform.toUpperCase()) + '</span>'
      + '<span class="channel-post-time">' + timeAgo(time) + '</span>'
      + '</div>'
      + '<div class="channel-post-body">' + esc(body) + '</div>'
      + '</div>';
  }

  function renderGitchatPost(post) {
    var avatar = post.author_avatar || post.authorAvatar;
    var name = post.author_name || post.authorName || post.author_login || post.authorLogin;
    var body = post.body || '';
    var time = post.created_at || post.createdAt;
    var images = post.image_urls || post.imageUrls || [];

    var imgHtml = images.length > 0
      ? '<div class="channel-post-images">' + images.map(function (url) {
          return '<img class="channel-post-img" src="' + esc(url) + '" />';
        }).join('') + '</div>'
      : '';

    return '<div class="channel-post">'
      + '<div class="channel-post-header">'
      + (avatar ? '<img class="channel-post-avatar" src="' + esc(avatar) + '" />' : '')
      + '<div class="channel-post-author">'
      + '<span class="channel-post-name">' + esc(name) + '</span>'
      + '</div>'
      + '<span class="channel-post-badge">GITCHAT</span>'
      + '<span class="channel-post-time">' + timeAgo(time) + '</span>'
      + '</div>'
      + '<div class="channel-post-body">' + esc(body) + '</div>'
      + imgHtml
      + '</div>';
  }

  function renderGitHubEvent(event) {
    var actor = event.actor_login || event.actorLogin;
    var avatar = event.actor_avatar || event.actorAvatar;
    var type = event.type || '';
    var title = event.pr_title || event.prTitle || event.issue_title || event.issueTitle || event.release_tag || event.releaseTag || '';
    var narration = event.narration_body || event.narrationBody || '';
    var time = event.event_created_at || event.eventCreatedAt;

    var icon = type === 'release' ? 'tag' : type === 'star' ? 'star-full' : type === 'fork' ? 'repo-forked' : type === 'pr-merged' ? 'git-merge' : 'git-pull-request';

    return '<div class="channel-post channel-post-event">'
      + '<div class="channel-post-header">'
      + '<span class="codicon codicon-' + icon + '"></span>'
      + (avatar ? '<img class="channel-post-avatar-sm" src="' + esc(avatar) + '" />' : '')
      + '<span class="channel-post-actor">' + esc(actor) + '</span>'
      + '<span class="channel-post-type">' + esc(type) + '</span>'
      + '<span class="channel-post-time">' + timeAgo(time) + '</span>'
      + '</div>'
      + (title ? '<div class="channel-post-title">' + esc(title) + '</div>' : '')
      + (narration ? '<div class="channel-post-narration">' + esc(narration) + '</div>' : '')
      + '</div>';
  }

  // ── Load More ─────────────────────────────────────────────

  document.getElementById('load-more-btn').addEventListener('click', function () {
    vscode.postMessage({
      type: 'fetchFeed',
      payload: { source: activeSource, cursor: cursors[activeSource] },
    });
    showLoading();
  });

  // ── Admin Post ────────────────────────────────────────────

  var postBtn = document.getElementById('admin-post-send');
  if (postBtn) {
    postBtn.addEventListener('click', function () {
      var input = document.getElementById('admin-post-input');
      var body = input.value.trim();
      if (!body) { return; }
      vscode.postMessage({ type: 'adminPost', payload: { body: body } });
      input.value = '';
    });
  }

  // ── Message Handler ───────────────────────────────────────

  window.addEventListener('message', function (e) {
    var msg = e.data;
    switch (msg.type) {
      case 'feedData':
        var source = msg.source;
        var items = msg.posts || msg.events || [];
        if (msg.cursor) {
          // Append (load more)
          feedData[source] = feedData[source].concat(items);
        } else {
          feedData[source] = items;
        }
        cursors[source] = msg.nextCursor || null;
        if (source === activeSource) { renderFeed(); }
        break;
      case 'channelInfo':
        isAdmin = msg.role === 'owner' || msg.role === 'admin';
        var adminBox = document.getElementById('admin-post-box');
        if (adminBox) { adminBox.style.display = isAdmin ? '' : 'none'; }
        break;
      case 'postCreated':
        // Refresh gitchat tab
        break;
    }
  });
})();
```

- [ ] **Step 2: Commit**

```bash
git add media/webview/channel.js
git commit -m "feat(channels): add channel detail frontend with tab switching and rendering"
```

---

### Task 8: Channel Detail — Styles (CSS)

**Files:**
- Create: `media/webview/channel.css`

- [ ] **Step 1: Create channel detail styles**

```css
/* media/webview/channel.css */

.channel-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}

/* ── Header ──────────────────────────────────────────── */

.channel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--gs-border, var(--vscode-widget-border));
  flex-shrink: 0;
}

.channel-header-info {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
}

.channel-title {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.channel-subscribe-btn {
  padding: 4px 12px;
  border-radius: 4px;
  border: 1px solid var(--gs-accent, var(--vscode-button-background));
  background: transparent;
  color: var(--gs-accent, var(--vscode-button-background));
  cursor: pointer;
  font-size: 12px;
}

.channel-subscribe-btn:hover {
  background: var(--gs-accent, var(--vscode-button-background));
  color: var(--gs-on-accent, var(--vscode-button-foreground));
}

/* ── Source Tabs ──────────────────────────────────────── */

.channel-tabs {
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--gs-border, var(--vscode-widget-border));
  flex-shrink: 0;
}

.channel-tab {
  flex: 1;
  padding: 8px 4px;
  border: none;
  background: transparent;
  color: var(--gs-text-secondary, var(--vscode-descriptionForeground));
  cursor: pointer;
  font-size: 12px;
  text-align: center;
  border-bottom: 2px solid transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}

.channel-tab:hover {
  color: var(--gs-text, var(--vscode-foreground));
}

.channel-tab.active {
  color: var(--gs-accent, var(--vscode-textLink-foreground));
  border-bottom-color: var(--gs-accent, var(--vscode-textLink-foreground));
}

/* ── Feed ────────────────────────────────────────────── */

.channel-feed {
  flex: 1;
  overflow-y: auto;
  padding: 0;
}

.channel-loading,
.channel-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px;
  color: var(--gs-text-secondary, var(--vscode-descriptionForeground));
  gap: 8px;
}

.channel-load-more {
  display: block;
  width: 100%;
  padding: 8px;
  border: none;
  background: transparent;
  color: var(--gs-accent, var(--vscode-textLink-foreground));
  cursor: pointer;
  font-size: 12px;
}

.channel-load-more:hover {
  background: var(--gs-hover, var(--vscode-list-hoverBackground));
}

/* ── Post Card ───────────────────────────────────────── */

.channel-post {
  padding: 12px;
  border-bottom: 1px solid var(--gs-border, var(--vscode-widget-border));
}

.channel-post:hover {
  background: var(--gs-hover, var(--vscode-list-hoverBackground));
}

.channel-post-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.channel-post-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
}

.channel-post-avatar-sm {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  object-fit: cover;
}

.channel-post-author {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.channel-post-name {
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.channel-post-handle {
  font-size: 11px;
  color: var(--gs-text-secondary, var(--vscode-descriptionForeground));
}

.channel-post-badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--gs-surface, var(--vscode-badge-background));
  color: var(--gs-on-surface, var(--vscode-badge-foreground));
  flex-shrink: 0;
  margin-left: auto;
}

.channel-post-time {
  font-size: 11px;
  color: var(--gs-text-secondary, var(--vscode-descriptionForeground));
  flex-shrink: 0;
}

.channel-post-body {
  font-size: 13px;
  line-height: 1.4;
  white-space: pre-wrap;
  word-break: break-word;
}

.channel-post-title {
  font-size: 13px;
  font-weight: 500;
  margin-top: 4px;
}

.channel-post-narration {
  font-size: 12px;
  color: var(--gs-text-secondary, var(--vscode-descriptionForeground));
  font-style: italic;
  margin-top: 4px;
}

.channel-post-images {
  display: flex;
  gap: 4px;
  margin-top: 8px;
  flex-wrap: wrap;
}

.channel-post-img {
  max-width: 100%;
  max-height: 200px;
  border-radius: 8px;
  object-fit: cover;
}

.channel-post-event .channel-post-header {
  gap: 6px;
}

.channel-post-actor {
  font-size: 12px;
  font-weight: 500;
}

.channel-post-type {
  font-size: 11px;
  color: var(--gs-text-secondary, var(--vscode-descriptionForeground));
  text-transform: capitalize;
}

/* ── Admin Post Box ──────────────────────────────────── */

.channel-admin-post {
  display: flex;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid var(--gs-border, var(--vscode-widget-border));
  flex-shrink: 0;
  align-items: flex-end;
}

.channel-admin-post textarea {
  flex: 1;
  resize: none;
  border: 1px solid var(--gs-border, var(--vscode-input-border));
  background: var(--gs-input-bg, var(--vscode-input-background));
  color: var(--gs-text, var(--vscode-input-foreground));
  border-radius: 4px;
  padding: 6px 8px;
  font-size: 13px;
  font-family: inherit;
}

.channel-post-btn {
  padding: 6px 16px;
  border: none;
  border-radius: 4px;
  background: var(--gs-accent, var(--vscode-button-background));
  color: var(--gs-on-accent, var(--vscode-button-foreground));
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
}

.channel-post-btn:hover {
  opacity: 0.9;
}
```

- [ ] **Step 2: Commit**

```bash
git add media/webview/channel.css
git commit -m "style(channels): add channel detail panel styles"
```

---

### Task 9: Command Registration + Package.json

**Files:**
- Modify: `src/commands/index.ts`
- Modify: `package.json`
- Modify: `src/extension.ts`

- [ ] **Step 1: Add openChannel command**

In `src/commands/index.ts`, add:

```typescript
import { ChannelPanel } from "../webviews/channel";

// Inside the registerCommands function:
context.subscriptions.push(
  vscode.commands.registerCommand("trending.openChannel", (channelId: string, repoOwner: string, repoName: string) => {
    ChannelPanel.show(context.extensionUri, channelId, repoOwner, repoName);
  }),
);
```

- [ ] **Step 2: Declare command in package.json**

Add to `contributes.commands` array:

```json
{
  "command": "trending.openChannel",
  "title": "Open Repo Channel",
  "category": "Gitchat"
}
```

- [ ] **Step 3: Verify compilation**

```bash
npm run compile
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/commands/index.ts package.json src/extension.ts
git commit -m "feat(channels): register openChannel command and update package.json"
```

---

### Task 10: Integration — createPost API Method

**Files:**
- Modify: `src/api/index.ts`

The admin posting feature reuses Gitchat community posts. Check if `createPost` method already exists in API client. If not, add:

- [ ] **Step 1: Add createPost method (if missing)**

```typescript
async createPost(params: { body: string; imageUrls?: string[]; repoTags?: string[] }): Promise<any> {
  const { data } = await this._http.post("/posts", {
    body: params.body,
    image_urls: params.imageUrls || [],
    repo_tags: params.repoTags || [],
    visibility: "public",
  });
  return data.data ?? data;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/api/index.ts
git commit -m "feat(channels): add createPost API method for admin channel posting"
```

---

## UI Flow Summary

```
Explore Panel
├── Chat tab (existing)
│   ├── Inbox (existing)
│   ├── Friends (existing)
│   └── Channels (NEW) ← Task 3-5
│       ├── 📢 anthropics/claude-code  [Owner]
│       ├── 📢 vercel/next.js
│       └── 📢 GitchatAI/gitchat      [Admin]
│
└── Click channel → Opens ChannelPanel (NEW) ← Task 6-8
    ├── Header: 📢 owner/repo  [Subscribe]
    ├── Tabs: X | YouTube | Gitchat | GitHub
    ├── Feed content (per source)
    └── Admin post box (owner/admin only)
```

## Telegram Mapping (Reference)

| Telegram Channel | Gitchat Repo Channel |
|------------------|---------------------|
| Channel created by user | Channel auto-provisioned per repo |
| Channel owner | Repo owner (role=owner) |
| Admin with can_post_messages | Contributors (role=admin) |
| Subscriber (read-only) | Tracked/starred users (role=subscriber) |
| Channel posts (1-way broadcast) | Aggregated X + YouTube + Gitchat + GitHub content |
| Discussion group (linked_chat_id) | Existing group chat per repo (future link) |
| Post reactions | Reuse existing reaction system (future) |
