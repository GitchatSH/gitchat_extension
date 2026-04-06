import * as vscode from "vscode";
import { apiClient } from "../api";
import { authManager } from "../auth";
import { configManager } from "../config";
import { getNonce, getUri, log } from "../utils";
import { fireFollowChanged, onDidChangeFollow } from "../events/follow";
import type { ExtensionModule, TrendingPerson, WebviewMessage } from "../types";

export class TrendingPeopleWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "trending.trendingPeople";
  private view?: vscode.WebviewView;
  private _people: TrendingPerson[] = [];
  private _followMap: Record<string, boolean> = {};
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
      case "viewProfile": {
        const { login } = msg.payload as { login: string };
        if (login) { vscode.commands.executeCommand("trending.viewProfile", login); }
        break;
      }
    }
  }

  async fetchAndPost(): Promise<void> {
    if (!this.view) { return; }
    try {
      this._people = await apiClient.getTrendingPeople();
      if (authManager.isSignedIn && this._people.length) {
        const logins = this._people.map((p) => p.login);
        const statuses = await apiClient.batchFollowStatus(logins);
        this._followMap = {};
        for (const [login, status] of Object.entries(statuses)) {
          this._followMap[login] = (status as { following: boolean }).following;
        }
      }
      const items = this._people.map((p) => ({
        ...p,
        following: this._followMap[p.login] ?? false,
        avatar_url: p.avatar_url || `https://github.com/${encodeURIComponent(p.login)}.png?size=72`,
      }));
      this.view.webview.postMessage({ type: "setPeople", people: items });
    } catch (err) {
      log(`[TrendingPeople] fetchAndPost failed: ${err}`, "error");
    }
  }

  setFollowState(username: string, following: boolean): void {
    this._followMap[username] = following;
    this.view?.webview.postMessage({ type: "followUpdate", login: username, following });
  }

  startPolling(interval: number): void {
    this._interval = setInterval(() => this.fetchAndPost(), interval);
  }

  dispose(): void { clearInterval(this._interval); }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const sharedCss = getUri(webview, this.extensionUri, ["media", "webview", "shared.css"]);
    const css = getUri(webview, this.extensionUri, ["media", "webview", "trending-people.css"]);
    const sharedJs = getUri(webview, this.extensionUri, ["media", "webview", "shared.js"]);
    const js = getUri(webview, this.extensionUri, ["media", "webview", "trending-people.js"]);
    return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} https:;">
<link rel="stylesheet" href="${sharedCss}"><link rel="stylesheet" href="${css}">
</head><body>
<div id="list"></div>
<div id="empty" class="gs-empty" style="display:none">No trending developers found.</div>
<script nonce="${nonce}" src="${sharedJs}"></script>
<script nonce="${nonce}" src="${js}"></script>
</body></html>`;
  }
}

export let trendingPeopleWebviewProvider: TrendingPeopleWebviewProvider;

export const trendingPeopleModule: ExtensionModule = {
  id: "trendingPeople",
  activate(context) {
    trendingPeopleWebviewProvider = new TrendingPeopleWebviewProvider(context.extensionUri);
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(TrendingPeopleWebviewProvider.viewType, trendingPeopleWebviewProvider),
      { dispose: () => trendingPeopleWebviewProvider.dispose() },
    );
    trendingPeopleWebviewProvider.startPolling(configManager.current.trendingPollInterval);

    const followSub = onDidChangeFollow((e) => {
      trendingPeopleWebviewProvider.setFollowState(e.username, e.following);
    });
    context.subscriptions.push(followSub);
  },
};
