import * as vscode from "vscode";
import { apiClient } from "../api";
import { authManager } from "../auth";
import { getNonce, getUri, log } from "../utils";
import type { ExtensionModule, WebviewMessage } from "../types";

export class WhoToFollowWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "trending.whoToFollow";
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
      const suggestions = await apiClient.getFollowingSuggestions();
      this.view.webview.postMessage({ type: "setSuggestions", suggestions });
    } catch (err) {
      log(`[WhoToFollow] refresh failed: ${err}`, "warn");
    }
  }

  private async onMessage(msg: WebviewMessage): Promise<void> {
    const p = msg.payload as Record<string, string>;
    switch (msg.type) {
      case "ready":
        this.refresh();
        break;
      case "follow":
        try {
          await apiClient.followUser(p.login);
          this.refresh();
        } catch {
          vscode.window.showErrorMessage("Failed to follow user");
          this.refresh();
        }
        break;
      case "message":
        vscode.commands.executeCommand("trending.messageUser", p.login);
        break;
      case "viewProfile":
        vscode.commands.executeCommand("trending.viewProfile", p.login);
        break;
      case "getPreview": {
        try {
          const preview = await apiClient.getUserPreview(p.login);
          this.view?.webview.postMessage({ type: "setPreview", login: p.login, preview });
        } catch { /* ignore */ }
        break;
      }
    }
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const sharedCss = getUri(webview, this.extensionUri, ["media", "webview", "shared.css"]);
    const css = getUri(webview, this.extensionUri, ["media", "webview", "who-to-follow.css"]);
    const sharedJs = getUri(webview, this.extensionUri, ["media", "webview", "shared.js"]);
    const js = getUri(webview, this.extensionUri, ["media", "webview", "who-to-follow.js"]);

    return `<!DOCTYPE html>
<html><head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} https:;">
  <link rel="stylesheet" href="${sharedCss}">
  <link rel="stylesheet" href="${css}">
</head><body>
  <div class="gs-header">
    <span class="gs-header-title">Who to Follow</span>
  </div>
  <div id="suggestions"></div>
  <div id="hover-card" class="gs-hover-card"></div>
  <div id="empty" class="gs-empty" style="display:none">No suggestions available</div>
  <script nonce="${nonce}" src="${sharedJs}"></script>
  <script nonce="${nonce}" src="${js}"></script>
</body></html>`;
  }
}

export let whoToFollowWebviewProvider: WhoToFollowWebviewProvider;

export const whoToFollowWebviewModule: ExtensionModule = {
  id: "whoToFollowWebview",
  activate(context) {
    whoToFollowWebviewProvider = new WhoToFollowWebviewProvider(context.extensionUri);
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(WhoToFollowWebviewProvider.viewType, whoToFollowWebviewProvider)
    );
    authManager.onDidChangeAuth(() => whoToFollowWebviewProvider.refresh());
    if (authManager.isSignedIn) { whoToFollowWebviewProvider.refresh(); }
  },
};
