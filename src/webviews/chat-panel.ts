import * as vscode from "vscode";
import { apiClient, getOtherUser } from "../api";
import { authManager } from "../auth";
import { realtimeClient } from "../realtime";
import { configManager } from "../config";
import { getNonce, getUri, log } from "../utils";
import type { Conversation, ExtensionModule, WebviewMessage } from "../types";

/**
 * Combined Friends + Inbox webview with tab switching.
 * Lives in the chatSidebar activity bar container.
 */
export class ChatPanelWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "trending.chatPanel";
  private view?: vscode.WebviewView;
  private _dmConvMap = new Map<string, string>(); // conversationId → login (DM only)
  private _mutedConvs = new Set<string>(); // muted conversation IDs
  private _pendingBadge: number | null = null;
  private _drafts = new Map<string, string>();

  setDraft(conversationId: string, text: string): void {
    if (text.trim()) {
      this._drafts.set(conversationId, text);
    } else {
      this._drafts.delete(conversationId);
    }
    this.debouncedRefresh();
    // Also update explore panel (unified layout)
    import("./explore").then(m => {
      m.exploreWebviewProvider?.postToWebview({
        type: "updateDrafts",
        drafts: Object.fromEntries(this._drafts),
      });
    }).catch(() => {});
  }

  getDraft(conversationId: string): string {
    return this._drafts.get(conversationId) ?? "";
  }

  clearDraft(conversationId: string): void {
    this._drafts.delete(conversationId);
    this.debouncedRefresh();
    import("./explore").then(m => {
      m.exploreWebviewProvider?.postToWebview({
        type: "updateDrafts",
        drafts: Object.fromEntries(this._drafts),
      });
    }).catch(() => {});
  }

  getAllDrafts(): Record<string, string> {
    return Object.fromEntries(this._drafts);
  }

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")],
    };
    webviewView.webview.html = this.getHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage((msg: WebviewMessage) => this.onMessage(msg));
    // Apply pending badge if set before view was resolved
    if (this._pendingBadge !== null) {
      this.setBadge(this._pendingBadge);
      this._pendingBadge = null;
    }
    // Don't call refresh() here — wait for "ready" signal from webview JS
  }

  private _refreshTimer: ReturnType<typeof setTimeout> | undefined;

  debouncedRefresh(): void {
    clearTimeout(this._refreshTimer);
    this._refreshTimer = setTimeout(() => this.refresh(), 500);
  }

  async refresh(): Promise<void> {
    if (!authManager.isSignedIn || !this.view) { return; }
    try {
      // Fetch friends (following list) — fallback to GitHub API if Gitstar returns empty
      let following = await apiClient.getFollowing(1, 100);
      log(`[ChatPanel] getFollowing returned ${following.length} friends`);
      if (following.length === 0 && authManager.token) {
        log("[ChatPanel] Falling back to GitHub API for following list");
        following = await this.fetchGitHubFollowing(authManager.token);
        log(`[ChatPanel] GitHub API returned ${following.length} following`);
      }
      const logins = following.map((f: { login: string }) => f.login);
      let presenceData: Record<string, string | null> = {};
      if (logins.length) {
        try {
          // Limit to first 50 logins to avoid URL too long
          presenceData = await apiClient.getPresence(logins.slice(0, 50));
        } catch (err) {
          log(`[ChatPanel] getPresence failed: ${err}`, "warn");
        }
      }

      // Fetch conversations
      let conversations: Conversation[] = [];
      try {
        conversations = await apiClient.getConversations();
        // Subscribe to all conversation rooms for real-time updates
        realtimeClient.subscribeToConversations(conversations.map(c => c.id));
      } catch (err) {
        log(`[ChatPanel] getConversations failed: ${err}`, "warn");
      }

      // Build unread counts
      const unreadCounts: Record<string, number> = {};
      for (const conv of conversations) {
        const other = getOtherUser(conv, authManager.login);
        if (other && ((conv as unknown as Record<string, number>).unread_count > 0)) {
          unreadCounts[other.login] = (conv as unknown as Record<string, number>).unread_count || 1;
        }
      }

      // Build friends data
      const threshold = configManager.current.presenceHeartbeat * 5;
      const friends = following.map((f: { login: string; name?: string; avatar_url?: string }) => {
        const lastSeenStr = presenceData[f.login];
        const lastSeen = lastSeenStr ? new Date(lastSeenStr).getTime() : 0;
        const online = lastSeen > 0 && (Date.now() - lastSeen < threshold);
        return {
          login: f.login,
          name: f.name || f.login,
          avatar_url: f.avatar_url || "",
          online,
          lastSeen,
          unread: unreadCounts[f.login] || 0,
        };
      });

      friends.sort((a: { online: boolean; lastSeen: number; name: string }, b: { online: boolean; lastSeen: number; name: string }) => {
        if (a.online && !b.online) { return -1; }
        if (!a.online && b.online) { return 1; }
        if (a.lastSeen !== b.lastSeen) { return b.lastSeen - a.lastSeen; }
        return a.name.localeCompare(b.name);
      });

      // Build conversations data + DM map for typing + muted set
      this._dmConvMap.clear();
      this._mutedConvs.clear();
      const convData = conversations.map((c: Conversation) => {
        const other = getOtherUser(c, authManager.login);
        if (c.type !== "group" && !c.is_group && other) {
          this._dmConvMap.set(c.id, other.login);
        }
        if ((c as unknown as Record<string, boolean>).is_muted) {
          this._mutedConvs.add(c.id);
        }
        return { ...c, other_user: other };
      });

      this.view.webview.postMessage({
        type: "setData",
        friends,
        conversations: convData,
        currentUser: authManager.login,
        drafts: Object.fromEntries(this._drafts),
      });
    } catch (err) {
      log(`[ChatPanel] refresh failed: ${err}`, "warn");
    }
  }

  setBadge(count: number): void {
    if (this.view) {
      this.view.badge = count > 0 ? { value: count, tooltip: `${count} unread message${count !== 1 ? "s" : ""}` } : undefined;
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

  showTyping(conversationId: string, user: string): void {
    // typing:start events are room-scoped, conversationId may be empty
    if (conversationId) {
      const dmLogin = this._dmConvMap.get(conversationId);
      if (dmLogin && dmLogin === user) {
        this.view?.webview.postMessage({ type: "friendTyping", login: user });
      }
    } else {
      // No conversationId — check if user is in any DM conversation
      for (const [, login] of this._dmConvMap) {
        if (login === user) {
          this.view?.webview.postMessage({ type: "friendTyping", login: user });
          break;
        }
      }
    }
  }

  private async onMessage(msg: WebviewMessage): Promise<void> {
    const p = msg.payload as Record<string, string>;
    switch (msg.type) {
      case "ready": {
        // Send current settings to webview
        const cfg = configManager.current;
        this.view?.webview.postMessage({
          type: "settings",
          showMessageNotifications: cfg.showMessageNotifications,
          messageSound: cfg.messageSound,
          debugLogs: cfg.debugLogs,
        });
        this.refresh();
        break;
      }
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

      // Friends actions
      case "openChat":
        vscode.commands.executeCommand("trending.messageUser", p.login);
        break;
      case "viewProfile":
        vscode.commands.executeCommand("trending.viewProfile", p.login);
        break;

      // Inbox actions
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
        if (choice?.value === "dm") {
          vscode.commands.executeCommand("trending.messageUser");
        } else if (choice?.value === "group") {
          vscode.commands.executeCommand("trending.createGroup");
        }
        break;
      }
      case "pin":
        try {
          await apiClient.pinConversation(p.conversationId);
          this.refresh();
        } catch {
          vscode.window.showErrorMessage("Failed to pin conversation");
        }
        break;
      case "unpin":
        try {
          await apiClient.unpinConversation(p.conversationId);
          this.refresh();
        } catch {
          vscode.window.showErrorMessage("Failed to unpin conversation");
        }
        break;
      case "markRead":
        try {
          await apiClient.markConversationRead(p.conversationId);
          this.refresh();
          import("../statusbar").then(m => m.fetchCounts()).catch(() => {});
        } catch {
          vscode.window.showErrorMessage("Failed to mark as read");
        }
        break;
      case "deleteConversation": {
        const confirm = await vscode.window.showWarningMessage(
          "Delete this conversation?", { modal: true }, "Delete"
        );
        if (confirm === "Delete") {
          try {
            await apiClient.deleteConversation(p.conversationId);
            this.refresh();
          } catch {
            vscode.window.showErrorMessage("Failed to delete conversation");
          }
        }
        break;
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
    } catch {
      return [];
    }
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const sharedCss = getUri(webview, this.extensionUri, ["media", "webview", "shared.css"]);
    const codiconCss = getUri(webview, this.extensionUri, ["media", "webview", "codicon.css"]);
    const css = getUri(webview, this.extensionUri, ["media", "webview", "chat-panel.css"]);
    const sharedJs = getUri(webview, this.extensionUri, ["media", "webview", "shared.js"]);
    const js = getUri(webview, this.extensionUri, ["media", "webview", "chat-panel.js"]);

    return `<!DOCTYPE html>
<html><head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} https:;">
  <link rel="stylesheet" href="${sharedCss}">
  <link rel="stylesheet" href="${codiconCss}">
  <link rel="stylesheet" href="${css}">
</head><body>
  <div class="gs-header">
    <div class="tab-bar">
      <button class="tab active" data-tab="inbox">Inbox <span id="tab-inbox-count"></span></button>
      <button class="tab" data-tab="friends">Friends <span id="tab-friends-count"></span></button>
    </div>
    <div class="gs-flex gs-gap-4 gs-items-center">
      <button class="gs-btn-icon" id="settings-btn" title="Settings"><span class="codicon codicon-settings-gear"></span></button>
      <button class="gs-btn-icon" id="new-chat" title="New message"><span class="codicon codicon-comment"></span></button>
    </div>
    <div class="settings-dropdown" id="settings-dropdown" style="display:none">
      <label class="settings-item"><input type="checkbox" id="setting-notifications" checked /> Message notifications</label>
      <label class="settings-item"><input type="checkbox" id="setting-sound" /> Message sound</label>
      <label class="settings-item"><input type="checkbox" id="setting-debug" /> Debug logs</label>
      <div class="settings-divider"></div>
      <button class="settings-action" id="setting-signout">Sign Out</button>
    </div>
  </div>
  <div id="search-bar" style="padding:6px 12px;display:none">
    <input type="text" id="search" class="gs-input" placeholder="Search..." style="font-size:12px">
  </div>
  <div id="filter-bar" class="filter-bar" style="display:none">
    <button class="filter-btn active" data-filter="all">All <span class="filter-count" id="count-all"></span></button>
    <button class="filter-btn" data-filter="direct">Direct <span class="filter-count" id="count-direct"></span></button>
    <button class="filter-btn" data-filter="group">Group <span class="filter-count" id="count-group"></span></button>
    <button class="filter-btn" data-filter="requests">Requests <span class="filter-count" id="count-requests"></span></button>
    <button class="filter-btn" data-filter="unread">Unread <span class="filter-count" id="count-unread"></span></button>
  </div>
  <div id="content"></div>
  <div id="empty" class="gs-empty" style="display:none"></div>
  <script nonce="${nonce}" src="${sharedJs}"></script>
  <script nonce="${nonce}" src="${js}"></script>
</body></html>`;
  }
}

export let chatPanelWebviewProvider: ChatPanelWebviewProvider;

export const chatPanelWebviewModule: ExtensionModule = {
  id: "chatPanelWebview",
  activate(context) {
    chatPanelWebviewProvider = new ChatPanelWebviewProvider(context.extensionUri);
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(ChatPanelWebviewProvider.viewType, chatPanelWebviewProvider)
    );
    authManager.onDidChangeAuth(() => chatPanelWebviewProvider.refresh());
    realtimeClient.onNewMessage(() => chatPanelWebviewProvider.debouncedRefresh());
    realtimeClient.onConversationUpdated(() => chatPanelWebviewProvider.debouncedRefresh());
    realtimeClient.onTyping((data) => chatPanelWebviewProvider.showTyping(data.conversationId, data.user));
    // If already signed in (saved session), the onDidChangeAuth event already fired
    // before this module activated. Trigger refresh explicitly.
    if (authManager.isSignedIn) { chatPanelWebviewProvider.refresh(); }
  },
};
