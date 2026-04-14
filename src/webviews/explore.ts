import * as vscode from "vscode";
import { apiClient, getOtherUser } from "../api";
import { authManager } from "../auth";
import { realtimeClient } from "../realtime";
import { configManager } from "../config";
import { getNonce, getUri, log } from "../utils";
import type { Conversation, ExtensionModule, RepoChannel, UserProfile, WebviewMessage } from "../types";
import { handleChatMessage, extractPinnedMessages, type ChatContext, type CursorState } from "./chat-handlers";
import { notificationStore } from "../notifications/notification-store";
import { fireFollowChanged } from "../events/follow";
import { enrichProfile } from "./profile-card-enrich";
import { createWaveMockStore, type WaveMockStore } from "./profile-card-mocks";
import { getUserStarred } from "../api/github";

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
  private _chatIsGroup = false;
  private _chatCursorState: CursorState = {
    cursor: undefined, previousCursor: undefined, nextCursor: undefined,
    hasMore: true, hasMoreBefore: true, hasMoreAfter: false,
  };

  // Channels state
  private _channels: RepoChannel[] = [];

  private _refreshTimer?: ReturnType<typeof setTimeout>;
  private _context?: vscode.ExtensionContext;
  private _waveStore: WaveMockStore | null = null;
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
    this.view.webview.postMessage({
      type: "setNotifications",
      items: notificationStore.items.slice(0, 20),
      unread: notificationStore.unreadCount,
    });
  }

  postToWebview(msg: unknown): void {
    this.view?.webview.postMessage(msg);
  }

  async navigateToChat(conversationId: string, recipientLogin?: string): Promise<void> {
    // Focus the explore view first
    await vscode.commands.executeCommand("gitchat.explore.focus");
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

  // ===================== REFRESH ALL =====================
  async refreshAll(): Promise<void> {
    await this.refreshChat();
  }

  setContext(context: vscode.ExtensionContext): void {
    this._context = context;
    this._waveStore = createWaveMockStore(context);
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
      if (choice?.value === "dm") { vscode.commands.executeCommand("gitchat.messageUser"); }
      else if (choice?.value === "group") { vscode.commands.executeCommand("gitchat.createGroup"); }
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
          vscode.commands.executeCommand("gitchat.openChat", meta.conversationId);
        } else if (notif.type === "follow") {
          vscode.commands.executeCommand("gitchat.viewProfile", notif.actor_login);
        } else if (meta.url) {
          vscode.env.openExternal(vscode.Uri.parse(meta.url));
        }
        break;
      }

      case "notificationMarkAllRead": {
        await notificationStore.markAllRead();
        this.refreshNotifications();
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
        vscode.commands.executeCommand("gitchat.viewMyProfile", p.login);
        break;
      case "openConversation":
        vscode.commands.executeCommand("gitchat.openChat", p.conversationId);
        break;
      case "newChat": {
        const choice = await vscode.window.showQuickPick(
          [
            { label: "$(comment-discussion) New Message", description: "Direct message to a user", value: "dm" },
            { label: "$(organization) New Group", description: "Create a group chat", value: "group" },
          ],
          { placeHolder: "Start a new conversation" }
        );
        if (choice?.value === "dm") { vscode.commands.executeCommand("gitchat.messageUser"); }
        else if (choice?.value === "group") { vscode.commands.executeCommand("gitchat.createGroup"); }
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

      // ── Channels ─────────────────────────────────────────
      case "fetchChatData":
        await this.fetchChatDataDev();
        break;
      case "fetchChannels":
        await this.fetchChannels();
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
      case "chatPin":
        try { await apiClient.pinConversation(p!.conversationId); this.fetchChatDataDev(); } catch { /* ignore */ }
        break;
      case "chatUnpin":
        try { await apiClient.unpinConversation(p!.conversationId); this.fetchChatDataDev(); } catch { /* ignore */ }
        break;
      case "chatMarkRead":
        try { await apiClient.markConversationRead(p!.conversationId); this.fetchChatDataDev(); } catch { /* ignore */ }
        break;

      case "profileCard:fetch": {
        try {
          const username = (msg.payload as { username: string }).username;
          // BE wraps profile under { profile, repos } — unwrap like ProfilePanel does.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const rawResp = (await apiClient.getUserProfile(username)) as any;
          const profile: UserProfile = rawResp.profile ?? rawResp;
          if (!profile.top_repos && rawResp.repos) { profile.top_repos = rawResp.repos; }
          const myFollowing = await apiClient.getFollowing(1, 100);
          const myLogin = authManager.login ?? "";
          const myStarred = await getUserStarred(myLogin);
          const enriched = await enrichProfile(profile, myLogin, {
            myFollowing,
            myStarred,
          });
          this.view?.webview.postMessage({ type: "profileCardData", payload: enriched });
        } catch (err) {
          log(`[Explore] profileCard fetch failed: ${err}`, "warn");
          this.view?.webview.postMessage({ type: "profileCardError", message: "Failed to load profile" });
        }
        break;
      }

      case "profileCard:follow": {
        const username = (msg.payload as { username: string }).username;
        try {
          await apiClient.followUser(username);
          fireFollowChanged(username, true);
          this.view?.webview.postMessage({
            type: "profileCardActionResult",
            action: "follow",
            success: true,
            username,
          });
        } catch (err) {
          log(`[Explore] profileCard follow failed for ${username}: ${err}`, "warn");
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
          this.view?.webview.postMessage({
            type: "profileCardActionResult",
            action: "unfollow",
            success: true,
            username,
          });
        } catch (err) {
          log(`[Explore] profileCard unfollow failed for ${username}: ${err}`, "warn");
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

      case "profileCard:wave": {
        const username = (msg.payload as { username: string }).username;
        if (this._waveStore?.hasWaved(username)) {
          this.view?.webview.postMessage({
            type: "profileCardActionResult",
            action: "wave",
            success: false,
            username,
            reason: "already_waved",
          });
          break;
        }
        this._waveStore?.markWaved(username);
        vscode.window.showInformationMessage(`Waved at @${username} 👋`);
        this.view?.webview.postMessage({
          type: "profileCardActionResult",
          action: "wave",
          success: true,
          username,
        });
        break;
      }

      case "profileCard:invite": {
        const username = (msg.payload as { username: string }).username;
        const url = `https://dev.gitchat.sh/@${username}`;
        await vscode.env.clipboard.writeText(url);
        vscode.window.showInformationMessage(`Invite link copied for @${username}`);
        break;
      }

      case "profileCard:openGitHub": {
        const username = (msg.payload as { username: string }).username;
        vscode.env.openExternal(vscode.Uri.parse(`https://github.com/${username}`));
        break;
      }

      case "profileCard:signOut":
        vscode.commands.executeCommand("gitchat.signOut");
        break;
    }
  }

  // ===================== HTML TEMPLATE =====================
  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const sharedCss = getUri(webview, this.extensionUri, ["media", "webview", "shared.css"]);
    const codiconCss = getUri(webview, this.extensionUri, ["media", "webview", "codicon.css"]);
    const profileCardCss = getUri(webview, this.extensionUri, ["media", "webview", "profile-card.css"]);
    const css = getUri(webview, this.extensionUri, ["media", "webview", "explore.css"]);
    const chatCss = getUri(webview, this.extensionUri, ["media", "webview", "sidebar-chat.css"]);
    const notifCss = getUri(webview, this.extensionUri, ["media", "webview", "notifications-section.css"]);
    const sharedJs = getUri(webview, this.extensionUri, ["media", "webview", "shared.js"]);
    const profileCardJs = getUri(webview, this.extensionUri, ["media", "webview", "profile-card.js"]);
    const chatJs = getUri(webview, this.extensionUri, ["media", "webview", "sidebar-chat.js"]);
    const js = getUri(webview, this.extensionUri, ["media", "webview", "explore.js"]);
    const notifJs = getUri(webview, this.extensionUri, ["media", "webview", "notifications-section.js"]);

    return `<!DOCTYPE html>
<html><head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} https: data:;">
  <link rel="stylesheet" href="${sharedCss}">
  <link rel="stylesheet" href="${profileCardCss}">
  <link rel="stylesheet" href="${codiconCss}">
  <link rel="stylesheet" href="${css}">
  <link rel="stylesheet" href="${chatCss}">
  <link rel="stylesheet" href="${notifCss}">
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
    <!-- WP10 Notifications inline section — rendered by notifications-section.js -->
    <section id="notif-section" class="notif-section" hidden>
      <div id="notif-header" class="notif-header">
        <div class="notif-header-left">
          <span class="codicon codicon-bell"></span>
          <span>Notifications</span>
          <span id="notif-unread-pill" class="notif-unread-pill" data-count="0">0</span>
        </div>
        <span class="notif-toggle-icon codicon codicon-chevron-down"></span>
      </div>
      <div id="notif-body" class="notif-body"></div>
      <div class="notif-footer">
        <button id="notif-mark-all" type="button">Mark all read</button>
      </div>
    </section>

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
<script nonce="${nonce}" src="${profileCardJs}"></script>
<script nonce="${nonce}" src="${chatJs}"></script>
<script nonce="${nonce}" src="${js}"></script>
<script nonce="${nonce}" src="${notifJs}"></script>
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

    // Auth change → refresh all
    authManager.onDidChangeAuth(() => exploreWebviewProvider.refreshAll());

    // Notification store changes → push fresh list to the webview
    context.subscriptions.push(
      notificationStore.onDidChange(() => exploreWebviewProvider.refreshNotifications()),
    );

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

    // If already signed in, trigger initial refresh
    if (authManager.isSignedIn) { exploreWebviewProvider.refreshAll(); }
  },
};
