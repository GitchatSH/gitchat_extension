# WP8 Wave / Say Hi — Design Spec

**Status:** Draft
**Date:** 2026-04-15
**Owner:** nakamoto-hiru
**Related:** `docs/superpowers/specs/2026-04-13-gitchat-rebrand-feature-spec.md §WP8`

---

## 1. Goal

Low-friction "ping" to let a user nudge a non-mutual online stranger with a single click. The wave does not create any message or conversation by itself — it is a one-shot notification. A DM conversation only materializes when the recipient explicitly chooses to respond. If the recipient ignores, nothing happens and the sender cannot retry.

This is deliberately narrow: Wave exists **only** as the entry point for connecting strangers seen in Discover. Profile Card, @mentions, search, and every other surface do NOT expose Wave — they either show normal DM affordances (for mutuals) or nothing.

---

## 2. Non-goals

- ❌ Wave is not a message. It carries no text, no emoji payload, no body. Any "👋" UI element is purely decorative.
- ❌ Wave is not available on Profile Card. Previous WP6 work added a Wave button to Profile Card stranger state — **this is out of spec and must be removed.**
- ❌ Wave does not support reply-with-text inside the notification. Recipient either taps (responds) or ignores.
- ❌ Wave does not create a Wave Inbox sub-screen, Sent Waves history view, or dedicated management surface. Waves flow through the existing notifications pane and Chat Inbox only.
- ❌ Wave does not support un-waving, re-waving, recalling, or editing.
- ❌ Wave does not apply to mutuals. If A and B are already friends, the Wave button is not shown — they use normal DM.

---

## 3. User roles & states

### 3.1 Sender (User A)

| State | Meaning | UI |
|---|---|---|
| `can_wave` | Viewing a non-mutual online user in Discover → Online Now, no prior wave to this user | Wave button enabled |
| `waving` | Click in flight (request pending) | Wave button → loading |
| `waved` | Wave successfully posted | Wave button → disabled with "Waved ✓" label |
| `blocked` | Rate-limit hit (already waved) OR user became mutual between page load and click (race) | Button disabled with reason tooltip |

Terminal state is `waved` per (A, B) pair. There is no UI path from `waved` back to `can_wave`.

### 3.2 Recipient (User B)

| State | Meaning | UI |
|---|---|---|
| `unread` | Wave notification in notifications pane, not yet interacted with | Row with unread dot |
| `responded` | B tapped the wave row → BE created DM A↔B → B landed in chat view | Row hidden / marked read; DM appears in Chat Inbox |
| `ignored` | B never tapped the wave notification | Row eventually scrolls out of view; no DM ever created |

There is no explicit `dismiss` action. Ignoring is the default. Ignored waves remain in the notifications pane as read-able history but produce no side effect.

---

## 4. Discover → Online Now — corrected model

### 4.1 Current code (buggy)

`media/webview/explore.js:829`:
```js
var onlineNow = (chatFriends || []).filter(function(f) { return f.online; });
```

And `buildDiscoverOnlineRow` (line 909-918) hard-codes the Wave button as `disabled title="Coming soon"`.

Both are wrong:
- **Data source:** sources from `chatFriends`, which is the **mutual friends** list. A mutual cannot be waved. The section today shows only users who cannot actually be waved — the feature is structurally impossible to use.
- **Button state:** always disabled regardless of wave eligibility.

### 4.2 Target model

The Online Now section shows **non-mutual online users** — people the current user does NOT already have as a mutual follow, but who are active on GitChat right now. These are the exact users Wave is designed to connect with.

Data source candidates:
1. **BE endpoint `GET /discover/online-now`** — returns a presence-filtered list of non-mutual users. Clean separation. Requires BE work.
2. **Client-side composition:** call `apiClient.getPresence()` with a broader candidate pool (e.g. recent Discover surface users + starred repo fellow stargazers + contributors) and filter out mutuals locally. No BE work but requires a candidate pool source.
3. **Interim:** surface empty state with a note "Online discovery coming soon" until BE ships endpoint.

**Recommendation:** Option 1 (BE endpoint). Ask Ryan to add `GET /discover/online-now` returning `{ users: [{login, name, avatar_url, last_seen}] }`. Fallback to option 3 if BE declines scope.

### 4.3 Empty state & edge cases

- No candidates → `gs-empty` row: "No strangers online right now. Check back later."
- All candidates already waved → show them with `waved` button state so the user has memory of who they already pinged.
- User scrolled into view after Wave was posted → row should reflect `waved` state on re-render (requires session-local cache of waves sent, seeded from BE `GET /waves/sent` on mount).

---

## 5. Notification & response flow

### 5.1 Sender side

1. A clicks Wave on B's row in Online Now.
2. FE posts message `discover:wave { login: B }` to host.
3. Host handler calls `apiClient.wave(B)`.
4. On success: post `discoverWaveResult { login: B, success: true }` to webview. Webview updates the specific row's button to `waved ✓` disabled.
5. On 403 `already_waved`: same UI as success (button shows `waved ✓`) — sender does not care whether they just waved or already waved, the outcome is identical.
6. On 403 `mutual`: refetch `chatFriends` (mutual set became fresh), re-render Discover. The row disappears from Online Now because it no longer matches the non-mutual filter.
7. On network/5xx error: toast "Couldn't wave at @B. Try again." Button returns to `can_wave` idle state.

Sender never sees a DM appear unless recipient responds.

### 5.2 Recipient side

1. BE creates wave row, fans out a notification with `type: "wave"`, `actor_login: A`, `metadata: { wave_id }`.
2. Notification arrives via the existing realtime push.
3. FE renders two surfaces (already shipped via WP10):
   - **VS Code toast** — gated by `showWaveNotifications` setting. Title: "A waved at you". Body: "Tap to say hi back".
   - **Notifications pane row** — wave-type badge (green, codicon `symbol-event`), actor name bolded, "waved at you" label, time ago, unread dot.

4. B has two outcomes:

   **(a) Respond:** B taps the wave row in the notifications pane (or clicks the toast).
   - FE detects `notif.type === "wave"` in the click handler.
   - FE calls `apiClient.waveRespond(wave_id)` (new method) which POSTs `/waves/:id/respond`.
   - BE atomically: marks wave state=`responded`, creates DM conversation A↔B (or reuses existing if one somehow exists), returns `{ conversation_id }`.
   - FE: mark notification read, navigate to the DM view with the returned conversation_id. The conversation is empty — B can type a first message or close.
   - BE pushes a `wave_responded` event back to A, who receives a normal conversation_created event (new DM appears in A's Chat Inbox, no extra UI flourish).

   **(b) Ignore:** B does nothing. The row sits in the notifications pane, eventually scrolls out of view or gets mark-all-read'd. The BE wave record stays at state=`pending` indefinitely. A's client shows the row as `waved ✓` forever; no state change, no DM, no retry.

### 5.3 Fallback if BE lacks `/waves/:id/respond`

If BE only ships `POST /waves` (send) without a response endpoint, FE can degrade:
- Tap wave noti → call `apiClient.createConversation(sender_login)` (existing endpoint).
- BE creates DM normally.
- Wave state remains `pending` on the BE side — effectively orphaned. Not ideal but functional.
- Sender never sees the wave marked "responded"; they just notice a new DM conversation appeared.

Flag this trade-off to Ryan when confirming BE scope.

---

## 6. Data model

### 6.1 New types

```ts
// src/types/index.ts
export interface WaveResponse {
  success: boolean;
  wave_id: string;
}

export interface WaveRespondResponse {
  conversation_id: string;
}
```

### 6.2 New apiClient methods

```ts
// src/api/index.ts
async wave(targetLogin: string): Promise<WaveResponse>;
async waveRespond(waveId: string): Promise<WaveRespondResponse>;
```

Both defensive-unwrap `data?.data ?? data` per existing convention.

### 6.3 Notification metadata

FE relies on `notif.metadata.wave_id` being present on `type: "wave"` notifications. If BE does not include it, the respond path degrades to the fallback (use actor_login to createConversation).

---

## 7. UI surfaces touched

| Surface | Change |
|---|---|
| **Discover → Online Now section** | Change data source from `chatFriends.filter(online)` to non-mutual online users. Update `buildDiscoverOnlineRow` to render Wave button with real state (can_wave / waving / waved / hidden-if-mutual). |
| **Profile Card stranger state** | **REMOVE** Wave button entirely. `profile-card.js::renderActions` stranger branch collapses to only Follow + View on GitHub. Remove `profileCard:wave` postMessage case from `explore.ts`. Delete `profile-card-hover.js` stranger wave branch. |
| **Notifications pane wave row** | Add tap handler: if type=wave, call waveRespond then navigate to DM. No visual change (row already renders via WP10). |
| **Settings pane — Wave toggle** | No change. Already wired via Ryan's FE-7. |

---

## 8. BE contract asks

### 8.1 Must-have

- `POST /waves` with body `{ target_login }` → `200 { success, wave_id }` or `403` with error reason `already_waved` / `mutual` / `blocked`. **Ryan confirmed shipped** per `contributors/ryan.md:23` (2026-04-13, gitchat-webapp@9264892).

### 8.2 Should-have (blocking for full flow)

- `POST /waves/:id/respond` → `200 { conversation_id }`. Creates DM atomically + marks wave responded + pushes state change to sender. Need to confirm with Ryan.

### 8.3 Should-have (blocking for Online Now)

- `GET /discover/online-now` → `200 { users: [{login, name, avatar_url, last_seen}] }`. Returns non-mutual online users. Need to confirm with Ryan. Fallback: FE uses `getPresence()` + filter locally (but needs candidate pool).

### 8.4 Nice-to-have

- `GET /waves/sent` → list of waves A has sent, for session-local cache seeding so `waved ✓` state persists across reloads. If missing, FE forgets and button shows `can_wave` on reload → user clicks again → 403 → button snaps to `waved ✓`. Ugly but functional.

---

## 9. Rate limiting

- Enforced server-side: 1 wave per (sender, target) pair per lifetime.
- FE does NOT enforce — it lets BE 403 and maps to UI `waved` state.
- No client-side store. The existing `WaveMockStore` in `profile-card-mocks.ts` is deleted entirely.
- Session cache of "waves I sent this session" lives in-memory in `explore.js` to avoid optimistic-UI flicker; cleared on reload.

---

## 10. Settings & privacy

- `showWaveNotifications` toggle already wired via WP10 FE-7. Off → no toast, but noti row still appears in pane (BE still records + delivers, FE suppresses toast only).
- No block list for waves specifically. If a user wants to never receive waves, they turn off `showWaveNotifications`. (Future: add a "strangers can't wave me" setting if abuse becomes an issue.)

---

## 11. Error reasons table

| HTTP status | Error reason (from BE) | Sender UI |
|---|---|---|
| 200 | — | Toast success, button → `waved ✓` |
| 403 | `already_waved` | Same as success — idempotent from sender POV |
| 403 | `mutual` | Refetch friends, row disappears from Online Now |
| 403 | `blocked` | Toast "Can't wave at @B" (vague on purpose), button disabled |
| 4xx other | — | Toast "Couldn't wave. Please try again." |
| 5xx / network | — | Toast "Network error. Try again." Button idle. |

---

## 12. Removed scope — what we are NOT building

- Wave Inbox screen (mode `wave-inbox` in explore). Not needed — flow is notification-driven.
- Sent Waves history list in a dedicated view. Not needed — sent waves are tracked only as UI state on the corresponding Online Now row.
- Reply/Dismiss buttons on wave notifications. Tap = respond. Untapped = ignored.
- Wave-as-pre-canned-DM model where Wave auto-creates a DM with a 👋 message. Rejected because it conflates Wave (ping) with DM (message) and breaks the "no reply = nothing happens" semantic.
- Wave variants or emoji picker.
- Wave → public feed event.

---

## 13. Test scenarios (smoke)

| # | Scenario | Expected |
|---|---|---|
| 1 | A views Online Now, no candidates | Empty state "No strangers online right now" |
| 2 | A views Online Now, sees non-mutual B | Row with Wave button enabled |
| 3 | A clicks Wave on B | Spinner briefly, button → `waved ✓`, toast "Waved at @B" |
| 4 | A clicks Wave on B again (same session) | Button stays disabled, no-op (already `waved`) |
| 5 | A reloads extension, B still online, A had waved | Row shows `waved ✓` (via `/waves/sent` cache) |
| 6 | A clicks Wave on B, network fails | Toast error, button returns to idle |
| 7 | A clicks Wave on B who became mutual in the meantime | 403 mutual, row disappears from Online Now |
| 8 | B receives wave from A, setting on | Toast "A waved at you" |
| 9 | B receives wave from A, setting off | No toast, but row in noti pane |
| 10 | B taps wave row in noti pane | DM opens, wave row marked read, A sees DM appear |
| 11 | B ignores wave row | No DM, no side effect, A's wave row stays `waved ✓` forever |
| 12 | Profile Card stranger state opened after WP8 ships | No Wave button — only Follow + View on GitHub |
| 13 | Friend appears in list (mutual) | Friend is NOT in Online Now at all (filtered out) |

---

## 14. Open questions for Ryan / BE

1. Does `POST /waves/:id/respond` exist? If no — can it be added? Contract in §8.2.
2. Does `GET /discover/online-now` exist? If no — can it be added? Contract in §8.3.
3. Does `GET /waves/sent` exist? Optional, helps UI memory.
4. What are the 403 error reason strings BE returns? `already_waved` / `mutual` / `blocked` or different?
5. Does wave notification metadata include `wave_id`? Required for the respond path.
