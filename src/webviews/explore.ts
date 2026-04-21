import * as vscode from "vscode";
import { apiClient, getOtherUser, type PresenceEntry } from "../api";
import { authManager } from "../auth";
import { realtimeClient } from "../realtime";
import { presenceStore } from "../realtime/presence-store";
import { configManager } from "../config";
import { getNonce, getUri, log } from "../utils";
import type { Conversation, ExtensionModule, RepoChannel, UserProfile, WebviewMessage } from "../types";
import { handleChatMessage, extractPinnedMessages, type ChatContext, type CursorState } from "./chat-handlers";
import { notificationStore } from "../notifications/notification-store";
import { toastCoordinator } from "../notifications/toast-coordinator";
import { fireFollowChanged, onDidChangeFollow } from "../events/follow";
import { enrichProfile } from "./profile-card-enrich";
import { getUserStarred } from "../api/github";
import { messageCache } from "../services/message-cache";

export class ExploreWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "gitchat.explore";
  view?: vscode.WebviewView;

  // Chat state
  private _dmConvMap = new Map<string, string>();
  private _mutedConvs = new Set<string>();

  // Sidebar chat state (for embedded chat view) — public for realtime routing
  _activeChatConvId: string | undefined;
  _activeChatRecipient: string | undefined;
  _chatRecentlySentIds = new Set<string>();
  private _pendingJump: { conversationId: string; messageId: string; timer: ReturnType<typeof setTimeout> } | null = null;
  private _activeConversationIds = new Set<string>();
  private _chatIsGroup = false;

  // Topic state — public for realtime routing (same pattern as _activeChatConvId)
  _activeTopicId: string | undefined;
  private _activeTopicParentConvId: string | undefined;
  private _activeTopicName: string | undefined;
  private _activeTopicIcon: string | undefined;
  /** Monotonic counter incremented on each navigateToChat — used to discard
   *  async results from a previous navigation that resolved after the user
   *  already switched to a different conversation (ghost-data flash fix). */
  private _navGeneration = 0;
  private _chatCursorState: CursorState = {
    cursor: undefined, previousCursor: undefined, nextCursor: undefined,
    hasMore: true, hasMoreBefore: true, hasMoreAfter: false,
  };

  // Channels state
  private _channels: RepoChannel[] = [];

  private _refreshTimer?: ReturnType<typeof setTimeout>;
  private _toastVisTimer?: ReturnType<typeof setTimeout>;
  private _webviewRenderer: import("../notifications/renderers/webview-renderer").WebviewRenderer | undefined;
  private _followChangeSub?: vscode.Disposable;
  private _onlineNowSnapSub?: vscode.Disposable;
  private _onlineNowDeltaSub?: vscode.Disposable;
  private _configChangeSub?: vscode.Disposable;
  private _discoverTabActive = false;
  private _context?: vscode.ExtensionContext;
  private _pickId = 5000; // IDs for extension-side file picks
  private _pendingBadge: number | null = null;
  private _pendingGroupAvatar: { buffer: Buffer; filename: string; mimeType: string } | undefined;
  // Host-side profile cache — prevents burst hovers from slamming BE
  // /user/:username with duplicate requests. Keyed by username.
  // Persisted via globalState so it survives webview reloads and VS Code
  // restarts, which is critical when BE rate limits aggressively.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _profileCache = new Map<string, { data: any; fetchedAt: number }>();
  private static readonly PROFILE_CACHE_TTL_MS = 5 * 60 * 1000;
  // v2: bumped 2026-04-15 after followed_by/mutual fix — old entries had
  // incorrect follow_status from the getUserFollowers bug and must be
  // discarded instead of served from the persistent cache.
  private static readonly PROFILE_CACHE_KEY = "profileCard.hostCache.v2";

  constructor(private readonly extensionUri: vscode.Uri) { }

  /**
   * Surface a follow/unfollow error to the user with a toast. Extracts the
   * BE error message if present and offers a "Sign In Again" action when the
   * failure is a missing OAuth scope (GITHUB_FOLLOW_SYNC_FAILED).
   */
  private async surfaceFollowError(
    err: unknown,
    action: "follow" | "unfollow",
    username: string,
  ): Promise<void> {
    const axiosErr = err as {
      response?: { status?: number; data?: unknown };
      code?: string;
      message?: string;
    };

    const status = axiosErr.response?.status;
    const data = axiosErr.response?.data as
      | { error?: { code?: string; message?: string } }
      | string
      | undefined;
    const beCode = typeof data === "object" ? data?.error?.code : undefined;
    const beMsg = typeof data === "object" ? data?.error?.message : undefined;

    // Structured diagnostic log so the next failure is debuggable from the
    // output channel without re-instrumenting code.
    let dataDump: string;
    try {
      dataDump =
        typeof data === "string"
          ? data.slice(0, 500)
          : JSON.stringify(data).slice(0, 500);
    } catch {
      dataDump = "<unserializable>";
    }
    log(
      `[Explore] surfaceFollowError ${action} @${username} ` +
        `status=${status ?? "-"} code=${beCode ?? axiosErr.code ?? "-"} ` +
        `beMsg=${beMsg ?? "-"} axiosMsg=${axiosErr.message ?? "-"} ` +
        `dataType=${typeof data} data=${dataDump}`,
      "warn",
    );
    console.error(
      `[surfaceFollowError] ${action} @${username}`,
      { status, beCode, beMsg, axiosMsg: axiosErr.message, dataType: typeof data, data },
    );

    const verb = action === "follow" ? "follow" : "unfollow";

    // Detect a gateway-level HTML 502 (Cloudflare / reverse proxy returning
    // an HTML error page instead of the BE's structured JSON). In that case
    // BE was never reached, so no structured error is available — tell the
    // user the server is unreachable and offer a retry.
    const isGatewayHtmlError =
      typeof data === "string" && /<\s*html|<!doctype/i.test(data.slice(0, 100));

    if (isGatewayHtmlError) {
      const apiUrl = configManager.current.apiUrl;
      const choice = await vscode.window.showErrorMessage(
        `GitChat server unreachable (HTTP ${status ?? "502"}). ` +
          `Check that the backend at ${apiUrl} is running. ` +
          `If you're testing locally, override gitchat.apiUrl in settings.`,
        "Retry",
        "Open Settings",
      );
      if (choice === "Retry") {
        vscode.commands.executeCommand(
          action === "follow" ? "gitchat.retryFollow" : "gitchat.retryUnfollow",
          username,
        ).then(undefined, () => { /* no retry command registered — silent */ });
      } else if (choice === "Open Settings") {
        vscode.commands.executeCommand("workbench.action.openSettings", "gitchat.apiUrl");
      }
      return;
    }

    const httpHint = status ? ` (HTTP ${status})` : axiosErr.code ? ` (${axiosErr.code})` : "";
    const fallback = `Failed to ${verb} @${username}${httpHint}`;

    if (beCode === "GITHUB_FOLLOW_SYNC_FAILED") {
      const choice = await vscode.window.showErrorMessage(
        beMsg ?? fallback,
        "Sign In Again",
      );
      if (choice === "Sign In Again") {
        try {
          await vscode.commands.executeCommand("gitchat.signOut");
          await vscode.commands.executeCommand("gitchat.signIn");
        } catch (signErr) {
          log(`[Explore] re-signin after follow failure errored: ${signErr}`, "warn");
        }
      }
      return;
    }

    vscode.window.showErrorMessage(beMsg ?? fallback);
  }

  /**
   * True when the sidebar is visible and currently showing the given
   * conversation. Used by the notifications module to suppress toasts for
   * a chat the user is already reading. Does NOT gate on
   * vscode.window.state.focused — on VS Code forks (Antigravity, Cursor,
   * Windsurf) webview interaction can make the workbench lose focus while
   * the user is still clearly reading the chat, causing the gate to fail.
   */
  isShowingChat(conversationId: string): boolean {
    if (!this.view?.visible) {
      return false;
    }
    return this._activeChatConvId === conversationId;
  }

  /**
   * Inject the WebviewRenderer used by the notifications coordinator to
   * surface toasts inside the sidebar webview. Called from
   * src/notifications/index.ts after construction.
   */
  setWebviewRenderer(r: import("../notifications/renderers/webview-renderer").WebviewRenderer): void {
    this._webviewRenderer = r;
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")],
    };
    webviewView.webview.html = this.getHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage((msg: WebviewMessage) => this.onMessage(msg));

    // Pull toast webview renderer now that the webview is live. This avoids the
    // activation-order race where notificationsModule wires renderers before
    // exploreWebviewProvider is constructed (see #133 hybrid toast plan).
    const toastRenderer = toastCoordinator.getWebviewRenderer();
    if (toastRenderer) {
      this._webviewRenderer = toastRenderer as unknown as import("../notifications/renderers/webview-renderer").WebviewRenderer;
    }

    // Dispose previous subscription if view is re-resolved
    this._followChangeSub?.dispose();
    this._followChangeSub = onDidChangeFollow((e) => {
      this.view?.webview.postMessage({
        type: "followUpdate",
        login: e.username,
        following: e.following,
      });
    });

    // Task 4.2: Forward WS discover:online-now snapshot/delta to webview
    this._onlineNowSnapSub?.dispose();
    this._onlineNowSnapSub = realtimeClient.onDiscoverOnlineNowSnapshot((payload) => {
      this.view?.webview.postMessage({ type: "discoverOnlineNowSnapshot", payload });
    });
    this._onlineNowDeltaSub?.dispose();
    this._onlineNowDeltaSub = realtimeClient.onDiscoverOnlineNowDelta((payload) => {
      this.view?.webview.postMessage({ type: "discoverOnlineNowDelta", payload });
    });

    // Task 5.1: Live-toggle WS Online Now when the feature flag changes.
    this._configChangeSub?.dispose();
    this._configChangeSub = vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration("trending.wsDiscoverOnlineNow")) return;
      if (!this._discoverTabActive) return;
      const nowEnabled = configManager.current.wsDiscoverOnlineNow;
      if (nowEnabled) {
        realtimeClient.subscribeDiscoverOnlineNow(20);
      } else {
        realtimeClient.unsubscribeDiscoverOnlineNow();
        this._loadOnlineNowViaRest();
      }
    });

    // Apply pending badge if set before view was resolved
    if (this._pendingBadge !== null) {
      this.setBadge(this._pendingBadge);
      this._pendingBadge = null;
    }

    webviewView.onDidChangeVisibility(async () => {
      if (webviewView.visible && this._activeChatConvId) {
        // Reload chat data when sidebar becomes visible again
        await this.loadConversationData(this._activeChatConvId);
        // Re-post topic header so webview restores _state.topicId after reload
        if (this._activeTopicId && this._activeTopicParentConvId) {
          const convs = await apiClient.getConversations();
          const convData = convs.find((c: Conversation) => c.id === this._activeTopicParentConvId);
          const groupName = convData?.group_name || convData?.repo_full_name || "Group";
          this.postToWebview({
            type: "chat:topicHeader",
            topicId: this._activeTopicId,
            topicName: this._activeTopicName || "General",
            topicIcon: this._activeTopicIcon || "💬",
            groupName,
          });
        }
      }
    });

    // Debounce 100 ms to avoid flicker on rapid toggle of the sidebar.
    // VS Code's API supports multiple subscribers per event, so this is
    // registered alongside (not replacing) the chat-reload handler above.
    webviewView.onDidChangeVisibility(() => {
      if (this._toastVisTimer) { clearTimeout(this._toastVisTimer); }
      this._toastVisTimer = setTimeout(() => {
        if (!webviewView.visible) {
          this._webviewRenderer?.setReady(false);
          this._webviewRenderer?.reset();
        }
        // Don't flip to ready=true here; wait for explicit toast:ready from
        // the webview after it re-mounts (if webview was disposed on hide).
      }, 100);
    });
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
        // WP11: fall back to cached GitHub data instead of direct GitHub API.
        const { githubDataCache } = await import("../github-data");
        following = await githubDataCache.getFollowing();
      }
      const logins = following.map((f: { login: string }) => f.login);
      let presenceData: Record<string, PresenceEntry> = {};
      if (logins.length) {
        const watched = logins.slice(0, 50);
        try {
          presenceData = await apiClient.getPresence(watched);
        } catch (err) {
          log(`[Explore/Chat] getPresence failed: ${err}`, "warn");
        }
        // Subscribe to live presence updates — HTTP fetch is a one-shot
        // snapshot; without watchPresence the online dot never refreshes.
        realtimeClient.watchPresence(watched);
      }

      let conversations: Conversation[] = [];
      try {
        conversations = await apiClient.getConversations();
        this._activeConversationIds = new Set(conversations.map(c => c.id));
        realtimeClient.subscribeToConversations(conversations.map(c => c.id));
        this.refreshNotifications(); // re-filter now that conversation IDs are known
      } catch (err) {
        log(`[Explore/Chat] getConversations failed: ${err}`, "warn");
      }

      // DM partners that aren't in the user's `following` list never got
      // their presence fetched/subscribed above, so their `other_user.online`
      // would stay frozen at whatever stale value the backend attached to the
      // conversation. Supplement with a second getPresence + watchPresence
      // for DM partners we don't already have live data for.
      const dmPartnerLogins: string[] = [];
      for (const c of conversations) {
        if (c.type === "group" || c.is_group) { continue; }
        const other = getOtherUser(c, authManager.login);
        if (other?.login && other.login !== authManager.login && !presenceData[other.login]) {
          dmPartnerLogins.push(other.login);
        }
      }
      if (dmPartnerLogins.length) {
        const extra = Array.from(new Set(dmPartnerLogins)).slice(0, 50);
        try {
          const extraPresence = await apiClient.getPresence(extra);
          presenceData = { ...presenceData, ...extraPresence };
        } catch (err) {
          log(`[Explore/Chat] getPresence (DM partners) failed: ${err}`, "warn");
        }
        realtimeClient.watchPresence(extra);
      }

      const unreadCounts: Record<string, number> = {};
      for (const conv of conversations) {
        const other = getOtherUser(conv, authManager.login);
        if (other && ((conv as unknown as Record<string, number>).unread_count > 0)) {
          unreadCounts[other.login] = (conv as unknown as Record<string, number>).unread_count || 1;
        }
      }

      const friends = following.map((f: { login: string; name?: string; avatar_url?: string }) => {
        const entry = presenceData[f.login];
        const online = entry?.status === "online";
        const lastSeen = entry?.lastSeenAt ? new Date(entry.lastSeenAt).getTime() : 0;
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
        // Overwrite the backend-attached stale `other_user.online` with live
        // presenceData. explore.js:1579 short-circuits on `other_user.online`
        // when defined, so without this merge the conversation row dot never
        // reflects `presence:updated` events.
        let mergedOther = other;
        if (other) {
          const entry = presenceData[other.login];
          if (entry) {
            mergedOther = { ...other, online: entry.status === "online" };
          }
        }
        return { ...c, other_user: mergedOther };
      });

      // Fetch mutual friends for Group creation (BE requires mutual follow + active account)
      let mutualFriends: { login: string; name: string; avatar_url: string }[] = [];
      try {
        // force=true bypasses the Redis hot cache so follow changes are reflected immediately
        const friendsData = await apiClient.getMyFriends(true);
        mutualFriends = friendsData.mutual
          .filter((f) => f.onGitchat)
          .map((f) => ({ login: f.login, name: f.name || f.login, avatar_url: f.avatarUrl || "" }));
      } catch (err) {
        log(`[Explore/Chat] getMyFriends failed: ${err}`, "warn");
      }

      let drafts: Record<string, string> = {};
      try {
        const { chatPanelWebviewProvider: cp } = await import("./chat-panel");
        drafts = cp.getAllDrafts();
      } catch { /* ignore */ }
      this.view.webview.postMessage({ type: "setChatData", friends, mutualFriends, conversations: convData, currentUser: authManager.login, drafts });

      // WP8 Wave: getOnlineNow commented out for release — re-enable when wave ships
      // apiClient.getOnlineNow(20).then((users) => {
      //   this.view?.webview.postMessage({ type: "setOnlineNow", users });
      // }).catch((err) => log(`[Explore/Discover] getOnlineNow failed: ${err}`, "warn"));
    } catch (err) {
      log(`[Explore/Chat] refresh failed: ${err}`, "warn");
    }
  }

  setBadge(count: number): void {
    if (this.view) {
      if (count > 0) {
        this.view.badge = { value: count, tooltip: `${count} unread message${count !== 1 ? "s" : ""}` };
      } else {
        // Force clear: some VS Code versions need explicit reassignment
        this.view.badge = { value: 0, tooltip: "" };
        this.view.badge = undefined;
      }
    } else {
      this._pendingBadge = count;
    }
  }

  clearUnread(login: string): void {
    this.view?.webview.postMessage({ type: "clearUnread", login });
  }

  isConversationMuted(conversationId: string): boolean {
    return this._mutedConvs.has(conversationId);
  }

  isConversationOpen(conversationId: string): boolean {
    return this._activeChatConvId === conversationId;
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

  /** Reverse lookup: find the real DM conversation id for a given recipient
   *  login, so callers can decide between navigating to an existing room vs.
   *  starting a draft (#112 lazy-create). Returns undefined if the map has
   *  not been populated yet or no DM exists with this user. */
  findDmConversationIdByLogin(login: string): string | undefined {
    for (const [convId, mapLogin] of this._dmConvMap) {
      if (mapLogin === login) { return convId; }
    }
    return undefined;
  }

  // ===================== CHANNELS =====================
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

  // ===================== CONTRIBUTED REPOS (for Discovery Teams) =====================
  async fetchContributedRepos(): Promise<void> {
    try {
      log(`[Explore/Contributed] fetching...`);
      const result = await apiClient.getMyContributedRepos();
      log(`[Explore/Contributed] got ${result.repos?.length ?? 0} contributed (stale=${result.stale})`);
      this.view?.webview.postMessage({
        type: "setContributedReposData",
        repos: result.repos ?? [],
        stale: !!result.stale,
        error: false,
      });

      if (result.stale) {
        void apiClient.getMyContributedRepos(true).then((fresh) => {
          this.view?.webview.postMessage({
            type: "setContributedReposData",
            repos: fresh.repos ?? [],
            stale: false,
            error: false,
          });
        }).catch((err) => {
          log(`[Explore/Contributed] background refresh failed: ${err}`, "warn");
        });
      }
    } catch (err) {
      log(`[Explore/Contributed] fetch failed: ${err}`, "warn");
      this.view?.webview.postMessage({
        type: "setContributedReposData",
        repos: [],
        stale: false,
        error: true,
      });
    }
  }

  // ===================== STARRED REPOS (for Discovery Community) =====================
  async fetchStarredRepos(): Promise<void> {
    try {
      log(`[Explore/Starred] fetching...`);
      const result = await apiClient.getMyStarredRepos();
      log(`[Explore/Starred] got ${result.repos?.length ?? 0} starred (stale=${result.stale})`);
      this.view?.webview.postMessage({
        type: "setStarredReposData",
        repos: result.repos ?? [],
        stale: !!result.stale,
        error: false,
      });

      if (result.stale) {
        void apiClient.getMyStarredRepos(true).then((fresh) => {
          this.view?.webview.postMessage({
            type: "setStarredReposData",
            repos: fresh.repos ?? [],
            stale: false,
            error: false,
          });
        }).catch((err) => {
          log(`[Explore/Starred] background refresh failed: ${err}`, "warn");
        });
      }
    } catch (err) {
      log(`[Explore/Starred] fetch failed: ${err}`, "warn");
      this.view?.webview.postMessage({
        type: "setStarredReposData",
        repos: [],
        stale: false,
        error: true,
      });
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
        // WP11: use cached GitHub data fallback
        try {
          const { githubDataCache } = await import("../github-data");
          following = await githubDataCache.getFollowing();
        } catch { /* ignore */ }
      }
      const logins = following.map((f: { login: string }) => f.login);
      let presenceData: Record<string, PresenceEntry> = {};
      if (logins.length) {
        const watched = logins.slice(0, 50);
        try { presenceData = await apiClient.getPresence(watched); } catch { /* ignore */ }
        realtimeClient.watchPresence(watched);
      }
      let conversations: Conversation[] = [];
      try {
        conversations = await apiClient.getConversations();
        this._activeConversationIds = new Set(conversations.map(c => c.id));
        realtimeClient.subscribeToConversations(conversations.map(c => c.id));
        this.refreshNotifications(); // re-filter now that conversation IDs are known
      } catch { /* ignore */ }
      const unreadCounts: Record<string, number> = {};
      for (const conv of conversations) {
        const other = getOtherUser(conv, authManager.login);
        if (other && ((conv as unknown as Record<string, number>).unread_count > 0)) {
          unreadCounts[other.login] = (conv as unknown as Record<string, number>).unread_count || 1;
        }
      }
      const friends = following.map((f: { login: string; name?: string; avatar_url?: string }) => {
        const entry = presenceData[f.login];
        const online = entry?.status === "online";
        const lastSeen = entry?.lastSeenAt ? new Date(entry.lastSeenAt).getTime() : 0;
        return { login: f.login, name: f.name || f.login, avatar_url: f.avatar_url || "", online, lastSeen, unread: unreadCounts[f.login] || 0 };
      });
      friends.sort((a: { online: boolean; lastSeen: number; name: string }, b: { online: boolean; lastSeen: number; name: string }) => {
        if (a.online && !b.online) { return -1; }
        if (!a.online && b.online) { return 1; }
        if (a.lastSeen !== b.lastSeen) { return b.lastSeen - a.lastSeen; }
        return a.name.localeCompare(b.name);
      });
      const convData = conversations.map((c: Conversation) => ({ ...c, other_user: getOtherUser(c, authManager.login) }));

      // Fetch mutual friends for Group creation (BE requires mutual follow + active account)
      let mutualFriends: { login: string; name: string; avatar_url: string }[] = [];
      try {
        // force=true bypasses the Redis hot cache so follow changes are reflected immediately
        const friendsData = await apiClient.getMyFriends(true);
        mutualFriends = friendsData.mutual
          .filter((f) => f.onGitchat)
          .map((f) => ({ login: f.login, name: f.name || f.login, avatar_url: f.avatarUrl || "" }));
      } catch { /* ignore */ }

      let drafts: Record<string, string> = {};
      try {
        const { chatPanelWebviewProvider: cp } = await import("./chat-panel");
        drafts = cp.getAllDrafts();
      } catch { /* ignore */ }
      this.view.webview.postMessage({ type: "setChatDataDev", friends, mutualFriends, conversations: convData, currentUser: authManager.login, drafts });
    } catch (err) {
      log(`[Explore/DevChat] fetchChatData failed: ${err}`, "warn");
    }
  }

  // ===================== FILE UPLOAD =====================
  private async uploadFromUri(fileUri: vscode.Uri): Promise<void> {
    const filename = fileUri.path.split("/").pop() || "file";
    const ext = filename.split(".").pop()?.toLowerCase() || "";
    const mimeMap: Record<string, string> = {
      png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
      mp4: "video/mp4", mov: "video/quicktime", avi: "video/x-msvideo",
      pdf: "application/pdf", zip: "application/zip", txt: "text/plain",
    };
    const mimeType = mimeMap[ext] || "application/octet-stream";
    const id = this._pickId++;

    try {
      const fileData = await vscode.workspace.fs.readFile(fileUri);
      const buffer = Buffer.from(fileData);
      const maxSize = 10 * 1024 * 1024;
      if (buffer.length > maxSize) {
        const sizeMB = (buffer.length / 1024 / 1024).toFixed(1);
        vscode.window.showWarningMessage(`File too large (${sizeMB}MB, max 10MB): ${filename}`);
        return;
      }

      const isImage = mimeType.startsWith("image/");
      let dataUri: string | undefined;
      if (isImage) {
        dataUri = `data:${mimeType};base64,${buffer.toString("base64")}`;
      }

      this.postToWebview({ type: "chat:addPickedFile", id, filename, mimeType, dataUri });

      const result = await apiClient.uploadAttachment(this._activeChatConvId!, buffer, filename, mimeType);
      this.postToWebview({ type: "chat:uploadComplete", id, attachment: result });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const status = (err as { response?: { status?: number } })?.response?.status;
      log(`File upload failed (status=${status}): ${errMsg}`, "error");
      this.postToWebview({ type: "chat:uploadFailed", id });
      vscode.window.showErrorMessage(`Failed to upload file${status ? ` (${status})` : ""}: ${errMsg.slice(0, 100)}`);
    }
  }

  // ===================== helpers =====================
  refreshNotifications(): void {
    if (!this.view) { return; }
    // Filter out notifications for conversations the user no longer belongs to
    const activeIds = this._activeConversationIds;
    const filtered = notificationStore.items.filter((n) => {
      const convId = n.metadata?.conversationId;
      if (!convId) { return true; }
      if (activeIds.size === 0) { return false; } // conversations not loaded yet — hide until we can filter
      return activeIds.has(convId);
    });
    this.view.webview.postMessage({
      type: "setNotifications",
      items: filtered.slice(0, 20),
      unread: filtered.filter((n) => !n.is_read).length,
    });
  }

  postToWebview(msg: unknown): void {
    this.view?.webview.postMessage(msg);
  }

  async navigateToChat(conversationId: string, recipientLogin?: string): Promise<void> {
    // Focus the explore view first
    await vscode.commands.executeCommand("gitchat.explore.focus");

    const sameConvo = this._activeChatConvId === conversationId;

    if (!sameConvo) {
      this._activeChatConvId = conversationId;
      this._activeChatRecipient = recipientLogin;
      this._activeTopicId = undefined;
    }

    // Always post chat:navigate so the webview switches back to the chat
    // view if the user was on a different tab (Friends / Discover / Noti).
    // In-memory messages in the webview are preserved.
    this.view?.webview.postMessage({
      type: "chat:navigate",
      conversationId,
      recipientLogin: this._activeChatRecipient ?? recipientLogin,
    });

    // Skip the expensive getMessages() re-fetch when the user is already
    // on this conversation — realtime delivery keeps the view fresh, and
    // re-loading causes visible flicker + wasted API calls.
    if (!sameConvo) {
      // Bump generation so any in-flight loadConversationData from a
      // previous navigation is discarded when it resolves.
      const gen = ++this._navGeneration;
      await this.loadConversationData(conversationId, gen);
    }
  }

  /**
   * Navigate the chat panel to a draft state for a not-yet-existing DM.
   * No backend call is made. The synthetic id `draft:<login>` is used until
   * the first send, which mints the real conversation and swaps the id.
   * See #112 — fixes ghost DMs created on profile Message button click.
   */
  async navigateToDraftChat(recipientLogin: string): Promise<void> {
    await vscode.commands.executeCommand("gitchat.explore.focus");

    const draftId = `draft:${recipientLogin}`;
    this._activeChatConvId = draftId;
    this._activeChatRecipient = recipientLogin;

    this.view?.webview.postMessage({
      type: "chat:navigate",
      conversationId: draftId,
      recipientLogin,
      isDraft: true,
    });

    // Bump the generation counter so any in-flight fetch from a prior
    // navigation is discarded.
    ++this._navGeneration;
  }

  async loadConversationData(conversationId: string, gen?: number): Promise<void> {
    if (!this.view) { return; }
    // When called with a generation token, bail out early if the user has
    // already navigated to a different conversation (ghost-data flash guard).
    const isStale = () => gen !== undefined && gen !== this._navGeneration;

    // Issue #51 — Stale-while-revalidate: if we have a persistent cache for
    // this conversation, render it immediately so the user doesn't stare at
    // skeleton bubbles on every reopen. The real fetch continues below and
    // posts chat:refresh when it resolves.
    let cacheHit = false;
    try {
      const cached = messageCache.get(conversationId);
      if (cached && cached.messages.length > 0 && !isStale()) {
        cacheHit = true;
        const currentUserEarly = authManager.login ?? "me";
        this.postToWebview({
          type: "chat:init",
          payload: {
            fromCache: true,
            currentUser: currentUserEarly,
            // Minimal participant — sidebar-chat will refine on chat:refresh
            // once real metadata arrives.
            participant: {
              login: this._activeChatRecipient || "",
              name: this._activeChatRecipient || "",
              online: false,
              avatar_url: this._activeChatRecipient
                ? `https://github.com/${this._activeChatRecipient}.png?size=64`
                : "",
            },
            isGroup: this._chatIsGroup,
            isGroupCreator: false,
            participants: undefined,
            messages: cached.messages,
            hasMore: cached.hasMore,
            otherReadAt: null,
            readReceipts: [],
            friends: [],
            groupMembers: cached.groupMembers ?? [],
            isMuted: false,
            isPinned: false,
            createdBy: "",
            pinnedMessages: [],
            conversationId,
            unreadCount: 0,
            lastReadMessageId: undefined,
            unreadMentionsCount: 0,
            unreadReactionsCount: 0,
            mentionIds: [],
            reactionIds: [],
          },
        });
      }
    } catch (err) {
      log(`[MessageCache] read failed for ${conversationId}: ${err}`, "warn");
    }

    try {
      // Bug 1: when viewing a topic, always fetch via the nested topic
      // endpoint so BE routes through the topic-aware code path (auth,
      // closed-state, permission overrides). The flat endpoint happens to
      // work for reads today but the nested alias is the contract Slug
      // committed to in FE, and keeping both read+write on the same path
      // avoids subtle divergences when BE evolves.
      const topicCtx = this._activeTopicId && this._activeTopicParentConvId
        && conversationId === this._activeTopicId
        ? { parentId: this._activeTopicParentConvId, topicId: this._activeTopicId }
        : null;
      const result = topicCtx
        ? await apiClient.getTopicMessages(topicCtx.parentId, topicCtx.topicId, 1)
        : await apiClient.getMessages(conversationId, 1);
      // Persist latest-N messages for SWR on the next open — always update
      // cache even if navigation is stale, so the next open is fresh.
      try {
        messageCache.set(conversationId, result.messages, result.hasMore);
      } catch (err) {
        log(`[MessageCache] set failed for ${conversationId}: ${err}`, "warn");
      }
      // Ghost-data flash guard: user switched conversations while we were
      // fetching — discard the result instead of posting to the wrong view.
      if (isStale()) { return; }
      this._chatCursorState = {
        cursor: result.cursor,
        previousCursor: undefined,
        nextCursor: undefined,
        hasMore: result.hasMore,
        hasMoreBefore: result.hasMore,
        hasMoreAfter: false,
      };
      const currentUser = authManager.login ?? "me";

      // Fetch conversation metadata — for topics, use parent conv for metadata
      // and members since topics inherit membership and aren't in getConversations().
      const metadataConvId = this._activeTopicParentConvId || conversationId;
      let recipientLogin = this._activeChatRecipient;
      let conv: Record<string, unknown> | undefined;
      try {
        const conversations = await apiClient.getConversations();
        conv = conversations.find((c) => c.id === metadataConvId) as Record<string, unknown> | undefined;
        if (!recipientLogin) {
          const otherUser = conv?.other_user as { login: string } | undefined;
          recipientLogin = otherUser?.login
            || (conv?.participants as { login: string }[] | undefined)?.find((p) => p.login !== currentUser)?.login;
        }
      } catch { /* ignore */ }

      // Detect group (includes community and team conversation types)
      const convType = conv?.type as string | undefined;
      let isGroup = convType === "group" || convType === "community" || convType === "team" || conv?.is_group === true || ((conv?.participants as unknown[] | undefined)?.length ?? 0) > 2;
      const repoFullName = conv?.["repo_full_name"] as string | undefined;
      const repoOwner = repoFullName ? repoFullName.split("/")[0] : undefined;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let groupMembers: any[] = [];
      if (!isGroup && !conv) {
        try {
          groupMembers = await apiClient.getGroupMembers(metadataConvId);
          if (groupMembers.length > 2) { isGroup = true; }
        } catch { /* ignore */ }
      }
      // Compute groupTitle AFTER getGroupMembers fallback may have updated isGroup
      const groupTitle = isGroup ? ((conv?.group_name as string) || repoFullName || "Group Chat") : undefined;
      const groupAvatarUrl = (conv?.["group_avatar_url"] as string)
        || (repoOwner ? `https://github.com/${encodeURIComponent(repoOwner)}.png?size=64` : "");
      this._chatIsGroup = isGroup;
      const isPinned = !!(conv?.pinned_at || conv?.pinned);

      recipientLogin = recipientLogin || "Unknown";

      if (isGroup && groupMembers.length === 0) {
        try { groupMembers = await apiClient.getGroupMembers(metadataConvId); } catch { /* ignore */ }
      }

      // Cache members alongside messages so next open paints avatars
      // on the first frame (issue #83).
      if (isGroup && groupMembers.length > 0) {
        try {
          messageCache.setGroupMembers(conversationId, groupMembers.map((m) => ({
            login: m.login, name: m.name ?? null, avatar_url: m.avatar_url ?? null,
          })));
        } catch (err) {
          log(`[MessageCache] setGroupMembers failed: ${err}`, "warn");
        }
      }

      // Pinned messages — use shared extractor (includes attachments, reactions)
      let pinnedMessages: Record<string, unknown>[] = [];
      try {
        const pins = await apiClient.getPinnedMessages(conversationId);
        pinnedMessages = extractPinnedMessages(pins as unknown[]);
      } catch { /* ignore */ }

      // Unread mentions/reactions
      let mentionIds: string[] = [];
      let reactionIds: string[] = [];
      const unreadMentionsCount = (conv as Record<string, number>)?.["unread_mentions_count"] ?? 0;
      const unreadReactionsCount = (conv as Record<string, number>)?.["unread_reactions_count"] ?? 0;
      log(`[SidebarChat] mentions=${unreadMentionsCount} reactions=${unreadReactionsCount}`);
      if (unreadMentionsCount > 0) {
        try { mentionIds = await apiClient.getUnreadMentions(conversationId); log(`[SidebarChat] mentionIds=${JSON.stringify(mentionIds)}`); } catch (e) { log(`[SidebarChat] getUnreadMentions failed: ${e}`, "warn"); }
      }
      if (unreadReactionsCount > 0) {
        try { reactionIds = await apiClient.getUnreadReactions(conversationId); log(`[SidebarChat] reactionIds=${JSON.stringify(reactionIds)}`); } catch (e) { log(`[SidebarChat] getUnreadReactions failed: ${e}`, "warn"); }
      }

      // Join realtime room
      realtimeClient.joinConversation(conversationId);

      // Ghost-data flash guard: second check after all metadata fetches.
      if (isStale()) { return; }

      // On cache hit we already posted chat:init from the stale entry —
      // use chat:refresh so the webview merges instead of full re-renders,
      // which would flash the skeleton cross-fade a second time.
      const currentUserRole = isGroup
        ? (groupMembers.find((m) => (m as { login?: string }).login === currentUser) as { role?: "admin" | "member" } | undefined)?.role
        : undefined;
      this.postToWebview({
        type: cacheHit ? "chat:refresh" : "chat:init",
        payload: {
          currentUser,
          participant: isGroup
            ? { login: groupTitle, name: groupTitle, online: false, avatar_url: groupAvatarUrl }
            : { login: recipientLogin, name: recipientLogin, online: false, avatar_url: `https://github.com/${recipientLogin}.png?size=64` },
          isGroup,
          isGroupCreator: isGroup && (conv?.["created_by"] as string | undefined) === authManager.login,
          participants: isGroup ? conv?.participants : undefined,
          messages: result.messages,
          hasMore: result.hasMore,
          otherReadAt: (result as { otherReadAt?: string | null }).otherReadAt ?? null,
          readReceipts: (result as { readReceipts?: unknown[] }).readReceipts ?? [],
          friends: [],
          groupMembers,
          currentUserRole,
          isMuted: (conv as Record<string, unknown>)?.["is_muted"] || false,
          isPinned,
          createdBy: isGroup ? ((conv as Record<string, unknown>)?.["created_by"] as string || "") : "",
          pinnedMessages,
          conversationId,
          unreadCount: (conv as Record<string, number>)?.unread_count ?? 0,
          lastReadMessageId: (conv as Record<string, unknown>)?.["last_read_message_id"] as string | undefined,
          unreadMentionsCount,
          unreadReactionsCount,
          mentionIds,
          reactionIds,
        },
      });

      // Send draft if any
      try {
        const { chatPanelWebviewProvider: cp } = await import("./chat-panel");
        const draft = cp.getDraft(conversationId);
        if (draft) { this.postToWebview({ type: "chat:setDraft", text: draft }); }
        cp.debouncedRefresh();
      } catch { /* ignore */ }
      import("../statusbar").then(m => m.fetchCounts()).catch(() => { });
    } catch (err) {
      log(`[Explore/SidebarChat] loadConversationData failed: ${err}`, "error");
    }
  }

  // ===================== REFRESH ALL =====================
  async refreshAll(): Promise<void> {
    await this.refreshChat();
  }

  /** WP3: Send onboarding modal trigger to webview */
  sendOnboarding(): void {
    this.view?.webview.postMessage({ type: "showOnboarding" });
  }

  /** WP3: Switch webview to Chat tab (returning user default) */
  switchToChat(): void {
    this.view?.webview.postMessage({ type: "switchToChat" });
  }

  /** WP3: Check if a user has completed onboarding */
  hasCompletedOnboarding(login: string): boolean {
    return this._context?.globalState.get<boolean>(`gitchat.hasCompletedOnboarding.${login}`, false) ?? false;
  }

  /** Expose context for dev commands (e.g., resetOnboarding) */
  getContext(): vscode.ExtensionContext | undefined {
    return this._context;
  }

  setContext(context: vscode.ExtensionContext): void {
    this._context = context;
    this._loadProfileCache();
  }

  // Load persisted profile cache from globalState, pruning stale entries.
  private _loadProfileCache(): void {
    if (!this._context) { return; }
    const raw = this._context.globalState.get<
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Record<string, { data: any; fetchedAt: number }>
    >(ExploreWebviewProvider.PROFILE_CACHE_KEY);
    if (!raw) { return; }
    const now = Date.now();
    const ttl = ExploreWebviewProvider.PROFILE_CACHE_TTL_MS;
    for (const [login, entry] of Object.entries(raw)) {
      if (entry && now - entry.fetchedAt < ttl) {
        this._profileCache.set(login, entry);
      }
    }
    log(`[Explore] profile cache loaded (${this._profileCache.size} fresh entries)`);
  }

  // Persist the current in-memory cache to globalState. Called after each
  // successful fetch so the cache survives reloads.
  private _saveProfileCache(): void {
    if (!this._context) { return; }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const obj: Record<string, { data: any; fetchedAt: number }> = {};
    for (const [login, entry] of this._profileCache.entries()) {
      obj[login] = entry;
    }
    void this._context.globalState.update(ExploreWebviewProvider.PROFILE_CACHE_KEY, obj);
  }

  // ===================== MESSAGE HANDLER =====================
  private async onMessage(msg: WebviewMessage): Promise<void> {
    const p = msg.payload as Record<string, string>;

    // Route chat: prefixed messages to shared chat handlers
    if (typeof msg.type === "string" && msg.type.startsWith("chat:")) {
      const chatType = msg.type.slice(5); // strip "chat:" prefix

      if (chatType === "open") {
        // Open a conversation in sidebar chat — clear topic state so
        // messages don't accidentally route through topic endpoint.
        const convId = (msg.payload as Record<string, string>)?.conversationId;
        if (convId) {
          this._activeChatConvId = convId;
          this._activeTopicId = undefined;
          this._activeTopicParentConvId = undefined;
          this._activeTopicName = undefined;
          this._activeTopicIcon = undefined;
          await this.loadConversationData(convId);
        }
        return;
      }
      if (chatType === "close") {
        // Close sidebar chat view
        this._activeChatConvId = undefined;
        this._activeChatRecipient = undefined;
        this._chatRecentlySentIds.clear();
        return;
      }

      // chat:ready — fired by sidebar-chat.js after render, used for deferred jump-to-message
      if (chatType === "ready") {
        if (this._pendingJump) {
          const readyConvId = (msg as unknown as Record<string, string>).conversationId;
          if (readyConvId && this._pendingJump.conversationId === readyConvId) {
            const { messageId, timer } = this._pendingJump;
            this._pendingJump = null;
            clearTimeout(timer);
            this.postToWebview({ type: "chat:jumpToMessage", messageId });
          }
        }
        return;
      }

      // Handle reloadConversation before delegating to chat-handlers
      if (chatType === "reloadConversation") {
        if (this._activeChatConvId) {
          await this.loadConversationData(this._activeChatConvId);
        }
        return;
      }

      // Handle insertCode — insert selected text as code snippet
      if (chatType === "insertCode") {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
          const selection = editor.document.getText(editor.selection);
          if (selection) {
            const lang = editor.document.languageId || "";
            const text = "```" + lang + "\n" + selection + "\n```";
            this.postToWebview({ type: "chat:insertText", text });
          } else {
            vscode.window.showWarningMessage("Select some code first, then try again.");
          }
        } else {
          vscode.window.showWarningMessage("No active editor — open a file and select code first.");
        }
        return;
      }

      // Handle pickFile/pickPhoto (not in chat-handlers, only in chat.ts)
      if (chatType === "pickFile" || chatType === "pickPhoto") {
        const photoFilters: Record<string, string[]> = chatType === "pickPhoto"
          ? { "Images & Videos": ["png", "jpg", "jpeg", "gif", "webp", "mp4", "mov", "avi"] }
          : { "Images": ["png", "jpg", "jpeg", "gif", "webp"], "All": ["*"] };
        const uris = await vscode.window.showOpenDialog({
          canSelectFiles: true, canSelectMany: true,
          filters: photoFilters,
        });
        if (uris && uris.length > 0) {
          for (const uri of uris.slice(0, 10)) {
            await this.uploadFromUri(uri);
          }
        }
        return;
      }

      // Handle typing emission
      if (chatType === "typing") {
        if (this._activeChatConvId) {
          realtimeClient.emitTyping(this._activeChatConvId);
        }
        return;
      }

      // joinCommunity/joinTeam are standalone actions — they don't require an active
      // conversation. Route them to the shared handler with a minimal context so the
      // Discover/Trending Join buttons work even when no chat is open.
      if (chatType === "joinCommunity" || chatType === "joinTeam") {
        const joinCtx: ChatContext = {
          conversationId: this._activeChatConvId ?? "",
          postToWebview: (m) => this.postToWebview(m),
          recentlySentIds: this._chatRecentlySentIds,
          extensionUri: this.extensionUri,
          isGroup: this._chatIsGroup,
          prefixMessages: true,
          cursorState: this._chatCursorState,
          reloadConversation: () =>
            this._activeChatConvId
              ? this.loadConversationData(this._activeChatConvId)
              : Promise.resolve(),
          disposePanel: () => { /* no active panel to dispose */ },
        };
        await handleChatMessage({ ...msg, type: chatType }, joinCtx);
        return;
      }

      // Topic messages: no special routing needed.
      // _activeChatConvId is set to topicId (topic IS a conversation),
      // so normal handleChatMessage send flow works directly.

      // Delegate to shared handler with chat: stripped type
      if (this._activeChatConvId) {
        const ctx: ChatContext = {
          conversationId: this._activeChatConvId,
          topicParentConvId: this._activeTopicParentConvId,
          postToWebview: (m) => this.postToWebview(m),
          recentlySentIds: this._chatRecentlySentIds,
          extensionUri: this.extensionUri,
          isGroup: this._chatIsGroup,
          prefixMessages: true, // sidebar uses chat: prefix
          cursorState: this._chatCursorState,
          reloadConversation: () => this.loadConversationData(this._activeChatConvId!),
          disposePanel: () => {
            const removedConvId = this._activeChatConvId;
            this._activeChatConvId = undefined;
            this._activeTopicId = undefined;
            this._activeTopicParentConvId = undefined;
            this._activeTopicName = undefined;
            this._activeTopicIcon = undefined;
            this.postToWebview({ type: "chat:closed" });
            if (removedConvId) {
              this.postToWebview({ type: "removeConversation", conversationId: removedConvId });
            }
            this.fetchChatDataDev();
          },
        };
        const strippedMsg = { ...msg, type: chatType };
        const handled = await handleChatMessage(strippedMsg, ctx);
        // Sync cursor state back
        this._chatCursorState = ctx.cursorState;
        if (handled) { return; }
      }
      return;
    }

    // Handle showNewChatMenu from title bar button
    if (msg.type === "showNewChatMenu") {
      const choice = await vscode.window.showQuickPick(
        [
          { label: "$(comment-discussion) New Message", description: "Direct message to a user", value: "dm" },
          { label: "$(organization) New Group", description: "Create a group chat", value: "group" },
        ],
        { placeHolder: "Start a new conversation" }
      );
      if (choice?.value === "dm") { vscode.commands.executeCommand("gitchat.messageUser"); }
      else if (choice?.value === "group") { vscode.commands.executeCommand("gitchat.createGroup"); }
      return;
    }

    // Task 4.2/5.1: Discover tab lifecycle → WS sub/unsub (flag-gated) + REST fallback
    if (msg.type === "discoverTabActive") {
      this._discoverTabActive = true;
      if (configManager.current.wsDiscoverOnlineNow) {
        realtimeClient.subscribeDiscoverOnlineNow(20);
      } else {
        // Legacy REST path — trigger fallback immediately instead of waiting 3s
        this._loadOnlineNowViaRest();
      }
      return;
    }
    if (msg.type === "discoverTabInactive") {
      this._discoverTabActive = false;
      if (configManager.current.wsDiscoverOnlineNow) {
        realtimeClient.unsubscribeDiscoverOnlineNow();
      }
      return;
    }
    if (msg.type === "discoverOnlineNowRestFallback") {
      // Fire-and-forget REST call; WS snapshot will replace if it arrives later.
      this._loadOnlineNowViaRest();
      return;
    }

    // ── Topic handlers ────────────────────────────────────────────────
    if (msg.type === "topic:open") {
      const m = msg as unknown as { topicId: string; topic: { id: string; name: string; iconEmoji?: string } };
      const convId = this._activeTopicParentConvId;
      if (!convId || !m.topicId) { log("[topics] topic:open SKIPPED — missing parentConvId or topicId"); return; }
      this._activeTopicId = m.topicId;
      this._activeTopicName = m.topic?.name || "General";
      this._activeTopicIcon = m.topic?.iconEmoji || "💬";
      try {
        const convs = await apiClient.getConversations();
        const convData = convs.find((c: Conversation) => c.id === convId);
        const groupName = convData?.group_name || convData?.repo_full_name || "Group";

        // Topic IS a conversation (topicId == conversationId per BE design)
        // Use loadConversationData(topicId) — same proven flow as normal chat
        this._activeChatConvId = m.topicId;
        await this.loadConversationData(m.topicId);

        // Override header + set topicId in sidebar-chat state
        this.postToWebview({
          type: "chat:topicHeader",
          topicId: m.topicId,
          topicName: m.topic?.name || "General",
          topicIcon: m.topic?.iconEmoji || "💬",
          groupName,
        });
      } catch (e) {
        log(`[topics] Failed to load topic: ${e}`, "error");
      }
      return;
    }

    if (msg.type === "topic:create") {
      const m = msg as unknown as { type: string; name: string; iconEmoji?: string };
      const convId = this._activeTopicParentConvId ?? this._activeChatConvId;
      if (!convId || !m.name) { return; }
      try {
        const topic = await apiClient.createTopic(convId, m.name, m.iconEmoji);
        this.postToWebview({ type: "topic:created", topic, conversationId: convId, autoOpen: true });
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : "Failed to create topic";
        this.postToWebview({ type: "topic:createError", error: errMsg });
      }
      return;
    }

    if (msg.type === "topic:loadList") {
      const m = msg as unknown as { type: string; conversationId: string };
      const convId = m.conversationId;
      if (!convId) { return; }
      this._activeTopicParentConvId = convId;
      try {
        const topics = await apiClient.getTopics(convId);
        this.postToWebview({ type: "topic:listData", topics, conversationId: convId });
      } catch (e) {
        log(`[topics] getTopics error: ${e}`, "error");
        this.postToWebview({ type: "topic:listError", error: "Failed to load topics", conversationId: convId });
      }
      return;
    }

    if (msg.type === "topic:markRead") {
      const m = msg as unknown as { type: string; topicId: string };
      const convId = this._activeTopicParentConvId;
      if (!convId || !m.topicId) { return; }
      try { await apiClient.markTopicRead(convId, m.topicId); } catch { /* silent */ }
      return;
    }

    switch (msg.type) {
      case "ready": {
        const cfg = configManager.current;
        const isDev = this._context?.extensionMode === vscode.ExtensionMode.Development;
        this.view?.webview.postMessage({
          type: "settings",
          showMessageNotifications: cfg.showMessageNotifications,
          messageSound: cfg.messageSound,
          debugLogs: cfg.debugLogs,
          devMode: isDev,
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
        this.refreshNotifications();
        // Hydrate notification per-type prefs from BE
        if (authManager.isSignedIn) {
          apiClient.getNotificationSettings()
            .then((s) => {
              this.view?.webview.postMessage({
                type: "notificationPrefs",
                prefs: s.inappPrefs ?? {},
              });
            })
            .catch(() => { /* best-effort */ });
        }

        // WP3: Check onboarding state on webview ready (instant, no delay)
        if (authManager.isSignedIn && authManager.login) {
          if (!this.hasCompletedOnboarding(authManager.login)) {
            this.sendOnboarding();
          } else {
            this.switchToChat();
          }
        }
        break;
      }

      case "updateNotificationPref": {
        const { key, value } = msg.payload as { key: string; value: boolean };
        try {
          await apiClient.updateNotificationSettings({ inappPrefs: { [key]: value } });
        } catch (err) {
          log(`[Notifications] updateNotificationSettings failed: ${err}`, "warn");
        }
        break;
      }

      case "notificationClicked": {
        const id = (msg.payload as Record<string, string>)?.id;
        if (!id) { break; }
        const notif = notificationStore.items.find((n) => n.id === id);
        if (!notif) { break; }
        await notificationStore.markRead([id]);
        this.refreshNotifications();

        const meta = notif.metadata ?? {};
        if (meta.conversationId) {
          const messageId = meta.messageId as string | undefined;
          if (messageId) {
            if (this._activeChatConvId === meta.conversationId) {
              this.postToWebview({ type: "chat:jumpToMessage", messageId });
            } else {
              if (this._pendingJump) { clearTimeout(this._pendingJump.timer); }
              const timer = setTimeout(() => { this._pendingJump = null; }, 5000);
              this._pendingJump = { conversationId: meta.conversationId, messageId, timer };
            }
          }
          await this.navigateToChat(meta.conversationId);
        } else if (notif.type === "follow") {
          this.postToWebview({ type: "showProfileCard", login: notif.actor_login });
        } else if (meta.url) {
          vscode.env.openExternal(vscode.Uri.parse(meta.url));
        }
        break;
      }

      case "notifications:waveRespond": {
        const { wave_id, sender_login, notif_id } = msg.payload as {
          wave_id: string; sender_login: string; notif_id: string;
        };
        try {
          let conversationId = "";
          try {
            const result = await apiClient.waveRespond(wave_id);
            conversationId = result.conversation_id;
          } catch (err) {
            // Fallback: BE missing /waves/:id/respond → create conversation directly.
            const status = (err as { response?: { status?: number } })?.response?.status;
            if (status === 404 || status === 405) {
              log(`[wave] waveRespond unavailable, falling back to createConversation`);
              const conv = await apiClient.createConversation(sender_login);
              conversationId = conv.id;
            } else {
              throw err;
            }
          }
          if (notif_id) { await notificationStore.markRead([notif_id]); this.refreshNotifications(); }
          if (conversationId) {
            vscode.commands.executeCommand("gitchat.openChat", conversationId);
          }
        } catch (err) {
          log(`[wave] respond failed: ${err}`, "warn");
          vscode.window.showErrorMessage(`Couldn't open wave reply. Please try again.`);
        }
        break;
      }

      case "notificationMarkAllRead": {
        await notificationStore.markAllRead();
        this.refreshNotifications();
        break;
      }

      case "notificationDropdownOpened": {
        // No longer auto mark-all-read on tab open (issue #76).
        // Individual items are marked via IntersectionObserver in the
        // webview (viewport-based read), and the user can still bulk-
        // mark via the "Mark all read" button.
        break;
      }

      case "markNotificationRead": {
        const ids = (msg.payload as { ids: string[] }).ids;
        if (ids?.length) {
          await notificationStore.markRead(ids);
          this.refreshNotifications();
        }
        break;
      }

      // Settings
      case "updateSetting": {
        const { key, value } = msg.payload as { key: string; value: boolean };
        const settingMap: Record<string, string> = {
          notifications: "gitchat.showMessageNotifications",
          sound: "gitchat.messageSound",
          debug: "gitchat.debugLogs",
        };
        const settingKey = settingMap[key];
        if (settingKey) {
          await vscode.workspace.getConfiguration().update(settingKey, value, vscode.ConfigurationTarget.Global);
        }
        break;
      }
      case "signOut":
        vscode.commands.executeCommand("gitchat.signOut");
        break;

      // Chat actions
      case "openChat":
        vscode.commands.executeCommand("gitchat.messageUser", p.login);
        break;
      case "viewProfile":
        if (p.login) { this.postToWebview({ type: "showProfileCard", login: p.login }); }
        break;
      case "openConversation":
        vscode.commands.executeCommand("gitchat.openChat", p.conversationId);
        break;
      case "newChat": {
        if (p?.login) {
          // DM flow — open/create conversation with specific user
          vscode.commands.executeCommand("gitchat.messageUser", p.login);
        } else {
          const choice = await vscode.window.showQuickPick(
            [
              { label: "$(comment-discussion) New Message", description: "Direct message to a user", value: "dm" },
              { label: "$(organization) New Group", description: "Create a group chat", value: "group" },
            ],
            { placeHolder: "Start a new conversation" }
          );
          if (choice?.value === "dm") { vscode.commands.executeCommand("gitchat.messageUser"); }
          else if (choice?.value === "group") { vscode.commands.executeCommand("gitchat.createGroup"); }
        }
        break;
      }
      case "newChatPanelOpened":
        vscode.commands.executeCommand("setContext", "gitchat.newChatPanelOpen", true);
        break;
      case "newChatPanelClosed":
        vscode.commands.executeCommand("setContext", "gitchat.newChatPanelOpen", false);
        break;
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
          import("../statusbar").then(m => m.fetchCounts()).catch(() => { });
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

      case "openUrl":
        if (p.url) { vscode.env.openExternal(vscode.Uri.parse(p.url)); }
        break;
      case "message":
        vscode.commands.executeCommand("gitchat.messageUser", p.login);
        break;

      case "searchInboxMessages": {
        const query = (p.query as string || "").trim();
        if (!query) { break; }
        log(`[Explore/InboxSearch] query="${query}"`);
        try {
          const result = await apiClient.globalSearchMessages(query, undefined, 50);
          log(`[Explore/InboxSearch] results: ${result.messages?.length || 0} messages`);
          this.view?.webview.postMessage({
            type: "inboxMessageSearchResults",
            query,
            messages: result.messages || [],
            nextCursor: result.nextCursor,
          });
        } catch (err) {
          log(`[Explore/InboxSearch] failed: ${err}`, "warn");
          this.view?.webview.postMessage({
            type: "inboxMessageSearchError",
            query,
          });
        }
        break;
      }

      case "discoverSearchUsers": {
        const query = (p.query as string || "").trim();
        if (!query) { break; }
        log(`[Explore/DiscoverSearch] query="${query}"`);
        try {
          const users = await apiClient.searchUsers(query);
          log(`[Explore/DiscoverSearch] results: ${users.length} users`);
          this.view?.webview.postMessage({
            type: "discoverSearchUsersResult",
            query,
            users,
          });
        } catch (err) {
          log(`[Explore/DiscoverSearch] failed: ${err}`, "warn");
          this.view?.webview.postMessage({
            type: "discoverSearchUsersError",
            query,
          });
        }
        break;
      }

      // ── Channels ─────────────────────────────────────────
      case "fetchChatData":
        await this.fetchChatDataDev();
        break;
      case "fetchChannels":
        void this.fetchChannels();
        void this.fetchStarredRepos();
        void this.fetchContributedRepos();
        break;
      case "fetchStarredRepos":
        void this.fetchStarredRepos();
        break;
      case "fetchContributedRepos":
        void this.fetchContributedRepos();
        break;
      case "openChannel": {
        const cp = msg.payload as { channelId: string; repoOwner: string; repoName: string };
        vscode.commands.executeCommand("gitchat.openChannel", cp.channelId, cp.repoOwner, cp.repoName);
        break;
      }
      case "chatOpenDM":
        vscode.commands.executeCommand("gitchat.messageUser", p?.login);
        break;
      case "chatNewChat": {
        const chatChoice = await vscode.window.showQuickPick(
          [
            { label: "$(comment-discussion) New Message", description: "Direct message to a user", value: "dm" },
            { label: "$(organization) New Group", description: "Create a group chat", value: "group" },
          ],
          { placeHolder: "Start a new conversation" }
        );
        if (chatChoice?.value === "dm") { vscode.commands.executeCommand("gitchat.messageUser"); }
        else if (chatChoice?.value === "group") { vscode.commands.executeCommand("gitchat.createGroup"); }
        break;
      }
      case "pickGroupAvatar": {
        const uris = await vscode.window.showOpenDialog({
          canSelectFiles: true, canSelectMany: false,
          filters: { "Images": ["png", "jpg", "jpeg", "gif", "webp"] },
        });
        if (uris && uris[0]) {
          try {
            const fileData = await vscode.workspace.fs.readFile(uris[0]);
            const buf = Buffer.from(fileData);
            if (buf.length > 5 * 1024 * 1024) {
              vscode.window.showWarningMessage("Avatar too large (max 5MB)");
              break;
            }
            const ext = uris[0].path.split(".").pop()?.toLowerCase() || "png";
            const mime = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" }[ext] || "image/png";
            const dataUri = `data:${mime};base64,${buf.toString("base64")}`;
            if (this._activeChatConvId) {
              // Editing existing group — show preview immediately, then upload
              this.postToWebview({ type: "chat:groupAvatarUpdated", avatarUrl: dataUri });
              try {
                const uploaded = await apiClient.uploadAttachment(this._activeChatConvId, buf, `group-avatar.${ext}`, mime);
                if (uploaded?.url) {
                  await apiClient.updateGroup(this._activeChatConvId, undefined, uploaded.url);
                  this.postToWebview({ type: "chat:groupAvatarUpdated", avatarUrl: uploaded.url });
                }
              } catch (uploadErr) {
                log(`[Explore/GroupAvatar] upload failed: ${uploadErr}`, "warn");
                this.postToWebview({ type: "chat:showToast", text: "Failed to update group avatar" });
              }
            } else {
              // Creating new group — store for later
              this._pendingGroupAvatar = { buffer: buf, filename: `group-avatar.${ext}`, mimeType: mime };
              this.view?.webview.postMessage({ type: "groupAvatarPicked", dataUri });
            }
          } catch (err) {
            log(`[Explore/CreateGroup] avatar pick failed: ${err}`, "warn");
          }
        }
        break;
      }
      case "createGroup": {
        const { name: groupName, members } = p as unknown as { name: string; members: string[] };
        if (!members?.length) { break; }
        try {
          const conv = await apiClient.createGroupConversation(members, groupName);
          log(`Created group "${groupName}" with ${members.length} members`);
          // Upload avatar if one was picked
          if (this._pendingGroupAvatar) {
            try {
              const { buffer, filename, mimeType } = this._pendingGroupAvatar;
              const uploaded = await apiClient.uploadAttachment(conv.id, buffer, filename, mimeType);
              await apiClient.updateGroup(conv.id, undefined, uploaded.url);
              log(`[Explore/CreateGroup] avatar uploaded: ${uploaded.url}`);
            } catch (avatarErr) {
              log(`[Explore/CreateGroup] avatar upload failed (group created ok): ${avatarErr}`, "warn");
            }
            this._pendingGroupAvatar = undefined;
          }
          await this.navigateToChat(conv.id);
        } catch (err: unknown) {
          const axiosErr = err as { response?: { status?: number; data?: { error?: { message?: string } } }; message?: string };
          const beMsg = axiosErr.response?.data?.error?.message;
          log(`Failed to create group: ${axiosErr.response?.status} ${beMsg || axiosErr.message}`, "error");
          vscode.window.showErrorMessage(beMsg || "Failed to create group");
        }
        break;
      }

      case "fetchMutualFriendsFast": {
        // Fast path: skip syncGitHubFollows, use cached friends
        let fastFriends: { login: string; name: string; avatar_url: string }[] = [];
        try {
          const friendsData = await apiClient.getMyFriends(false);
          fastFriends = friendsData.mutual
            .filter((f) => f.onGitchat)
            .map((f) => ({ login: f.login, name: f.name || f.login, avatar_url: f.avatarUrl || "" }));
        } catch (err) {
          log(`[Explore/EditMembers] getMyFriends failed: ${err}`, "warn");
        }
        this.view?.webview.postMessage({ type: "mutualFriendsData", mutualFriends: fastFriends });
        break;
      }
      case "fetchMutualFriends": {
        let mutualFriends: { login: string; name: string; avatar_url: string }[] = [];
        try {
          // Sync GitHub follows first so BE has latest follow graph
          try {
            const sync = await apiClient.syncGitHubFollows();
            log(`[Explore/CreateGroup] sync result: following=${sync.imported_following}, followers=${sync.imported_followers}, mutual=${sync.mutual}`);
          } catch (syncErr) {
            log(`[Explore/CreateGroup] sync failed (continuing): ${syncErr}`, "warn");
          }
          const friendsData = await apiClient.getMyFriends(true);
          log(`[Explore/CreateGroup] getMyFriends raw: mutual=${friendsData.mutual?.length}, onGitchat=${friendsData.mutual?.filter((f) => f.onGitchat).length}`);
          mutualFriends = friendsData.mutual
            .filter((f) => f.onGitchat)
            .map((f) => ({ login: f.login, name: f.name || f.login, avatar_url: f.avatarUrl || "" }));
          log(`[Explore/CreateGroup] sending ${mutualFriends.length} friends: ${mutualFriends.map((f) => f.login).join(", ")}`);
        } catch (err) {
          log(`[Explore/Chat] getMyFriends failed: ${err}`, "warn");
        }
        this.view?.webview.postMessage({ type: "mutualFriendsData", mutualFriends });
        break;
      }

      case "chatPin":
        try { await apiClient.pinConversation(p!.conversationId); this.fetchChatDataDev(); } catch { /* ignore */ }
        break;
      case "chatUnpin":
        try { await apiClient.unpinConversation(p!.conversationId); this.fetchChatDataDev(); } catch { /* ignore */ }
        break;
      case "chatMarkRead":
        try { await apiClient.markConversationRead(p!.conversationId); this.fetchChatDataDev(); import("../statusbar").then(m => m.fetchCounts()).catch(() => {}); } catch { /* ignore */ }
        break;

      case "profileCard:fetch": {
        const username = (msg.payload as { username: string }).username;
        try {
          // Short-circuit from host-side cache if fresh — protects BE
          // from hover storms when the user browses many avatars quickly.
          const cached = this._profileCache.get(username);
          if (cached && Date.now() - cached.fetchedAt < ExploreWebviewProvider.PROFILE_CACHE_TTL_MS) {
            this.view?.webview.postMessage({ type: "profileCardData", payload: cached.data });
            break;
          }

          // BE wraps profile under { profile, repos } — unwrap like ProfilePanel does.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const rawResp = (await apiClient.getUserProfile(username)) as any;
          const profile: UserProfile = rawResp.profile ?? rawResp;
          if (!profile.top_repos && rawResp.repos) { profile.top_repos = rawResp.repos; }

          // Enrichment data (mutual friends/groups) is nice-to-have — isolate
          // failures so the profile still loads even if /following or starred
          // endpoints are down.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let myFollowing: any[] = [];
          try { myFollowing = await apiClient.getFollowing(1, 100); }
          catch (e) { log(`[Explore] profileCard: getFollowing failed (non-fatal): ${e}`, "warn"); }

          const myLogin = authManager.login ?? "";
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let myStarred: any[] = [];
          try { myStarred = await getUserStarred(myLogin); }
          catch (e) { log(`[Explore] profileCard: getUserStarred failed (non-fatal): ${e}`, "warn"); }

          const enriched = await enrichProfile(profile, myLogin, {
            myFollowing,
            myStarred,
          });
          this._profileCache.set(username, { data: enriched, fetchedAt: Date.now() });
          this._saveProfileCache();
          this.view?.webview.postMessage({ type: "profileCardData", payload: enriched });
        } catch (err) {
          log(`[Explore] profileCard fetch failed for ${username}: ${err}`, "warn");
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const anyErr = err as any;
          const status = anyErr?.response?.status;
          const beMsg = anyErr?.response?.data?.message || anyErr?.message || String(err);
          const surfaced = status ? `${status} — ${beMsg}` : beMsg;
          // username is required — without it, the client can't clear its
          // _inflight dedupe set and subsequent hovers silently no-op.
          this.view?.webview.postMessage({
            type: "profileCardError",
            username,
            message: `Profile load failed: ${surfaced}`,
          });
        }
        break;
      }

      case "follow":
      case "followUser": {
        const loginVal = (msg.payload as { login?: string } | undefined)?.login;
        if (!loginVal) { break; }
        const login = loginVal;
        try {
          await apiClient.followUser(login);
          fireFollowChanged(login, true);
          this._profileCache.delete(login);
          this._profileCache.delete(authManager.login ?? "");
          this._saveProfileCache();
          // (no direct postMessage here — subscriber handles it)
        } catch (err) {
          this.view?.webview.postMessage({ type: "followUpdate", login, following: false }); // revert
          await this.surfaceFollowError(err, "follow", login);
        }
        break;
      }

      case "unfollow": {
        const loginVal = (msg.payload as { login?: string } | undefined)?.login;
        if (!loginVal) { break; }
        const login = loginVal;
        try {
          await apiClient.unfollowUser(login);
          fireFollowChanged(login, false);
          this._profileCache.delete(login);
          this._profileCache.delete(authManager.login ?? "");
          this._saveProfileCache();
          // (no direct postMessage here — subscriber handles it)
        } catch (err) {
          this.view?.webview.postMessage({ type: "followUpdate", login, following: true }); // revert
          await this.surfaceFollowError(err, "unfollow", login);
        }
        break;
      }

      case "profileCard:follow": {
        const username = (msg.payload as { username: string }).username;
        try {
          await apiClient.followUser(username);
          fireFollowChanged(username, true);
          // Stale: target's follow_status.following changed, and my own
          // follow-list changed (affects mutual computations).
          this._profileCache.delete(username);
          this._profileCache.delete(authManager.login ?? "");
          this._saveProfileCache();
          this.view?.webview.postMessage({
            type: "profileCardActionResult",
            action: "follow",
            success: true,
            username,
          });
        } catch (err) {
          log(`[Explore] profileCard follow failed for ${username}: ${err}`, "warn");
          await this.surfaceFollowError(err, "follow", username);
          this.view?.webview.postMessage({
            type: "profileCardActionResult",
            action: "follow",
            success: false,
            username,
          });
        }
        break;
      }

      case "profileCard:unfollow": {
        const username = (msg.payload as { username: string }).username;
        try {
          await apiClient.unfollowUser(username);
          fireFollowChanged(username, false);
          this._profileCache.delete(username);
          this._profileCache.delete(authManager.login ?? "");
          this._saveProfileCache();
          this.view?.webview.postMessage({
            type: "profileCardActionResult",
            action: "unfollow",
            success: true,
            username,
          });
        } catch (err) {
          log(`[Explore] profileCard unfollow failed for ${username}: ${err}`, "warn");
          await this.surfaceFollowError(err, "unfollow", username);
          this.view?.webview.postMessage({
            type: "profileCardActionResult",
            action: "unfollow",
            success: false,
            username,
          });
        }
        break;
      }

      case "profileCard:message": {
        const username = (msg.payload as { username: string }).username;
        vscode.commands.executeCommand("gitchat.messageUser", username);
        break;
      }

      case "discover:wave": {
        const login = (msg.payload as { login: string }).login;
        try {
          await apiClient.wave(login);
          this.view?.webview.postMessage({ type: "discoverWaveResult", login, success: true });
          vscode.commands.executeCommand("gitchat.messageUser", login);
        } catch (err) {
          const e = err as { response?: { status?: number; data?: unknown; config?: { url?: string; method?: string } }; message?: string };
          const status = e?.response?.status;
          const body = e?.response?.data as { error?: string; message?: string | string[]; code?: string } | undefined;
          const url = e?.response?.config?.url;
          const method = e?.response?.config?.method;
          log(`[wave] ${method?.toUpperCase()} ${url} → status=${status} body=${JSON.stringify(body)?.slice(0, 400)} msg=${e?.message}`, "warn");
          const errObj = typeof body?.error === "object" && body?.error !== null ? body.error as Record<string, unknown> : null;
          const rawMsg = errObj?.message || body?.message || errObj?.code || body?.code || "";
          const beMsg = typeof rawMsg === "string" ? rawMsg : Array.isArray(rawMsg) ? rawMsg.join("; ") : String(rawMsg);
          const beCode = (errObj?.code ?? body?.code ?? "") as string;
          const terminalCodes = /already[_ ]?waved|mutual|blocked|self/i;
          const isTerminal = (terminalCodes.test(beMsg) || terminalCodes.test(beCode))
            && (status === 400 || status === 403 || status === 409);
          if (isTerminal) {
            // already_waved / mutual / blocked / self — treat as success from sender POV
            this.view?.webview.postMessage({ type: "discoverWaveResult", login, success: true });
          } else {
            this.view?.webview.postMessage({ type: "discoverWaveResult", login, success: false });
            const detail = beMsg ? `: ${beMsg}` : "";
            vscode.window.showErrorMessage(`Failed to wave at @${login} (${status ?? "network"})${detail}`);
          }
        }
        break;
      }

      case "profileCard:invite": {
        const username = (msg.payload as { username: string }).username;
        const url = `${process.env.GITCHAT_WEBAPP_URL}/@${username}`;
        await vscode.env.clipboard.writeText(url);
        vscode.window.showInformationMessage(`Invite link copied for @${username}`);
        break;
      }

      case "profileCard:openGitHub": {
        const username = (msg.payload as { username: string }).username;
        vscode.env.openExternal(vscode.Uri.parse(`https://github.com/${username}`));
        break;
      }

      case "profileCard:openRepo": {
        const { owner, name } = msg.payload as { owner: string; name: string };
        vscode.env.openExternal(vscode.Uri.parse(`https://github.com/${owner}/${name}`));
        break;
      }

      case "profileCard:signOut":
        vscode.commands.executeCommand("gitchat.signOut");
        break;

      case "onboardingComplete":
        if (this._context) {
          const login = authManager.login;
          if (login) {
            this._context.globalState.update(`gitchat.hasCompletedOnboarding.${login}`, true);
            log(`[Onboarding] completed for ${login}`);
          }
        }
        break;

      case "toast:ready":
        this._webviewRenderer?.setReady(true);
        break;

      case "toast:action": {
        const payload = msg as unknown as {
          id: string;
          action: import("../notifications/toast-renderer").ToastAction;
        };
        if (payload?.id && payload?.action) {
          this._webviewRenderer?.handleAction(payload.id, payload.action);
        }
        break;
      }
    }
  }

  private _loadOnlineNowViaRest(): void {
    apiClient.getOnlineNow(20).then((users) => {
      if (!this.view?.webview) return;
      this.view.webview.postMessage({ type: "discoverOnlineNowSnapshot", payload: { users } });
    }).catch((err) => {
      log(`[Explore] REST fallback for online-now failed: ${err}`, "warn");
    });
  }

  dispose(): void {
    this._followChangeSub?.dispose();
    this._onlineNowSnapSub?.dispose();
    this._onlineNowDeltaSub?.dispose();
    this._configChangeSub?.dispose();
    if (this._toastVisTimer) { clearTimeout(this._toastVisTimer); this._toastVisTimer = undefined; }
    // Defensive: ensure WS subscription cleared on view dispose
    try { realtimeClient.unsubscribeDiscoverOnlineNow(); } catch { /* ignore */ }
  }

  // ===================== HTML TEMPLATE =====================
  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const sharedCss = getUri(webview, this.extensionUri, ["media", "webview", "shared.css"]);
    const codiconCss = getUri(webview, this.extensionUri, ["media", "webview", "codicon.css"]);
    const profileScreenCss = getUri(webview, this.extensionUri, ["media", "webview", "profile-screen.css"]);
    const profileCardCss = getUri(webview, this.extensionUri, ["media", "webview", "profile-card.css"]);
    const css = getUri(webview, this.extensionUri, ["media", "webview", "explore.css"]);
    const chatCss = getUri(webview, this.extensionUri, ["media", "webview", "sidebar-chat.css"]);
    const notifCss = getUri(webview, this.extensionUri, ["media", "webview", "notifications-pane.css"]);
    const toastStackCssUri = getUri(webview, this.extensionUri, ["media", "webview", "toast-stack.css"]);
    const topicListCss = getUri(webview, this.extensionUri, ["media", "webview", "topic-list.css"]);
    const sharedJs = getUri(webview, this.extensionUri, ["media", "webview", "shared.js"]);
    const profileScreenJs = getUri(webview, this.extensionUri, ["media", "webview", "profile-screen.js"]);
    const profileCardJs = getUri(webview, this.extensionUri, ["media", "webview", "profile-card.js"]);
    const topicListJs = getUri(webview, this.extensionUri, ["media", "webview", "topic-list.js"]);
    const chatJs = getUri(webview, this.extensionUri, ["media", "webview", "sidebar-chat.js"]);
    const js = getUri(webview, this.extensionUri, ["media", "webview", "explore.js"]);
    const notifJs = getUri(webview, this.extensionUri, ["media", "webview", "notifications-pane.js"]);
    const toastStackJsUri = getUri(webview, this.extensionUri, ["media", "webview", "toast-stack.js"]);

    return `<!DOCTYPE html>
<html><head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} https: data: blob:;">
  <link rel="stylesheet" href="${sharedCss}">
  <link rel="stylesheet" href="${profileScreenCss}">
  <link rel="stylesheet" href="${profileCardCss}">
  <link rel="stylesheet" href="${codiconCss}">
  <link rel="stylesheet" href="${css}">
  <link rel="stylesheet" href="${chatCss}">
  <link rel="stylesheet" href="${notifCss}">
  <link rel="stylesheet" href="${toastStackCssUri}">
  <link rel="stylesheet" href="${topicListCss}">
</head><body>

<!-- New Chat Dropdown -->
<div id="new-chat-menu" class="gs-dropdown" style="display:none;right:8px;top:0;min-width:auto">
  <button class="gs-dropdown-item" id="new-chat-dm"><span class="codicon codicon-comment-discussion"></span> New Message</button>
  <button class="gs-dropdown-item" id="new-chat-group"><span class="codicon codicon-organization"></span> New Group</button>
</div>

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
  <button class="gs-dropdown-item" id="user-menu-settings"><span class="codicon codicon-settings-gear"></span> Settings</button>
  <button class="gs-dropdown-item gs-dropdown-item--danger" id="user-menu-signout"><span class="codicon codicon-sign-out"></span> Sign Out</button>
</div>

<!-- Settings Sub-Panel -->
<div id="settings-panel" class="gs-dropdown" style="display:none;right:8px;top:0">
  <div class="gs-dropdown-header" style="cursor:pointer" id="settings-back">
    <span class="codicon codicon-arrow-left"></span>
    <span style="font-weight:600;margin-left:4px;">Settings</span>
  </div>
  <div class="gs-dropdown-divider"></div>
  <label class="gs-dropdown-item gs-toggle-item">
    <span>Message notifications</span>
    <input type="checkbox" id="chat-setting-notifications" checked>
  </label>
  <label class="gs-dropdown-item gs-toggle-item">
    <span>Message sound</span>
    <input type="checkbox" id="chat-setting-sound">
  </label>
  <div class="gs-dropdown-divider"></div>
  <div class="gs-dropdown-item" style="font-weight:600;font-size:11px;color:var(--gs-muted);text-transform:uppercase;letter-spacing:0.5px;cursor:default;">Notifications</div>
  <label class="gs-dropdown-item gs-toggle-item" title="Pause all in-app notifications">
    <span>Do not disturb</span>
    <input type="checkbox" id="setting-noti-dnd">
  </label>
  <label class="gs-dropdown-item gs-toggle-item">
    <span>Mentions</span>
    <input type="checkbox" id="setting-noti-mention" checked>
  </label>
  <label class="gs-dropdown-item gs-toggle-item">
    <span>Waves</span>
    <input type="checkbox" id="setting-noti-wave" checked>
  </label>
  <label class="gs-dropdown-item gs-toggle-item">
    <span>New followers</span>
    <input type="checkbox" id="setting-noti-follow" checked>
  </label>
  <label class="gs-dropdown-item gs-toggle-item">
    <span>Repo activity</span>
    <input type="checkbox" id="setting-noti-repo" checked>
  </label>
  <label class="gs-dropdown-item gs-toggle-item" id="chat-setting-debug-row" style="display:none">
    <span>Debug logs</span>
    <input type="checkbox" id="chat-setting-debug">
  </label>
</div>

<!-- Main Tabs: Chat | Friends | Discover -->
<div class="gs-main-tabs" id="gs-main-tabs">
  <button class="gs-main-tab active" data-tab="chat">Chat <span id="chat-main-badge" class="tab-badge" style="display:none"></span></button>
  <button class="gs-main-tab" data-tab="friends">Friends</button>
  <button class="gs-main-tab" data-tab="discover">Discover</button>
  <button class="gs-main-tab" data-tab="notifications">Noti <span id="notif-tab-badge" class="tab-badge" data-count="0" style="display:none"></span></button>
</div>

<!-- Search bar (below tabs) -->
<div class="gs-search-bar" id="gs-search-bar">
  <div class="gs-search-input-wrap">
    <span class="codicon codicon-search gs-search-icon"></span>
    <input type="text" class="gs-input gs-search-has-icon" id="gs-global-search" placeholder="Search messages..." autocomplete="off">
    <button class="gs-search-clear codicon codicon-close" id="gs-search-clear" style="display:none" title="Clear"></button>
  </div>
</div>

<!-- Nav Container: slides between list and chat views -->
<div class="gs-nav-container" id="gs-nav">
  <!-- Chat List (inbox/friends/channels) -->
  <div class="gs-chat-list">
    <div id="chat-filter-bar" class="gs-filter-bar" style="display:flex" role="radiogroup" aria-label="Filter conversations">
      <button class="gs-chip active" data-filter="all" role="radio" aria-checked="true">All <span class="gs-chip-count" id="chat-count-all"></span></button>
      <button class="gs-chip" data-filter="dm" role="radio" aria-checked="false">DM <span class="gs-chip-count" id="chat-count-dm"></span></button>
      <button class="gs-chip" data-filter="group" role="radio" aria-checked="false">Groups <span class="gs-chip-count" id="chat-count-group"></span></button>
      <button class="gs-chip" data-filter="community" role="radio" aria-checked="false">Communities <span class="gs-chip-count" id="chat-count-community"></span></button>
      <button class="gs-chip" data-filter="team" role="radio" aria-checked="false">Teams <span class="gs-chip-count" id="chat-count-team"></span></button>
    </div>
    <div id="chat-content"></div>
    <div id="chat-empty" class="gs-empty" style="display:none"></div>
    <div id="friends-content" style="display:none; flex-direction:column; height:100%; overflow:hidden;"></div>
    <div id="discover-content" style="display:none; flex-direction:column; height:100%; overflow:hidden;"></div>
    <div id="chat-pane-channels" style="display:none">
      <div id="channels-list" class="channels-list"></div>
      <div id="channels-empty" class="gs-empty" style="display:none">
        <span class="codicon codicon-megaphone"></span>
        <p>No channel subscriptions yet</p>
      </div>
    </div>

    <!-- WP10 Notifications tab pane — rendered by notifications-pane.js -->
    <div id="notif-pane" class="notif-pane" style="display:none">
      <div id="notif-p-body" class="notif-p-body"></div>
    </div>
  </div>

  <!-- Chat View (populated by sidebar-chat.js) -->
  <div class="gs-chat-view" id="gs-chat-view"></div>
</div>

<!-- Search Home (hidden shell — referenced by legacy explore.js handlers) -->
<div id="search-home" class="search-home" style="display:none">
  <div id="search-home-recent" class="search-home-section" style="display:none">
    <div class="search-home-header">
      <span class="search-home-title">Recent Searches</span>
      <button class="gs-btn-icon" id="search-clear-recent" title="Clear recent"><span class="codicon codicon-trash"></span></button>
    </div>
    <div id="search-home-recent-list"></div>
  </div>
  <div id="search-home-trending-repos" class="search-home-section" style="display:none">
    <div class="search-home-header"><span class="search-home-title">Trending Repos</span></div>
    <div id="search-home-trending-repos-list"></div>
  </div>
  <div id="search-home-trending-people" class="search-home-section" style="display:none">
    <div class="search-home-header"><span class="search-home-title">Trending People</span></div>
    <div id="search-home-trending-people-list"></div>
  </div>
</div>

<!-- Search Results (hidden shell — referenced by legacy explore.js handlers) -->
<div id="search-results" class="search-results" style="display:none">
  <div class="search-section" id="search-repos-section">
    <div id="search-repos-list" class="gs-accordion-body"></div>
  </div>
  <div class="search-section" id="search-people-section">
    <div id="search-people-list" class="gs-accordion-body"></div>
  </div>
  <div id="search-empty" class="gs-empty" style="display:none"></div>
</div>

<script nonce="${nonce}" src="${sharedJs}"></script>
<script nonce="${nonce}" src="${profileScreenJs}"></script>
<script nonce="${nonce}" src="${profileCardJs}"></script>
<script nonce="${nonce}" src="${topicListJs}"></script>
<script nonce="${nonce}" src="${chatJs}"></script>
<script nonce="${nonce}" src="${js}"></script>
<script nonce="${nonce}" src="${notifJs}"></script>
<script nonce="${nonce}" src="${toastStackJsUri}"></script>
</body></html>`;
  }
}

// ===================== MODULE EXPORT =====================
export let exploreWebviewProvider: ExploreWebviewProvider;

export const exploreWebviewModule: ExtensionModule = {
  id: "explore",
  activate(context) {
    exploreWebviewProvider = new ExploreWebviewProvider(context.extensionUri);
    exploreWebviewProvider.setContext(context);
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(ExploreWebviewProvider.viewType, exploreWebviewProvider)
    );

    // Auth change → refresh all + WP3 onboarding / tab reset
    authManager.onDidChangeAuth((signedIn) => {
      exploreWebviewProvider.refreshAll();
      if (!signedIn) {
        // Logout: always reset to Chat tab
        exploreWebviewProvider.switchToChat();
        return;
      }
      if (authManager.login) {
        if (!exploreWebviewProvider.hasCompletedOnboarding(authManager.login)) {
          exploreWebviewProvider.sendOnboarding();
        } else {
          exploreWebviewProvider.switchToChat();
        }
      }
    });

    // Notification store changes → push fresh list to the webview
    context.subscriptions.push(
      notificationStore.onDidChange(() => exploreWebviewProvider.refreshNotifications()),
    );

    // Realtime events → chat list updates
    realtimeClient.onNewMessage((message) => {
      exploreWebviewProvider.debouncedRefreshChat();
      // Issue #51: keep the persistent cache in sync with realtime deltas
      // so the next SWR open reflects messages that arrived while the
      // conversation was closed. No-op when the conversation was never
      // cached (user hasn't opened it yet).
      const convId = (message as unknown as Record<string, string>).conversation_id;
      if (convId) {
        try { messageCache.appendRealtime(convId, message); } catch { /* ignore */ }
      }
      // Patch the inbox row in-place immediately from the realtime payload.
      // This avoids the 500ms debounce + dependency on BE `last_message_text`
      // being correct on the next getConversations() refetch — tester reported
      // rows showing "now" + unread badge but empty preview until tab switch.
      const m = message as unknown as Record<string, unknown>;
      const senderLogin = (m.sender as string) ?? (m.sender_login as string) ?? "";
      if (convId) {
        exploreWebviewProvider.postToWebview({
          type: "inboxPatch",
          payload: {
            conversationId: convId,
            senderLogin,
            preview: (m.content as string) ?? "",
            createdAt: (m.created_at as string) ?? new Date().toISOString(),
            isFromSelf: senderLogin === authManager.login,
            messageType: (m.type as string) ?? "user",
            attachmentUrl: (m.attachment_url as string) ?? null,
          },
        });
      }
      // Route to sidebar chat if active — skip when inside a topic because
      // onTopicMessage already handles rendering. BE fires both message:sent
      // and topic:message for topic messages, causing duplicates otherwise.
      if (exploreWebviewProvider._activeChatConvId && convId === exploreWebviewProvider._activeChatConvId
        && !exploreWebviewProvider._activeTopicId) {
        const msgId = (message as unknown as Record<string, string>).id;
        if (msgId && exploreWebviewProvider._chatRecentlySentIds.has(msgId)) {
          exploreWebviewProvider._chatRecentlySentIds.delete(msgId);
        } else {
          exploreWebviewProvider.postToWebview({ type: "chat:newMessage", payload: message });
        }
      }
    });
    presenceStore.onChange(({ login, entry }) => {
      exploreWebviewProvider.debouncedRefreshChat();
      if (exploreWebviewProvider._activeChatConvId) {
        exploreWebviewProvider.postToWebview({
          type: "chat:presence",
          payload: { user: login, online: entry.online, lastSeenAt: entry.lastSeenAt },
        });
      }
    });
    realtimeClient.onConversationUpdated(() => exploreWebviewProvider.debouncedRefreshChat());
    realtimeClient.onGroupDisbanded((convId) => {
      if (exploreWebviewProvider._activeChatConvId === convId) {
        exploreWebviewProvider.postToWebview({ type: "chat:groupDisbanded" });
      }
      exploreWebviewProvider.postToWebview({ type: "removeConversation", conversationId: convId });
    });
    realtimeClient.onTyping((data) => {
      exploreWebviewProvider.showTyping(data.conversationId, data.user);
      if (exploreWebviewProvider._activeChatConvId && data.user !== authManager.login &&
        (!data.conversationId || data.conversationId === exploreWebviewProvider._activeChatConvId)) {
        exploreWebviewProvider.postToWebview({ type: "chat:typing", payload: { user: data.user } });
      }
    });
    realtimeClient.onReactionUpdated((data) => {
      if (data.conversationId === exploreWebviewProvider._activeChatConvId) {
        exploreWebviewProvider.postToWebview({ type: "chat:reactionUpdated", payload: data });
      }
    });
    realtimeClient.onConversationRead((data) => {
      if (data.conversationId === exploreWebviewProvider._activeChatConvId) {
        exploreWebviewProvider.postToWebview({ type: "chat:conversationRead", payload: data });
      }
    });
    realtimeClient.onMessagePinned((data) => {
      if (data.conversationId === exploreWebviewProvider._activeChatConvId) {
        exploreWebviewProvider.postToWebview({ type: "chat:wsPinned", conversationId: data.conversationId, pinnedBy: data.pinnedBy, message: data.message });
      }
    });
    realtimeClient.onMessageUnpinned((data) => {
      if (data.conversationId === exploreWebviewProvider._activeChatConvId) {
        exploreWebviewProvider.postToWebview({ type: "chat:wsUnpinned", conversationId: data.conversationId, messageId: data.messageId, unpinnedBy: data.unpinnedBy });
      }
    });
    realtimeClient.onMentionNew((data) => {
      if (data.conversationId === exploreWebviewProvider._activeChatConvId) {
        exploreWebviewProvider.postToWebview({ type: "chat:mentionNew", messageId: data.messageId });
      }
    });
    realtimeClient.onReactionNew((data) => {
      if (data.conversationId === exploreWebviewProvider._activeChatConvId) {
        exploreWebviewProvider.postToWebview({ type: "chat:reactionNew", messageId: data.messageId });
      }
    });
    const refreshSidebarMembers = async (conversationId: string) => {
      if (exploreWebviewProvider._activeChatConvId !== conversationId) { return; }
      try {
        const members = await apiClient.getGroupMembers(conversationId);
        exploreWebviewProvider.postToWebview({ type: "chat:membersUpdated", payload: { members, count: members.length } });
      } catch (err) {
        log(`[Explore] refreshSidebarMembers failed: ${err}`, "warn");
      }
    };
    realtimeClient.onMemberAdded((data) => { void refreshSidebarMembers(data.conversationId); });
    realtimeClient.onMemberLeft((data) => { void refreshSidebarMembers(data.conversationId); });

    // Topic realtime events
    realtimeClient.onTopicCreated((data) => {
      exploreWebviewProvider.postToWebview({ type: "topic:created", topic: data.topic, conversationId: data.conversationId });
      // Bug 4: auto-reload topic list if viewing this parent's topics so the
      // new row appears without a manual refresh.
      if (exploreWebviewProvider["_activeTopicParentConvId"] === data.conversationId) {
        void apiClient.getTopics(data.conversationId)
          .then((topics) => exploreWebviewProvider.postToWebview({ type: "topic:listData", topics, conversationId: data.conversationId }))
          .catch((err: unknown) => log(`[Topics] onTopicCreated reload failed: ${String(err)}`, "warn"));
      }
    });
    realtimeClient.onTopicMessage((data) => {
      // Bug 1: keep message cache in sync so reopening the topic after send
      // renders the newly-sent message from cache instead of showing empty
      // history while the network fetch is in-flight. Cache is keyed on the
      // topic's own conversation id (topic is a row in message_conversations).
      const topicId = data.topicId;
      if (topicId) {
        try { messageCache.appendRealtime(topicId, data.message); } catch { /* ignore */ }
      }
      if (exploreWebviewProvider._activeTopicId === data.topicId) {
        exploreWebviewProvider.postToWebview({ type: "chat:newMessage", payload: data.message });
      } else {
        // Bug 5: topic not active — nudge webview to increment per-topic unread
        // badge so sidebar counter bumps without waiting for the next REST refresh.
        const sender = ((data.message as unknown) as Record<string, string>).sender_login
          ?? ((data.message as unknown) as Record<string, string>).senderLogin;
        if (sender && sender !== authManager.login) {
          exploreWebviewProvider.postToWebview({
            type: "topic:unreadUpdated",
            topicId: data.topicId,
            conversationId: data.conversationId,
            incrementBy: 1,
          });
        }
      }
      exploreWebviewProvider.debouncedRefreshChat();
    });
    realtimeClient.onTopicUpdated((data) => {
      exploreWebviewProvider.postToWebview({ type: "topic:updated", topicId: data.topicId, name: data.name, iconEmoji: data.iconEmoji, conversationId: data.conversationId });
    });
    realtimeClient.onTopicArchived((data) => {
      exploreWebviewProvider.postToWebview({ type: "topic:archived", topicId: data.topicId, conversationId: data.conversationId });
      if (exploreWebviewProvider._activeTopicId === data.topicId) {
        // Bug 8: clear in-memory topic state so breadcrumb/send path won't
        // reference the archived topic again, and explicitly close the sidebar
        // chat so the user isn't stuck viewing stale messages.
        exploreWebviewProvider["_activeTopicId"] = undefined;
        exploreWebviewProvider["_activeTopicParentConvId"] = undefined;
        exploreWebviewProvider["_activeTopicName"] = undefined;
        exploreWebviewProvider["_activeTopicIcon"] = undefined;
        exploreWebviewProvider.postToWebview({ type: "topic:forceClose", reason: "This topic has been archived" });
        exploreWebviewProvider.postToWebview({ type: "chat:close" });
      }
    });

    // If already signed in, trigger initial refresh
    if (authManager.isSignedIn) { exploreWebviewProvider.refreshAll(); }
  },
  deactivate() {
    exploreWebviewProvider?.dispose();
  },
};
