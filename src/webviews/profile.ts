import * as vscode from "vscode";
import type { ExtensionModule, WebviewMessage } from "../types";
import { apiClient } from "../api";
import { getNonce, log } from "../utils";
import { RepoDetailPanel } from "./repo-detail";

class ProfilePanel {
  private static instances = new Map<string, ProfilePanel>();
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];

  private constructor(
    private readonly _id: string, panel: vscode.WebviewPanel,
    private readonly _extensionUri: vscode.Uri, private readonly _username: string
  ) {
    this._panel = panel;
    this._panel.webview.html = this.getHtml(this._panel.webview);
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._panel.webview.onDidReceiveMessage((msg: WebviewMessage) => this.onMessage(msg), null, this._disposables);
  }

  static show(extensionUri: vscode.Uri, username: string): void {
    const id = `profile:${username}`;
    const existing = ProfilePanel.instances.get(id);
    if (existing) { existing._panel.reveal(); return; }
    const panel = vscode.window.createWebviewPanel("trending.profile", `@${username}`, vscode.ViewColumn.One, {
      enableScripts: true, retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, "media")],
    });
    const instance = new ProfilePanel(id, panel, extensionUri, username);
    ProfilePanel.instances.set(id, instance);
  }

  private async onMessage(msg: WebviewMessage): Promise<void> {
    const payload = msg.payload as { owner?: string; repo?: string; url?: string; username?: string } | undefined;
    switch (msg.type) {
      case "follow": {
        const target = payload?.username || this._username;
        try { await apiClient.followUser(target); vscode.window.showInformationMessage(`Following @${target}`); }
        catch { vscode.window.showErrorMessage("Failed to follow user"); }
        break;
      }
      case "star":
        if (payload?.owner && payload?.repo) {
          try { await apiClient.starRepo(payload.owner, payload.repo); vscode.window.showInformationMessage(`Starred ${payload.owner}/${payload.repo}`); }
          catch { vscode.window.showErrorMessage("Failed to star repo"); }
        }
        break;
      case "message": vscode.commands.executeCommand("trending.messageUser", payload?.username || this._username); break;
      case "github": vscode.env.openExternal(vscode.Uri.parse(`https://github.com/${this._username}`)); break;
      case "viewRepo":
        if (payload?.owner && payload?.repo) { RepoDetailPanel.show(this._extensionUri, payload.owner, payload.repo); }
        break;
      case "viewProfile":
        if (payload?.username) { ProfilePanel.show(this._extensionUri, payload.username); }
        break;
      case "openUrl":
        if (payload?.url) { vscode.env.openExternal(vscode.Uri.parse(payload.url)); }
        break;
    }
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src https://dev.gitstar.ai; script-src 'nonce-${nonce}'; style-src ${webview.cspSource} 'unsafe-inline'; connect-src https://dev.gitstar.ai;">
      <style>body { margin: 0; padding: 0; overflow: hidden; } iframe { width: 100%; height: 100vh; border: none; }</style>
      <title>@${this._username}</title></head>
      <body>
        <iframe id="embed" src="https://dev.gitstar.ai/embed/user/${encodeURIComponent(this._username)}?theme=dark" allow="clipboard-write"></iframe>
        <script nonce="${nonce}">
          const vscode = acquireVsCodeApi();
          // Listen for postMessage from iframe (cross-origin)
          window.addEventListener('message', (e) => {
            const d = e.data;
            // Forward iframe actions to extension host
            if (d?.type === 'action') {
              const p = { username: d.username, owner: d.owner, repo: d.repo, url: d.url };
              vscode.postMessage({ type: d.action, payload: p });
              return;
            }
          });
        </script>
      </body></html>`;
  }

  private dispose(): void {
    ProfilePanel.instances.delete(this._id);
    this._panel.dispose();
    for (const d of this._disposables) { d.dispose(); }
  }
}

export const profileModule: ExtensionModule = {
  id: "profile",
  activate(_context) { log("Profile module activated"); },
};

export { ProfilePanel };
