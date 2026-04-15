# Discovery → Community: Starred-Repo Filter + Remove-On-Join

**Date:** 2026-04-15
**Status:** Draft — design approved, pending spec review
**Scope:** `gitchat_extension/` (VS Code extension) only. No backend or DB changes.

## Problem

The Explore panel's **Discovery → Community** section currently renders `chatChannels`, which is the list of communities the user has **already joined** (backed by `GET /channels`). This is semantically wrong for a "Discovery" surface — a user cannot discover communities they are already a member of.

Two related requirements:

1. **Show only starred repos (not-yet-joined).** The Discovery Community list should reflect "communities the user could join next," scoped to repos the user has starred on GitHub. Repos already joined as communities should not appear.
2. **Remove on join.** When the user clicks **Join** on a Discovery community row and the join succeeds (existing flow), that repo should disappear from the Discovery Community list and appear in the Chat tab's community list (the latter already works).

## Non-Goals

- No backend API changes. Both required endpoints already exist.
- No DB schema changes. Starred-repo data is already cached in `user_starred_cache` (backend) and exposed via `GET /github/data/starred`.
- No changes to the community join flow itself. The stargazer gate, conversation creation, and member insertion in `messages.service.ts` `createCommunityOrTeamConversation()` are unchanged.
- No changes to the Chat tab. Community rows there will continue to come from `getMyChannels()` unchanged.
- No changes to the People, Teams, or Online Now sections of Discovery.

## Current State (verified)

### Extension

- [media/webview/explore.js:927](../../../media/webview/explore.js#L927) — `var communities = chatChannels || [];` — Discovery Community list sourced from joined channels.
- [media/webview/explore.js:976-979](../../../media/webview/explore.js#L976-L979) — `buildAccordionSection("discover", "communities", …)` renders the section; empty state is already "Star repos on GitHub to discover communities" (consistent with new design).
- [media/webview/explore.js:1019-1032](../../../media/webview/explore.js#L1019-L1032) — `buildDiscoverCommunityRow(channel)` expects fields `{ repoOwner, repoName, displayName, avatarUrl, subscriberCount }`.
- [src/api/index.ts:621](../../../src/api/index.ts#L621) — `getMyStarredRepos(force?)` returns `{ repos: StarredRepo[], fetchedAt, stale }` via `GET /github/data/starred`.
- [src/api/index.ts:549](../../../src/api/index.ts#L549) — `getMyChannels()` returns list of joined channels.
- [src/types/index.ts:354](../../../src/types/index.ts#L354) — `StarredRepo = { owner, name, description, language, stars, forks, avatarUrl, htmlUrl, pushedAt }`. **Note:** no subscriber count, no displayName, no starredAt. `pushedAt` is the only time field available.
- [src/webviews/chat-handlers.ts:705-721](../../../src/webviews/chat-handlers.ts#L705-L721) — `joinCommunity` handler calls `apiClient.joinConversation('community', { repoFullName })` and posts `joinedConversation` message back to the webview.
- [src/github-data/index.ts:65](../../../src/github-data/index.ts#L65) — `GitHubDataService.getStarred()` provides a cached accessor used elsewhere in the extension.

### Backend (reference only — no changes)

- `repo-channels.controller.ts` `GET /channels` — list user's joined channels.
- `messages.service.ts` `createCommunityOrTeamConversation()` — already enforces `isStargazer()` gate and creates/finds the conversation. The join flow is complete and correct.
- `user_starred_cache` table — JSONB cache of user's starred repos, populated by a separate sync job. Single source of truth for `GET /github/data/starred`.

## Design

### Data Model (in-webview)

The webview currently has global state variables: `chatFriends`, `chatChannels`, `chatMutualFriends`, etc. Add one more:

```js
var starredRepos = [];             // StarredRepo[] from getMyStarredRepos
var joinedCommunityRepoSet = null; // Set<string> of repoFullName for joined communities
```

`joinedCommunityRepoSet` is derived from `chatChannels` whenever that list changes. Recompute lazily inside `renderDiscover()` or eagerly in the message handler that sets `chatChannels`.

### Filter Logic

Inside `renderDiscover()`, replace:

```js
var communities = chatChannels || [];
```

with:

```js
var joinedSet = buildJoinedCommunitySet(chatChannels);
var communities = (starredRepos || [])
  .filter(function(r) { return !joinedSet.has(repoFullName(r)); })
  .map(toDiscoverCommunityShape);
```

where:

- `repoFullName(r)` = `r.owner + "/" + r.name`
- `buildJoinedCommunitySet(channels)` iterates channels, selects those with community type (or with both `repoOwner` + `repoName`), and returns `new Set(["owner/name", …])`. Use the existing channel-shape inspection already in `buildDiscoverCommunityRow` as the reference.
- `toDiscoverCommunityShape(starredRepo)` adapts `StarredRepo` to the shape `buildDiscoverCommunityRow` expects:
  ```js
  {
    repoOwner: r.owner,
    repoName: r.name,
    displayName: r.owner + "/" + r.name,
    avatarUrl: r.avatarUrl,
    subscriberCount: undefined,  // unknown — see Row Rendering below
    _source: "starred"           // marker for row-level behavior
  }
  ```

The existing search-query filter on `communities` (explore.js:934) continues to work on the mapped shape because it already reads `displayName` / `repoOwner/repoName`.

### Row Rendering

`buildDiscoverCommunityRow` currently shows `<subscriberCount> subscribers` in the subtitle. For Discover-from-starred rows, subscriber count is unknown (the repo may not even have a `repo_channels` record yet — community is created lazily on first join).

Adjust the subtitle:

- If `channel._source === "starred"` or `subscriberCount == null`: render the repo description (truncated) or, if description is missing, render "New community" with a `codicon-sparkle` icon.
- Otherwise: current behavior unchanged (kept for safety; no code path should hit it now but the row builder is defensive).

This is the only cosmetic change to the row builder. Button, avatar, click target, and `data-repo` attribute are unchanged, so the existing `bindDiscoverRowHandlers` + `joinCommunity` message flow keeps working with zero changes.

### Fetching Starred Repos

Starred repos need to be fetched once when the Explore panel initializes and made available to the webview alongside `chatChannels`. Two options:

- **A.** Fetch in `src/webviews/explore.ts` provider, post as an initial message to the webview (same pattern as `chatFriends` / `chatChannels`).
- **B.** Fetch lazily inside the webview via a message round-trip the first time the user opens Discovery.

Choose **A** for simplicity and to match the existing pattern. Use `GitHubDataService.getStarred()` (already cache-aware) rather than calling `apiClient.getMyStarredRepos()` directly. Post a `starredReposLoaded` message to the webview with `{ repos, stale }`.

If `stale === true`, still render immediately, then trigger a background refresh (`getStarred({ force: true })`) and post an updated `starredReposLoaded` when it completes. Failures of the background refresh are silent (keep showing the stale list).

If the **initial** fetch fails entirely, post `starredReposLoaded` with `{ repos: [], error: true }`; the webview renders an error empty state instead of "no starred repos" to distinguish the two cases.

### Sort Order

`StarredRepo` has no `starredAt` field. GitHub's underlying API does return stars newest-first by default, and the backend cache should preserve that order. Trust the order from `getMyStarredRepos()` as-is — do not resort client-side. If the order turns out to be wrong in practice, that is a backend-cache bug to fix separately, not a concern of this spec.

### Remove-On-Join

The join flow already ends with a `joinedConversation` message posted to the webview ([chat-handlers.ts:705-721](../../../src/webviews/chat-handlers.ts#L705-L721)). The webview message router already handles this for the Chat tab. Extend that handler:

1. When `joinedConversation` arrives with `type === "community"` and a `repoFullName` / `repoOwner + repoName`:
   - Add `"owner/name"` to `joinedCommunityRepoSet` (if the set is being cached) **or** update `chatChannels` to include the new channel (which will make `buildJoinedCommunitySet` return it on next render).
   - Call `renderDiscover()` to re-render. The joined repo will drop out of the filtered list.
2. The Chat tab's existing handling is unchanged — it already reacts to `joinedConversation` and shows the new community there.

If the join fails (handler receives an error message instead of `joinedConversation`), no state update happens and the repo stays in Discovery. The existing error toast/notification handles user feedback.

### Empty States

Three distinct states for the Discovery Community section:

1. **No starred repos at all:** `Star repos on GitHub to discover communities` + `codicon-star` — already the current empty state; keep it.
2. **All starred repos already joined:** `You've joined communities for all your starred repos` + `codicon-check`. New empty state.
3. **Fetch error:** `Couldn't load starred repos. Retry.` + `codicon-warning` + retry affordance (click re-triggers fetch). New empty state.

Distinguish (1) vs (2) by checking `starredRepos.length === 0` vs `filteredCommunities.length === 0 && starredRepos.length > 0`. Distinguish (3) by a dedicated `starredReposError` flag set from the initial-fetch-failure branch.

### Search Interaction

The existing `chatSearchQuery` filter on `communities` (explore.js:931-934) runs after the starred-filter. Order: **starred-filter → search-filter**. No change needed to the search code because it operates on the already-mapped community shape (`displayName`, `repoOwner`, `repoName` all present).

## Affected Files

| File | Change |
|---|---|
| [src/webviews/explore.ts](../../../src/webviews/explore.ts) | On panel init, call `githubDataService.getStarred()`; post `starredReposLoaded` message to webview. On stale result, kick off background refresh and post again. On error, post with error flag. |
| [media/webview/explore.js](../../../media/webview/explore.js) | Add `starredRepos` + `starredReposError` state. Handle `starredReposLoaded` message. In `renderDiscover()`, compute `joinedCommunityRepoSet` from `chatChannels`, filter `starredRepos` through it, map to community-row shape, render. Update `buildDiscoverCommunityRow` subtitle for starred-source rows. Handle `joinedConversation` in the webview message router by updating state and calling `renderDiscover()`. Add two new empty-state variants. |
| [src/webviews/chat-handlers.ts](../../../src/webviews/chat-handlers.ts) | Likely no change — `joinedConversation` message is already posted on successful join. Verify during implementation; if the webview doesn't already receive it, add the postMessage. |

### Explicitly not touched

- `gitstar-webapp/backend/**` — all backend endpoints, services, entities, and DB schema.
- The join community flow — stargazer gate, conversation creation, member insertion.
- The Chat tab rendering or state.
- People, Teams, Online Now sections of Discovery.
- `GitHubDataService` itself — only consumed, not modified.
- Design tokens and CSS — reuse existing `.gs-row-item`, `.gs-btn-outline`, `.gs-empty`, `.gs-text-xs`, `.gs-text-muted`, and codicons per the extension's design rules.

## Error Handling

| Failure | Behavior |
|---|---|
| `getMyStarredRepos()` initial fetch fails | Discover Community shows "Couldn't load starred repos. Retry." empty state. Other Discovery sections (People, Teams, Online Now) unaffected. |
| Stale cache | Render stale data immediately, background refresh, re-render on success, silent on background failure. |
| `joinConversation()` fails | Existing error path; no Discovery state update; repo stays visible. |
| `joinedConversation` arrives for a repo not in `starredRepos` | Still valid — the repo may have been joined through another code path (e.g., Chat tab). Add it to the joined set but no re-render is needed (it wasn't visible in Discovery anyway). |
| User unstars a repo on GitHub between fetches | Cache refresh eventually catches up. Out of scope for this spec to force an immediate refresh. |

## Testing / Verification

Manual test plan (pre-commit):

1. **Happy path — filter.** Star 3 repos on GitHub the user has not joined as communities. Open extension → Explore → Discovery. Expect: all 3 repos appear in Community section. Subscriber count field replaced by description / "New community".
2. **Happy path — remove on join.** From state (1), click **Join** on one repo. Expect: the row disappears from Discovery Community immediately (no full reload). Switch to Chat tab: the community appears there. Backend `message_conversation_members` contains a row for the user.
3. **Already-joined exclusion.** Join a community via Chat tab (or pre-seed via API). Open Discovery. Expect: that repo does not appear in Discovery Community even though it is starred.
4. **Empty state — no stars.** Use an account with zero starred repos. Expect: existing "Star repos on GitHub to discover communities" empty state.
5. **Empty state — all joined.** Star 2 repos and join both. Expect: new "You've joined communities for all your starred repos" empty state.
6. **Empty state — fetch error.** Mock `GET /github/data/starred` to return 500. Expect: new error empty state with retry affordance. Retry recovers.
7. **Stale cache.** Force `stale: true` response. Expect: list renders immediately, background refresh runs, list updates without flash.
8. **Search interaction.** With 3 starred unjoined repos, type search query matching 1 of them. Expect: only that row visible. Clear query → all 3 visible again.
9. **Lint + type-check.** `npm run check-types` and `npm run lint` both pass.

Automated tests: the extension has no component tests for `explore.js` today; do not introduce them in this change. If any unit-testable pure helper is extracted (e.g., `buildJoinedCommunitySet`), consider a lightweight test, but this is optional.

## Open Risks

- **Order of messages.** `starredReposLoaded` and `chatChannelsLoaded` arrive asynchronously. `renderDiscover()` must handle either-order (render what's available, re-render when the other arrives). The existing pattern for `chatFriends` / `chatChannels` already does this — follow it.
- **`StarredRepo` vs `chatChannels` name normalization.** `StarredRepo.owner`/`name` must match exactly against `chatChannels[i].repoOwner`/`repoName`. GitHub case-preserves repo names but is case-insensitive on lookup. Lowercase both sides when building the set and when checking membership to avoid a false "not joined" after a case mismatch.
- **Lazy community creation.** A Discovery row for a starred repo where no `repo_channels` record exists yet is expected and correct — the first Join creates the record. No special handling needed in the extension; the existing `POST /messages/conversations` backend flow already handles creation.

## Contributor Doc Update

Per the extension's sub-CLAUDE.md, Vincent must update `gitchat_extension/docs/contributors/vincent.md` in the same commit as the implementation:

- **Current:** branch name, task = "Discovery Community starred-filter + remove-on-join", blockers, date 2026-04-15.
- **Decisions:** append a one-liner noting the client-side-only approach and the reason (2 existing endpoints were sufficient; avoids backend PR risk).

## Transition

After this spec is approved by reviewer and user, invoke `writing-plans` to produce the step-by-step implementation plan.
