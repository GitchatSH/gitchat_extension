import * as vscode from "vscode";
import { apiClient, getOtherUser } from "../api";
import { authManager } from "../auth";
import { realtimeClient } from "../realtime";
import { configManager } from "../config";
import { getNonce, getUri, log } from "../utils";
import { fireFollowChanged, onDidChangeFollow } from "../events/follow";
import type { Conversation, ExtensionModule, RepoChannel, WebviewMessage } from "../types";

class ExploreWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "trending.explore";
  private view?: vscode.WebviewView;
  private _starredMap: Record<string, boolean> = {};
  private _followMap: Record<string, boolean> = {};
  private _channels: RepoChannel[] = [];
  private _timeRange = "weekly";
  private _interval?: ReturnType<typeof setInterval>;
  private _context?: vscode.ExtensionContext;

  constructor(private readonly extensionUri: vscode.Uri) {}

  setContext(context: vscode.ExtensionContext): void {
    this._context = context;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  postToWebview(msg: any): void {
    this.view?.webview.postMessage(msg);
  }

  showSearch(): void {
    this.view?.webview.postMessage({ type: "showSearch" });
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")],
    };
    webviewView.webview.html = this.getHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage((msg: WebviewMessage) => this.onMessage(msg));
  }

  private async onMessage(msg: WebviewMessage): Promise<void> {
    const p = msg.payload as Record<string, string> | undefined;
    switch (msg.type) {
      case "ready":
        await this.fetchRepos();
        break;
      case "refreshRepos":
        await this.fetchRepos();
        break;
      case "switchTab": {
        const tab = p?.tab;
        if (tab === "people") { await this.fetchPeople(); }
        else if (tab === "myrepos") { await this.fetchMyRepos(); }
        break;
      }
      case "openChat": {
        vscode.commands.executeCommand("trending.chatPanel.focus");
        break;
      }
      case "fetchChatData": {
        await this.fetchChatData();
        break;
      }
      case "fetchChannels": {
        await this.fetchChannels();
        break;
      }
      case "openChannel": {
        const cp = msg.payload as { channelId: string; repoOwner: string; repoName: string };
        vscode.commands.executeCommand("trending.openChannel", cp.channelId, cp.repoOwner, cp.repoName);
        break;
      }
      case "openConversation": {
        vscode.commands.executeCommand("trending.openChat", p?.conversationId);
        break;
      }
      case "chatOpenDM": {
        vscode.commands.executeCommand("trending.messageUser", p?.login);
        break;
      }
      case "chatNewChat": {
        const choice = await vscode.window.showQuickPick(
          [
            { label: "$(comment-discussion) New Message", description: "Direct message to a user", value: "dm" },
            { label: "$(organization) New Group", description: "Create a group chat", value: "group" },
          ],
          { placeHolder: "Start a new conversation" }
        );
        if (choice?.value === "dm") {
          vscode.commands.executeCommand("trending.messageUser");
        } else if (choice?.value === "group") {
          vscode.commands.executeCommand("trending.createGroup");
        }
        break;
      }
      case "chatPin":
        try { await apiClient.pinConversation(p!.conversationId); this.fetchChatData(); } catch { /* ignore */ }
        break;
      case "chatUnpin":
        try { await apiClient.unpinConversation(p!.conversationId); this.fetchChatData(); } catch { /* ignore */ }
        break;
      case "chatMarkRead":
        try { await apiClient.markConversationRead(p!.conversationId); this.fetchChatData(); } catch { /* ignore */ }
        break;
      case "changeRange": {
        this._timeRange = p?.range || "weekly";
        await this.fetchRepos();
        break;
      }
      case "search": {
        const query = (p?.query ?? "").trim();
        if (!query) { await this.fetchRepos(); break; }
        try {
          this.view?.webview.postMessage({ type: "setLoading" });
          const result = await apiClient.search(query);
          this.view?.webview.postMessage({ type: "setRepos", repos: result.repos ?? [] });
        } catch (err) {
          log(`[Explore] search failed: ${err}`, "error");
          this.view?.webview.postMessage({ type: "error", message: "Search failed." });
        }
        break;
      }
      case "star": {
        const slug = p?.slug;
        if (!slug) { break; }
        const [owner, repo] = slug.split("/");
        try {
          await apiClient.starRepo(owner, repo);
          this._starredMap[slug] = true;
          this.view?.webview.postMessage({ type: "starredUpdate", slug, starred: true });
        } catch { vscode.window.showErrorMessage(`Failed to star ${slug}`); }
        break;
      }
      case "unstar": {
        const slug = p?.slug;
        if (!slug) { break; }
        const [owner, repo] = slug.split("/");
        try {
          await apiClient.unstarRepo(owner, repo);
          this._starredMap[slug] = false;
          this.view?.webview.postMessage({ type: "starredUpdate", slug, starred: false });
        } catch { vscode.window.showErrorMessage(`Failed to unstar ${slug}`); }
        break;
      }
      case "fork": {
        const { owner, repo } = msg.payload as { owner: string; repo: string };
        if (owner && repo) {
          vscode.env.openExternal(vscode.Uri.parse(`https://github.com/${owner}/${repo}/fork`));
        }
        break;
      }
      case "viewRepo": {
        const { owner, repo } = msg.payload as { owner: string; repo: string };
        if (owner && repo) { vscode.commands.executeCommand("trending.viewRepoDetail", owner, repo); }
        break;
      }
      case "follow": {
        const login = p?.login;
        if (!login) { break; }
        try {
          await apiClient.followUser(login);
          this._followMap[login] = true;
          this.view?.webview.postMessage({ type: "followUpdate", login, following: true });
          fireFollowChanged(login, true);
        } catch { vscode.window.showErrorMessage(`Failed to follow @${login}`); }
        break;
      }
      case "unfollow": {
        const login = p?.login;
        if (!login) { break; }
        try {
          await apiClient.unfollowUser(login);
          this._followMap[login] = false;
          this.view?.webview.postMessage({ type: "followUpdate", login, following: false });
          fireFollowChanged(login, false);
        } catch { vscode.window.showErrorMessage(`Failed to unfollow @${login}`); }
        break;
      }
      case "viewProfile": {
        const { login } = msg.payload as { login: string };
        if (login) { vscode.commands.executeCommand("trending.viewProfile", login); }
        break;
      }
      // The webview posts "showSearch" back to itself via the extension when the
      // title bar search icon is clicked — this is a no-op on the extension side
      // because the command handler posts "showSearch" directly to the webview.
      case "showSearch":
        break;
      case "getRecentSearches": {
        const recent = this._context?.globalState.get<string[]>("trending.recentSearches") ?? [];
        this.view?.webview.postMessage({ type: "recentSearches", searches: recent });
        break;
      }
      case "saveRecentSearch": {
        const q = ((p?.query) ?? "").trim();
        if (!q) { break; }
        const saved = this._context?.globalState.get<string[]>("trending.recentSearches") ?? [];
        const updated = [q, ...saved.filter((s) => s !== q)].slice(0, 10);
        this._context?.globalState.update("trending.recentSearches", updated);
        break;
      }
      case "clearRecentSearches": {
        this._context?.globalState.update("trending.recentSearches", []);
        break;
      }
      case "globalSearch": {
        const query = ((p?.query) ?? "").trim();
        if (!query) { break; }
        try {
          this.view?.webview.postMessage({ type: "setLoading" });
          const result = await apiClient.search(query);
          this.view?.webview.postMessage({
            type: "globalSearchResults",
            payload: { repos: result.repos ?? [], users: result.users ?? [] },
          });
        } catch (err) {
          log(`[Explore] globalSearch failed: ${err}`, "error");
          this.view?.webview.postMessage({ type: "globalSearchError" });
        }
        break;
      }
    }
  }

  private async fetchRepos(): Promise<void> {
    try {
      const repos = await apiClient.getTrendingRepos(this._timeRange);
      if (authManager.isSignedIn && repos.length) {
        const slugs = repos.map((r) => `${r.owner}/${r.name}`);
        this._starredMap = await apiClient.batchCheckStarred(slugs);
      }
      const items = repos.map((r) => ({
        ...r,
        slug: `${r.owner}/${r.name}`,
        starred: this._starredMap[`${r.owner}/${r.name}`] ?? false,
      }));
      this.view?.webview.postMessage({ type: "setRepos", repos: items });
    } catch (err) {
      log(`[Explore] fetchRepos failed: ${err}`, "error");
      this.view?.webview.postMessage({ type: "error", message: "Failed to load trending repos." });
    }
  }

  private async fetchPeople(): Promise<void> {
    try {
      const people = await apiClient.getTrendingPeople();
      if (authManager.isSignedIn && people.length) {
        const logins = people.map((p) => p.login);
        const statuses = await apiClient.batchFollowStatus(logins);
        this._followMap = {};
        for (const [login, status] of Object.entries(statuses)) {
          this._followMap[login] = (status as { following: boolean }).following;
        }
      }
      const items = people.map((p) => ({
        ...p,
        following: this._followMap[p.login] ?? false,
        avatar_url: p.avatar_url || `https://github.com/${encodeURIComponent(p.login)}.png?size=72`,
      }));
      this.view?.webview.postMessage({ type: "setPeople", people: items });
    } catch (err) {
      log(`[Explore] fetchPeople failed: ${err}`, "error");
    }
  }

  private async fetchChatData(): Promise<void> {
    if (!authManager.isSignedIn || !this.view) {
      this.view?.webview.postMessage({ type: "setChatData", friends: [], conversations: [], currentUser: null });
      return;
    }
    try {
      let following = await apiClient.getFollowing(1, 100);
      if (following.length === 0 && authManager.token) {
        try {
          const headers = { Authorization: `Bearer ${authManager.token}`, Accept: "application/vnd.github+json" };
          const res = await fetch("https://api.github.com/user/following?per_page=100", { headers });
          if (res.ok) { following = ((await res.json()) as { login: string; avatar_url?: string }[]).map(u => ({ login: u.login, name: u.login, avatar_url: u.avatar_url || "" })); }
        } catch { /* ignore */ }
      }
      const logins = following.map((f: { login: string }) => f.login);
      let presenceData: Record<string, string | null> = {};
      if (logins.length) {
        try { presenceData = await apiClient.getPresence(logins.slice(0, 50)); } catch { /* ignore */ }
      }
      let conversations: Conversation[] = [];
      try {
        conversations = await apiClient.getConversations();
        realtimeClient.subscribeToConversations(conversations.map(c => c.id));
      } catch { /* ignore */ }
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
      const convData = conversations.map((c: Conversation) => ({ ...c, other_user: getOtherUser(c, authManager.login) }));
      let drafts: Record<string, string> = {};
      try {
        const { chatPanelWebviewProvider: cp } = await import("./chat-panel");
        drafts = cp.getAllDrafts();
      } catch { /* ignore if not available */ }
      this.view.webview.postMessage({ type: "setChatData", friends, conversations: convData, currentUser: authManager.login, drafts });
    } catch (err) {
      log(`[Explore] fetchChatData failed: ${err}`, "warn");
    }
  }

  async fetchChannels(): Promise<void> {
    try {
      log(`[Explore/Channels] fetching...`);
      const result = await apiClient.getMyChannels(undefined, 50);
      log(`[Explore/Channels] got ${result.channels?.length ?? 0} channels`);
      this._channels = result.channels;
      this.view?.webview.postMessage({
        type: "setChannelData",
        channels: this._channels,
      });
    } catch (err) {
      log(`[Explore/Channels] fetch failed: ${err}`, "warn");
    }
  }

  private async fetchMyRepos(): Promise<void> {
    if (!authManager.isSignedIn) {
      this.view?.webview.postMessage({ type: "setMyRepos", data: { public: [], private: [], starred: [] } });
      return;
    }
    try {
      const [repos, starred] = await Promise.all([
        apiClient.getUserRepos().catch(() => []),
        apiClient.getStarredRepos().catch(() => []),
      ]);
      this.view?.webview.postMessage({
        type: "setMyRepos",
        data: {
          public: repos.filter((r) => !r.private),
          private: repos.filter((r) => r.private),
          starred,
        },
      });
    } catch (err) {
      log(`[Explore] fetchMyRepos failed: ${err}`, "error");
    }
  }

  getStarredState(slug: string): boolean {
    return this._starredMap[slug] ?? false;
  }

  notifyStarChange(slug: string, starred: boolean): void {
    this._starredMap[slug] = starred;
    this.view?.webview.postMessage({ type: "starredUpdate", slug, starred });
  }

  setFollowState(username: string, following: boolean): void {
    this._followMap[username] = following;
    this.view?.webview.postMessage({ type: "followUpdate", login: username, following });
  }

  startPolling(interval: number): void {
    this._interval = setInterval(() => this.fetchRepos(), interval);
  }

  dispose(): void { clearInterval(this._interval); }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const sharedCss = getUri(webview, this.extensionUri, ["media", "webview", "shared.css"]);
    const css = getUri(webview, this.extensionUri, ["media", "webview", "explore.css"]);
    const sharedJs = getUri(webview, this.extensionUri, ["media", "webview", "shared.js"]);
    const js = getUri(webview, this.extensionUri, ["media", "webview", "explore.js"]);
    return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} https:;">
<link rel="stylesheet" href="${sharedCss}"><link rel="stylesheet" href="${css}">
</head><body>

<!-- Global Search Header (hidden by default, shown when trending.search command fires) -->
<div class="explore-header" id="explore-header" style="display:none">
  <div class="search-wrapper">
    <span class="search-icon codicon codicon-search"></span>
    <input type="text" class="gs-input" id="global-search" placeholder="Search repos &amp; people…" autocomplete="off" spellcheck="false">
    <button class="search-clear codicon codicon-close" id="search-clear" style="display:none" title="Clear search"></button>
  </div>
</div>

<!-- Tab Bar -->
<div class="ex-tabs">
  <button class="ex-tab ex-tab-active" data-tab="repos">Repos</button>
  <button class="ex-tab" data-tab="people">People</button>
  <button class="ex-tab" data-tab="chat">Chat</button>
  <button class="ex-tab" data-tab="myrepos">My Repos</button>
</div>

<!-- Repos pane -->
<div class="ex-pane" data-pane="repos">
  <div class="ex-search-wrap">
    <input id="repos-search" class="ex-search-input" type="text" placeholder="Search repos…" autocomplete="off" spellcheck="false">
  </div>
  <div id="repos-ranges" class="ex-ranges">
    <button class="ex-range" data-range="daily">Today</button>
    <span class="ex-range-sep">·</span>
    <button class="ex-range ex-range-active" data-range="weekly">Week</button>
    <span class="ex-range-sep">·</span>
    <button class="ex-range" data-range="monthly">Month</button>
  </div>
  <div id="repos-list"></div>
</div>

<!-- People pane -->
<div class="ex-pane" data-pane="people" style="display:none">
  <div id="people-list"><div class="ex-loading">Loading…</div></div>
</div>

<!-- Chat pane (embedded Inbox + Friends) -->
<div class="ex-pane" data-pane="chat" style="display:none">
  <div class="chat-header">
    <div class="chat-tab-bar">
      <button class="chat-tab chat-tab-active" data-chat-tab="inbox">Inbox <span id="chat-inbox-count"></span></button>
      <button class="chat-tab" data-chat-tab="friends">Friends <span id="chat-friends-count"></span></button>
      <button class="chat-tab" data-chat-tab="channels">Channels</button>
    </div>
    <div class="gs-flex gs-gap-4 gs-items-center">
      <button class="gs-btn-icon" id="chat-new-btn" title="New message"><span class="codicon codicon-comment"></span></button>
    </div>
  </div>
  <div id="chat-filter-bar" class="chat-filter-bar">
    <button class="chat-filter-btn chat-filter-active" data-filter="all">All <span id="chat-count-all"></span></button>
    <button class="chat-filter-btn" data-filter="direct">Direct <span id="chat-count-direct"></span></button>
    <button class="chat-filter-btn" data-filter="group">Group <span id="chat-count-group"></span></button>
    <button class="chat-filter-btn" data-filter="unread">Unread <span id="chat-count-unread"></span></button>
  </div>
  <div id="chat-search-bar" style="padding:6px 12px;display:none">
    <input type="text" id="chat-search" class="gs-input" placeholder="Search friends…" style="font-size:12px">
  </div>
  <div id="chat-content"><div class="ex-loading">Loading…</div></div>
  <div id="chat-empty" class="gs-empty" style="display:none"></div>
  <div id="chat-pane-channels" class="chat-pane" style="display:none">
    <div id="channels-list" class="channels-list"></div>
    <div id="channels-empty" class="chat-empty" style="display:none">
      <span class="codicon codicon-megaphone"></span>
      <p>No channel subscriptions yet</p>
    </div>
  </div>
</div>

<!-- My Repos pane -->
<div class="ex-pane" data-pane="myrepos" style="display:none">
  <div id="myrepos-list"><div class="ex-loading">Loading…</div></div>
</div>

<!-- Search Home (shown when search bar opens, before typing) -->
<div id="search-home" class="search-home" style="display:none">
  <div id="search-home-recent" class="search-home-section" style="display:none">
    <div class="search-home-header">
      <span class="search-home-title">Recent Searches</span>
      <button class="gs-btn-icon" id="search-clear-recent" title="Clear recent">&#x2715;</button>
    </div>
    <div id="search-home-recent-list"></div>
  </div>
  <div id="search-home-trending-repos" class="search-home-section" style="display:none">
    <div class="search-home-header">
      <span class="search-home-title">Trending Repos</span>
    </div>
    <div id="search-home-trending-repos-list"></div>
  </div>
  <div id="search-home-trending-people" class="search-home-section" style="display:none">
    <div class="search-home-header">
      <span class="search-home-title">Trending People</span>
    </div>
    <div id="search-home-trending-people-list"></div>
  </div>
</div>

<!-- Search Results -->
<div id="search-results" class="search-results" style="display:none">
  <div class="search-section" id="search-repos-section">
    <div style="display:flex;align-items:center;padding:4px 12px;height:32px;border-bottom:1px solid var(--gs-divider)">
      <span style="font-size:11px;font-weight:600;text-transform:uppercase;color:var(--gs-muted);letter-spacing:0.5px;flex:1">Repos</span>
      <span id="search-repos-count" style="font-size:11px;color:var(--gs-muted)"></span>
    </div>
    <div id="search-repos-list"></div>
  </div>
  <div class="search-section" id="search-people-section">
    <div style="display:flex;align-items:center;padding:4px 12px;height:32px;border-bottom:1px solid var(--gs-divider)">
      <span style="font-size:11px;font-weight:600;text-transform:uppercase;color:var(--gs-muted);letter-spacing:0.5px;flex:1">People</span>
      <span id="search-people-count" style="font-size:11px;color:var(--gs-muted)"></span>
    </div>
    <div id="search-people-list"></div>
  </div>
  <div id="search-empty" class="gs-empty" style="display:none"></div>
</div>

<script nonce="${nonce}" src="${sharedJs}"></script>
<script nonce="${nonce}" src="${js}"></script>
</body></html>`;
  }
}

export let exploreWebviewProvider: ExploreWebviewProvider;

export const exploreModule: ExtensionModule = {
  id: "explore",
  activate(context) {
    exploreWebviewProvider = new ExploreWebviewProvider(context.extensionUri);
    exploreWebviewProvider.setContext(context);
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(ExploreWebviewProvider.viewType, exploreWebviewProvider),
      { dispose: () => exploreWebviewProvider.dispose() },
    );
    exploreWebviewProvider.startPolling(configManager.current.trendingPollInterval);

    const followSub = onDidChangeFollow((e) => {
      exploreWebviewProvider.setFollowState(e.username, e.following);
    });
    context.subscriptions.push(followSub);
  },
};
