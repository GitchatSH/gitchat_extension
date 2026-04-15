# BE Requirements — WP8 Wave

**Source spec:** `docs/superpowers/specs/2026-04-15-wp8-wave-design.md`
**FE plan:** `docs/superpowers/plans/2026-04-15-wp8-wave.md`
**Status:** Blocking for full feature. FE ships with documented fallbacks.
**Owner (BE):** Ryan
**Owner (FE):** nakamoto-hiru

---

## Context

Wave = low-friction ping for non-mutual online strangers in Discover → Online Now. **It is NOT a message and NOT a DM.** Sending a wave creates only a notification. A DM conversation only materializes when the recipient explicitly responds by tapping the wave notification. If the recipient ignores, nothing happens and the sender cannot retry.

Ryan already shipped `POST /waves` (waves table + routes) in `gitchat-webapp@9264892` on 2026-04-13 per `docs/contributors/ryan.md:23`. This doc covers the remaining endpoints FE needs to finish the feature.

---

## 1. `POST /waves` — confirm contract

**Status:** ✅ Believed shipped. FE needs contract confirmation.

**Ask:**
- Confirm path: `POST /waves`.
- Confirm request body: `{ target_login: string }`.
- Confirm response 200 shape: `{ success: true, wave_id: string }` (or wrapped in `{ data: {...} }` — FE handles both).
- Confirm 403 error strings:
  - `already_waved` — sender has already waved this target
  - `mutual` — sender and target are already mutual follows, should use normal DM
  - `blocked` — target has blocked sender or similar
- Confirm BE enforces 1-wave-per-(sender,target) pair lifetime limit.
- Confirm wave notification fan-out metadata includes `wave_id` (FE needs it for the respond endpoint).

**FE impact:** If any contract differs, FE defensive reads already handle common variations (`data?.data ?? data`, `wave_id ?? id`). Error string mismatches are OK — FE maps all 403s to "treat as waved ✓" terminal state from sender POV.

---

## 2. `POST /waves/:id/respond` — NEW

**Ask:** Add endpoint for the recipient to respond to a wave. This is the only way a DM gets created from a wave.

**Contract:**
- Request: `POST /waves/:id/respond`, no body (wave_id in path)
- Auth: the responding user must be the wave's target
- Response 200: `{ conversation_id: string }` — the (newly created or reused) DM conversation between sender and target
- Response 403: caller is not the target
- Response 404: wave_id not found

**Side effects:**
- Mark the wave row as `state = "responded"`
- Atomically create a DM conversation between sender and target (reuse if one already exists — shouldn't, since they're non-mutual pre-wave, but defensive)
- Mark the wave notification as read for the target
- Emit a `wave_responded` event (or a normal `conversation_created` event) to the sender so their Chat Inbox picks up the new DM

**Why atomic:** if the endpoint were just "mark responded" and FE then called `createConversation` separately, a race or failure mid-flow could leave the wave responded but no DM existing. Atomic = one trip, consistent state.

**FE strip path:** Without this endpoint, FE falls back to calling `apiClient.createConversation(sender_login)` on tap and leaves the wave row at `pending` on BE (orphaned). The user-visible flow still works but state is inconsistent. Estimated BE work: ~30 min (read wave_id, mark state, reuse existing createConversation logic, return conv_id).

---

## 3. `GET /discover/online-now` — NEW

**Ask:** Add endpoint returning non-mutual users who are currently online on GitChat. This is the data source for Discover → Online Now section.

**Contract:**
- Request: `GET /discover/online-now` with optional pagination `?limit=20&cursor=...`
- Response 200: `{ users: Array<{ login, name, avatar_url, last_seen }> }`
- Definition of candidates: users who are presence-active (heartbeat within last N minutes) AND are NOT mutual follows of the caller. Further filtering (skip blocked, skip already-waved-this-session, etc.) is BE's call.
- Sort: most recently active first, or whatever BE prefers.

**Why not client-side compose:** FE would need a candidate pool (who are "all the other online GitChat users?") which we don't have. The only "known pool" client-side is `chatFriends` which is the mutual set — exactly the wrong subset. BE must provide this.

**Current buggy state:** `media/webview/explore.js:829` sources Online Now from `chatFriends.filter(online)`, which shows only mutuals — the users for whom Wave doesn't even apply. The section is currently structurally broken.

**FE strip path:** Without this endpoint, FE ships Online Now as an empty state with note "Waves coming soon" until BE lands. Sender flow (Wave button) is functionally unreachable in production until then.

Estimated BE work: ~1-2 hours (new route, join waves + presence + mutual-follow tables, filter query).

---

## 4. `GET /waves/sent` — OPTIONAL

**Ask (nice-to-have):** Return a list of waves the caller has sent and their current state.

**Contract:**
- Request: `GET /waves/sent` with optional pagination
- Response 200: `{ waves: Array<{ wave_id, target_login, created_at, state }> }`
- `state` enum: `"pending" | "responded"` (ignored and pending are the same state from BE POV — the recipient just hasn't tapped)

**FE use:** Seed the session-local waved set on webview boot so the Online Now row for an already-waved target shows `Waved ✓` instead of a clickable Wave button. Purely UX memory — without this, first click per reload returns 403, FE snaps button to waved state. Functional but a minor blemish.

**Priority:** Low. Ship after items 2 + 3.

---

## 5. Wave notification payload

**Ask:** Confirm the wave notification fan-out includes these fields so FE can render + respond:

```json
{
  "id": "<notif_id>",
  "type": "wave",
  "actor_login": "<sender>",
  "actor_name": "<sender display name>",
  "actor_avatar_url": "...",
  "metadata": {
    "wave_id": "<wave_id>"
  },
  "created_at": "<iso>"
}
```

The critical field is `metadata.wave_id`. Without it, FE's tap-to-respond falls back to `createConversation(actor_login)` which orphans the wave state on BE.

---

## Summary table

| Item | Endpoint | Priority | Blocking |
|---|---|---|---|
| 1 | `POST /waves` | contract confirm | Already shipped |
| 2 | `POST /waves/:id/respond` | P0 | Blocks recipient conversion flow (fallback exists) |
| 3 | `GET /discover/online-now` | P0 | Blocks sender flow end-to-end (no fallback) |
| 4 | `GET /waves/sent` | P2 | Nice-to-have UX memory |
| 5 | Wave noti metadata | P0 | Blocks `/respond` path; fallback degraded |

**Minimum to unblock WP8 merge:** items 2 + 3 + 5. Item 1 just needs confirmation. Item 4 can ship later.

---

## Open questions

1. Does BE already record wave state on `POST /waves`? (needed for item 2 to update it)
2. Is there an existing `conversation_created` event FE can listen for on the sender side post-respond, or does item 2 need a new `wave_responded` event?
3. For item 3, how does BE define "online"? Heartbeat window? What TTL?
4. Is there a privacy setting (e.g. "don't show me in Online Now") that item 3 should respect? If yes, add to the filter.
