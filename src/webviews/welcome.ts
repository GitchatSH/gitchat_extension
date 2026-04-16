import * as vscode from "vscode";
import { getNonce, getUri } from "../utils";
import type { ExtensionModule, WebviewMessage } from "../types";

class WelcomeWebviewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "gitchat.welcome";

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")],
    };
    webviewView.webview.html = this.getHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage((msg: WebviewMessage) => {
      if (msg.type === "signIn") {
        vscode.commands.executeCommand("gitchat.signIn");
      }
    });
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const sharedCss = getUri(webview, this.extensionUri, [
      "media",
      "webview",
      "shared.css",
    ]);
    const codiconCss = getUri(webview, this.extensionUri, [
      "media",
      "webview",
      "codicon.css",
    ]);
    const css = getUri(webview, this.extensionUri, [
      "media",
      "webview",
      "welcome.css",
    ]);
    const sharedJs = getUri(webview, this.extensionUri, [
      "media",
      "webview",
      "shared.js",
    ]);
    const js = getUri(webview, this.extensionUri, [
      "media",
      "webview",
      "welcome.js",
    ]);
    const iconUri = getUri(webview, this.extensionUri, ["media", "icon.png"]);

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
        <img src="${iconUri}" alt="GitChat" />
      </div>
      <div class="welcome-name">GitChat</div>
      <div class="welcome-tagline">The missing chat layer for GitHub</div>
    </div>

    <!-- Features — 3 GitHub gaps -->
    <div class="welcome-features">
      <div class="welcome-feature">
        <div class="welcome-feature-badge"><i class="codicon codicon-comment-discussion"></i></div>
        <div class="welcome-feature-body">
          <div class="welcome-feature-title">DM People You Follow</div>
          <div class="welcome-feature-desc">Message anyone you follow on GitHub</div>
        </div>
      </div>
      <div class="welcome-feature">
        <div class="welcome-feature-badge"><i class="codicon codicon-star-full"></i></div>
        <div class="welcome-feature-body">
          <div class="welcome-feature-title">Repo Communities</div>
          <div class="welcome-feature-desc">Join a channel for every repo you star</div>
        </div>
      </div>
      <div class="welcome-feature">
        <div class="welcome-feature-badge"><i class="codicon codicon-organization"></i></div>
        <div class="welcome-feature-body">
          <div class="welcome-feature-title">Contributor Channels</div>
          <div class="welcome-feature-desc">Collaborate with fellow contributors</div>
        </div>
      </div>
    </div>

    <!-- How it works -->
    <div class="welcome-steps-section">
      <div class="welcome-section-label">How it works</div>
      <div class="welcome-steps">
        <div class="welcome-step">
          <div class="welcome-step-num">1</div>
          <div class="welcome-step-body">
            <div class="welcome-step-title">Sign in with GitHub</div>
            <div class="welcome-step-desc">We only read your public profile</div>
          </div>
        </div>
        <div class="welcome-step">
          <div class="welcome-step-num">2</div>
          <div class="welcome-step-body">
            <div class="welcome-step-title">Discover your network</div>
            <div class="welcome-step-desc">Find followers, starred repos & teams</div>
          </div>
        </div>
        <div class="welcome-step">
          <div class="welcome-step-num">3</div>
          <div class="welcome-step-body">
            <div class="welcome-step-title">Start chatting</div>
            <div class="welcome-step-desc">DM, join communities, team up</div>
          </div>
        </div>
      </div>
    </div>

    <!-- CTA -->
    <div class="welcome-cta-wrap">
      <button id="cta-btn" class="welcome-cta">
        <svg viewBox="0 0 16 16">
          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
        </svg>
        Continue with GitHub
      </button>
      <div class="welcome-cta-note">No code access · GitHub OAuth</div>
    </div>

  </div>
  <script nonce="${nonce}" src="${sharedJs}"></script>
  <script nonce="${nonce}" src="${js}"></script>
</body></html>`;
  }
}

export const welcomeModule: ExtensionModule = {
  id: "welcome",
  activate(context) {
    const provider = new WelcomeWebviewProvider(context.extensionUri);
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(
        WelcomeWebviewProvider.viewType,
        provider,
      ),
    );
  },
};
