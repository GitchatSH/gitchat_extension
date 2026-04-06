import * as vscode from "vscode";
import { apiClient } from "../api";
import { authManager } from "../auth";
import { configManager } from "../config";
import { getNonce, getUri, log } from "../utils";
import type { ExtensionModule, TrendingRepo, WebviewMessage } from "../types";

export class TrendingReposWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "trending.trendingRepos";
  private view?: vscode.WebviewView;
  private _repos: TrendingRepo[] = [];
  private _starredMap: Record<string, boolean> = {};
  private _interval?: ReturnType<typeof setInterval>;

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

  private async onMessage(msg: WebviewMessage): Promise<void> {
    const p = msg.payload as Record<string, string> | undefined;
    switch (msg.type) {
      case "ready":
      case "refresh":
        await this.fetchAndPost();
        break;
      case "star": {
        const slug = p?.slug;
        if (!slug) { break; }
        const [owner, repo] = slug.split("/");
        try {
          await apiClient.starRepo(owner, repo);
          this._starredMap[slug] = true;
          this.view?.webview.postMessage({ type: "starredUpdate", slug, starred: true });
        } catch { vscode.window.showErrorMessage(`Failed to star ${slug}`); }
        break;
      }
      case "unstar": {
        const slug = p?.slug;
        if (!slug) { break; }
        const [owner, repo] = slug.split("/");
        try {
          await apiClient.unstarRepo(owner, repo);
          this._starredMap[slug] = false;
          this.view?.webview.postMessage({ type: "starredUpdate", slug, starred: false });
        } catch { vscode.window.showErrorMessage(`Failed to unstar ${slug}`); }
        break;
      }
      case "viewRepo": {
        const { owner, repo } = msg.payload as { owner: string; repo: string };
        if (owner && repo) { vscode.commands.executeCommand("trending.viewRepoDetail", owner, repo); }
        break;
      }
    }
  }

  async fetchAndPost(): Promise<void> {
    if (!this.view) { return; }
    try {
      this._repos = await apiClient.getTrendingRepos();
      if (authManager.isSignedIn && this._repos.length) {
        const slugs = this._repos.map((r) => `${r.owner}/${r.name}`);
        this._starredMap = await apiClient.batchCheckStarred(slugs);
      }
      const items = this._repos.map((r) => ({
        ...r,
        slug: `${r.owner}/${r.name}`,
        starred: this._starredMap[`${r.owner}/${r.name}`] ?? false,
      }));
      this.view.webview.postMessage({ type: "setRepos", repos: items });
    } catch (err) {
      log(`[TrendingRepos] fetchAndPost failed: ${err}`, "error");
    }
  }

  startPolling(interval: number): void {
    this._interval = setInterval(() => this.fetchAndPost(), interval);
  }

  dispose(): void { clearInterval(this._interval); }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const sharedCss = getUri(webview, this.extensionUri, ["media", "webview", "shared.css"]);
    const css = getUri(webview, this.extensionUri, ["media", "webview", "trending-repos.css"]);
    const sharedJs = getUri(webview, this.extensionUri, ["media", "webview", "shared.js"]);
    const js = getUri(webview, this.extensionUri, ["media", "webview", "trending-repos.js"]);
    return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} https:;">
<link rel="stylesheet" href="${sharedCss}"><link rel="stylesheet" href="${css}">
</head><body>
<div id="list"></div>
<div id="empty" class="gs-empty" style="display:none">No trending repos found.</div>
<script nonce="${nonce}" src="${sharedJs}"></script>
<script nonce="${nonce}" src="${js}"></script>
</body></html>`;
  }
}

export let trendingReposWebviewProvider: TrendingReposWebviewProvider;

export const trendingReposModule: ExtensionModule = {
  id: "trendingRepos",
  activate(context) {
    trendingReposWebviewProvider = new TrendingReposWebviewProvider(context.extensionUri);
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(TrendingReposWebviewProvider.viewType, trendingReposWebviewProvider),
      { dispose: () => trendingReposWebviewProvider.dispose() },
    );
    trendingReposWebviewProvider.startPolling(configManager.current.trendingPollInterval);
  },
};
