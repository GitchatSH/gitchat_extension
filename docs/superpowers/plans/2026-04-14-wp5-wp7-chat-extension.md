# WP5 + WP7: Chat System (4 Types) & Repo Activity — Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the VS Code extension chat system to recognize all 4 conversation types (dm, group, community, team) and render `repo_activity` system messages as styled cards.

**Architecture:** Type-aware extension of existing infrastructure — no new webview providers. Changes flow through 3 layers: TypeScript types → API method + handlers → webview JS/CSS rendering.

**Tech Stack:** TypeScript strict, VS Code extension API, vanilla JS webview, CSS with `--gs-*` design tokens.

**Design doc:** `docs/superpowers/specs/2026-04-14-wp5-wp7-chat-extension-design.md`
**UI mockup:** `docs/pencil/wp7-repo-activity-card.pen`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/types/index.ts` | Modify | Add `community`/`team` to Conversation.type, add `repo_full_name`, add `Message.type` + `RepoActivityMeta` |
| `src/api/index.ts` | Modify | Add `joinConversation()` with eligibility error extraction |
| `src/webviews/chat-handlers.ts` | Modify | Add `getEligibilityMessage()` helper + `joinCommunity`/`joinTeam` cases |
| `src/webviews/chat.ts` | Modify | Type-aware group detection, panel title, pass `conversationType`/`repoFullName` in init payload |
| `src/webviews/chat-panel.ts` | Modify | Fix `_dmConvMap` to exclude community/team |
| `media/webview/chat-panel.js` | Modify | `renderConversation()`: detect community/team, show type icon + repo subtitle |
| `media/webview/chat.js` | Modify | Add state vars, update init handler, type-aware `renderHeader()`, add `parseRepoActivity()` + `repo_activity` branch in `renderMessage()`, link click delegation |
| `media/webview/chat.css` | Modify | Add `.repo-activity-card` and related styles |

---

## Task 0: Confirm backend repo_activity body serialization

**Files:**
- Read: `gitstar-internal/backend/src/modules/messages/services/messages.service.ts`

This is a research-only task. No code changes.

- [x] **Step 1: Find sendSystemMessage in the backend service**

```bash
grep -n "sendSystemMessage\|repo_activity" \
  /Users/hieu/Documents/Companies/Lab3/GitstarAI/gitstar-internal/backend/src/modules/messages/services/messages.service.ts \
  | head -40
```

- [x] **Step 2: Read the method body**

Look for how `sendSystemMessage` serializes the `{ type, eventType, title, url, actor }` payload. Determine:
- Is metadata stored in the `body` field as a JSON string?
- Or does the backend return extra fields on the message object (e.g., `metadata`, `repo_activity`)?

- [x] **Step 3: Record the shape**

Add a comment at the top of Task 7 (or in `src/types/index.ts`) confirming the exact shape. If it is JSON in `body`, `parseRepoActivity()` (Task 7) is correct as written. If there are extra fields, update `RepoActivityMeta` in Task 1 and `parseRepoActivity()` in Task 7 accordingly.

---

## Task 1: Type system changes

**Files:**
- Modify: `src/types/index.ts:87-127`

- [x] **Step 1: Extend `Conversation` type**

In `src/types/index.ts`, find the `Conversation` interface (line 87) and make two changes:

Change `type?` from:
```typescript
type?: "direct" | "group";
```
To:
```typescript
type?: "direct" | "group" | "community" | "team";
```

Add `repo_full_name` after the existing `group_avatar_url` field:
```typescript
repo_full_name?: string;
```

- [x] **Step 2: Extend `Message` type + add `RepoActivityMeta`**

Find the `Message` interface (line 116). Add two optional fields after `attachment_url`:
```typescript
type?: "user" | "system" | "repo_activity";
repo_activity?: RepoActivityMeta;
```

After the `Message` interface, add the new interface:
```typescript
export interface RepoActivityMeta {
  eventType: "commit" | "pr_merged" | "release" | "issue_opened";
  title: string;
  url: string;
  actor: string;
}
```

- [x] **Step 3: Verify types compile**

```bash
cd /Users/hieu/Documents/Companies/Lab3/GitstarAI/gitchat_extension
npm run check-types
```

Expected: no errors.

- [x] **Step 4: Commit**

```bash
git add src/types/index.ts
git commit -m "feat(types): extend Conversation/Message types for community, team, repo_activity"
```

---

## Task 2: API — joinConversation()

**Files:**
- Modify: `src/api/index.ts` (after `createGroupConversation()` at line 212)

- [x] **Step 1: Add joinConversation method**

After the closing `}` of `createGroupConversation()` at line 212, insert:

```typescript
async joinConversation(
  type: "dm" | "group" | "community" | "team",
  params: {
    targetLogin?: string;
    repoFullName?: string;
    groupName?: string;
    members?: string[];
  }
): Promise<Conversation> {
  const body: Record<string, unknown> = { type };
  if (params.targetLogin) { body.recipient_login = params.targetLogin; }
  if (params.repoFullName) { body.repo_full_name = params.repoFullName; }
  if (params.groupName) { body.group_name = params.groupName; }
  if (params.members?.length) { body.recipient_logins = params.members; }
  try {
    const { data } = await this._http.post("/messages/conversations", body);
    this._conversationsCache.invalidate();
    return data?.data ?? data;
  } catch (err) {
    const errMsg = (err as { response?: { data?: { error?: { message?: string } } } })
      ?.response?.data?.error?.message;
    if (errMsg) { throw new Error(errMsg); }
    throw err;
  }
}
```

- [x] **Step 2: Verify types compile**

```bash
cd /Users/hieu/Documents/Companies/Lab3/GitstarAI/gitchat_extension
npm run check-types
```

Expected: no errors.

- [x] **Step 3: Commit**

```bash
git add src/api/index.ts
git commit -m "feat(api): add joinConversation() for community/team join flow"
```

---

## Task 3: chat-handlers.ts — eligibility helper + join handlers

**Files:**
- Modify: `src/webviews/chat-handlers.ts`

- [x] **Step 1: Add getEligibilityMessage helper**

Find the `post()` helper function at line 41 in `chat-handlers.ts`. Insert the following function immediately after it (before the `extractPinnedMessages` export):

```typescript
function getEligibilityMessage(err: unknown): string {
  const errMsg = (err as { response?: { data?: { error?: { message?: string } } }; message?: string })
    ?.response?.data?.error?.message
    ?? (err as Error)?.message;
  return errMsg || "You are not eligible to join this conversation.";
}
```

- [x] **Step 2: Add joinCommunity / joinTeam cases**

In `handleChatMessage()`, find the `default:` case at line 695. Insert the following two cases immediately before it:

```typescript
case "joinCommunity":
case "joinTeam": {
  const jp = msg.payload as { type: "community" | "team"; repoFullName: string };
  if (!jp?.repoFullName) { return true; }
  try {
    const { apiClient: joinApi } = await import("../api");
    const conv = await joinApi.joinConversation(jp.type, { repoFullName: jp.repoFullName });
    const { ChatPanel } = await import("./chat");
    await ChatPanel.show(ctx.extensionUri, conv.id);
  } catch (err) {
    vscode.window.showWarningMessage(getEligibilityMessage(err));
  }
  return true;
}
```

- [x] **Step 3: Verify types compile**

```bash
cd /Users/hieu/Documents/Companies/Lab3/GitstarAI/gitchat_extension
npm run check-types
```

Expected: no errors.

- [x] **Step 4: Commit**

```bash
git add src/webviews/chat-handlers.ts
git commit -m "feat(chat): add joinCommunity/joinTeam handlers with eligibility error surface"
```

---

## Task 4: chat.ts — type-aware loadData()

**Files:**
- Modify: `src/webviews/chat.ts:167-244`

- [x] **Step 1: Update group detection (line 167)**

Find line 167:
```typescript
let isGroup = conv?.type === "group" || conv?.is_group === true || ((conv?.participants as unknown[] | undefined)?.length ?? 0) > 2;
let groupTitle = isGroup ? ((conv?.group_name as string) || "Group Chat") : undefined;
```

Replace with:
```typescript
const convType = conv?.type as string | undefined;
const repoFullName = (conv as Record<string, unknown>)?.repo_full_name as string | undefined;
let isGroup = ["group", "community", "team"].includes(convType ?? "") || conv?.is_group === true || ((conv?.participants as unknown[] | undefined)?.length ?? 0) > 2;
let groupTitle = isGroup
  ? ((conv?.group_name as string) || (convType === "community" ? `${repoFullName} Community` : convType === "team" ? `${repoFullName} Team` : "Group Chat"))
  : undefined;
```

- [x] **Step 2: Update panel title (line 185)**

Find line 185:
```typescript
this._panel.title = isGroup ? `Chat: \u{1F465} ${groupTitle}` : `Chat: @${recipientLogin}`;
```

Replace with:
```typescript
if (convType === "community") {
  this._panel.title = `Community: ${repoFullName || groupTitle}`;
} else if (convType === "team") {
  this._panel.title = `Team: ${repoFullName || groupTitle}`;
} else if (isGroup) {
  this._panel.title = `Chat: ${groupTitle}`;
} else {
  this._panel.title = `Chat: @${recipientLogin}`;
}
```

- [x] **Step 3: Add conversationType + repoFullName to init payload**

Find the `this._panel.webview.postMessage({ type: "init", payload: {` block around line 217. Add two fields at the end of the `payload` object, before the closing `},`:

```typescript
conversationType: convType ?? (isGroup ? "group" : "direct"),
repoFullName: repoFullName,
```

- [x] **Step 4: Verify compile**

```bash
cd /Users/hieu/Documents/Companies/Lab3/GitstarAI/gitchat_extension
npm run check-types
```

Expected: no errors.

- [x] **Step 5: Commit**

```bash
git add src/webviews/chat.ts
git commit -m "feat(chat): type-aware loadData — detect community/team, pass conversationType to webview"
```

---

## Task 5: chat-panel.ts + chat-panel.js — community/team in sidebar

**Files:**
- Modify: `src/webviews/chat-panel.ts:154`
- Modify: `media/webview/chat-panel.js:269-284`

### Part A — Fix _dmConvMap (TypeScript)

- [x] **Step 1: Fix community/team exclusion in refresh()**

Find line 154 in `chat-panel.ts`:
```typescript
if (c.type !== "group" && !c.is_group && other) {
  this._dmConvMap.set(c.id, other.login);
}
```

Replace with:
```typescript
if (!["group", "community", "team"].includes(c.type ?? "") && !c.is_group && other) {
  this._dmConvMap.set(c.id, other.login);
}
```

### Part B — renderConversation in chat-panel.js

- [x] **Step 2: Extend isGroup detection in renderConversation (line 270)**

Find line 270 in `media/webview/chat-panel.js`:
```javascript
var isGroup = c.type === "group" || c.is_group === true || (c.participants && c.participants.length > 2);
```

Replace with (also add `convType` before this line):
```javascript
var convType = c.type || (c.is_group ? "group" : "direct");
var isGroup = ["group", "community", "team"].indexOf(convType) !== -1 || c.is_group === true || (c.participants && c.participants.length > 2);
```

- [x] **Step 3: Add community/team branch in the name/avatar/subtitle block (lines 273-284)**

Find the `if (isGroup) {` block that starts at line 273:
```javascript
if (isGroup) {
  name = c.group_name || "Group Chat";
  avatar = c.group_avatar_url || "";
  var memberCount = (c.participants && c.participants.length) || 0;
  subtitle = memberCount + " members";
} else {
```

Replace with:
```javascript
if (convType === "community" || convType === "team") {
  var repoLabel = convType === "community" ? " · Community" : " · Team";
  name = c.group_name || (c.repo_full_name ? c.repo_full_name + repoLabel : (convType === "community" ? "Community" : "Team"));
  avatar = c.group_avatar_url || "";
  subtitle = c.repo_full_name || "";
} else if (isGroup) {
  name = c.group_name || "Group Chat";
  avatar = c.group_avatar_url || "";
  var memberCount = (c.participants && c.participants.length) || 0;
  subtitle = memberCount + " members";
} else {
```

- [x] **Step 4: Add type icon for community/team (line 291)**

Find line 291:
```javascript
var typeIcon = "";
```

Replace with:
```javascript
var typeIcon = "";
if (convType === "community") {
  typeIcon = '<span class="codicon codicon-star" style="margin-right:3px;font-size:11px;opacity:0.8"></span>';
} else if (convType === "team") {
  typeIcon = '<span class="codicon codicon-git-pull-request" style="margin-right:3px;font-size:11px;opacity:0.8"></span>';
}
```

- [x] **Step 5: Verify compile**

```bash
cd /Users/hieu/Documents/Companies/Lab3/GitstarAI/gitchat_extension
npm run compile
```

Expected: no errors.

- [x] **Step 6: Commit**

```bash
git add src/webviews/chat-panel.ts media/webview/chat-panel.js
git commit -m "feat(sidebar): show community/team type icons and repo name in inbox"
```

---

## Task 6: chat.js — type-aware state + renderHeader

**Files:**
- Modify: `media/webview/chat.js`

- [x] **Step 1: Add state variables**

Find the state variable block near the top of the IIFE (around line 3). After `let isGroup = false;` (line 6), add:

```javascript
var conversationType = "direct"; // 'direct' | 'group' | 'community' | 'team'
var chatRepoFullName = "";
```

- [x] **Step 2: Read new fields in init handler**

Find the `case "init":` block in the message handler (around line 175). After the line `isGroup = msg.payload.isGroup || false;` (line 182), add:

```javascript
conversationType = msg.payload.conversationType || (isGroup ? "group" : "direct");
chatRepoFullName = msg.payload.repoFullName || "";
```

- [x] **Step 3: Pass new args to renderHeader**

Find line 206:
```javascript
renderHeader(msg.payload.participant, msg.payload.isGroup, msg.payload.participants);
```

Replace with:
```javascript
renderHeader(msg.payload.participant, msg.payload.isGroup, msg.payload.participants, conversationType, chatRepoFullName);
```

- [x] **Step 4: Update renderHeader signature and add community/team branch**

Find line 660:
```javascript
function renderHeader(participant, isGroup, participants) {
```

Replace with:
```javascript
function renderHeader(participant, isGroup, participants, convType, repoFullName) {
```

Then find the `if (isGroup) {` check inside `renderHeader` (line 662). Insert a new branch before it:

```javascript
if (convType === "community" || convType === "team") {
  var isCommunity = convType === "community";
  var ctIcon = isCommunity ? "codicon-star" : "codicon-git-pull-request";
  var ctLabel = isCommunity ? "Community" : "Team";
  var ctMembers = (participants && participants.length) || 0;
  var ctDisplayName = repoFullName || (participant && (participant.name || participant.login)) || ctLabel;
  header.innerHTML =
    '<div class="header-left">' +
      '<span class="header-group-avatar header-group-avatar-placeholder"><i class="codicon ' + ctIcon + '"></i></span>' +
      '<div class="header-info">' +
        '<span class="name">' + escapeHtml(ctDisplayName) + ' · ' + ctLabel + '</span>' +
        '<span class="header-subtitle header-member-count">' + ctMembers + ' members</span>' +
      '</div>' +
    '</div>' +
    '<div class="header-right">' +
      '<button class="header-icon-btn" id="searchBtn" title="Search"><span class="codicon codicon-search"></span></button>' +
      '<button class="header-icon-btn" id="menuBtn" title="Settings"><span class="codicon codicon-settings-gear"></span></button>' +
    '</div>';
  var menuBtnCt = document.getElementById("menuBtn");
  if (menuBtnCt) { menuBtnCt.addEventListener("click", function(e) { e.stopPropagation(); toggleHeaderMenu(); }); }
  var searchBtnCt = document.getElementById("searchBtn");
  if (searchBtnCt) { searchBtnCt.addEventListener("click", function() { if (SearchManager.state !== "idle") { SearchManager.close(); } else { SearchManager.open(); } }); }
  if (SearchManager.state !== "idle") { SearchManager.renderSearchBar(); }
  return;
}
```

- [x] **Step 5: Add repo_activity link click delegation**

Find the IIFE opening or a place near the top where document-level listeners are registered (after the EMOJI list, around line 132). Add:

```javascript
document.addEventListener("click", function(e) {
  var link = e.target.closest(".repo-activity-open-link");
  if (link && link.dataset.url) {
    e.preventDefault();
    vscode.postMessage({ type: "openExternal", payload: { url: link.dataset.url } });
  }
});
```

- [x] **Step 6: Commit**

```bash
git add media/webview/chat.js
git commit -m "feat(chat): type-aware header for community/team conversations"
```

---

## Task 7: chat.js + chat.css — repo_activity card

**Files:**
- Modify: `media/webview/chat.js:2052`
- Modify: `media/webview/chat.css`

### Part A — parseRepoActivity helper

- [x] **Step 1: Add parseRepoActivity function**

In `media/webview/chat.js`, find the `groupMessages` function (line 134). Insert the following function immediately before it:

```javascript
function parseRepoActivity(msg) {
  var body = msg.body || msg.content || "";
  try {
    var parsed = JSON.parse(body);
    if (parsed && parsed.eventType) { return parsed; }
  } catch (e) { /* body is not JSON — graceful degradation */ }
  return {
    eventType: "commit",
    title: body,
    url: "",
    actor: msg.sender_login || msg.sender || "",
  };
}
```

> **Note:** If Task 0 revealed that the backend stores metadata in a different field (e.g., `msg.metadata`), update this function to check that field first before falling back to JSON parsing.

### Part B — repo_activity branch in renderMessage

- [x] **Step 2: Add repo_activity rendering in renderMessage**

Find line 2063 in `media/webview/chat.js`:
```javascript
// System messages
if (msg.type === "system") {
  return '<div class="message system-msg" ...>';
}
```

Insert the following block immediately after the closing `}` of the system message check (before the unsent messages check at line 2067):

```javascript
// Repo activity cards (WP7)
if (msg.type === "repo_activity") {
  var ra = parseRepoActivity(msg);
  var raTime = new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  var raIconMap = { release: "codicon-tag", pr_merged: "codicon-git-merge", commit: "codicon-circle-filled", issue_opened: "codicon-issues" };
  var raColorMap = { release: "#c084fc", pr_merged: "#4ade80", commit: "#60a5fa", issue_opened: "#fb923c" };
  var raIcon = raIconMap[ra.eventType] || "codicon-bell";
  var raColor = raColorMap[ra.eventType] || "var(--gs-accent)";
  var raLink = ra.url
    ? '<div class="repo-activity-link"><a href="#" class="repo-activity-open-link" data-url="' + escapeHtml(ra.url) + '"><span class="codicon codicon-link-external"></span> View on GitHub</a></div>'
    : "";
  return '<div class="repo-activity-card" data-msg-id-block="' + escapeHtml(String(msg.id)) + '" style="border-left-color:' + raColor + '">' +
    '<div class="repo-activity-header">' +
      '<span class="codicon ' + raIcon + ' repo-activity-icon" style="color:' + raColor + '"></span>' +
      '<span class="repo-activity-title">' + escapeHtml(ra.title) + '</span>' +
      '<span class="repo-activity-time">' + raTime + '</span>' +
    '</div>' +
    (ra.actor ? '<div class="repo-activity-actor">@' + escapeHtml(ra.actor) + '</div>' : '') +
    raLink +
  '</div>';
}
```

### Part C — CSS styles

- [x] **Step 3: Add .repo-activity-card styles to chat.css**

Check `media/webview/shared.css` for the correct surface token name. Look for a token like `--gs-surface-2`, `--gs-card-bg`, or `--gs-background-2`. Use that token for the card background. If none exists, use `var(--vscode-editor-inactiveSelectionBackground)` as fallback.

Add the following at the end of `media/webview/chat.css`:

```css
/* ── Repo Activity Card (WP7) ────────────────────── */
.repo-activity-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  margin: 4px 0;
  background: var(--gs-surface-2, var(--vscode-editor-inactiveSelectionBackground));
  border-radius: 4px;
  border-left: 3px solid var(--gs-accent);
  /* border-left-color set inline per event type */
}

.repo-activity-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.repo-activity-icon {
  font-size: 13px;
  flex-shrink: 0;
}

.repo-activity-title {
  flex: 1;
  font-size: var(--gs-font-sm);
  font-weight: 600;
  color: var(--gs-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.repo-activity-time {
  font-size: var(--gs-font-xs);
  color: var(--gs-text-muted);
  flex-shrink: 0;
}

.repo-activity-actor {
  font-size: var(--gs-font-xs);
  color: var(--gs-text-muted);
  padding-left: 21px;
}

.repo-activity-link {
  padding-left: 21px;
}

.repo-activity-open-link {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: var(--gs-font-xs);
  color: var(--vscode-textLink-foreground);
  text-decoration: none;
}

.repo-activity-open-link .codicon {
  font-size: 10px;
}

.repo-activity-open-link:hover {
  text-decoration: underline;
}
```

- [x] **Step 4: Full compile check**

```bash
cd /Users/hieu/Documents/Companies/Lab3/GitstarAI/gitchat_extension
npm run compile
```

Expected: no errors.

- [x] **Step 5: Commit**

```bash
git add media/webview/chat.js media/webview/chat.css
git commit -m "feat(chat): repo_activity card renderer for Community/Team chats (WP7)"
```

---

## Task 8: Smoke test + PR

- [x] **Step 1: Launch extension in dev mode**

```bash
cd /Users/hieu/Documents/Companies/Lab3/GitstarAI/gitchat_extension
npm run watch
```

Press **F5** in VS Code to launch the Extension Development Host.

- [x] **Step 2: Verify DM / Group still work (regression)**

Open an existing DM conversation. Verify:
- Header shows avatar + `@login` + online indicator
- Messages render normally
- Panel title is `Chat: @login`

Open an existing group conversation. Verify:
- Header shows group avatar + name + member count
- Panel title is `Chat: {group name}`

- [x] **Step 3: Verify community/team header (if test data available)**

If the backend has a community or team conversation already created (or create one via API), open it and verify:
- Header shows `codicon-star` (community) or `codicon-git-pull-request` (team) + `{repo} · Community/Team`
- Panel title is `Community: {repo}` or `Team: {repo}`
- Sidebar inbox shows the star/git-pull-request icon

- [x] **Step 4: Verify repo_activity card**

If a `repo_activity` message exists in a community/team conversation, verify:
- Card renders with colored left border
- Icon and title are shown
- "View on GitHub" link opens in browser
- No hover-to-react behavior (right-click shows no emoji menu)

- [x] **Step 5: Create PR**

```bash
cd /Users/hieu/Documents/Companies/Lab3/GitstarAI/gitchat_extension
git push origin HEAD
gh pr create \
  --title "feat(WP5+WP7): community/team chat types + repo activity cards" \
  --body "$(cat <<'EOF'
## Summary
- Extends chat system to recognize community/team conversation types
- Type-aware header, sidebar icons, panel title for all 4 conversation types
- Adds joinCommunity/joinTeam handlers (WP4 Discover tab will call these)
- Renders repo_activity system messages as styled cards with event-type colors

## WP4 integration point
WP4's Discover tab needs to post these messages to open community/team chats:
- `{ type: 'joinCommunity', payload: { type: 'community', repoFullName: 'owner/repo' } }`
- `{ type: 'joinTeam', payload: { type: 'team', repoFullName: 'owner/repo' } }`

## Test plan
- [x] Existing DM and group chats render correctly (no regression)
- [x] community/team header shows correct icon + repo name
- [x] repo_activity card renders with correct color per event type
- [x] "View on GitHub" link opens in browser

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

**Spec coverage check:**

| Spec section | Task |
|---|---|
| Type system: Conversation.type, repo_full_name | Task 1 |
| Type system: Message.type, RepoActivityMeta | Task 1 |
| API: joinConversation() | Task 2 |
| Error handling: eligibility gate 403 | Task 3 |
| chat.ts: group detection, panel title | Task 4 |
| chat.ts: init payload conversationType/repoFullName | Task 4 |
| chat-handlers: joinCommunity/joinTeam handlers | Task 3 |
| Sidebar: 4-type icons | Task 5 |
| Sidebar: community/team repo subtitle | Task 5 |
| chat.js: type-aware header | Task 6 |
| WP7: repo_activity card renderer | Task 7 |
| WP7: event type → icon + color | Task 7 |
| WP7: "View on GitHub" link | Task 7 |
| WP7: CSS card styles | Task 7 |
| WP4 integration note | Task 8 PR description |
| Backend serialization shape | Task 0 |

All spec requirements have a corresponding task. No gaps found.
