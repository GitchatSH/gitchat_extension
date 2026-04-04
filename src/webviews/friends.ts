import * as vscode from "vscode";
import { apiClient, getOtherUser } from "../api";
import { authManager } from "../auth";
import { realtimeClient } from "../realtime";
import { configManager } from "../config";
import { getNonce, getUri } from "../utils";
import type { ExtensionModule, WebviewMessage } from "../types";

interface FriendData {
  login: string;
  name: string;
  avatar_url: string;
  online: boolean;
  lastSeen: number;
  unread: number;
}

export class FriendsWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "trending.friends";
  private view?: vscode.WebviewView;
  private friends: FriendData[] = [];
  private presenceMap = new Map<string, { online: boolean; lastSeen: number }>();
  private unreadCounts = new Map<string, number>();

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")],
    };
    webviewView.webview.html = this.getHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage((msg: WebviewMessage) => this.onMessage(msg));
    this.refresh();
  }

  async refresh(): Promise<void> {
    if (!authManager.isSignedIn || !this.view) { return; }
    try {
      // Fetch following list
      const following = await apiClient.getFollowing(1, 100);

      // Fetch presence for all
      const logins = (following as { login: string }[]).map((f) => f.login);
      let presenceData: Record<string, string | null> = {};
      if (logins.length) {
        presenceData = await apiClient.getPresence(logins);
      }

      // Fetch conversations for unread counts
      const conversations = await apiClient.getConversations();
      this.unreadCounts.clear();
      for (const conv of conversations) {
        const other = getOtherUser(conv, authManager.login);
        if (other && (conv.unread_count > 0)) {
          this.unreadCounts.set(other.login, conv.unread_count || 1);
        }
      }

      // Build friend data
      const threshold = configManager.current.presenceHeartbeat * 5;
      this.friends = (following as { login: string; name?: string; avatar_url?: string }[]).map((f) => {
        const lastSeenStr = presenceData[f.login];
        const lastSeen = lastSeenStr ? new Date(lastSeenStr).getTime() : 0;
        const online = lastSeen > 0 && (Date.now() - lastSeen < threshold);
        return {
          login: f.login,
          name: f.name || f.login,
          avatar_url: f.avatar_url || "",
          online,
          lastSeen,
          unread: this.unreadCounts.get(f.login) || 0,
        };
      });

      // Sort: online first, then by lastSeen, then alphabetical
      this.friends.sort((a, b) => {
        if (a.online && !b.online) { return -1; }
        if (!a.online && b.online) { return 1; }
        if (a.lastSeen !== b.lastSeen) { return b.lastSeen - a.lastSeen; }
        return a.name.localeCompare(b.name);
      });

      this.sendToWebview();
    } catch { /* ignore */ }
  }

  private sendToWebview(): void {
    this.view?.webview.postMessage({
      type: "setFriends",
      friends: this.friends,
    });
  }

  clearUnread(login: string): void {
    this.unreadCounts.delete(login);
    const f = this.friends.find(fr => fr.login === login);
    if (f) { f.unread = 0; }
    this.sendToWebview();
  }

  private async onMessage(msg: WebviewMessage): Promise<void> {
    const p = msg.payload as Record<string, string>;
    switch (msg.type) {
      case "openChat":
        vscode.commands.executeCommand("trending.messageUser", p.login);
        break;
      case "viewProfile":
        vscode.commands.executeCommand("trending.viewProfile", p.login);
        break;
    }
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const sharedCss = getUri(webview, this.extensionUri, ["media", "webview", "shared.css"]);
    const codiconCss = getUri(webview, this.extensionUri, ["media", "webview", "codicon.css"]);
    const css = getUri(webview, this.extensionUri, ["media", "webview", "friends.css"]);
    const sharedJs = getUri(webview, this.extensionUri, ["media", "webview", "shared.js"]);
    const js = getUri(webview, this.extensionUri, ["media", "webview", "friends.js"]);

    return `<!DOCTYPE html>
<html><head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} https:;">
  <link rel="stylesheet" href="${sharedCss}">
  <link rel="stylesheet" href="${codiconCss}">
  <link rel="stylesheet" href="${css}">
</head><body>
  <div class="gs-header">
    <span class="gs-header-title" id="title">Friends</span>
    <input type="text" id="search" class="gs-input" style="width:120px;padding:2px 8px;font-size:11px" placeholder="Search...">
  </div>
  <div id="friends-list"></div>
  <div id="empty" class="gs-empty" style="display:none">No friends yet. Follow people to see them here!</div>
  <script nonce="${nonce}" src="${sharedJs}"></script>
  <script nonce="${nonce}" src="${js}"></script>
</body></html>`;
  }
}

export let friendsWebviewProvider: FriendsWebviewProvider;

export const friendsWebviewModule: ExtensionModule = {
  id: "friendsWebview",
  activate(context) {
    friendsWebviewProvider = new FriendsWebviewProvider(context.extensionUri);
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(FriendsWebviewProvider.viewType, friendsWebviewProvider)
    );
    authManager.onDidChangeAuth(() => friendsWebviewProvider.refresh());
    realtimeClient.onPresence(() => friendsWebviewProvider.refresh());
    realtimeClient.onNewMessage((msg) => {
      const msgRecord = msg as unknown as Record<string, unknown>;
      const sender = (msgRecord.sender_login as string | undefined) || (msgRecord.sender as string | undefined);
      if (sender && sender !== authManager.login) {
        // Will be refreshed on next full refresh, or handle inline
      }
    });
  },
};
