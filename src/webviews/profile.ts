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
      case "follow":
        try { await apiClient.followUser(this._username); vscode.window.showInformationMessage(`Following @${this._username}`); }
        catch { vscode.window.showErrorMessage("Failed to follow user"); }
        break;
      case "star":
        vscode.window.showInformationMessage(`Starred by @${this._username}`);
        break;
      case "message": vscode.commands.executeCommand("trending.messageUser", this._username); break;
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
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src https://dev.gitstar.ai; script-src 'nonce-${nonce}'; style-src ${webview.cspSource} 'unsafe-inline';">
      <style>body { margin: 0; padding: 0; overflow: hidden; } iframe { width: 100%; height: 100vh; border: none; }</style>
      <title>@${this._username}</title></head>
      <body>
        <iframe id="embed" src="https://dev.gitstar.ai/embed/user/${encodeURIComponent(this._username)}?theme=dark"></iframe>
        <script nonce="${nonce}">
          const vscode = acquireVsCodeApi();
          window.addEventListener('message', (e) => {
            if (e.data?.type === 'action') {
              switch (e.data.action) {
                case 'follow': vscode.postMessage({ type: 'follow' }); break;
                case 'star': vscode.postMessage({ type: 'star' }); break;
                case 'message': vscode.postMessage({ type: 'message' }); break;
                case 'openRepo': vscode.postMessage({ type: 'viewRepo', payload: e.data.payload }); break;
                case 'openProfile': vscode.postMessage({ type: 'viewProfile', payload: e.data.payload }); break;
                case 'openUrl': vscode.postMessage({ type: 'openUrl', payload: e.data.payload }); break;
              }
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
