import * as vscode from "vscode";
import { apiClient } from "../api";
import { authManager } from "../auth";
import { realtimeClient } from "../realtime";
import { getNonce, getUri, log } from "../utils";
import type { ExtensionModule, WebviewMessage } from "../types";

export class NotificationsWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "trending.notifications";
  private view?: vscode.WebviewView;

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")],
    };
    webviewView.webview.html = this.getHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage((msg: WebviewMessage) => this.onMessage(msg));
    // Don't call refresh() here — wait for "ready" signal from webview JS
  }

  async refresh(): Promise<void> {
    if (!authManager.isSignedIn || !this.view) { return; }
    try {
      const notifications = await apiClient.getNotifications();
      this.view.webview.postMessage({ type: "setNotifications", notifications });
    } catch (err) {
      log(`[Notifications] refresh failed: ${err}`, "warn");
    }
  }

  private async onMessage(msg: WebviewMessage): Promise<void> {
    const p = msg.payload as Record<string, string>;
    switch (msg.type) {
      case "ready":
        this.refresh();
        break;
      case "markAllRead":
        await apiClient.markNotificationsRead([]);
        this.refresh();
        break;
      case "openTarget":
        if (p.type === "message") {
          vscode.commands.executeCommand("trending.openInbox");
        } else if (p.type === "follow") {
          vscode.commands.executeCommand("trending.viewProfile", p.actor);
        } else if (p.url) {
          vscode.env.openExternal(vscode.Uri.parse(p.url));
        }
        break;
    }
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const sharedCss = getUri(webview, this.extensionUri, ["media", "webview", "shared.css"]);
    const css = getUri(webview, this.extensionUri, ["media", "webview", "notifications.css"]);
    const sharedJs = getUri(webview, this.extensionUri, ["media", "webview", "shared.js"]);
    const js = getUri(webview, this.extensionUri, ["media", "webview", "notifications.js"]);
    return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} https:;">
<link rel="stylesheet" href="${sharedCss}"><link rel="stylesheet" href="${css}">
</head><body>
<div class="gs-header"><span class="gs-header-title">Notifications</span>
<button class="gs-btn gs-btn-ghost gs-text-xs" id="mark-all-read">Mark all read</button></div>
<div id="notifications"></div>
<div id="empty" class="gs-empty" style="display:none">No notifications</div>
<script nonce="${nonce}" src="${sharedJs}"></script>
<script nonce="${nonce}" src="${js}"></script>
</body></html>`;
  }
}

export let notificationsWebviewProvider: NotificationsWebviewProvider;

export const notificationsWebviewModule: ExtensionModule = {
  id: "notificationsWebview",
  activate(context) {
    notificationsWebviewProvider = new NotificationsWebviewProvider(context.extensionUri);
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(NotificationsWebviewProvider.viewType, notificationsWebviewProvider)
    );
    authManager.onDidChangeAuth(() => notificationsWebviewProvider.refresh());
    realtimeClient.onNotification(() => notificationsWebviewProvider.refresh());
    if (authManager.isSignedIn) { notificationsWebviewProvider.refresh(); }
  },
};
