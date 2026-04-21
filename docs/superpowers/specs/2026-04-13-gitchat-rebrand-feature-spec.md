# GitChat — Rebrand & Feature Restructure Spec

> **Date:** 2026-04-13
> **Author:** PO (Akemi0x)
> **Type:** Feature spec for task assignment
> **Status:** Draft

## 1. Vision

GitChat = a chat layer for GitHub. It solves 3 gaps GitHub lacks:
- Follower ↔ Follower cannot chat with each other
- Stargazers of the same repo have no community channel
- Contributors to the same repo have no discussion channel

## 2. Priority & Assignment

| Priority | Work Package | Assignees | Reason | Progress |
|----------|-------------|-----------|--------|----------|
| P0 | WP12: Cleanup | Vincent | Remove old code first to reduce team complexity | ✅ Done |
| P0 | WP1: Branding | Tiger, Sarah | Identity foundation, needed early | ✅ Done |
| P1 | WP2: Welcome | Cairo | First entry point for the user | — |
| P1 | WP4: Tab Layout | Hiru, Slug | Main UI frame — all other WPs build on top of this | — |
| P1 | WP5: Chat System | Ethan | Core value — 4 chat types | ✅ Done |
| P2 | WP11: GitHub Data | Vincent | Dependency for Friends, Discover, Community/Team | ✅ Done |
| P2 | WP6: Profile Card | Hiru, Slug | Required for all interactions with other users | — |
| P2 | WP7: Repo Activity | Ethan | Unique value for Community/Team | ✅ Done |
| P2 | WP3: Onboarding | Vincent | First-time UX | — |
| P3 | WP10: Notifications | Ryan | Refinement, does not block core flow | ✅ Done |
| P3 | WP8: Wave | Hiru, Slug | Nice-to-have social feature | — |
| P3 | WP9: Founder Agent | Sarah | Most complex, requires LLM + Telegram integration | — |

### Dependencies

```
WP12 (Cleanup) ──→ WP4 (Tab Layout) ──→ WP5 (Chat System)
                                     ──→ WP3 (Onboarding)
WP1 (Branding) ──→ WP2 (Welcome)
WP11 (GitHub Data) ──→ WP4.Friends
                   ──→ WP4.Discover
                   ──→ WP5C (Community)
                   ──→ WP5D (Team)
WP5 (Chat) ──→ WP7 (Repo Activity)
           ──→ WP8 (Wave)
           ──→ WP9 (Founder Agent)
WP6 (Profile Card) — independent, only requires basic UI framework
WP10 (Notifications) — refactor existing, anytime after WP5
```

---

## 3. Removed Features

Removed entirely from the extension:
- Trending Repos
- Trending People
- Activity Feed
- Search repos/people
- Repo Detail panel
- My Repositories
- Who to Follow
- Star/Unstar repo

---

## Work Package 1: Branding & Marketplace Metadata

**Assignees:** Tiger, Sarah

**Scope:** Update all identity fields on the VS Code Marketplace.

| Field | Current | New value |
|-------|---------|-----------|
| Name | Top GitHub Trending Repo & People | GitChat |
| Description | Discover trending GitHub repos... | (Rewrite — focus on chat/connect) |
| Publisher | GitchatAI | Update if needed |
| Extension ID | top-github-trending | New ID (note: existing users will lose the extension) |
| Icon/Logo | Old Gitchat logo | New design for GitChat |

**Deliverables:**
- [x] Update `package.json`: name, displayName, description, icon
- [x] Design new logo
- [x] Update marketplace README
- [x] Review all "Gitstar" → "GitChat" string references in the codebase

**WP1 DONE (2026-04-13) — Changes:**
- `package.json`: name→gitchat, displayName→GitChat, publisher→Gitchat, version→1.0.1, homepage→gitchat.sh, keywords→chat-focused
- `package.json` + `src/` (15 files): command IDs `trending.*`→`gitchat.*`, view IDs `trendingSidebar`→`gitchatSidebar`, context key `trending.isSignedIn`→`gitchat.isSignedIn`, config keys `trending.apiUrl`→`gitchat.apiUrl`, category labels→`"GitChat"`
- `README.md`: full restructure — chat-first, comparison table, live vs "What's Next", FAQ, ext install Gitchat.gitchat
- `LICENSE`: copyright GitstarAI→GitChat
- Invite link + badge URL → Gitchat.gitchat Marketplace listing
- **Not changed (dev team):** backend URLs `api-dev.gitstar.ai` (server not migrated), trending CSS/JS in media/ (WP12 cleanup)

---

## Work Package 2: Welcome Screen

**Scope:** Redesign the welcome screen for users who have not signed in.

**Layout (single screen, sidebar ~300px):**
1. GitChat logo
2. Tagline (1 line)
3. 3 value props with icons:
   - Chat with the people you follow on GitHub
   - Join the stargazer community for your favorite repos
   - Connect with contributors on the same repo
4. "Continue with GitHub" button

**Deliverables:**
- [ ] Redesign `src/webviews/welcome.ts`
- [ ] Update corresponding CSS in `media/webview/`
- [ ] Ensure responsive layout within sidebar width

---

## Work Package 3: Onboarding (First-time User)

**Scope:** After a first sign-in, the user sees the Discover tab with a guide overlay.

**Flow:**
1. User signs in successfully
2. Automatically open the Discover tab
3. Show a guide overlay: welcome message + explanation of each section (People / Communities / Teams)
4. User interacts (joins a group, DMs someone) → guide disappears
5. Next app open → lands on Chat tab (inbox), no guide shown

**State:** Store `hasCompletedOnboarding` flag in extension storage.

**Deliverables:**
- [ ] Implement onboarding state management
- [ ] Guide overlay UI on Discover tab
- [ ] Auto-redirect logic (first-time → Discover, returning → Chat)

---

## Work Package 4: Tab Layout — Chat | Friends | Discover

**Scope:** Restructure the main UI into 3 tabs instead of Chat | Feed | Trending.

### Tab 1: Chat (Inbox)
- List of all conversations: DM, Group, Community, Team
- Sort by last message time
- Unread badge per conversation
- Tap to open chat view

### Tab 2: Friends
- List of mutual follows (two people following each other = friends)
- 3 display states:
  - **Online** — currently active on GitChat (green indicator)
  - **Offline** — has a GitChat account but is not online
  - **Not on GitChat** — mutual follow on GitHub but not yet registered on GitChat → show Invite button
- Tap a friend → open Profile Card
- Quick DM button per friend

### Tab 3: Discover
4 sections:
1. **People** — people you follow on GitHub → tap to DM
2. **Communities** — repos you have starred → tap to join the stargazer community group
3. **Teams** — repos you contribute to → tap to join the contributor team group
4. **Online Now** — all accounts currently online on GitChat → tap to view profile, send a wave

**Deliverables:**
- [ ] Refactor `src/webviews/explore.ts` — replace the 3 old tabs with 3 new tabs
- [ ] Update tab navigation + state management
- [ ] Remove code related to the Feed tab and Trending tab
- [ ] Implement Friends tab UI
- [ ] Implement Discover tab UI (4 sections)

---

## Work Package 5: Chat System — 4 Chat Types

### 5A: DM (Direct Message)
- **Eligibility:** You follow the person → you can message them. They can reply freely (no need to follow back).
- **Features:** Text, typing indicator, online presence, read receipts

### 5B: Group Chat (User-created)
- **Group creation requirements:**
  1. Each member must mutually follow the group creator (members do not need to follow each other)
  2. All members must be active on GitChat (have signed in at least once)
- **Features:** Group name, member list, all DM chat features

### 5C: Community (Stargazer Group)
- **Eligibility:** Only repo stargazers can see and join
- **Auto-created:** Each repo has one community group
- **Special:** Receives in-chat repo activity notifications (see WP7)
- **Features:** All chat features + inline repo activity feed

### 5D: Team (Contributor Group)
- **Eligibility:** Only repo contributors can see and join
- **Auto-created:** Each repo has one team group
- **Special:** Receives in-chat repo activity notifications (see WP7)
- **Features:** All chat features + inline repo activity feed

**Deliverables:**
- [ ] Refactor chat system — distinguish 4 conversation types
- [ ] DM eligibility check (follow status)
- [ ] Group creation flow + validation (mutual follow + active check)
- [ ] Community/Team group auto-creation per repo
- [ ] Community join gate (stargazer check via GitHub API)
- [ ] Team join gate (contributor check via GitHub API)

---

## Work Package 6: Profile Card

**Scope:** A popup/panel shown when clicking any account.

**Content:**
1. **Basic info** — avatar, display name, GitHub username, bio
2. **GitHub stats** — public repos, followers, following
3. **Mutual groups** — Community/Team groups both users share
4. **Mutual friends** — shared friends (both mutually following)
5. **Top repos** — notable repos the person contributes to or owns
6. **Relationship status** — current follow status, follow/unfollow button
7. **Actions** — DM (if eligible), View on GitHub

**Deliverables:**
- [ ] Profile card component (webview)
- [ ] API calls: GitHub user info, mutual groups, mutual friends
- [ ] Follow/unfollow action
- [ ] DM action (conditional)

---

## Work Package 7: Repo Activity Notifications (In-Chat)

**Scope:** Community and Team groups receive inline repo activity notifications in the chat.

**Activity types (main/default branch only):**
1. **New release** — a new tag is published
2. **PR merged** — a pull request is merged into main
3. **Commit to main** — a direct push (not via PR)
4. **Issue opened** — a new issue is created

**Display:** A special message type in chat (distinct style from user messages) with a link to GitHub.

**Deliverables:**
- [ ] Repo activity message type (UI component)
- [ ] WebSocket/polling for repo events (GitHub API or webhook)
- [ ] Filter logic: main branch only, 4 event types only
- [ ] Render inline in Community/Team chat

---

## Work Package 8: Wave / Say Hi

**Scope:** A feature for Discover → Online Now. Reduces friction when connecting with strangers.

**Flow:**
1. User sees someone online in Discover
2. Taps "Wave" / "Say Hi" → sends a one-time ping to that person
3. Recipient sees notification "X waved at you"
4. If the recipient responds → a DM conversation opens between the two
5. No response → nothing happens; cannot wave a second time

**Deliverables:**
- [ ] Wave action button in Discover → Online Now
- [ ] Wave notification type
- [ ] Wave → DM conversion logic
- [ ] Rate limit: 1 wave per user pair

---

## Work Package 9: Founder Agent

**Scope:** An AI-powered founder account that helps onboard and retain users.

### Behavior
- **Auto DM:** Every new user automatically gets a DM conversation with the founder
- **Auto join groups:** Founder joins every Community/Team group when the first user joins, tagged as "GitChat Support"
- **Chat:** Engages in conversation, supports onboarding, introduces features

### AI + Human-in-the-loop
- **AI:** LLM handles chat (auto-reply)
- **Telegram bridge:** All founder agent messages are pushed to a Telegram group
  - Team members see every conversation
  - Team members send from Telegram → appears under the founder's name in GitChat (users cannot distinguish AI from human)
- **Operational purpose:** Monitor user count, which groups are active, what users need help with

### Exempt Rules
- Founder account does not need to star/contribute to a repo to join its Community/Team
- Shown with "GitChat Support" tag in the member list

**Deliverables:**
- [ ] Founder account setup + special role
- [ ] Auto-DM on new user registration
- [ ] Auto-join Community/Team groups (bypass rules, tagged)
- [ ] LLM integration for auto-reply
- [ ] Telegram bot bridge (2-way sync)
- [ ] "GitChat Support" tag UI in member list

---

## Work Package 10: Notifications

**Scope:** A streamlined notification system aligned with core features.

**Notification types:**
| Type | Trigger |
|------|---------|
| New message | DM / Group / Community / Team |
| Mention | @tag in any chat |
| New follower | Someone follows you on GitHub |
| Repo activity | Release, PR merged, commit to main, issue opened |
| Wave | Someone sends you a wave |

**Deliverables:**
- [ ] Refactor notification system — remove like and feed activity notifications
- [ ] Add wave notification type
- [ ] Ensure repo activity notifications are scoped correctly (only groups the user has joined)

---

## Work Package 11: GitHub Data & Caching

**Scope:** Fetch and cache data from the GitHub API.

**Data to fetch:**
- Mutual follows (followers ∩ following) → Friends list + "Not on GitChat"
- Starred repos → Discover Communities
- Contributed repos → Discover Teams
- User profile data → Profile Card

**Strategy:**
- Fetch once at sign-in
- Cache for 24h
- Refresh on-demand when the user pulls to refresh

**Note:** GitHub API rate limit is 5000 req/hr. Users with many followings require pagination.

**Deliverables:**
- [x] GitHub API service (fetch followers, following, starred, contributions)
- [x] Cache layer (24h TTL)
- [x] Pagination handling
- [x] Rate limit awareness

**Implementation notes (2026-04-14):**

Architecture: **backend proxy** — the extension sends the GitHub token via `Authorization: Bearer` header, and the backend calls GitHub on behalf of the user and caches the result server-side. This reduces round-trips for the UI consumer and avoids burning the user's rate limit on the same data multiple times.

**Backend (`gitstar-internal/backend`):**
- New module `@modules/github-data` with 5 endpoints under `/github/data/*`:
  - `GET /starred` — starred repos, capped at 500, paginated via `/user/starred?per_page=100`
  - `GET /contributed` — repos the user has commits in, capped at 100, via `/search/commits?q=author:{login}`
  - `GET /friends` — mutual follows, self-join on `user_follows`, partitioned into `mutual` vs `notOnGitchat`
  - `GET /profile/me` — rich profile from `/users/{login}`, upserted into `user_profiles`
  - `POST /refresh-all` — fire-and-forget refresh endpoint (reserved for future WebSocket push / scheduled refresh)
- 3-layer cache: Redis hot (5 minutes) → Postgres persistent (24h via entity tables) → GitHub API
- 5-minute floor per user/data-type to block `force=true` spam from burning the rate limit
- Reuses existing infrastructure: `GitHubService.ghFetch()` (rate-limit aware), `GitHubAuthGuard` + `AuthContext`, `CacheService` (Redis), `FollowingService.syncGitHubFollows()`, `TransformInterceptor` response wrapping
- New entity + migration: `user_contributed_repos_cache` (JSONB payload, unique index on `login`)
- Reuses existing entities: `user_starred_cache`, `user_follows`, `user_profiles`
- Errors: `GITHUB_RATE_LIMITED` (503), `GITHUB_FETCH_FAILED` (502), `GITHUB_MISSING_ACCESS_TOKEN` (401)

**Extension (`gitchat_extension`):**
- New module `src/github-data/` with a `GithubDataCache` singleton:
  - 2-layer: in-memory Map + `context.globalState` (persistent 24h, survives reloads)
  - Keyed by user login to prevent cross-account data leaks
  - API: `getStarred/getContributed/getFriends/getProfile` (with optional `{force}`)
  - `refreshAll()` — force re-fetch all 4 data types in parallel (does not double-call `POST /refresh-all` to avoid race conditions)
  - `clearForUser(login)` — purge on sign-out
  - `getFollowing()` — backward-compat shim for legacy fallback in `explore.ts` / `chat-panel.ts`
- 5 new apiClient methods in `src/api/index.ts`
- Wired into `extension.ts` (parallelModules) + `auth.ts`:
  - Sign-in: kicks off `githubDataCache.refreshAll()` non-blocking after `_syncToGitchat()`
  - Sign-out: `clearForUser(prevLogin)` to prevent data leaking to the next account
- Removes 3 direct GitHub calls (`fetchGitHubFollowing`) in `explore.ts` + `chat-panel.ts`, replaced by `githubDataCache.getFollowing()` → single source of truth

**Out of scope (moved to other WPs or ops):**
- UI consumers (Friends list, Discover, Profile Card) — WP4/5/6
- WebSocket push on data refresh — current polling is sufficient
- Unit tests for fetchers + service — can be added later, verified via manual smoke test
- Migration applied at staging/prod — ops

---

## Work Package 12: Cleanup — Remove Old Features

**Scope:** Remove all code related to the cut features.

**Remove:**
- Trending repos/people (webview, tree-view, API, CSS, JS)
- Activity Feed (webview, tree-view, API, CSS, JS)
- Search repos/people
- Repo Detail panel
- My Repositories
- Who to Follow
- Star/Unstar repo actions
- Feature flags: `SHOW_FEED_TAB`, `SHOW_TRENDING_TAB`

**Keep:** Chat, auth, realtime, notifications, statusbar, telemetry, config (update config options)

**Deliverables:**
- [ ] Remove dead webview providers + media assets
- [ ] Remove dead tree-view providers
- [ ] Remove dead commands + keybindings
- [ ] Remove dead API methods
- [ ] Clean up `package.json` contributes (commands, views, config)
- [ ] Verify extension still compiles + runs

