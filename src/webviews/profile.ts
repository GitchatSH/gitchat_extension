import * as vscode from "vscode";
import type { ExtensionModule, WebviewMessage } from "../types";
import { apiClient } from "../api";
import { getNonce, getUri, log } from "../utils";
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

  static async show(extensionUri: vscode.Uri, username: string): Promise<void> {
    const id = `profile:${username}`;
    const existing = ProfilePanel.instances.get(id);
    if (existing) { existing._panel.reveal(); return; }
    const panel = vscode.window.createWebviewPanel("trending.profile", `@${username}`, vscode.ViewColumn.One, {
      enableScripts: true, retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, "media")],
    });
    const instance = new ProfilePanel(id, panel, extensionUri, username);
    ProfilePanel.instances.set(id, instance);
    await instance.loadData();
  }

  private async loadData(): Promise<void> {
    try {
      const profile = await apiClient.getUserProfile(this._username);
      this._panel.webview.postMessage({ type: "setProfile", payload: profile });
    } catch (err) {
      log(`Gitstar profile failed, trying GitHub API: ${err}`, "warn");
      // Fallback: fetch directly from GitHub API
      try {
        const token = (await import("../auth")).authManager.token;
        const res = await fetch(`https://api.github.com/users/${this._username}`, {
          headers: token ? { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } : { Accept: "application/vnd.github+json" },
        });
        if (res.ok) {
          const gh = await res.json() as Record<string, unknown>;
          this._panel.webview.postMessage({ type: "setProfile", payload: {
            login: gh.login, name: gh.name, avatar_url: gh.avatar_url, bio: gh.bio,
            company: gh.company, location: gh.location, blog: gh.blog,
            followers: gh.followers, following: gh.following, public_repos: gh.public_repos,
            star_power: 0, top_repos: [],
          }});
        } else {
          this._panel.webview.postMessage({ type: "setProfile", payload: {
            login: this._username, name: this._username, avatar_url: `https://github.com/${this._username}.png`,
            bio: "", followers: 0, following: 0, public_repos: 0, star_power: 0, top_repos: [],
          }});
        }
      } catch {
        this._panel.webview.postMessage({ type: "setProfile", payload: {
          login: this._username, name: this._username, avatar_url: `https://github.com/${this._username}.png`,
          bio: "Failed to load profile", followers: 0, following: 0, public_repos: 0, star_power: 0, top_repos: [],
        }});
      }
    }
  }

  private async onMessage(msg: WebviewMessage): Promise<void> {
    const payload = msg.payload as { owner?: string; repo?: string } | undefined;
    switch (msg.type) {
      case "follow":
        try { await apiClient.followUser(this._username); vscode.window.showInformationMessage(`Following @${this._username}`); }
        catch { vscode.window.showErrorMessage("Failed to follow user"); }
        break;
      case "message": vscode.commands.executeCommand("trending.messageUser", this._username); break;
      case "github": vscode.env.openExternal(vscode.Uri.parse(`https://github.com/${this._username}`)); break;
      case "viewRepo":
        if (payload?.owner && payload?.repo) { RepoDetailPanel.show(this._extensionUri, payload.owner, payload.repo); }
        break;
    }
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const styleUri = getUri(webview, this._extensionUri, ["media", "webview", "profile.css"]);
    const scriptUri = getUri(webview, this._extensionUri, ["media", "webview", "profile.js"]);
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} https:;">
      <link href="${styleUri}" rel="stylesheet"><title>Profile</title></head>
      <body><div id="content"><p style="padding:20px;color:var(--vscode-descriptionForeground)">Loading...</p></div><script nonce="${nonce}" src="${scriptUri}"></script></body></html>`;
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
