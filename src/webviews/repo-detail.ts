import * as vscode from "vscode";
import { marked } from "marked";
import type { ExtensionModule, WebviewMessage } from "../types";
import { apiClient } from "../api";
import { getNonce, getUri, log } from "../utils";

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

  static async show(extensionUri: vscode.Uri, owner: string, repo: string): Promise<void> {
    const id = `repoDetail:${owner}/${repo}`;
    const existing = RepoDetailPanel.instances.get(id);
    if (existing) { existing._panel.reveal(); return; }
    const panel = vscode.window.createWebviewPanel("trending.repoDetail", `${owner}/${repo}`, vscode.ViewColumn.One, {
      enableScripts: true, retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, "media")],
    });
    const instance = new RepoDetailPanel(id, panel, extensionUri, owner, repo);
    RepoDetailPanel.instances.set(id, instance);
    await instance.loadData();
  }

  private async loadData(attempt = 0): Promise<void> {
    try {
      const detail = await apiClient.getRepoDetail(this._owner, this._repo);
      // Convert markdown README to HTML
      const detailAny = detail as unknown as Record<string, string>;
      const readme = detailAny.readme || detailAny.readme_html || "";
      if (readme && !readme.startsWith("<")) {
        try {
          detailAny.readme_html = await marked.parse(readme, { gfm: true, breaks: true });
        } catch {
          detailAny.readme_html = readme;
        }
      } else {
        detailAny.readme_html = readme;
      }
      this._panel.webview.postMessage({ type: "setRepo", payload: detail });
    } catch (err) {
      const axiosErr = err as { response?: { status?: number } };
      if (axiosErr.response?.status === 429 && attempt < 3) {
        const delay = (attempt + 1) * 2000;
        log(`[RepoDetail] 429 rate limited, retrying in ${delay}ms (attempt ${attempt + 1})`, "warn");
        await new Promise(r => setTimeout(r, delay));
        return this.loadData(attempt + 1);
      }
      // Fallback: fetch via webapp proxy (has its own cache layer)
      log(`Gitstar API failed for repo, trying webapp proxy: ${err}`, "warn");
      try {
        const res = await fetch(`https://dev.gitstar.ai/api/repo/${encodeURIComponent(this._owner)}/${encodeURIComponent(this._repo)}`);
        if (res.ok) {
          const json = await res.json() as Record<string, unknown>;
          const data = (json.data ?? json) as Record<string, unknown>;
          const repoData = (data.repo ?? data) as Record<string, string>;
          const readme = repoData.readme || repoData.readme_html || "";
          if (readme && !readme.startsWith("<")) {
            try { repoData.readme_html = await marked.parse(readme, { gfm: true, breaks: true }); } catch { repoData.readme_html = readme; }
          } else { repoData.readme_html = readme; }
          this._panel.webview.postMessage({ type: "setRepo", payload: {
            ...repoData, owner: repoData.owner ?? this._owner, name: repoData.name ?? this._repo,
            contributors: (data as Record<string, unknown>).contributors ?? [],
          }});
          return;
        }
      } catch (proxyErr) {
        log(`Webapp proxy also failed for repo: ${proxyErr}`, "warn");
      }
      log(`Failed to load repo detail: ${err}`, "error");
      this._panel.webview.postMessage({
        type: "setRepo",
        payload: { name: this._repo, description: "Failed to load repo details",
          stars: 0, forks: 0, watchers: 0, topics: [], contributors: [],
          avatar_url: "", star_power: 0, readme_html: "", owner: this._owner, language: "", homepage: "" },
      });
    }
  }

  private async onMessage(msg: WebviewMessage): Promise<void> {
    switch (msg.type) {
      case "star":
        try { await apiClient.starRepo(this._owner, this._repo); vscode.window.showInformationMessage(`Starred ${this._owner}/${this._repo}`); }
        catch { vscode.window.showErrorMessage("Failed to star repo"); }
        break;
      case "github":
        vscode.env.openExternal(vscode.Uri.parse(`https://github.com/${this._owner}/${this._repo}`));
        break;
    }
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const styleUri = getUri(webview, this._extensionUri, ["media", "webview", "repo-detail.css"]);
    const scriptUri = getUri(webview, this._extensionUri, ["media", "webview", "repo-detail.js"]);
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} https:;">
      <link href="${styleUri}" rel="stylesheet"><title>Repo Detail</title></head>
      <body><div id="content"><p style="padding:20px;color:var(--vscode-descriptionForeground)">Loading...</p></div><script nonce="${nonce}" src="${scriptUri}"></script></body></html>`;
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
