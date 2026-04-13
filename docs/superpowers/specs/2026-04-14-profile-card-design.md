# Profile Card — Design Spec

**Work Package:** WP6 (Profile Card)
**Author:** nakamoto-hiru
**Date:** 2026-04-14
**Status:** Draft → awaiting review
**Related:** `docs/superpowers/specs/2026-04-13-gitchat-rebrand-feature-spec.md` (WP6, WP8)
**Pencil mockups:** `docs/pencil/ideas.pen` — screens 11 (eligible) + 11b (stranger)

---

## 1. Purpose

A universal popup overlay shown when a user clicks any account surface (avatar, name, @mention) inside the GitChat sidebar webview. The Profile Card is the connective tissue that turns every username reference in the extension into a one-click contact surface.

**Primary goals:**
- One overlay component, many call sites — single source of truth for "who is this person?"
- Four conditional states: **self**, **eligible** (mutual follow → DM), **stranger** (not mutual → Wave or Follow), **not-on-gitchat** (mutual follow on GitHub but no GitChat account → Invite).
- **Production feature, not demo.** Real data for every field that can be derived from GitHub API. Temporary mocks only for fields that genuinely require BE work (`on_gitchat`, Wave endpoint). Mock modules are isolated and documented so they strip cleanly when BE ships.

**Non-goals (v1):**
- Profile Card in editor panels (chat.ts, profile.ts) — existing `ProfilePanel` stays as full-tab "expanded view".
- Hover-card preview without click.
- Offline cache beyond in-memory 60s TTL.
- Deep linking with referrer tracking.
- Team (contributor-based) mutual groups — only Communities (star-based) are computed v1.

---

## 2. Trigger points (v1 — sidebar only)

Every avatar, display name, or @mention in the sidebar webview opens the overlay. Call sites:

**Inside `explore.js`:**
- Chat Inbox row avatar
- Friends tab row (entire row clickable; the existing quick-DM button stays as shortcut)
- `@mention` autocomplete results

**Inside `sidebar-chat.js`:**
- Message bubble avatar
- Sender name in group chats
- `@mention` span rendered in message text (requires wrapping mentions in `<span class="gs-sc-mention" data-login="…">` during render)
- `showGroupInfoPanel` member list rows
- Pinned banner author
- Search result row author
- Reactions dropdown (list of who reacted) — each login row

**Out of scope (v1):** editor chat panel, editor profile panel, channel rows, trending rows.

**Rule:** click any avatar | display name | @mention → open Profile Card. Reply, DM, and Follow have their own affordances inside the card (or via the existing floating action bar for reply in chat context).

---

## 3. Architecture

### 3.1 File layout

```
media/webview/profile-card.js          — Overlay component (IIFE), exposes window.ProfileCard
media/webview/profile-card.css         — Styles with gs-pc-* prefix, --gs-* tokens only
src/webviews/profile-card-enrich.ts    — enrichProfile(): composes real + mock data
src/webviews/profile-card-mocks.ts     — Isolated mock layer for on_gitchat + Wave
src/api/github.ts                      — Thin GitHub REST wrapper for followers + starred
src/webviews/explore.ts                — Host: loads CSS/JS, routes postMessages
src/types/index.ts                     — Adds ProfileCardData interface
src/api/index.ts                       — Adds wave() method (post-BE only)
```

### 3.2 Load order in `explore.ts` HTML

```html
<link rel="stylesheet" href="${sharedCss}">
<link rel="stylesheet" href="${profileCardCss}">
<link rel="stylesheet" href="${exploreCss}">
<link rel="stylesheet" href="${sidebarChatCss}">
...
<script src="${sharedJs}"></script>
<script src="${profileCardJs}"></script>
<script src="${exploreJs}"></script>
<script src="${sidebarChatJs}"></script>
```

### 3.3 Public API

```js
window.ProfileCard.show(username)        // opens overlay, fetches data, renders
window.ProfileCard.close()               // animates out and destroys DOM
window.ProfileCard.isOpen()              // bool — useful for keyboard handlers elsewhere
window.ProfileCard.bindTrigger(el, user) // helper: attach click→show onto any element
```

The overlay attaches to `document.body` with `position: fixed; inset: 0; z-index: 1000`. This covers the full webview viewport regardless of which tab or view is currently active.

### 3.4 Scope boundary

Only one Profile Card can be open at a time. Opening a new one closes the previous one (no stacking).

---

## 4. Data model

```ts
export interface ProfileCardData {
  // Identity — REAL via apiClient.getUserProfile()
  login: string;
  name: string;
  avatar_url: string;
  pronouns?: string;
  bio?: string;

  // Stats — REAL via apiClient.getUserProfile()
  public_repos: number;
  followers: number;
  following: number;

  // Relationship — REAL, computed client-side
  // following   = my login in target's followers list
  // followed_by = target login in my following list
  follow_status: FollowStatus;

  // Presence
  on_gitchat: boolean;   // 🎭 MOCK: no GitHub or current BE source. See §10.1
  online?: boolean;      // REAL via apiClient.getPresence() when available

  // Mutual — REAL, computed via GitHub API intersection + aggressive cache
  mutual_friends?: Array<{ login: string; avatar_url: string }>;   // intersect(myFriends, targetFollowers)
  mutual_groups?: Array<{ id: string; name: string; type: "community" | "team" }>; // intersect(myStarred, targetStarred) — Communities only v1

  // Stranger decoration — REAL via existing top_repos[0]
  top_repo?: { owner: string; name: string; stars: number };
}
```

### 4.1 Field source summary

| Field                         | Source                                               | Status        |
|-------------------------------|------------------------------------------------------|---------------|
| identity + stats              | `apiClient.getUserProfile()`                         | ✅ Real       |
| `follow_status.following`     | `chatFriends` state (from `getFollowing()`)          | ✅ Real       |
| `follow_status.followed_by`   | `githubAPI.getUserFollowers(target)` + cache         | ✅ Real       |
| `mutual_groups` (communities) | `intersect(myStarred, targetStarred)` + cache        | ✅ Real       |
| `mutual_friends`              | `intersect(myFriends, targetFollowers)` + cache      | ✅ Real       |
| `top_repo`                    | `profile.top_repos[0]`                               | ✅ Real       |
| `on_gitchat`                  | **Temporary mock** (see §8.5)                        | 🎭 Mock → BE  |
| Wave action                   | **Temporary client-side mock** (see §6.3)            | 🎭 Mock → BE  |

The mock layer is isolated in `src/webviews/profile-card-mocks.ts` with explicit `// TODO: REMOVE WHEN BE SHIPS X` markers. Strip path is documented in §11.

---

## 5. State machine

| State          | Condition                                         | Primary CTA         | Secondary CTA          | Banner                              |
|----------------|---------------------------------------------------|---------------------|------------------------|-------------------------------------|
| self           | `login === currentUser`                           | Edit Profile        | Sign Out               | —                                   |
| eligible       | `on_gitchat && following && followed_by`          | Message             | Following ✓ (toggle)   | —                                   |
| stranger       | `on_gitchat && !(following && followed_by)`       | Wave 👋 (stub v1)    | + Follow / Following ✓ | "You don't follow each other yet" ⓘ |
| not-on-gitchat | `!on_gitchat`                                     | Invite to GitChat   | View on GitHub         | —                                   |

**Wave visibility rule:** Wave button appears whenever the relationship is not fully mutual. This covers:
- Neither party follows (true stranger)
- I follow them, they don't follow me back
- They follow me, I haven't followed them back

Eligible requires both directions.

---

## 6. Data flow

### 6.1 Fetch

```
ProfileCard.show(username)
  → check in-memory cache (TTL 60s) → hit: render, return
  → miss: render skeleton, postMessage { type: "profileCard:fetch", username }
explore.ts host
  → raw = apiClient.getUserProfile(username)
  → enriched = enrichProfile(raw, currentUser)
      ├─ githubAPI.getUserFollowers(target)  [cache 1h in globalState]
      ├─ githubAPI.getUserStarred(target)    [cache 1h in globalState]
      ├─ derive follow_status from myFriends ∩ above
      ├─ compute mutual_friends / mutual_groups (intersections)
      ├─ apply on_gitchat mock from profile-card-mocks.ts
      └─ top_repo from raw.top_repos[0]
  → postMessage { type: "profileCardData", payload: ProfileCardData }
profile-card.js
  → determineState(data, currentUser) → render final UI
  → cache data with fetchedAt = now
```

The `enrichProfile` function lives in `src/webviews/profile-card-enrich.ts`. It orchestrates the real computations and delegates only `on_gitchat` to the mock module. When BE ships `on_gitchat` in the profile response, `enrichProfile` drops that line and reads `raw.on_gitchat` directly. When BE ships aggregated `mutual_friends` / `mutual_groups` endpoints, the GitHub API fallback paths can be replaced with a single call — but the current real implementation keeps working as a legitimate fallback indefinitely.

### 6.2 Cache

In-memory `Map<login, { data: ProfileCardData; fetchedAt: number }>` inside `profile-card.js`, TTL 60 seconds.

**Invalidation:**
- On successful `follow` / `unfollow`, update the cached entry's `follow_status` in place.
- On card close, the cache persists (not cleared) so reopening within TTL is instant.

### 6.3 Actions

| Action   | postMessage out            | Host handler                                          | postMessage back                |
|----------|----------------------------|-------------------------------------------------------|----------------------------------|
| follow   | `profileCard:follow`       | `apiClient.followUser` + `fireFollowChanged`          | `profileCardActionResult`        |
| unfollow | `profileCard:unfollow`     | `apiClient.unfollowUser` + `fireFollowChanged`        | `profileCardActionResult`        |
| message  | `profileCard:message`      | `executeCommand("gitchat.messageUser", username)` — always fires; overlay closes immediately on click, does not wait for result | — (close is client-side) |
| wave     | `profileCard:wave`         | **Mock (until BE ships `POST /waves`):** mark `waves_sent[username] = true` in `globalState`, return `{ success: true }`. No network. Client verifies via `globalState` on next profile open. **Real (after BE):** `apiClient.wave(username)` | `profileCardActionResult` — button becomes "Waved ✓" disabled |
| invite   | `profileCard:invite`       | copy `https://dev.gitchat.sh/@:username` to clipboard + `showInformationMessage("Invite link copied")` | —                                |
| github   | `profileCard:openGitHub`   | `env.openExternal("https://github.com/:username")`    | —                                |

Follow/unfollow UI updates are optimistic. On failure, revert the toggle and show an error toast.

### 6.4 Error handling

| Condition           | UI                                                    |
|---------------------|--------------------------------------------------------|
| Fetch network fail  | Minimal fallback: avatar initials, login only, "Failed to load profile" + Retry button. Overlay stays open. |
| 404 user not found  | "User not found" message + Close button only.          |
| Action network fail | Revert optimistic UI + toast error.                    |
| Offline             | Same as fetch network fail.                            |

---

## 7. UI components

### 7.1 DOM structure

```html
<div class="gs-pc-backdrop">
  <div class="gs-pc-card" role="dialog" aria-labelledby="gs-pc-title">
    <button class="gs-pc-close gs-btn-icon" aria-label="Close">
      <i class="codicon codicon-close"></i>
    </button>

    <div class="gs-pc-header">
      <img class="gs-pc-avatar" src="…" alt="">
      <h2 class="gs-pc-name" id="gs-pc-title">Slug Macro</h2>
      <div class="gs-pc-handle">
        @slugmacro <span class="gs-pc-dot">·</span>
        <span class="gs-pc-pronouns">he/him</span>
      </div>
      <p class="gs-pc-bio">shipping pixels @ GitChat. ex-Telegram clone enjoyer</p>
    </div>

    <div class="gs-pc-stats">
      <div class="gs-pc-stat"><strong>42</strong> Repos</div>
      <div class="gs-pc-stat"><strong>12k</strong> Followers</div>
      <div class="gs-pc-stat"><strong>180</strong> Following</div>
    </div>

    <!-- Eligible only -->
    <div class="gs-pc-mutual">
      <div class="gs-pc-mutual-header">MUTUAL — 3 friends · 2 groups</div>
      <div class="gs-pc-mutual-friends">akemi0x · norway · leerob</div>
      <div class="gs-pc-mutual-groups">#design-system-team · #vercel/next.js</div>
    </div>

    <!-- Stranger alternative to mutual -->
    <div class="gs-pc-top-repo">
      <i class="codicon codicon-star-full"></i> vercel/next.js
    </div>

    <!-- Stranger only -->
    <div class="gs-pc-warning">
      <i class="codicon codicon-warning"></i>
      You don't follow each other yet
    </div>

    <div class="gs-pc-actions">
      <button class="gs-btn gs-btn-primary gs-pc-btn-primary">
        <i class="codicon codicon-comment"></i> Message
      </button>
      <button class="gs-btn gs-btn-outline gs-pc-btn-secondary">
        <i class="codicon codicon-check"></i> Following
      </button>
    </div>
  </div>
</div>
```

### 7.2 Key CSS rules

All styles live in `media/webview/profile-card.css`, prefixed `gs-pc-*`. Every color, spacing, and font size uses `--gs-*` tokens. No hardcoded colors, no raw `--vscode-*` references, no font size below 11px.

```css
.gs-pc-backdrop {
  position: fixed; inset: 0;
  background: color-mix(in srgb, var(--gs-bg) 80%, transparent);
  backdrop-filter: blur(2px);
  z-index: 1000;
  display: flex; align-items: flex-start; justify-content: center;
  padding-top: 40px;
  opacity: 0;
  transition: opacity 150ms ease-out;
}
.gs-pc-backdrop.gs-pc-open { opacity: 1; }

.gs-pc-card {
  width: calc(100% - 16px);
  max-width: 320px;
  background: var(--gs-bg);
  border: 1px solid var(--gs-border);
  border-radius: var(--gs-radius);
  padding: 16px var(--gs-inset-x) 12px;
  position: relative;
  transform: translateY(8px);
  transition: transform 150ms ease-out;
}
.gs-pc-backdrop.gs-pc-open .gs-pc-card { transform: translateY(0); }

.gs-pc-close { position: absolute; top: 8px; right: 8px; }

.gs-pc-avatar {
  width: 96px; height: 96px; border-radius: 50%;
  display: block; margin: 8px auto 12px;
  background: var(--gs-button-bg);
}

.gs-pc-name {
  font-size: var(--gs-font-lg);
  font-weight: 600;
  text-align: center;
  margin: 0 0 4px;
}

.gs-pc-handle {
  text-align: center;
  font-size: var(--gs-font-sm);
  color: var(--gs-muted);
  margin-bottom: 8px;
}

.gs-pc-bio {
  font-size: var(--gs-font-sm);
  text-align: center;
  color: var(--gs-fg);
  margin: 0 0 12px;
  line-height: 1.4;
}

.gs-pc-stats {
  display: flex; justify-content: space-around;
  padding: 8px 4px;
  border: 1px solid var(--gs-border);
  border-radius: var(--gs-radius-sm);
  margin-bottom: 12px;
}
.gs-pc-stat { font-size: var(--gs-font-sm); color: var(--gs-muted); }
.gs-pc-stat strong { color: var(--gs-fg); font-weight: 600; display: block; }

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
}

.gs-pc-warning {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px;
  background: color-mix(in srgb, var(--gs-warning) 10%, var(--gs-bg));
  border-left: 3px solid var(--gs-warning);
  border-radius: var(--gs-radius-sm);
  font-size: var(--gs-font-sm);
  color: var(--gs-fg);
  margin: 12px 0;
}
.gs-pc-warning .codicon { color: var(--gs-warning); }

.gs-pc-actions {
  display: flex; gap: 8px;
  margin-top: 12px;
}
.gs-pc-actions .gs-btn { flex: 1; justify-content: center; }
```

### 7.3 Skeleton state

During fetch, the card shows a shimmer skeleton for avatar, name, handle, bio, and stats. Skeleton lines use `color-mix(in srgb, var(--gs-fg) 8%, var(--gs-bg))` with a 1.5s shimmer keyframe. Buttons render disabled and greyed.

### 7.4 Close behavior

- **X button:** always closes.
- **Escape key:** closes when `ProfileCard.isOpen()`.
- **Backdrop click:** clicking outside the card (on the backdrop) closes.
- **Card body click:** does not close.

### 7.5 Animation

Fade + slide up 150ms ease-out. Applied by adding `.gs-pc-open` to the backdrop on mount (after a `requestAnimationFrame` so the transition triggers). On close, remove the class, wait for `transitionend`, then remove the DOM node.

### 7.6 Sidebar width adaptations

- 250px narrow: card fills width with 8px gutters; stats row may wrap; buttons stack vertically if too narrow.
- 400px+ wide: card caps at 320px width, centered horizontally.

---

## 8. Host integration (`explore.ts`)

### 8.1 HTML additions

Add URI getters and link/script tags for `profile-card.css` and `profile-card.js` in the existing HTML template, following the load order in 3.2.

### 8.2 Message router additions

Extend the existing `onDidReceiveMessage` switch in `explore.ts` with the new cases from 6.3.

```ts
case "profileCard:fetch": {
  try {
    const data = await apiClient.getUserProfile(payload.username);
    this.view.webview.postMessage({ type: "profileCardData", payload: data });
  } catch (err) {
    this.view.webview.postMessage({ type: "profileCardError", message: "Failed to load profile" });
  }
  break;
}
case "profileCard:follow": {
  try {
    await apiClient.followUser(payload.username);
    fireFollowChanged(payload.username, true);
    this.view.webview.postMessage({ type: "profileCardActionResult", action: "follow", success: true, username: payload.username });
  } catch (err) {
    this.view.webview.postMessage({ type: "profileCardActionResult", action: "follow", success: false, username: payload.username });
  }
  break;
}
// unfollow, message, wave, invite, github — follow the same pattern
```

### 8.3 `src/api/index.ts` (Phase 2 only)

```ts
async wave(targetLogin: string): Promise<{ success: boolean; waveId?: string }> {
  return this.post(`/waves`, { target: targetLogin });
}
```

### 8.4 `src/types/index.ts`

Add the `ProfileCardData` interface from section 4.

### 8.5 Mock layer — `src/webviews/profile-card-mocks.ts`

Isolated module for fields that require BE work. Every mock function carries a `// TODO: REMOVE WHEN BE SHIPS <X>` marker and a link to §10.

```ts
// TODO: REMOVE WHEN BE SHIPS on_gitchat field in /profile/:username (see §10.1)
// Temporary heuristic: assume every user resolved via our API is on GitChat.
// Override only for demo/test outliers if you need to exercise the not-on-gitchat state.
export function mockOnGitchat(login: string): boolean {
  const FORCED_OFFLINE: string[] = [];  // add GitHub logins here to force not-on-gitchat state
  return !FORCED_OFFLINE.includes(login);
}

// TODO: REMOVE WHEN BE SHIPS POST /waves (see §10.2)
// Client-side simulation of wave send + rate limit (1 per target lifetime).
// State lives in extensionContext.globalState under key "profileCard.wavesSent".
export interface WaveMockStore {
  hasWaved(target: string): boolean;
  markWaved(target: string): void;
}
export function createWaveMockStore(ctx: vscode.ExtensionContext): WaveMockStore { ... }
```

The mock module exports nothing that the overlay or enrichment logic reaches directly except through `enrichProfile` (for `on_gitchat`) and the wave action handler (for `createWaveMockStore`). Removing the module is a 3-step edit in the implementation plan.

### 8.6 GitHub API helpers — `src/api/github.ts`

New slim wrapper around GitHub's REST API for the 2 endpoints Profile Card needs (permanent production code, not mock):

```ts
export async function getUserFollowers(login: string): Promise<Array<{ login: string; avatar_url: string }>>;
export async function getUserStarred(login: string): Promise<Array<{ owner: string; name: string }>>;
```

Both methods read/write a 1-hour in-memory Map cache keyed by `login`. Authentication uses the existing GitHub OAuth token from `authManager` when available (rate limit 5000/h) with an unauth fallback (60/h). Errors bubble as `null` so `enrichProfile` can render empty mutual sections rather than fail the entire card.

---

## 9. Trigger wiring (call-site helper)

A single helper function `window.ProfileCard.bindTrigger(el, username)` attaches a click handler to any DOM element. Call sites update their render functions to call this helper after creating avatar / name / mention elements.

Call-site mapping from section 2 maps one-to-one with touch points in:
- `media/webview/explore.js` (rendering functions for Inbox, Friends, mention autocomplete)
- `media/webview/sidebar-chat.js` (message bubble, sender name, @mention span, group info, pinned banner, search results, reactions dropdown)

Each render function that produces a username reference gains a single line:
```js
window.ProfileCard.bindTrigger(avatarEl, user.login);
```

---

## 10. BE requirements (non-blocking)

Profile Card ships without these. The mocks in §8.5 and the GitHub API computation in §8.6 cover the gap. A separate doc at `docs/qa/be-requirements-profile-card.md` records the asks so BE can pick them up when ready. Each one has a documented strip path in §11.

### 10.1 `on_gitchat` — boolean on existing `GET /profile/:username` response

Needed for the "not-on-gitchat" state. Until BE ships this, the mock heuristic in `profile-card-mocks.ts` assumes every user is on GitChat unless explicitly overridden. Not-on-gitchat state can still be exercised manually by adding a login to the `FORCED_OFFLINE` array for testing.

**Ask:** `on_gitchat: boolean` added to the existing profile response. Source of truth: GitChat user table — `true` if a user row exists keyed by GitHub login, `false` otherwise.

### 10.2 `POST /waves` — send a wave

Needed to turn the Wave button from client-side mock into real BE-backed action. Until BE ships this, the mock store in `profile-card-mocks.ts` tracks sent waves in `extensionContext.globalState` so the "already waved" state persists per-install, but recipients never receive anything.

**Ask:**
- Request: `{ target_login: string }`
- Response 200: `{ success: true, wave_id: string }`
- Response 403: already waved at this target, or target is already a mutual follow
- Rate limit: 1 wave per target per sender per lifetime
- On success: emit notification of type `"wave"` to the target (handler already exists)

### 10.3 Optional — `GET /profile/:username/mutual`

Not required. Current implementation computes mutual friends and mutual groups from GitHub API intersections with aggressive caching (§8.6). If BE later exposes a pre-computed endpoint, `enrichProfile` can skip the intersection and read directly — but there is no urgency, and the existing computation is a valid fallback.

---

## 11. Rollout — single release, mock strip path documented

This spec ships the **complete Profile Card feature** in one release. Mocks are isolated behind clear markers in `profile-card-mocks.ts` so they can be stripped as BE catches up without re-architecting.

### 11.1 What ships now

All four states (self, eligible, stranger, not-on-gitchat), all actions (Message, Follow/Unfollow, Wave, Invite, View on GitHub), full fetch/cache/error handling, all 11 trigger points wired. Real data for name, bio, avatar, stats, `follow_status`, `mutual_friends`, `mutual_groups`, `top_repo` — via `apiClient.getUserProfile()` and GitHub API intersections cached in-memory for 1 hour. Mocks only for `on_gitchat` and Wave.

### 11.2 Strip path — when BE ships `on_gitchat` field

1. In `src/webviews/profile-card-enrich.ts`: replace `mockOnGitchat(raw.login)` with `raw.on_gitchat`.
2. Delete `mockOnGitchat` from `profile-card-mocks.ts`.
3. Add `on_gitchat: boolean` to `UserProfile` interface in `types/index.ts`.

Estimated strip work: 5 minutes, no UI changes.

### 11.3 Strip path — when BE ships `POST /waves`

1. Replace `waveStore.markWaved(target)` in the `profileCard:wave` handler with `await apiClient.wave(target)`.
2. Use returned `success`/`wave_id` to update `profileCardActionResult` payload.
3. Handle 403 (already waved, rate limit) with proper toast + persistent button state.
4. Delete `createWaveMockStore` and `WaveMockStore` from `profile-card-mocks.ts`.
5. Add `wave()` method to `apiClient` in `src/api/index.ts`.

Estimated strip work: 15 minutes, no UI changes.

### 11.4 Optional future enhancement — BE-aggregated mutual endpoint

If BE later ships `GET /profile/:username/mutual` returning pre-computed `{ mutual_friends, mutual_groups }`, the GitHub API intersection fallback in `enrichProfile` can be replaced with a single call. This is not a strip — the current computation is legitimate production code and remains a valid fallback indefinitely.

---

## 12. Testing plan

### 12.1 Manual smoke (every trigger point)

- [ ] Click friend avatar in Friends tab → overlay opens with skeleton → data loads → eligible state
- [ ] Click DM conversation avatar in Inbox → same flow
- [ ] Click message bubble avatar in open chat → overlay covers chat header + input
- [ ] Click @mention in message text → overlay opens for that user
- [ ] Click member row in group-info panel → overlay opens above group panel

### 12.2 State coverage

- [ ] Eligible: Message button → closes overlay + opens DM
- [ ] Stranger: Wave → toast "Wave coming soon" + close; Follow → optimistic toggle
- [ ] Not on GitChat: Invite → copy link + toast "Invite link copied"
- [ ] Self: Edit Profile + Sign Out buttons render. Edit Profile opens `https://dev.gitchat.sh/settings` via `env.openExternal` (no in-extension edit surface v1). Sign Out calls existing `gitchat.signOut` command.

### 12.3 Close behavior

- [ ] X button closes
- [ ] Escape key closes
- [ ] Backdrop click closes
- [ ] Clicking inside card does NOT close
- [ ] Opening another card while one is open closes the previous one (no stacking)

### 12.4 Caching

- [ ] Open same profile twice within 60s → second open uses cache (no network flash)
- [ ] Follow action updates cached entry → reopen shows new state
- [ ] After 60s the card re-fetches

### 12.5 Error handling

- [ ] Offline fetch → shows "Failed to load profile" + Retry
- [ ] 404 user → "User not found" + Close only
- [ ] Follow fails → optimistic revert + toast error

### 12.6 Theme compatibility

- [ ] Dark+ (default)
- [ ] Light+
- [ ] High Contrast Dark
- [ ] Verify no raw `--vscode-*` references, no hardcoded colors

### 12.7 Sidebar width stress

- [ ] 250px narrow — card usable, buttons may stack
- [ ] 400px+ wide — card capped at 320px, centered

### 12.8 Regression

- [ ] Existing editor `ProfilePanel` (chat panel, profile full view) still works unchanged
- [ ] Clicking avatar in editor chat panel still opens editor `ProfilePanel`, not the sidebar overlay
- [ ] Friends list quick DM button still works as shortcut alongside overlay-on-row-click

### 12.9 Out of scope for testing

- Automated unit tests (webview is vanilla JS, no test framework set up for it)
- E2E tests (extension has no E2E harness)
- Accessibility audit beyond `role="dialog"` + `aria-labelledby` and manual keyboard test (Tab cycle, Escape close)

---

## 13. Open questions

None. All design decisions confirmed during brainstorming session 2026-04-14.

---

## 14. Changelog

- **2026-04-14** — Initial draft by nakamoto-hiru after brainstorming session with Claude.
