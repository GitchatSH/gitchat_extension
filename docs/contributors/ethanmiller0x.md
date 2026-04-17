# ethanmiller0x

## Current

- **Role:** BE
- **Branch:** fix/graphql-contributed-repos (on `gitchat-webapp`)
- **Working on:** PR review — `gitchat-webapp#13` — GraphQL fix for contributed repos (closes `gitchat_extension#93`)
- **Blockers:** None
- **Last updated:** 2026-04-16

## WP5: Chat System — Summary for AI Agents

**Spec:** `docs/superpowers/specs/2026-04-13-gitchat-rebrand-feature-spec.md` §WP5

WP5 implements 4 distinct conversation types that share a unified chat UI but differ in join/creation rules:

| Type           | Key rule                                                                  | Auto-created?        |
| -------------- | ------------------------------------------------------------------------- | -------------------- |
| DM (5A)        | Sender must follow recipient; recipient can reply freely                  | No — user initiates |
| Group (5B)     | All members must mutual-follow the creator + have active GitChat accounts | No — user creates   |
| Community (5C) | Restricted to repo stargazers; gate checked via GitHub API                | Yes — one per repo  |
| Team (5D)      | Restricted to repo contributors; gate checked via GitHub API              | Yes — one per repo  |

**Key files touched:**

- `src/webviews/explore.ts` — conversation type enum, DM eligibility logic, group create validation
- `media/webview/explore.js` — chat UI renders conversation header/input conditionally by type
- `src/api/index.ts` — new endpoints: `POST /conversations` (group create), join-gate checks
- `src/types/index.ts` — `ConversationType` enum + `Conversation` shape extended with `type`, `repo_owner`, `repo_name`

**Architecture notes:**

- Community and Team groups are auto-provisioned on the backend when the first eligible user joins — the extension just calls the join endpoint and the server creates the group if it doesn't exist.
- DM eligibility is checked client-side from cached `githubDataCache.getFollowing()` (WP11 data) before the send button activates. No extra API call at send time.
- Group create modal validates mutual-follow + active-account constraints by calling `POST /groups/validate-members` before the create call.

---

## WP7: Repo Activity Notifications — Summary for AI Agents

**Spec:** `docs/superpowers/specs/2026-04-13-gitchat-rebrand-feature-spec.md` §WP7

WP7 injects repo activity events as special system messages inline inside Community (5C) and Team (5D) chats.

**4 event types tracked (main/default branch only):**

1. `release` — new tag published
2. `pr_merged` — pull request merged into main
3. `commit_main` — direct push (not via PR)
4. `issue_opened` — new issue created

**How it works:**

- Backend receives GitHub webhook events → filters to the 4 types + main branch → fans out a `repo_activity` message row to the relevant community/team chat room.
- Extension receives these via WebSocket as a message with `type: "repo_activity"` — handled separately from normal user messages in the message renderer.
- UI: repo activity messages render with a distinct style (system bubble, no avatar, repo icon + event description + GitHub link). Defined in `media/webview/sidebar-chat.css` as `.gs-sc-repo-activity`.

**Key files touched:**

- `media/webview/sidebar-chat.js` — `renderMessage` branches on `msg.type === 'repo_activity'` to call `renderRepoActivity(msg)`
- `media/webview/sidebar-chat.css` — `.gs-sc-repo-activity` component (border-left accent, monospace repo slug, codicon per event type)
- `src/realtime/` — WebSocket message handler extended to accept `repo_activity` event type and route to the correct chat panel

**Codicon mapping per event:**

| Event        | Codicon                |
| ------------ | ---------------------- |
| release      | `codicon-tag`        |
| pr_merged    | `codicon-git-merge`  |
| commit_main  | `codicon-git-commit` |
| issue_opened | `codicon-issues`     |

**Out of scope (not in WP7):**

- Notification bell / push notification for repo activity — that is WP10 (Ryan)
- Filtering which events a user wants — deferred, currently all 4 types show

---

---

## Work Log

<!-- Append a new ### YYYY-MM-DD block for each session. Never edit past entries. -->

### 2026-04-14

**WP5 + WP7 shipped**

- WP5 (Chat System) and WP7 (Repo Activity Notifications) complete and merged to `develop`.
- DM eligibility: one-way follow (sender follows recipient) — matches spec §5A, no mutual follow required.
- Group create validation calls `POST /groups/validate-members` server-side instead of client-side GitHub API calls.
- WP7 repo activity messages injected as system messages in the chat stream (unified timeline, not a separate panel).
- `renderRepoActivity()` isolated as a standalone helper in `sidebar-chat.js` so WP10/WP4 can evolve independently.

**GitHub Follows Sync cron job (gitchat-webapp backend)**

- Root cause diagnosed: `syncGitHubFollows` at sign-in is additive-only → stale unfollows never deleted → `NOT_ELIGIBLE 403` when DMing users no longer followed.
- Plan written at `backend/docs/superpowers/plans/2026-04-14-github-follows-sync-cron.md`.
- Implemented `GithubFollowsSyncJob` (`src/modules/schedule/jobs/github-follows-sync.job.ts`):
  - Runs every 6 hours via `@Cron('0 */6 * * *')`.
  - In-process mutex (`private isRunning = false`) prevents re-entrant execution on single-node scheduler.
  - Queries active users (last 30 days) ordered by `github_follows_synced_at ASC NULLS FIRST`, max 100/run.
  - Full reconciliation: deletes stale records + upserts new follows via GitHub REST API.
  - 10 unit tests, all passing.
- Created `scripts/backfill-github-follows.js` for one-time cleanup of existing stale records.
  - Ran on dev DB: 42 active users, -157 stale records deleted, +265 new records added.
- Pushed to branch `fea/github-follow-sync-cron-job` on `gitchat-webapp`.

---

### 2026-04-15

**WP5B group creation — 3 bugs diagnosed and fixed (backend: `gitchat-webapp`)**

Root cause investigation for "No users found" in New Group modal and 403 errors on group creation.

**Bug 1: `isFollowing()` always returned false for the second party**

- File: `backend/src/modules/messages/services/github-gate.service.ts`
- Cause: used `/user/following/{target}` which is token-owner-contextual — when checking
  "does member follow creator", it actually checked "does the creator follow themselves" → always 404 → false.
- Fix: changed to `/users/{follower}/following/{target}` which works with any valid token.

**Bug 2: Active GitChat account gate was bypassed**

- File: `backend/src/modules/messages/services/messages.service.ts`
- Cause: code fell back to GitHub API and auto-created a `user_profiles` row for any GitHub user,
  bypassing the "signed in at least once" requirement.
- Fix: removed GitHub fallback; if no profile in DB → throw `notEligible` directly.

**Bug 3: New Group modal showed empty list despite mutual follows existing in DB**

- Root cause: Redis hot cache (`github-data:friends:{login}`, 5-min TTL) held stale `{ mutual: [] }`
  from before the follow sync. Extension called `getMyFriends()` without `force`, hit the stale cache,
  and sent `mutualFriends: []` to the webview.
- Fix A (`github-friends.resolver.ts`): inject `CacheService`; after `syncGitHubFollows()` completes,
  delete the hot cache key so the next read always reflects fresh DB data.
- Fix B (`github-data.service.ts`): in the floor-locked path, update the hot cache after resolving
  from DB, so subsequent non-forced calls also benefit from the latest state.
- Fix C (`gitchat_extension/src/webviews/explore.ts`): always pass `force=true` to `getMyFriends()`
  so the panel bypasses the hot cache on every refresh. Backend floor lock (5-min) prevents
  GitHub API abuse; the DB query is cheap.

All fixes committed and pushed → `gitchat-webapp` `develop` (commit `f3b24d6`).

**Investigating: follow inside GitChat does not trigger GitHub follow**

- Observed: when a user follows someone inside the GitChat system, the action is recorded locally
  but GitHub's follow relationship is NOT created — meaning mutual-follow gate checks still fail
  until the user manually follows on GitHub.
- Next: trace the follow action end-to-end (extension command → backend endpoint → does it call
  `PUT /user/following/{target}` on GitHub API or only write to internal DB?).

---

### 2026-04-15

**Follow trigger fix — fully implemented**

Root cause: `explore.ts` `onMessage` switch had no cases for `"follow"`, `"unfollow"`, `"followUser"` — messages from Trending People and Search results dropped silently, `apiClient.followUser()` never called.

Design spec: `docs/superpowers/specs/2026-04-15-follow-trigger-fix-design.md`
Plan: `docs/superpowers/plans/2026-04-15-follow-trigger-fix.md`
Branch: `ethanmiller0x-follow-trigger-fix`

**Fix 1 (explore.ts — message handlers):** Added `case "follow": / case "followUser":` and `case "unfollow":` with optimistic-revert error path. Each calls `apiClient.followUser/unfollowUser`, fires `fireFollowChanged`, clears profile cache, and sends `"followUpdate"` back to webview.

**Fix 2 (explore.ts — cross-surface sync):** Subscribed `ExploreWebviewProvider` to `onDidChangeFollow` event and forwards as `"followUpdate"` to the webview. Follow from Profile Card or Profile Page now syncs Trending People buttons. Subscription disposed on panel close via `dispose()` method.

**Fix 3a (backend — follow_status):** `getUserByUsername` in `user.service.ts` now resolves viewer login from token via `ghFetch('/user')` (parallelized in `Promise.all`) and queries `user_follows` table. Returns `follow_status: { following: boolean }` when viewer is authenticated and not viewing own profile. 5 unit tests added and passing.

**Fix 3b (extension types):** Added `follow_status?: FollowStatus` to `UserProfile` interface in `src/types/index.ts`.

**Fix 3c (profile.ts — authenticated primary path):** `loadProfile()` now uses `apiClient.getUserProfile()` as primary (authenticated, receives `follow_status`). Unauthenticated webapp proxy call demoted to fallback.

**Fix 3d (profile.js — button initialization):** `renderProfile` reads `u.follow_status?.following` to set initial Follow button class (`pf-btn-primary`/`pf-btn-secondary`), `data-following` attribute, and text — consistent with the existing click handler.

---

### 2026-04-16

**GraphQL fix for contributed repos — Discover > Teams (gitchat-webapp backend)**

Root cause diagnosed for Tiger (`psychomafia-tiger`) not seeing `gitchat_extension` in the Teams tab.

**Diagnosis:**

- Old approach used GitHub Search API (`/search/repositories?q=...+author:{login}`) — worked for public repos but failed silently for private org repos in some GitHub SSO configurations.
- Attempted `contributionsCollection` (GraphQL) — same problem: contribution graph algorithm excludes certain private org repos.
- Root cause confirmed: `repositoriesContributedTo` resolves by OAuth token identity (not contribution graph), which correctly includes private org repos.

**Fix (`backend/src/modules/github-data/services/github-contributed.fetcher.ts`):**

- Two-call GraphQL approach:
  - **Call 1:** `{ viewer { id } }` — resolves the viewer's stable node ID.
  - **Call 2:** `repositoriesContributedTo(contributionTypes: [COMMIT], includeUserRepositories: true)` with per-repo `history(author: { id: $viewerId }) { totalCount }` on the default branch.
- `commitCount` = default-branch history count; falls back to `1` for repos where the viewer has only feature-branch commits.
- Results sorted by `commitCount` descending, capped at 100.
- Updates existing PostgreSQL cache row in-place (no duplicate insert).

**Why two calls:** GraphQL cannot use a field resolved in the same query (`viewer.id`) as an argument to another field (`history(author: {id: ...})`). The viewer ID must be fetched first, then passed as a `$viewerId` variable in the second query.

**Tests (`test/unit/github-contributed.fetcher.spec.ts`):**

- Full rewrite for two-call approach: `mockTwoCalls()` helper sets up `ghGraphQL` mock with `mockResolvedValueOnce` for each call.
- 10 tests, all passing: mapping, sort, cap-at-100, token propagation, cache persist, rate-limit error, commitCount=1 fallback, null description/language, upsert-existing, generic error.

**Branch & PR:**

- Branch: `fix/graphql-contributed-repos` on `gitchat-webapp`
- PR: `gitchat-webapp#13` → `develop`, closes `gitchat_extension#93`

**Post-deploy note:**

- Tiger's cache clears automatically after 24 h, or admin can delete Redis keys:
  `redis-cli DEL github-data:contributed:psychomafia-tiger github-data:floor:contributed:psychomafia-tiger`
- After cache refresh, switching to the Discover tab triggers `fetchContributedRepos` automatically — no manual API call needed from the extension.

<!-- ### YYYY-MM-DD -->

<!-- Add next session's work log here -->
