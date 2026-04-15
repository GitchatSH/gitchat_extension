# Design: Follow inside GitChat does not trigger GitHub follow

**Date:** 2026-04-15
**Branch:** develop
**Author:** ethanmiller0x

---

## Problem

When a user clicks Follow inside GitChat (Trending People tab, Search results), the action is recorded visually but never reaches the GitHub API — meaning the GitHub follow relationship is NOT created, and mutual-follow gate checks continue to fail.

---

## Investigation Summary

### All follow entry points and their status (pre-fix)

| Entry point | File | Message sent | Handler | API called? |
|---|---|---|---|---|
| Trending People tab | `explore.js:2074` | `"follow"` / `"unfollow"` | None in `explore.ts` | No |
| Search results | `explore.js:465` | `"followUser"` | None in `explore.ts` | No |
| Profile Card hover | `profile-card-hover.js` | `"profileCard:follow"` | `explore.ts:924` | Yes |
| Profile page full | `profile.js:112` | `"follow"` / `"unfollow"` | `profile.ts:82` | Yes |

### Root cause

`explore.ts` `onMessage` switch only handles `"profileCard:follow"` and `"profileCard:unfollow"`. The messages `"follow"`, `"unfollow"`, and `"followUser"` sent from Trending People and Search results have no matching case — they fall through silently, and `apiClient.followUser()` is never called.

### Backend confirmed working

`following.service.ts:followUser()` correctly:
1. Upserts follow into `user_follows` DB table
2. Calls `PUT https://api.github.com/user/following/{username}` (best-effort, returns `github_synced: boolean`)

The backend is not the problem.

### Secondary issues found

**A. `"followUpdate"` message never forwarded to webview:**
`explore.js:1542` listens for `"followUpdate"` to sync Trending People button state. `explore.ts` never subscribes to `onDidChangeFollow` — so follow actions from Profile Card or Profile Page don't update the Trending People buttons.

**B. Profile page button doesn't reflect initial follow state:**
`profile.js:80` always renders Follow button as "Follow" regardless of current follow status. Root cause: the primary fetch in `profile.ts` is an unauthenticated `fetch()` call to the webapp proxy — no auth token → backend can't determine viewer → `follow_status` is never included in the response.

---

## Design

### Fix 1 — Add missing message handlers in `explore.ts`

Add three cases to `switch(msg.type)` in `ExploreWebviewProvider.onMessage()`:

```typescript
case "follow":
case "followUser": {
  const login = (msg.payload as { login: string }).login;
  try {
    await apiClient.followUser(login);
    fireFollowChanged(login, true);
    this._profileCache.delete(login);
    this._profileCache.delete(authManager.login ?? "");
    this._saveProfileCache();
    this.view?.webview.postMessage({ type: "followUpdate", login, following: true });
  } catch (err) {
    log(`[Explore] follow failed for ${login}: ${err}`, "warn");
    // Revert the optimistic UI update
    this.view?.webview.postMessage({ type: "followUpdate", login, following: false });
  }
  break;
}

case "unfollow": {
  const login = (msg.payload as { login: string }).login;
  try {
    await apiClient.unfollowUser(login);
    fireFollowChanged(login, false);
    this._profileCache.delete(login);
    this._profileCache.delete(authManager.login ?? "");
    this._saveProfileCache();
    this.view?.webview.postMessage({ type: "followUpdate", login, following: false });
  } catch (err) {
    log(`[Explore] unfollow failed for ${login}: ${err}`, "warn");
    // Revert the optimistic UI update
    this.view?.webview.postMessage({ type: "followUpdate", login, following: true });
  }
  break;
}
```

**Optimistic revert:** Trending People already updates the button immediately on click before the API responds. If the API call fails, the error path sends a `"followUpdate"` with the reversed value to revert the button.

**Files:** `src/webviews/explore.ts`

---

### Fix 2 — Subscribe to `onDidChangeFollow` in `explore.ts`

Add a subscriber in `ExploreWebviewProvider` initialization that forwards follow state changes from any source (Profile Card, Profile Page) to the webview as `"followUpdate"`:

```typescript
import { onDidChangeFollow } from "../events/follow";

// In resolveWebviewView() or equivalent init:
this._disposables.push(
  onDidChangeFollow((e) => {
    this.view?.webview.postMessage({
      type: "followUpdate",
      login: e.username,
      following: e.following,
    });
  })
);
```

`explore.js:1542-1548` already handles `"followUpdate"` correctly — no webview-side changes needed.

**Result:** Follow from any surface (Trending People, Search, Profile Card, Profile Page) syncs all follow buttons across the panel.

**Files:** `src/webviews/explore.ts`

---

### Fix 3 — Profile page: correct initial button state

**3a. Backend — add `follow_status` to `GET /user/:username`**

In `user.service.ts:getUserByUsername()`, when `viewerToken` is present:
- Resolve `viewerLogin` via `GET https://api.github.com/user` using the token
- Query `user_follows` table: `WHERE follower_login = viewerLogin AND following_login = username`
- Include `follow_status: { following: boolean }` in the response

**Files:** `gitchat-webapp/backend/src/modules/user/services/user.service.ts`

**3b. Extension — use authenticated path as primary**

In `profile.ts:loadProfile()`, remove the unauthenticated webapp proxy call as primary path. Use `apiClient.getUserProfile()` (authenticated, has Bearer token) as primary. The webapp proxy can serve as fallback for public data only.

```typescript
private async loadProfile(): Promise<void> {
  try {
    const raw: any = await apiClient.getUserProfile(this._username);
    const profile = raw.profile ?? raw;
    if (!profile.top_repos && raw.repos) { profile.top_repos = raw.repos; }
    this._panel.webview.postMessage({ type: "setProfile", payload: profile });
  } catch (err) {
    // fallback: webapp proxy (no follow_status, public data only)
    ...
  }
}
```

**Files:** `gitchat_extension/src/webviews/profile.ts`

**3c. Webview — initialize button from `follow_status`**

In `profile.js:renderProfile()`, read `u.follow_status?.following` to set initial button text and `data-following`:

```javascript
var isFollowing = !!(u.follow_status && u.follow_status.following);
// Button HTML:
'<button class="pf-btn ' + (isFollowing ? 'pf-btn-secondary' : 'pf-btn-primary') +
'" id="followBtn" data-following="' + (isFollowing ? '1' : '0') + '">' +
(isFollowing ? 'Following \u2713' : 'Follow') + '</button>'
```

**Files:** `gitchat_extension/media/webview/profile.js`

---

## Files to change

| File | Change |
|---|---|
| `gitchat_extension/src/webviews/explore.ts` | Add `"follow"`, `"followUser"`, `"unfollow"` cases + `onDidChangeFollow` subscriber |
| `gitchat_extension/media/webview/profile.js` | Initialize Follow button state from `follow_status.following` |
| `gitchat_extension/src/webviews/profile.ts` | Use authenticated API path as primary for `loadProfile()` |
| `gitchat-webapp/backend/src/modules/user/services/user.service.ts` | Add `follow_status` to `getUserByUsername()` response when viewer auth present |

---

## Out of scope

- Caching the follow status result (DB query is cheap, `user_follows` is indexed)
- Follow button in other surfaces not yet identified (if any, same pattern applies)
- Notification on follow from Trending People / Search (profile page shows `vscode.window.showInformationMessage` — parity TBD)
