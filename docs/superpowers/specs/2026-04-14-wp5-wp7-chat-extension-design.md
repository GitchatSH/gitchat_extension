# WP5 + WP7: Chat System (4 Types) & Repo Activity — Extension Design

> **Date:** 2026-04-14
> **Author:** Ethan (Hieu)
> **Status:** Approved
> **Scope:** VS Code extension side only. Backend design: `gitstar-internal/backend/docs/superpowers/specs/2026-04-13-wp5-wp7-chat-system-repo-activity-design.md`

---

## 1. Scope

This document covers extension-side design for two work packages:

- **WP5** — Extend the chat system to recognize and render all 4 conversation types (`dm`, `group`, `community`, `team`), with eligibility error handling and a join flow API
- **WP7** — Render `repo_activity` system messages as styled cards in Community/Team chats

Out of scope:
- Backend implementation (already designed and implemented)
- WP4 Tab Layout (Hiru/Slug) — Discover tab entry points that will call WP5 join handlers
- WP11 GitHub Data & Caching (Vincent) — starred repos / contributed repos lists

---

## 2. Approach

**Type-aware chat system:** extend existing infrastructure (`ChatPanel`, `chat-handlers.ts`, `chat-panel.ts`) to recognize `community` and `team` as distinct conversation types. No new webview providers — community/team are fundamentally groups with repo context. Add a `joinConversation()` API method and surface eligibility errors from the backend.

---

## 3. Type System Changes

### `src/types/index.ts`

```typescript
// Conversation: extend type field + add repo context
interface Conversation {
  // ...existing fields...
  type?: 'direct' | 'group' | 'community' | 'team'  // was: 'direct' | 'group'
  repo_full_name?: string                             // new: only set for community/team
}

// Message: add type field + repo_activity metadata
interface Message {
  // ...existing fields...
  type?: 'user' | 'system' | 'repo_activity'         // new
  repo_activity?: RepoActivityMeta                    // new
}

// New interface
interface RepoActivityMeta {
  eventType: 'commit' | 'pr_merged' | 'release' | 'issue_opened'
  title: string
  url: string
  actor: string
}
```

> **Note:** Backend serializes `repo_activity` metadata into the message `body` as a JSON string when `type === 'repo_activity'`. Extension parses `message.body` to extract `RepoActivityMeta`. Exact serialization shape must be confirmed before implementing the card renderer — see implementation plan Task 0.

---

## 4. API Layer

### `src/api/index.ts` — New method

```typescript
async joinConversation(
  type: 'dm' | 'group' | 'community' | 'team',
  params: {
    targetLogin?: string        // for dm
    repoFullName?: string       // for community | team
    groupName?: string          // for group
    members?: string[]          // for group
  }
): Promise<Conversation>
```

Calls `POST /messages/conversations`. On 403, re-throws with the human-readable message from the backend error response (`err.response.data.error.message`).

Existing `createDm()` / `createGroup()` call sites are **not refactored** — only the new `joinConversation()` method is added.

---

## 5. Chat Panel — TypeScript Side

### `src/webviews/chat.ts` — `loadData()`

**Group detection** — extend to include `community` and `team`:

```typescript
const convType = conv?.type as string | undefined
const isGroup = ['group', 'community', 'team'].includes(convType ?? '')
const repoFullName = conv?.repo_full_name as string | undefined
```

**Panel title** — type-aware:

```typescript
if (convType === 'community') panel.title = `Community: ${repoFullName}`
else if (convType === 'team')  panel.title = `Team: ${repoFullName}`
else if (isGroup)              panel.title = `Chat: ${groupTitle}`
else                           panel.title = `Chat: @${recipientLogin}`
```

**`init` payload** — two new fields sent to webview:

```typescript
{
  // ...existing fields...
  conversationType: convType ?? (isGroup ? 'group' : 'direct'),
  repoFullName: repoFullName,
}
```

### `src/webviews/chat-handlers.ts` — New handlers

```typescript
case 'joinCommunity':
case 'joinTeam': {
  const { type, repoFullName } = msg.payload as { type: 'community' | 'team'; repoFullName: string }
  try {
    const conv = await apiClient.joinConversation(type, { repoFullName })
    await ChatPanel.show(ctx.extensionUri, conv.id)
  } catch (err) {
    vscode.window.showWarningMessage(getEligibilityMessage(err))
  }
  return true
}
```

**`getEligibilityMessage(err)`** — extracts `err.response.data.error.message` from the backend 403 response. Backend messages are already human-readable:
- "You must follow this user to send a DM"
- "You must star this repo to join its community"
- "You must have contributed to this repo to join its team"

Falls back to a generic message if extraction fails.

---

## 6. Sidebar Inbox

### `src/webviews/chat-panel.ts`

Conversation list items show different codicons per type:

| Type | Codicon | Notes |
|------|---------|-------|
| `direct` | `codicon-person` | unchanged |
| `group` | `codicon-organization` | unchanged |
| `community` | `codicon-star` | stargazers |
| `team` | `codicon-git-pull-request` | contributors |

Community/Team items show `repo_full_name` as subtitle instead of last message sender name.

---

## 7. Chat Webview — Type-aware Header

### `media/webview/chat.js`

On receiving `init` payload, render header based on `conversationType`:

| Type | Header content |
|------|---------------|
| `community` | `[codicon-star]` `{owner}/{repo} · Community` + member count |
| `team` | `[codicon-git-pull-request]` `{owner}/{repo} · Team` + member count |
| `group` | `[codicon-organization]` group name + member count |
| `dm` | avatar + `@recipientLogin` + online indicator |

Community/Team headers: no "Add people" button (join gate enforced by backend). "Leave" button retained (calls existing `leaveGroup` handler).

---

## 8. Repo Activity Card (WP7)

### Visual design

Mockup: `docs/pencil/wp7-repo-activity-card.pen`

Card renders in place of the normal message bubble when `message.type === 'repo_activity'`:

```
┌─────────────────────────────────────────────────┐ ← fill_container width
│ 3px  [icon]  Event title                 12:34  │
│ left  @actor description                        │
│ border  [↗] View on GitHub                      │
└─────────────────────────────────────────────────┘
```

### Event type → icon + color

| `eventType` | Codicon | Left border color |
|---|---|---|
| `release` | `codicon-tag` | `#c084fc` (purple) |
| `pr_merged` | `codicon-git-merge` | `#4ade80` (green) |
| `commit` | `codicon-circle-filled` | `#60a5fa` (blue) |
| `issue_opened` | `codicon-issues` | `#fb923c` (orange) |

### CSS (`.repo-activity-card`)

```css
.repo-activity-card {
  /* background slightly raised from chat area */
  background: var(--vscode-editor-inactiveSelectionBackground);
  border-radius: 4px;
  padding: 10px 12px;
  gap: 6px;
  /* left border applied via inline style: border-left: 3px solid <eventColor> */
}
```

> Uses `--vscode-*` variables directly here (not `--gs-*`) because this component targets the VS Code theme directly, not the GitChat design token layer.

### Interaction constraints

- No hover-to-react (system message — not reactable)
- No context menu (not editable, not deletable, not forwardable)
- "View on GitHub" link → `vscode.env.openExternal(Uri.parse(url))`

### Body parsing

```javascript
function parseRepoActivity(message) {
  try {
    return JSON.parse(message.body ?? message.content ?? '')
  } catch {
    // graceful degradation: show raw body as title
    return {
      eventType: 'commit',
      title: message.body ?? '',
      url: '',
      actor: message.sender_login ?? '',
    }
  }
}
```

---

## 9. WP4 Integration Points

> **Conflict note:** WP4 (Hiru/Slug) restructures `explore.ts` into Chat | Friends | Discover tabs. WP5 does not touch `explore.ts`. Merge conflict risk is minimal — the two WPs operate on different files. Post-merge, WP4's Discover tab Communities/Teams sections need to call these message types into `explore.ts`'s webview message handler:

```javascript
// Discover → Communities section: user clicks "Join"
vscode.postMessage({ type: 'joinCommunity', payload: { type: 'community', repoFullName: 'facebook/react' } })

// Discover → Teams section: user clicks "Join"
vscode.postMessage({ type: 'joinTeam', payload: { type: 'team', repoFullName: 'facebook/react' } })
```

These handlers are implemented in `chat-handlers.ts` (Section 5). WP4 only needs to call the correct message type — no dependency on merge order.

---

## 10. File Map

| File | Change |
|------|--------|
| `src/types/index.ts` | Extend `Conversation.type`, add `repo_full_name`, extend `Message`, add `RepoActivityMeta` |
| `src/api/index.ts` | Add `joinConversation()` + eligibility error handling |
| `src/webviews/chat.ts` | Type-aware `loadData()`, panel title, pass `conversationType` + `repoFullName` to webview |
| `src/webviews/chat-handlers.ts` | Add `joinCommunity`/`joinTeam` handlers, add `getEligibilityMessage()` helper |
| `src/webviews/chat-panel.ts` | 4-type icons + community/team subtitle in sidebar inbox |
| `media/webview/chat.js` | Type-aware header render, `repo_activity` card renderer, `parseRepoActivity()` |
| `media/webview/chat.css` | `.repo-activity-card` styles |
| `docs/pencil/wp7-repo-activity-card.pen` | UI mockup for `repo_activity` card |
