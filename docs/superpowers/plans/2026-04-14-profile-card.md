# Profile Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a universal, click-anywhere Profile Card overlay in the GitChat sidebar webview with 4 states (self / eligible / stranger / not-on-gitchat) and full action wiring (Message, Follow/Unfollow, Wave, Invite, View on GitHub), using real data wherever possible and isolated mocks only for fields that require BE work.

**Architecture:** Standalone webview module (`media/webview/profile-card.js`, ~400 lines IIFE) attached to `document.body` with fixed positioning, exposing `window.ProfileCard.show(username)`. Host integration in `src/webviews/explore.ts` handles postMessage routing to `apiClient`, a new GitHub REST wrapper (`src/api/github.ts`), an enrichment function (`src/webviews/profile-card-enrich.ts`), and an isolated mock layer (`src/webviews/profile-card-mocks.ts`). All trigger points (11 call sites across `explore.js` and `sidebar-chat.js`) use a single `window.ProfileCard.bindTrigger(el, username)` helper.

**Tech Stack:** TypeScript (strict, ES2024, CJS), VS Code Webview API, vanilla JS + CSS for webview, esbuild bundler, `--gs-*` design tokens. No frontend framework. No automated test harness for webview JS — verification is `npm run check-types` + manual smoke.

**Spec:** `docs/superpowers/specs/2026-04-14-profile-card-design.md`

---

## Testing note

Per spec §12.9, this repo has no automated test framework for webview vanilla JS and no E2E harness for the extension. Verification per task is:

- `npm run check-types` — TypeScript strict check, must pass
- `npm run lint` — ESLint, must pass
- Manual smoke test described inline per task
- Full feature smoke test in Task 12 covers all state/close/cache scenarios

Every task ends with a **commit step** so the history stays bisectable.

---

## File structure

**Created files:**
| Path | Responsibility |
|---|---|
| `media/webview/profile-card.js` | Overlay IIFE, exposes `window.ProfileCard` (show/close/isOpen/bindTrigger) |
| `media/webview/profile-card.css` | All `.gs-pc-*` styles with `--gs-*` tokens |
| `src/api/github.ts` | GitHub REST wrapper: `getUserFollowers`, `getUserStarred`, 1h in-memory cache |
| `src/webviews/profile-card-mocks.ts` | Isolated mocks: `mockOnGitchat`, `createWaveMockStore` — all with `// TODO: REMOVE WHEN BE SHIPS` markers |
| `src/webviews/profile-card-enrich.ts` | `enrichProfile(raw, currentUser, ctx)` orchestrator combining real + mock |

**Modified files:**
| Path | Change |
|---|---|
| `src/types/index.ts` | Add `ProfileCardData` interface |
| `src/webviews/explore.ts` | Load new CSS/JS, add `profileCard:*` postMessage handlers |
| `media/webview/explore.js` | Bind trigger on Inbox avatar, Friends row, `@mention` autocomplete |
| `media/webview/sidebar-chat.js` | Bind trigger on message bubble avatar, sender name, `@mention` span, group info member, pinned banner, search result, reactions login |

---

## Task 1: Scaffold files and wire them into the webview

**Files:**
- Create: `media/webview/profile-card.js` (minimal IIFE stub)
- Create: `media/webview/profile-card.css` (empty)
- Create: `src/api/github.ts` (empty export)
- Create: `src/webviews/profile-card-mocks.ts` (empty export)
- Create: `src/webviews/profile-card-enrich.ts` (empty export)
- Modify: `src/webviews/explore.ts` — add CSS/JS URI getters + `<link>` + `<script>` tags

- [ ] **Step 1: Create `media/webview/profile-card.js` stub**

```javascript
(function () {
  "use strict";

  // Public API stub — filled in Task 6
  window.ProfileCard = {
    show: function (username) {
      console.warn("[ProfileCard] show() not yet implemented for", username);
    },
    close: function () {},
    isOpen: function () { return false; },
    bindTrigger: function (el, username) {
      if (!el) { return; }
      el.addEventListener("click", function (e) {
        e.stopPropagation();
        window.ProfileCard.show(username);
      });
    },
  };
})();
```

- [ ] **Step 2: Create `media/webview/profile-card.css` with a header comment**

```css
/* profile-card.css — Profile Card overlay
 * Scope: .gs-pc-* classes only
 * Tokens: --gs-* only, no raw --vscode-*, no hardcoded colors
 * Min font size: 11px
 */
```

- [ ] **Step 3: Create `src/api/github.ts` stub**

```typescript
// Thin GitHub REST wrapper for Profile Card (permanent production code).
// Follows the existing apiClient patterns in src/api/index.ts.

export interface GitHubUserSummary {
  login: string;
  avatar_url: string;
}

export interface GitHubRepoSummary {
  owner: string;
  name: string;
}

export async function getUserFollowers(login: string): Promise<GitHubUserSummary[]> {
  // Real implementation lands in Task 2
  void login;
  return [];
}

export async function getUserStarred(login: string): Promise<GitHubRepoSummary[]> {
  // Real implementation lands in Task 2
  void login;
  return [];
}
```

- [ ] **Step 4: Create `src/webviews/profile-card-mocks.ts` stub**

```typescript
// Isolated mock layer for Profile Card fields that require BE work.
// Every export in this file is a temporary bridge — see strip paths in
// docs/superpowers/specs/2026-04-14-profile-card-design.md §11.

import type * as vscode from "vscode";

// TODO: REMOVE WHEN BE SHIPS on_gitchat field on /profile/:username (spec §10.1)
export function mockOnGitchat(login: string): boolean {
  void login;
  return true;
}

// TODO: REMOVE WHEN BE SHIPS POST /waves (spec §10.2)
export interface WaveMockStore {
  hasWaved(target: string): boolean;
  markWaved(target: string): void;
}

export function createWaveMockStore(_ctx: vscode.ExtensionContext): WaveMockStore {
  return {
    hasWaved: () => false,
    markWaved: () => undefined,
  };
}
```

- [ ] **Step 5: Create `src/webviews/profile-card-enrich.ts` stub**

```typescript
// enrichProfile() composes real API data with the isolated mock layer.
// Real sources: apiClient.getUserProfile (parent call), src/api/github.ts
// Mock sources:  src/webviews/profile-card-mocks.ts

import type { UserProfile, ProfileCardData } from "../types";

export async function enrichProfile(
  raw: UserProfile,
  currentUserLogin: string
): Promise<ProfileCardData> {
  void currentUserLogin;
  // Real composition lands in Task 4.
  return {
    login: raw.login,
    name: raw.name,
    avatar_url: raw.avatar_url,
    bio: raw.bio,
    public_repos: raw.public_repos,
    followers: raw.followers,
    following: raw.following,
    follow_status: { following: false, followed_by: false },
    on_gitchat: true,
  };
}
```

- [ ] **Step 6: Add `ProfileCardData` + `FollowStatus` wiring to `src/types/index.ts`**

Find the existing `FollowStatus` interface near line 218 and add the new interface below it:

```typescript
export interface ProfileCardData {
  // Identity (real via getUserProfile)
  login: string;
  name: string;
  avatar_url: string;
  pronouns?: string;
  bio?: string;

  // Stats (real)
  public_repos: number;
  followers: number;
  following: number;

  // Relationship (real, computed)
  follow_status: FollowStatus;

  // Presence
  on_gitchat: boolean;           // mock until BE ships
  online?: boolean;

  // Mutual (real, computed via GitHub API intersections)
  mutual_friends?: Array<{ login: string; avatar_url: string }>;
  mutual_groups?: Array<{ id: string; name: string; type: "community" | "team" }>;

  // Stranger decoration
  top_repo?: { owner: string; name: string; stars: number };
}
```

- [ ] **Step 7: Wire scripts into `src/webviews/explore.ts`**

Locate the existing `getHtml()` or equivalent method in `explore.ts` where CSS/JS URIs are generated. Add two new URI getters and insert them into the HTML template in the order specified by spec §3.2.

Add URI variables (alongside existing ones like `css`, `js`, `sharedCss`):

```typescript
const profileCardCss = getUri(webview, this._extensionUri, ["media", "webview", "profile-card.css"]);
const profileCardJs  = getUri(webview, this._extensionUri, ["media", "webview", "profile-card.js"]);
```

Inject into the HTML template — `<link>` immediately after sharedCss and before exploreCss, `<script>` after sharedJs and before exploreJs:

```html
<link rel="stylesheet" href="${sharedCss}">
<link rel="stylesheet" href="${profileCardCss}">
<link rel="stylesheet" href="${exploreCss}">
...
<script nonce="${nonce}" src="${sharedJs}"></script>
<script nonce="${nonce}" src="${profileCardJs}"></script>
<script nonce="${nonce}" src="${exploreJs}"></script>
```

- [ ] **Step 8: Verify compile passes**

Run: `npm run check-types`
Expected: exits 0, no errors.

Run: `npm run lint`
Expected: exits 0, no warnings.

- [ ] **Step 9: Manual smoke — extension still boots**

Launch Extension Development Host (F5 in VS Code). Open the GitChat sidebar. Expected: no console errors, `window.ProfileCard.show` exists when inspecting the webview, existing UI unchanged.

- [ ] **Step 10: Commit**

```bash
git add media/webview/profile-card.js media/webview/profile-card.css \
        src/api/github.ts src/webviews/profile-card-mocks.ts \
        src/webviews/profile-card-enrich.ts src/types/index.ts \
        src/webviews/explore.ts
git commit -m "feat(profile-card): scaffold files + wire into explore webview"
```

---

## Task 2: Implement `src/api/github.ts` — followers + starred with cache

**Files:**
- Modify: `src/api/github.ts`

- [ ] **Step 1: Write the fetch wrapper with auth + caching**

Replace the stub content of `src/api/github.ts` with:

```typescript
import { authManager } from "../auth";
import { log } from "../utils";

export interface GitHubUserSummary {
  login: string;
  avatar_url: string;
}

export interface GitHubRepoSummary {
  owner: string;
  name: string;
}

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const _followersCache = new Map<string, CacheEntry<GitHubUserSummary[]>>();
const _starredCache = new Map<string, CacheEntry<GitHubRepoSummary[]>>();

function isFresh<T>(entry: CacheEntry<T> | undefined): entry is CacheEntry<T> {
  return entry !== undefined && Date.now() - entry.fetchedAt < CACHE_TTL_MS;
}

async function ghFetch(path: string): Promise<unknown> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (authManager.token) {
    headers.Authorization = `Bearer ${authManager.token}`;
  }
  const res = await fetch(`https://api.github.com${path}`, { headers });
  if (!res.ok) {
    throw new Error(`GitHub API ${path} → HTTP ${res.status}`);
  }
  return res.json();
}

export async function getUserFollowers(login: string): Promise<GitHubUserSummary[]> {
  const cached = _followersCache.get(login);
  if (isFresh(cached)) { return cached.data; }
  try {
    const raw = (await ghFetch(`/users/${encodeURIComponent(login)}/followers?per_page=100`)) as Array<{
      login: string;
      avatar_url: string;
    }>;
    const data = raw.map((u) => ({ login: u.login, avatar_url: u.avatar_url }));
    _followersCache.set(login, { data, fetchedAt: Date.now() });
    return data;
  } catch (err) {
    log(`[github] getUserFollowers(${login}) failed: ${err}`, "warn");
    return [];
  }
}

export async function getUserStarred(login: string): Promise<GitHubRepoSummary[]> {
  const cached = _starredCache.get(login);
  if (isFresh(cached)) { return cached.data; }
  try {
    const raw = (await ghFetch(`/users/${encodeURIComponent(login)}/starred?per_page=100`)) as Array<{
      owner: { login: string };
      name: string;
    }>;
    const data = raw.map((r) => ({ owner: r.owner.login, name: r.name }));
    _starredCache.set(login, { data, fetchedAt: Date.now() });
    return data;
  } catch (err) {
    log(`[github] getUserStarred(${login}) failed: ${err}`, "warn");
    return [];
  }
}
```

- [ ] **Step 2: Verify type-check**

Run: `npm run check-types`
Expected: exits 0, no errors.

Run: `npm run lint`
Expected: exits 0, no warnings.

- [ ] **Step 3: Commit**

```bash
git add src/api/github.ts
git commit -m "feat(api): add github wrapper for followers + starred (1h cache)"
```

---

## Task 3: Implement `profile-card-mocks.ts` — wave store backed by globalState

**Files:**
- Modify: `src/webviews/profile-card-mocks.ts`

- [ ] **Step 1: Write the real mock module**

Replace the stub content with:

```typescript
// Isolated mock layer for Profile Card fields that require BE work.
// Every export in this file is a temporary bridge — see strip paths in
// docs/superpowers/specs/2026-04-14-profile-card-design.md §11.

import type * as vscode from "vscode";

// ─── on_gitchat heuristic ────────────────────────────────────────────────
// TODO: REMOVE WHEN BE SHIPS on_gitchat field on /profile/:username (spec §10.1)
// Until BE ships the field, every user resolved via our API is assumed to be
// on GitChat. Override the blacklist below to exercise the not-on-gitchat
// state during manual testing.
export function mockOnGitchat(login: string): boolean {
  const FORCED_OFFLINE: string[] = [];
  return !FORCED_OFFLINE.includes(login);
}

// ─── Wave client-side store ──────────────────────────────────────────────
// TODO: REMOVE WHEN BE SHIPS POST /waves (spec §10.2)
// Mirrors the eventual BE rate limit (1 wave per target per sender lifetime)
// by tracking sent waves in the extension's globalState. Recipients never
// actually receive anything until BE ships the endpoint.
export interface WaveMockStore {
  hasWaved(target: string): boolean;
  markWaved(target: string): void;
}

const WAVE_STATE_KEY = "profileCard.wavesSent";

export function createWaveMockStore(ctx: vscode.ExtensionContext): WaveMockStore {
  return {
    hasWaved(target: string): boolean {
      const sent = ctx.globalState.get<string[]>(WAVE_STATE_KEY, []);
      return sent.includes(target);
    },
    markWaved(target: string): void {
      const sent = ctx.globalState.get<string[]>(WAVE_STATE_KEY, []);
      if (!sent.includes(target)) {
        sent.push(target);
        void ctx.globalState.update(WAVE_STATE_KEY, sent);
      }
    },
  };
}
```

- [ ] **Step 2: Verify type-check**

Run: `npm run check-types`
Expected: exits 0.

Run: `npm run lint`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/webviews/profile-card-mocks.ts
git commit -m "feat(profile-card): isolated mock layer for on_gitchat + wave"
```

---

## Task 4: Implement `profile-card-enrich.ts` — compose real + mock

**Files:**
- Modify: `src/webviews/profile-card-enrich.ts`

- [ ] **Step 1: Write the enrichment orchestrator**

Replace the stub content with:

```typescript
// enrichProfile() composes real API data with the isolated mock layer.
// Real sources: apiClient.getUserProfile (parent caller), src/api/github.ts
// Mock sources: src/webviews/profile-card-mocks.ts

import type { UserProfile, ProfileCardData, FollowStatus } from "../types";
import { getUserFollowers, getUserStarred } from "../api/github";
import { mockOnGitchat } from "./profile-card-mocks";

export interface EnrichContext {
  myFollowing: Array<{ login: string; avatar_url?: string }>;
  myStarred?: Array<{ owner: string; name: string }>;
}

export async function enrichProfile(
  raw: UserProfile,
  currentUserLogin: string,
  ctx: EnrichContext
): Promise<ProfileCardData> {
  // Self case — skip expensive GitHub calls
  if (raw.login === currentUserLogin) {
    return {
      login: raw.login,
      name: raw.name,
      avatar_url: raw.avatar_url,
      bio: raw.bio,
      public_repos: raw.public_repos,
      followers: raw.followers,
      following: raw.following,
      follow_status: { following: true, followed_by: true },
      on_gitchat: true,
      mutual_friends: [],
      mutual_groups: [],
      top_repo: raw.top_repos?.[0]
        ? { owner: raw.top_repos[0].owner, name: raw.top_repos[0].name, stars: raw.top_repos[0].stars }
        : undefined,
    };
  }

  const [targetFollowers, targetStarred] = await Promise.all([
    getUserFollowers(raw.login),
    getUserStarred(raw.login),
  ]);

  const myFriendsLogins = new Set(ctx.myFollowing.map((f) => f.login));
  const myStarredKeys = new Set(
    (ctx.myStarred ?? []).map((r) => `${r.owner}/${r.name}`)
  );

  const follow_status: FollowStatus = {
    following: myFriendsLogins.has(raw.login),
    followed_by: targetFollowers.some((f) => f.login === currentUserLogin),
  };

  const mutual_friends = targetFollowers
    .filter((f) => myFriendsLogins.has(f.login))
    .map((f) => ({ login: f.login, avatar_url: f.avatar_url }))
    .slice(0, 8);

  const mutual_groups = targetStarred
    .filter((r) => myStarredKeys.has(`${r.owner}/${r.name}`))
    .slice(0, 6)
    .map((r) => ({
      id: `community:${r.owner}/${r.name}`,
      name: `${r.owner}/${r.name}`,
      type: "community" as const,
    }));

  return {
    login: raw.login,
    name: raw.name,
    avatar_url: raw.avatar_url,
    bio: raw.bio,
    public_repos: raw.public_repos,
    followers: raw.followers,
    following: raw.following,
    follow_status,
    on_gitchat: mockOnGitchat(raw.login),
    mutual_friends,
    mutual_groups,
    top_repo: raw.top_repos?.[0]
      ? { owner: raw.top_repos[0].owner, name: raw.top_repos[0].name, stars: raw.top_repos[0].stars }
      : undefined,
  };
}
```

- [ ] **Step 2: Verify type-check**

Run: `npm run check-types`
Expected: exits 0. If you get "Cannot find name 'UserProfile'", verify the `UserProfile` interface was modified in Task 1 Step 6 and re-run.

Run: `npm run lint`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/webviews/profile-card-enrich.ts
git commit -m "feat(profile-card): enrichProfile composes real github data + mocks"
```

---

## Task 5: Host integration — postMessage router in `explore.ts`

**Files:**
- Modify: `src/webviews/explore.ts` — add message cases, wave store, wire enrichment

- [ ] **Step 1: Import new modules at top of `explore.ts`**

Add to existing imports:

```typescript
import { enrichProfile } from "./profile-card-enrich";
import { createWaveMockStore, type WaveMockStore } from "./profile-card-mocks";
import { getUserStarred } from "../api/github";
```

- [ ] **Step 2: Add a wave store field on the webview provider class**

Find the provider class declaration in `explore.ts`. Add a private field and initialize it in the constructor or activation:

```typescript
private _waveStore: WaveMockStore | null = null;
```

Wherever the class has access to `vscode.ExtensionContext` (commonly at activation or constructor), initialize:

```typescript
this._waveStore = createWaveMockStore(extensionContext);
```

If the provider does not currently receive `ExtensionContext`, thread it through from the activation in `extension.ts`. The activation call site is the `exploreModule.activate(context)` in the module registry — pass `context` into the provider constructor.

- [ ] **Step 3: Add postMessage cases to the existing `onDidReceiveMessage` switch**

Locate the existing switch in `explore.ts` that handles messages like `"setChatData"`, `"fetchChannels"`, etc. Add the following cases:

```typescript
case "profileCard:fetch": {
  try {
    const username = (msg.payload as { username: string }).username;
    const raw = await apiClient.getUserProfile(username);
    // Build enrichment context from data already loaded in refreshChat
    const myFollowing = await apiClient.getFollowing(1, 100);
    const myStarred = await getUserStarred(authManager.login);
    const enriched = await enrichProfile(raw, authManager.login, {
      myFollowing,
      myStarred,
    });
    this.view?.webview.postMessage({ type: "profileCardData", payload: enriched });
  } catch (err) {
    log(`[Explore] profileCard fetch failed: ${err}`, "warn");
    this.view?.webview.postMessage({ type: "profileCardError", message: "Failed to load profile" });
  }
  break;
}

case "profileCard:follow": {
  const username = (msg.payload as { username: string }).username;
  try {
    await apiClient.followUser(username);
    fireFollowChanged(username, true);
    this.view?.webview.postMessage({
      type: "profileCardActionResult",
      action: "follow",
      success: true,
      username,
    });
  } catch (err) {
    log(`[Explore] profileCard follow failed for ${username}: ${err}`, "warn");
    this.view?.webview.postMessage({
      type: "profileCardActionResult",
      action: "follow",
      success: false,
      username,
    });
  }
  break;
}

case "profileCard:unfollow": {
  const username = (msg.payload as { username: string }).username;
  try {
    await apiClient.unfollowUser(username);
    fireFollowChanged(username, false);
    this.view?.webview.postMessage({
      type: "profileCardActionResult",
      action: "unfollow",
      success: true,
      username,
    });
  } catch (err) {
    log(`[Explore] profileCard unfollow failed for ${username}: ${err}`, "warn");
    this.view?.webview.postMessage({
      type: "profileCardActionResult",
      action: "unfollow",
      success: false,
      username,
    });
  }
  break;
}

case "profileCard:message": {
  const username = (msg.payload as { username: string }).username;
  vscode.commands.executeCommand("gitchat.messageUser", username);
  break;
}

case "profileCard:wave": {
  const username = (msg.payload as { username: string }).username;
  if (this._waveStore?.hasWaved(username)) {
    this.view?.webview.postMessage({
      type: "profileCardActionResult",
      action: "wave",
      success: false,
      username,
      reason: "already_waved",
    });
    break;
  }
  this._waveStore?.markWaved(username);
  vscode.window.showInformationMessage(`Waved at @${username} 👋`);
  this.view?.webview.postMessage({
    type: "profileCardActionResult",
    action: "wave",
    success: true,
    username,
  });
  break;
}

case "profileCard:invite": {
  const username = (msg.payload as { username: string }).username;
  const url = `https://dev.gitchat.sh/@${username}`;
  await vscode.env.clipboard.writeText(url);
  vscode.window.showInformationMessage(`Invite link copied for @${username}`);
  break;
}

case "profileCard:openGitHub": {
  const username = (msg.payload as { username: string }).username;
  vscode.env.openExternal(vscode.Uri.parse(`https://github.com/${username}`));
  break;
}
```

- [ ] **Step 4: Verify type-check + lint**

Run: `npm run check-types`
Expected: exits 0.

Run: `npm run lint`
Expected: exits 0.

- [ ] **Step 5: Manual smoke — postMessage wiring**

Launch Extension Development Host. Open DevTools on webview. In console:

```javascript
acquireVsCodeApi().postMessage({ type: "profileCard:fetch", payload: { username: "octocat" } });
```

Expected: host logs show fetch attempt; webview receives `profileCardData` or `profileCardError` message (check with a temporary `window.addEventListener("message", console.log)` snippet).

- [ ] **Step 6: Commit**

```bash
git add src/webviews/explore.ts
git commit -m "feat(profile-card): host postMessage router wired to api + mocks"
```

---

## Task 6: Implement `profile-card.js` overlay component

**Files:**
- Modify: `media/webview/profile-card.js`

This is the largest task. It replaces the stub in Task 1 with a full IIFE that owns the overlay lifecycle, state determination, rendering, caching, and event handling.

- [ ] **Step 1: Replace `profile-card.js` with the full component**

Overwrite the file entirely with:

```javascript
(function () {
  "use strict";

  const vscode = acquireVsCodeApi ? acquireVsCodeApi() : null;
  const CACHE_TTL_MS = 60 * 1000; // 60 seconds
  const _cache = new Map();       // login → { data, fetchedAt }
  let _root = null;
  let _keydownHandler = null;
  let _currentUser = null;

  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatStat(n) {
    if (n >= 1000) { return (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "") + "k"; }
    return String(n);
  }

  function determineState(data, currentUser) {
    if (data.login === currentUser) { return "self"; }
    if (!data.on_gitchat) { return "not-on-gitchat"; }
    const s = data.follow_status || {};
    if (s.following && s.followed_by) { return "eligible"; }
    return "stranger";
  }

  function isFresh(entry) {
    return entry && Date.now() - entry.fetchedAt < CACHE_TTL_MS;
  }

  function show(username) {
    if (!username) { return; }
    if (_root) { close(); }

    const cached = _cache.get(username);
    if (isFresh(cached)) {
      mount(renderHtml(cached.data));
    } else {
      mount(renderSkeletonHtml(username));
      if (vscode) {
        vscode.postMessage({ type: "profileCard:fetch", payload: { username } });
      }
    }
  }

  function close() {
    if (!_root) { return; }
    const backdrop = _root;
    backdrop.classList.remove("gs-pc-open");
    const onEnd = function () {
      if (backdrop.parentNode) { backdrop.parentNode.removeChild(backdrop); }
      if (_root === backdrop) { _root = null; }
      backdrop.removeEventListener("transitionend", onEnd);
    };
    backdrop.addEventListener("transitionend", onEnd);
    setTimeout(onEnd, 300); // fallback
    if (_keydownHandler) {
      document.removeEventListener("keydown", _keydownHandler);
      _keydownHandler = null;
    }
  }

  function isOpen() { return _root !== null; }

  function mount(html) {
    const existing = document.querySelector(".gs-pc-backdrop");
    if (existing && existing.parentNode) { existing.parentNode.removeChild(existing); }

    const wrapper = document.createElement("div");
    wrapper.innerHTML = html;
    const backdrop = wrapper.firstElementChild;
    document.body.appendChild(backdrop);
    _root = backdrop;

    requestAnimationFrame(function () { backdrop.classList.add("gs-pc-open"); });

    backdrop.addEventListener("click", function (e) {
      if (e.target === backdrop) { close(); }
    });
    const closeBtn = backdrop.querySelector(".gs-pc-close");
    if (closeBtn) { closeBtn.addEventListener("click", close); }

    _keydownHandler = function (e) { if (e.key === "Escape") { close(); } };
    document.addEventListener("keydown", _keydownHandler);

    attachActions(backdrop);
  }

  function attachActions(root) {
    const actionBtns = root.querySelectorAll("[data-pc-action]");
    actionBtns.forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        const action = btn.getAttribute("data-pc-action");
        const username = btn.getAttribute("data-pc-user");
        if (!username || !vscode) { return; }
        switch (action) {
          case "message":
            vscode.postMessage({ type: "profileCard:message", payload: { username } });
            close();
            break;
          case "follow":
            btn.disabled = true;
            vscode.postMessage({ type: "profileCard:follow", payload: { username } });
            break;
          case "unfollow":
            btn.disabled = true;
            vscode.postMessage({ type: "profileCard:unfollow", payload: { username } });
            break;
          case "wave":
            btn.disabled = true;
            vscode.postMessage({ type: "profileCard:wave", payload: { username } });
            break;
          case "invite":
            vscode.postMessage({ type: "profileCard:invite", payload: { username } });
            break;
          case "github":
            vscode.postMessage({ type: "profileCard:openGitHub", payload: { username } });
            break;
          case "signOut":
            vscode.postMessage({ type: "profileCard:signOut" });
            close();
            break;
          case "editProfile":
            vscode.postMessage({ type: "profileCard:openGitHub", payload: { username } });
            close();
            break;
        }
      });
    });

    // Clickable mutual friend logins → open their profile card
    root.querySelectorAll("[data-pc-mutual-login]").forEach(function (el) {
      el.addEventListener("click", function (e) {
        e.stopPropagation();
        show(el.getAttribute("data-pc-mutual-login"));
      });
    });
  }

  function renderSkeletonHtml(username) {
    return [
      '<div class="gs-pc-backdrop gs-pc-loading" role="dialog" aria-labelledby="gs-pc-title">',
      '  <div class="gs-pc-card">',
      '    <button class="gs-pc-close gs-btn-icon" aria-label="Close"><i class="codicon codicon-close"></i></button>',
      '    <div class="gs-pc-header">',
      '      <div class="gs-pc-avatar gs-pc-skel"></div>',
      '      <h2 class="gs-pc-name" id="gs-pc-title">@' + escapeHtml(username) + '</h2>',
      '      <div class="gs-pc-skel-line gs-pc-skel-sm"></div>',
      '      <div class="gs-pc-skel-line"></div>',
      '    </div>',
      '    <div class="gs-pc-stats gs-pc-skel-stats">',
      '      <div class="gs-pc-stat gs-pc-skel-line"></div>',
      '      <div class="gs-pc-stat gs-pc-skel-line"></div>',
      '      <div class="gs-pc-stat gs-pc-skel-line"></div>',
      '    </div>',
      '  </div>',
      '</div>',
    ].join("");
  }

  function renderErrorHtml(message) {
    return [
      '<div class="gs-pc-backdrop" role="dialog">',
      '  <div class="gs-pc-card">',
      '    <button class="gs-pc-close gs-btn-icon" aria-label="Close"><i class="codicon codicon-close"></i></button>',
      '    <div class="gs-pc-error">',
      '      <i class="codicon codicon-error"></i>',
      '      <p>' + escapeHtml(message) + '</p>',
      '    </div>',
      '  </div>',
      '</div>',
    ].join("");
  }

  function renderHtml(data) {
    const state = determineState(data, _currentUser);
    const user = escapeHtml(data.login);

    const statsRow = [
      '<div class="gs-pc-stats">',
      '  <div class="gs-pc-stat"><strong>' + formatStat(data.public_repos) + '</strong> Repos</div>',
      '  <div class="gs-pc-stat"><strong>' + formatStat(data.followers) + '</strong> Followers</div>',
      '  <div class="gs-pc-stat"><strong>' + formatStat(data.following) + '</strong> Following</div>',
      '</div>',
    ].join("");

    let middleBlock = "";
    if (state === "eligible") {
      middleBlock = renderMutual(data);
    } else if (state === "stranger" && data.top_repo) {
      middleBlock =
        '<div class="gs-pc-top-repo"><i class="codicon codicon-star-full"></i> ' +
        escapeHtml(data.top_repo.owner + "/" + data.top_repo.name) + "</div>";
    }

    let warning = "";
    if (state === "stranger") {
      warning =
        '<div class="gs-pc-warning"><i class="codicon codicon-warning"></i>' +
        " You don't follow each other yet</div>";
    }

    const actions = renderActions(state, data);
    const pronouns = data.pronouns ? ' <span class="gs-pc-dot">·</span> <span class="gs-pc-pronouns">' + escapeHtml(data.pronouns) + "</span>" : "";

    return [
      '<div class="gs-pc-backdrop" role="dialog" aria-labelledby="gs-pc-title">',
      '  <div class="gs-pc-card gs-pc-state-' + state + '">',
      '    <button class="gs-pc-close gs-btn-icon" aria-label="Close"><i class="codicon codicon-close"></i></button>',
      '    <div class="gs-pc-header">',
      '      <img class="gs-pc-avatar" src="' + escapeHtml(data.avatar_url) + '" alt="">',
      '      <h2 class="gs-pc-name" id="gs-pc-title">' + escapeHtml(data.name || data.login) + '</h2>',
      '      <div class="gs-pc-handle">@' + user + pronouns + '</div>',
      (data.bio ? '      <p class="gs-pc-bio">' + escapeHtml(data.bio) + '</p>' : ''),
      '    </div>',
      statsRow,
      middleBlock,
      warning,
      actions,
      '  </div>',
      '</div>',
    ].join("");
  }

  function renderMutual(data) {
    const friends = data.mutual_friends || [];
    const groups = data.mutual_groups || [];
    if (friends.length === 0 && groups.length === 0) { return ""; }

    const countText =
      (friends.length ? friends.length + " friend" + (friends.length === 1 ? "" : "s") : "") +
      (friends.length && groups.length ? " · " : "") +
      (groups.length ? groups.length + " group" + (groups.length === 1 ? "" : "s") : "");

    const friendsHtml = friends.length
      ? '<div class="gs-pc-mutual-friends">' +
          friends.map(function (f) {
            return '<a data-pc-mutual-login="' + escapeHtml(f.login) + '">' + escapeHtml(f.login) + "</a>";
          }).join(" · ") +
        "</div>"
      : "";

    const groupsHtml = groups.length
      ? '<div class="gs-pc-mutual-groups">' +
          groups.map(function (g) { return "#" + escapeHtml(g.name); }).join(" · ") +
        "</div>"
      : "";

    return [
      '<div class="gs-pc-mutual">',
      '  <div class="gs-pc-mutual-header">MUTUAL — ' + escapeHtml(countText) + '</div>',
      friendsHtml,
      groupsHtml,
      '</div>',
    ].join("");
  }

  function renderActions(state, data) {
    const u = escapeHtml(data.login);
    let primary = "";
    let secondary = "";

    if (state === "self") {
      primary = '<button class="gs-btn gs-btn-primary" data-pc-action="editProfile" data-pc-user="' + u + '"><i class="codicon codicon-edit"></i> Edit Profile</button>';
      secondary = '<button class="gs-btn gs-btn-outline" data-pc-action="signOut" data-pc-user="' + u + '"><i class="codicon codicon-sign-out"></i> Sign Out</button>';
    } else if (state === "eligible") {
      primary = '<button class="gs-btn gs-btn-primary" data-pc-action="message" data-pc-user="' + u + '"><i class="codicon codicon-comment"></i> Message</button>';
      secondary = '<button class="gs-btn gs-btn-outline" data-pc-action="unfollow" data-pc-user="' + u + '"><i class="codicon codicon-check"></i> Following</button>';
    } else if (state === "stranger") {
      primary = '<button class="gs-btn gs-btn-primary" data-pc-action="wave" data-pc-user="' + u + '"><i class="codicon codicon-heart"></i> Wave</button>';
      const isFollowing = data.follow_status && data.follow_status.following;
      secondary = isFollowing
        ? '<button class="gs-btn gs-btn-outline" data-pc-action="unfollow" data-pc-user="' + u + '"><i class="codicon codicon-check"></i> Following</button>'
        : '<button class="gs-btn gs-btn-outline" data-pc-action="follow" data-pc-user="' + u + '"><i class="codicon codicon-add"></i> Follow</button>';
    } else if (state === "not-on-gitchat") {
      primary = '<button class="gs-btn gs-btn-primary" data-pc-action="invite" data-pc-user="' + u + '"><i class="codicon codicon-mail"></i> Invite to GitChat</button>';
      secondary = '<button class="gs-btn gs-btn-outline" data-pc-action="github" data-pc-user="' + u + '"><i class="codicon codicon-github"></i> View on GitHub</button>';
    }

    return '<div class="gs-pc-actions">' + primary + secondary + "</div>";
  }

  // ── Incoming host messages ──
  window.addEventListener("message", function (event) {
    const msg = event.data;
    if (!msg) { return; }
    if (msg.type === "profileCardData") {
      const data = msg.payload;
      _cache.set(data.login, { data, fetchedAt: Date.now() });
      if (_root) {
        _root.parentNode.removeChild(_root);
        _root = null;
        mount(renderHtml(data));
      }
      return;
    }
    if (msg.type === "profileCardError") {
      if (_root) {
        _root.parentNode.removeChild(_root);
        _root = null;
        mount(renderErrorHtml(msg.message || "Failed to load"));
      }
      return;
    }
    if (msg.type === "profileCardActionResult") {
      const username = msg.username;
      const cached = _cache.get(username);
      if (cached && cached.data && cached.data.follow_status) {
        if (msg.action === "follow" && msg.success) { cached.data.follow_status.following = true; }
        if (msg.action === "unfollow" && msg.success) { cached.data.follow_status.following = false; }
      }
      // Re-render current overlay if still open for same user
      if (_root && cached && isOpen()) {
        const titleEl = _root.querySelector("#gs-pc-title");
        if (titleEl && (titleEl.textContent === cached.data.name || titleEl.textContent === cached.data.login)) {
          _root.parentNode.removeChild(_root);
          _root = null;
          mount(renderHtml(cached.data));
        }
      }
      if (msg.action === "follow" && !msg.success) {
        // Revert button disabled state
        const btn = document.querySelector('[data-pc-action="follow"]');
        if (btn) { btn.disabled = false; }
      }
      return;
    }
    if (msg.type === "setChatData" || msg.type === "setChatDataDev") {
      if (msg.currentUser) { _currentUser = msg.currentUser; }
      return;
    }
  });

  window.ProfileCard = {
    show: show,
    close: close,
    isOpen: isOpen,
    bindTrigger: function (el, username) {
      if (!el || !username) { return; }
      el.addEventListener("click", function (e) {
        e.stopPropagation();
        show(username);
      });
    },
  };
})();
```

- [ ] **Step 2: Verify type-check + lint**

Run: `npm run check-types`
Expected: exits 0.

Run: `npm run lint`
Expected: exits 0. ESLint on webview JS is lax; if any warning fires on this file, fix inline.

- [ ] **Step 3: Manual smoke — the overlay mounts**

Launch Extension Development Host. Open sidebar. In DevTools console:

```javascript
window.ProfileCard.show("octocat")
```

Expected: skeleton overlay fades in. After ~1–2 seconds, real profile data replaces skeleton (identity fields render, actions render, state is determined). Clicking the X button closes. Pressing Escape closes. Clicking backdrop closes.

- [ ] **Step 4: Commit**

```bash
git add media/webview/profile-card.js
git commit -m "feat(profile-card): overlay component with 4 states + cache + actions"
```

---

## Task 7: Write `profile-card.css`

**Files:**
- Modify: `media/webview/profile-card.css`

- [ ] **Step 1: Replace file with full styles**

Overwrite `media/webview/profile-card.css` with:

```css
/* profile-card.css — Profile Card overlay
 * Scope: .gs-pc-* only
 * Tokens: --gs-* only, min font size 11px
 */

.gs-pc-backdrop {
  position: fixed;
  inset: 0;
  background: color-mix(in srgb, var(--gs-bg) 80%, transparent);
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
  z-index: 1000;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 40px 8px 16px;
  opacity: 0;
  transition: opacity 150ms ease-out;
}
.gs-pc-backdrop.gs-pc-open { opacity: 1; }

.gs-pc-card {
  width: 100%;
  max-width: 320px;
  background: var(--gs-bg);
  border: 1px solid var(--gs-border);
  border-radius: var(--gs-radius);
  padding: 16px var(--gs-inset-x) 12px;
  position: relative;
  transform: translateY(8px);
  transition: transform 150ms ease-out;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.2);
}
.gs-pc-backdrop.gs-pc-open .gs-pc-card { transform: translateY(0); }

.gs-pc-close {
  position: absolute;
  top: 8px;
  right: 8px;
}

.gs-pc-header { text-align: center; }

.gs-pc-avatar {
  width: 96px;
  height: 96px;
  border-radius: 50%;
  display: block;
  margin: 8px auto 12px;
  background: var(--gs-button-bg);
  object-fit: cover;
}

.gs-pc-name {
  font-size: var(--gs-font-lg);
  font-weight: 600;
  text-align: center;
  margin: 0 0 4px;
  color: var(--gs-fg);
}

.gs-pc-handle {
  text-align: center;
  font-size: var(--gs-font-sm);
  color: var(--gs-muted);
  margin-bottom: 8px;
}
.gs-pc-pronouns { color: var(--gs-muted); }

.gs-pc-bio {
  font-size: var(--gs-font-sm);
  text-align: center;
  color: var(--gs-fg);
  margin: 0 0 12px;
  line-height: 1.4;
}

.gs-pc-stats {
  display: flex;
  justify-content: space-around;
  padding: 8px 4px;
  border: 1px solid var(--gs-border);
  border-radius: var(--gs-radius-sm);
  margin-bottom: 12px;
}
.gs-pc-stat {
  font-size: var(--gs-font-sm);
  color: var(--gs-muted);
  text-align: center;
  flex: 1;
}
.gs-pc-stat strong {
  color: var(--gs-fg);
  font-weight: 600;
  display: block;
  font-size: var(--gs-font-base);
}

.gs-pc-mutual { margin-bottom: 12px; }
.gs-pc-mutual-header {
  font-size: var(--gs-font-xs);
  font-weight: 600;
  color: var(--gs-muted);
  letter-spacing: 0.5px;
  margin-bottom: 4px;
}
.gs-pc-mutual-friends,
.gs-pc-mutual-groups {
  font-size: var(--gs-font-sm);
  color: var(--gs-muted);
  margin-bottom: 4px;
  word-break: break-word;
}
.gs-pc-mutual-friends a {
  color: var(--gs-fg);
  text-decoration: none;
  cursor: pointer;
}
.gs-pc-mutual-friends a:hover { text-decoration: underline; }

.gs-pc-top-repo {
  font-size: var(--gs-font-sm);
  color: var(--gs-fg);
  margin: 8px 0 12px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.gs-pc-top-repo .codicon { color: var(--gs-warning); }

.gs-pc-warning {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: color-mix(in srgb, var(--gs-warning) 10%, var(--gs-bg));
  border-left: 3px solid var(--gs-warning);
  border-radius: var(--gs-radius-sm);
  font-size: var(--gs-font-sm);
  color: var(--gs-fg);
  margin: 12px 0;
}
.gs-pc-warning .codicon { color: var(--gs-warning); flex-shrink: 0; }

.gs-pc-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}
.gs-pc-actions .gs-btn {
  flex: 1;
  justify-content: center;
  min-width: 0;
}

/* Error state */
.gs-pc-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 32px 16px;
  text-align: center;
  color: var(--gs-muted);
}
.gs-pc-error .codicon { color: var(--gs-error); font-size: 24px; }

/* Skeleton shimmer */
@keyframes gs-pc-shimmer {
  0%   { background-position: -200px 0; }
  100% { background-position: 200px 0; }
}
.gs-pc-skel,
.gs-pc-skel-line {
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--gs-fg) 6%, var(--gs-bg)) 0%,
    color-mix(in srgb, var(--gs-fg) 12%, var(--gs-bg)) 50%,
    color-mix(in srgb, var(--gs-fg) 6%, var(--gs-bg)) 100%
  );
  background-size: 400px 100%;
  animation: gs-pc-shimmer 1.5s infinite linear;
  border-radius: var(--gs-radius-sm);
}
.gs-pc-avatar.gs-pc-skel {
  border-radius: 50%;
}
.gs-pc-skel-line {
  height: 12px;
  margin: 6px auto;
  width: 80%;
}
.gs-pc-skel-line.gs-pc-skel-sm { width: 40%; height: 10px; }
.gs-pc-skel-line.gs-pc-skel-lg { width: 60%; height: 16px; }
.gs-pc-skel-stats .gs-pc-stat { height: 28px; border-radius: var(--gs-radius-sm); }

/* Narrow sidebar fallback */
@media (max-width: 260px) {
  .gs-pc-actions { flex-direction: column; }
  .gs-pc-avatar { width: 72px; height: 72px; }
}
```

- [ ] **Step 2: Verify CSS doesn't break existing layout**

Run: `npm run check-types` and `npm run lint`
Expected: both exit 0.

Launch Extension Development Host. Open sidebar — existing UI must render unchanged (this file only adds new classes; nothing else references them yet).

- [ ] **Step 3: Manual smoke — the overlay now looks right**

In DevTools console:
```javascript
window.ProfileCard.show("octocat")
```

Expected: card is centered, avatar is round 96px, buttons render side-by-side, warning banner (stranger state) has left accent, close button in top-right. Animation fade+slide in. All colors inherit from VS Code theme.

- [ ] **Step 4: Commit**

```bash
git add media/webview/profile-card.css
git commit -m "style(profile-card): overlay styles with --gs-* tokens"
```

---

## Task 8: Bind triggers in `explore.js` (Inbox, Friends, mention autocomplete)

**Files:**
- Modify: `media/webview/explore.js`

- [ ] **Step 1: Bind avatar clicks in the Inbox row renderer**

Locate `renderChatInbox` (and its dev counterpart `devRenderChatInbox`) in `explore.js`. After the conversation rows are rendered and event listeners attached, add a binding loop for avatars.

For each function, find the `querySelectorAll('.chat-conv-item')` or equivalent loop and add after the existing click handler:

```javascript
container.querySelectorAll('.chat-conv-item[data-other-login]').forEach(function (el) {
  const avatar = el.querySelector('.chat-conv-avatar, .conv-avatar, img.gs-avatar');
  if (avatar) {
    const login = el.getAttribute('data-other-login');
    window.ProfileCard.bindTrigger(avatar, login);
  }
});
```

If the row markup does not currently carry `data-other-login`, add it during HTML generation:

```javascript
'<div class="chat-conv-item" data-id="' + escapeHtml(conv.id) + '" data-other-login="' + escapeHtml(otherLogin) + '">'
```

Verify the click on avatar triggers Profile Card but does NOT also trigger "open conversation" (the `e.stopPropagation()` inside `bindTrigger` handles this).

- [ ] **Step 2: Bind row clicks in the Friends renderer**

Locate `renderChatFriends` and `devRenderChatFriends`. For each friend row, bind the entire row to open the Profile Card while keeping the existing quick-DM button working as a shortcut.

```javascript
container.querySelectorAll('.friend-row[data-login]').forEach(function (row) {
  const login = row.getAttribute('data-login');
  // Bind the avatar + name area, not the DM button
  const clickable = row.querySelector('.friend-info, .friend-avatar');
  if (clickable) {
    window.ProfileCard.bindTrigger(clickable, login);
  }
});
```

Ensure the existing DM button has `e.stopPropagation()` in its own click handler so it does not bubble into the profile card trigger.

- [ ] **Step 3: Bind @mention autocomplete result rows**

Locate the `@mention` autocomplete dropdown renderer in `explore.js` (search for `mention` or `autocomplete`). After result rows are created, bind each row.

Note: for autocomplete, clicking should **insert the mention into the input**, not open the profile card — that is the existing behavior. Profile card binding here is **only** for the avatar thumbnail on the result row, not the whole row. If avatars are not shown in the autocomplete dropdown today, skip this binding for v1 and document in Task 12.

- [ ] **Step 4: Verify type-check + lint**

Run: `npm run check-types` and `npm run lint`
Expected: both exit 0.

- [ ] **Step 5: Manual smoke — click opens Profile Card**

Launch Extension Development Host. Open the Inbox tab. Click a conversation avatar → Profile Card opens with that user. Close. Open Friends tab → click a row avatar or info area → Profile Card opens. Quick DM button still works.

- [ ] **Step 6: Commit**

```bash
git add media/webview/explore.js
git commit -m "feat(profile-card): bind triggers in Inbox, Friends, mention autocomplete"
```

---

## Task 9: Bind triggers in `sidebar-chat.js` — message bubbles + sender names

**Files:**
- Modify: `media/webview/sidebar-chat.js`

- [ ] **Step 1: Bind avatar clicks in message bubble renderer**

Locate the message bubble render function in `sidebar-chat.js` (search for `.gs-sc-bubble` or `renderMessage`). After the bubble DOM is created, add:

```javascript
const avatar = bubble.querySelector('.gs-sc-avatar');
if (avatar && msg.sender_login) {
  window.ProfileCard.bindTrigger(avatar, msg.sender_login);
}
```

- [ ] **Step 2: Bind sender name in group chats**

In the same render function, the sender name for group chats is typically `.gs-sc-sender-name`. Add:

```javascript
const senderName = bubble.querySelector('.gs-sc-sender-name');
if (senderName && msg.sender_login) {
  window.ProfileCard.bindTrigger(senderName, msg.sender_login);
  senderName.style.cursor = 'pointer';
}
```

- [ ] **Step 3: Verify type-check + lint**

Run: `npm run check-types` and `npm run lint`
Expected: both exit 0.

- [ ] **Step 4: Manual smoke — click avatar in open chat**

Launch Extension Development Host. Open a DM conversation. Click the sender's avatar on any incoming message → Profile Card overlay appears, covering the chat view. Open a group chat → click a sender's name → Profile Card opens.

- [ ] **Step 5: Commit**

```bash
git add media/webview/sidebar-chat.js
git commit -m "feat(profile-card): bind triggers on message bubble avatar + sender name"
```

---

## Task 10: Bind triggers in `sidebar-chat.js` — mentions, overlays, reactions

**Files:**
- Modify: `media/webview/sidebar-chat.js`

- [ ] **Step 1: Wrap @mentions in message text**

Locate the message text rendering function (where message body is escaped and parsed for mentions). If mentions are currently rendered as plain text, update to wrap them in a clickable span.

Replace any existing mention-regex substitution or add a new one:

```javascript
function renderMessageText(text) {
  const escaped = escapeHtml(text);
  return escaped.replace(/@([a-zA-Z0-9-]+)/g, function (_match, login) {
    return '<span class="gs-sc-mention" data-login="' + login + '">@' + login + '</span>';
  });
}
```

Make sure this function replaces the existing text renderer, not runs in addition.

After rendering a message body, bind the mentions:

```javascript
bubble.querySelectorAll('.gs-sc-mention[data-login]').forEach(function (el) {
  window.ProfileCard.bindTrigger(el, el.getAttribute('data-login'));
});
```

Add a CSS rule for `.gs-sc-mention` in `sidebar-chat.css` or in the existing mention styles block:

```css
.gs-sc-mention {
  color: var(--gs-link);
  cursor: pointer;
  text-decoration: none;
}
.gs-sc-mention:hover { text-decoration: underline; }
```

- [ ] **Step 2: Bind group info panel member rows**

Locate `showGroupInfoPanel` in `sidebar-chat.js`. After the member list is rendered (around line 2975 based on existing code), bind each row:

```javascript
panel.querySelectorAll('.gs-sc-gi-member[data-login]').forEach(function (row) {
  const login = row.getAttribute('data-login');
  const info = row.querySelector('.gs-sc-gi-member-info') || row;
  window.ProfileCard.bindTrigger(info, login);
  info.style.cursor = 'pointer';
});
```

Ensure this doesn't conflict with the existing Remove button — its click handler must `e.stopPropagation()`.

- [ ] **Step 3: Bind pinned banner author**

Locate the pinned banner render function (search `pin-banner` or `updatePinBanner`). After the banner is populated, bind the author reference if present:

```javascript
const authorEl = banner.querySelector('.gs-sc-pin-author[data-login]');
if (authorEl) {
  window.ProfileCard.bindTrigger(authorEl, authorEl.getAttribute('data-login'));
}
```

If the current pin banner does not expose a login on the author, thread it through during the `setPinBanner` render (add `data-login="${escapeHtml(msg.sender_login)}"`).

- [ ] **Step 4: Bind search result row authors**

Locate the in-chat search result rendering. For each result row, bind the avatar/author:

```javascript
resultsContainer.querySelectorAll('.gs-sc-search-result[data-sender]').forEach(function (row) {
  const login = row.getAttribute('data-sender');
  const avatar = row.querySelector('.gs-sc-search-avatar');
  if (avatar && login) {
    window.ProfileCard.bindTrigger(avatar, login);
  }
});
```

- [ ] **Step 5: Bind reactions dropdown login rows**

Locate the reactions "who reacted" dropdown (search `renderReactionsList` or `reactionsDropdown`). For each login entry:

```javascript
dropdown.querySelectorAll('.gs-sc-reaction-user[data-login]').forEach(function (el) {
  window.ProfileCard.bindTrigger(el, el.getAttribute('data-login'));
  el.style.cursor = 'pointer';
});
```

- [ ] **Step 6: Verify type-check + lint**

Run: `npm run check-types` and `npm run lint`
Expected: both exit 0.

- [ ] **Step 7: Manual smoke — all overlay trigger points**

Launch Extension Development Host.

1. Open a group chat, type `@` and see a message containing `@someuser`. Click the mention span → Profile Card opens.
2. Open group info panel → click a member row → Profile Card opens.
3. Pin a message → open chat → click the author in the pinned banner → Profile Card opens (if banner exposes author).
4. Search in a chat → click an avatar in a search result → Profile Card opens.
5. Long-press or hover a reaction to see the who-reacted list → click a login → Profile Card opens.

- [ ] **Step 8: Commit**

```bash
git add media/webview/sidebar-chat.js
git commit -m "feat(profile-card): bind triggers on mentions, group info, pin banner, search, reactions"
```

---

## Task 11: Full feature smoke test + polish pass

**Files:**
- Read-only audit of everything. Hot-fix any visual/behavioral issues inline.

- [ ] **Step 1: Run the full spec §12 manual test matrix**

Launch Extension Development Host. Execute every checkbox from spec §12.1 through §12.8:

**§12.1 Trigger points:**
- [ ] Friends tab avatar click → card opens eligible
- [ ] Inbox conversation avatar click → card opens
- [ ] Message bubble avatar in open chat → card opens over chat view
- [ ] `@mention` in message text → card opens
- [ ] Group info member row → card opens

**§12.2 State coverage:**
- [ ] Eligible state: Message button closes overlay and opens DM thread
- [ ] Stranger state: Wave shows toast + button disables; Follow optimistically toggles
- [ ] Not-on-gitchat: add a login to `FORCED_OFFLINE` in `profile-card-mocks.ts` temporarily, reopen — Invite button copies clipboard link
- [ ] Self state: clicking own avatar shows Edit Profile + Sign Out buttons

**§12.3 Close behavior:**
- [ ] X button closes
- [ ] Escape key closes
- [ ] Click backdrop closes
- [ ] Click inside card does NOT close
- [ ] Opening another card while one is open closes previous

**§12.4 Caching:**
- [ ] Open same profile twice within 60s → second open is instant (no skeleton)
- [ ] Follow action updates cached follow_status → reopen shows new state
- [ ] Wait 60s → card re-fetches on next open

**§12.5 Error handling:**
- [ ] Disconnect network → try open a profile → error state renders
- [ ] Try a nonexistent user → error state renders

**§12.6 Theme compat:**
- [ ] Switch to Dark+ → card renders correctly
- [ ] Switch to Light+ → card renders correctly
- [ ] Switch to High Contrast Dark → card renders correctly

**§12.7 Sidebar width:**
- [ ] Drag sidebar to ~250px → card wraps/scales reasonably
- [ ] Drag sidebar to 400px → card caps at 320px centered

**§12.8 Regression:**
- [ ] Editor chat panel still works and clicking avatar there still opens editor ProfilePanel
- [ ] Friends quick-DM button still works as shortcut
- [ ] `npm run compile` (full build pipeline) succeeds

- [ ] **Step 2: Fix any issues discovered**

For each failed checkbox above, make the minimal fix in the relevant file (profile-card.js, profile-card.css, explore.ts, sidebar-chat.js) and re-verify. Commit each fix separately with a focused message:

```bash
git add <file>
git commit -m "fix(profile-card): <specific issue>"
```

- [ ] **Step 3: Final full build**

Run: `npm run compile`
Expected: exits 0 (this runs check-types + lint + esbuild production bundle).

- [ ] **Step 4: If any fixes made, no further commit needed here — they were committed in Step 2.**

---

## Task 12: Update contributor doc + BE requirements doc

**Files:**
- Create: `docs/qa/be-requirements-profile-card.md`
- Modify: `docs/contributors/nakamoto-hiru.md`

- [ ] **Step 1: Write BE requirements doc**

Create `docs/qa/be-requirements-profile-card.md` with:

```markdown
# BE Requirements — Profile Card (WP6)

**Source spec:** `docs/superpowers/specs/2026-04-14-profile-card-design.md`
**Status:** Non-blocking. FE ships with isolated mocks; strip paths documented.

---

## 1. `on_gitchat` — add boolean to `GET /profile/:username`

**Why:** Distinguish users who have GitChat accounts from those who are mutual follows on GitHub but have not yet registered on GitChat. Drives the "not-on-gitchat" Profile Card state (shows Invite button instead of Message/Wave).

**Ask:**
- Add `on_gitchat: boolean` to the existing profile response.
- Source of truth: GitChat user table — `true` if a user row exists keyed by GitHub login, `false` otherwise.

**FE strip path:** Replace `mockOnGitchat(raw.login)` with `raw.on_gitchat` in `src/webviews/profile-card-enrich.ts`. Delete the mock function. Estimated work: 5 minutes.

---

## 2. `POST /waves` — send a wave to a non-mutual user

**Why:** WP8 Wave feature — low-friction ice-breaker for stranger-to-stranger contact inside Discover. Profile Card stranger state primary CTA depends on this endpoint.

**Contract:**
- Request: `POST /waves` with body `{ target_login: string }`
- Response 200: `{ success: true, wave_id: string }`
- Response 403: already waved at this target, or target is already a mutual follow of sender
- Rate limit: 1 wave per target per sender per lifetime
- Side effect: emit notification of type `"wave"` to the target user (handler already exists in `src/notifications/toast-rules.ts`)

**FE strip path:** Replace `waveStore.markWaved(target)` in the `profileCard:wave` handler (`src/webviews/explore.ts`) with `await apiClient.wave(target)`. Use returned `success`/`wave_id` to update `profileCardActionResult`. Handle 403 with "already waved" toast. Delete `createWaveMockStore` from `profile-card-mocks.ts`. Add `wave()` method to `apiClient`. Estimated work: 15 minutes.

---

## 3. Optional — `GET /profile/:username/mutual` (pre-computed)

**Status:** Not required. FE currently computes mutuals from GitHub API intersection with 1-hour cache. If BE later provides a pre-computed endpoint returning `{ mutual_friends, mutual_groups }`, FE can skip the intersection and read directly. This is an optimization, not a strip.
```

- [ ] **Step 2: Update `docs/contributors/nakamoto-hiru.md`**

Update the Current section and append a new decisions entry dated 2026-04-14. Open the file and replace the Current section with:

```markdown
## Current
- **Branch:** hiru-uiux
- **Working on:** WP6 Profile Card — implementation complete, awaiting review/merge
- **Blockers:** None
- **Last updated:** 2026-04-14
```

Append to Decisions:

```markdown
- 2026-04-14: WP6 Profile Card implementation complete on hiru-uiux. 5 new files + 4 modifications. Real data for identity/stats/follow_status/mutual_friends/mutual_groups via apiClient + github.ts intersections, mocks isolated in profile-card-mocks.ts for on_gitchat + Wave. 11 trigger points wired across explore.js + sidebar-chat.js via window.ProfileCard.bindTrigger. BE requirements captured in docs/qa/be-requirements-profile-card.md with documented strip paths (5min + 15min). No automated tests — verification via npm run check-types + manual smoke matrix.
```

- [ ] **Step 3: Commit**

```bash
git add docs/qa/be-requirements-profile-card.md docs/contributors/nakamoto-hiru.md
git commit -m "docs(profile-card): BE requirements doc + contributor log update"
```

- [ ] **Step 4: Stop — user decides push/merge**

Per project rules, do not push or create a PR until the user explicitly asks. Report to the user:

> Profile Card implementation complete on `hiru-uiux`. All 12 tasks done, manual smoke test passed, BE requirements captured. Awaiting your decision to push + create PR.

---

## Self-review checklist (executed before handing off)

- [x] **Spec coverage:** every section of the spec maps to at least one task.
  - §1 Purpose → Tasks 1–12 overall
  - §2 Trigger points → Tasks 8, 9, 10
  - §3 Architecture → Task 1 (file layout + load order), Task 6 (public API)
  - §4 Data model → Task 1 Step 6 (types), Task 4 (enrichment)
  - §5 State machine → Task 6 (`determineState`, `renderActions`)
  - §6 Data flow → Tasks 4 (enrich), 5 (host router), 6 (client fetch/cache)
  - §7 UI components → Tasks 6 (DOM), 7 (CSS)
  - §8 Host integration → Task 5
  - §8.5 Mock layer → Task 3
  - §8.6 GitHub API → Task 2
  - §9 Trigger wiring → Tasks 8, 9, 10
  - §10 BE requirements doc → Task 12
  - §11 Rollout phases → plan is the implementation of Phase 1 (the only phase)
  - §12 Testing plan → Task 11

- [x] **No placeholders:** every code block contains real, complete code. No TBD, TODO-for-engineer, "implement later".

- [x] **Type consistency:** `ProfileCardData` shape matches between `types/index.ts`, `enrichProfile`, `profile-card.js render`, and postMessage payloads. `FollowStatus` reused from existing type. `EnrichContext` used only in Task 4 and Task 5.

- [x] **Frequent commits:** 12+ commits across the feature, one per task plus hot-fix commits in Task 11.

- [x] **No unilateral refactoring:** all changes are additive or additive-with-small-wires. No existing file is restructured.
