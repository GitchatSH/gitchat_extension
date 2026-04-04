import * as vscode from "vscode";
import type { ExtensionModule, WebviewMessage } from "../types";
import { apiClient } from "../api";
import { getNonce, log } from "../utils";

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
    // Sync theme changes to iframe
    this._disposables.push(vscode.window.onDidChangeActiveColorTheme(() => {
      const kind = vscode.window.activeColorTheme.kind;
      const theme = kind === 1 || kind === 4 ? "light" : "dark";
      this._panel.webview.postMessage({ type: "setTheme", theme });
    }));
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

  private async onMessage(msg: WebviewMessage): Promise<void> {
    log(`[RepoDetail] onMessage: ${JSON.stringify(msg).slice(0, 300)}`);
    const payload = msg.payload as { owner?: string; repo?: string; url?: string; username?: string } | undefined;
    switch (msg.type) {
      case "star": {
        const starOwner = payload?.owner || this._owner;
        const starRepo = payload?.repo || this._repo;
        log(`[RepoDetail] star action for ${starOwner}/${starRepo}`);
        try {
          await apiClient.starRepo(starOwner, starRepo);
          log(`[RepoDetail] star SUCCESS for ${starOwner}/${starRepo}`);
          vscode.window.showInformationMessage(`Starred ${starOwner}/${starRepo}`);
          this._panel.webview.postMessage({ type: "actionResult", action: "star", success: true });
        } catch (err) {
          log(`[RepoDetail] star FAILED: ${err}`, "error");
          vscode.window.showErrorMessage(`Failed to star ${starOwner}/${starRepo}`);
        }
        break;
      }
      case "follow":
        if (payload?.username) {
          try { await apiClient.followUser(payload.username); vscode.window.showInformationMessage(`Following @${payload.username}`); }
          catch { vscode.window.showErrorMessage("Failed to follow user"); }
        }
        break;
      case "github":
        vscode.env.openExternal(vscode.Uri.parse(`https://github.com/${this._owner}/${this._repo}`));
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
    const kind = vscode.window.activeColorTheme.kind;
    const theme = kind === 1 || kind === 4 ? "light" : "dark";
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src https://dev.gitstar.ai; script-src 'nonce-${nonce}'; style-src ${webview.cspSource} 'unsafe-inline'; connect-src https://dev.gitstar.ai;">
      <style>body { margin: 0; padding: 0; overflow: hidden; } iframe { width: 100%; height: 100vh; border: none; }</style>
      <title>${this._owner}/${this._repo}</title></head>
      <body>
        <iframe id="embed" src="https://dev.gitstar.ai/embed/${encodeURIComponent(this._owner)}/${encodeURIComponent(this._repo)}?theme=${theme}" allow="clipboard-write"></iframe>
        <script nonce="${nonce}">
          const vscode = acquireVsCodeApi();
          const iframe = document.getElementById('embed');
          window.addEventListener('message', (e) => {
            const d = e.data;
            if (d?.type === 'action') {
              const p = { username: d.username, owner: d.owner, repo: d.repo, url: d.url };
              vscode.postMessage({ type: d.action, payload: p });
              return;
            }
            if ((d?.type === 'setTheme' || d?.type === 'actionResult') && iframe) {
              iframe.contentWindow.postMessage(d, '*');
            }
          });
        </script>
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
