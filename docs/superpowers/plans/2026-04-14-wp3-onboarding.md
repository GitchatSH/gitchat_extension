# WP3: Onboarding (First-time User) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a floating welcome modal on the Discover tab after a user's first sign-in, then default to Chat tab on subsequent opens.

**Architecture:** The onboarding modal lives entirely in the webview layer. Extension host checks a per-user `globalState` flag after sign-in and sends a `showOnboarding` message to the webview. The webview switches to the Discover tab and injects a modal overlay. Clicking the CTA dismisses the modal and persists the flag via `onboardingComplete` message back to the host.

**Tech Stack:** TypeScript (extension host), vanilla JS/CSS (webview), VS Code globalState API, Codicons

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `media/webview/explore.css` | Modify (append) | Onboarding overlay + card styles |
| `media/webview/explore.js` | Modify | Handle `showOnboarding` message, render modal, CTA dismiss, send `onboardingComplete` |
| `src/webviews/explore.ts` | Modify | Handle `onboardingComplete` message, persist flag, expose `sendOnboarding()` method |
| `src/auth/index.ts` | Modify | Check flag after sign-in, trigger onboarding flow for first-time users |
| `src/commands/index.ts` | Modify | Register `gitchat.resetOnboarding` dev command |
| `package.json` | Modify | Declare `gitchat.resetOnboarding` command |

---

### Task 1: Onboarding CSS styles

**Files:**
- Modify: `media/webview/explore.css:1074` (append at end)

- [ ] **Step 1: Add onboarding overlay and card styles to explore.css**

Append the following CSS block at the end of `media/webview/explore.css`, after the `.ex-loading` rule (line 1074):

```css
/* ── Onboarding overlay (WP3) ─────────────────────────────── */
#gs-onboarding-overlay {
  position: absolute;
  inset: 0;
  background: var(--gs-scrim);
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--gs-inset-x);
}

.gs-onboarding-card {
  background: var(--gs-widget-bg);
  border: 1px solid var(--gs-widget-border);
  border-radius: var(--gs-radius-lg);
  padding: 20px 16px;
  text-align: center;
  width: 100%;
  max-width: 280px;
}

.gs-onboarding-card h3 {
  font-size: var(--gs-font-md);
  color: var(--gs-fg);
  margin: 0 0 8px;
}

.gs-onboarding-subtitle {
  font-size: var(--gs-font-sm);
  color: var(--gs-muted);
  line-height: 1.5;
  margin: 0 0 16px;
}

.gs-onboarding-sections {
  text-align: left;
  margin-bottom: 16px;
}

.gs-onboarding-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  border-bottom: 1px solid var(--gs-divider-muted);
}

.gs-onboarding-row:last-child {
  border-bottom: none;
}

.gs-onboarding-row .codicon {
  font-size: var(--gs-font-md);
  color: var(--gs-link);
  flex-shrink: 0;
}

.gs-onboarding-label {
  font-size: var(--gs-font-sm);
  color: var(--gs-fg);
}

.gs-onboarding-desc {
  font-size: var(--gs-font-xs);
  color: var(--gs-muted);
}

.gs-onboarding-cta {
  width: 100%;
  margin-top: 4px;
}
```

- [ ] **Step 2: Verify CSS uses only design tokens**

Confirm no hardcoded colors or font sizes — all values must use `--gs-*` tokens. Check:
- `--gs-scrim`, `--gs-widget-bg`, `--gs-widget-border` exist in `media/webview/shared.css`
- `--gs-radius-lg`, `--gs-inset-x`, `--gs-divider-muted` exist in `media/webview/shared.css`
- Font sizes use `--gs-font-md`, `--gs-font-sm`, `--gs-font-xs` (all ≥ 11px)

- [ ] **Step 3: Commit**

```bash
git add media/webview/explore.css
git commit -m "style(onboarding): add WP3 welcome modal overlay CSS"
```

---

### Task 2: Webview onboarding render + dismiss logic

**Files:**
- Modify: `media/webview/explore.js:1543-1544` (add case in message handler switch, before closing `}`)
- Modify: `media/webview/explore.js` (add `renderOnboardingOverlay` and `dismissOnboarding` functions near `renderDiscover` at ~line 820)

- [ ] **Step 1: Add `renderOnboardingOverlay` and `dismissOnboarding` functions**

Insert the following two functions in `media/webview/explore.js`, just before the `renderDiscover` function (before line 821):

```javascript
// ===================== ONBOARDING (WP3) =====================
function renderOnboardingOverlay() {
  var container = document.getElementById("discover-content");
  if (!container) return;
  // Don't render if already showing
  if (document.getElementById("gs-onboarding-overlay")) return;

  var html =
    '<div id="gs-onboarding-overlay">' +
      '<div class="gs-onboarding-card">' +
        '<h3>Welcome to GitChat!</h3>' +
        '<p class="gs-onboarding-subtitle">Discover people, communities, and teams — all inside VS Code.</p>' +
        '<div class="gs-onboarding-sections">' +
          '<div class="gs-onboarding-row">' +
            '<span class="codicon codicon-person"></span>' +
            '<div>' +
              '<div class="gs-onboarding-label">People</div>' +
              '<div class="gs-onboarding-desc">Your GitHub follows</div>' +
            '</div>' +
          '</div>' +
          '<div class="gs-onboarding-row">' +
            '<span class="codicon codicon-comment-discussion"></span>' +
            '<div>' +
              '<div class="gs-onboarding-label">Communities</div>' +
              '<div class="gs-onboarding-desc">Repo-based group chats</div>' +
            '</div>' +
          '</div>' +
          '<div class="gs-onboarding-row">' +
            '<span class="codicon codicon-organization"></span>' +
            '<div>' +
              '<div class="gs-onboarding-label">Teams</div>' +
              '<div class="gs-onboarding-desc">Collaborate with contributors</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<button class="gs-btn gs-btn-primary gs-onboarding-cta">Start Exploring</button>' +
      '</div>' +
    '</div>';

  container.insertAdjacentHTML("beforeend", html);

  var cta = container.querySelector(".gs-onboarding-cta");
  if (cta) {
    cta.addEventListener("click", function() {
      dismissOnboarding();
    });
  }
}

function dismissOnboarding() {
  var overlay = document.getElementById("gs-onboarding-overlay");
  if (overlay) { overlay.remove(); }
  vscode.postMessage({ type: "onboardingComplete" });
}
```

- [ ] **Step 2: Add `showOnboarding` case to the message handler**

In `media/webview/explore.js`, inside the `switch (data.type)` block (the one starting at line 1387), add a new case before the closing `}` at line 1544. Insert it after the `case "setChannelData"` block (after line 1534):

```javascript
    case "showOnboarding":
      // Switch to Discover tab
      document.querySelectorAll(".gs-main-tab").forEach(function(t) { t.classList.remove("active"); });
      var discoverTab = document.querySelector('.gs-main-tab[data-tab="discover"]');
      if (discoverTab) { discoverTab.classList.add("active"); }
      chatMainTab = "discover";
      currentTab = "discover";

      var obFilterBar = document.getElementById("chat-filter-bar");
      var obChannelsPane = document.getElementById("chat-pane-channels");
      var obChatContent = document.getElementById("chat-content");
      var obChatEmpty = document.getElementById("chat-empty");
      var obFriendsContent = document.getElementById("friends-content");
      var obDiscoverContent = document.getElementById("discover-content");
      if (obFilterBar) { obFilterBar.style.display = "none"; }
      if (obChannelsPane) { obChannelsPane.style.display = "none"; }
      if (obChatContent) { obChatContent.style.display = "none"; }
      if (obChatEmpty) { obChatEmpty.style.display = "none"; }
      if (obFriendsContent) { obFriendsContent.style.display = "none"; }
      if (obDiscoverContent) { obDiscoverContent.style.display = "flex"; }

      renderDiscover();
      renderOnboardingOverlay();
      break;
```

- [ ] **Step 3: Manual test — verify render**

Open VS Code Developer Tools (Help → Toggle Developer Tools), go to the Console, and execute:

```javascript
// Simulate the message from extension host
window.postMessage({ type: "showOnboarding" }, "*");
```

Expected: Discover tab becomes active, floating modal appears with welcome text, 3 section rows with codicons, and "Start Exploring" button. Content is dimly visible behind the scrim.

- [ ] **Step 4: Manual test — verify dismiss**

Click the "Start Exploring" button.

Expected: Modal disappears, Discover tab content is fully visible. In the Developer Tools console, verify the `onboardingComplete` message was posted (check via the extension host output or add a temporary `console.log` in `dismissOnboarding`).

- [ ] **Step 5: Commit**

```bash
git add media/webview/explore.js
git commit -m "feat(onboarding): add WP3 welcome modal render and dismiss in webview"
```

---

### Task 3: Extension host — handle `onboardingComplete` + expose trigger

**Files:**
- Modify: `src/webviews/explore.ts:944` (add case in switch before closing `}` of the switch block)
- Modify: `src/webviews/explore.ts` (add public method `sendOnboarding`)

- [ ] **Step 1: Add `onboardingComplete` handler in the message switch**

In `src/webviews/explore.ts`, inside the `switch (msg.type)` block in the `onMessage` method, add a new case. Insert it after the `case "profileCard:signOut"` block (after line 943, before the closing `}` of the switch):

```typescript
      case "onboardingComplete":
        if (this._context) {
          const login = authManager.login;
          if (login) {
            this._context.globalState.update(`gitchat.hasCompletedOnboarding.${login}`, true);
            log(`[Onboarding] completed for ${login}`);
          }
        }
        break;
```

- [ ] **Step 2: Add public `sendOnboarding` method**

In `src/webviews/explore.ts`, add a public method to the `ExploreWebviewProvider` class. Insert it after the `refreshAll` method (after line 432):

```typescript
  /** WP3: Send onboarding modal trigger to webview */
  sendOnboarding(): void {
    this.view?.webview.postMessage({ type: "showOnboarding" });
  }
```

- [ ] **Step 3: Add public `hasCompletedOnboarding` check method**

In `src/webviews/explore.ts`, add another public method right after `sendOnboarding`:

```typescript
  /** WP3: Check if a user has completed onboarding */
  hasCompletedOnboarding(login: string): boolean {
    return this._context?.globalState.get<boolean>(`gitchat.hasCompletedOnboarding.${login}`, false) ?? false;
  }
```

- [ ] **Step 4: Commit**

```bash
git add src/webviews/explore.ts
git commit -m "feat(onboarding): handle onboardingComplete message and expose trigger methods"
```

---

### Task 4: Auth post-login — trigger onboarding for first-time users

**Files:**
- Modify: `src/auth/index.ts:115-126` (replace onboarding block)

- [ ] **Step 1: Replace the post-login onboarding block**

In `src/auth/index.ts`, replace the block at lines 115–126:

```typescript
      // Onboarding: reveal Who to Follow panel and show welcome
      setTimeout(() => {
        vscode.commands.executeCommand("gitchat.whoToFollow.focus");
        vscode.window.showInformationMessage(
          "Welcome to GitChat! Find friends, start DMs, and join group chats.",
          "Open GitChat"
        ).then((action) => {
          if (action === "Open GitChat") {
            vscode.commands.executeCommand("gitchat.explore.focus");
          }
        });
      }, 1500);
```

With:

```typescript
      // WP3: Onboarding — first-time users see welcome modal on Discover tab
      setTimeout(async () => {
        const { exploreWebviewProvider } = await import("../webviews/explore");
        if (this._login && !exploreWebviewProvider.hasCompletedOnboarding(this._login)) {
          // First-time user: focus Explore panel and show welcome modal
          vscode.commands.executeCommand("gitchat.explore.focus");
          // Small delay to ensure webview is ready after focus
          setTimeout(() => {
            exploreWebviewProvider.sendOnboarding();
          }, 500);
        } else {
          // Returning user: existing flow
          vscode.commands.executeCommand("gitchat.explore.focus");
        }
      }, 1500);
```

- [ ] **Step 2: Verify the import is dynamic**

The `import("../webviews/explore")` is dynamic (not top-level) to avoid circular dependency — `auth/index.ts` is imported by `explore.ts`, so a static import would create a cycle. Verify the dynamic import pattern matches other usages in the file (e.g., line 200: `const { apiClient } = await import("../api");`).

- [ ] **Step 3: Commit**

```bash
git add src/auth/index.ts
git commit -m "feat(onboarding): trigger WP3 welcome modal after first sign-in"
```

---

### Task 5: Dev command — `gitchat.resetOnboarding`

**Files:**
- Modify: `src/commands/index.ts:242` (add command to the `commands` array)
- Modify: `package.json:123` (declare command in contributes.commands)

- [ ] **Step 1: Add reset command to the commands array**

In `src/commands/index.ts`, add a new entry to the `commands` array. Insert it before the closing `];` at line 242:

```typescript
  {
    id: "gitchat.resetOnboarding",
    handler: async () => {
      const login = authManager.login;
      if (!login) {
        vscode.window.showWarningMessage("Sign in first to reset onboarding.");
        return;
      }
      const context = exploreWebviewProvider?.getContext();
      if (context) {
        await context.globalState.update(`gitchat.hasCompletedOnboarding.${login}`, undefined);
        vscode.window.showInformationMessage(`Onboarding reset for @${login}. Sign out and back in, or reload the window to test.`);
      }
    },
  },
```

- [ ] **Step 2: Expose `getContext` on ExploreWebviewProvider**

In `src/webviews/explore.ts`, add a public accessor for the context. Insert it after the `hasCompletedOnboarding` method:

```typescript
  /** Expose context for dev commands (e.g., resetOnboarding) */
  getContext(): vscode.ExtensionContext | undefined {
    return this._context;
  }
```

- [ ] **Step 3: Declare command in package.json**

In `package.json`, add the command declaration inside the `contributes.commands` array. Insert it after the last command entry (after the `gitchat.newChat` block, before the closing `]` at line 124):

```json
      {
        "command": "gitchat.resetOnboarding",
        "title": "Reset Onboarding (Dev)",
        "category": "GitChat"
      }
```

- [ ] **Step 4: Manual test**

1. Open Command Palette → "GitChat: Reset Onboarding (Dev)"
2. Expected: "Onboarding reset for @{username}" info message
3. Reload window → sign in → onboarding modal should appear again

- [ ] **Step 5: Commit**

```bash
git add src/commands/index.ts src/webviews/explore.ts package.json
git commit -m "feat(onboarding): add gitchat.resetOnboarding dev command"
```

---

### Task 6: Integration test — full flow walkthrough

- [ ] **Step 1: Test first-time user flow**

1. Run `gitchat.resetOnboarding` to clear state
2. Reload the VS Code window
3. Sign in with GitHub
4. Expected:
   - After ~1.5s, Explore panel focuses
   - After ~2s, Discover tab activates with welcome modal
   - Modal shows: "Welcome to GitChat!" + 3 sections (People/Communities/Teams with codicons) + "Start Exploring" button
   - Discover tab content is visible behind the scrim

- [ ] **Step 2: Test dismiss flow**

1. Click "Start Exploring"
2. Expected:
   - Modal disappears
   - Discover tab shows full content (People/Communities/Teams/Online Now sections)
   - Extension output log shows: `[Onboarding] completed for {username}`

- [ ] **Step 3: Test returning user flow**

1. Reload the VS Code window (do NOT sign out)
2. Expected:
   - Explore panel opens on Chat tab (default)
   - No onboarding modal

- [ ] **Step 4: Test new account flow**

1. Sign out
2. Sign in with a different GitHub account (or use `gitchat.resetOnboarding` to simulate)
3. Expected: onboarding modal appears again (per-user flag)

- [ ] **Step 5: Final commit — update contributor doc**

```bash
git add docs/contributors/$(git config user.name | tr '[:upper:]' '[:lower:]').md
git commit -m "docs: update contributor status after WP3 onboarding implementation"
```
