import * as vscode from "vscode";
import { log } from "../utils";

const WEBAPP_BASE = "https://dev.gitstar.ai";

class CommunityPanel {
  private static instances = new Map<string, CommunityPanel>();
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];

  private constructor(
    private readonly _id: string,
    panel: vscode.WebviewPanel,
    private readonly _owner: string,
    private readonly _repo: string
  ) {
    this._panel = panel;
    this._panel.webview.html = this.getHtml();
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
  }

  static show(extensionUri: vscode.Uri, owner: string, repo: string): void {
    const id = `community:${owner}/${repo}`;
    const existing = CommunityPanel.instances.get(id);
    if (existing) { existing._panel.reveal(); return; }
    const panel = vscode.window.createWebviewPanel(
      "trending.community",
      `${owner}/${repo} · Community`,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [extensionUri],
      }
    );
    const instance = new CommunityPanel(id, panel, owner, repo);
    CommunityPanel.instances.set(id, instance);
  }

  private getHtml(): string {
    const repoSlug = encodeURIComponent(`${this._owner}/${this._repo}`);
    const src = `${WEBAPP_BASE}/community?repo=${repoSlug}`;
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src ${WEBAPP_BASE}; style-src 'unsafe-inline';">
  <style>
    html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; }
    iframe { width: 100%; height: 100%; border: none; display: block; }
  </style>
  <title>Community</title>
</head>
<body>
  <iframe src="${src}" sandbox="allow-scripts allow-same-origin allow-forms allow-popups"></iframe>
</body>
</html>`;
  }

  private dispose(): void {
    CommunityPanel.instances.delete(this._id);
    this._panel.dispose();
    for (const d of this._disposables) { d.dispose(); }
    log(`[Community] panel closed for ${this._owner}/${this._repo}`);
  }
}

export { CommunityPanel };
