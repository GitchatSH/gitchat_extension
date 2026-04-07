import * as vscode from "vscode";
import { apiClient, getOtherUser } from "../api";
import { authManager } from "../auth";
import { realtimeClient } from "../realtime";
import { configManager } from "../config";
import { getNonce, getUri, log } from "../utils";
import { fireFollowChanged, onDidChangeFollow } from "../events/follow";
import type { Conversation, ExtensionModule, TrendingRepo, TrendingPerson, UserRepo, WebviewMessage } from "../types";

export class ExploreWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "trending.explore";
  view?: vscode.WebviewView;

  // Chat state
  private _dmConvMap = new Map<string, string>();
  private _mutedConvs = new Set<string>();

  // Feed state
  private _feedPage = 1;

  // Polling
  private _trendingInterval?: ReturnType<typeof setInterval>;
  private _refreshTimer?: ReturnType<typeof setTimeout>;

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")],
    };
    webviewView.webview.html = this.getHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage((msg: WebviewMessage) => this.onMessage(msg));
  }

  // ===================== CHAT DATA =====================
  debouncedRefreshChat(): void {
    clearTimeout(this._refreshTimer);
    this._refreshTimer = setTimeout(() => this.refreshChat(), 500);
  }

  async refreshChat(): Promise<void> {
    if (!authManager.isSignedIn || !this.view) { return; }
    apiClient.invalidateConversationsCache();
    try {
      let following = await apiClient.getFollowing(1, 100);
      log(`[Explore/Chat] getFollowing returned ${following.length} friends`);
      if (following.length === 0 && authManager.token) {
        following = await this.fetchGitHubFollowing(authManager.token);
      }
      const logins = following.map((f: { login: string }) => f.login);
      let presenceData: Record<string, string | null> = {};
      if (logins.length) {
        try {
          presenceData = await apiClient.getPresence(logins.slice(0, 50));
        } catch (err) {
          log(`[Explore/Chat] getPresence failed: ${err}`, "warn");
        }
      }

      let conversations: Conversation[] = [];
      try {
        conversations = await apiClient.getConversations();
        realtimeClient.subscribeToConversations(conversations.map(c => c.id));
      } catch (err) {
        log(`[Explore/Chat] getConversations failed: ${err}`, "warn");
      }

      const unreadCounts: Record<string, number> = {};
      for (const conv of conversations) {
        const other = getOtherUser(conv, authManager.login);
        if (other && ((conv as unknown as Record<string, number>).unread_count > 0)) {
          unreadCounts[other.login] = (conv as unknown as Record<string, number>).unread_count || 1;
        }
      }

      const threshold = configManager.current.presenceHeartbeat * 5;
      const friends = following.map((f: { login: string; name?: string; avatar_url?: string }) => {
        const lastSeenStr = presenceData[f.login];
        const lastSeen = lastSeenStr ? new Date(lastSeenStr).getTime() : 0;
        const online = lastSeen > 0 && (Date.now() - lastSeen < threshold);
        return { login: f.login, name: f.name || f.login, avatar_url: f.avatar_url || "", online, lastSeen, unread: unreadCounts[f.login] || 0 };
      });

      friends.sort((a: { online: boolean; lastSeen: number; name: string }, b: { online: boolean; lastSeen: number; name: string }) => {
        if (a.online && !b.online) { return -1; }
        if (!a.online && b.online) { return 1; }
        if (a.lastSeen !== b.lastSeen) { return b.lastSeen - a.lastSeen; }
        return a.name.localeCompare(b.name);
      });

      this._dmConvMap.clear();
      this._mutedConvs.clear();
      const convData = conversations.map((c: Conversation) => {
        const other = getOtherUser(c, authManager.login);
        if (c.type !== "group" && !c.is_group && other) { this._dmConvMap.set(c.id, other.login); }
        if ((c as unknown as Record<string, boolean>).is_muted) { this._mutedConvs.add(c.id); }
        return { ...c, other_user: other };
      });

      this.view.webview.postMessage({ type: "setChatData", friends, conversations: convData, currentUser: authManager.login });
    } catch (err) {
      log(`[Explore/Chat] refresh failed: ${err}`, "warn");
    }
  }

  setBadge(count: number): void {
    if (this.view) {
      this.view.badge = count > 0 ? { value: count, tooltip: `${count} unread message${count !== 1 ? "s" : ""}` } : undefined;
    }
  }

  clearUnread(login: string): void {
    this.view?.webview.postMessage({ type: "clearUnread", login });
  }

  isConversationMuted(conversationId: string): boolean {
    return this._mutedConvs.has(conversationId);
  }

  showTyping(conversationId: string, user: string): void {
    if (conversationId) {
      const dmLogin = this._dmConvMap.get(conversationId);
      if (dmLogin && dmLogin === user) {
        this.view?.webview.postMessage({ type: "friendTyping", login: user });
      }
    } else {
      for (const [, login] of this._dmConvMap) {
        if (login === user) {
          this.view?.webview.postMessage({ type: "friendTyping", login: user });
          break;
        }
      }
    }
  }

  private async fetchGitHubFollowing(token: string): Promise<{ login: string; name: string; avatar_url: string }[]> {
    try {
      const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" };
      const res = await fetch("https://api.github.com/user/following?per_page=100", { headers });
      if (!res.ok) { return []; }
      const users = (await res.json()) as { login: string; avatar_url?: string }[];
      return users.map(u => ({ login: u.login, name: u.login, avatar_url: u.avatar_url || "" }));
    } catch { return []; }
  }

  // ===================== FEED DATA =====================
  async refreshFeed(): Promise<void> {
    if (!authManager.isSignedIn || !this.view) { return; }
    try {
      this._feedPage = 1;
      const { results, hasMore } = await apiClient.getForYouFeed(this._feedPage);
      log(`[Explore/Feed] loaded ${results.length} for-you items`);
      this.view.webview.postMessage({ type: "setFeedEvents", events: results, replace: true, hasMore });
    } catch (err) {
      log(`[Explore/Feed] refresh failed: ${err}`, "warn");
    }
  }

  async refreshMyRepos(): Promise<void> {
    if (!authManager.isSignedIn || !this.view) { return; }
    try {
      const [repos, starred] = await Promise.all([
        apiClient.getUserRepos().catch(() => [] as UserRepo[]),
        apiClient.getStarredRepos().catch(() => [] as UserRepo[]),
      ]);
      this.view.webview.postMessage({ type: "setMyRepos", repos, starred });
    } catch (err) {
      log(`[Explore/MyRepos] refresh failed: ${err}`, "warn");
    }
  }

  // ===================== TRENDING DATA =====================
  async refreshTrendingRepos(): Promise<void> {
    if (!this.view) { return; }
    try {
      const repos = await apiClient.getTrendingRepos();
      let starred: Record<string, boolean> = {};
      if (authManager.isSignedIn && repos.length) {
        const slugs = repos.map((r: TrendingRepo) => `${r.owner}/${r.name}`);
        starred = await apiClient.batchCheckStarred(slugs);
      }
      this.view.webview.postMessage({ type: "setTrendingRepos", repos, starred });
    } catch (err) {
      log(`[Explore/TrendingRepos] refresh failed: ${err}`, "warn");
    }
  }

  async refreshTrendingPeople(): Promise<void> {
    if (!this.view) { return; }
    try {
      const people = await apiClient.getTrendingPeople();
      const followMap: Record<string, boolean> = {};
      if (authManager.isSignedIn && people.length) {
        const logins = people.map((p: TrendingPerson) => p.login);
        const statuses = await apiClient.batchFollowStatus(logins);
        for (const [login, status] of Object.entries(statuses)) {
          followMap[login] = (status as { following: boolean }).following;
        }
      }
      this.view.webview.postMessage({ type: "setTrendingPeople", people, followMap });
    } catch (err) {
      log(`[Explore/TrendingPeople] refresh failed: ${err}`, "warn");
    }
  }

  async refreshSuggestions(): Promise<void> {
    if (!authManager.isSignedIn || !this.view) { return; }
    try {
      const suggestions = await apiClient.getFollowingSuggestions();
      this.view.webview.postMessage({ type: "setSuggestions", suggestions });
    } catch (err) {
      log(`[Explore/WhoToFollow] refresh failed: ${err}`, "warn");
    }
  }

  // ===================== REFRESH ALL =====================
  async refreshAll(): Promise<void> {
    await Promise.allSettled([
      this.refreshChat(),
      this.refreshFeed(),
      this.refreshMyRepos(),
      this.refreshTrendingRepos(),
      this.refreshTrendingPeople(),
      this.refreshSuggestions(),
    ]);
  }

  startPolling(context: vscode.ExtensionContext): void {
    const interval = configManager.current.trendingPollInterval;
    this._trendingInterval = setInterval(() => {
      this.refreshTrendingRepos();
      this.refreshTrendingPeople();
    }, interval);

    configManager.onDidChangeFocus((focused) => {
      if (this._trendingInterval) { clearInterval(this._trendingInterval); }
      const newInterval = focused ? interval : interval * 3;
      if (focused) {
        this.refreshTrendingRepos();
        this.refreshTrendingPeople();
      }
      this._trendingInterval = setInterval(() => {
        this.refreshTrendingRepos();
        this.refreshTrendingPeople();
      }, newInterval);
    });

    context.subscriptions.push({ dispose: () => { if (this._trendingInterval) { clearInterval(this._trendingInterval); } } });
  }

  // ===================== MESSAGE HANDLER =====================
  private async onMessage(msg: WebviewMessage): Promise<void> {
    const p = msg.payload as Record<string, string>;
    switch (msg.type) {
      case "ready": {
        const cfg = configManager.current;
        this.view?.webview.postMessage({
          type: "settings",
          showMessageNotifications: cfg.showMessageNotifications,
          messageSound: cfg.messageSound,
          debugLogs: cfg.debugLogs,
        });
        this.refreshAll();
        break;
      }

      // Settings
      case "updateSetting": {
        const { key, value } = msg.payload as { key: string; value: boolean };
        const settingMap: Record<string, string> = {
          notifications: "trending.showMessageNotifications",
          sound: "trending.messageSound",
          debug: "trending.debugLogs",
        };
        const settingKey = settingMap[key];
        if (settingKey) {
          await vscode.workspace.getConfiguration().update(settingKey, value, vscode.ConfigurationTarget.Global);
        }
        break;
      }
      case "signOut":
        vscode.commands.executeCommand("trending.signOut");
        break;

      // Chat actions
      case "openChat":
        vscode.commands.executeCommand("trending.messageUser", p.login);
        break;
      case "viewProfile":
        vscode.commands.executeCommand("trending.viewProfile", p.login);
        break;
      case "openConversation":
        vscode.commands.executeCommand("trending.openChat", p.conversationId);
        break;
      case "newChat": {
        const choice = await vscode.window.showQuickPick(
          [
            { label: "$(comment-discussion) New Message", description: "Direct message to a user", value: "dm" },
            { label: "$(organization) New Group", description: "Create a group chat", value: "group" },
          ],
          { placeHolder: "Start a new conversation" }
        );
        if (choice?.value === "dm") { vscode.commands.executeCommand("trending.messageUser"); }
        else if (choice?.value === "group") { vscode.commands.executeCommand("trending.createGroup"); }
        break;
      }
      case "pin":
        try { await apiClient.pinConversation(p.conversationId); this.refreshChat(); }
        catch { vscode.window.showErrorMessage("Failed to pin conversation"); }
        break;
      case "unpin":
        try { await apiClient.unpinConversation(p.conversationId); this.refreshChat(); }
        catch { vscode.window.showErrorMessage("Failed to unpin conversation"); }
        break;
      case "markRead":
        try {
          await apiClient.markConversationRead(p.conversationId);
          this.refreshChat();
          import("../statusbar").then(m => m.fetchCounts()).catch(() => {});
        }
        catch { vscode.window.showErrorMessage("Failed to mark as read"); }
        break;
      case "deleteConversation": {
        const confirm = await vscode.window.showWarningMessage("Delete this conversation?", { modal: true }, "Delete");
        if (confirm === "Delete") {
          try { await apiClient.deleteConversation(p.conversationId); this.refreshChat(); }
          catch { vscode.window.showErrorMessage("Failed to delete conversation"); }
        }
        break;
      }

      // Feed actions
      case "loadMore":
        this._feedPage++;
        try {
          const { results, hasMore } = await apiClient.getForYouFeed(this._feedPage);
          this.view?.webview.postMessage({ type: "setFeedEvents", events: results, replace: false, hasMore });
        } catch (err) {
          log(`[Explore/Feed] loadMore failed: ${err}`, "warn");
        }
        break;
      case "like":
        try {
          const [owner, repo] = (p.repoSlug || "").split("/");
          if (owner && repo) { await apiClient.toggleLike(owner, repo, p.eventId); }
        } catch { /* ignore */ }
        break;
      case "openUrl":
        if (p.url) { vscode.env.openExternal(vscode.Uri.parse(p.url)); }
        break;
      case "viewRepo": {
        const { owner, repo } = msg.payload as { owner: string; repo: string };
        if (owner && repo) { vscode.commands.executeCommand("trending.viewRepoDetail", owner, repo); }
        break;
      }

      // Trending actions
      case "followUser":
        try {
          await apiClient.followUser(p.login);
          fireFollowChanged(p.login, true);
        } catch {
          vscode.window.showErrorMessage("Failed to follow user");
          this.refreshTrendingPeople();
          this.refreshSuggestions();
        }
        break;
      case "unfollowUser":
        try {
          await apiClient.unfollowUser(p.login);
          fireFollowChanged(p.login, false);
        } catch {
          vscode.window.showErrorMessage("Failed to unfollow user");
          this.refreshTrendingPeople();
        }
        break;
      case "message":
        vscode.commands.executeCommand("trending.messageUser", p.login);
        break;
      case "getPreview":
        try {
          const preview = await apiClient.getUserPreview(p.login);
          this.view?.webview.postMessage({ type: "setPreview", login: p.login, preview });
        } catch { /* ignore */ }
        break;

      // Refresh actions (Task 6)
      case "refreshTrendingRepos":
        this.refreshTrendingRepos();
        break;
      case "refreshTrendingPeople":
        this.refreshTrendingPeople();
        break;
      case "refreshMyRepos":
        this.refreshMyRepos();
        break;
    }
  }

  // ===================== HTML TEMPLATE =====================
  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const sharedCss = getUri(webview, this.extensionUri, ["media", "webview", "shared.css"]);
    const codiconCss = getUri(webview, this.extensionUri, ["media", "webview", "codicon.css"]);
    const css = getUri(webview, this.extensionUri, ["media", "webview", "explore.css"]);
    const sharedJs = getUri(webview, this.extensionUri, ["media", "webview", "shared.js"]);
    const js = getUri(webview, this.extensionUri, ["media", "webview", "explore.js"]);

    return `<!DOCTYPE html>
<html><head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} https:;">
  <link rel="stylesheet" href="${sharedCss}">
  <link rel="stylesheet" href="${codiconCss}">
  <link rel="stylesheet" href="${css}">
</head><body>

<!-- Main Tab Bar -->
<div class="explore-tabs">
  <button class="explore-tab active" data-tab="chat"><span class="codicon codicon-comment-discussion"></span> Chat <span id="chat-main-badge" class="tab-badge" style="display:none"></span></button>
  <button class="explore-tab" data-tab="feed"><span class="codicon codicon-rss"></span> Feed</button>
  <button class="explore-tab" data-tab="trending"><span class="codicon codicon-rocket"></span> Trending</button>
</div>

<!-- ===================== CHAT PANE ===================== -->
<div id="pane-chat" class="tab-pane active">
  <div class="chat-header" style="position:relative">
    <div class="chat-sub-tabs">
      <button class="chat-sub-tab active" data-tab="inbox">Inbox <span id="chat-tab-inbox-count"></span></button>
      <button class="chat-sub-tab" data-tab="friends">Friends <span id="chat-tab-friends-count"></span></button>
    </div>
    <div class="gs-flex gs-gap-4 gs-items-center">
      <button class="gs-btn-icon" id="chat-settings-btn" title="Settings"><span class="codicon codicon-settings-gear"></span></button>
      <button class="gs-btn-icon" id="chat-new" title="New message"><span class="codicon codicon-comment"></span></button>
    </div>
    <div class="settings-dropdown" id="chat-settings-dropdown" style="display:none">
      <label class="settings-item"><input type="checkbox" id="chat-setting-notifications" checked /> Message notifications</label>
      <label class="settings-item"><input type="checkbox" id="chat-setting-sound" /> Message sound</label>
      <label class="settings-item"><input type="checkbox" id="chat-setting-debug" /> Debug logs</label>
      <div class="settings-divider"></div>
      <button class="settings-action" id="chat-setting-signout">Sign Out</button>
    </div>
  </div>
  <div id="chat-search-bar" style="padding:6px 12px;display:none">
    <input type="text" id="chat-search" class="gs-input" placeholder="Search..." style="font-size:12px">
  </div>
  <div id="chat-filter-bar" class="filter-bar" style="display:none">
    <button class="filter-btn active" data-filter="all">All <span class="filter-count" id="chat-count-all"></span></button>
    <button class="filter-btn" data-filter="direct">Direct <span class="filter-count" id="chat-count-direct"></span></button>
    <button class="filter-btn" data-filter="group">Group <span class="filter-count" id="chat-count-group"></span></button>
    <button class="filter-btn" data-filter="requests">Requests <span class="filter-count" id="chat-count-requests"></span></button>
    <button class="filter-btn" data-filter="unread">Unread <span class="filter-count" id="chat-count-unread"></span></button>
  </div>
  <div id="chat-content"></div>
  <div id="chat-empty" class="gs-empty" style="display:none"></div>
</div>

<!-- ===================== FEED PANE ===================== -->
<div id="pane-feed" class="tab-pane">
  <div class="feed-scroll-area">
    <div class="feed-filters" id="feed-filters">
      <button class="feed-chip active" data-filter="all">All</button>
      <button class="feed-chip" data-filter="trending"><span class="codicon codicon-flame"></span> Repos</button>
      <button class="feed-chip" data-filter="release"><span class="codicon codicon-package"></span> Released</button>
      <button class="feed-chip" data-filter="pr-merged"><span class="codicon codicon-git-merge"></span> Merged</button>
      <button class="feed-chip" data-filter="notable-star"><span class="codicon codicon-star-full"></span> Notable</button>
    </div>
    <div id="feed-events"></div>
    <div id="feed-empty" class="gs-empty" style="display:none">Follow people to see their activity here</div>
    <button id="feed-load-more" class="load-more-btn" style="display:none">Load more</button>
  </div>
  <div class="feed-sticky-bottom">
    <div class="trending-section-header collapsed" data-toggle="feed-my-repos">
      <span class="section-chevron codicon codicon-chevron-down"></span>
      <span class="trending-section-title">My Repos</span>
      <button class="gs-btn-icon" id="feed-repos-refresh" title="Refresh"><span class="codicon codicon-refresh"></span></button>
    </div>
    <div id="feed-my-repos" class="section-body collapsed"></div>
  </div>
</div>

<!-- ===================== TRENDING PANE ===================== -->
<div id="pane-trending" class="tab-pane">
  <div class="trending-section">
    <div class="trending-section-header" data-toggle="trending-repos-list">
      <span class="section-chevron codicon codicon-chevron-down"></span>
      <span class="trending-section-title">Repos</span>
      <button class="gs-btn-icon" id="trending-repos-refresh" title="Refresh"><span class="codicon codicon-refresh"></span></button>
    </div>
    <div id="trending-repos-list" class="section-body"></div>
  </div>
  <div class="trending-section">
    <div class="trending-section-header collapsed" data-toggle="trending-people-list">
      <span class="section-chevron codicon codicon-chevron-down"></span>
      <span class="trending-section-title">People</span>
      <button class="gs-btn-icon" id="trending-people-refresh" title="Refresh"><span class="codicon codicon-refresh"></span></button>
    </div>
    <div id="trending-people-list" class="section-body collapsed"></div>
  </div>
  <div class="trending-section">
    <div class="trending-section-header collapsed" data-toggle="trending-suggestions-list">
      <span class="section-chevron codicon codicon-chevron-down"></span>
      <span class="trending-section-title">Who to Follow</span>
    </div>
    <div id="trending-suggestions-list" class="section-body collapsed"></div>
    <div id="trending-hover-card" class="gs-hover-card"></div>
  </div>
</div>

<script nonce="${nonce}" src="${sharedJs}"></script>
<script nonce="${nonce}" src="${js}"></script>
</body></html>`;
  }
}

// ===================== MODULE EXPORT =====================
export let exploreWebviewProvider: ExploreWebviewProvider;

export const exploreWebviewModule: ExtensionModule = {
  id: "explore",
  activate(context) {
    exploreWebviewProvider = new ExploreWebviewProvider(context.extensionUri);
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(ExploreWebviewProvider.viewType, exploreWebviewProvider)
    );

    // Auth change → refresh all
    authManager.onDidChangeAuth(() => exploreWebviewProvider.refreshAll());

    // Realtime events → chat updates
    realtimeClient.onNewMessage(() => exploreWebviewProvider.debouncedRefreshChat());
    realtimeClient.onPresence(() => exploreWebviewProvider.debouncedRefreshChat());
    realtimeClient.onConversationUpdated(() => exploreWebviewProvider.debouncedRefreshChat());
    realtimeClient.onTyping((data) => exploreWebviewProvider.showTyping(data.conversationId, data.user));

    // Follow state sync
    const followSub = onDidChangeFollow((e) => {
      exploreWebviewProvider.view?.webview.postMessage({ type: "followChanged", login: e.username, following: e.following });
    });
    context.subscriptions.push(followSub);

    // Trending polling
    exploreWebviewProvider.startPolling(context);

    // If already signed in, trigger initial refresh
    if (authManager.isSignedIn) { exploreWebviewProvider.refreshAll(); }
  },
};
