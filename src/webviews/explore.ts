import * as vscode from "vscode";
import { apiClient, getOtherUser } from "../api";
import { authManager } from "../auth";
import { realtimeClient } from "../realtime";
import { configManager } from "../config";
import { getNonce, getUri, log } from "../utils";
import { fireFollowChanged, onDidChangeFollow } from "../events/follow";
import type { Conversation, ExtensionModule, RepoChannel, TrendingRepo, TrendingPerson, UserRepo, WebviewMessage } from "../types";

export class ExploreWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "trending.explore";
  view?: vscode.WebviewView;

  // Chat state
  private _dmConvMap = new Map<string, string>();
  private _mutedConvs = new Set<string>();

  // Feed state
  private _feedPage = 1;

  // Develop: Repos/People/Channels state
  private _starredMap: Record<string, boolean> = {};
  private _followMap: Record<string, boolean> = {};
  private _channels: RepoChannel[] = [];
  private _timeRange = "weekly";
  private _peopleTimeRange = "weekly";

  // Polling
  private _trendingInterval?: ReturnType<typeof setInterval>;
  private _refreshTimer?: ReturnType<typeof setTimeout>;
  private _context?: vscode.ExtensionContext;

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

      let drafts: Record<string, string> = {};
      try {
        const { chatPanelWebviewProvider: cp } = await import("./chat-panel");
        drafts = cp.getAllDrafts();
      } catch { /* ignore */ }
      this.view.webview.postMessage({ type: "setChatData", friends, conversations: convData, currentUser: authManager.login, drafts });
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

  // ===================== DEVELOP: REPOS TAB =====================
  async fetchRepos(): Promise<void> {
    try {
      const repos = await apiClient.getTrendingRepos(this._timeRange);
      if (authManager.isSignedIn && repos.length) {
        const slugs = repos.map((r: TrendingRepo) => `${r.owner}/${r.name}`);
        this._starredMap = await apiClient.batchCheckStarred(slugs);
      }
      const items = repos.map((r: TrendingRepo) => ({
        ...r,
        slug: `${r.owner}/${r.name}`,
        starred: this._starredMap[`${r.owner}/${r.name}`] ?? false,
      }));
      this.view?.webview.postMessage({ type: "setRepos", repos: items });
    } catch (err) {
      log(`[Explore/DevRepos] fetchRepos failed: ${err}`, "error");
      this.view?.webview.postMessage({ type: "error", message: "Failed to load trending repos." });
    }
  }

  // ===================== DEVELOP: PEOPLE TAB =====================
  async fetchPeople(): Promise<void> {
    try {
      const people = await apiClient.getTrendingPeople(this._peopleTimeRange);
      if (authManager.isSignedIn && people.length) {
        const logins = people.map((p: TrendingPerson) => p.login);
        const statuses = await apiClient.batchFollowStatus(logins);
        this._followMap = {};
        for (const [login, status] of Object.entries(statuses)) {
          this._followMap[login] = (status as { following: boolean }).following;
        }
      }
      const items = people.map((p: TrendingPerson) => ({
        ...p,
        following: this._followMap[p.login] ?? false,
        avatar_url: p.avatar_url || `https://github.com/${encodeURIComponent(p.login)}.png?size=72`,
      }));
      this.view?.webview.postMessage({ type: "setPeople", people: items });
    } catch (err) {
      log(`[Explore/DevPeople] fetchPeople failed: ${err}`, "error");
    }
  }

  // ===================== DEVELOP: CHANNELS =====================
  async fetchChannels(): Promise<void> {
    try {
      log(`[Explore/Channels] fetching...`);
      const result = await apiClient.getMyChannels(undefined, 50);
      log(`[Explore/Channels] got ${result.channels?.length ?? 0} channels`);
      this._channels = result.channels;
      this.view?.webview.postMessage({ type: "setChannelData", channels: this._channels });
    } catch (err) {
      log(`[Explore/Channels] fetch failed: ${err}`, "warn");
    }
  }

  // ===================== DEVELOP: CHAT DATA (with drafts) =====================
  async fetchChatDataDev(): Promise<void> {
    if (!authManager.isSignedIn || !this.view) {
      this.view?.webview.postMessage({ type: "setChatDataDev", friends: [], conversations: [], currentUser: null });
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
      } catch { /* ignore */ }
      this.view.webview.postMessage({ type: "setChatDataDev", friends, conversations: convData, currentUser: authManager.login, drafts });
    } catch (err) {
      log(`[Explore/DevChat] fetchChatData failed: ${err}`, "warn");
    }
  }

  // ===================== DEVELOP: MY REPOS =====================
  async fetchMyReposDev(): Promise<void> {
    if (!authManager.isSignedIn) {
      this.view?.webview.postMessage({ type: "setMyReposDev", data: { public: [], private: [], starred: [] } });
      return;
    }
    try {
      const [repos, starred] = await Promise.all([
        apiClient.getUserRepos().catch(() => [] as UserRepo[]),
        apiClient.getStarredRepos().catch(() => [] as UserRepo[]),
      ]);
      this.view?.webview.postMessage({
        type: "setMyReposDev",
        data: {
          public: repos.filter((r) => !r.private),
          private: repos.filter((r) => r.private),
          starred,
        },
      });
    } catch (err) {
      log(`[Explore/DevMyRepos] fetchMyRepos failed: ${err}`, "error");
    }
  }

  // ===================== DEVELOP: helpers =====================
  postToWebview(msg: unknown): void {
    this.view?.webview.postMessage(msg);
  }

  showSearch(): void {
    this.view?.webview.postMessage({ type: "showSearch" });
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
    this._context = context;
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
        if (authManager.isSignedIn && authManager.login) {
          this.view?.webview.postMessage({
            type: "setUser",
            login: authManager.login,
            name: authManager.login,
            avatar: `https://github.com/${encodeURIComponent(authManager.login)}.png?size=72`,
          });
        }
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
      case "getRecentSearches": {
        const recent = this._context?.globalState.get<string[]>("trending.recentSearches") || [];
        this.view?.webview.postMessage({ type: "recentSearches", searches: recent });
        break;
      }
      case "saveRecentSearch": {
        const q = (p.query as string || "").trim();
        if (!q) { break; }
        const saved = this._context?.globalState.get<string[]>("trending.recentSearches") || [];
        const updated = [q, ...saved.filter(s => s !== q)].slice(0, 10);
        this._context?.globalState.update("trending.recentSearches", updated);
        break;
      }
      case "clearRecentSearches": {
        this._context?.globalState.update("trending.recentSearches", []);
        break;
      }
      case "globalSearch": {
        const query = (p.query as string || "").trim();
        log(`[Explore/Search] query="${query}"`);
        if (!query) { break; }
        try {
          const results = await apiClient.search(query);
          log(`[Explore/Search] results: ${results.repos?.length} repos, ${results.users?.length} users`);
          this.view?.webview.postMessage({
            type: "globalSearchResults",
            payload: { repos: results.repos || [], users: results.users || [] },
          });
        } catch (err) {
          log(`[Explore/Search] search failed: ${err}`, "warn");
          this.view?.webview.postMessage({ type: "globalSearchError" });
        }
        break;
      }

      // ── Develop: Repos tab ──────────────────────────────
      case "refreshRepos":
        await this.fetchRepos();
        break;
      case "switchTab": {
        const tab = p?.tab;
        if (tab === "dev-people") { await this.fetchPeople(); }
        else if (tab === "dev-myrepos") { await this.fetchMyReposDev(); }
        else if (tab === "dev-repos") { await this.fetchRepos(); }
        break;
      }
      case "changeRange":
        this._timeRange = p?.range || "weekly";
        await this.fetchRepos();
        break;
      case "changePeopleRange":
        this._peopleTimeRange = p?.range || "weekly";
        await this.fetchPeople();
        break;
      case "searchRepos": {
        const query = (p?.query ?? "").trim();
        if (!query) { await this.fetchRepos(); break; }
        try {
          this.view?.webview.postMessage({ type: "setLoading" });
          const result = await apiClient.search(query);
          this.view?.webview.postMessage({ type: "setRepos", repos: result.repos ?? [] });
        } catch (err) {
          log(`[Explore/DevRepos] search failed: ${err}`, "error");
        }
        break;
      }
      case "star": {
        const slug = p?.slug;
        if (!slug) { break; }
        const [sOwner, sRepo] = slug.split("/");
        try {
          await apiClient.starRepo(sOwner, sRepo);
          this._starredMap[slug] = true;
          this.view?.webview.postMessage({ type: "starredUpdate", slug, starred: true });
        } catch { vscode.window.showErrorMessage(`Failed to star ${slug}`); }
        break;
      }
      case "unstar": {
        const slug = p?.slug;
        if (!slug) { break; }
        const [uOwner, uRepo] = slug.split("/");
        try {
          await apiClient.unstarRepo(uOwner, uRepo);
          this._starredMap[slug] = false;
          this.view?.webview.postMessage({ type: "starredUpdate", slug, starred: false });
        } catch { vscode.window.showErrorMessage(`Failed to unstar ${slug}`); }
        break;
      }
      case "fork": {
        const { owner: fOwner, repo: fRepo } = msg.payload as { owner: string; repo: string };
        if (fOwner && fRepo) {
          vscode.env.openExternal(vscode.Uri.parse(`https://github.com/${fOwner}/${fRepo}/fork`));
        }
        break;
      }

      // ── Develop: People tab ─────────────────────────────
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

      // ── Develop: Chat tab (with channels) ───────────────
      case "fetchChatData":
        await this.fetchChatDataDev();
        break;
      case "fetchChannels":
        await this.fetchChannels();
        break;
      case "openChannel": {
        const cp = msg.payload as { channelId: string; repoOwner: string; repoName: string };
        vscode.commands.executeCommand("trending.openChannel", cp.channelId, cp.repoOwner, cp.repoName);
        break;
      }
      case "chatOpenDM":
        vscode.commands.executeCommand("trending.messageUser", p?.login);
        break;
      case "chatNewChat": {
        const chatChoice = await vscode.window.showQuickPick(
          [
            { label: "$(comment-discussion) New Message", description: "Direct message to a user", value: "dm" },
            { label: "$(organization) New Group", description: "Create a group chat", value: "group" },
          ],
          { placeHolder: "Start a new conversation" }
        );
        if (chatChoice?.value === "dm") { vscode.commands.executeCommand("trending.messageUser"); }
        else if (chatChoice?.value === "group") { vscode.commands.executeCommand("trending.createGroup"); }
        break;
      }
      case "chatPin":
        try { await apiClient.pinConversation(p!.conversationId); this.fetchChatDataDev(); } catch { /* ignore */ }
        break;
      case "chatUnpin":
        try { await apiClient.unpinConversation(p!.conversationId); this.fetchChatDataDev(); } catch { /* ignore */ }
        break;
      case "chatMarkRead":
        try { await apiClient.markConversationRead(p!.conversationId); this.fetchChatDataDev(); } catch { /* ignore */ }
        break;
      case "showSearch":
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

<!-- Search Header (hidden by default, toggled via title bar icon) -->
<div class="explore-header" id="explore-header" style="display:none">
  <div class="search-wrapper">
    <span class="search-icon codicon codicon-search"></span>
    <input type="text" class="gs-input" id="global-search" placeholder="Search repos & people..." autocomplete="off">
    <button class="search-clear codicon codicon-close" id="search-clear" style="display:none" title="Clear search"></button>
  </div>
</div>

<!-- User Menu (hidden by default, toggled via title bar account icon) -->
<div id="user-menu" class="gs-dropdown" style="display:none;right:8px;top:0">
  <div class="gs-dropdown-header">
    <img id="user-menu-avatar" class="gs-avatar gs-avatar-md" src="" alt="">
    <div>
      <div id="user-menu-name" class="gs-dropdown-title"></div>
      <div id="user-menu-login" class="gs-text-sm gs-text-muted"></div>
    </div>
  </div>
  <div class="gs-dropdown-divider"></div>
  <button class="gs-dropdown-item" id="user-menu-profile"><span class="codicon codicon-person"></span> View Profile</button>
  <button class="gs-dropdown-item gs-dropdown-item--danger" id="user-menu-signout"><span class="codicon codicon-sign-out"></span> Sign Out</button>
</div>

<!-- Main Tab Bar -->
<div class="explore-tabs">
  <button class="explore-tab active" data-tab="chat"><span class="codicon codicon-comment-discussion"></span> Chat <span id="chat-main-badge" class="tab-badge" style="display:none"></span></button>
  <button class="explore-tab" data-tab="feed"><span class="codicon codicon-rss"></span> Feed</button>
  <button class="explore-tab" data-tab="trending"><span class="codicon codicon-rocket"></span> Trending</button>
</div>

<!-- ===================== CHAT PANE ===================== -->
<div id="pane-chat" class="tab-pane active">
  <div class="gs-sub-header" style="position:relative">
    <div class="gs-sub-tabs">
      <button class="gs-sub-tab active" data-tab="inbox">Inbox <span id="chat-tab-inbox-count"></span></button>
      <button class="gs-sub-tab" data-tab="friends">Friends <span id="chat-tab-friends-count"></span></button>
      <button class="gs-sub-tab" data-tab="channels">Channels</button>
    </div>
    <div class="gs-flex gs-gap-4 gs-items-center">
      <button class="gs-btn-icon" id="chat-settings-btn" title="Settings"><span class="codicon codicon-settings-gear"></span></button>
      <button class="gs-btn-icon" id="chat-new" title="New message"><span class="codicon codicon-comment"></span></button>
    </div>
    <div class="gs-dropdown settings-dropdown" id="chat-settings-dropdown" style="display:none">
      <label class="gs-dropdown-item"><input type="checkbox" id="chat-setting-notifications" checked /> Message notifications</label>
      <label class="gs-dropdown-item"><input type="checkbox" id="chat-setting-sound" /> Message sound</label>
      <label class="gs-dropdown-item"><input type="checkbox" id="chat-setting-debug" /> Debug logs</label>
      <div class="gs-dropdown-divider"></div>
      <button class="gs-dropdown-item gs-dropdown-item--danger" id="chat-setting-signout">Sign Out</button>
    </div>
  </div>
  <div id="chat-search-bar" style="padding:6px 12px;display:none">
    <input type="text" id="chat-search" class="gs-input" placeholder="Search..." style="font-size:12px">
  </div>
  <div id="chat-filter-bar" class="gs-filter-bar" style="display:none">
    <button class="gs-chip active" data-filter="all">All <span class="gs-chip-count" id="chat-count-all"></span></button>
    <button class="gs-chip" data-filter="direct">Direct <span class="gs-chip-count" id="chat-count-direct"></span></button>
    <button class="gs-chip" data-filter="group">Group <span class="gs-chip-count" id="chat-count-group"></span></button>
    <button class="gs-chip" data-filter="requests">Requests <span class="gs-chip-count" id="chat-count-requests"></span></button>
    <button class="gs-chip" data-filter="unread">Unread <span class="gs-chip-count" id="chat-count-unread"></span></button>
  </div>
  <div id="chat-content"></div>
  <div id="chat-empty" class="gs-empty" style="display:none"></div>
  <div id="chat-pane-channels" style="display:none">
    <div id="channels-list" class="channels-list"></div>
    <div id="channels-empty" class="gs-empty" style="display:none">
      <span class="codicon codicon-megaphone"></span>
      <p>No channel subscriptions yet</p>
    </div>
  </div>
</div>

<!-- ===================== FEED PANE ===================== -->
<div id="pane-feed" class="tab-pane">
  <div class="feed-scroll-area">
    <div class="gs-filter-bar" id="feed-filters">
      <button class="gs-chip active" data-filter="all">All</button>
      <button class="gs-chip" data-filter="trending"><span class="codicon codicon-flame"></span> Repos</button>
      <button class="gs-chip" data-filter="release"><span class="codicon codicon-package"></span> Released</button>
      <button class="gs-chip" data-filter="pr-merged"><span class="codicon codicon-git-merge"></span> Merged</button>
      <button class="gs-chip" data-filter="notable-star"><span class="codicon codicon-star-full"></span> Notable</button>
    </div>
    <div id="feed-events"></div>
    <div id="feed-empty" class="gs-empty" style="display:none">Follow people to see their activity here</div>
    <button id="feed-load-more" class="load-more-btn" style="display:none">Load more</button>
  </div>
  <div class="feed-sticky-bottom">
    <div class="gs-accordion-header collapsed" data-toggle="feed-my-repos">
      <span class="gs-accordion-chevron codicon codicon-chevron-down"></span>
      <span class="gs-accordion-title">My Repos</span>
      <button class="gs-btn-icon" id="feed-repos-refresh" title="Refresh"><span class="codicon codicon-refresh"></span></button>
    </div>
    <div id="feed-my-repos" class="gs-accordion-body collapsed"></div>
  </div>
</div>

<!-- ===================== TRENDING PANE ===================== -->
<div id="pane-trending" class="tab-pane">
  <div class="gs-sub-header">
    <div class="gs-sub-tabs">
      <button class="gs-sub-tab active" data-trending-tab="repos">Repos</button>
      <button class="gs-sub-tab" data-trending-tab="people">People</button>
    </div>
    <button class="gs-btn-icon" id="trending-refresh" title="Refresh"><span class="codicon codicon-refresh"></span></button>
  </div>
  <!-- Repos sub-pane -->
  <div id="trending-sub-repos" class="trending-sub-pane">
    <div class="ex-search-wrap">
      <input id="repos-search" class="ex-search-input" type="text" placeholder="Search repos…" autocomplete="off" spellcheck="false">
    </div>
    <div id="repos-ranges" class="gs-filter-bar">
      <button class="gs-chip" data-range="daily">Today</button>
      <button class="gs-chip active" data-range="weekly">Week</button>
      <button class="gs-chip" data-range="monthly">Month</button>
    </div>
    <div id="repos-list"></div>
  </div>
  <!-- People sub-pane -->
  <div id="trending-sub-people" class="trending-sub-pane" style="display:none">
    <div class="ex-search-wrap">
      <input id="people-search" class="ex-search-input" type="text" placeholder="Search people…" autocomplete="off" spellcheck="false">
    </div>
    <div id="people-ranges" class="gs-filter-bar">
      <button class="gs-chip" data-people-range="daily">Today</button>
      <button class="gs-chip active" data-people-range="weekly">Week</button>
      <button class="gs-chip" data-people-range="monthly">Month</button>
    </div>
    <div id="people-list"><div class="ex-loading">Loading…</div></div>
  </div>
</div>


<!-- Search Home (shown when search bar opens, before typing) -->
<div id="search-home" class="search-home" style="display:none">
  <div id="search-home-recent" class="search-home-section" style="display:none">
    <div class="search-home-header">
      <span class="search-home-title">Recent Searches</span>
      <button class="gs-btn-icon" id="search-clear-recent" title="Clear recent"><span class="codicon codicon-trash"></span></button>
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
    <div class="gs-accordion-header" data-toggle="search-repos-list">
      <span class="gs-accordion-chevron codicon codicon-chevron-down"></span>
      <span class="gs-accordion-title">Repos</span>
      <span class="gs-accordion-count" id="search-repos-count"></span>
    </div>
    <div id="search-repos-list" class="gs-accordion-body"></div>
  </div>
  <div class="search-section" id="search-people-section">
    <div class="gs-accordion-header" data-toggle="search-people-list">
      <span class="gs-accordion-chevron codicon codicon-chevron-down"></span>
      <span class="gs-accordion-title">People</span>
      <span class="gs-accordion-count" id="search-people-count"></span>
    </div>
    <div id="search-people-list" class="gs-accordion-body"></div>
  </div>
  <div id="search-empty" class="gs-empty" style="display:none"></div>
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
