import * as vscode from "vscode";
import { getNonce, getUri } from "../utils";
import type { ExtensionModule, WebviewMessage } from "../types";

class WelcomeWebviewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "trending.welcome";

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")],
    };
    webviewView.webview.html = this.getHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage((msg: WebviewMessage) => {
      if (msg.type === "signIn") {
        vscode.commands.executeCommand("trending.signIn");
      }
    });
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const sharedCss = getUri(webview, this.extensionUri, ["media", "webview", "shared.css"]);
    const codiconCss = getUri(webview, this.extensionUri, ["media", "webview", "codicon.css"]);
    const css = getUri(webview, this.extensionUri, ["media", "webview", "welcome.css"]);
    const js = getUri(webview, this.extensionUri, ["media", "webview", "welcome.js"]);

    return `<!DOCTYPE html>
<html><head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} https:;">
  <link rel="stylesheet" href="${sharedCss}">
  <link rel="stylesheet" href="${codiconCss}">
  <link rel="stylesheet" href="${css}">
</head><body>
  <div class="welcome-container">

    <!-- Hero -->
    <div class="welcome-hero">
      <div class="welcome-logo">
        <svg viewBox="0 0 16 16" fill="white"><path d="M8 .25a.75.75 0 01.673.418l1.882 3.815 4.21.612a.75.75 0 01.416 1.279l-3.046 2.97.719 4.192a.75.75 0 01-1.088.791L8 12.347l-3.766 1.98a.75.75 0 01-1.088-.79l.72-4.194L.818 6.374a.75.75 0 01.416-1.28l4.21-.611L7.327.668A.75.75 0 018 .25z"/></svg>
      </div>
      <div class="welcome-app-name">Gitstar</div>
      <div class="welcome-tagline">A social network inside your IDE</div>
    </div>

    <!-- Features -->
    <div class="welcome-features">
      <div class="welcome-feature">
        <div class="welcome-feature-icon">🔥</div>
        <div class="welcome-feature-title">Trending</div>
        <div class="welcome-feature-desc">Repos & People</div>
      </div>
      <div class="welcome-feature">
        <div class="welcome-feature-icon">💬</div>
        <div class="welcome-feature-title">Real-time Chat</div>
        <div class="welcome-feature-desc">DMs & Groups</div>
      </div>
      <div class="welcome-feature">
        <div class="welcome-feature-icon">👥</div>
        <div class="welcome-feature-title">Follow Devs</div>
        <div class="welcome-feature-desc">Build network</div>
      </div>
      <div class="welcome-feature">
        <div class="welcome-feature-icon">📡</div>
        <div class="welcome-feature-title">Activity Feed</div>
        <div class="welcome-feature-desc">Stay in the loop</div>
      </div>
    </div>

    <!-- Stats -->
    <div class="welcome-stats">
      <div>
        <div class="welcome-stat-value green">15K+</div>
        <div class="welcome-stat-label">Repos tracked</div>
      </div>
      <div class="welcome-stat-divider"></div>
      <div>
        <div class="welcome-stat-value blue">2.8K</div>
        <div class="welcome-stat-label">Developers</div>
      </div>
      <div class="welcome-stat-divider"></div>
      <div>
        <div class="welcome-stat-value yellow">50K+</div>
        <div class="welcome-stat-label">Messages</div>
      </div>
    </div>

    <!-- Founder Quote -->
    <div class="welcome-quote">
      <div class="welcome-quote-text">"This is the beta. Find me in the chat and tell me what to build next — I ship updates within 24h."</div>
      <div class="welcome-quote-author">
        <div class="welcome-quote-avatar">
          <img src="https://github.com/leeknowsai.png?size=48" alt="leeknowsai">
        </div>
        <div>
          <div class="welcome-quote-name">@leeknowsai</div>
          <div class="welcome-quote-role">Founder</div>
        </div>
      </div>
    </div>

    <!-- CTA -->
    <button id="cta-btn" class="welcome-cta">
      <svg viewBox="0 0 16 16"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
      Continue with GitHub
    </button>
    <div class="welcome-cta-sub">Read-only access · No repo permissions</div>

    <!-- Permissions -->
    <details class="welcome-permissions">
      <summary>🔒 What permissions do we request?</summary>
      <div class="welcome-permissions-body">
        <div class="welcome-perm-item">
          <span style="color:var(--vscode-charts-green, #a6e3a1)">✓</span>
          <strong>read:user</strong> — Read your public profile info
        </div>
        <div class="welcome-perm-item">
          <span style="color:var(--vscode-charts-green, #a6e3a1)">✓</span>
          <strong>user:email</strong> — See your email for notifications
        </div>
        <div class="welcome-perm-item">
          <span style="color:var(--vscode-charts-green, #a6e3a1)">✓</span>
          <strong>repo</strong> — List your repos (read-only display)
        </div>
        <div class="welcome-perm-divider">
          <span style="color:var(--vscode-errorForeground, #f38ba8)">✗</span> We never write to your repositories<br>
          <span style="color:var(--vscode-errorForeground, #f38ba8)">✗</span> We never access private code
        </div>
      </div>
    </details>

  </div>
  <script nonce="${nonce}" src="${js}"></script>
</body></html>`;
  }
}

export const welcomeModule: ExtensionModule = {
  id: "welcome",
  activate(context) {
    const provider = new WelcomeWebviewProvider(context.extensionUri);
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(WelcomeWebviewProvider.viewType, provider),
    );
  },
};
