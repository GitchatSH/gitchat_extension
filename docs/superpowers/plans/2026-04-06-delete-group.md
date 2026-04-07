# Delete Group Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow group creators to soft-delete (disband) a group for all members, across backend, web, and VS Code extension.

**Architecture:** Add `disbanded_at`/`disbanded_by` columns to `message_conversations`. New `DELETE /conversations/:id/group` endpoint (creator-only). Web and extension get "Delete Group" button in group info panel with confirmation dialog. WebSocket `group:disbanded` event for realtime removal.

**Tech Stack:** NestJS, TypeORM, PostgreSQL, React (Tailwind), VS Code Webview API, Socket.IO

**Repos:**
- Backend: `/Users/leebot/gitstar/backend`
- Web: `/Users/leebot/gitstar/frontend`
- Extension: `/Users/leebot/top-github-trending-repo-and-people`

---

### Task 1: Migration + Entity — add `disbanded_at`, `disbanded_by` columns

**Files:**
- Create: `/Users/leebot/gitstar/backend/src/database/postgres/migrations/1775900000000-AddGroupDisbanded.ts`
- Modify: `/Users/leebot/gitstar/backend/src/database/postgres/entities/message-conversation.entity.ts`

- [ ] **Step 1: Create migration file**

```typescript
// /Users/leebot/gitstar/backend/src/database/postgres/migrations/1775900000000-AddGroupDisbanded.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGroupDisbanded1775900000000 implements MigrationInterface {
  name = 'AddGroupDisbanded1775900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "message_conversations" ADD COLUMN "disbanded_at" timestamptz DEFAULT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "message_conversations" ADD COLUMN "disbanded_by" varchar DEFAULT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "message_conversations" DROP COLUMN "disbanded_by"`);
    await queryRunner.query(`ALTER TABLE "message_conversations" DROP COLUMN "disbanded_at"`);
  }
}
```

- [ ] **Step 2: Add columns to entity**

In `/Users/leebot/gitstar/backend/src/database/postgres/entities/message-conversation.entity.ts`, add after the `status` field (line 44):

```typescript
  @Column({ name: 'disbanded_at', type: 'timestamptz', nullable: true })
  disbandedAt: Date | null;

  @Column({ name: 'disbanded_by', type: 'varchar', nullable: true })
  disbandedBy: string | null;
```

- [ ] **Step 3: Run migration on dev DB**

```bash
PGPASSWORD=9LWqRApP9rrSs2cAjbMPxBGsbSDHudGG /opt/homebrew/Cellar/libpq/18.3/bin/psql \
  -h 10.11.40.11 -U postgres -d gitstar -c "
ALTER TABLE message_conversations ADD COLUMN IF NOT EXISTS disbanded_at timestamptz DEFAULT NULL;
ALTER TABLE message_conversations ADD COLUMN IF NOT EXISTS disbanded_by varchar DEFAULT NULL;
"
```

- [ ] **Step 4: Verify compiles**

```bash
cd /Users/leebot/gitstar/backend && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
cd /Users/leebot/gitstar/backend
git add src/database/postgres/migrations/1775900000000-AddGroupDisbanded.ts \
        src/database/postgres/entities/message-conversation.entity.ts
git commit -m "feat(messages): add disbanded_at/disbanded_by columns to message_conversations"
```

---

### Task 2: Add `GROUP_DISBANDED` WebSocket event constant

**Files:**
- Modify: `/Users/leebot/gitstar/backend/src/websocket/constants/ws-namespaces.constant.ts`

- [ ] **Step 1: Add event constant**

In `/Users/leebot/gitstar/backend/src/websocket/constants/ws-namespaces.constant.ts`, add to `WS_EVENT_NAMES` object after `GROUP_UPDATED` (line 32):

```typescript
  GROUP_DISBANDED: 'group:disbanded',
```

- [ ] **Step 2: Commit**

```bash
cd /Users/leebot/gitstar/backend
git add src/websocket/constants/ws-namespaces.constant.ts
git commit -m "feat(ws): add GROUP_DISBANDED event constant"
```

---

### Task 3: Backend — `disbandGroup` service method + controller endpoint

**Files:**
- Modify: `/Users/leebot/gitstar/backend/src/modules/messages/services/messages.service.ts`
- Modify: `/Users/leebot/gitstar/backend/src/modules/messages/controllers/messages.controller.ts`

- [ ] **Step 1: Add `disbandGroup()` method to MessagesService**

Add after `removeMember()` method (after line 2189) in `/Users/leebot/gitstar/backend/src/modules/messages/services/messages.service.ts`:

```typescript
  async disbandGroup(conversationId: string, login: string): Promise<void> {
    const conv = await this.verifyGroupConversation(conversationId);

    // Must be active
    if (conv.status !== 'active') {
      throw MessagesErrors.notFound({ message: 'Conversation not found' });
    }

    await this.verifyActiveMember(conversationId, login);

    // Only creator can disband
    if (conv.createdBy !== login) {
      throw MessagesErrors.forbidden();
    }

    // Send system message before disbanding
    await this.sendSystemMessage(conversationId, login, `${login} deleted this group`);

    // Mark as disbanded
    await this.messageConversationRepository
      .createQueryBuilder()
      .update()
      .set({
        status: 'disbanded',
        disbandedAt: () => 'NOW()',
        disbandedBy: login,
      })
      .where('id = :id AND status = :status', { id: conversationId, status: 'active' })
      .execute();

    // Emit WS event to conversation room + all active members' user rooms
    const activeMembers = await this.getActiveMembers(conversationId);
    const events: any[] = [
      {
        event_name: WS_EVENT_NAMES.GROUP_DISBANDED,
        room: `${WS_ROOMS_PREFIXES.CONVERSATION}${conversationId}`,
        timestamp: Date.now(),
        data: { conversationId, disbandedBy: login },
      },
      ...activeMembers.flatMap(m => [
        {
          event_name: WS_EVENT_NAMES.GROUP_DISBANDED,
          room: `${WS_ROOMS_PREFIXES.USER}${m}`,
          timestamp: Date.now(),
          data: { conversationId, disbandedBy: login },
        },
        {
          event_name: WS_EVENT_NAMES.CONVERSATION_UPDATED,
          room: `${WS_ROOMS_PREFIXES.USER}${m}`,
          timestamp: Date.now(),
          data: { conversationId, disbanded: true },
        },
      ]),
    ];
    this.webSocketEmitterService.emit(events).catch((err) =>
      this.logger.warn(`Failed to emit group:disbanded WS event: ${(err as Error).message}`),
    );
  }
```

- [ ] **Step 2: Add controller endpoint**

Add after `updateGroup()` endpoint (after line 470) in `/Users/leebot/gitstar/backend/src/modules/messages/controllers/messages.controller.ts`:

```typescript
  // DELETE conversations/:id/group — Disband/delete group (creator only)
  @Delete('conversations/:id/group')
  @UseGuards(GitHubAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete/disband a group conversation (creator only)' })
  @ApiResponse({ status: 200, description: 'Group disbanded' })
  @ApiResponse({ status: 403, description: 'Not the group creator' })
  @ApiResponse({ status: 404, description: 'Group not found' })
  async disbandGroup(
    @Param('id') id: string,
    @GetAuthContext() auth: AuthContext,
  ) {
    await this.messagesService.disbandGroup(id, auth.login);
    return { success: true };
  }
```

- [ ] **Step 3: Verify compiles**

```bash
cd /Users/leebot/gitstar/backend && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
cd /Users/leebot/gitstar/backend
git add src/modules/messages/services/messages.service.ts \
        src/modules/messages/controllers/messages.controller.ts
git commit -m "feat(messages): add disbandGroup endpoint — creator-only soft delete for groups"
```

---

### Task 4: Backend — filter disbanded groups from `listConversations` and `getUnreadCount`

**Files:**
- Modify: `/Users/leebot/gitstar/backend/src/modules/messages/services/messages.service.ts`

- [ ] **Step 1: Add status filter to `listConversations`**

In `/Users/leebot/gitstar/backend/src/modules/messages/services/messages.service.ts`, in `listConversations()` method (around line 257), add a filter after the `.where(...)` clause (after line 257):

```typescript
      .andWhere('c.status = :activeStatus', { activeStatus: 'active' })
```

So lines 254-258 become:

```typescript
      .where(
        '(m.id IS NOT NULL OR (c.type = :dm AND c.participant1 != c.participant2 AND (c.participant1 = :login OR c.participant2 = :login)))',
        { login, dm: 'dm' },
      )
      .andWhere('c.status = :activeStatus', { activeStatus: 'active' })
      .orderBy('c.lastMessageAt', 'DESC')
```

- [ ] **Step 2: Add status filter to `getUnreadCount`**

In `getUnreadCount()` method (around line 1586), add `AND c.status = 'active'` to the SQL query. After line 1594 (the closing `)` of the WHERE membership check), add:

```sql
           AND c.status = 'active'
```

So lines 1594-1595 become:

```sql
         )
           AND c.status = 'active'
           AND c.last_message_at IS NOT NULL
```

- [ ] **Step 3: Verify compiles**

```bash
cd /Users/leebot/gitstar/backend && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
cd /Users/leebot/gitstar/backend
git add src/modules/messages/services/messages.service.ts
git commit -m "fix(messages): filter disbanded groups from conversation list and unread count"
```

---

### Task 5: Web — add `deleteGroup` to `use-messages.ts` hook

**Files:**
- Modify: `/Users/leebot/gitstar/frontend/src/hooks/use-messages.ts`

- [ ] **Step 1: Add `deleteGroup` function**

In `/Users/leebot/gitstar/frontend/src/hooks/use-messages.ts`, add after the `deleteConversation` function (after line 219):

```typescript
  const deleteGroup = useCallback(async (conversationId: string) => {
    const res = await fetch(`/api/messages/conversations/${conversationId}/group`, { method: 'DELETE' });
    if (!res.ok) {
      const { error } = await res.json();
      return error;
    }
    queryClient.invalidateQueries({ queryKey: ['conversations'] });
    return null;
  }, [queryClient]);
```

- [ ] **Step 2: Add to return value**

Add `deleteGroup` to the hook's return object (find the return statement and add it alongside `deleteConversation`).

- [ ] **Step 3: Add `group:disbanded` socket listener**

In the socket event handler `useEffect` (around line 92-131), add a listener for `group:disbanded`. Add after the `member:left` listener registration (around line 126):

```typescript
    socket.on('group:disbanded', onGroupChanged);
```

And in the cleanup return:

```typescript
    socket.off('group:disbanded', onGroupChanged);
```

- [ ] **Step 4: Commit**

```bash
cd /Users/leebot/gitstar/frontend
git add src/hooks/use-messages.ts
git commit -m "feat(messages): add deleteGroup hook and group:disbanded socket listener"
```

---

### Task 6: Web — add Delete Group button + confirmation dialog to `group-info-panel.tsx`

**Files:**
- Modify: `/Users/leebot/gitstar/frontend/src/components/messages/group-info-panel.tsx`

- [ ] **Step 1: Add import for DeleteBinLine icon**

At the top of `/Users/leebot/gitstar/frontend/src/components/messages/group-info-panel.tsx`, add `DeleteBinLine` to the mingcute import:

```typescript
import { AddLine, ExitDoorLine, EditLine, SearchLine, CloseLine, Group2Line, DeleteBinLine } from '@mingcute/react';
```

(Add `DeleteBinLine` to the existing import — check exact import line and append.)

- [ ] **Step 2: Add state variables**

Add after the `leaving` state (around line 73):

```typescript
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
```

- [ ] **Step 3: Add `onDeleteGroup` prop**

Add `onDeleteGroup: () => void` to the `GroupInfoPanelProps` interface.

- [ ] **Step 4: Add `handleDeleteConfirm` handler**

Add after `handleLeaveConfirm` (around line 234):

```typescript
  const handleDeleteConfirm = async () => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/messages/conversations/${conversationId}/group`, { method: 'DELETE' });
      if (res.ok) {
        setShowDeleteConfirm(false);
        onOpenChange(false);
        onDeleteGroup();
      }
    } catch {}
    finally { setDeleting(false); }
  };
```

- [ ] **Step 5: Add Delete Group button**

After the "Leave Group" button `</div>` (after line 458), add the Delete Group button — only visible to creator:

```tsx
          {/* Delete group — creator only */}
          {isCreator && (
            <div className="px-4 pb-4 flex-shrink-0">
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-full border border-pink text-pink type-label cursor-pointer bg-transparent hover:bg-pink-bg transition-colors"
              >
                <DeleteBinLine size={16} />
                Delete Group
              </button>
            </div>
          )}
```

- [ ] **Step 6: Add Delete confirmation dialog**

After the Leave confirm dialog portal (after line 493), add:

```tsx
      {/* Delete confirm dialog */}
      {showDeleteConfirm && createPortal(
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-bg/70"
          onClick={() => { if (!deleting) setShowDeleteConfirm(false); }}
        >
          <div
            className="rounded-2xl px-8 pt-8 pb-6 flex flex-col items-center mx-4 bg-surface border border-border max-w-sm w-full shadow-lg"
            onClick={e => e.stopPropagation()}
          >
            <h2 className="type-heading text-text">Delete group?</h2>
            <p className="type-body-sm mt-3 text-center text-text-secondary">
              This will permanently remove the group for all members. This action cannot be undone.
            </p>
            <button
              onClick={handleDeleteConfirm}
              disabled={deleting}
              className="mt-5 w-full py-2.5 rounded-full bg-pink text-bg type-label cursor-pointer border-none disabled:opacity-50 hover:opacity-90 transition-opacity"
            >
              {deleting ? 'Deleting...' : 'Delete Group'}
            </button>
            <button
              onClick={() => setShowDeleteConfirm(false)}
              disabled={deleting}
              className="mt-2 w-full py-2.5 rounded-full border border-border text-text type-label cursor-pointer bg-transparent disabled:opacity-50 hover:bg-hover-bg transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>,
        document.body
      )}
```

- [ ] **Step 7: Commit**

```bash
cd /Users/leebot/gitstar/frontend
git add src/components/messages/group-info-panel.tsx
git commit -m "feat(messages): add Delete Group button and confirmation dialog for group creators"
```

---

### Task 7: Web — wire up `onDeleteGroup` in `messages-client.tsx`

**Files:**
- Modify: `/Users/leebot/gitstar/frontend/src/app/(feed)/messages/messages-client.tsx`

- [ ] **Step 1: Add `handleDeleteGroup` handler**

Add after `handleLeaveGroup` (after line 197):

```typescript
  const handleDeleteGroup = useCallback(async () => {
    if (!activeConversation) return;
    refresh();
    setActiveConversationId(null);
    setGroupInfoOpen(false);
    deepLinkHandled.current = false;
    router.replace(buildUrl({ with: null }), { scroll: false });
  }, [activeConversation, refresh, router, buildUrl]);
```

- [ ] **Step 2: Pass `onDeleteGroup` prop to GroupInfoPanel**

Find where `<GroupInfoPanel` is rendered (around line 275) and add:

```typescript
              onDeleteGroup={handleDeleteGroup}
```

- [ ] **Step 3: Commit**

```bash
cd /Users/leebot/gitstar/frontend
git add src/app/\(feed\)/messages/messages-client.tsx
git commit -m "feat(messages): wire up onDeleteGroup handler in messages client"
```

---

### Task 8: Extension — add `deleteGroup` API method

**Files:**
- Modify: `/Users/leebot/top-github-trending-repo-and-people/src/api/index.ts`

- [ ] **Step 1: Add `deleteGroup` method**

In `/Users/leebot/top-github-trending-repo-and-people/src/api/index.ts`, add after `updateGroup()` method (after line 354):

```typescript
  async deleteGroup(conversationId: string): Promise<void> {
    await this._http.delete(`/messages/conversations/${conversationId}/group`);
  }
```

- [ ] **Step 2: Commit**

```bash
cd /Users/leebot/top-github-trending-repo-and-people
git add src/api/index.ts
git commit -m "feat(api): add deleteGroup method"
```

---

### Task 9: Extension — add `deleteGroup` handler in `chat.ts`

**Files:**
- Modify: `/Users/leebot/top-github-trending-repo-and-people/src/webviews/chat.ts`

- [ ] **Step 1: Add `deleteGroup` case**

In `/Users/leebot/top-github-trending-repo-and-people/src/webviews/chat.ts`, add after the `leaveGroup` case (after line 289):

```typescript
      case "deleteGroup": {
        const confirmDelete = await vscode.window.showWarningMessage(
          "Delete this group? All members will lose access. This cannot be undone.",
          { modal: true },
          "Delete"
        );
        if (confirmDelete === "Delete") {
          try {
            await apiClient.deleteGroup(this._conversationId);
            this._panel.dispose();
          } catch {
            vscode.window.showErrorMessage("Failed to delete group");
          }
        }
        break;
      }
```

- [ ] **Step 2: Commit**

```bash
cd /Users/leebot/top-github-trending-repo-and-people
git add src/webviews/chat.ts
git commit -m "feat(chat): add deleteGroup message handler with confirmation"
```

---

### Task 10: Extension — add `group:disbanded` realtime event

**Files:**
- Modify: `/Users/leebot/top-github-trending-repo-and-people/src/realtime/index.ts`

- [ ] **Step 1: Add event constant**

In `/Users/leebot/top-github-trending-repo-and-people/src/realtime/index.ts`, add to `WS_EVENTS` object (after line 19, after `GROUP_UPDATED`):

```typescript
  GROUP_DISBANDED: "group:disbanded",
```

- [ ] **Step 2: Add socket listener**

Add after the `GROUP_UPDATED` listener (after line 149):

```typescript
    this._socket.on(WS_EVENTS.GROUP_DISBANDED, () => {
      this._onConversationUpdated.fire();
    });
```

- [ ] **Step 3: Commit**

```bash
cd /Users/leebot/top-github-trending-repo-and-people
git add src/realtime/index.ts
git commit -m "feat(realtime): listen for group:disbanded event"
```

---

### Task 11: Extension — add Delete Group button in group info panel UI

**Files:**
- Modify: `/Users/leebot/top-github-trending-repo-and-people/media/webview/chat.js`
- Modify: `/Users/leebot/top-github-trending-repo-and-people/media/webview/chat.css`

- [ ] **Step 1: Add Delete Group button HTML**

In `/Users/leebot/top-github-trending-repo-and-people/media/webview/chat.js`, find the Leave Group button HTML (line 1250):

```javascript
        '<button class="gip-leave-btn" id="gip-leave-btn">\u21A9 Leave Group</button>' +
```

Add the Delete Group button right after it, conditionally for creators only. Replace line 1250 with:

```javascript
        '<button class="gip-leave-btn" id="gip-leave-btn">\u21A9 Leave Group</button>' +
        (isCreator ? '<button class="gip-delete-btn" id="gip-delete-btn">\uD83D\uDDD1 Delete Group</button>' : '') +
```

- [ ] **Step 2: Add Delete Group click handler**

After the Leave Group click handler (after line 1258), add:

```javascript
    if (isCreator) {
      document.getElementById("gip-delete-btn").addEventListener("click", function() {
        vscode.postMessage({ type: "deleteGroup" });
      });
    }
```

- [ ] **Step 3: Add CSS for `.gip-delete-btn`**

In `/Users/leebot/top-github-trending-repo-and-people/media/webview/chat.css`, add after the `.gip-leave-btn:hover` rule (after line 624):

```css
.gip-delete-btn {
  display: block;
  width: 100%;
  padding: 10px;
  margin-top: 8px;
  background: transparent;
  border: 1px solid var(--vscode-errorForeground);
  color: var(--vscode-errorForeground);
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
  text-align: center;
  box-sizing: border-box;
}
.gip-delete-btn:hover { background: var(--vscode-errorForeground); color: var(--vscode-editor-background); }
```

- [ ] **Step 4: Verify build**

```bash
cd /Users/leebot/top-github-trending-repo-and-people && npm run compile
```

- [ ] **Step 5: Commit**

```bash
cd /Users/leebot/top-github-trending-repo-and-people
git add media/webview/chat.js media/webview/chat.css
git commit -m "feat(chat): add Delete Group button in group info panel for creators"
```

---

### Task 12: Push all repos

- [ ] **Step 1: Push backend**

```bash
cd /Users/leebot/gitstar/backend && git push origin develop
```

- [ ] **Step 2: Push web frontend**

```bash
cd /Users/leebot/gitstar/frontend && git push origin develop
```

- [ ] **Step 3: Push extension**

```bash
cd /Users/leebot/top-github-trending-repo-and-people && git push origin main
```

---

### Task 13: Test full flow

- [ ] **Step 1: Test backend endpoint**

```bash
# Create a test group, then try to disband it
curl -X DELETE "https://api-dev.gitstar.ai/api/v1/messages/conversations/<GROUP_ID>/group" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json"
```

Expected: `{ "success": true }` if caller is creator, 403 if not.

- [ ] **Step 2: Test web UI**

1. Open a group conversation where you are creator
2. Open group info panel
3. Verify "Delete Group" button appears below "Leave Group"
4. Click it → confirm dialog appears
5. Confirm → group disappears from inbox

- [ ] **Step 3: Test extension UI**

1. Open a group conversation in VS Code extension
2. Open group info panel
3. Verify "Delete Group" button appears (only for creator)
4. Click it → VS Code warning dialog appears
5. Confirm → chat panel closes

- [ ] **Step 4: Test realtime**

1. Open group in web as member (not creator)
2. Creator deletes group from another session
3. Verify group disappears from member's inbox in realtime

- [ ] **Step 5: Test non-creator cannot delete**

1. Open group info as non-creator member
2. Verify "Delete Group" button does NOT appear
