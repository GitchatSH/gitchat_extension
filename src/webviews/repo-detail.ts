import * as vscode from "vscode";
import { marked } from "marked";
import type { ExtensionModule, WebviewMessage } from "../types";
import { apiClient } from "../api";
import { getNonce, getUri, log } from "../utils";
import { fireFollowChanged } from "../events/follow";
import { trendingReposWebviewProvider } from "./trending-repos";
import { exploreWebviewProvider } from "./explore";

const WEBAPP_PROXY = "https://dev.gitstar.ai";

class RepoDetailPanel {
  private static instances = new Map<string, RepoDetailPanel>();
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];

  private constructor(
    private readonly _id: string,
    panel: vscode.WebviewPanel,
    private readonly _extensionUri: vscode.Uri,
    private readonly _owner: string,
    private readonly _repo: string
  ) {
    this._panel = panel;
    this._panel.webview.html = this.getHtml(this._panel.webview);
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._panel.webview.onDidReceiveMessage(
      (msg: WebviewMessage) => this.onMessage(msg), null, this._disposables
    );
  }

  static show(extensionUri: vscode.Uri, owner: string, repo: string): void {
    const id = `repoDetail:${owner}/${repo}`;
    const existing = RepoDetailPanel.instances.get(id);
    if (existing) { existing._panel.reveal(); return; }
    const panel = vscode.window.createWebviewPanel("trending.repoDetail", `${owner}/${repo}`, vscode.ViewColumn.One, {
      enableScripts: true, retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, "media")],
    });
    const instance = new RepoDetailPanel(id, panel, extensionUri, owner, repo);
    RepoDetailPanel.instances.set(id, instance);
  }

  private async loadRepo(): Promise<void> {
    try {
      // Fetch from webapp proxy (cached, no auth needed for public repos)
      const res = await fetch(`${WEBAPP_PROXY}/api/repo/${encodeURIComponent(this._owner)}/${encodeURIComponent(this._repo)}`);
      if (!res.ok) { throw new Error(`HTTP ${res.status}`); }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const json: any = await res.json();
      const raw = json.data ?? json;
      log(`[RepoDetail] loaded ${this._owner}/${this._repo} via webapp proxy`);
      const repoData = raw.repo ?? raw;
      const slug = `${this._owner}/${this._repo}`;
      const repo = {
        ...repoData,
        owner: repoData.owner ?? this._owner,
        name: repoData.name ?? this._repo,
        stars: repoData.stargazers_count ?? repoData.stars ?? 0,
        forks: repoData.forks_count ?? repoData.forks ?? 0,
        watchers: repoData.watchers_count ?? repoData.watchers ?? 0,
        avatar_url: repoData.owner?.avatar_url ?? `https://github.com/${this._owner}.png`,
        contributors: raw.contributors ?? [],
        readme_html: raw.readme ? await marked.parse(raw.readme) : "",
        starred: trendingReposWebviewProvider?.getStarredState(slug) ?? false,
      };
      this._panel.webview.postMessage({ type: "setRepo", payload: repo });
    } catch (err) {
      log(`[RepoDetail] Webapp proxy failed for ${this._owner}/${this._repo}: ${err}, falling back to API`, "warn");
      try {
        const repoRaw = await apiClient.getRepoDetail(this._owner, this._repo);
        const slug = `${this._owner}/${this._repo}`;
        const repo = { ...repoRaw, starred: trendingReposWebviewProvider?.getStarredState(slug) ?? false };
        this._panel.webview.postMessage({ type: "setRepo", payload: repo });
      } catch (err2) {
        log(`[RepoDetail] Failed to load ${this._owner}/${this._repo}: ${err2}`, "error");
        this._panel.webview.postMessage({ type: "setError", message: "Failed to load repository" });
      }
    }
  }

  private async onMessage(msg: WebviewMessage): Promise<void> {
    const payload = msg.payload as { owner?: string; repo?: string; url?: string; username?: string } | undefined;
    switch (msg.type) {
      case "ready":
        this.loadRepo();
        break;
      case "star": {
        const starOwner = payload?.owner || this._owner;
        const starRepo = payload?.repo || this._repo;
        const slug = `${starOwner}/${starRepo}`;
        try {
          await apiClient.starRepo(starOwner, starRepo);
          this._panel.webview.postMessage({ type: "actionResult", action: "star", success: true });
          trendingReposWebviewProvider?.notifyStarChange(slug, true);
          exploreWebviewProvider?.notifyStarChange(slug, true);
        } catch (err) {
          log(`[RepoDetail] star FAILED for ${slug}: ${err}`, "error");
          vscode.window.showErrorMessage(`Failed to star ${slug}`);
        }
        break;
      }
      case "unstar": {
        const unstarOwner = payload?.owner || this._owner;
        const unstarRepo = payload?.repo || this._repo;
        const unstarSlug = `${unstarOwner}/${unstarRepo}`;
        try {
          await apiClient.unstarRepo(unstarOwner, unstarRepo);
          this._panel.webview.postMessage({ type: "actionResult", action: "unstar", success: true });
          trendingReposWebviewProvider?.notifyStarChange(unstarSlug, false);
          exploreWebviewProvider?.notifyStarChange(unstarSlug, false);
        } catch (err) {
          log(`[RepoDetail] unstar FAILED for ${unstarSlug}: ${err}`, "error");
          vscode.window.showErrorMessage(`Failed to unstar ${unstarSlug}`);
        }
        break;
      }
      case "follow":
        if (payload?.username) {
          try {
            await apiClient.followUser(payload.username);
            this._panel.webview.postMessage({ type: "actionResult", action: "follow", success: true });
            fireFollowChanged(payload.username, true);
          } catch {
            vscode.window.showErrorMessage("Failed to follow user");
          }
        }
        break;
      case "github":
        vscode.env.openExternal(vscode.Uri.parse(`https://dev.gitstar.ai/${this._owner}/${this._repo}`));
        break;
      case "viewRepo":
        if (payload?.owner && payload?.repo) { RepoDetailPanel.show(this._extensionUri, payload.owner, payload.repo); }
        break;
      case "viewProfile": {
        const { ProfilePanel } = await import("./profile");
        if (payload?.username) { ProfilePanel.show(this._extensionUri, payload.username); }
        break;
      }
      case "openUrl":
        if (payload?.url) { vscode.env.openExternal(vscode.Uri.parse(payload.url)); }
        break;
    }
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const codiconCss = getUri(webview, this._extensionUri, ["media", "webview", "codicon.css"]);
    const css = getUri(webview, this._extensionUri, ["media", "webview", "repo-detail.css"]);
    const js = getUri(webview, this._extensionUri, ["media", "webview", "repo-detail.js"]);
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} https:;">
      <link rel="stylesheet" href="${codiconCss}">
      <link rel="stylesheet" href="${css}">
      <title>${this._owner}/${this._repo}</title></head>
      <body>
        <div id="content"><div class="rd-loading">Loading repository...</div></div>
        <script nonce="${nonce}" src="${js}"></script>
      </body></html>`;
  }

  private dispose(): void {
    RepoDetailPanel.instances.delete(this._id);
    this._panel.dispose();
    for (const d of this._disposables) { d.dispose(); }
  }
}

export const repoDetailModule: ExtensionModule = {
  id: "repoDetail",
  activate(_context) { log("Repo detail module activated"); },
};

export { RepoDetailPanel };
