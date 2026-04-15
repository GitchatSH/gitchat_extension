# Discovery → Starred Communities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change the VS Code extension's Explore → Discovery → Community section to show the user's starred GitHub repos (minus those already joined as communities), and remove a repo from that list when the user successfully joins its community.

**Architecture:** Client-side only. The extension already exposes `getMyStarredRepos()` and `getMyChannels()`; the provider fetches both and posts them to the webview. The webview computes `starred \ joined` in `renderDiscover()` and reacts to the existing `joinedConversation` message to drop the just-joined repo from state and re-render.

**Tech Stack:** TypeScript (strict), vanilla webview JS, VS Code Webview API, esbuild. No new dependencies.

**Spec:** [2026-04-15-discovery-starred-communities-design.md](../specs/2026-04-15-discovery-starred-communities-design.md)

---

## Pre-Flight

- [ ] **Confirm baseline builds clean**

Run from `gitchat_extension/`:

```bash
npm run check-types && npm run lint
```

Expected: both succeed with no errors. If not, stop and surface to the user — do not start implementation on a broken baseline.

- [ ] **Branch**

```bash
cd gitchat_extension
git checkout develop && git pull origin develop
git checkout -b vincent-discovery-starred-communities
```

---

## File Map

| File | Role |
|---|---|
| [src/webviews/explore.ts](../../../src/webviews/explore.ts) | Add `fetchStarredRepos()` method; call it during panel init alongside `fetchChannels()`; post `setStarredReposData` message with `{ repos, stale, error }`. |
| [media/webview/explore.js](../../../media/webview/explore.js) | Add `starredRepos`, `starredReposError` state. Handle `setStarredReposData` message. Rewrite the `communities` source line in `renderDiscover()` to filter starred ∖ joined. Update `buildDiscoverCommunityRow()` subtitle for starred-source rows. Handle `joinedConversation` message to update state. Add "all joined" and "fetch error" empty states. |
| [docs/contributors/vincent.md](../../contributors/vincent.md) | Update **Current** and append a one-line **Decisions** entry per extension sub-CLAUDE.md rules. |

**Not touched:** backend, DB, join-community flow, `chat-handlers.ts` (the `joinedConversation` message is already posted), Chat tab, People/Teams/Online Now sections.

---

## Task 1: Provider fetches starred repos and posts to webview

**Files:**
- Modify: [src/webviews/explore.ts](../../../src/webviews/explore.ts) around line 289-299 (`fetchChannels`) and wherever `fetchChannels()` is called from init.

- [ ] **Step 1: Read the existing `fetchChannels()` pattern**

Read [src/webviews/explore.ts](../../../src/webviews/explore.ts) lines 288-300. This is the template: single async method, try/catch with `log()`, posts one message with a `setXxxData` type. Find all call sites of `fetchChannels()` (grep for `fetchChannels(`) so the new `fetchStarredRepos()` can be wired in at the same places.

- [ ] **Step 2: Read the cached accessor**

Read [src/github-data/index.ts](../../../src/github-data/index.ts) lines 60-80. `GitHubDataService.getStarred()` takes `{ force?: boolean }` and returns `Promise<StarredRepo[]>`. The underlying `apiClient.getMyStarredRepos(force?)` ([src/api/index.ts:621](../../../src/api/index.ts#L621)) returns `{ repos, fetchedAt, stale }`. The cached accessor hides the stale flag, so for this feature call `apiClient.getMyStarredRepos()` directly to preserve it.

- [ ] **Step 3: Add `fetchStarredRepos()` method**

Insert directly after `fetchChannels()` in the provider class:

```ts
  // ===================== STARRED REPOS (for Discovery Community) =====================
  async fetchStarredRepos(): Promise<void> {
    try {
      log(`[Explore/Starred] fetching...`);
      const result = await apiClient.getMyStarredRepos();
      log(`[Explore/Starred] got ${result.repos?.length ?? 0} starred (stale=${result.stale})`);
      this.view?.webview.postMessage({
        type: "setStarredReposData",
        repos: result.repos ?? [],
        stale: !!result.stale,
        error: false,
      });

      // If the cached payload was stale, kick off a background refresh so
      // the UI eventually catches up without blocking the initial render.
      if (result.stale) {
        void apiClient.getMyStarredRepos(true).then((fresh) => {
          this.view?.webview.postMessage({
            type: "setStarredReposData",
            repos: fresh.repos ?? [],
            stale: false,
            error: false,
          });
        }).catch((err) => {
          log(`[Explore/Starred] background refresh failed: ${err}`, "warn");
        });
      }
    } catch (err) {
      log(`[Explore/Starred] fetch failed: ${err}`, "warn");
      this.view?.webview.postMessage({
        type: "setStarredReposData",
        repos: [],
        stale: false,
        error: true,
      });
    }
  }
```

- [ ] **Step 4: Wire `fetchStarredRepos()` into init**

Find the call site(s) of `fetchChannels()` in the same file (typically inside `resolveWebviewView` or a post-auth init block). Add `void this.fetchStarredRepos();` adjacent to the `fetchChannels()` call. Both should fire in parallel — do NOT `await` them sequentially.

Sanity: if `fetchChannels()` is called from multiple places (e.g., init + refresh timer), add `fetchStarredRepos()` next to each call. Starred data and channels data must stay in sync; whenever one is refetched, the other should be too.

- [ ] **Step 5: Type-check**

```bash
cd gitchat_extension && npm run check-types
```

Expected: clean. If `StarredRepo` or `apiClient.getMyStarredRepos` is flagged, re-check imports — the type is re-exported from `src/types/index.ts` and the method is already on the api client.

- [ ] **Step 6: Lint**

```bash
npm run lint
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/webviews/explore.ts
git commit -m "feat(explore): fetch starred repos for Discovery Community"
```

---

## Task 2: Webview receives and stores starred repos

**Files:**
- Modify: [media/webview/explore.js](../../../media/webview/explore.js) — state declarations near lines 15-40, message router near line 1800.

- [ ] **Step 1: Add state variables**

Find the state block around line 15-40 in `explore.js` that declares `var chatFriends = [];`, `var chatChannels = [];`, etc. Immediately after `chatChannels`, add:

```js
var starredRepos = [];          // StarredRepo[] — source for Discovery Community
var starredReposError = false;  // true if the initial fetch failed
```

- [ ] **Step 2: Handle the message**

Find the `case "setChannelData":` block around line 1806-1811. Immediately after it, add a new case:

```js
    // Discovery Community: user's starred GitHub repos
    case "setStarredReposData":
      starredRepos = Array.isArray(data.repos) ? data.repos : [];
      starredReposError = !!data.error;
      if (chatMainTab === "discover") renderDiscover();
      break;
```

- [ ] **Step 3: Sanity-launch the extension**

```bash
npm run watch
```

In the Extension Development Host, open the Explore panel → Discovery tab. Open DevTools (`Developer: Open Webview Developer Tools` command). In the console, type `starredRepos` and press Enter. Expected: the array is populated with `{ owner, name, description, avatarUrl, … }` objects (assuming the signed-in account has starred repos).

If `starredRepos` is `[]` on an account that has stars, open the Output panel → "Gitchat" channel → look for `[Explore/Starred]` log lines. If there's an error, debug before continuing.

Stop `npm run watch` after verifying (Ctrl+C).

- [ ] **Step 4: Commit**

```bash
git add media/webview/explore.js
git commit -m "feat(explore): receive starred repos in Discovery webview"
```

---

## Task 3: Filter starred ∖ joined and render

**Files:**
- Modify: [media/webview/explore.js](../../../media/webview/explore.js) — `renderDiscover()` around lines 921-997.

- [ ] **Step 1: Add the joined-set helper**

Near the top of `explore.js` (next to other small pure helpers like `isMutualFriend`), add:

```js
// Build a Set of "owner/name" strings (lowercased) for communities the user
// has already joined. Used by the Discovery Community filter so starred repos
// that are already joined are hidden from the "discover" list.
function buildJoinedCommunityRepoSet(channels) {
  var set = new Set();
  if (!Array.isArray(channels)) return set;
  for (var i = 0; i < channels.length; i++) {
    var c = channels[i];
    if (!c) continue;
    var owner = c.repoOwner || "";
    var name = c.repoName || "";
    if (owner && name) {
      set.add((owner + "/" + name).toLowerCase());
    } else if (c.repo_full_name) {
      set.add(String(c.repo_full_name).toLowerCase());
    }
  }
  return set;
}

// Adapt a StarredRepo into the shape buildDiscoverCommunityRow expects.
// subscriberCount is intentionally undefined — the community may not even
// exist yet in repo_channels. The row builder falls back to description.
function starredRepoToDiscoverCommunity(r) {
  return {
    repoOwner: r.owner,
    repoName: r.name,
    displayName: r.owner + "/" + r.name,
    avatarUrl: r.avatarUrl,
    description: r.description || "",
    subscriberCount: undefined,
    _source: "starred",
  };
}
```

- [ ] **Step 2: Replace the `communities` source in `renderDiscover()`**

Find line 927: `var communities = chatChannels || [];`.

Replace with:

```js
  // Discovery Community = starred repos ∖ repos already joined as communities.
  // The "already joined" check uses chatChannels (same list the Chat tab renders).
  var joinedCommunityRepoSet = buildJoinedCommunityRepoSet(chatChannels);
  var communities = (starredRepos || [])
    .filter(function(r) {
      var key = ((r.owner || "") + "/" + (r.name || "")).toLowerCase();
      return key && !joinedCommunityRepoSet.has(key);
    })
    .map(starredRepoToDiscoverCommunity);
```

The downstream search filter (line 934, `communities = communities.filter(...)`) reads `displayName`, `repoOwner`, `repoName` on each entry — all of which the mapped shape provides — so no further changes to the search branch are needed.

- [ ] **Step 3: Update the empty-state branch**

Find the empty-state string around line 978: `'<div class="gs-empty gs-text-sm"><span class="codicon codicon-star"></span> Star repos on GitHub to discover communities</div>'`.

Replace that single fallback with a variable-driven selection. Immediately before the `buildAccordionSection("discover", "communities", ...)` call, insert:

```js
  var communityEmpty;
  if (starredReposError) {
    communityEmpty = '<div class="gs-empty gs-text-sm"><span class="codicon codicon-warning"></span> Couldn\'t load starred repos. <a href="#" class="gs-link" data-action="retry-starred">Retry</a></div>';
  } else if ((starredRepos || []).length === 0) {
    communityEmpty = '<div class="gs-empty gs-text-sm"><span class="codicon codicon-star"></span> Star repos on GitHub to discover communities</div>';
  } else {
    // Starred list is non-empty but every entry was filtered out — all joined.
    communityEmpty = '<div class="gs-empty gs-text-sm"><span class="codicon codicon-check"></span> You\'ve joined communities for all your starred repos</div>';
  }
```

Then update the `buildAccordionSection` call to use `communityEmpty` as the fallback:

```js
  html += buildAccordionSection("discover", "communities", "COMMUNITIES", communities.length, state.communities !== false, "default",
    communities.map(function(c) { return buildDiscoverCommunityRow(c); }).join("") || communityEmpty
  );
```

- [ ] **Step 4: Retry affordance for the error state**

Find the existing `bindDiscoverRowHandlers(container)` call at the end of `renderDiscover()` (around line 996). Directly after it, add a listener for the retry link:

```js
  var retryLink = container.querySelector('[data-action="retry-starred"]');
  if (retryLink) {
    retryLink.addEventListener("click", function(ev) {
      ev.preventDefault();
      starredReposError = false;
      starredRepos = [];
      renderDiscover();
      vscode.postMessage({ type: "refreshStarredRepos" });
    });
  }
```

Then add a host-side handler: in [src/webviews/chat-handlers.ts](../../../src/webviews/chat-handlers.ts), or wherever the explore provider's message router lives (search for `"refreshFriends"` or `"refreshChannels"` to find the existing pattern), add a case:

```ts
case "refreshStarredRepos": {
  const provider = /* the ExploreWebviewProvider instance for this ctx */;
  void provider.fetchStarredRepos();
  return true;
}
```

If the routing for refresh messages is structured differently, follow the existing channel-refresh pattern exactly — do not invent a new plumbing approach. If no refresh pattern exists at all and adding one would expand scope, skip the retry button and use a plain text "Reload the Explore panel to retry" instead.

- [ ] **Step 5: Update `buildDiscoverCommunityRow` subtitle for starred rows**

Find `buildDiscoverCommunityRow` at lines 1019-1032. Change the subtitle line:

```js
var subscriberCount = channel.subscriberCount || 0;
```

and

```js
'<div class="gs-text-xs gs-text-muted gs-truncate">' + subscriberCount + ' subscribers</div>' +
```

to:

```js
var isStarredSource = channel._source === "starred" || channel.subscriberCount == null;
var subtitle;
if (isStarredSource) {
  var desc = (channel.description || "").trim();
  subtitle = desc
    ? '<div class="gs-text-xs gs-text-muted gs-truncate">' + escapeHtml(desc) + '</div>'
    : '<div class="gs-text-xs gs-text-muted gs-truncate"><span class="codicon codicon-sparkle"></span> New community</div>';
} else {
  var subscriberCount = channel.subscriberCount || 0;
  subtitle = '<div class="gs-text-xs gs-text-muted gs-truncate">' + subscriberCount + ' subscribers</div>';
}
```

Then use `subtitle` in place of the hardcoded subscriber div in the returned HTML.

Verify `codicon-sparkle` exists — if not, substitute `codicon-rocket` or `codicon-star`. Check `media/webview/codicon.css` or the Codicon reference in DESIGN.md if unsure.

- [ ] **Step 6: Manual verification**

```bash
npm run watch
```

In the Extension Development Host, signed-in account with some starred repos:

1. Open Explore → Discovery. Community section shows starred repos. Subtitle is either the repo description or "New community".
2. Search for part of a repo name in the top search bar — only matching starred repo rows remain.
3. Clear search — all starred repos come back.
4. Use an account with zero starred repos (or temporarily stub the API in DevTools) — "Star repos on GitHub to discover communities" shows.
5. Join every starred repo's community via the Chat tab, then return to Discovery — "You've joined communities for all your starred repos" shows.

Stop `npm run watch`.

- [ ] **Step 7: Type-check + lint**

```bash
npm run check-types && npm run lint
```

Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add media/webview/explore.js src/webviews/chat-handlers.ts
git commit -m "feat(explore): filter Discovery Community to starred-minus-joined"
```

(Include `chat-handlers.ts` only if Step 4's host-side retry case was added.)

---

## Task 4: Remove repo from Discovery on successful join

**Files:**
- Modify: [media/webview/explore.js](../../../media/webview/explore.js) — webview message router, looking for existing `joinedConversation` handling.

- [ ] **Step 1: Find existing `joinedConversation` handling**

Grep `explore.js` for `joinedConversation`:

```bash
grep -n "joinedConversation" media/webview/explore.js
```

The message is already posted by [chat-handlers.ts:714](../../../src/webviews/chat-handlers.ts#L714) with shape `{ type: "joinedConversation", conversationId, convType, repoFullName }`. The webview may or may not already handle it. If it does, extend that case. If it doesn't, add a new case in the main router (same `switch` block as `setStarredReposData` from Task 2).

- [ ] **Step 2: Add/extend the handler**

Add (or extend) this case:

```js
    case "joinedConversation": {
      // When the user joins a community, drop its repo from the Discovery
      // Community list so it doesn't reappear. The chatChannels list will be
      // refreshed separately by the host (debouncedRefresh in chat-handlers),
      // but we update local state optimistically for instant feedback.
      if (data.convType === "community" && data.repoFullName) {
        var key = String(data.repoFullName).toLowerCase();
        // Push a synthetic joined-channel entry so buildJoinedCommunityRepoSet
        // will include it on the next render. Minimal shape — just enough for
        // the set builder to pick it up.
        var parts = String(data.repoFullName).split("/");
        if (parts.length === 2) {
          chatChannels = (chatChannels || []).concat([{
            repoOwner: parts[0],
            repoName: parts[1],
            _optimistic: true,
          }]);
        }
        if (chatMainTab === "discover") renderDiscover();
      }
      // Fall through to any existing downstream handling (chat tab navigation,
      // etc.) if this case previously existed — do NOT break that.
      break;
    }
```

If the case already existed and did other work (e.g., navigating to the chat detail view), merge this block into it — do not replace the existing body. The key behavior this task adds is: optimistic `chatChannels` update + re-render of Discovery.

- [ ] **Step 3: Manual verification**

```bash
npm run watch
```

1. Open Explore → Discovery. Star a fresh repo on GitHub (one with no existing community). Wait for the stale cache refresh or reload the panel so the new star appears.
2. Click **Join** on that repo's row.
3. Expected: within ~1 second, the row disappears from Discovery Community. The extension's Chat tab now shows the new community.
4. Open DevTools console: `chatChannels` should contain an entry with `_optimistic: true` (or a real entry if `debouncedRefresh` has already landed).
5. Failure case: stub `joinConversation` to throw (edit `chat-handlers.ts:712` temporarily to throw before the post). The repo must **stay** visible in Discovery. Revert the stub.

- [ ] **Step 4: Type-check + lint**

```bash
npm run check-types && npm run lint
```

- [ ] **Step 5: Commit**

```bash
git add media/webview/explore.js
git commit -m "feat(explore): remove joined community from Discovery list"
```

---

## Task 5: Contributor doc + final verification

**Files:**
- Modify: [docs/contributors/vincent.md](../../contributors/vincent.md)

- [ ] **Step 1: Read the current vincent.md**

Read [docs/contributors/vincent.md](../../contributors/vincent.md). Note the exact section headings used for Current and Decisions so the overwrite/append matches the existing format.

- [ ] **Step 2: Overwrite Current section**

Replace the Current section body with:

```
- **Branch:** vincent-discovery-starred-communities
- **Task:** Discovery → Community filter (starred ∖ joined) + remove-on-join
- **Blockers:** none
- **Last updated:** 2026-04-15
```

- [ ] **Step 3: Append a Decisions entry**

Append one line to the Decisions section:

```
- 2026-04-15: Discovery Community rewritten as client-side `starred ∖ joined` filter — no backend changes needed because `GET /github/data/starred` and `GET /channels` already exist. Avoided a backend PR to keep blast radius small.
```

- [ ] **Step 4: Stage doc with final verification commit**

```bash
npm run check-types && npm run lint && npm run compile
```

Expected: all pass. `npm run compile` is the full build — catches anything `check-types` + `lint` miss.

- [ ] **Step 5: Commit**

```bash
git add docs/contributors/vincent.md
git commit -m "docs(vincent): log Discovery Community starred-filter work"
```

- [ ] **Step 6: Final manual smoke test**

```bash
npm run watch
```

Walk through the full spec test plan (spec section "Testing / Verification", items 1-8). All must pass. Stop watch.

---

## Handoff to User

After all tasks pass, do NOT push or create a PR. Per [CLAUDE.md](../../../../CLAUDE.md) and the extension's sub-CLAUDE.md, wait for the user to test locally and explicitly approve push/PR.

Report to user:

- Branch name: `vincent-discovery-starred-communities`
- Commits: 4-5 commits (one per task + the docs commit)
- Verification status: `check-types`, `lint`, `compile` all clean; manual tests from spec all passed
- Next action expected from user: run the extension in the Extension Development Host and walk through the test plan; decide whether to bundle all commits or squash on push.

---

## Rollback

If any task fails mid-way and cannot be resolved without rework:

```bash
git reset --hard HEAD~N   # where N = number of commits in this branch
git checkout develop
git branch -D vincent-discovery-starred-communities
```

Only run after explicit user confirmation — this is a destructive operation.
