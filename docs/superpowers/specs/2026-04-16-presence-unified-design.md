# Unified Presence System — Design Spec

**Date:** 2026-04-16
**Author / Implementer:** vincent (FE + BE). nakamoto-hiru will fine-tune after first pass.
**Status:** Draft — pending review
**Scope:** `gitchat_extension` + `gitchat-webapp/backend`

## 1. Problem

Two user-visible bugs that share a root cause (fragmented presence state):

1. **"Stuck offline" dot.** A user that is observed online, then goes offline, stays gray forever — even when they send a message directly to the viewer. Observed with `nakamoto-hiru`.
2. **Discover → Online Now always empty.** Section renders `No one online right now` even when peers are demonstrably online elsewhere in the UI.

## 2. Root cause analysis

**Bug 1 (stuck offline):**

- Client only watches presence for a **bounded set** of logins: `following` + first 50 DM partners (`src/webviews/chat-panel.ts:122-137`). Anyone outside this set never receives `presence:updated` events, so the dot freezes at whatever state the initial REST fetch returned.
- Defensive nudge at `src/realtime/index.ts:155-167` reads `msg.sender` — if BE payload uses a different field (`senderLogin`, `author.login`, `from.login`), the nudge silently no-ops. No test covers this.
- Presence state is stored per-view (`chat-panel` has a local `presenceData` map; `explore` has its own; profile card has its own). An update reaching one view does not propagate to others.

**Bug 2 (Online Now empty):**

- Data sourced from one-shot REST `GET /discover/online-now` at tab mount (`src/api/index.ts:151`).
- No subscription mechanism — if BE returns `[]` at that moment, or if the endpoint returns before BE has fully populated its cache, the UI stays empty until user navigates away and back. Users coming online after mount never appear.

## 3. Goals / non-goals

**Goals:**

- Presence dot state is **consistent** across every view (chat list, chat header, profile card, Discover).
- Online Now updates in near-real-time when users transition online/offline.
- Hardening against BE payload drift (defensive nudge must survive field renames).
- Bounded, predictable load on BE — no broadcast-to-all patterns.

**Non-goals:**

- Global "Appear offline" invisible mode (separate feature, tracked elsewhere).
- iOS native parity (separate spec, same BE contract reusable).
- Webapp frontend adoption (BE contract designed for multi-client; webapp can adopt later).
- Sub-second presence accuracy (2s delta cadence is acceptable).

## 4. Architecture

```
┌─────────────── Extension (client) ─────────────────┐
│                                                    │
│   ┌──────────────────────────────────────────┐     │
│   │  PresenceStore (NEW, singleton)          │     │
│   │  Map<login, { online, lastSeenAt }>      │     │
│   │  onChange(login) → EventEmitter          │     │
│   └────────▲────────────────────┬────────────┘     │
│            │ write              │ read             │
│   ┌────────┴─────────┐   ┌──────┴──────────┐       │
│   │ RealtimeClient   │   │ All webviews:   │       │
│   │  - presence:*    │   │  - chat-panel   │       │
│   │  - online-now:*  │   │  - explore      │       │
│   │  - auto-watch    │   │  - profile      │       │
│   └────────▲─────────┘   └─────────────────┘       │
│            │ WS                                    │
└────────────┼───────────────────────────────────────┘
             │
┌────────────┼──── Backend (gitchat-webapp) ─────────┐
│   ┌────────┴──────────────────────────────┐        │
│   │  PresenceGateway (existing, extend)   │        │
│   │   + discover:online-now:subscribe     │        │
│   │   + discover:online-now:unsubscribe   │        │
│   │   + 2s batch emitter per subscriber   │        │
│   └────────┬──────────────────────────────┘        │
│   ┌────────▼──────────┐  ┌─────────────────┐       │
│   │  PresenceService  │  │ DiscoverService │       │
│   │   (Redis ZSET +   │  │  - online-now   │       │
│   │    heartbeat TTL) │  │    query + 15s  │       │
│   │                   │  │    cache        │       │
│   └───────────────────┘  └─────────────────┘       │
└────────────────────────────────────────────────────┘
```

**Principles:**

- `PresenceStore` (FE) is the **single source of truth** for presence in the extension. Every view reads and subscribes from it — no per-view presence maps.
- Per-user presence (`presence:updated` / `:snapshot`) and Online Now (`discover:online-now:*`) are two distinct channels but both write into `PresenceStore`.
- Auto-watch in `RealtimeClient` inspects every incoming event, extracts logins, and calls `watchPresence()` for any unseen login. The watch set grows organically instead of being pre-computed.

## 5. WebSocket contract

### 5.1 Existing events (unchanged)

| Event | Direction | Payload |
|---|---|---|
| `watch:presence` | C→S | `{ login: string }` |
| `unwatch:presence` | C→S | `{ login: string }` |
| `presence:heartbeat` | C→S | `{}` |
| `presence:snapshot` | S→C | `{ data: { login, status: "online" \| "offline", lastSeenAt } }` |
| `presence:updated` | S→C | `{ data: { login, status, lastSeenAt } }` |

### 5.2 New events (BE work required)

| Event | Direction | Payload | Notes |
|---|---|---|---|
| `discover:online-now:subscribe` | C→S | `{ limit?: number }` (default 20) | Client emits on Discover tab activate. BE replies with snapshot and starts 2s batch loop scoped to this client. |
| `discover:online-now:unsubscribe` | C→S | `{}` | Client emits on Discover tab deactivate or panel close. BE stops batch loop, clears subscription. |
| `discover:online-now:snapshot` | S→C | `{ data: { users: OnlineNowUser[] } }` | Emitted once, immediately after subscribe. Sourced from 15s-cached query. |
| `discover:online-now:delta` | S→C | `{ data: { added: OnlineNowUser[], removed: string[] } }` | Emitted every 2s **only if** there is a change. `added` carries full `OnlineNowUser` objects; `removed` carries logins only. |

**Type definition (shared by snapshot and delta):**

```typescript
type OnlineNowUser = {
  login: string;
  name: string | null;
  avatarUrl: string | null;
  lastSeenAt: string | null; // ISO-8601; field name matches presence:* events
};

// BE also renames the existing REST response DTO field `lastSeen` → `lastSeenAt`
// for cross-channel consistency (see §6).
```

Field `lastSeenAt` is named identically to `presence:updated` / `:snapshot` payloads (§5.1) — no `lastSeen`/`lastSeenAt` split. BE must normalize.

### 5.3 Semantics

- **Snapshot determinism:** `:snapshot` must always precede any `:delta` for the same client. Enforced by Socket.IO room-join ordering.
- **Auto cleanup:** BE must drop Online Now subscriptions when a client disconnects.
- **Per-client batch window:** Each subscriber has its own 2s timer. No global timer — avoids synchronized fanout spikes.
- **Filter query:** `users WHERE online = true AND visible_in_discover = true AND NOT mutual_with(currentUser) ORDER BY last_seen DESC LIMIT N`.
- **`currentUser` source:** derived from the authenticated socket session (the same auth backing `subscribe:user`). `subscribe` payload carries no `currentUser` field. An unauthenticated socket emitting `discover:online-now:subscribe` receives a Socket.IO `error` event with code `UNAUTHENTICATED` and no snapshot.
- **Cross-channel write-through:** `:snapshot` and `:delta.added` entries MUST be written into `PresenceStore` (setting `online: true`, `lastSeenAt`). `:delta.removed` entries MUST set `online: false` in `PresenceStore` (do NOT delete the entry — keep `lastSeenAt`). This is what makes Online Now and per-user dots share state.

### 5.4 Backwards compatibility

- REST `GET /discover/online-now` remains available during rollout as a 3-second timeout fallback (if `:snapshot` fails to arrive). Deprecated and removed one release after the WS path is proven stable.
- **Precedence rule:** if REST fallback has rendered and `:snapshot` later arrives (even after the 3s threshold), `:snapshot` takes precedence and fully replaces the Online Now list. Subsequent `:delta`s apply on top of the snapshot state. The REST result is only authoritative until a WS snapshot exists.

## 6. Backend data model

**Reality check (existing BE):** `backend/src/modules/discover/services/discover.service.ts` already exposes `getOnlineNow(viewerLogin, limit)` that:

- Queries `user_profiles WHERE last_seen_at > now() - 5min AND login != viewer` (limit 200 candidates).
- Filters out mutuals (via `user_follows` join) and users the viewer has already waved.
- Filters out users whose `inappNotiPrefs.hideFromOnlineNow === true` (JSONB).
- Returns `OnlineUserDto { login, name, avatarUrl, lastSeen }`.

**Decisions for v1:**

- **Reuse existing privacy field** `user_profiles.inappNotiPrefs.hideFromOnlineNow`. **No new column, no migration.** The spec's earlier `visible_in_discover` field is dropped as redundant.
- **Reuse existing `DiscoverService.getOnlineNow()`** as the snapshot source. Wrap with a 15s in-memory cache keyed by `viewerLogin` at the service layer (new, thin wrapper).
- **Rename DTO field** `lastSeen` → `lastSeenAt` to match presence event payload naming (§5.1). This is a small breaking change to the REST response; the REST consumer in the extension (`src/api/index.ts:151-155`) also updates. Call out in commit message.
- **Online detection source:** existing `user_profiles.last_seen_at` column (updated by presence heartbeats via `PresenceLastSeenRepository`). No new Redis keys required.
- **Subscription registry:** in-memory `Map<socketId, { viewerLogin, limit, lastSnapshotLoginSet, batchTimer }>` owned by the new online-now gateway. Rebuilt from scratch on BE restart (clients reconnect and re-subscribe).
- **Delta computation:** every 2s per subscriber, re-run `getOnlineNow(viewer, limit)` (served by 15s cache for most calls), diff `Set<login>` against `lastSnapshotLoginSet`, emit `:delta { added, removed }` only if non-empty. Update `lastSnapshotLoginSet`.

## 7. Frontend implementation

### 7.1 New module `src/realtime/presence-store.ts`

```typescript
export interface PresenceEntry {
  online: boolean;
  lastSeenAt: string | null;
}

class PresenceStore {
  private _map = new Map<string, PresenceEntry>();
  private _emitter = new vscode.EventEmitter<{ login: string; entry: PresenceEntry }>();
  readonly onChange = this._emitter.event;

  get(login: string): PresenceEntry | undefined { return this._map.get(login); }

  set(login: string, entry: PresenceEntry): void {
    const prev = this._map.get(login);
    if (prev && prev.online === entry.online && prev.lastSeenAt === entry.lastSeenAt) return;
    this._map.set(login, entry);
    this._emitter.fire({ login, entry });
  }

  bulkSet(entries: Record<string, PresenceEntry>): void {
    for (const [login, entry] of Object.entries(entries)) this.set(login, entry);
  }

  snapshot(): Record<string, PresenceEntry> { return Object.fromEntries(this._map); }
}

export const presenceStore = new PresenceStore();
```

**Status → online adapter.** The wire protocol carries `status: "online" | "offline"`; the store carries `online: boolean`. The single adapter lives at the `realtime/index.ts` presence handler:

```typescript
const handlePresence = (payload: { data?: { login: string; status: string; lastSeenAt?: string | null } }) => {
  const d = payload.data ?? payload;
  presenceStore.set(d.login, {
    online: d.status === "online",
    lastSeenAt: d.lastSeenAt ?? null,
  });
};
```

No other file performs this mapping. Views consume `presenceStore` which is already in boolean form.

### 7.2 `realtime/index.ts` changes

1. Route `presence:updated` / `:snapshot` handlers into `presenceStore.set(...)` via the adapter shown in §7.1. Remove the legacy `_onPresence` EventEmitter entirely; migrate external consumers to `presenceStore.onChange`. **The defensive nudge (current `realtime/index.ts:166`, which fires `_onPresence`) must be rewritten to call `presenceStore.set(sender, { online: true, lastSeenAt: new Date().toISOString() })` directly.** No code path in `realtime/index.ts` may bypass the store.
2. Harden defensive nudge — try `sender`, `senderLogin`, `author.login`, `from.login` in order. Add unit test covering all 4 shapes.
3. Add `onAny` handler that extracts logins from every event and calls `watchPresence([...])` for any unseen login. Centralize shape-to-login mapping in one helper.
   - **Eviction policy:** `PresenceStore` is capped at **1000 entries** via simple LRU keyed by last `set()` call time. When the cap is hit, the least-recently-updated entry is evicted AND a corresponding `unwatch:presence` is emitted to BE. This delivers the §3 "bounded, predictable load" commitment. Rationale: 1000 is well above realistic per-session watch set (following + DM partners + Online Now snapshot ≪ 1000 in practice), so eviction is a ceiling, not a hot path.
4. Remove the 50-DM-partner cap in `chat-panel.ts:122-137`; watch the full DM partner list.
5. Add `subscribeDiscoverOnlineNow(limit)` / `unsubscribeDiscoverOnlineNow()` methods plus two new EventEmitters (`onDiscoverOnlineNowSnapshot`, `onDiscoverOnlineNowDelta`). Re-subscribe on reconnect, mirroring the existing `watchPresence` re-subscription pattern at `src/realtime/index.ts:131-133` (the for-loop inside `on("connect")` that replays `_watchedPresenceLogins`). Add a sibling `_discoverOnlineNowSubscribed: boolean` flag and replay logic in the same handler.

### 7.3 Webview changes

- `src/webviews/explore.ts` + `media/webview/explore.js`: subscribe on Discover tab activate, unsubscribe on deactivate/close. Maintain `discoverOnlineNow` as snapshot + delta patches. Re-render section on each update.
  - **Webview ↔ provider contract for tab lifecycle:** tab activation lives in `media/webview/explore.js` (webview JS). It posts two new messages to the provider:
    - `{ type: "discoverTabActive" }` — sent when Discover tab gains focus.
    - `{ type: "discoverTabInactive" }` — sent when user switches away OR when `onDidChangeViewState` fires `visible = false`.
  - The provider (`src/webviews/explore.ts`) handles these in its existing webview message listener and calls `realtimeClient.subscribeDiscoverOnlineNow(20)` / `unsubscribeDiscoverOnlineNow()` accordingly. On webview dispose, unsubscribe is called defensively.
  - Snapshot and delta payloads are forwarded from provider → webview as `{ type: "discoverOnlineNowSnapshot", payload }` and `{ type: "discoverOnlineNowDelta", payload }`, consumed by `explore.js` render loop.
- `src/webviews/chat-panel.ts`: drop local `presenceData` map. Build initial HTML from `presenceStore.snapshot()`, then forward `presenceStore.onChange` events to the webview via `postMessage`.
- **Decision (was open question): keep REST bootstrap `getPresence()`** as the committed default for v1. We do NOT remove it in this spec regardless of BE guarantees — defense-in-depth is worth more than saving one HTTP call at boot. Revisit in a follow-up if bootstrap latency becomes a measured problem.

### 7.4 Files touched

| File | Change |
|---|---|
| `src/realtime/presence-store.ts` | NEW |
| `src/realtime/index.ts` | store integration, auto-watch, Online Now subscription API |
| `src/webviews/chat-panel.ts` | migrate to `presenceStore`, drop local map and 50-cap |
| `src/webviews/explore.ts` | Online Now subscribe/unsubscribe lifecycle |
| `media/webview/explore.js` | handle snapshot and delta messages |
| `src/api/index.ts` | keep REST as timeout fallback |
| `src/test/realtime/*` | unit tests for store, nudge hardening, auto-watch |

## 8. Testing strategy

**Unit (extension):**

- `PresenceStore`: set/get, dedupe (no event fire when unchanged), bulkSet, snapshot.
- Defensive nudge: fire `message:sent` with 4 payload shapes — store must update in each.
- Auto-watch: fire event with new login — `watch:presence` must be emitted exactly once, no duplicates across repeat events.
- Reconnect: disconnect → reconnect — all previously tracked logins re-watched, Online Now re-subscribed if tab is active.

**Integration (BE, owned by Ryan):**

- Subscribe emits snapshot within 500ms.
- Online transition surfaces in `:delta.added` within 2s.
- Offline transition surfaces in `:delta.removed` within 2s.
- Mutual relationship becoming true removes user from non-mutual viewer's Online Now.
- `visible_in_discover = false` excludes the user from every snapshot and delta.

**Manual QA:**

1. **Stuck-offline repro:** partner goes online → force-disconnect their client 2 min → reconnect → sends message. Dot must flip green within 2s.
2. **Discover realtime:** open Discover, teammate logs in/out externally. Section reflects change within 3s.
3. **Network flap:** unplug network 30s, reconnect. Presence and Online Now self-recover.
4. **Tab toggle spam:** open/close Discover 10×/min. BE stable, no subscription leak.

## 9. Rollout plan

Single-implementer (Vincent) rollout. Hiru fine-tunes after v1 lands.

1. **BE first** on `gitchat-webapp/backend`: implement new WS events + `visible_in_discover` migration. Ship to `api-dev`. REST endpoint kept.
2. **FE** in `gitchat_extension` on branch `vincent-presence-unified`: PresenceStore + refactor + Online Now subscribe. Gate with feature flag `wsDiscoverOnlineNow` (default off).
3. **Flag flip** after 3 days of dev-testing against `api-dev`. Monitor WS error rate and Online Now empty rate.
4. **Deprecate REST** one release after stable. BE endpoint retained one further release, then removed.
5. **Hiru fine-tune pass** — visual polish, edge cases, any UX refinements on top of the working v1.

## 10. Risks

| Risk | Mitigation |
|---|---|
| BE + FE both on one person (Vincent) — context-switch overhead | Sequence BE-first then FE. PresenceStore + nudge hardening + auto-watch are FE-only and can ship independently even before BE events land. |
| WS fanout grows with Discover viewers | 2s batching reduces ~10×. If still hot, add per-client rate limit server-side. |
| `presence:snapshot` not guaranteed after `watch:presence` | Verify with Ryan before removing REST bootstrap. Default keeps REST for safety. |
| `PresenceStore` memory growth from unbounded watch set | Acceptable (extension process is not 24/7). If needed, add LRU cap at 1000 entries. |

## 11. Out of scope

- "Appear offline" global invisible mode.
- iOS native parity.
- Webapp frontend migration to the new events.

## 12. Cross-project deliverables

- Entry in `gitchat_extension/docs/contributors/vincent.md` — Current section (branch, task, blockers) + Decisions section (architecture decisions from this spec). Per top-level CLAUDE.md, Vincent logs cross-project work including BE changes in `gitchat-webapp/`.
- No separate BE-requirements handoff doc — Vincent implements BE directly against this spec.
