# Unified Presence System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the "stuck offline" presence bug and make `Discover → Online Now` update in real time, by unifying all presence state behind a single client-side store and adding a WebSocket snapshot/delta channel for Online Now.

**Architecture:** Client-side `PresenceStore` as the single source of truth (§7.1 of spec). Auto-watch every login seen on the wire. New WS events `discover:online-now:subscribe` / `:snapshot` / `:delta` with 2s batching on BE. Reuse existing `DiscoverService.getOnlineNow()` as snapshot source with a 15s cache wrapper.

**Tech Stack:**
- **Extension:** TypeScript (strict), socket.io-client, VS Code API, esbuild
- **Backend:** NestJS 11, TypeORM, Socket.IO gateway, Redis (existing presence ZSET), Jest
- **Repos:** `gitchat_extension` (FE) + `gitchat-webapp/backend` (BE)

**Spec:** [docs/superpowers/specs/2026-04-16-presence-unified-design.md](../specs/2026-04-16-presence-unified-design.md)

**Implementer:** vincent — single-person BE + FE sequential execution. Hiru fine-tunes after v1.

**Branches:**
- FE: `vincent-presence-unified` on `gitchat_extension` (target `develop`)
- BE: `vincent-presence-unified` on `gitchat-webapp` (target `develop`)

**Execution order:** Phase 1 (FE foundations) → Phase 2 (BE new events) → Phase 3 (BE DTO rename) → Phase 4 (FE Online Now subscribe) → Phase 5 (flag flip + cleanup). Phase 1 is independent of BE and fixes the "stuck offline" bug on its own; Phases 2–4 fix the Online Now bug.

---

## Phase 1 — FE foundations (independent of BE)

Fixes the "stuck offline" bug. Ships even if BE lags.

### Task 1.1: Create feature branch and contributor doc update

**Files:**
- Modify: `docs/contributors/vincent.md`

- [ ] **Step 1: Create branch**

```bash
cd gitchat_extension
git fetch origin
git checkout -b vincent-presence-unified origin/develop
```

- [ ] **Step 2: Update contributor doc**

Overwrite Current section in `docs/contributors/vincent.md`:

```markdown
## Current
- Branch: `vincent-presence-unified`
- Task: Unified Presence System (spec 2026-04-16). FE + BE both owned.
- Blockers: None
- Last updated: 2026-04-16
```

Append one line to Decisions section:

```markdown
- 2026-04-16: Presence system redesign — client `PresenceStore` as single source of truth, new WS events `discover:online-now:*` replacing polling. Reusing existing BE `DiscoverService.getOnlineNow()` + `inappNotiPrefs.hideFromOnlineNow`. No new DB migration.
```

- [ ] **Step 3: Commit**

```bash
git add docs/contributors/vincent.md
git commit -m "docs(vincent): start presence-unified task"
```

---

### Task 1.2: Create `PresenceStore` module with unit tests (TDD)

**Files:**
- Create: `src/realtime/presence-store.ts`
- Create: `src/test/realtime/presence-store.test.ts`

- [ ] **Step 1: Write failing test first**

Create `src/test/realtime/presence-store.test.ts`:

```typescript
import * as assert from "assert";
import { PresenceStore } from "../../realtime/presence-store";

suite("PresenceStore", () => {
  test("set + get returns entry", () => {
    const store = new PresenceStore();
    store.set("alice", { online: true, lastSeenAt: "2026-04-16T10:00:00Z" });
    assert.deepStrictEqual(store.get("alice"), { online: true, lastSeenAt: "2026-04-16T10:00:00Z" });
  });

  test("set fires onChange when value changes", () => {
    const store = new PresenceStore();
    let fired = 0;
    store.onChange(() => fired++);
    store.set("alice", { online: true, lastSeenAt: null });
    assert.strictEqual(fired, 1);
  });

  test("set is deduped when value unchanged", () => {
    const store = new PresenceStore();
    let fired = 0;
    store.set("alice", { online: true, lastSeenAt: null });
    store.onChange(() => fired++);
    store.set("alice", { online: true, lastSeenAt: null });
    assert.strictEqual(fired, 0);
  });

  test("bulkSet fires per changed entry", () => {
    const store = new PresenceStore();
    let fired = 0;
    store.onChange(() => fired++);
    store.bulkSet({
      alice: { online: true, lastSeenAt: null },
      bob: { online: false, lastSeenAt: null },
    });
    assert.strictEqual(fired, 2);
  });

  test("snapshot returns plain object copy", () => {
    const store = new PresenceStore();
    store.set("alice", { online: true, lastSeenAt: null });
    const snap = store.snapshot();
    assert.deepStrictEqual(snap, { alice: { online: true, lastSeenAt: null } });
    // Mutating snapshot must not affect store
    delete snap.alice;
    assert.ok(store.get("alice"));
  });

  test("LRU evicts oldest at 1000 cap and emits unwatchRequest", () => {
    const store = new PresenceStore({ maxEntries: 3 });
    const unwatched: string[] = [];
    store.onEvict((login) => unwatched.push(login));
    store.set("a", { online: true, lastSeenAt: null });
    store.set("b", { online: true, lastSeenAt: null });
    store.set("c", { online: true, lastSeenAt: null });
    store.set("d", { online: true, lastSeenAt: null }); // evicts "a"
    assert.deepStrictEqual(unwatched, ["a"]);
    assert.strictEqual(store.get("a"), undefined);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL (module does not exist yet)**

Run: `npm run check-types`. Expected: TypeScript error "Cannot find module './presence-store'" from the test file. Read the error output directly — no grep.

- [ ] **Step 3: Implement `PresenceStore`**

Create `src/realtime/presence-store.ts`:

```typescript
import * as vscode from "vscode";

export interface PresenceEntry {
  online: boolean;
  lastSeenAt: string | null;
}

export interface PresenceStoreOptions {
  maxEntries?: number;
}

/**
 * Single source of truth for presence state across the extension.
 * Writes from RealtimeClient (presence:*, discover:online-now:*, defensive
 * nudge), reads from every webview. LRU-capped at 1000 entries; evicted
 * entries trigger `onEvict` so the caller can send `unwatch:presence`.
 */
export class PresenceStore {
  private readonly _maxEntries: number;
  private readonly _map = new Map<string, PresenceEntry>(); // Map preserves insertion order → used as LRU
  private readonly _changeEmitter = new vscode.EventEmitter<{ login: string; entry: PresenceEntry }>();
  private readonly _evictEmitter = new vscode.EventEmitter<string>();

  readonly onChange = this._changeEmitter.event;
  readonly onEvict = this._evictEmitter.event;

  constructor(opts: PresenceStoreOptions = {}) {
    this._maxEntries = opts.maxEntries ?? 1000;
  }

  get(login: string): PresenceEntry | undefined {
    return this._map.get(login);
  }

  set(login: string, entry: PresenceEntry): void {
    const prev = this._map.get(login);
    if (prev && prev.online === entry.online && prev.lastSeenAt === entry.lastSeenAt) {
      // Refresh LRU position even on no-change write (keeps active users warm)
      this._map.delete(login);
      this._map.set(login, prev);
      return;
    }
    if (this._map.has(login)) {
      this._map.delete(login); // ensure insertion-order = recency
    } else if (this._map.size >= this._maxEntries) {
      const oldest = this._map.keys().next().value as string | undefined;
      if (oldest) {
        this._map.delete(oldest);
        this._evictEmitter.fire(oldest);
      }
    }
    this._map.set(login, entry);
    this._changeEmitter.fire({ login, entry });
  }

  bulkSet(entries: Record<string, PresenceEntry>): void {
    for (const [login, entry] of Object.entries(entries)) {
      this.set(login, entry);
    }
  }

  snapshot(): Record<string, PresenceEntry> {
    return Object.fromEntries(this._map);
  }

  dispose(): void {
    this._changeEmitter.dispose();
    this._evictEmitter.dispose();
  }
}

export const presenceStore = new PresenceStore();
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npm run check-types
npm run compile
npm test -- --grep "PresenceStore"
```

Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/realtime/presence-store.ts src/test/realtime/presence-store.test.ts
git commit -m "feat(realtime): add PresenceStore with LRU eviction and onChange events"
```

---

### Task 1.3: Harden defensive nudge in `realtime/index.ts`

**Files:**
- Modify: `src/realtime/index.ts:152-168` (the `message:sent` handler)
- Create: `src/test/realtime/defensive-nudge.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/test/realtime/defensive-nudge.test.ts`:

```typescript
import * as assert from "assert";
import { extractSenderLogin } from "../../realtime/nudge";

suite("defensive nudge — extractSenderLogin", () => {
  test("reads top-level sender", () => {
    assert.strictEqual(extractSenderLogin({ sender: "alice" }), "alice");
  });
  test("reads senderLogin", () => {
    assert.strictEqual(extractSenderLogin({ senderLogin: "alice" }), "alice");
  });
  test("reads author.login", () => {
    assert.strictEqual(extractSenderLogin({ author: { login: "alice" } }), "alice");
  });
  test("reads from.login", () => {
    assert.strictEqual(extractSenderLogin({ from: { login: "alice" } }), "alice");
  });
  test("returns undefined for unknown shape", () => {
    assert.strictEqual(extractSenderLogin({}), undefined);
    assert.strictEqual(extractSenderLogin({ sender: 42 }), undefined);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL (module does not exist)**

- [ ] **Step 3: Extract helper**

Create `src/realtime/nudge.ts`:

```typescript
/**
 * Extract a sender login from a message payload. Backend payload shape has
 * drifted historically (sender | senderLogin | author.login | from.login).
 * Returns undefined if nothing looks like a valid login string.
 */
export function extractSenderLogin(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const p = payload as Record<string, unknown>;
  const candidates: unknown[] = [
    p.sender,
    p.senderLogin,
    (p.author as Record<string, unknown> | undefined)?.login,
    (p.from as Record<string, unknown> | undefined)?.login,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.length > 0) return c;
  }
  return undefined;
}
```

- [ ] **Step 4: Wire helper into `message:sent` handler**

In `src/realtime/index.ts`, replace lines 152-168:

```typescript
// ─── Message events (emitted to conversation rooms) ───
this._socket.on(WS_EVENTS.MESSAGE_SENT, (payload: { data: Message } | Message) => {
  const msg = ((payload as { data?: Message }).data ?? payload) as Message;
  this._onNewMessage.fire(msg);
  // Defensive presence nudge: sender must have an active socket to send
  // a message, so they are definitively online right now. If the receiver
  // isn't watching the sender's presence room, `presence:updated` never
  // arrives — synthesize an online event from the message itself.
  const sender = extractSenderLogin(msg);
  if (sender && sender !== authManager.login) {
    presenceStore.set(sender, { online: true, lastSeenAt: new Date().toISOString() });
  }
});
```

Add import at top:

```typescript
import { presenceStore } from "./presence-store";
import { extractSenderLogin } from "./nudge";
```

- [ ] **Step 5: Run tests — expect PASS**

```bash
npm run check-types
npm test -- --grep "defensive nudge"
```

- [ ] **Step 6: Commit**

```bash
git add src/realtime/nudge.ts src/realtime/index.ts src/test/realtime/defensive-nudge.test.ts
git commit -m "fix(realtime): harden defensive nudge against payload shape drift"
```

---

### Task 1.4: Route presence events through `PresenceStore`, remove legacy emitter

**Files:**
- Modify: `src/realtime/index.ts` — locate by symbol `_onPresence` (the legacy emitter field), `handlePresence` (the handler fn), and `dispose()`. Do not trust line numbers; always re-read.
- Modify: `src/webviews/chat.ts` — locate by symbol `realtimeClient.onPresence`. Replace usages.

- [ ] **Step 1: Adapter handler in `realtime/index.ts`**

Replace the `handlePresence` block (around line 282-291) with:

```typescript
// ─── Presence events ───
// Single adapter: wire protocol carries `status: "online" | "offline"`, the
// store carries `online: boolean`. Every presence update flows through here.
const handlePresence = (payload: { data?: { login: string; status: string; lastSeenAt?: string | null } }) => {
  const d = (payload.data ?? payload) as { login: string; status: string; lastSeenAt?: string | null };
  presenceStore.set(d.login, {
    online: d.status === "online",
    lastSeenAt: d.lastSeenAt ?? null,
  });
};
this._socket.on(WS_EVENTS.PRESENCE_UPDATED, handlePresence);
this._socket.on(WS_EVENTS.PRESENCE_SNAPSHOT, handlePresence);
```

- [ ] **Step 2: Remove `_onPresence` emitter**

Delete lines 61-62 (the `_onPresence` EventEmitter + `onPresence` readonly) and line in `dispose()` that disposes it (line ~382).

- [ ] **Step 3: Migrate consumer in `webviews/chat.ts`**

Replace:

```typescript
const presenceSub = realtimeClient.onPresence((data) => { ... });
```

with:

```typescript
const presenceSub = presenceStore.onChange(({ login, entry }) => {
  if (!this._panel.webview) return;
  this._panel.webview.postMessage({
    type: "presence",
    payload: { user: login, online: entry.online, lastSeenAt: entry.lastSeenAt },
  });
});
```

Add import: `import { presenceStore } from "../realtime/presence-store";`

- [ ] **Step 4: Run type-check + test**

```bash
npm run check-types
npm run lint
npm test
```

Expected: no type errors, all existing tests pass (may need to update any other consumer of `realtimeClient.onPresence` if grep shows more).

- [ ] **Step 5: Grep for other consumers**

```bash
grep -rn "onPresence\|_onPresence" src/
```

Migrate any remaining callers to `presenceStore.onChange`. If none remain, good.

- [ ] **Step 6: Commit**

```bash
git add src/realtime/index.ts src/webviews/chat.ts
git commit -m "refactor(realtime): route presence events through PresenceStore, remove legacy emitter"
```

---

### Task 1.5: Auto-watch on any event with a login; wire LRU eviction to unwatch

**Files:**
- Create: `src/realtime/event-login-extractor.ts`
- Modify: `src/realtime/index.ts` (add `onAny` hook, wire `presenceStore.onEvict`)
- Create: `src/test/realtime/event-login-extractor.test.ts`

- [ ] **Step 1: Write failing test for extractor**

Create `src/test/realtime/event-login-extractor.test.ts`:

```typescript
import * as assert from "assert";
import { extractLoginsFromEvent } from "../../realtime/event-login-extractor";

suite("extractLoginsFromEvent", () => {
  test("message:sent → sender", () => {
    assert.deepStrictEqual(
      extractLoginsFromEvent("message:sent", { data: { sender: "alice" } }),
      ["alice"],
    );
  });
  test("conversation:read → login", () => {
    assert.deepStrictEqual(
      extractLoginsFromEvent("conversation:read", { data: { login: "bob" } }),
      ["bob"],
    );
  });
  test("reaction:updated → reaction authors", () => {
    assert.deepStrictEqual(
      extractLoginsFromEvent("reaction:updated", {
        data: { reactions: [{ user_login: "a" }, { user_login: "b" }] },
      }),
      ["a", "b"],
    );
  });
  test("member:added → login and addedBy", () => {
    assert.deepStrictEqual(
      extractLoginsFromEvent("member:added", { data: { login: "a", addedBy: "b" } }).sort(),
      ["a", "b"],
    );
  });
  test("unknown event → empty", () => {
    assert.deepStrictEqual(extractLoginsFromEvent("random:event", {}), []);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

- [ ] **Step 3: Implement extractor**

Create `src/realtime/event-login-extractor.ts`:

```typescript
import { extractSenderLogin } from "./nudge";

/**
 * Given a WS event name + payload, return all user logins referenced. Used
 * by RealtimeClient to auto-watch presence for any user we see on the wire.
 * Returns deduplicated list.
 */
export function extractLoginsFromEvent(eventName: string, payload: unknown): string[] {
  if (!payload || typeof payload !== "object") return [];
  const p = payload as Record<string, unknown>;
  const data = (p.data ?? p) as Record<string, unknown>;
  const out = new Set<string>();

  switch (eventName) {
    case "message:sent": {
      const sender = extractSenderLogin(data);
      if (sender) out.add(sender);
      break;
    }
    case "conversation:read":
    case "typing:start":
    case "member:added":
    case "member:left":
    case "mention:new":
    case "reaction:new": {
      if (typeof data.login === "string") out.add(data.login);
      if (typeof data.addedBy === "string") out.add(data.addedBy);
      break;
    }
    case "reaction:updated": {
      const reactions = data.reactions;
      if (Array.isArray(reactions)) {
        for (const r of reactions) {
          const ul = (r as Record<string, unknown>)?.user_login;
          if (typeof ul === "string") out.add(ul);
        }
      }
      break;
    }
    default:
      return [];
  }
  return Array.from(out);
}
```

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Wire `onAny` + eviction in `RealtimeClient`**

In `src/realtime/index.ts`, inside `connect()` after the existing `onAny` debug hook (around line 146-149), add:

```typescript
// Auto-watch presence for any login seen on the wire. Presence watch set
// grows organically instead of being pre-computed at boot time. Extractor
// returns [] for events with no user references, so this is cheap.
this._socket.onAny((eventName: string, payload: unknown) => {
  const logins = extractLoginsFromEvent(eventName, payload);
  if (logins.length) this.watchPresence(logins);
});
```

Wire eviction once in the constructor (subscription survives disconnect/reconnect; we check `_watchedPresenceLogins` which already exists as a private `Set<string>` in `RealtimeClient` — confirm by grep first):

```typescript
constructor() {
  presenceStore.onEvict((login) => {
    if (this._watchedPresenceLogins.has(login)) {
      // Safe: unwatchPresence internally no-ops when _socket is null or disconnected
      this.unwatchPresence([login]);
    }
  });
}
```

**Guard `unwatchPresence` too** — verify it gracefully handles the no-socket case (read the existing method; if it currently does `this._socket?.emit(...)` that's already null-safe). If it does any non-socket state mutation that breaks without a connection, wrap the emit in `if (this._socket?.connected)`.

Add imports:

```typescript
import { extractLoginsFromEvent } from "./event-login-extractor";
```

- [ ] **Step 6: Run full test suite + compile**

```bash
npm run compile
```

Expected: clean build.

- [ ] **Step 7: Commit**

```bash
git add src/realtime/event-login-extractor.ts src/test/realtime/event-login-extractor.test.ts src/realtime/index.ts
git commit -m "feat(realtime): auto-watch presence for any login seen on the wire"
```

---

### Task 1.6: Remove 50-DM-partner cap, migrate `chat-panel.ts` to `PresenceStore`

**Files:**
- Modify: `src/webviews/chat-panel.ts:97-142` (remove slice(0,50), use presenceStore)

- [ ] **Step 1: Remove caps**

In `src/webviews/chat-panel.ts`, change:

```typescript
// OLD
const watched = logins.slice(0, 50);
// ...
const extra = Array.from(new Set(dmPartnerLogins)).slice(0, 50);
```

to:

```typescript
// NEW — PresenceStore LRU cap (1000) is the true limit; per-view caps
// created drift between chat list and Discover.
const watched = logins;
// ...
const extra = Array.from(new Set(dmPartnerLogins));
```

- [ ] **Step 2: Write initial HTML from PresenceStore**

Keep the REST `getPresence` bootstrap (spec §7.3 decision). But after fetching, **also** `bulkSet` into `presenceStore`:

```typescript
presenceData = await apiClient.getPresence(watched);
// Seed the store so subsequent presence:updated events dedupe and
// consumers like Discover share the same state.
const storeEntries: Record<string, PresenceEntry> = {};
for (const [login, v] of Object.entries(presenceData)) {
  storeEntries[login] = {
    online: (v as { status?: string }).status === "online",
    lastSeenAt: (v as { lastSeenAt?: string | null }).lastSeenAt ?? null,
  };
}
presenceStore.bulkSet(storeEntries);
```

Apply the same pattern after the DM-partner `getPresence` call.

Add imports:

```typescript
import { presenceStore, type PresenceEntry } from "../realtime/presence-store";
```

- [ ] **Step 3: Type-check + lint**

```bash
npm run check-types
npm run lint
```

- [ ] **Step 4: Manual smoke test**

1. `npm run watch` in one terminal
2. Reload extension, open chat view
3. Verify friends list renders, online dots match expectation
4. Send a message from another account → dot on their row must flip green within 1s
5. Check dev console: no errors from `PresenceStore` or `realtime`

- [ ] **Step 5: Commit**

```bash
git add src/webviews/chat-panel.ts
git commit -m "fix(chat): remove 50-partner presence cap, seed PresenceStore from REST bootstrap"
```

---

### Task 1.7: Manual repro of the original "stuck offline" bug

- [ ] **Step 1: Reproduce the exact user scenario**

1. Have teammate (e.g. Hiru) online. Confirm green dot in chat list.
2. Have teammate disconnect network for 2+ minutes. Dot goes gray (expected).
3. Teammate reconnects and sends you a DM.
4. **Expected with fix:** dot flips green within 1s of the message arriving.
5. **Without fix (pre-branch):** dot stays gray forever.

- [ ] **Step 2: Record result in vincent.md Decisions**

Append to `docs/contributors/vincent.md` Decisions:

```markdown
- 2026-04-16: Verified "stuck offline" repro is fixed by Phase 1 (defensive nudge hardening + PresenceStore unification). No BE change required for this bug.
```

- [ ] **Step 3: Commit vincent.md**

```bash
git add docs/contributors/vincent.md
git commit -m "docs(vincent): log stuck-offline repro verified fixed in Phase 1"
```

---

### Task 1.8 (optional checkpoint): Open FE-foundation PR

At this checkpoint, Phase 1 is shippable on its own (bug 1 fixed, no BE dependency). Option A: keep branch open and stack Phase 4 FE changes on top. Option B: open a PR now and cut a separate branch for Phase 4. **Recommendation: Option A** — one PR per issue per the extension CLAUDE.md convention, since both bugs came from the same brainstorming session.

Skip this task if going with Option A.

---

## Phase 2 — BE: new WS events for Online Now

Adds `discover:online-now:subscribe` / `:unsubscribe` / `:snapshot` / `:delta`.

### Task 2.1: BE branch + reality snapshot

**Files:**
- None (setup)

- [ ] **Step 1: Create branch on webapp**

```bash
cd ../gitchat-webapp
git fetch origin
git checkout -b vincent-presence-unified origin/develop
```

- [ ] **Step 2: Read existing code**

Read (do not modify):
- `backend/src/websocket/services/websocket-relayer.service.ts` — where `watch:presence` is currently handled
- `backend/src/websocket/gateways/base.gateway.ts`
- `backend/src/modules/discover/services/discover.service.ts` — snapshot query source
- `backend/src/modules/discover/discover.module.ts` — module registration

Confirm: `getOnlineNow(viewerLogin, limit)` returns `{ users: OnlineUserDto[] }`. Current DTO field is `lastSeen`.

---

### Task 2.2: Add 15s snapshot cache wrapper on DiscoverService (TDD)

**Files:**
- Create: `backend/src/modules/discover/services/online-now-cache.service.ts`
- Create: `backend/test/unit/discover/online-now-cache.service.spec.ts`
- Modify: `backend/src/modules/discover/discover.module.ts` (register new service)

- [ ] **Step 1: Write failing test**

```typescript
// backend/test/unit/discover/online-now-cache.service.spec.ts
import { OnlineNowCacheService } from '@modules/discover/services/online-now-cache.service';

describe('OnlineNowCacheService', () => {
  it('returns fresh result on first call', async () => {
    const inner = { getOnlineNow: jest.fn().mockResolvedValue({ users: [{ login: 'a' }] }) };
    const svc = new OnlineNowCacheService(inner as any, { ttlMs: 100 });
    const r = await svc.getOnlineNow('viewer', 20);
    expect(r.users).toEqual([{ login: 'a' }]);
    expect(inner.getOnlineNow).toHaveBeenCalledTimes(1);
  });

  it('serves from cache within TTL for same viewer', async () => {
    const inner = { getOnlineNow: jest.fn().mockResolvedValue({ users: [] }) };
    const svc = new OnlineNowCacheService(inner as any, { ttlMs: 10_000 });
    await svc.getOnlineNow('viewer', 20);
    await svc.getOnlineNow('viewer', 20);
    expect(inner.getOnlineNow).toHaveBeenCalledTimes(1);
  });

  it('refetches after TTL expires', async () => {
    const inner = { getOnlineNow: jest.fn().mockResolvedValue({ users: [] }) };
    const svc = new OnlineNowCacheService(inner as any, { ttlMs: 1 });
    await svc.getOnlineNow('viewer', 20);
    await new Promise((r) => setTimeout(r, 5));
    await svc.getOnlineNow('viewer', 20);
    expect(inner.getOnlineNow).toHaveBeenCalledTimes(2);
  });

  it('scopes cache per viewer', async () => {
    const inner = { getOnlineNow: jest.fn().mockResolvedValue({ users: [] }) };
    const svc = new OnlineNowCacheService(inner as any, { ttlMs: 10_000 });
    await svc.getOnlineNow('viewerA', 20);
    await svc.getOnlineNow('viewerB', 20);
    expect(inner.getOnlineNow).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd backend
yarn test:unit online-now-cache
```

- [ ] **Step 3: Implement**

```typescript
// backend/src/modules/discover/services/online-now-cache.service.ts
import { Injectable } from '@nestjs/common';
import type { OnlineNowResponseDto } from '../dto/online-now.dto';
import { DiscoverService } from './discover.service';

interface CacheEntry { expiresAt: number; value: OnlineNowResponseDto; }

@Injectable()
export class OnlineNowCacheService {
  private readonly _cache = new Map<string, CacheEntry>();
  private readonly _ttlMs: number;

  constructor(
    private readonly discoverService: DiscoverService,
    opts: { ttlMs?: number } = {},
  ) {
    this._ttlMs = opts.ttlMs ?? 15_000;
  }

  async getOnlineNow(viewerLogin: string, limit: number): Promise<OnlineNowResponseDto> {
    const key = `${viewerLogin}:${limit}`;
    const hit = this._cache.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.value;
    const value = await this.discoverService.getOnlineNow(viewerLogin, limit);
    this._cache.set(key, { expiresAt: Date.now() + this._ttlMs, value });
    return value;
  }
}
```

- [ ] **Step 4: Register in module**

In `backend/src/modules/discover/discover.module.ts`, add `OnlineNowCacheService` to `providers` and `exports`.

- [ ] **Step 5: Run tests — expect PASS**

```bash
yarn test:unit online-now-cache
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/discover/ backend/test/unit/discover/
git commit -m "feat(discover): add 15s online-now snapshot cache"
```

---

### Task 2.3a: Define WS event name constants and types

**Files:**
- Modify: `backend/src/websocket/constants/ws-namespaces.constant.ts`
- Create: `backend/src/websocket/types/online-now.types.ts`

- [ ] **Step 1: Add event name constants**

In `backend/src/websocket/constants/ws-namespaces.constant.ts` (or wherever `watch:presence` is defined), add:

```typescript
export const WS_SUBSCRIBE = {
  // existing...
  DISCOVER_ONLINE_NOW_SUBSCRIBE: 'discover:online-now:subscribe',
  DISCOVER_ONLINE_NOW_UNSUBSCRIBE: 'discover:online-now:unsubscribe',
};

export const WS_EVENTS = {
  // existing...
  DISCOVER_ONLINE_NOW_SNAPSHOT: 'discover:online-now:snapshot',
  DISCOVER_ONLINE_NOW_DELTA: 'discover:online-now:delta',
};
```

- [ ] **Step 2: Commit constants task**

```bash
git add backend/src/websocket/
git commit -m "feat(ws): declare discover:online-now event constants"
```

---

### Task 2.3b: Add subscription registry + handlers + 2s batch

**Files:**
- Modify: `backend/src/websocket/services/websocket-relayer.service.ts`
- Create: `backend/test/unit/websocket/online-now-subscription.spec.ts`

**Prerequisite grep before coding** — executor must first:
1. `grep -n "socket.data\|handshake.auth\|@ConnectedSocket\|authLogin\|userLogin" backend/src/websocket/services/websocket-relayer.service.ts` to find the **existing** pattern for resolving the authenticated user from a socket. Do NOT invent `_getAuthLoginOrFail` — use the same accessor the existing `watch:presence` handler uses.

- [ ] **Step 1: Write failing unit test for delta diffing logic**

Extract the diff logic into a pure helper first (`computeOnlineNowDelta(prev: Set<string>, next: OnlineUserDto[])`). Unit-test that:
- Added = next users not in prev
- Removed = prev logins not in next
- Both empty → function returns null (signal "do not emit")

Place test at `backend/test/unit/websocket/online-now-subscription.spec.ts`. Run `yarn test:unit` — expect fail.

- [ ] **Step 2: Implement `computeOnlineNowDelta` helper**

Create `backend/src/websocket/utils/online-now-delta.util.ts` as a pure function. Re-run test — expect pass.

- [ ] **Step 3: Add subscription registry + socket handlers in relayer**

Inside `WebsocketRelayerService`, add:

```typescript
interface OnlineNowSubscription {
  viewerLogin: string;
  limit: number;
  lastLoginSet: Set<string>;
  batchTimer: NodeJS.Timeout;
}
private readonly _onlineNowSubs = new Map<string /*socketId*/, OnlineNowSubscription>();
```

In the socket handshake / authenticated connection handler (same hook where `watch:presence` is registered), register — replace `<RESOLVE_AUTH_LOGIN>` with the exact expression used by the existing `watch:presence` handler (e.g. `socket.data.login` or `(socket.handshake.auth as any).login`):

```typescript
socket.on(WS_SUBSCRIBE.DISCOVER_ONLINE_NOW_SUBSCRIBE, async (payload: { limit?: number } | undefined) => {
  const viewerLogin = <RESOLVE_AUTH_LOGIN>;
  if (!viewerLogin) {
    socket.emit('error', { code: 'UNAUTHENTICATED' });
    return;
  }
  const limit = Math.min(Math.max(payload?.limit ?? 20, 1), 50);

  // Kill any prior subscription on this socket (client re-subscribe)
  this._dropOnlineNowSub(socket.id);

  // Initial snapshot
  const snap = await this.onlineNowCacheService.getOnlineNow(viewerLogin, limit);
  const loginSet = new Set(snap.users.map((u) => u.login));
  socket.emit(WS_EVENTS.DISCOVER_ONLINE_NOW_SNAPSHOT, { data: { users: snap.users } });

  // Register + start 2s batch
  const batchTimer = setInterval(() => {
    void this._emitOnlineNowDelta(socket, viewerLogin, limit);
  }, 2000);
  this._onlineNowSubs.set(socket.id, { viewerLogin, limit, lastLoginSet: loginSet, batchTimer });
});

socket.on(WS_SUBSCRIBE.DISCOVER_ONLINE_NOW_UNSUBSCRIBE, () => {
  this._dropOnlineNowSub(socket.id);
});

socket.on('disconnect', () => {
  this._dropOnlineNowSub(socket.id);
});
```

Helper methods:

```typescript
private async _emitOnlineNowDelta(socket: Socket, viewerLogin: string, limit: number): Promise<void> {
  const sub = this._onlineNowSubs.get(socket.id);
  if (!sub) return;
  const fresh = await this.onlineNowCacheService.getOnlineNow(viewerLogin, limit);
  const freshMap = new Map(fresh.users.map((u) => [u.login, u]));
  const added = fresh.users.filter((u) => !sub.lastLoginSet.has(u.login));
  const removed: string[] = [];
  for (const login of sub.lastLoginSet) {
    if (!freshMap.has(login)) removed.push(login);
  }
  if (added.length === 0 && removed.length === 0) return;
  socket.emit(WS_EVENTS.DISCOVER_ONLINE_NOW_DELTA, { data: { added, removed } });
  sub.lastLoginSet = new Set(freshMap.keys());
}

private _dropOnlineNowSub(socketId: string): void {
  const sub = this._onlineNowSubs.get(socketId);
  if (!sub) return;
  clearInterval(sub.batchTimer);
  this._onlineNowSubs.delete(socketId);
}
```

**Multi-node note (acceptable for v1):** `setInterval` per socket lives on the node that owns the connection. Socket.IO Redis adapter ensures `disconnect` fires only on that owning node, so timer cleanup is correct. If the deployment uses a multi-node gateway cluster, this still works because each subscription is pinned to one node. Document this assumption; no code change for v1.

- [ ] **Step 4: Build + type-check**

```bash
yarn build
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add backend/src/websocket/
git commit -m "feat(ws): add discover:online-now subscribe/snapshot/delta handlers"
```

---

### Task 2.3c: Wire DiscoverModule into WebsocketModule

**Files:**
- Modify: `backend/src/websocket/websocket.module.ts`
- Modify: `backend/src/modules/discover/discover.module.ts` (ensure `OnlineNowCacheService` is exported — done in Task 2.2)

- [ ] **Step 1: Import DiscoverModule**

In `websocket.module.ts`, add `DiscoverModule` to `imports`. Inject `OnlineNowCacheService` into `WebsocketRelayerService` constructor.

- [ ] **Step 2: Build**

```bash
yarn build
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/websocket/websocket.module.ts backend/src/modules/discover/
git commit -m "chore(ws): wire DiscoverModule into WebsocketModule"
```

---

### Task 2.4: Integration test for BE subscribe/delta flow

**Files:**
- Create: `backend/test/integration/discover/online-now-ws.e2e-spec.ts`

- [ ] **Step 1: Write e2e test using existing WS test harness**

Pattern: boot test app, connect two Socket.IO clients (viewerA, userB), have userB heartbeat to go online, have viewerA subscribe, assert snapshot arrives, then mark userB offline (or wait for sweeper), assert delta removed arrives within 3s.

Skip the full code block here (follow existing `test/integration/**/*.e2e-spec.ts` patterns). Minimum 3 test cases:

1. `subscribe → snapshot within 500ms`
2. `user goes online → added in delta within 3s`
3. `user goes offline → removed in delta within 3s`

- [ ] **Step 2: Run**

```bash
yarn test:e2e online-now-ws
```

- [ ] **Step 3: Commit**

```bash
git add backend/test/integration/discover/
git commit -m "test(discover): e2e coverage for online-now ws subscription"
```

---

## Phase 3 — Rename REST DTO field `lastSeen` → `lastSeenAt` (FE-first to avoid breaking existing FE)

**Ordering decision:** the current FE reads `.lastSeen` from REST. If BE renames first and ships to api-dev before FE updates, every existing FE installation with an unupdated Online Now will see `undefined` until they upgrade. To avoid this, BE emits **both** fields for one release. The new `lastSeenAt` is the canonical field; `lastSeen` is a deprecated alias.

### Task 3.1: Dual-emit on BE DTO

**Files:**
- Modify: `backend/src/modules/discover/dto/online-now.dto.ts`
- Modify: `backend/src/modules/discover/services/discover.service.ts` (locate by grep: `lastSeen: c.lastSeenAt`)

- [ ] **Step 1: Dual-emit**

In `online-now.dto.ts`, on `OnlineUserDto`, add both `lastSeen` (deprecated) and `lastSeenAt` as optional string/null. Mark `lastSeen` with `@ApiPropertyOptional({ deprecated: true, description: 'Use lastSeenAt instead' })`.

In `discover.service.ts`, change the push to emit both:

```typescript
users.push({
  login: c.login,
  name: c.name ?? null,
  avatarUrl: c.avatarUrl ?? null,
  lastSeen: c.lastSeenAt ? c.lastSeenAt.toISOString() : null,
  lastSeenAt: c.lastSeenAt ? c.lastSeenAt.toISOString() : null,
});
```

Same change in the WS snapshot payload path if any separate mapping exists — keep them identical.

- [ ] **Step 2: Build**

```bash
yarn build
```

Should pass (DTO type is referenced only inside this module + via swagger).

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/discover/
git commit -m "refactor(discover): emit lastSeenAt alongside deprecated lastSeen"
```

**Phase 6 (cleanup) removes the deprecated `lastSeen` field after one release cycle.**

---

### Task 3.2: Update FE REST consumer to prefer `lastSeenAt` (with fallback)

**Files:**
- Modify (FE repo): `gitchat_extension/src/api/index.ts:151-155`

- [ ] **Step 1: Switch back to FE repo and branch**

```bash
cd ../gitchat_extension
git checkout vincent-presence-unified
```

- [ ] **Step 2: Update return type and mapping with graceful fallback**

```typescript
async getOnlineNow(limit = 20): Promise<{ login: string; name: string | null; avatarUrl: string | null; lastSeenAt: string | null }[]> {
  const { data } = await this._http.get("/discover/online-now", { params: { limit }, timeout: 10000 });
  const d = data?.data ?? data;
  const users = d?.users ?? [];
  // During deprecation window BE emits both lastSeen and lastSeenAt.
  // Prefer lastSeenAt, fall back to lastSeen for older BE deploys.
  return users.map((u: any) => ({
    login: u.login,
    name: u.name ?? null,
    avatarUrl: u.avatarUrl ?? null,
    lastSeenAt: u.lastSeenAt ?? u.lastSeen ?? null,
  }));
}
```

- [ ] **Step 3: Update any caller**

```bash
grep -rn "lastSeen" src/ media/
```

Update any Online Now renderer still reading `.lastSeen` → `.lastSeenAt`.

- [ ] **Step 4: Compile**

```bash
npm run compile
```

- [ ] **Step 5: Commit**

```bash
git add src/ media/
git commit -m "refactor(api): align Online Now REST field with lastSeenAt"
```

---

## Phase 4 — FE: subscribe to Online Now WS channel

### Task 4.1: Add subscribe/unsubscribe API + emitters to `RealtimeClient`

**Files:**
- Modify: `src/realtime/index.ts`

- [ ] **Step 1: Add constants**

```typescript
const WS_EVENTS = {
  // existing...
  DISCOVER_ONLINE_NOW_SNAPSHOT: "discover:online-now:snapshot",
  DISCOVER_ONLINE_NOW_DELTA: "discover:online-now:delta",
};

const WS_SUBSCRIBE = {
  // existing...
  DISCOVER_ONLINE_NOW_SUBSCRIBE: "discover:online-now:subscribe",
  DISCOVER_ONLINE_NOW_UNSUBSCRIBE: "discover:online-now:unsubscribe",
};
```

- [ ] **Step 2: Add emitters + subscription flag**

In `RealtimeClient` class:

```typescript
private readonly _onDiscoverOnlineNowSnapshot = new vscode.EventEmitter<{ users: OnlineNowUser[] }>();
readonly onDiscoverOnlineNowSnapshot = this._onDiscoverOnlineNowSnapshot.event;

private readonly _onDiscoverOnlineNowDelta = new vscode.EventEmitter<{ added: OnlineNowUser[]; removed: string[] }>();
readonly onDiscoverOnlineNowDelta = this._onDiscoverOnlineNowDelta.event;

private _discoverOnlineNowSubscribed = false;
private _discoverOnlineNowLimit = 20;
```

Add type:

```typescript
export interface OnlineNowUser {
  login: string;
  name: string | null;
  avatarUrl: string | null;
  lastSeenAt: string | null;
}
```

- [ ] **Step 3: Hook `on("connect")` re-subscribe**

Inside the existing `on("connect")` handler (after the `watchPresence` re-subscribe loop around line 131-133):

```typescript
if (this._discoverOnlineNowSubscribed) {
  this._socket?.emit(WS_SUBSCRIBE.DISCOVER_ONLINE_NOW_SUBSCRIBE, { limit: this._discoverOnlineNowLimit });
}
```

- [ ] **Step 4: Register incoming handlers**

In `connect()`, alongside other `socket.on(...)`:

```typescript
this._socket.on(WS_EVENTS.DISCOVER_ONLINE_NOW_SNAPSHOT, (payload: { data?: { users: OnlineNowUser[] } }) => {
  const users = payload.data?.users ?? [];
  this._onDiscoverOnlineNowSnapshot.fire({ users });
  // Cross-channel write-through (spec §5.3)
  for (const u of users) {
    presenceStore.set(u.login, { online: true, lastSeenAt: u.lastSeenAt });
  }
});

this._socket.on(WS_EVENTS.DISCOVER_ONLINE_NOW_DELTA, (payload: { data?: { added: OnlineNowUser[]; removed: string[] } }) => {
  const added = payload.data?.added ?? [];
  const removed = payload.data?.removed ?? [];
  this._onDiscoverOnlineNowDelta.fire({ added, removed });
  for (const u of added) {
    presenceStore.set(u.login, { online: true, lastSeenAt: u.lastSeenAt });
  }
  for (const login of removed) {
    const prev = presenceStore.get(login);
    presenceStore.set(login, { online: false, lastSeenAt: prev?.lastSeenAt ?? null });
  }
});
```

- [ ] **Step 5: Public API**

```typescript
subscribeDiscoverOnlineNow(limit = 20): void {
  this._discoverOnlineNowSubscribed = true;
  this._discoverOnlineNowLimit = limit;
  this._socket?.emit(WS_SUBSCRIBE.DISCOVER_ONLINE_NOW_SUBSCRIBE, { limit });
}

unsubscribeDiscoverOnlineNow(): void {
  this._discoverOnlineNowSubscribed = false;
  this._socket?.emit(WS_SUBSCRIBE.DISCOVER_ONLINE_NOW_UNSUBSCRIBE);
}
```

Dispose emitters in `dispose()`.

- [ ] **Step 6: Compile**

```bash
npm run compile
```

- [ ] **Step 7: Commit**

```bash
git add src/realtime/index.ts
git commit -m "feat(realtime): add discover online-now subscription API and events"
```

---

### Task 4.2: Wire Online Now subscribe lifecycle to Discover tab

**Files:**
- Modify: `media/webview/explore.js`
- Modify: `src/webviews/explore.ts`

- [ ] **Step 1: Webview → provider messages on tab change**

In `explore.js`, inside the tab-switch handler that activates Discover, post:

```javascript
vscode.postMessage({ type: "discoverTabActive" });
```

On switching away (or on `window.unload`):

```javascript
vscode.postMessage({ type: "discoverTabInactive" });
```

Also handle incoming:

```javascript
window.addEventListener("message", (e) => {
  const msg = e.data;
  if (msg?.type === "discoverOnlineNowSnapshot") {
    discoverOnlineNow = msg.payload.users || [];
    render();
  } else if (msg?.type === "discoverOnlineNowDelta") {
    const addedLogins = new Set((msg.payload.added || []).map((u) => u.login));
    const removed = new Set(msg.payload.removed || []);
    discoverOnlineNow = discoverOnlineNow
      .filter((u) => !removed.has(u.login) && !addedLogins.has(u.login))
      .concat(msg.payload.added || []);
    render();
  }
});
```

- [ ] **Step 2: Provider-side: subscribe/unsubscribe + forward events**

In `src/webviews/explore.ts`, inside the webview message listener:

```typescript
if (msg.type === "discoverTabActive") {
  realtimeClient.subscribeDiscoverOnlineNow(20);
} else if (msg.type === "discoverTabInactive") {
  realtimeClient.unsubscribeDiscoverOnlineNow();
}
```

Register subscriptions once on panel creation:

```typescript
const snapSub = realtimeClient.onDiscoverOnlineNowSnapshot((payload) => {
  this._view?.webview.postMessage({ type: "discoverOnlineNowSnapshot", payload });
});
const deltaSub = realtimeClient.onDiscoverOnlineNowDelta((payload) => {
  this._view?.webview.postMessage({ type: "discoverOnlineNowDelta", payload });
});
this._disposables.push(snapSub, deltaSub);
```

On panel dispose:

```typescript
realtimeClient.unsubscribeDiscoverOnlineNow();
```

- [ ] **Step 3: Keep REST fallback with 3s timeout**

In `explore.js`, on `discoverTabActive`:

Use a module-scoped flag that the snapshot handler can clear. Do NOT use `const` inside the handler — that was a bug:

```javascript
// Module-scoped at top of explore.js
let _onlineNowWsSnapshotReceived = false;

// In the snapshot message handler, set:
//   _onlineNowWsSnapshotReceived = true;

// When Discover tab becomes active:
_onlineNowWsSnapshotReceived = false;
setTimeout(() => {
  if (!_onlineNowWsSnapshotReceived && discoverOnlineNow.length === 0) {
    vscode.postMessage({ type: "discoverOnlineNowRestFallback" });
  }
}, 3000);
```

Per spec §5.4 precedence rule: if a WS snapshot arrives after the REST fallback has rendered, it fully replaces the list.

Provider handles `discoverOnlineNowRestFallback` by calling `apiClient.getOnlineNow(20)` and posting back a snapshot message. If WS snapshot subsequently arrives, it fully replaces the REST result (spec §5.4 precedence rule).

- [ ] **Step 4: Compile + smoke test**

```bash
npm run compile
npm run watch
```

1. Reload extension, open Explore → Discover tab
2. Dev tools Network: verify WS frame `discover:online-now:subscribe` emitted
3. Verify Online Now populated within 1-2s
4. Have teammate go online → appears in <3s
5. Have teammate go offline → disappears in <3s
6. Switch to Chat tab → verify `discover:online-now:unsubscribe` emitted
7. Switch back → re-subscribe

- [ ] **Step 5: Commit**

```bash
git add src/webviews/explore.ts media/webview/explore.js
git commit -m "feat(discover): realtime Online Now via WS snapshot/delta"
```

---

## Phase 5 — Flag, rollout, cleanup

### Task 5.1: Feature flag `wsDiscoverOnlineNow`

**Files:**
- Modify: `package.json` (contributes.configuration)
- Modify: `src/config/index.ts`
- Modify: `src/webviews/explore.ts` (gate subscribe call)

- [ ] **Step 1: Add config**

In `package.json` under `contributes.configuration.properties`:

```json
"trending.wsDiscoverOnlineNow": {
  "type": "boolean",
  "default": false,
  "description": "Use WebSocket for Discover → Online Now (experimental)."
}
```

In `src/config/index.ts`, read the flag and expose via `configManager.current.wsDiscoverOnlineNow`.

- [ ] **Step 2: Gate the subscribe call**

```typescript
if (msg.type === "discoverTabActive") {
  if (configManager.current.wsDiscoverOnlineNow) {
    realtimeClient.subscribeDiscoverOnlineNow(20);
  } else {
    // Legacy REST path
    this._loadOnlineNowViaRest();
  }
}
```

- [ ] **Step 3: Handle runtime flag toggle**

If the user flips the flag off while Discover is active, the client will still have an active WS subscription on BE. Listen to `vscode.workspace.onDidChangeConfiguration` and on `trending.wsDiscoverOnlineNow` change:
- flag went true → call `subscribeDiscoverOnlineNow(20)` if Discover tab is active
- flag went false → call `unsubscribeDiscoverOnlineNow()` and trigger REST fallback render if Discover tab is active

- [ ] **Step 4: Commit**

```bash
git add package.json src/config/ src/webviews/explore.ts
git commit -m "feat(config): add wsDiscoverOnlineNow feature flag with live toggle"
```

---

### Task 5.2: Update vincent.md + open PRs

- [ ] **Step 1: Finalize vincent.md**

Overwrite Current section:

```markdown
## Current
- Branch: `vincent-presence-unified` (FE + BE)
- Task: Unified Presence — Phase 1-5 complete, flag default off
- Blockers: None
- Last updated: 2026-04-16
```

Append Decisions:

```markdown
- 2026-04-16: Shipped v1 behind `wsDiscoverOnlineNow` flag (default off). Phase 1 stuck-offline fix ships unconditionally. Hiru scheduled for fine-tune pass after QA.
```

- [ ] **Step 2: Commit docs**

```bash
git add docs/contributors/vincent.md
git commit -m "docs(vincent): wrap presence-unified v1"
```

- [ ] **Step 3: Open BE PR first (no FE dependency)**

```bash
cd ../gitchat-webapp
git push -u origin vincent-presence-unified
gh pr create --base develop --title "feat(presence): unified presence WS + online-now realtime" --body-file - <<'EOF'
## Summary
- Add 15s cache wrapper over `DiscoverService.getOnlineNow`
- Add `discover:online-now:subscribe/unsubscribe/snapshot/delta` WS events with 2s batching per subscriber
- Rename REST DTO field `lastSeen` → `lastSeenAt` for consistency with `presence:*` events

Spec: see FE repo `docs/superpowers/specs/2026-04-16-presence-unified-design.md`.

## Test plan
- [ ] Unit: `online-now-cache.service.spec.ts` passes
- [ ] E2E: `online-now-ws.e2e-spec.ts` — subscribe, delta added/removed
- [ ] Manual: connect 2 socket clients, verify delta cadence
EOF
```

- [ ] **Step 4: Open FE PR after BE deployed to api-dev**

```bash
cd ../gitchat_extension
git push -u origin vincent-presence-unified
gh pr create --base develop --title "feat(presence): PresenceStore + realtime Online Now" --body-file - <<'EOF'
## Summary
- New `PresenceStore` singleton (single source of truth across views, LRU 1000)
- Hardened defensive nudge against payload shape drift
- Auto-watch presence for any login seen on the wire
- Removed 50-DM-partner cap
- New realtime Online Now subscription (behind `wsDiscoverOnlineNow` flag, default off)
- Closes stuck-offline bug unconditionally (Phase 1 lands independent of flag)

Spec: `docs/superpowers/specs/2026-04-16-presence-unified-design.md`.

## Test plan
- [ ] Unit: PresenceStore, defensive nudge, event-login-extractor
- [ ] Manual: Hiru-stuck-offline repro — dot must flip green on message
- [ ] Manual: flip flag on, verify Online Now updates in <3s when a user logs in/out
- [ ] Manual: flip flag off — regression-tests the legacy REST path
EOF
```

- [ ] **Step 5: Post-merge flag flip**

Once both PRs merge and BE hits production:

1. Flip default of `trending.wsDiscoverOnlineNow` to `true` in a follow-up PR.
2. Monitor WS error rate + Online Now empty rate for 3 days.
3. After stability, open a cleanup PR to remove REST fallback (Phase 6).

---

## Phase 6 — Cleanup (separate follow-up PR)

After flag is default on and stable for one release:

### Task 6.1: Remove REST fallback path + deprecated DTO field

- [ ] Delete REST fallback branches in `explore.js` + `explore.ts`.
- [ ] Remove deprecated `lastSeen` field from BE `OnlineUserDto` + service (keep `lastSeenAt`). Update FE `getOnlineNow` to drop the `?? u.lastSeen` fallback.
- [ ] Keep the REST endpoint on BE one more release, then remove controller + service method.
- [ ] Remove `wsDiscoverOnlineNow` flag entirely.
- [ ] Commit: `chore(presence): remove legacy Online Now REST path + deprecated lastSeen`.

---

## File map summary

### FE (`gitchat_extension`)

| File | Phase | Change |
|---|---|---|
| `src/realtime/presence-store.ts` | 1 | NEW |
| `src/realtime/nudge.ts` | 1 | NEW |
| `src/realtime/event-login-extractor.ts` | 1 | NEW |
| `src/realtime/index.ts` | 1+4 | Route presence through store, auto-watch, online-now sub API |
| `src/webviews/chat-panel.ts` | 1 | Remove 50-cap, seed presenceStore |
| `src/webviews/chat.ts` | 1 | Migrate to presenceStore.onChange |
| `src/webviews/explore.ts` | 4 | Online-now subscribe lifecycle |
| `media/webview/explore.js` | 4 | Tab active msg, snapshot/delta handling |
| `src/api/index.ts` | 3 | `lastSeen` → `lastSeenAt` |
| `src/config/index.ts` | 5 | Flag |
| `package.json` | 5 | Flag contribution |
| `src/test/realtime/*.test.ts` | 1 | NEW unit tests |
| `docs/contributors/vincent.md` | 1+5 | Session log |

### BE (`gitchat-webapp/backend`)

| File | Phase | Change |
|---|---|---|
| `src/modules/discover/services/online-now-cache.service.ts` | 2 | NEW |
| `src/modules/discover/services/discover.service.ts` | 3 | Field rename |
| `src/modules/discover/dto/online-now.dto.ts` | 3 | Field rename |
| `src/modules/discover/discover.module.ts` | 2 | Register cache service |
| `src/websocket/services/websocket-relayer.service.ts` | 2 | Subscribe/unsubscribe/delta emitter |
| `src/websocket/constants/ws-namespaces.constant.ts` | 2 | Event name constants |
| `src/websocket/websocket.module.ts` | 2 | Wire DiscoverModule |
| `test/unit/discover/online-now-cache.service.spec.ts` | 2 | NEW |
| `test/integration/discover/online-now-ws.e2e-spec.ts` | 2 | NEW |

---

## Acceptance checklist

Before marking v1 done:

- [ ] All unit tests pass on both repos (`npm test` + `yarn test:unit`)
- [ ] BE e2e tests pass (`yarn test:e2e`)
- [ ] `npm run compile` clean on FE
- [ ] `yarn build` clean on BE
- [ ] Manual: stuck-offline repro resolved (Phase 1 verification)
- [ ] Manual: Online Now updates within 3s on transition (flag on)
- [ ] Manual: Reconnect after network flap restores both presence dots and Online Now
- [ ] `docs/contributors/vincent.md` up to date
- [ ] Two PRs opened against `develop` (BE + FE)
