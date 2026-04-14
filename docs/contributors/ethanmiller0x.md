# ethanmiller0x

## Current
- **Branch:** develop
- **Working on:** WP5 + WP7 complete. No active task.
- **Blockers:** None
- **Last updated:** 2026-04-14

## WP5: Chat System — Summary for AI Agents

**Spec:** `docs/superpowers/specs/2026-04-13-gitchat-rebrand-feature-spec.md` §WP5

WP5 implements 4 distinct conversation types that share a unified chat UI but differ in join/creation rules:

| Type | Key rule | Auto-created? |
|------|----------|---------------|
| DM (5A) | Sender must follow recipient; recipient can reply freely | No — user initiates |
| Group (5B) | All members must mutual-follow the creator + have active GitChat accounts | No — user creates |
| Community (5C) | Restricted to repo stargazers; gate checked via GitHub API | Yes — one per repo |
| Team (5D) | Restricted to repo contributors; gate checked via GitHub API | Yes — one per repo |

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
| Event | Codicon |
|-------|---------|
| release | `codicon-tag` |
| pr_merged | `codicon-git-merge` |
| commit_main | `codicon-git-commit` |
| issue_opened | `codicon-issues` |

**Out of scope (not in WP7):**
- Notification bell / push notification for repo activity — that is WP10 (Ryan)
- Filtering which events a user wants — deferred, currently all 4 types show

---

## Decisions
- 2026-04-14: WP5 + WP7 complete on develop branch. DM eligibility uses one-way follow (sender follows recipient), matching spec §5A — no mutual follow required to send. Group validation calls a dedicated validate-members endpoint rather than doing client-side GitHub API calls, to avoid burning rate limit for potentially large member lists.
- 2026-04-14: Repo activity messages (WP7) are injected as system messages in the chat stream, not as a separate feed/panel — keeps the Community/Team chat as a single unified timeline and avoids a split-view layout.
- 2026-04-14: WP7 rendering is isolated in `renderRepoActivity()` helper in sidebar-chat.js so WP10 (Notifications) and WP4 (Tab Layout) can evolve without touching WP7 display logic.
