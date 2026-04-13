# Welcome Message Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a human-like welcome message flow with 2 phases: initial welcome DM with typing indicators, and warming-up engagement that nudges users to reply, culminating in an auto-reply when they do.

**Architecture:** Add `welcome_stage` column to `user_profiles` to track progress. Refactor `WelcomeOnboardingService` to send 2 initial messages (Step 1), then hook into WebSocket `subscribe:conversation` to detect when user opens chat and deliver remaining messages + fake typing (Step 2 / Phase 2). Detect first user reply via `sendMessage()` hook to trigger auto-response.

**Tech Stack:** NestJS, TypeORM, Socket.IO (Redis adapter), PostgreSQL

**Repos:**
- Backend: `/Users/leebot/gitchat/backend`

---

### Task 1: Add `welcome_stage` column to `user_profiles`

**Files:**
- Create: `/Users/leebot/gitchat/backend/src/database/postgres/migrations/1775400000000-AddWelcomeStage.ts`
- Modify: `/Users/leebot/gitchat/backend/src/database/postgres/entities/user-profile.entity.ts`

The `welcome_stage` tracks where in the welcome flow the user is:
- `null` — not a new user / no welcome needed
- `0` — welcome triggered, waiting for Step 1
- `1` — Step 1 done (2 initial messages sent), waiting for user to open chat
- `2` — Step 2 done (all welcome messages delivered), waiting for user's first reply
- `3` — Phase 2 complete (auto-reply sent, system hands off)

- [ ] **Step 1: Create migration**

```typescript
// /Users/leebot/gitchat/backend/src/database/postgres/migrations/1775400000000-AddWelcomeStage.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWelcomeStage1775400000000 implements MigrationInterface {
  name = 'AddWelcomeStage1775400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_profiles" ADD COLUMN "welcome_stage" smallint DEFAULT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_user_profiles_welcome_stage" ON "user_profiles" ("welcome_stage") WHERE "welcome_stage" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_user_profiles_welcome_stage"`);
    await queryRunner.query(`ALTER TABLE "user_profiles" DROP COLUMN "welcome_stage"`);
  }
}
```

- [ ] **Step 2: Add column to entity**

In `/Users/leebot/gitchat/backend/src/database/postgres/entities/user-profile.entity.ts`, add:

```typescript
@Column({ name: 'welcome_stage', type: 'smallint', nullable: true, default: null })
welcomeStage: number | null;
```

- [ ] **Step 3: Run migration**

```bash
PGPASSWORD=9LWqRApP9rrSs2cAjbMPxBGsbSDHudGG /opt/homebrew/Cellar/libpq/18.3/bin/psql \
  -h 10.11.40.11 -U postgres -d gitchat -c "
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS welcome_stage smallint DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_user_profiles_welcome_stage ON user_profiles (welcome_stage) WHERE welcome_stage IS NOT NULL;
"
```

- [ ] **Step 4: Commit**

```bash
cd /Users/leebot/gitchat/backend
git add src/database/postgres/migrations/1775400000000-AddWelcomeStage.ts \
        src/database/postgres/entities/user-profile.entity.ts
git commit -m "feat(welcome): add welcome_stage column to user_profiles"
```

---

### Task 2: Refactor `doWelcomeMessage()` — Step 1 (send 2 initial messages only)

**Files:**
- Modify: `/Users/leebot/gitchat/backend/src/modules/welcome-onboarding/services/welcome-onboarding.service.ts`

- [ ] **Step 1: Update `triggerWelcome()` to set `welcome_stage = 0`**

After the duplicate check (line ~68), before scheduling follows, add:

```typescript
// Mark user as welcome-in-progress
await this.dataSource.query(
  `UPDATE user_profiles SET welcome_stage = 0 WHERE login = $1`,
  [userLogin],
);
```

- [ ] **Step 2: Rewrite `doWelcomeMessage()` for Step 1 only**

Replace the current `doWelcomeMessage()` with:

```typescript
private async doWelcomeMessage(userLogin: string): Promise<void> {
  // 1. Get user profile
  const userRows = await this.dataSource.query(
    `SELECT login, name, bio, location, company, email, public_repos, last_client_id, last_ide, created_at
     FROM user_profiles WHERE login = $1 LIMIT 1`,
    [userLogin],
  );
  const user = userRows[0] || { login: userLogin, name: null, public_repos: null };
  const firstName = user.name?.split(' ')[0] || user.login;
  const repos = user.public_repos;

  // 2. Build Step 1 messages (only 2)
  const msg1 = `Hey ${firstName}!`;
  const msg2 = repos && repos > 10
    ? `I just followed you on Github, ${repos} repos is no joke. I'm Lee, I built Gitchat. If anything feels off or you want a feature, just reply here — I ship updates within 24h fr fr 🚀`
    : `I just followed you on Github. I'm Lee, I built Gitchat. If anything feels off or you want a feature, just reply here — I ship updates within 24h fr fr 🚀`;

  // 3. Create conversation + auto-accept
  let conversationId: string;
  try {
    const conversation = await this.messagesService.createConversation(LEE_LOGIN, userLogin);
    conversationId = conversation.id;

    await this.dataSource.query(
      `UPDATE message_conversations SET accepted_at = NOW() WHERE id = $1 AND accepted_at IS NULL`,
      [conversationId],
    );
  } catch (err: any) {
    this.logger.error(`[Welcome] Create conversation failed: ${err.message}`);
    return;
  }

  // 4. Send msg1 with typing
  const room = `${WS_ROOMS_PREFIXES.CONVERSATION}${conversationId}`;
  try {
    await this.emitTypingSequence(room, 3000, 10000); // 3-10s
    await this.messagesService.sendMessage(conversationId, LEE_LOGIN, msg1);

    await this.emitTypingSequence(room, 5000, 15000); // 5-15s
    await this.messagesService.sendMessage(conversationId, LEE_LOGIN, msg2);

    // 5. Mark Step 1 complete
    await this.dataSource.query(
      `UPDATE user_profiles SET welcome_stage = 1 WHERE login = $1`,
      [userLogin],
    );
    this.logger.log(`[Welcome] Step 1 complete for ${userLogin}`);
  } catch (err: any) {
    this.logger.error(`[Welcome] Send message failed: ${err.message}`);
    return;
  }

  // 6. Forward to Telegram
  const friends = await this.getGitchatFriends(userLogin, 5);
  const totalFriendsOnGitchat = await this.countGitchatFriends(userLogin);
  await this.forwardToTelegram(userLogin, user, friends, totalFriendsOnGitchat, `${msg1}\n\n${msg2}`);
}
```

- [ ] **Step 3: Add `emitTypingSequence()` helper**

```typescript
/**
 * Emit typing:start, wait random duration, emit typing:stop.
 */
private async emitTypingSequence(room: string, minMs: number, maxMs: number): Promise<void> {
  const duration = minMs + Math.floor(Math.random() * (maxMs - minMs));
  await this.webSocketEmitterService.emit([
    { event_name: 'typing:start', room, data: { login: LEE_LOGIN }, timestamp: Date.now() },
  ]);
  await new Promise((r) => setTimeout(r, duration));
  await this.webSocketEmitterService.emit([
    { event_name: 'typing:stop', room, data: { login: LEE_LOGIN }, timestamp: Date.now() },
  ]);
}
```

- [ ] **Step 4: Add `fakeTypingSequence()` helper for random typing bursts**

```typescript
/**
 * Simulate human-like typing: 3-5 random typing bursts with pauses.
 * Optionally sends messages at specified burst indices.
 */
private async fakeTypingSequence(
  room: string,
  messagesToSend?: { afterBurst: number; conversationId: string; text: string }[],
): Promise<void> {
  const burstCount = 3 + Math.floor(Math.random() * 3); // 3-5 bursts
  const msgMap = new Map((messagesToSend || []).map((m) => [m.afterBurst, m]));

  for (let i = 0; i < burstCount; i++) {
    // typing:start for 1-4s
    const typeDuration = 1000 + Math.floor(Math.random() * 3000);
    await this.webSocketEmitterService.emit([
      { event_name: 'typing:start', room, data: { login: LEE_LOGIN }, timestamp: Date.now() },
    ]);
    await new Promise((r) => setTimeout(r, typeDuration));
    await this.webSocketEmitterService.emit([
      { event_name: 'typing:stop', room, data: { login: LEE_LOGIN }, timestamp: Date.now() },
    ]);

    // Send message if scheduled after this burst
    const msg = msgMap.get(i);
    if (msg) {
      await this.messagesService.sendMessage(msg.conversationId, LEE_LOGIN, msg.text);
    }

    // Pause 2-10s before next burst (except after last)
    if (i < burstCount - 1) {
      const pause = 2000 + Math.floor(Math.random() * 8000);
      await new Promise((r) => setTimeout(r, pause));
    }
  }
}
```

- [ ] **Step 5: Remove old `buildMessages()` method**

Delete the `buildMessages()` method entirely — messages are now inline in `doWelcomeMessage()` and `handleConversationSubscribe()`.

- [ ] **Step 6: Verify compiles**

```bash
cd /Users/leebot/gitchat/backend && npx tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
cd /Users/leebot/gitchat/backend
git add src/modules/welcome-onboarding/services/welcome-onboarding.service.ts
git commit -m "refactor(welcome): step 1 sends only 2 messages, add typing helpers"
```

---

### Task 3: Implement Step 2 — deliver remaining messages when user opens chat

**Files:**
- Modify: `/Users/leebot/gitchat/backend/src/modules/welcome-onboarding/services/welcome-onboarding.service.ts`
- Modify: `/Users/leebot/gitchat/backend/src/websocket/services/websocket-relayer.service.ts`

Step 2 triggers when the user subscribes to the leeknowsai conversation. The WebSocket relayer detects the subscribe event and calls `WelcomeOnboardingService`.

- [ ] **Step 1: Add `handleConversationSubscribe()` method to WelcomeOnboardingService**

```typescript
/**
 * Called when a user subscribes to a conversation room.
 * If it's their conversation with leeknowsai and welcome_stage = 1,
 * deliver remaining welcome messages with typing.
 */
async handleConversationSubscribe(userLogin: string, conversationId: string): Promise<void> {
  if (userLogin.toLowerCase() === LEE_LOGIN) return;

  // Check welcome_stage
  const rows = await this.dataSource.query(
    `SELECT welcome_stage FROM user_profiles WHERE login = $1 LIMIT 1`,
    [userLogin],
  );
  const stage = rows[0]?.welcome_stage;
  if (stage === null || stage === undefined) return;

  // Verify this is the leeknowsai conversation
  const convRows = await this.dataSource.query(
    `SELECT id FROM message_conversations
     WHERE id = $1
       AND ((participant_1 = $2 AND participant_2 = $3) OR (participant_1 = $3 AND participant_2 = $2))
     LIMIT 1`,
    [conversationId, userLogin, LEE_LOGIN],
  );
  if (convRows.length === 0) return;

  if (stage === 1) {
    // Step 2: deliver remaining welcome messages
    await this.deliverStep2(userLogin, conversationId);
  } else if (stage === 2) {
    // Phase 2 warming: fake typing only (no messages)
    await this.warmingTyping(conversationId);
  }
}

private async deliverStep2(userLogin: string, conversationId: string): Promise<void> {
  this.logger.log(`[Welcome] Step 2 starting for ${userLogin}`);

  // Update stage immediately to prevent re-trigger
  await this.dataSource.query(
    `UPDATE user_profiles SET welcome_stage = 2 WHERE login = $1 AND welcome_stage = 1`,
    [userLogin],
  );

  const room = `${WS_ROOMS_PREFIXES.CONVERSATION}${conversationId}`;

  // Get friends for personalized message
  const friends = await this.getGitchatFriends(userLogin, 5);
  const totalFriends = await this.countGitchatFriends(userLogin);

  let msg3: string;
  if (totalFriends > 0 && friends.length > 0) {
    const mentions = friends.map((f) => `@${f.login}`);
    let friendsLine: string;
    if (totalFriends <= 5) {
      friendsLine = mentions.length === 1
        ? mentions[0]
        : mentions.slice(0, -1).join(', ') + ' and ' + mentions[mentions.length - 1];
    } else {
      friendsLine = mentions.join(', ') + ` and ${totalFriends - 5} others`;
    }
    msg3 = `${totalFriends} of your GitHub friends are already here: ${friendsLine}. This is basically a social network inside your IDE — check the Friends tab :)`;
  } else {
    msg3 = `This is basically a social network inside your IDE. You can follow devs, check trending repos, and chat — all without leaving your editor.`;
  }

  const msg4 = `Also we have a beta crew on Telegram, come hang: https://t.me/+U29wCL9hoKAzYTY0`;

  // Random burst index for messages: burst 1 or 2 for msg3, burst 3 or 4 for msg4
  const msg3Burst = Math.floor(Math.random() * 2); // 0 or 1
  const msg4Burst = 2 + Math.floor(Math.random() * 2); // 2 or 3

  await this.fakeTypingSequence(room, [
    { afterBurst: msg3Burst, conversationId, text: msg3 },
    { afterBurst: msg4Burst, conversationId, text: msg4 },
  ]);

  this.logger.log(`[Welcome] Step 2 complete for ${userLogin}`);
}

private async warmingTyping(conversationId: string): Promise<void> {
  // Phase 2: fake typing only, no messages — nudge user to reply
  const room = `${WS_ROOMS_PREFIXES.CONVERSATION}${conversationId}`;

  // Random delay before starting (2-5s) so it doesn't feel instant
  await new Promise((r) => setTimeout(r, 2000 + Math.floor(Math.random() * 3000)));

  await this.fakeTypingSequence(room);
}
```

- [ ] **Step 2: Hook into WebSocket relayer `subscribeToConversation` handler**

In `/Users/leebot/gitchat/backend/src/websocket/services/websocket-relayer.service.ts`, modify the `subscribeToConversation` handler:

First, inject `WelcomeOnboardingService`:

```typescript
// Add import at top
import { WelcomeOnboardingService } from '@modules/welcome-onboarding/services/welcome-onboarding.service';

// Add to constructor
constructor(
  // ... existing params
  private readonly welcomeOnboardingService: WelcomeOnboardingService,
) { ... }
```

Then modify the handler (around line 181-190):

```typescript
@SubscribeMessage(WS_SUBSCRIBE_MESSAGES.SUBSCRIBE_CONVERSATION)
async subscribeToConversation(
  @MessageBody() data: { conversationId: string },
  @ConnectedSocket() client: Socket,
): Promise<void> {
  if (!data.conversationId) return;
  const room = `${WS_ROOMS_PREFIXES.CONVERSATION}${data.conversationId}`;
  client.join(room);

  // Check if this triggers welcome flow
  const login = this.clientLoginMap.get(client.id);
  if (login) {
    this.welcomeOnboardingService
      .handleConversationSubscribe(login, data.conversationId)
      .catch((err) => this.logger.warn(`[Welcome] Subscribe hook failed: ${err.message}`));
  }
}
```

- [ ] **Step 3: Add WelcomeOnboardingModule import to WebSocket module**

Check which module the relayer belongs to and add `WelcomeOnboardingModule` to its imports. If the relayer is in the WebSocket module:

```typescript
// In the websocket module file
imports: [...existing, WelcomeOnboardingModule],
```

- [ ] **Step 4: Verify compiles**

```bash
cd /Users/leebot/gitchat/backend && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
cd /Users/leebot/gitchat/backend
git add src/modules/welcome-onboarding/services/welcome-onboarding.service.ts \
        src/websocket/services/websocket-relayer.service.ts
git commit -m "feat(welcome): step 2 delivers remaining messages on conversation subscribe"
```

---

### Task 4: Implement Phase 2 — auto-reply on first user message

**Files:**
- Modify: `/Users/leebot/gitchat/backend/src/modules/welcome-onboarding/services/welcome-onboarding.service.ts`
- Modify: `/Users/leebot/gitchat/backend/src/modules/messages/services/messages.service.ts`

- [ ] **Step 1: Add `handleUserFirstMessage()` to WelcomeOnboardingService**

```typescript
/**
 * Called when a message is sent in a conversation with leeknowsai.
 * If welcome_stage = 2 and the sender is the user (not Lee), trigger auto-reply.
 */
async handleUserFirstMessage(senderLogin: string, conversationId: string): Promise<void> {
  if (senderLogin.toLowerCase() === LEE_LOGIN) return;

  // Check welcome_stage = 2
  const rows = await this.dataSource.query(
    `SELECT welcome_stage, name FROM user_profiles WHERE login = $1 LIMIT 1`,
    [senderLogin],
  );
  const stage = rows[0]?.welcome_stage;
  if (stage !== 2) return;

  const firstName = rows[0]?.name?.split(' ')[0] || senderLogin;

  // Mark phase 2 complete immediately to prevent re-trigger
  await this.dataSource.query(
    `UPDATE user_profiles SET welcome_stage = 3 WHERE login = $1 AND welcome_stage = 2`,
    [senderLogin],
  );

  this.logger.log(`[Welcome] Phase 2: first message from ${senderLogin}, sending auto-reply`);

  const room = `${WS_ROOMS_PREFIXES.CONVERSATION}${conversationId}`;

  // Typing delay 3-8s
  await this.emitTypingSequence(room, 3000, 8000);

  const reply = `Hey ${firstName}, great to hear from you! I read every message here personally. What's on your mind? 🙌`;
  await this.messagesService.sendMessage(conversationId, LEE_LOGIN, reply);

  // Notify Telegram
  try {
    if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
      const params: Record<string, string> = {
        chat_id: TELEGRAM_CHAT_ID,
        text: `🔔 User replied to welcome!\n\nLogin: ${senderLogin}\nName: ${firstName}\n\nAuto-reply sent. Manual takeover needed.`,
        parse_mode: 'HTML',
      };
      if (TELEGRAM_THREAD_ID) params.message_thread_id = TELEGRAM_THREAD_ID;
      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
    }
  } catch { /* non-blocking */ }

  this.logger.log(`[Welcome] Phase 2 complete for ${senderLogin}, handing off to team`);
}
```

- [ ] **Step 2: Hook into `MessagesService.sendMessage()`**

In `/Users/leebot/gitchat/backend/src/modules/messages/services/messages.service.ts`, after the message is saved and events emitted (around line 800), add a hook:

First, inject `WelcomeOnboardingService` into `MessagesService`. To avoid circular dependency, use `forwardRef`:

```typescript
import { Inject, forwardRef } from '@nestjs/common';
import { WelcomeOnboardingService } from '@modules/welcome-onboarding/services/welcome-onboarding.service';

// In constructor:
constructor(
  // ... existing params
  @Inject(forwardRef(() => WelcomeOnboardingService))
  private readonly welcomeOnboardingService: WelcomeOnboardingService,
) {}
```

Then after events are emitted in `sendMessage()`, add (around line 800):

```typescript
// Check for welcome auto-reply (fire-and-forget)
this.welcomeOnboardingService
  .handleUserFirstMessage(login, conversationId)
  .catch((err) => this.logger.warn(`[Welcome] First message hook failed: ${err.message}`));
```

- [ ] **Step 3: Handle circular dependency in modules**

In `/Users/leebot/gitchat/backend/src/modules/welcome-onboarding/welcome-onboarding.module.ts`:

```typescript
import { Module, forwardRef } from '@nestjs/common';
import { FollowingModule } from '@modules/following/following.module';
import { MessagesModule } from '@modules/messages/messages.module';
import { WelcomeOnboardingService } from './services/welcome-onboarding.service';

@Module({
  imports: [FollowingModule, forwardRef(() => MessagesModule)],
  providers: [WelcomeOnboardingService],
  exports: [WelcomeOnboardingService],
})
export class WelcomeOnboardingModule {}
```

In `/Users/leebot/gitchat/backend/src/modules/messages/messages.module.ts`, add:

```typescript
import { forwardRef } from '@nestjs/common';
import { WelcomeOnboardingModule } from '@modules/welcome-onboarding/welcome-onboarding.module';

@Module({
  imports: [...existing, forwardRef(() => WelcomeOnboardingModule)],
  // ...
})
```

- [ ] **Step 4: Verify compiles**

```bash
cd /Users/leebot/gitchat/backend && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
cd /Users/leebot/gitchat/backend
git add src/modules/welcome-onboarding/ \
        src/modules/messages/services/messages.service.ts \
        src/modules/messages/messages.module.ts
git commit -m "feat(welcome): phase 2 auto-reply on user first message with telegram alert"
```

---

### Task 5: Run migration, push, and test

- [ ] **Step 1: Run migration on DB**

```bash
PGPASSWORD=9LWqRApP9rrSs2cAjbMPxBGsbSDHudGG /opt/homebrew/Cellar/libpq/18.3/bin/psql \
  -h 10.11.40.11 -U postgres -d gitchat -c "
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS welcome_stage smallint DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_user_profiles_welcome_stage ON user_profiles (welcome_stage) WHERE welcome_stage IS NOT NULL;
"
```

- [ ] **Step 2: Push to develop**

```bash
cd /Users/leebot/gitchat/backend && git push origin develop
```

- [ ] **Step 3: Reset test user hungdinh**

```bash
PGPASSWORD=9LWqRApP9rrSs2cAjbMPxBGsbSDHudGG /opt/homebrew/Cellar/libpq/18.3/bin/psql \
  -h 10.11.40.11 -U postgres -d gitchat -c "
DELETE FROM messages WHERE conversation_id IN (SELECT id FROM message_conversations WHERE participant_1 = 'hungdinh' OR participant_2 = 'hungdinh');
DELETE FROM message_conversations WHERE participant_1 = 'hungdinh' OR participant_2 = 'hungdinh';
DELETE FROM user_follows WHERE follower_login = 'hungdinh' OR following_login = 'hungdinh';
DELETE FROM notifications WHERE recipient_login = 'hungdinh' OR actor_login = 'hungdinh';
DELETE FROM user_profiles WHERE login = 'hungdinh';
"
```

- [ ] **Step 4: Test full flow**

1. hungdinh signs in → wait 3m → check inbox: 2 messages from leeknowsai
2. hungdinh opens chat with leeknowsai → sees typing indicator → 2 more messages appear
3. hungdinh opens chat again without replying → sees typing but no new messages
4. hungdinh sends first message → sees typing → auto-reply appears
5. Check Telegram for notification

- [ ] **Step 5: Verify welcome_stage progression**

```bash
PGPASSWORD=9LWqRApP9rrSs2cAjbMPxBGsbSDHudGG /opt/homebrew/Cellar/libpq/18.3/bin/psql \
  -h 10.11.40.11 -U postgres -d gitchat -c "
SELECT login, welcome_stage FROM user_profiles WHERE login = 'hungdinh';
"
```

Expected: `welcome_stage = 3` after full flow completes.

---

## State Machine Summary

```
null ──── (not a new user, no welcome)

  0  ──── triggerWelcome() called, follows scheduled
  │
  ↓ doWelcomeMessage() sends 2 messages
  │
  1  ──── Step 1 done, waiting for user to open chat
  │
  ↓ handleConversationSubscribe() → deliverStep2()
  │
  2  ──── All welcome messages delivered, waiting for first reply
  │       (each subscribe triggers warmingTyping() — fake typing only)
  ↓ handleUserFirstMessage() → auto-reply
  │
  3  ──── Phase 2 complete, system hands off to team/AI
```

## Known Limitations

1. **setTimeout-based delays** — if backend restarts mid-flow, scheduled typing/messages are lost. Acceptable for welcome flow since `welcome_stage` tracks progress and the flow can resume on next user interaction.
2. **Race condition on subscribe** — user might rapidly open/close chat. The `welcome_stage` column acts as a lock (UPDATE with WHERE clause) to prevent duplicate delivery.
3. **Phase 2 warming typing** — triggers every time user opens conversation while `welcome_stage = 2`. This is intentional to nudge reply, but could be rate-limited if needed.
