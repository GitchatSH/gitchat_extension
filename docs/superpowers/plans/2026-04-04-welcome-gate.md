# Welcome Gate & GitHub Auth Wall Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate 100% of extension functionality behind GitHub authentication with a high-conversion welcome view in the Explore sidebar.

**Architecture:** A new `WelcomeWebviewProvider` registered as the first view in `trendingSidebar`. All existing views get `when: "trending.isSignedIn"` so they hide when not authenticated. The welcome view shows when `!trending.isSignedIn` with hero, features, stats, founder quote, CTA, and expandable permissions. Chat sidebar's `chatPanel` also gated with a `viewsWelcome` fallback.

**Tech Stack:** VS Code Webview API, TypeScript, HTML/CSS (VS Code theme variables)

**Spec:** `docs/superpowers/specs/2026-04-04-welcome-gate-design.md`

---

### Task 1: Update package.json — add welcome view and gate all existing views

**Files:**
- Modify: `/Users/leebot/top-github-trending-repo-and-people/package.json`

- [ ] **Step 1: Add `trending.welcome` as the first view in `trendingSidebar`**

In `package.json` → `contributes.views.trendingSidebar`, insert at position 0:

```json
{
  "id": "trending.welcome",
  "name": "Welcome",
  "type": "webview",
  "visibility": "visible",
  "when": "!trending.isSignedIn"
}
```

- [ ] **Step 2: Add `when` clauses to ungated views**

In the same `trendingSidebar` array, add `"when": "trending.isSignedIn"` to these views that currently lack it:

- `trending.trendingRepos` → add `"when": "trending.isSignedIn"`
- `trending.trendingPeople` → add `"when": "trending.isSignedIn"`
- `trending.myRepos` → add `"when": "trending.isSignedIn"`

In `chatSidebar`, add to:
- `trending.chatPanel` → add `"when": "trending.isSignedIn"`

The final `views` section should look like:

```json
"views": {
  "trendingSidebar": [
    {
      "id": "trending.welcome",
      "name": "Welcome",
      "type": "webview",
      "visibility": "visible",
      "when": "!trending.isSignedIn"
    },
    {
      "id": "trending.feed",
      "name": "For You",
      "type": "webview",
      "visibility": "visible",
      "when": "trending.isSignedIn"
    },
    {
      "id": "trending.trendingRepos",
      "name": "Trending Repos",
      "visibility": "visible",
      "when": "trending.isSignedIn"
    },
    {
      "id": "trending.trendingPeople",
      "name": "Trending People",
      "visibility": "visible",
      "when": "trending.isSignedIn"
    },
    {
      "id": "trending.whoToFollow",
      "name": "Who to Follow",
      "type": "webview",
      "visibility": "collapsed",
      "when": "trending.isSignedIn"
    },
    {
      "id": "trending.myRepos",
      "name": "My Repos",
      "visibility": "collapsed",
      "when": "trending.isSignedIn"
    },
    {
      "id": "trending.notifications",
      "name": "Notifications",
      "type": "webview",
      "visibility": "collapsed",
      "when": "trending.isSignedIn"
    }
  ],
  "chatSidebar": [
    {
      "id": "trending.chatPanel",
      "name": "Messages",
      "type": "webview",
      "visibility": "visible",
      "when": "trending.isSignedIn"
    }
  ]
}
```

- [ ] **Step 3: Add activation event for welcome view**

In `activationEvents` array, add:

```json
"onView:trending.welcome"
```

- [ ] **Step 4: Verify package.json is valid JSON**

Run: `cd /Users/leebot/top-github-trending-repo-and-people && node -e "require('./package.json'); console.log('OK')"`

Expected: `OK`

- [ ] **Step 5: Commit**

```bash
cd /Users/leebot/top-github-trending-repo-and-people
git add package.json
git commit -m "feat(welcome): gate all views behind auth, add welcome view entry"
```

---

### Task 2: Create welcome.css

**Files:**
- Create: `/Users/leebot/top-github-trending-repo-and-people/media/webview/welcome.css`

- [ ] **Step 1: Create the CSS file**

```css
.welcome-container {
  padding: 20px 14px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* Hero */
.welcome-hero {
  text-align: center;
}

.welcome-logo {
  width: 48px;
  height: 48px;
  margin: 0 auto 10px;
  background: linear-gradient(135deg, #f38ba8, #cba6f7);
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.welcome-logo svg {
  width: 28px;
  height: 28px;
}

.welcome-app-name {
  font-size: 16px;
  font-weight: 700;
  color: var(--vscode-foreground);
  margin-bottom: 2px;
}

.welcome-tagline {
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
  line-height: 1.4;
}

/* Feature Grid */
.welcome-features {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.welcome-feature {
  background: var(--vscode-input-background);
  border-radius: 8px;
  padding: 10px;
  text-align: center;
}

.welcome-feature-icon {
  font-size: 18px;
  margin-bottom: 4px;
}

.welcome-feature-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--vscode-foreground);
}

.welcome-feature-desc {
  font-size: 10px;
  color: var(--vscode-descriptionForeground);
}

/* Counters */
.welcome-stats {
  background: var(--vscode-input-background);
  border-radius: 8px;
  padding: 12px;
  display: flex;
  justify-content: space-around;
  text-align: center;
}

.welcome-stat-value {
  font-size: 18px;
  font-weight: 700;
}

.welcome-stat-value.green { color: var(--vscode-charts-green, #a6e3a1); }
.welcome-stat-value.blue { color: var(--vscode-charts-blue, #89b4fa); }
.welcome-stat-value.yellow { color: var(--vscode-charts-yellow, #f9e2af); }

.welcome-stat-label {
  font-size: 9px;
  color: var(--vscode-descriptionForeground);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.welcome-stat-divider {
  width: 1px;
  background: var(--vscode-widget-border, #45475a);
}

/* Founder Quote */
.welcome-quote {
  background: var(--vscode-input-background);
  border-radius: 8px;
  padding: 12px;
  border-left: 3px solid #cba6f7;
}

.welcome-quote-text {
  font-size: 11px;
  color: var(--vscode-foreground);
  line-height: 1.5;
  font-style: italic;
}

.welcome-quote-author {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}

.welcome-quote-avatar {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--vscode-badge-background);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  color: var(--vscode-badge-foreground);
  overflow: hidden;
}

.welcome-quote-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.welcome-quote-name {
  font-size: 10px;
  font-weight: 600;
  color: var(--vscode-foreground);
}

.welcome-quote-role {
  font-size: 9px;
  color: var(--vscode-descriptionForeground);
}

/* CTA */
.welcome-cta {
  width: 100%;
  padding: 12px 16px;
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
  border: 1px solid var(--vscode-widget-border, #d0d7de);
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-family: var(--vscode-font-family);
}

.welcome-cta:hover {
  background: var(--vscode-button-secondaryHoverBackground);
}

.welcome-cta svg {
  width: 18px;
  height: 18px;
  fill: var(--vscode-button-secondaryForeground);
}

.welcome-cta-sub {
  text-align: center;
  font-size: 10px;
  color: var(--vscode-descriptionForeground);
  margin-top: 6px;
}

/* Permissions */
.welcome-permissions {
  background: var(--vscode-input-background);
  border-radius: 8px;
  overflow: hidden;
}

.welcome-permissions summary {
  padding: 10px 12px;
  font-size: 11px;
  color: var(--vscode-textLink-foreground);
  cursor: pointer;
  list-style: none;
  display: flex;
  align-items: center;
  gap: 6px;
}

.welcome-permissions summary::-webkit-details-marker {
  display: none;
}

.welcome-permissions-body {
  padding: 0 12px 12px;
  font-size: 10px;
  color: var(--vscode-descriptionForeground);
  line-height: 1.6;
}

.welcome-perm-item {
  margin-bottom: 4px;
}

.welcome-perm-item strong {
  color: var(--vscode-foreground);
}

.welcome-perm-divider {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--vscode-widget-border, #45475a);
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/leebot/top-github-trending-repo-and-people
git add media/webview/welcome.css
git commit -m "feat(welcome): add welcome view CSS with theme-aware variables"
```

---

### Task 3: Create welcome.js

**Files:**
- Create: `/Users/leebot/top-github-trending-repo-and-people/media/webview/welcome.js`

- [ ] **Step 1: Create the JS file**

```javascript
// @ts-check
const vscode = acquireVsCodeApi();

document.getElementById("cta-btn").addEventListener("click", () => {
  vscode.postMessage({ type: "signIn" });
});
```

- [ ] **Step 2: Commit**

```bash
cd /Users/leebot/top-github-trending-repo-and-people
git add media/webview/welcome.js
git commit -m "feat(welcome): add welcome view JS with sign-in postMessage"
```

---

### Task 4: Create WelcomeWebviewProvider

**Files:**
- Create: `/Users/leebot/top-github-trending-repo-and-people/src/webviews/welcome.ts`

- [ ] **Step 1: Create the provider file**

```typescript
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
      <div class="welcome-app-name">Gitchat</div>
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
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/leebot/top-github-trending-repo-and-people && npx tsc --noEmit`

Expected: No errors (or only pre-existing ones)

- [ ] **Step 3: Commit**

```bash
cd /Users/leebot/top-github-trending-repo-and-people
git add src/webviews/welcome.ts
git commit -m "feat(welcome): add WelcomeWebviewProvider with full welcome UI"
```

---

### Task 5: Register welcomeModule in extension.ts

**Files:**
- Modify: `/Users/leebot/top-github-trending-repo-and-people/src/extension.ts`

- [ ] **Step 1: Add import**

Add at the end of the import block (after line 21):

```typescript
import { welcomeModule } from "./webviews/welcome";
```

- [ ] **Step 2: Add to modules array**

Add `welcomeModule` to the `modules` array (after `chatModule` on line 40):

```typescript
const modules: ExtensionModule[] = [
  configModule,
  authModule,
  apiClientModule,
  realtimeModule,
  commandsModule,
  statusBarModule,
  trendingReposModule,
  trendingPeopleModule,
  whoToFollowWebviewModule,
  myReposModule,
  chatPanelWebviewModule,
  feedWebviewModule,
  notificationsWebviewModule,
  repoDetailModule,
  profileModule,
  chatModule,
  welcomeModule,
];
```

- [ ] **Step 3: Add to parallelModules array**

Add `welcomeModule` to the `parallelModules` array (at the beginning, since it's the first thing users see):

```typescript
const parallelModules: ExtensionModule[] = [
  welcomeModule,
  telemetryModule,
  statusBarModule, trendingReposModule, trendingPeopleModule,
  whoToFollowWebviewModule, myReposModule, chatPanelWebviewModule,
  feedWebviewModule, notificationsWebviewModule, repoDetailModule,
  profileModule, chatModule,
];
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd /Users/leebot/top-github-trending-repo-and-people && npx tsc --noEmit`

Expected: No errors

- [ ] **Step 5: Commit**

```bash
cd /Users/leebot/top-github-trending-repo-and-people
git add src/extension.ts
git commit -m "feat(welcome): register welcomeModule in extension activation"
```

---

### Task 6: Build, verify, and final commit

**Files:** None (verification only)

- [ ] **Step 1: Run full build**

Run: `cd /Users/leebot/top-github-trending-repo-and-people && npm run compile`

Expected: Build succeeds with no errors.

- [ ] **Step 2: Verify the bundle includes welcome files**

Run: `ls -la /Users/leebot/top-github-trending-repo-and-people/dist/extension.js && ls -la /Users/leebot/top-github-trending-repo-and-people/media/webview/welcome.*`

Expected: `dist/extension.js` exists (rebuilt), `media/webview/welcome.css` and `media/webview/welcome.js` exist.

- [ ] **Step 3: Verify package.json is valid for packaging**

Run: `cd /Users/leebot/top-github-trending-repo-and-people && node -e "const p = require('./package.json'); const views = p.contributes.views; console.log('trendingSidebar views:', views.trendingSidebar.map(v => v.id + ' when:' + (v.when || 'none'))); console.log('chatSidebar views:', views.chatSidebar.map(v => v.id + ' when:' + (v.when || 'none'))); console.log('activationEvents includes welcome:', p.activationEvents.includes('onView:trending.welcome'));"`

Expected output:
```
trendingSidebar views: [ 'trending.welcome when:!trending.isSignedIn', 'trending.feed when:trending.isSignedIn', 'trending.trendingRepos when:trending.isSignedIn', 'trending.trendingPeople when:trending.isSignedIn', 'trending.whoToFollow when:trending.isSignedIn', 'trending.myRepos when:trending.isSignedIn', 'trending.notifications when:trending.isSignedIn' ]
chatSidebar views: [ 'trending.chatPanel when:trending.isSignedIn' ]
activationEvents includes welcome: true
```

---

## Known Limitations

1. **Counters are hardcoded** — "15K+", "2.8K", "50K+" are static strings. A future iteration can fetch from a public API endpoint.
2. **Founder avatar requires HTTPS** — The `img-src` CSP allows `https:` so the GitHub avatar URL works. If the user is offline, the avatar falls back to the `L` initial in the CSS circle.
3. **Chat sidebar is empty when not signed in** — The `viewsWelcome` for `chatPanel` won't render because the view itself is hidden by `when` clause. Users will see an empty Chat sidebar with no guidance. This is acceptable since the Explore sidebar is the primary entry point.
