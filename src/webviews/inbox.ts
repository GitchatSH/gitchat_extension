import * as vscode from "vscode";
import { apiClient, getOtherUser } from "../api";
import { authManager } from "../auth";
import { realtimeClient } from "../realtime";
import { getNonce, getUri } from "../utils";
import type { Conversation, ExtensionModule, WebviewMessage } from "../types";

export class InboxWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "trending.inbox";
  private view?: vscode.WebviewView;
  private conversations: Conversation[] = [];

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
      this.conversations = await apiClient.getConversations();
      this.view.webview.postMessage({
        type: "setConversations",
        conversations: this.conversations.map((c) => ({
          ...c,
          other_user: getOtherUser(c, authManager.login),
        })),
        currentUser: authManager.login,
      });
    } catch { /* ignore */ }
  }

  private async onMessage(msg: WebviewMessage): Promise<void> {
    const p = msg.payload as Record<string, string>;
    switch (msg.type) {
      case "openChat":
        vscode.commands.executeCommand("trending.openChat", p.conversationId);
        break;
      case "newChat":
        vscode.commands.executeCommand("trending.messageUser");
        break;
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
        } catch {
          vscode.window.showErrorMessage("Failed to mark conversation as read");
        }
        break;
      case "delete": {
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

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const sharedCss = getUri(webview, this.extensionUri, ["media", "webview", "shared.css"]);
    const css = getUri(webview, this.extensionUri, ["media", "webview", "inbox.css"]);
    const sharedJs = getUri(webview, this.extensionUri, ["media", "webview", "shared.js"]);
    const js = getUri(webview, this.extensionUri, ["media", "webview", "inbox.js"]);

    return `<!DOCTYPE html>
<html><head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} https:;">
  <link rel="stylesheet" href="${sharedCss}">
  <link rel="stylesheet" href="${css}">
</head><body>
  <div class="gs-header">
    <span class="gs-header-title">Inbox</span>
    <div class="gs-flex gs-gap-4 gs-items-center">
      <select id="filter" class="gs-input" style="width:auto;padding:2px 8px;font-size:11px">
        <option value="all">All</option>
        <option value="unread">Unread</option>
        <option value="direct">Direct</option>
        <option value="requests">Requests</option>
      </select>
      <button class="gs-btn-icon" id="new-chat" title="New message">&#9998;</button>
    </div>
  </div>
  <div id="conversations"></div>
  <div id="empty" class="gs-empty" style="display:none">No conversations yet</div>
  <script nonce="${nonce}" src="${sharedJs}"></script>
  <script nonce="${nonce}" src="${js}"></script>
</body></html>`;
  }
}

export let inboxWebviewProvider: InboxWebviewProvider;

export const inboxWebviewModule: ExtensionModule = {
  id: "inboxWebview",
  activate(context) {
    inboxWebviewProvider = new InboxWebviewProvider(context.extensionUri);
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(InboxWebviewProvider.viewType, inboxWebviewProvider)
    );
    authManager.onDidChangeAuth(() => inboxWebviewProvider.refresh());
    realtimeClient.onNewMessage(() => inboxWebviewProvider.refresh());
  },
};
