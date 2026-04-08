import * as vscode from "vscode";
import { apiClient } from "../api";
import { authManager } from "../auth";
import { configManager } from "../config";
import { getNonce, getUri, log } from "../utils";
import { fireFollowChanged, onDidChangeFollow } from "../events/follow";
import type { ExtensionModule, WebviewMessage } from "../types";

class ExploreWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "trending.explore";
  private view?: vscode.WebviewView;
  private _starredMap: Record<string, boolean> = {};
  private _followMap: Record<string, boolean> = {};
  private _timeRange = "weekly";
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
        await this.fetchRepos();
        break;
      case "refreshRepos":
        await this.fetchRepos();
        break;
      case "switchTab": {
        const tab = p?.tab;
        if (tab === "people") { await this.fetchPeople(); }
        else if (tab === "myrepos") { await this.fetchMyRepos(); }
        break;
      }
      case "changeRange": {
        this._timeRange = p?.range || "weekly";
        await this.fetchRepos();
        break;
      }
      case "search": {
        const query = (p?.query ?? "").trim();
        if (!query) { await this.fetchRepos(); break; }
        try {
          this.view?.webview.postMessage({ type: "setLoading" });
          const result = await apiClient.search(query);
          this.view?.webview.postMessage({ type: "setRepos", repos: result.repos ?? [] });
        } catch (err) {
          log(`[Explore] search failed: ${err}`, "error");
          this.view?.webview.postMessage({ type: "error", message: "Search failed." });
        }
        break;
      }
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
      case "fork": {
        const { owner, repo } = msg.payload as { owner: string; repo: string };
        if (owner && repo) {
          vscode.env.openExternal(vscode.Uri.parse(`https://github.com/${owner}/${repo}/fork`));
        }
        break;
      }
      case "viewRepo": {
        const { owner, repo } = msg.payload as { owner: string; repo: string };
        if (owner && repo) { vscode.commands.executeCommand("trending.viewRepoDetail", owner, repo); }
        break;
      }
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

  private async fetchRepos(): Promise<void> {
    try {
      const repos = await apiClient.getTrendingRepos(this._timeRange);
      if (authManager.isSignedIn && repos.length) {
        const slugs = repos.map((r) => `${r.owner}/${r.name}`);
        this._starredMap = await apiClient.batchCheckStarred(slugs);
      }
      const items = repos.map((r) => ({
        ...r,
        slug: `${r.owner}/${r.name}`,
        starred: this._starredMap[`${r.owner}/${r.name}`] ?? false,
      }));
      this.view?.webview.postMessage({ type: "setRepos", repos: items });
    } catch (err) {
      log(`[Explore] fetchRepos failed: ${err}`, "error");
      this.view?.webview.postMessage({ type: "error", message: "Failed to load trending repos." });
    }
  }

  private async fetchPeople(): Promise<void> {
    try {
      const people = await apiClient.getTrendingPeople();
      if (authManager.isSignedIn && people.length) {
        const logins = people.map((p) => p.login);
        const statuses = await apiClient.batchFollowStatus(logins);
        this._followMap = {};
        for (const [login, status] of Object.entries(statuses)) {
          this._followMap[login] = (status as { following: boolean }).following;
        }
      }
      const items = people.map((p) => ({
        ...p,
        following: this._followMap[p.login] ?? false,
        avatar_url: p.avatar_url || `https://github.com/${encodeURIComponent(p.login)}.png?size=72`,
      }));
      this.view?.webview.postMessage({ type: "setPeople", people: items });
    } catch (err) {
      log(`[Explore] fetchPeople failed: ${err}`, "error");
    }
  }

  private async fetchMyRepos(): Promise<void> {
    if (!authManager.isSignedIn) {
      this.view?.webview.postMessage({ type: "setMyRepos", data: { public: [], private: [], starred: [] } });
      return;
    }
    try {
      const [repos, starred] = await Promise.all([
        apiClient.getUserRepos().catch(() => []),
        apiClient.getStarredRepos().catch(() => []),
      ]);
      this.view?.webview.postMessage({
        type: "setMyRepos",
        data: {
          public: repos.filter((r) => !r.private),
          private: repos.filter((r) => r.private),
          starred,
        },
      });
    } catch (err) {
      log(`[Explore] fetchMyRepos failed: ${err}`, "error");
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

  startPolling(interval: number): void {
    this._interval = setInterval(() => this.fetchRepos(), interval);
  }

  dispose(): void { clearInterval(this._interval); }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const sharedCss = getUri(webview, this.extensionUri, ["media", "webview", "shared.css"]);
    const css = getUri(webview, this.extensionUri, ["media", "webview", "explore.css"]);
    const sharedJs = getUri(webview, this.extensionUri, ["media", "webview", "shared.js"]);
    const js = getUri(webview, this.extensionUri, ["media", "webview", "explore.js"]);
    return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} https:;">
<link rel="stylesheet" href="${sharedCss}"><link rel="stylesheet" href="${css}">
</head><body>
<div class="ex-tabs">
  <button class="ex-tab ex-tab-active" data-tab="repos">Repos</button>
  <button class="ex-tab" data-tab="people">People</button>
  <button class="ex-tab" data-tab="myrepos">My Repos</button>
</div>

<div class="ex-pane" data-pane="repos">
  <div class="ex-search-wrap">
    <input id="repos-search" class="ex-search-input" type="text" placeholder="Search repos…" autocomplete="off" spellcheck="false">
  </div>
  <div id="repos-ranges" class="ex-ranges">
    <button class="ex-range" data-range="daily">Today</button>
    <span class="ex-range-sep">·</span>
    <button class="ex-range ex-range-active" data-range="weekly">Week</button>
    <span class="ex-range-sep">·</span>
    <button class="ex-range" data-range="monthly">Month</button>
  </div>
  <div id="repos-list"></div>
</div>

<div class="ex-pane" data-pane="people" style="display:none">
  <div id="people-list"><div class="ex-loading">Loading…</div></div>
</div>

<div class="ex-pane" data-pane="myrepos" style="display:none">
  <div id="myrepos-list"><div class="ex-loading">Loading…</div></div>
</div>

<script nonce="${nonce}" src="${sharedJs}"></script>
<script nonce="${nonce}" src="${js}"></script>
</body></html>`;
  }
}

export let exploreWebviewProvider: ExploreWebviewProvider;

export const exploreModule: ExtensionModule = {
  id: "explore",
  activate(context) {
    exploreWebviewProvider = new ExploreWebviewProvider(context.extensionUri);
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(ExploreWebviewProvider.viewType, exploreWebviewProvider),
      { dispose: () => exploreWebviewProvider.dispose() },
    );
    exploreWebviewProvider.startPolling(configManager.current.trendingPollInterval);

    const followSub = onDidChangeFollow((e) => {
      exploreWebviewProvider.setFollowState(e.username, e.following);
    });
    context.subscriptions.push(followSub);
  },
};
