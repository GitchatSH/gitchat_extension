# Delete Group Feature — Design Spec

**Date:** 2026-04-06
**Status:** Approved
**Approach:** Soft delete via `status = 'disbanded'` on conversation entity

---

## Overview

Allow group creators (admins) to permanently delete a group for all members. Uses soft delete — the conversation is marked as `disbanded` and hidden from all members' inboxes, but data remains in DB for audit/recovery.

---

## Backend API

### Endpoint

`DELETE /api/messages/conversations/:id/group`

### Authorization

- `@UseGuards(GitHubAuthGuard)` — requires auth token
- Caller must be an active member of the group
- Caller must be the group creator (`conv.createdBy === login`) — otherwise 403

### Flow

1. `verifyGroupConversation(id)` — confirm exists, type = 'group', and `status = 'active'` (return 404 if disbanded)
2. `verifyActiveMember(id, login)` — confirm caller is active member
3. Permission check: `conv.createdBy !== login` → throw 403 Forbidden
4. Send system message: `"{login} deleted this group"`
5. Update conversation: `SET status = 'disbanded', disbanded_at = NOW(), disbanded_by = {login}`
6. WebSocket emit `GROUP_DISBANDED` event to conversation room + all active members' user rooms
7. Return 200 OK

### Entity Changes

Add 2 columns to `MessageConversation`:

```sql
ALTER TABLE message_conversations
  ADD COLUMN disbanded_at timestamptz DEFAULT NULL,
  ADD COLUMN disbanded_by varchar DEFAULT NULL;
```

Add corresponding fields to `MessageConversationEntity`:

```typescript
@Column({ name: 'disbanded_at', type: 'timestamptz', nullable: true })
disbandedAt: Date | null;

@Column({ name: 'disbanded_by', type: 'varchar', nullable: true })
disbandedBy: string | null;
```

### Query Filter

All queries that list conversations must filter `WHERE status = 'active'` (or `status != 'disbanded'`). Audit existing queries in `messages.service.ts` to ensure this filter is applied.

### WebSocket Event

Event name: `GROUP_DISBANDED`
Payload: `{ conversationId: string, disbandedBy: string }`
Broadcast to: conversation room + each active member's user room

---

## Web Frontend

### File: `group-info-panel.tsx`

**Button placement:** Below "Leave Group" button, visible only when `isCreator`.

**Styling:** Danger zone — same pattern as "Leave Group" button:
- `border border-pink text-pink hover:bg-pink-bg transition-colors`
- Full width, `rounded-full`
- Icon: `DeleteBinLine` from `@mingcute/react`

**Confirmation dialog:** Reuse existing portal-based confirm dialog pattern from "Leave Group":
- Title: "Delete group?"
- Message: "This will permanently remove the group for all members. This action cannot be undone."
- Primary button: "Delete Group" (pink, disabled + "Deleting..." during request)
- Secondary button: "Cancel"
- Cannot dismiss during request

### File: `use-messages.ts`

Add `deleteGroup(conversationId)` function:
- `DELETE /api/messages/conversations/{id}/group`
- On success: remove conversation from local state

### File: `messages-client.tsx`

- Wire up `onDeleteGroup` callback from group-info-panel
- On success: close panel, clear active conversation, refresh list

### Realtime

Listen for `GROUP_DISBANDED` socket event:
- Remove conversation from list
- If currently viewing that conversation → navigate away / clear active

---

## VS Code Extension

### File: `media/webview/chat.js`

**Button placement:** Below "Leave Group" button in group info panel, visible only when `isCreator`.

**Styling:** New class `.gip-delete-btn`, same styling as `.gip-leave-btn` (red/error theme using `var(--vscode-errorForeground)`).

**Text:** "🗑 Delete Group"

**Action:** `vscode.postMessage({ type: "deleteGroup" })`

### File: `src/webviews/chat.ts`

Handle `"deleteGroup"` message:
1. Show `vscode.window.showWarningMessage` confirmation: "Delete this group? All members will lose access. This cannot be undone." with "Delete" button
2. Confirmed → `apiClient.deleteGroup(conversationId)`
3. Success → `this._panel.dispose()`
4. Error → show error message

### File: `src/api/index.ts`

Add method:
```typescript
async deleteGroup(conversationId: string): Promise<void> {
  await this._http.delete(`/messages/conversations/${conversationId}/group`);
}
```

### Realtime

Listen for `GROUP_DISBANDED` WebSocket event:
- If currently viewing that conversation → dispose panel
- Refresh inbox/conversation list

---

## State Machine

```
active ──── (normal group, all operations available)
  │
  ↓ Creator calls DELETE /conversations/:id/group
  │
disbanded ── (group hidden from all members, no operations allowed)
```

---

## Edge Cases

1. **Creator deletes while members are chatting** — WebSocket event removes group from their UI in realtime
2. **Creator is last member** — still allowed to delete (unlike leave which blocks last member)
3. **API calls on disbanded group** — all group operations should check `status = 'active'` and return 404 or 410 Gone
4. **Race condition** — two requests to delete simultaneously: first succeeds, second gets 404 (conversation already disbanded)

---

## Not In Scope

- Undo/restore disbanded group (admin tool, future)
- Transfer group ownership before deletion
- Scheduled/delayed deletion with grace period
