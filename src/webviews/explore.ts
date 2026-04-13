import * as vscode from "vscode";
import { apiClient, getOtherUser } from "../api";
import { authManager } from "../auth";
import { realtimeClient } from "../realtime";
import { configManager } from "../config";
import { getNonce, getUri, log } from "../utils";
import { fireFollowChanged, onDidChangeFollow } from "../events/follow";
import type { Conversation, ExtensionModule, RepoChannel, TrendingRepo, TrendingPerson, UserRepo, WebviewMessage } from "../types";
import { handleChatMessage, extractPinnedMessages, type ChatContext, type CursorState } from "./chat-handlers";

// Feature flags — hide Feed/Trending tabs during sidebar transition
const SHOW_FEED_TAB = false;
const SHOW_TRENDING_TAB = false;

export class ExploreWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "trending.explore";
  view?: vscode.WebviewView;

  // Chat state
  private _dmConvMap = new Map<string, string>();
  private _mutedConvs = new Set<string>();

  // Sidebar chat state (for embedded chat view) — public for realtime routing
  _activeChatConvId: string | undefined;
  _activeChatRecipient: string | undefined;
  _chatRecentlySentIds = new Set<string>();
  private _chatIsGroup = false;
  private _chatCursorState: CursorState = {
    cursor: undefined, previousCursor: undefined, nextCursor: undefined,
    hasMore: true, hasMoreBefore: true, hasMoreAfter: false,
  };

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
  private _pickId = 5000; // IDs for extension-side file picks

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")],
    };
    webviewView.webview.html = this.getHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage((msg: WebviewMessage) => this.onMessage(msg));

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible && this._activeChatConvId) {
        // Reload chat data when sidebar becomes visible again
        this.loadConversationData(this._activeChatConvId);
      }
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

  // ===================== FILE UPLOAD (BUG 4) =====================
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

  // ===================== DEVELOP: helpers =====================
  postToWebview(msg: unknown): void {
    this.view?.webview.postMessage(msg);
  }

  showSearch(): void {
    this.view?.webview.postMessage({ type: "showSearch" });
  }

  async navigateToChat(conversationId: string, recipientLogin?: string): Promise<void> {
    // Focus the explore view first
    await vscode.commands.executeCommand("trending.explore.focus");
    // Store active chat
    this._activeChatConvId = conversationId;
    this._activeChatRecipient = recipientLogin;
    // Tell webview to open chat view
    this.view?.webview.postMessage({ type: "chat:navigate", conversationId, recipientLogin });
    // Load conversation data for sidebar-chat
    await this.loadConversationData(conversationId);
  }

  async loadConversationData(conversationId: string): Promise<void> {
    if (!this.view) { return; }
    try {
      const result = await apiClient.getMessages(conversationId, 1);
      this._chatCursorState = {
        cursor: result.cursor,
        previousCursor: undefined,
        nextCursor: undefined,
        hasMore: result.hasMore,
        hasMoreBefore: result.hasMore,
        hasMoreAfter: false,
      };
      const currentUser = authManager.login ?? "me";

      // Fetch conversation metadata
      let recipientLogin = this._activeChatRecipient;
      let conv: Record<string, unknown> | undefined;
      try {
        const conversations = await apiClient.getConversations();
        conv = conversations.find((c) => c.id === conversationId) as Record<string, unknown> | undefined;
        if (!recipientLogin) {
          const otherUser = conv?.other_user as { login: string } | undefined;
          recipientLogin = otherUser?.login
            || (conv?.participants as { login: string }[] | undefined)?.find((p) => p.login !== currentUser)?.login;
        }
      } catch { /* ignore */ }

      // Detect group
      let isGroup = conv?.type === "group" || conv?.is_group === true || ((conv?.participants as unknown[] | undefined)?.length ?? 0) > 2;
      const groupTitle = isGroup ? ((conv?.group_name as string) || "Group Chat") : undefined;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let groupMembers: any[] = [];
      if (!isGroup && !conv) {
        try {
          groupMembers = await apiClient.getGroupMembers(conversationId);
          if (groupMembers.length > 2) { isGroup = true; }
        } catch { /* ignore */ }
      }
      this._chatIsGroup = isGroup;
      const isPinned = !!(conv?.pinned_at || conv?.pinned);

      recipientLogin = recipientLogin || "Unknown";

      if (isGroup && groupMembers.length === 0) {
        try { groupMembers = await apiClient.getGroupMembers(conversationId); } catch { /* ignore */ }
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
      if (unreadMentionsCount > 0) {
        try { mentionIds = await apiClient.getUnreadMentions(conversationId); } catch { /* ignore */ }
      }
      if (unreadReactionsCount > 0) {
        try { reactionIds = await apiClient.getUnreadReactions(conversationId); } catch { /* ignore */ }
      }

      // Join realtime room
      realtimeClient.joinConversation(conversationId);

      this.postToWebview({
        type: "chat:init",
        payload: {
          currentUser,
          participant: isGroup
            ? { login: groupTitle, name: groupTitle, online: false, avatar_url: (conv as Record<string, unknown>)?.["avatar_url"] as string || "" }
            : { login: recipientLogin, name: recipientLogin, online: false, avatar_url: `https://github.com/${recipientLogin}.png?size=64` },
          isGroup,
          isGroupCreator: isGroup && (conv?.["created_by"] as string | undefined) === authManager.login,
          participants: isGroup ? conv?.participants : undefined,
          messages: result.messages,
          hasMore: result.hasMore,
          otherReadAt: result.otherReadAt,
          friends: [],
          groupMembers,
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
      import("../statusbar").then(m => m.fetchCounts()).catch(() => {});
    } catch (err) {
      log(`[Explore/SidebarChat] loadConversationData failed: ${err}`, "error");
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

    // Route chat: prefixed messages to shared chat handlers
    if (typeof msg.type === "string" && msg.type.startsWith("chat:")) {
      const chatType = msg.type.slice(5); // strip "chat:" prefix

      if (chatType === "open") {
        // Open a conversation in sidebar chat
        const convId = (msg.payload as Record<string, string>)?.conversationId;
        if (convId) {
          this._activeChatConvId = convId;
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

      // BUG 3: Handle reloadConversation before delegating to chat-handlers
      if (chatType === "reloadConversation") {
        if (this._activeChatConvId) {
          await this.loadConversationData(this._activeChatConvId);
        }
        return;
      }

      // BUG 4: Handle pickFile/pickPhoto (not in chat-handlers, only in chat.ts)
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

      // BUG 5: Handle typing emission
      if (chatType === "typing") {
        if (this._activeChatConvId) {
          realtimeClient.emitTyping(this._activeChatConvId);
        }
        return;
      }

      // Delegate to shared handler with chat: stripped type
      if (this._activeChatConvId) {
        const ctx: ChatContext = {
          conversationId: this._activeChatConvId,
          postToWebview: (m) => this.postToWebview(m),
          recentlySentIds: this._chatRecentlySentIds,
          extensionUri: this.extensionUri,
          isGroup: this._chatIsGroup,
          prefixMessages: true, // sidebar uses chat: prefix
          cursorState: this._chatCursorState,
          reloadConversation: () => this.loadConversationData(this._activeChatConvId!),
          disposePanel: () => {
            this._activeChatConvId = undefined;
            this.postToWebview({ type: "chat:closed" });
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
      if (choice?.value === "dm") { vscode.commands.executeCommand("trending.messageUser"); }
      else if (choice?.value === "group") { vscode.commands.executeCommand("trending.createGroup"); }
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
    const chatCss = getUri(webview, this.extensionUri, ["media", "webview", "sidebar-chat.css"]);
    const sharedJs = getUri(webview, this.extensionUri, ["media", "webview", "shared.js"]);
    const chatJs = getUri(webview, this.extensionUri, ["media", "webview", "sidebar-chat.js"]);
    const js = getUri(webview, this.extensionUri, ["media", "webview", "explore.js"]);

    // Feature flag conditionals for Feed/Trending HTML
    const feedHtml = SHOW_FEED_TAB ? `
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
</div>` : "";

    const trendingHtml = SHOW_TRENDING_TAB ? `
<!-- ===================== TRENDING PANE ===================== -->
<div id="pane-trending" class="tab-pane">
  <div class="gs-sub-header">
    <div class="gs-sub-tabs">
      <button class="gs-sub-tab active" data-trending-tab="repos">Repos</button>
      <button class="gs-sub-tab" data-trending-tab="people">People</button>
    </div>
    <button class="gs-btn-icon" id="trending-refresh" title="Refresh"><span class="codicon codicon-refresh"></span></button>
  </div>
  <div id="trending-sub-repos" class="trending-sub-pane">
    <div class="ex-search-wrap">
      <div class="gs-search-input-wrap">
        <span class="codicon codicon-search gs-search-icon"></span>
        <input id="repos-search" class="ex-search-input gs-search-has-icon" type="text" placeholder="Search repos…" autocomplete="off" spellcheck="false">
        <button class="gs-search-clear codicon codicon-close" id="repos-search-clear" style="display:none" title="Clear"></button>
      </div>
    </div>
    <div id="repos-ranges" class="gs-filter-bar">
      <button class="gs-chip" data-range="daily">Today</button>
      <button class="gs-chip active" data-range="weekly">Week</button>
      <button class="gs-chip" data-range="monthly">Month</button>
    </div>
    <div id="repos-list"></div>
  </div>
  <div id="trending-sub-people" class="trending-sub-pane" style="display:none">
    <div class="ex-search-wrap">
      <div class="gs-search-input-wrap">
        <span class="codicon codicon-search gs-search-icon"></span>
        <input id="people-search" class="ex-search-input gs-search-has-icon" type="text" placeholder="Search people…" autocomplete="off" spellcheck="false">
        <button class="gs-search-clear codicon codicon-close" id="people-search-clear" style="display:none" title="Clear"></button>
      </div>
    </div>
    <div id="people-ranges" class="gs-filter-bar">
      <button class="gs-chip" data-people-range="daily">Today</button>
      <button class="gs-chip active" data-people-range="weekly">Week</button>
      <button class="gs-chip" data-people-range="monthly">Month</button>
    </div>
    <div id="people-list"><div class="ex-loading">Loading…</div></div>
  </div>
</div>` : "";

    return `<!DOCTYPE html>
<html><head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} https: data:;">
  <link rel="stylesheet" href="${sharedCss}">
  <link rel="stylesheet" href="${codiconCss}">
  <link rel="stylesheet" href="${css}">
  <link rel="stylesheet" href="${chatCss}">
</head><body>

<!-- New Chat Dropdown -->
<div id="new-chat-menu" class="gs-dropdown" style="display:none;right:40px;top:36px;z-index:100;">
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
  <label class="gs-dropdown-item gs-toggle-item" id="chat-setting-debug-row" style="display:none">
    <span>Debug logs</span>
    <input type="checkbox" id="chat-setting-debug">
  </label>
</div>

<!-- Main Tabs: Inbox | Friends | Channels -->
<!-- Tabs -->
<div class="gs-main-tabs" id="gs-main-tabs">
  <button class="gs-main-tab active" data-tab="inbox">Inbox <span id="chat-main-badge" class="tab-badge" style="display:none"></span></button>
  <button class="gs-main-tab" data-tab="friends">Friends</button>
  <button class="gs-main-tab" data-tab="channels">Channels</button>
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
    <div id="chat-filter-bar" class="gs-filter-bar" style="display:flex">
      <button class="gs-chip active" data-filter="all">All <span class="gs-chip-count" id="chat-count-all"></span></button>
      <button class="gs-chip" data-filter="direct">Direct <span class="gs-chip-count" id="chat-count-direct"></span></button>
      <button class="gs-chip" data-filter="group">Group <span class="gs-chip-count" id="chat-count-group"></span></button>
      <button class="gs-chip" data-filter="requests">Requests <span class="gs-chip-count" id="chat-count-requests"></span></button>
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

  <!-- Chat View (populated by sidebar-chat.js) -->
  <div class="gs-chat-view" id="gs-chat-view"></div>
</div>

${feedHtml}
${trendingHtml}


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
<script nonce="${nonce}" src="${chatJs}"></script>
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

    // Realtime events → chat list updates
    realtimeClient.onNewMessage((message) => {
      exploreWebviewProvider.debouncedRefreshChat();
      // Route to sidebar chat if active
      if (exploreWebviewProvider._activeChatConvId && (message as unknown as Record<string, string>).conversation_id === exploreWebviewProvider._activeChatConvId) {
        const msgId = (message as unknown as Record<string, string>).id;
        if (msgId && exploreWebviewProvider._chatRecentlySentIds.has(msgId)) {
          exploreWebviewProvider._chatRecentlySentIds.delete(msgId);
        } else {
          exploreWebviewProvider.postToWebview({ type: "chat:newMessage", payload: message });
        }
      }
    });
    realtimeClient.onPresence((data) => {
      exploreWebviewProvider.debouncedRefreshChat();
      if (exploreWebviewProvider._activeChatConvId) {
        exploreWebviewProvider.postToWebview({ type: "chat:presence", payload: data });
      }
    });
    realtimeClient.onConversationUpdated(() => exploreWebviewProvider.debouncedRefreshChat());
    realtimeClient.onTyping((data) => {
      exploreWebviewProvider.showTyping(data.conversationId, data.user);
      if (exploreWebviewProvider._activeChatConvId && data.user !== authManager.login &&
          (!data.conversationId || data.conversationId === exploreWebviewProvider._activeChatConvId)) {
        exploreWebviewProvider.postToWebview({ type: "chat:typing", payload: { user: data.user } });
      }
    });
    realtimeClient.onReactionUpdated((data) => {
      if (exploreWebviewProvider._activeChatConvId) {
        exploreWebviewProvider.postToWebview({ type: "chat:reactionUpdated", payload: data });
      }
    });
    realtimeClient.onConversationRead((data) => {
      if (exploreWebviewProvider._activeChatConvId) {
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
