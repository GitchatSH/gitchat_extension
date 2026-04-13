# BE Requirements — Profile Card (WP6)

**Source spec:** `docs/superpowers/specs/2026-04-14-profile-card-design.md`
**Status:** Non-blocking. FE ships with isolated mocks; strip paths documented.

---

## 1. `on_gitchat` — add boolean to `GET /profile/:username`

**Why:** Distinguish users who have GitChat accounts from those who are mutual follows on GitHub but have not yet registered on GitChat. Drives the "not-on-gitchat" Profile Card state (shows Invite button instead of Message/Wave).

**Ask:**
- Add `on_gitchat: boolean` to the existing profile response.
- Source of truth: GitChat user table — `true` if a user row exists keyed by GitHub login, `false` otherwise.

**FE strip path:** Replace `mockOnGitchat(raw.login)` with `raw.on_gitchat` in `src/webviews/profile-card-enrich.ts`. Delete the mock function. Estimated work: 5 minutes.

---

## 2. `POST /waves` — send a wave to a non-mutual user

**Why:** WP8 Wave feature — low-friction ice-breaker for stranger-to-stranger contact inside Discover. Profile Card stranger state primary CTA depends on this endpoint.

**Contract:**
- Request: `POST /waves` with body `{ target_login: string }`
- Response 200: `{ success: true, wave_id: string }`
- Response 403: already waved at this target, or target is already a mutual follow of sender
- Rate limit: 1 wave per target per sender per lifetime
- Side effect: emit notification of type `"wave"` to the target user (handler already exists in `src/notifications/toast-rules.ts`)

**FE strip path:** Replace `waveStore.markWaved(target)` in the `profileCard:wave` handler (`src/webviews/explore.ts`) with `await apiClient.wave(target)`. Use returned `success`/`wave_id` to update `profileCardActionResult`. Handle 403 with "already waved" toast. Delete `createWaveMockStore` from `profile-card-mocks.ts`. Add `wave()` method to `apiClient`. Estimated work: 15 minutes.

---

## 3. Optional — `GET /profile/:username/mutual` (pre-computed)

**Status:** Not required. FE currently computes mutuals from GitHub API intersection with 1-hour cache. If BE later provides a pre-computed endpoint returning `{ mutual_friends, mutual_groups }`, FE can skip the intersection and read directly. This is an optimization, not a strip.
