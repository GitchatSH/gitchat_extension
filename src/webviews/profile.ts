import * as vscode from "vscode";
import type { ExtensionModule, WebviewMessage } from "../types";
import { apiClient } from "../api";
import { getNonce, getUri, log } from "../utils";
import { fireFollowChanged, onDidChangeFollow } from "../events/follow";

const WEBAPP_PROXY = "https://dev.gitstar.ai";

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
    // Listen for follow changes from other sources (sidebar, other panels)
    this._disposables.push(onDidChangeFollow((e) => {
      if (e.username === this._username) {
        this._panel.webview.postMessage({
          type: "actionResult", action: e.following ? "follow" : "unfollow", success: true,
        });
      }
    }));
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

  private async loadProfile(): Promise<void> {
    try {
      // Fetch from webapp proxy (cached, no auth needed for public profiles)
      const res = await fetch(`${WEBAPP_PROXY}/api/user/${encodeURIComponent(this._username)}`);
      if (!res.ok) { throw new Error(`HTTP ${res.status}`); }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const json: any = await res.json();
      const raw = json.data ?? json;
      log(`[Profile] loaded @${this._username} via webapp proxy`);
      const profile = raw.profile ?? raw;
      if (!profile.top_repos && raw.repos) {
        profile.top_repos = raw.repos;
      }
      this._panel.webview.postMessage({ type: "setProfile", payload: profile });
    } catch (err: unknown) {
      log(`[Profile] Webapp proxy failed for @${this._username}: ${err}, falling back to API`, "warn");
      // Fallback to direct API
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const raw: any = await apiClient.getUserProfile(this._username);
        const profile = raw.profile ?? raw;
        if (!profile.top_repos && raw.repos) { profile.top_repos = raw.repos; }
        this._panel.webview.postMessage({ type: "setProfile", payload: profile });
      } catch (err2: unknown) {
        const axiosErr = err2 as { response?: { status?: number; data?: unknown }; message?: string };
        const detail = axiosErr.response?.data ? JSON.stringify(axiosErr.response.data).slice(0, 300) : axiosErr.message;
        log(`[Profile] Failed to load @${this._username}: ${axiosErr.response?.status} ${detail}`, "error");
        this._panel.webview.postMessage({ type: "setError", message: "Failed to load profile" });
      }
    }
  }

  private async onMessage(msg: WebviewMessage): Promise<void> {
    const payload = msg.payload as { owner?: string; repo?: string; url?: string; username?: string } | undefined;
    switch (msg.type) {
      case "ready":
        this.loadProfile();
        break;
      case "follow": {
        const target = payload?.username || this._username;
        try {
          await apiClient.followUser(target);
          vscode.window.showInformationMessage(`Following @${target}`);
          this._panel.webview.postMessage({ type: "actionResult", action: "follow", success: true });
          fireFollowChanged(target, true);
        } catch (err) {
          log(`[Profile] follow FAILED for @${target}: ${err}`, "error");
          vscode.window.showErrorMessage(`Failed to follow @${target}`);
        }
        break;
      }
      case "unfollow": {
        const unfTarget = payload?.username || this._username;
        try {
          await apiClient.unfollowUser(unfTarget);
          this._panel.webview.postMessage({ type: "actionResult", action: "unfollow", success: true });
          fireFollowChanged(unfTarget, false);
        } catch (err) {
          log(`[Profile] unfollow FAILED for @${unfTarget}: ${err}`, "error");
          vscode.window.showErrorMessage(`Failed to unfollow @${unfTarget}`);
        }
        break;
      }
      case "message":
        vscode.commands.executeCommand("trending.messageUser", payload?.username || this._username);
        break;
      case "github":
        vscode.env.openExternal(vscode.Uri.parse(`https://dev.gitstar.ai/@${this._username}`));
        break;
      case "viewRepo": {
        if (payload?.owner && payload?.repo) {
          vscode.env.openExternal(vscode.Uri.parse(`https://github.com/${payload.owner}/${payload.repo}`));
        }
        break;
      }
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
    const codiconCss = getUri(webview, this._extensionUri, ["media", "webview", "codicon.css"]);
    const css = getUri(webview, this._extensionUri, ["media", "webview", "profile.css"]);
    const js = getUri(webview, this._extensionUri, ["media", "webview", "profile.js"]);
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} https:;">
      <link rel="stylesheet" href="${codiconCss}">
      <link rel="stylesheet" href="${css}">
      <title>@${this._username}</title></head>
      <body>
        <div id="content"><div class="pf-loading">Loading profile...</div></div>
        <script nonce="${nonce}" src="${js}"></script>
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
