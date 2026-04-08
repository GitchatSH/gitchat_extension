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
  private _context?: vscode.ExtensionContext;

  constructor(private readonly extensionUri: vscode.Uri) {}

  setContext(context: vscode.ExtensionContext): void {
    this._context = context;
  }

  showSearch(): void {
    this.view?.webview.postMessage({ type: "showSearch" });
  }

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
      // The webview posts "showSearch" back to itself via the extension when the
      // title bar search icon is clicked — this is a no-op on the extension side
      // because the command handler posts "showSearch" directly to the webview.
      case "showSearch":
        break;
      case "getRecentSearches": {
        const recent = this._context?.globalState.get<string[]>("trending.recentSearches") ?? [];
        this.view?.webview.postMessage({ type: "recentSearches", searches: recent });
        break;
      }
      case "saveRecentSearch": {
        const q = ((p?.query) ?? "").trim();
        if (!q) { break; }
        const saved = this._context?.globalState.get<string[]>("trending.recentSearches") ?? [];
        const updated = [q, ...saved.filter((s) => s !== q)].slice(0, 10);
        this._context?.globalState.update("trending.recentSearches", updated);
        break;
      }
      case "clearRecentSearches": {
        this._context?.globalState.update("trending.recentSearches", []);
        break;
      }
      case "globalSearch": {
        const query = ((p?.query) ?? "").trim();
        if (!query) { break; }
        try {
          this.view?.webview.postMessage({ type: "setLoading" });
          const result = await apiClient.search(query);
          this.view?.webview.postMessage({
            type: "globalSearchResults",
            payload: { repos: result.repos ?? [], users: result.users ?? [] },
          });
        } catch (err) {
          log(`[Explore] globalSearch failed: ${err}`, "error");
          this.view?.webview.postMessage({ type: "globalSearchError" });
        }
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

<!-- Global Search Header (hidden by default, shown when trending.search command fires) -->
<div class="explore-header" id="explore-header" style="display:none">
  <div class="search-wrapper">
    <span class="search-icon codicon codicon-search"></span>
    <input type="text" class="gs-input" id="global-search" placeholder="Search repos &amp; people…" autocomplete="off" spellcheck="false">
    <button class="search-clear codicon codicon-close" id="search-clear" style="display:none" title="Clear search"></button>
  </div>
</div>

<!-- Tab Bar -->
<div class="ex-tabs">
  <button class="ex-tab ex-tab-active" data-tab="repos">Repos</button>
  <button class="ex-tab" data-tab="people">People</button>
  <button class="ex-tab" data-tab="myrepos">My Repos</button>
</div>

<!-- Repos pane -->
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

<!-- People pane -->
<div class="ex-pane" data-pane="people" style="display:none">
  <div id="people-list"><div class="ex-loading">Loading…</div></div>
</div>

<!-- My Repos pane -->
<div class="ex-pane" data-pane="myrepos" style="display:none">
  <div id="myrepos-list"><div class="ex-loading">Loading…</div></div>
</div>

<!-- Search Home (shown when search bar opens, before typing) -->
<div id="search-home" class="search-home" style="display:none">
  <div id="search-home-recent" class="search-home-section" style="display:none">
    <div class="search-home-header">
      <span class="search-home-title">Recent Searches</span>
      <button class="gs-btn-icon" id="search-clear-recent" title="Clear recent">&#x2715;</button>
    </div>
    <div id="search-home-recent-list"></div>
  </div>
  <div id="search-home-trending-repos" class="search-home-section" style="display:none">
    <div class="search-home-header">
      <span class="search-home-title">Trending Repos</span>
    </div>
    <div id="search-home-trending-repos-list"></div>
  </div>
  <div id="search-home-trending-people" class="search-home-section" style="display:none">
    <div class="search-home-header">
      <span class="search-home-title">Trending People</span>
    </div>
    <div id="search-home-trending-people-list"></div>
  </div>
</div>

<!-- Search Results -->
<div id="search-results" class="search-results" style="display:none">
  <div class="search-section" id="search-repos-section">
    <div style="display:flex;align-items:center;padding:4px 12px;height:32px;border-bottom:1px solid var(--gs-divider)">
      <span style="font-size:11px;font-weight:600;text-transform:uppercase;color:var(--gs-muted);letter-spacing:0.5px;flex:1">Repos</span>
      <span id="search-repos-count" style="font-size:11px;color:var(--gs-muted)"></span>
    </div>
    <div id="search-repos-list"></div>
  </div>
  <div class="search-section" id="search-people-section">
    <div style="display:flex;align-items:center;padding:4px 12px;height:32px;border-bottom:1px solid var(--gs-divider)">
      <span style="font-size:11px;font-weight:600;text-transform:uppercase;color:var(--gs-muted);letter-spacing:0.5px;flex:1">People</span>
      <span id="search-people-count" style="font-size:11px;color:var(--gs-muted)"></span>
    </div>
    <div id="search-people-list"></div>
  </div>
  <div id="search-empty" class="gs-empty" style="display:none"></div>
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
    exploreWebviewProvider.setContext(context);
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
