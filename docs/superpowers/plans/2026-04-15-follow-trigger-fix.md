# Follow Trigger Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix follow actions in GitChat (Trending People tab, Search results) so they actually call the GitHub API and create the GitHub follow relationship.

**Architecture:** Three fixes: (1) add missing message handlers in `explore.ts` for `"follow"`, `"unfollow"`, `"followUser"` messages; (2) subscribe to the global `onDidChangeFollow` event in `explore.ts` to forward state changes to the webview; (3) fix the profile page's Follow button to show the correct initial state by returning `follow_status` from the backend and using the authenticated API path.

**Tech Stack:** TypeScript (VS Code extension, strict mode), NestJS (backend), TypeORM, vanilla JS (webview), Jest (backend unit tests), esbuild (bundler).

**Spec:** `docs/superpowers/specs/2026-04-15-follow-trigger-fix-design.md`

---

## File Map

| File | Action | What changes |
|---|---|---|
| `gitchat_extension/src/webviews/explore.ts` | Modify | Add `"follow"`, `"followUser"`, `"unfollow"` cases + `onDidChangeFollow` subscriber |
| `gitchat_extension/src/types/index.ts` | Modify | Add `follow_status?: FollowStatus` to `UserProfile` interface |
| `gitchat_extension/src/webviews/profile.ts` | Modify | Use `apiClient.getUserProfile()` as primary path instead of unauthenticated `fetch` |
| `gitchat_extension/media/webview/profile.js` | Modify | Init Follow button text and `data-following` from `follow_status.following` |
| `gitchat-webapp/backend/src/modules/user/services/user.service.ts` | Modify | Resolve `viewerLogin` from token and add `follow_status` to `getUserByUsername` response |
| `gitchat-webapp/backend/test/unit/modules/user/user.service.follow-status.spec.ts` | Create | Unit tests for follow_status in getUserByUsername |
| `gitchat_extension/docs/contributors/ethanmiller0x.md` | Modify | Update current status and work log |

---

## Task 1: Add missing message handlers in `explore.ts`

This is the primary bug fix. `"follow"`, `"unfollow"`, and `"followUser"` messages from Trending People and Search results are dropped because `explore.ts` has no handler for them.

**Files:**
- Modify: `gitchat_extension/src/webviews/explore.ts`

Context: The file already handles `"profileCard:follow"` at line 924. The new cases mirror that logic but use `login` from payload (not `username`) and send `"followUpdate"` back to the webview (which `explore.js:1542` already handles).

- [ ] **Step 1: Open `explore.ts` and find the insertion point**

In `src/webviews/explore.ts`, locate the line that reads:
```typescript
case "profileCard:follow": {
```
(currently around line 924). Insert the following three cases **before** it:

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
    this.view?.webview.postMessage({ type: "followUpdate", login, following: true });
  }
  break;
}
```

The error path sends `"followUpdate"` with the reversed value to revert the optimistic UI update that `explore.js` already applied when the button was clicked.

- [ ] **Step 2: Type-check and lint**

```bash
cd gitchat_extension && npm run check-types && npm run lint
```

Expected: no errors. If TypeScript complains about `login` not existing on payload, the cast `(msg.payload as { login: string })` is correct.

- [ ] **Step 3: Build**

```bash
npm run compile
```

Expected: exits with code 0, `dist/extension.js` updated.

- [ ] **Step 4: Commit**

```bash
git add src/webviews/explore.ts
git commit -m "fix(explore): handle follow/unfollow/followUser messages from Trending People and Search"
```

---

## Task 2: Add `onDidChangeFollow` subscriber in `explore.ts`

Follow actions from Profile Card and Profile Page call `fireFollowChanged()` but `explore.ts` never listens to it — so Trending People buttons don't update when you follow someone from another surface.

**Files:**
- Modify: `gitchat_extension/src/webviews/explore.ts`

- [ ] **Step 1: Update the import at the top of `explore.ts`**

Find:
```typescript
import { fireFollowChanged } from "../events/follow";
```

Replace with:
```typescript
import { fireFollowChanged, onDidChangeFollow } from "../events/follow";
```

- [ ] **Step 2: Add a private field to store the subscription**

In the `ExploreWebviewProvider` class body, find where other private fields are declared (e.g. `private view?: vscode.WebviewView`) and add:

```typescript
private _followChangeSub?: vscode.Disposable;
```

- [ ] **Step 3: Register the subscriber in `resolveWebviewView`**

In `resolveWebviewView` (around line 68), after the existing `webviewView.webview.onDidReceiveMessage(...)` line, add:

```typescript
// Dispose previous subscription if view is re-resolved
this._followChangeSub?.dispose();
this._followChangeSub = onDidChangeFollow((e) => {
  this.view?.webview.postMessage({
    type: "followUpdate",
    login: e.username,
    following: e.following,
  });
});
```

- [ ] **Step 4: Type-check, lint, and build**

```bash
npm run check-types && npm run lint && npm run compile
```

Expected: exits with code 0.

- [ ] **Step 5: Commit**

```bash
git add src/webviews/explore.ts
git commit -m "fix(explore): subscribe to onDidChangeFollow to sync follow buttons across surfaces"
```

---

## Task 3: Backend — add `follow_status` to `GET /user/:username`

The backend's `getUserByUsername` response currently has no `follow_status` field. When the extension's `profile.ts` uses the authenticated path, the backend needs to include follow status for the viewer.

**Files:**
- Modify: `gitchat-webapp/backend/src/modules/user/services/user.service.ts`
- Create: `gitchat-webapp/backend/test/unit/modules/user/user.service.follow-status.spec.ts`

Working directory for this task: `gitchat-webapp/backend`

- [ ] **Step 1: Write the failing unit test**

Create `test/unit/modules/user/user.service.follow-status.spec.ts`:

```typescript
/// <reference types="jest" />

jest.mock('jose', () => ({}));

import { UserService } from '../../../../src/modules/user/services/user.service';
import { GitHubService } from '../../../../src/modules/github/github.service';

describe('UserService.getUserByUsername – follow_status', () => {
  let service: UserService;
  let githubService: jest.Mocked<Pick<GitHubService, 'ghFetch'>>;
  let userFollowRepo: { findOne: jest.Mock };
  let fetchSpy: jest.SpyInstance;

  const fakeProfile = {
    login: 'bob',
    name: 'Bob',
    avatar_url: 'https://github.com/bob.png',
    bio: null,
    location: null,
    blog: null,
    company: null,
    email: null,
    public_repos: 5,
    total_private_repos: 0,
    public_gists: 0,
    followers: 10,
    following: 3,
    created_at: '2020-01-01T00:00:00Z',
  };

  beforeEach(() => {
    githubService = { ghFetch: jest.fn() } as any;
    userFollowRepo = { findOne: jest.fn() };

    // Build service with only the deps we need; null for the rest
    service = new (UserService as any)(
      githubService,
      null, // configService
      null, // userProfileRepo
      null, // entityScoreRepo
      null, // userTrackedRepoRepo
      null, // userStarredCacheRepo
      null, // repoViewRepo
      null, // repoRepo
      null, // contributorRepo
      null, // userStarPowerRepo
      userFollowRepo,
      null, // notableAccountRepo
    );

    // Mock global fetch used to resolve viewer login from token
    fetchSpy = jest.spyOn(global, 'fetch' as any);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('includes follow_status.following=true when viewer follows target', async () => {
    githubService.ghFetch
      .mockResolvedValueOnce(fakeProfile)   // GET /users/bob
      .mockResolvedValueOnce([]);           // GET /users/bob/repos

    // Viewer login resolved from token
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ login: 'alice' }),
    } as any);

    // alice follows bob
    userFollowRepo.findOne.mockResolvedValueOnce({ id: 'some-uuid' });

    const result = await service.getUserByUsername('bob', 'tok_alice');

    expect(result.profile.follow_status).toEqual({ following: true });
    expect(userFollowRepo.findOne).toHaveBeenCalledWith({
      where: { followerLogin: 'alice', followingLogin: 'bob' },
      select: ['id'],
    });
  });

  it('includes follow_status.following=false when viewer does not follow target', async () => {
    githubService.ghFetch
      .mockResolvedValueOnce(fakeProfile)
      .mockResolvedValueOnce([]);

    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ login: 'alice' }),
    } as any);

    userFollowRepo.findOne.mockResolvedValueOnce(null);

    const result = await service.getUserByUsername('bob', 'tok_alice');

    expect(result.profile.follow_status).toEqual({ following: false });
  });

  it('omits follow_status when no viewerToken is provided', async () => {
    githubService.ghFetch
      .mockResolvedValueOnce(fakeProfile)
      .mockResolvedValueOnce([]);

    const result = await service.getUserByUsername('bob');

    expect(result.profile.follow_status).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('omits follow_status when viewer login cannot be resolved from token', async () => {
    githubService.ghFetch
      .mockResolvedValueOnce(fakeProfile)
      .mockResolvedValueOnce([]);

    fetchSpy.mockResolvedValueOnce({ ok: false } as any);

    const result = await service.getUserByUsername('bob', 'bad_token');

    expect(result.profile.follow_status).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test — confirm it fails**

```bash
cd gitchat-webapp/backend && yarn test:unit --testPathPattern="user.service.follow-status"
```

Expected: FAIL — `result.profile.follow_status` is `undefined` (field doesn't exist yet).

- [ ] **Step 3: Implement `follow_status` in `getUserByUsername`**

In `src/modules/user/services/user.service.ts`, find the `getUserByUsername` method (around line 355). Inside it, after `const profile = { ... }` is built (around line 394-409), add the viewer-login resolution and follow-status lookup:

```typescript
// Resolve viewer login from token (best-effort)
let resolvedViewerLogin: string | undefined = viewerLogin;
if (viewerToken && !resolvedViewerLogin) {
  try {
    const res = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${viewerToken}`,
        Accept: 'application/vnd.github+json',
      },
    });
    if (res.ok) resolvedViewerLogin = (await res.json()).login;
  } catch { /* ignore */ }
}

// Attach follow_status when we know who the viewer is
let follow_status: { following: boolean } | undefined;
if (resolvedViewerLogin && resolvedViewerLogin.toLowerCase() !== username.toLowerCase()) {
  try {
    const followRecord = await this.userFollowRepo.findOne({
      where: { followerLogin: resolvedViewerLogin, followingLogin: username },
      select: ['id'],
    });
    follow_status = { following: !!followRecord };
  } catch { /* ignore */ }
}
```

Then add `follow_status` to the returned `profile` object. Find where `profile` is constructed and add the field at the end:

```typescript
const profile = {
  login: profileData.login,
  name: profileData.name ?? null,
  avatar_url: profileData.avatar_url,
  bio: profileData.bio ?? null,
  location: profileData.location ?? null,
  blog: profileData.blog ?? null,
  company: profileData.company ?? null,
  email: profileData.email ?? null,
  public_repos: profileData.public_repos ?? 0,
  total_private_repos: profileData.total_private_repos ?? 0,
  public_gists: profileData.public_gists ?? 0,
  followers: profileData.followers ?? 0,
  following: profileData.following ?? 0,
  created_at: profileData.created_at,
  follow_status,           // ← add this
};
```

Note: `follow_status` is added AFTER the resolution block, so it will be defined or `undefined` correctly.

- [ ] **Step 4: Run the test — confirm it passes**

```bash
yarn test:unit --testPathPattern="user.service.follow-status"
```

Expected: all 4 tests PASS.

- [ ] **Step 5: Run full unit test suite to check for regressions**

```bash
yarn test:unit
```

Expected: all existing tests still pass.

- [ ] **Step 6: Commit (backend)**

```bash
cd gitchat-webapp
git add backend/src/modules/user/services/user.service.ts \
        backend/test/unit/modules/user/user.service.follow-status.spec.ts
git commit -m "feat(user): include follow_status in GET /user/:username when viewer token present"
```

---

## Task 4: Extension — add `follow_status` to `UserProfile` type + use authenticated path in `profile.ts`

**Files:**
- Modify: `gitchat_extension/src/types/index.ts`
- Modify: `gitchat_extension/src/webviews/profile.ts`

- [ ] **Step 1: Add `follow_status` to `UserProfile` interface**

In `src/types/index.ts`, find the `UserProfile` interface (line 189):

```typescript
export interface UserProfile {
  login: string;
  name: string;
  avatar_url: string;
  bio: string;
  company: string;
  location: string;
  blog: string;
  followers: number;
  following: number;
  public_repos: number;
  star_power: number;
  top_repos: RepoSummary[];
  created_at?: string;
}
```

Add `follow_status` as an optional field:

```typescript
export interface UserProfile {
  login: string;
  name: string;
  avatar_url: string;
  bio: string;
  company: string;
  location: string;
  blog: string;
  followers: number;
  following: number;
  public_repos: number;
  star_power: number;
  top_repos: RepoSummary[];
  created_at?: string;
  follow_status?: FollowStatus;   // ← add this line
}
```

`FollowStatus` is already defined at line 241 in the same file as `{ following: boolean; followed_by: boolean }`.

- [ ] **Step 2: Swap primary/fallback order in `profile.ts`**

In `src/webviews/profile.ts`, find `loadProfile()` (line 44). Replace the entire method body with:

```typescript
private async loadProfile(): Promise<void> {
  try {
    // Primary: authenticated path — includes follow_status from backend
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw: any = await apiClient.getUserProfile(this._username);
    const profile = raw.profile ?? raw;
    if (!profile.top_repos && raw.repos) { profile.top_repos = raw.repos; }
    this._panel.webview.postMessage({ type: "setProfile", payload: profile });
  } catch (err: unknown) {
    log(`[Profile] API failed for @${this._username}: ${err}, falling back to webapp proxy`, "warn");
    // Fallback: unauthenticated webapp proxy (no follow_status, public data only)
    try {
      const res = await fetch(`${WEBAPP_PROXY}/api/user/${encodeURIComponent(this._username)}`);
      if (!res.ok) { throw new Error(`HTTP ${res.status}`); }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const json: any = await res.json();
      const raw2 = json.data ?? json;
      const profile2 = raw2.profile ?? raw2;
      if (!profile2.top_repos && raw2.repos) { profile2.top_repos = raw2.repos; }
      this._panel.webview.postMessage({ type: "setProfile", payload: profile2 });
    } catch (err2: unknown) {
      const detail = (err2 as Error)?.message ?? String(err2);
      log(`[Profile] Webapp proxy also failed for @${this._username}: ${detail}`, "error");
      this._panel.webview.postMessage({ type: "setError", message: "Failed to load profile" });
    }
  }
}
```

- [ ] **Step 3: Type-check and lint**

```bash
cd gitchat_extension && npm run check-types && npm run lint
```

Expected: exits with code 0.

- [ ] **Step 4: Build**

```bash
npm run compile
```

Expected: exits with code 0.

- [ ] **Step 5: Commit**

```bash
git add src/types/index.ts src/webviews/profile.ts
git commit -m "fix(profile): use authenticated API as primary path to receive follow_status"
```

---

## Task 5: Profile page — initialize Follow button from `follow_status`

**Files:**
- Modify: `gitchat_extension/media/webview/profile.js`

- [ ] **Step 1: Update `renderProfile` to initialize button state**

In `media/webview/profile.js`, find the `renderProfile` function (line 66). At the very top of the function body, after `var u = data.profile || data;`, add one line:

```javascript
function renderProfile(data) {
  var u = data.profile || data;
  var isFollowing = !!(u.follow_status && u.follow_status.following);  // ← add this
  var avatar = u.avatar_url || ...
```

Then find the Follow button HTML (around line 80):

```javascript
'<button class="pf-btn pf-btn-primary" id="followBtn">Follow</button>' +
```

Replace it with:

```javascript
'<button class="pf-btn ' + (isFollowing ? 'pf-btn-secondary' : 'pf-btn-primary') +
  '" id="followBtn" data-following="' + (isFollowing ? '1' : '0') + '">' +
  (isFollowing ? 'Following \u2713' : 'Follow') + '</button>' +
```

- [ ] **Step 2: Verify the click handler still works**

The existing click handler at line 109-113 reads `btn.dataset.following` and sends the correct message. No change needed there — the new `data-following` initialization makes it work correctly from the start.

- [ ] **Step 3: Build**

```bash
cd gitchat_extension && npm run compile
```

Expected: exits with code 0. (`profile.js` is a webview asset, not TypeScript — but the build step verifies the extension as a whole.)

- [ ] **Step 4: Commit**

```bash
git add media/webview/profile.js
git commit -m "fix(profile): initialize Follow button state from follow_status on profile load"
```

---

## Task 6: Update contributor doc

**Files:**
- Modify: `gitchat_extension/docs/contributors/ethanmiller0x.md`

- [ ] **Step 1: Update `## Current` section**

Overwrite the `## Current` section with:

```markdown
## Current
- **Branch:** ethanmiller0x-follow-trigger-fix
- **Working on:** Implementation of follow trigger fix — plan at `docs/superpowers/plans/2026-04-15-follow-trigger-fix.md`
- **Blockers:** None
- **Last updated:** 2026-04-15
```

- [ ] **Step 2: Append to `## Work Log`**

Add a new `### 2026-04-15` block under the existing entry (do not edit past entries):

```markdown
### 2026-04-15 (continued)

**Follow trigger fix — design complete**
- Root cause: `explore.ts` `onMessage` switch has no case for `"follow"`, `"unfollow"`, `"followUser"` — messages from Trending People and Search results dropped silently.
- Profile Card and Profile Page follow work correctly (different message types / handlers).
- Backend `following.service.ts:followUser()` confirmed correct — calls `PUT /user/following/:username` on GitHub.
- Secondary issues: `"followUpdate"` never forwarded from `explore.ts`; profile page button always shows "Follow" on load.
- Design spec: `docs/superpowers/specs/2026-04-15-follow-trigger-fix-design.md`
- Plan: `docs/superpowers/plans/2026-04-15-follow-trigger-fix.md`
- Fix 3 (profile page + backend) requires backend change in `gitchat-webapp` to return `follow_status` in `GET /user/:username`.
```

- [ ] **Step 3: Commit everything**

```bash
cd gitchat_extension
git add docs/contributors/ethanmiller0x.md docs/superpowers/plans/2026-04-15-follow-trigger-fix.md
git commit -m "docs: update contributor doc and add implementation plan for follow trigger fix"
```

---

## Manual Testing Checklist

After all tasks are implemented:

**Fix 1 + 2 (Trending People / Search):**
1. Open VS Code with the extension loaded
2. Go to Trending People tab → click Follow on any user
3. Check Output panel (filter: GitchatAI) — should see `[API] PUT /follow/{username}` log
4. Follow from Profile Card → verify Trending People button also updates to "Following ✓"

**Fix 3 (Profile page):**
1. Open a profile for someone you follow (via `viewProfile` command)
2. Button should show "Following ✓" immediately on load, not "Follow"
3. Click "Following ✓" → should unfollow → button reverts to "Follow"
4. Open a profile for someone you don't follow → should show "Follow"
