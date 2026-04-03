import * as vscode from "vscode";
import { apiClient } from "../api";
import { authManager } from "../auth";
import { getNonce, getUri, log } from "../utils";
import type { ExtensionModule, WebviewMessage } from "../types";

export class FeedWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "trending.feed";
  private view?: vscode.WebviewView;
  private page = 1;

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
      this.page = 1;
      const { results, hasMore } = await apiClient.getForYouFeed(this.page);
      log(`[Feed] loaded ${results.length} for-you items`);
      this.view.webview.postMessage({ type: "setEvents", events: results, replace: true, hasMore });
    } catch (err) {
      log(`[Feed] refresh failed: ${err}`, "warn");
    }
  }

  private async onMessage(msg: WebviewMessage): Promise<void> {
    const p = msg.payload as Record<string, string>;
    switch (msg.type) {
      case "ready":
        this.refresh();
        break;
      case "loadMore":
        this.page++;
        try {
          const { results, hasMore } = await apiClient.getForYouFeed(this.page);
          this.view?.webview.postMessage({ type: "setEvents", events: results, replace: false, hasMore });
        } catch (err) {
          log(`[Feed] loadMore failed: ${err}`, "warn");
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
        if (owner && repo) {
          vscode.commands.executeCommand("trending.viewRepoDetail", owner, repo);
        }
        break;
      }
      case "viewProfile": {
        const { login } = msg.payload as { login: string };
        if (login) {
          vscode.commands.executeCommand("trending.viewProfile", login);
        }
        break;
      }
    }
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const sharedCss = getUri(webview, this.extensionUri, ["media", "webview", "shared.css"]);
    const css = getUri(webview, this.extensionUri, ["media", "webview", "feed.css"]);
    const sharedJs = getUri(webview, this.extensionUri, ["media", "webview", "shared.js"]);
    const js = getUri(webview, this.extensionUri, ["media", "webview", "feed.js"]);
    return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} https:;">
<link rel="stylesheet" href="${sharedCss}"><link rel="stylesheet" href="${css}">
</head><body>
<div class="feed-filters" id="filters">
  <button class="feed-chip active" data-filter="all">All</button>
  <button class="feed-chip" data-filter="trending">🔥 Repos</button>
  <button class="feed-chip" data-filter="release">📦 Released</button>
  <button class="feed-chip" data-filter="pr-merged">🔀 Merged</button>
  <button class="feed-chip" data-filter="notable-star">⭐ Notable</button>
</div>
<div id="events"></div>
<div id="empty" class="gs-empty" style="display:none">Follow people to see their activity here</div>
<button id="load-more" class="load-more-btn" style="display:none">Load more</button>
<script nonce="${nonce}" src="${sharedJs}"></script>
<script nonce="${nonce}" src="${js}"></script>
</body></html>`;
  }
}

export let feedWebviewProvider: FeedWebviewProvider;

export const feedWebviewModule: ExtensionModule = {
  id: "feedWebview",
  activate(context) {
    feedWebviewProvider = new FeedWebviewProvider(context.extensionUri);
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(FeedWebviewProvider.viewType, feedWebviewProvider)
    );
    authManager.onDidChangeAuth(() => feedWebviewProvider.refresh());
    if (authManager.isSignedIn) { feedWebviewProvider.refresh(); }
  },
};
