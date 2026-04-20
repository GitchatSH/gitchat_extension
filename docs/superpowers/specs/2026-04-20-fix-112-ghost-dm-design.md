# Fix #112 — Ghost DM conversation from profile view

**Status:** Draft
**Author:** ethanmiller0x
**Date:** 2026-04-20
**Related:** `gitchat_extension#112`, consolidates `gitchat_extension#52`
**Repos touched:** `gitchat_extension` (FE), `gitchat-webapp` (BE migration)

## Problem

Clicking the "Message" button on a profile creates an empty DM conversation on the
backend even when the user never sends a message. The ghost row appears in the Chat
list with an unread badge and timestamp "now", and cannot be dismissed naturally
because there is nothing to mark read.

Two distinct contributors to the bug:

1. **FE `determineState` has no org-type check.** Any followed login with
   `on_gitchat=true` renders a Message button, including GitHub Organizations
   (e.g. `@GitchatSH`). Users click orgs out of curiosity → ghost DMs.
2. **FE eagerly calls `createConversation` on Message button click.** The command
   `gitchat.messageUser` (`src/commands/index.ts:70`) invokes
   `apiClient.createConversation` immediately on click, before any message is
   composed. The backend persists a row with `initiatedBy=<user>` and
   `lastMessageAt=now`. If the user closes the panel without sending, the ghost
   remains.

## Verified root cause

Traced from `media/webview/profile-card.js:39` (`determineState`) →
`profile-card.js:237` (`profileCard:message` postMessage) →
`src/webviews/explore.ts:1671-1674` (`gitchat.messageUser` dispatch) →
`src/commands/index.ts:70` (`apiClient.createConversation`) →
`src/api/index.ts:265-268` (`POST /messages/conversations`) →
`backend/src/modules/messages/services/messages.service.ts:534-635`
(fetch-or-create, but inserts on first call with `lastMessageAt=new Date()`).

Same path exists from the full profile screen at
`media/webview/profile-screen.js:134` → `case "message"` → `gitchat.messageUser`.

## Goals

- No new ghost conversations created from clicking Message on a profile.
- Organization accounts do not render a Message button at all.
- Existing ghost rows in prod are removed via a reviewed DB migration.

## Non-goals

- Hardening the BE endpoint to reject "create without message" (defense-in-depth).
  Deferred to a future issue — FE lazy-create is sufficient to stop the source.
- Filtering bots, deleted GitHub users, or other non-org non-message profiles.
- Changing the Wave flow, which legitimately creates DMs on send
  (`src/webviews/explore.ts:1204`).

## Design

### Change 1 — FE: Org-type guard in `determineState`

**Files:**

- `gitchat_extension/src/types/index.ts` — extend `UserProfile` with
  `type?: "User" | "Organization"`.
- `gitchat_extension/media/webview/profile-card.js` — `determineState` returns a
  new state `"view-only"` when `data.type === "Organization"`.
- `gitchat_extension/media/webview/profile-screen.js` — same guard at the Message
  button render site (or the equivalent primary action dispatch).
- `gitchat_extension/src/webviews/profile-card-enrich.ts` — if the enrichment
  layer strips `type`, pass it through.
- `gitchat-webapp/backend/src/modules/users/...` — verify `getUserByUsername`
  response includes `type` from the GitHub API payload. If missing, add it.

**State machine delta for `determineState`:**

| Input                                                  | Return value      |
| ------------------------------------------------------ | ----------------- |
| `is_self` or `login === currentUser`                   | `"self"`          |
| `!on_gitchat`                                          | `"not-on-gitchat"`|
| `type === "Organization"` *(new)*                      | `"view-only"`     |
| `follow_status.following`                              | `"eligible"`      |
| else                                                   | `"stranger"`      |

**`renderPrimaryBtn` delta:** case `"view-only"` renders a single button "View on
GitHub" that opens `https://github.com/<login>` in the external browser. No
Message button, no Follow button (follow on GitHub happens outside the card).

### Change 2 — FE: Lazy `createConversation` ("B1 — synthetic draft ID")

The command `gitchat.messageUser` no longer mints a backend row on click. It
navigates the chat panel to a **draft state** keyed by `draft:<login>`, and
`createConversation` is deferred until the user actually sends the first message.

**Files:**

- `gitchat_extension/src/commands/index.ts` — `gitchat.messageUser` handler:
  remove the call to `apiClient.createConversation`. Replace with
  `await exploreWebviewProvider?.navigateToDraftChat(username)`.
- `gitchat_extension/src/webviews/explore.ts` — add
  `navigateToDraftChat(recipientLogin: string)`. Signature mirrors
  `navigateToChat` but uses `conversationId = "draft:" + login` and does NOT
  call `loadConversationData` (there is nothing to load).
- Webview send handler (resolve exact file during plan phase — candidates are
  `media/webview/explore.js` and `media/webview/sidebar-chat.js` depending on
  which owns the send button in the chat panel) — when the currently-active
  `conversationId` starts with `"draft:"`, first call
  `createConversation(login)`, swap the active conversation to the returned
  `conv.id`, then call `sendMessage(conv.id, body)`. After send succeeds, the
  chat list reloads and the new `conv.id` row appears for the first time
  (there was no draft row in the list to replace — draft lives only in the
  chat panel, not in the sidebar).
- Follow-gate retry: preserve the existing `isFollowGateError` / `syncGitHubFollows`
  retry loop around `createConversation`, moved into the send flow.
- Drafts persistence: the existing draft buffer (`cp.getAllDrafts()` in
  `explore.ts:356`) is already keyed by a conversation id string. `draft:<login>`
  keys slot into this cleanly. On successful mint, migrate the buffer from
  `draft:<login>` to `conv.id` in the same transaction as the chat list update.

**Draft panel UI:** the chat panel header shows the recipient's avatar + login.
The message list is empty (no "Loading…", no error). The input is enabled. No
read receipts or typing indicators are shown (there is no conversation yet). The
panel does not appear in the Chat list sidebar until the first send succeeds.

**Cancel path:** if the user closes the draft panel (navigates away without
sending), no BE call is made and no row persists. The draft input buffer is kept
in-memory under `draft:<login>` so that re-opening the same draft restores typed
text.

**Error handling on first send:**

- `createConversation` fails (follow gate, network, etc.): the chat panel
  remains in draft state. Error surfaces via the existing
  `window.showErrorMessage` path and the typed body stays in the input.
- `createConversation` succeeds, `sendMessage` fails: the conversation now
  exists (a new ghost if we do nothing). Mitigation: the existing
  `sendMessage` retry logic should handle transient failures. For permanent
  failures, we accept that a legitimate attempt produced a row — this matches
  current behavior and is not the class of bug we are fixing.

### Change 3 — BE: Migration to delete existing orphan DM conversations

**File:** `gitchat-webapp/backend/src/database/postgres/migrations/<timestamp>-delete-orphan-dm-conversations.ts`

**Selector:** a DM conversation is "orphan" iff it has zero messages. No
message-less DM has product meaning once lazy-create is live.

```sql
DELETE FROM message_conversations mc
WHERE mc.type = 'dm'
  AND mc.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM message_messages mm
    WHERE mm.conversation_id = mc.id
  );
```

**Pre/post logging:** the migration counts matching rows before and after and
emits `RAISE NOTICE` (or the TypeORM logger equivalent) so the deploy log shows
evidence:

```
[migration] delete-orphan-dm-conversations: matched N rows before delete
[migration] delete-orphan-dm-conversations: 0 rows remain after delete
```

**Idempotency:** safe to re-run — the `NOT EXISTS (messages)` predicate means no
eligible rows remain after a successful run.

**`down()`:** no-op that logs a warning. Deleted rows cannot be restored; a
manual backup restore is required if rollback is ever needed.

**Member-row cleanup:** `message_conversation_members` rows referencing deleted
conversations are cleaned via `ON DELETE CASCADE` (verify FK; if not cascaded,
the migration issues an explicit `DELETE FROM message_conversation_members`
first). Verified as part of writing the migration.

### Data flow

```
 User clicks "Message" (non-org, eligible)
     ↓
 gitchat.messageUser(login)
     ↓
 exploreWebviewProvider.navigateToDraftChat(login)       ← no API call
     ↓
 Chat panel renders draft UI (empty, input enabled)
     ↓
 User types and presses Send
     ↓
 sendFromDraft(login, body):
     conv = await apiClient.createConversation(login)    ← only now
     swap active id: "draft:<login>" → conv.id
     await apiClient.sendMessage(conv.id, body)
     refresh chat list                                   ← new row appears
```

## Testing

- **Unit tests (FE, Vitest):**
  - `determineState` with `data.type === "Organization"` returns `"view-only"`.
  - `determineState` with `data.type === "User"` and `following=true` returns
    `"eligible"` (regression).
  - `gitchat.messageUser` handler does not call `apiClient.createConversation`
    (mock assertion: call count = 0).
  - Send handler: when `conversationId` starts with `"draft:"`, calls
    `createConversation` exactly once before `sendMessage`.
- **Manual QA checklist:**
  - Click Message on a followed `User` → draft opens, no row in chat list. Close
    without sending → no row appears. Open same user again → draft restores
    typed text.
  - Click a followed `Organization` in profile card → no Message button.
  - Type and send from draft → conversation appears in chat list with correct
    last-message preview.
  - Follow-gate retry: break follow, click Message, type, send → expect
    follow-gate error + re-sync + retry; succeed or fail cleanly.
- **BE migration:**
  - Dry run on dev DB: capture `COUNT(*)` before, run migration, verify after.
  - Run `yarn migration:show` to confirm registered.
  - No unit test — migrations are not tested in this project (per convention).

## Rollout

1. Merge FE PR to `gitchat_extension develop`. Publish extension preview via the
   usual channel.
2. Merge BE PR to `gitchat-webapp develop` → migration runs on next prod deploy.
   Monitor deploy log for the `RAISE NOTICE` row count.
3. Post comment on #112 with migration row count and close the issue.

## Risks

- **Draft state leak:** if the chat panel state machine has an edge case where
  `"draft:*"` IDs get persisted (e.g. into `messageCache`, URL state, or
  notifications), we would see a stray draft row. Mitigation: grep for
  `conversationId` storage sites during implementation and ensure draft IDs are
  filtered from persistence.
- **Two-tab race:** same user opens two VS Code windows, drafts to the same
  login, sends from both. First send mints a row; second send creates a second
  `createConversation` call which is fetch-or-create (returns the same row) —
  safe, verified against BE logic at
  `messages.service.ts:601-603`.
- **Migration on large table:** the `NOT EXISTS` predicate with the current
  index set should be fine, but if `message_messages.conversation_id` is not
  indexed the scan is expensive. Pre-flight: verify index on
  `message_messages.conversation_id` before merging the migration.
