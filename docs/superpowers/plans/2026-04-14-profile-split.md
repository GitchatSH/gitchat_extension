# Plan — Split Profile into Profile Card (popup) + Profile Screen (full)

**Status:** Draft — awaiting approval before implementation.
**Goal:** Clarify the two-tier profile UX so each view has a single purpose:
- **Profile Card** (popup overlay) — fast peek, identity + key stats + primary actions. Already shipped in WP6.
- **Profile Screen** (dedicated view) — deep view with full profile info, activity, repos, groups, and management actions.

**Non-goal:** This plan does NOT redesign the Profile Card. That's shipped. It ONLY carves out a clean Profile Screen and wires "See more" from card → screen.

---

## Motivation

Right now `ProfilePanel` (editor webview, `src/webviews/profile.ts`) is the legacy full-profile view and still opens when code hits `gitchat.viewMyProfile` / `gitchat.viewProfile` commands. The Profile Card overlay (WP6) covers peek-level needs but has no drill-down path to a full screen. Two problems:

1. **No "See more" affordance from the card** — users who want to see all of someone's repos, activity, or full bio have no entry point.
2. **ProfilePanel is stale** — built for the editor-tab era, doesn't follow current design tokens, doesn't share layout primitives with the sidebar, and its URL/routing story is tangled with the card.

The fix is a clean split:
- Card stays a popup. It's what you get from every avatar click, every `@mention`, every friends row.
- Screen is what you get from **clicking inside the card** (e.g., "See full profile") or from a deliberate command. It renders in a **dedicated sidebar tab**, not an editor webview panel, so it blends with the rest of the GitChat UX.

---

## Scope

**In scope (v1):**
- A new Profile Screen rendered as a **dedicated sidebar view** (not editor panel), reusing the Explore webview infrastructure.
- A "See full profile" entry point in the Profile Card (eligible + stranger + not-on-gitchat states — skip for self since user menu already has other affordances).
- Migration of `gitchat.viewProfile` command to open Profile Screen instead of the legacy ProfilePanel.
- Retire `ProfilePanel` (`src/webviews/profile.ts`, `media/webview/profile.js`, `media/webview/profile.css`) once Profile Screen reaches feature parity.

**Out of scope (defer):**
- New data fields beyond what Profile Card already has (bio, stats, top repos, mutual).
- Activity feed integration (separate WP).
- Edit profile inline (still routes to GitHub for v1).

---

## Architectural decision

**Option A — New sidebar view inside the existing Explore webview**
- Add a 4th "mode" to `explore.ts` — when triggered, Explore tabs are hidden and a full-screen Profile Screen takes over the sidebar. Close button returns to the previous tab.
- Pros: no new webview provider, shares all tokens/assets/routing, state stays in one place, postMessage plumbing already wired.
- Cons: explore.ts gets bigger; mode management needs care.

**Option B — Separate webview provider**
- New `src/webviews/profile-screen.ts` as its own `WebviewViewProvider`, registered as a secondary sidebar view.
- Pros: clean separation; can be opened alongside Explore.
- Cons: VS Code's secondary sidebar API is limited (can't programmatically place views); doubles the postMessage boilerplate; another asset URI setup.

**Option C — Render inside chat-panel.ts (editor webview)**
- Full-screen editor webview like the current ProfilePanel.
- Pros: more screen real estate.
- Cons: breaks the "blend into sidebar" principle from DESIGN.md; users in DM flow get context-switched.

**Recommendation: Option A** — Profile Screen is a first-class route inside the Explore webview, same as Chat/Feed/Trending tabs. It's a fourth "tab" that's hidden from the tab bar but reachable via postMessage.

---

## File layout

**Created:**
| Path | Responsibility |
|---|---|
| `media/webview/profile-screen.js` | Profile Screen renderer IIFE, exposes `window.ProfileScreen.open(login)` / `.close()` |
| `media/webview/profile-screen.css` | `.gs-ps-*` styles |
| `src/webviews/profile-screen-fetch.ts` | Host-side data fetch — reuses `apiClient.getUserProfile` + the BE unwrap, returns a fuller `ProfileScreenData` than the card |

**Modified:**
| Path | Change |
|---|---|
| `src/types/index.ts` | Add `ProfileScreenData` (extends ProfileCardData + `activity?`, `all_repos`, `organizations`, `pinned_repos`) |
| `src/webviews/explore.ts` | Add `profileScreen:open`/`profileScreen:fetch`/`profileScreen:close` postMessage cases. Wire the `gitchat.viewProfile` / `gitchat.viewMyProfile` commands to instead call `profileScreen:open` on the Explore webview. |
| `media/webview/explore.js` | Listen for `profileScreenOpen` host→client messages. Hide tab bar + tab content, mount Profile Screen container. Back button restores previous tab. |
| `media/webview/profile-card.js` | Add "See full profile" link inside the card (eligible + stranger + not-on-gitchat). On click, `window.ProfileScreen.open(login)` + card closes. |

**Retired (deferred to a later commit once screen reaches parity):**
| Path | Fate |
|---|---|
| `src/webviews/profile.ts` | Delete |
| `media/webview/profile.js` | Delete |
| `media/webview/profile.css` | Delete |
| `gitchat.viewMyProfile` / `gitchat.viewProfile` command handlers in `src/commands/index.ts` | Point to Profile Screen instead of ProfilePanel |

---

## Tasks

### Task 1 — Scaffold Profile Screen files + types
- Create `profile-screen.js` / `.css` stubs.
- Create `profile-screen-fetch.ts` stub that returns a `ProfileScreenData` matching `ProfileCardData` for now (no extra fields yet).
- Add `ProfileScreenData extends ProfileCardData` to `src/types/index.ts`.
- Wire the new JS/CSS into the Explore webview HTML template.
- Commit.

### Task 2 — Host postMessage router for Profile Screen
- `profileScreen:open` — host fetches via `profileScreenFetch`, posts back `profileScreenData`.
- `profileScreen:close` — no-op on host side; purely a client-side state change, but useful for telemetry.
- Commit.

### Task 3 — Profile Screen renderer (profile-screen.js)
- IIFE exposes `window.ProfileScreen.open(login)`, `.close()`, `.isOpen()`.
- Renders: header (avatar/name/handle/bio), stats row, mutual block, **all** top repos (not just 3), organizations list, primary actions (Message/Follow/Wave), secondary actions (View on GitHub), back button.
- State: fetches on open, shows skeleton, renders on response.
- Commit.

### Task 4 — Profile Screen styles (profile-screen.css)
- `.gs-ps-*` scope, `--gs-*` tokens, full-viewport layout (takes over the sidebar panel body).
- Respects `--gs-inset-x`, 4px grid, min font 11px.
- Back button styled as a left-aligned chevron + "Back" label, VS Code native feel.
- Commit.

### Task 5 — Explore tab-bar hide/show wiring
- `media/webview/explore.js`:
  - Expose a `showProfileScreen(login)` helper that (1) hides `.explore-tab-bar` + active tab content, (2) calls `window.ProfileScreen.open(login)`.
  - On Profile Screen close, restore the previously active tab (cache the tab id before hiding).
- Commit.

### Task 6 — "See full profile" link in Profile Card
- `media/webview/profile-card.js`:
  - In `renderActions`, for states `eligible` / `stranger` / `not-on-gitchat`, append a "See full profile →" text link below the GitHub link.
  - Handler: `window.ProfileCard.close()` then `window.ProfileScreen.open(login)`.
- Commit.

### Task 7 — Migrate commands off ProfilePanel
- `src/commands/index.ts`: `gitchat.viewMyProfile` and `gitchat.viewProfile` no longer call `ProfilePanel.show()`. Instead, they post `profileScreen:open` to the Explore webview (or if Explore isn't visible, reveal it first).
- Verify every caller of those commands still works (grep for `viewMyProfile`, `viewProfile`).
- Commit.

### Task 8 — Manual smoke test
- Spec §12-style matrix: card → "See full profile" link → screen loads for eligible/stranger/not-on-gitchat; back button restores tab; refresh doesn't lose state.
- `gitchat.viewProfile` from command palette opens Profile Screen.
- Legacy ProfilePanel no longer reachable.
- Commit any hotfixes.

### Task 9 — Retire ProfilePanel
- Delete `src/webviews/profile.ts`, `media/webview/profile.js`, `media/webview/profile.css`.
- Remove imports + registration from `src/extension.ts`.
- `npm run compile` clean.
- Commit.

### Task 10 — Docs
- Update `docs/design/UI-PATTERNS.md` with Profile Screen section (layout, token usage, state).
- Append decisions entry to `docs/contributors/nakamoto-hiru.md`.
- Commit.

---

## Open questions (resolve before Task 1)

1. **Back button behavior on refresh:** if the webview reloads while Profile Screen is active, does it restore screen or bounce to last tab? Suggest: bounce to last tab (simpler, no state persistence).
2. **"See full profile" copy:** Options are "See full profile" vs icon-only — follow existing Profile Card copy which is English.
3. **Data fetch for screen:** reuse `apiClient.getUserProfile` + the BE unwrap pattern; when BE ships a richer endpoint (e.g., `GET /user/:login/full`), we swap `profile-screen-fetch.ts` internals. Document strip path in BE requirements doc.
4. **Mobile/narrow sidebar:** at <260px, does the screen switch to a column layout like the card does? Suggest: yes, single column, same `@media` breakpoint.
5. **Editor ProfilePanel users:** anyone depending on the editor-tab ProfilePanel (e.g., keybindings, other WPs)? Grep for ProfilePanel references before Task 9.

---

## Dependencies

- **Profile Card (WP6)** — already shipped. This plan assumes `ProfileCardData`, `enrichProfile`, and all triggers are live.
- **Explore webview tab infrastructure** — already handles Chat/Feed/Trending switching; Profile Screen reuses the same pattern.

## Non-dependencies

- No BE changes required for v1. When BE ships a richer profile endpoint later, Profile Screen can consume it via a one-line swap in `profile-screen-fetch.ts`.

---

## Estimated effort

~1 day for all 10 tasks, similar ceremony to WP6 Profile Card (which took ~1 session). Can be split across two sessions if needed:
- Session 1: Tasks 1–5 (scaffold, host, renderer, styles, tab hide/show) — Profile Screen functional end-to-end.
- Session 2: Tasks 6–10 ("See more" link, command migration, smoke, retirement, docs).
