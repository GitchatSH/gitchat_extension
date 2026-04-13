# Welcome Gate & GitHub Authentication Wall — Design Spec

**Date:** 2026-04-04
**Goal:** Gate 100% of extension functionality behind GitHub authentication with an impressive, high-conversion welcome view that triggers FOMO and maximizes sign-in rate.

---

## 1. Architecture: Hard Gate via `when` Clauses

All existing views become invisible until the user signs in. A single `WelcomeWebviewProvider` takes over the Explore sidebar.

### View Visibility Matrix

| View ID | Type | Current `when` | New `when` |
|---------|------|----------------|------------|
| `trending.welcome` | webview (NEW) | — | `!trending.isSignedIn` |
| `trending.feed` | webview | `trending.isSignedIn` | `trending.isSignedIn` (no change) |
| `trending.trendingRepos` | tree | _(none)_ | `trending.isSignedIn` |
| `trending.trendingPeople` | tree | _(none)_ | `trending.isSignedIn` |
| `trending.whoToFollow` | webview | `trending.isSignedIn` | `trending.isSignedIn` (no change) |
| `trending.myRepos` | tree | _(none)_ | `trending.isSignedIn` |
| `trending.notifications` | webview | `trending.isSignedIn` | `trending.isSignedIn` (no change) |
| `trending.chatPanel` | webview | _(none)_ | `trending.isSignedIn` |

### Sidebar Behavior

- **Not signed in:** Explore sidebar shows only `trending.welcome`. Chat sidebar is empty with a simple `viewsWelcome` fallback ("Sign in to start chatting" + command link).
- **Signed in:** `trending.welcome` disappears. All other views appear as normal. No code changes needed in existing view providers — the `when` clause handles everything.

### Activation Event

Add `onView:trending.welcome` to `activationEvents` in package.json so the extension activates when the welcome view is shown.

---

## 2. Welcome View Content & Layout

Single scrollable webview (~300px sidebar width) with the following sections top-to-bottom:

### 2.1 Hero Section
- Gitchat logo (gradient icon, 48x48, rounded square)
- App name "Gitchat" (16px bold)
- Tagline: "A social network inside your IDE" (12px muted)

### 2.2 Feature Highlights (2×2 Grid)
Four feature cards with emoji icons:
- 🔥 **Trending** — Repos & People
- 💬 **Real-time Chat** — DMs & Groups
- 👥 **Follow Devs** — Build network
- 📡 **Activity Feed** — Stay in the loop

Each card: dark background (`--vscode-sideBar-background` variant), rounded corners, centered icon + title + subtitle.

### 2.3 Live Counters (Stats Bar)
Three counters in a horizontal row with dividers:
- **Repos tracked** (green accent)
- **Developers** (blue accent)
- **Messages** (yellow accent)

Data source: hardcoded initial values, optionally fetch from a public stats endpoint later. No auth required.

### 2.4 Founder Quote
Styled blockquote with left accent border (purple):
> "This is the beta. Find me in the chat and tell me what to build next — I ship updates within 24h."

Avatar circle + "@leeknowsai" + "Founder" label.

### 2.5 CTA Button
- White/neutral OAuth-style button: "Continue with GitHub"
- GitHub octocat SVG icon
- Full width, rounded, 1px border
- Sub-text below: "Read-only access · No repo permissions" (10px muted)
- `onclick` sends `postMessage({ type: "signIn" })` → extension calls `trending.signIn` command

### 2.6 Expandable Permissions
HTML `<details>` element, collapsed by default:
- Summary: "🔒 What permissions do we request?"
- Expanded content lists each OAuth scope with explanation:
  - ✓ `read:user` — Read your public profile info
  - ✓ `user:email` — See your email for notifications
  - ✓ `repo` — List your repos (read-only display)
  - ✗ We never write to your repositories
  - ✗ We never access private code

---

## 3. New Files

| File | Purpose |
|------|---------|
| `src/webviews/welcome.ts` | `WelcomeWebviewProvider` — registers webview, handles signIn message |
| `media/webview/welcome.css` | Styles for welcome view (uses VS Code CSS variables for theme compat) |
| `media/webview/welcome.js` | Minimal JS — postMessage for signIn, no external dependencies |

### WelcomeWebviewProvider Behavior

```
resolveWebviewView():
  - Set enableScripts: true, localResourceRoots: [media/]
  - Render HTML with nonce-based CSP (same pattern as other webviews)
  - Listen for message { type: "signIn" }
    → Execute command "trending.signIn"

No refresh() needed — content is static.
No data fetching — counters are hardcoded (v1).
```

### Extension Module Registration

New `welcomeModule` in `src/extension.ts`:
- Added to `parallelModules` array
- Registers `WelcomeWebviewProvider` for view ID `trending.welcome`
- Listens to `authManager.onDidChangeAuth` — no action needed since `when` clause handles visibility automatically

---

## 4. package.json Changes

### New View
```json
{
  "id": "trending.welcome",
  "name": "Welcome",
  "type": "webview",
  "when": "!trending.isSignedIn"
}
```
Position: first item in `trendingSidebar` views array.

### Updated `when` Clauses
Add `"when": "trending.isSignedIn"` to:
- `trending.trendingRepos`
- `trending.trendingPeople`
- `trending.myRepos`
- `trending.chatPanel`

### Updated `viewsWelcome`
Add entry for chat sidebar fallback:
```json
{
  "view": "trending.chatPanel",
  "contents": "Sign in to start chatting.\n[Sign In with GitHub](command:trending.signIn)",
  "when": "!trending.isSignedIn"
}
```
Note: This viewsWelcome for chatPanel may not render if the view itself is hidden by `when` clause. It serves as a safety fallback only.

### New Activation Event
```json
"onView:trending.welcome"
```

---

## 5. Theming & CSS Strategy

The welcome view must look correct in both dark and light VS Code themes.

- Use VS Code CSS custom properties throughout: `--vscode-sideBar-background`, `--vscode-foreground`, `--vscode-descriptionForeground`, `--vscode-button-background`, etc.
- Feature cards and counter bar use a slightly elevated background: `--vscode-input-background` or similar
- CTA button uses `--vscode-button-secondaryBackground` / `--vscode-button-secondaryForeground` for the neutral OAuth look
- Accent colors for counters (green/blue/yellow) use `--vscode-charts-green`, `--vscode-charts-blue`, `--vscode-charts-yellow`
- Follow the existing `shared.css` pattern but welcome view gets its own `welcome.css` (it has unique layout not shared with other views)

---

## 6. Interaction Flow

```
User installs extension
  → Extension activates
  → authModule sets trending.isSignedIn = false
  → VS Code evaluates when clauses
  → Only trending.welcome is visible in Explore sidebar
  → Chat sidebar is empty (chatPanel hidden)
  → User sees welcome view with hero, features, stats, CTA

User clicks "Continue with GitHub"
  → welcome.js sends postMessage({ type: "signIn" })
  → WelcomeWebviewProvider receives message
  → Executes vscode.commands.executeCommand("trending.signIn")
  → AuthManager.signIn() runs OAuth flow
  → On success: trending.isSignedIn = true
  → VS Code re-evaluates when clauses
  → trending.welcome disappears
  → All other views appear
  → Existing onboarding flow runs (focus whoToFollow, show info message)
```

---

## 7. Edge Cases

- **User signs out:** `trending.isSignedIn` becomes false → welcome view reappears, all other views hide. No extra code needed.
- **Token expired on restart:** `authModule.init()` restores token from SecretStorage. If token is gone, welcome view shows. If token exists, views show normally.
- **Sidebar not visible on startup:** Extension activates via `onView:trending.welcome` when user first opens the Explore sidebar. Welcome view renders on first visibility.
- **Chat sidebar opened first:** User sees empty sidebar. The `viewsWelcome` fallback provides a sign-in link. After sign in, chatPanel appears.

---

## 8. Scope Boundaries

**In scope:**
- WelcomeWebviewProvider + HTML/CSS/JS
- package.json view/when changes
- welcomeModule registration in extension.ts

**Out of scope (future iterations):**
- Live counters from API (v1 uses hardcoded values)
- A/B testing different welcome layouts
- Analytics on welcome view impressions / sign-in conversion
- Animated transitions or micro-interactions
- Welcome view in chat sidebar (keep simple viewsWelcome text)
