# Smart Notification System — Hybrid In-App + Out-of-App Delivery (Part 1)

- **Issue:** [#133](https://github.com/GitchatSH/gitchat_extension/issues/133)
- **Predecessor:** [#121](https://github.com/GitchatSH/gitchat_extension/issues/121) (investigation, closed; Option A confirmed by norwayishere + Akemi)
- **Scope of this spec:** Part 1 only — hybrid in-app toast (custom webview toast when sidebar visible + window focused, native VS Code toast as fallback). Part 2 (out-of-app awareness) deferred to a separate research spike + spec.

## Problem

Current toast implementation (`src/notifications/toast-coordinator.ts`) uses `vscode.window.showInformationMessage` with action buttons. Investigation in #121 confirmed that native VS Code toasts with action buttons are **sticky** (no auto-dismiss), and toast duration is not configurable from extension code.

This produces two concrete UX issues:

1. **In-app toast lingers too long.** When the user is active in GitChat, sticky toasts cover the chat input or message area and feel intrusive during fast conversations.
2. **No way to auto-dismiss without losing the click-to-open affordance.** Dropping action buttons makes toasts auto-dismiss, but removes the one-click "Open Chat" path — the user must click the sidebar icon and then the conversation row.

## Goals

- Short auto-dismiss (~4s) when the user is clearly present (sidebar visible + window focused)
- Full click-body-to-open affordance in that mode
- Reliable delivery (sticky native toast) when the user is away from GitChat (sidebar collapsed, window unfocused, or in a different editor tab area)
- No regression in digest/fold behavior, mute/DND guards, or own-actor suppression

## Non-goals

- Out-of-app delivery (OS notification when VS Code is backgrounded, status bar pulse, dock badge, external webhook/Telegram/email). All deferred to Part 2 research spike. See §11.
- User-tunable toast style settings (density, duration). Keep single default; revisit if users complain.
- Sound alerts.
- Toast history UI. `notificationStore` + Noti tab already own this.

## Routing decision

A new `selectRenderer(ctx)` function decides, per toast, which surface to use:

```
isOwnActor              → drop  (existing rule)
doNotDisturb            → drop  (existing rule, still hardcoded false for now)
isChatOpen (same convo) → drop  (existing rule)
isMuted + new_message   → drop  (existing rule)
─────────────────────────────────────────────────
view.visible && window.state.focused → "webview"
otherwise                            → "native"
```

Fork-editor fallback: `vscode.window.state.focused` has been observed to unset on focused interaction inside webviews in VS Code forks (Cursor, Windsurf, Antigravity — see contributor log 2026-04-15, ryan). When `focused` is `undefined`, treat as `true` (bias toward webview in-app experience).

### Case matrix

| # | Sidebar visible | Window focused | Active chat tab | Tab inside sidebar | Route |
|---|---|---|---|---|---|
| A | yes | yes | same convo | Chat | drop (existing guard) |
| B | yes | yes | different convo | Chat | webview |
| C | yes | yes | n/a | Friends / Discover / Noti | webview |
| D | yes | no | any | any | native |
| E | no | yes | n/a | n/a | native |
| F | no | no | n/a | n/a | native |

Case C confirmed: sidebar is the toast surface, independent of which tab is currently active inside it.

## Architecture

Refactor `toast-coordinator` into surface-agnostic coordinator + two renderers.

```
src/notifications/
  index.ts                  (unchanged — routes through coordinator)
  notification-store.ts     (unchanged)
  toast-rules.ts            (unchanged)
  toast-digest.ts           (unchanged — shared fold logic)
  toast-coordinator.ts      (refactor — owns queue/digest, emits ToastSpec)
  toast-renderer.ts         (new — ToastRenderer interface + selectRenderer)
  renderers/
    native-renderer.ts      (new — extract current VS Code toast code)
    webview-renderer.ts     (new — postMessage to sidebar webview)
```

### Coordinator data flow

```
realtime notification:new
  ↓
notifications/index.ts handleIncoming
  ↓ decideToast (toast-rules)
  ↓
ToastCoordinator.enqueue
  ↓ (fold / bucket logic — unchanged)
  ↓
drain loop: build ToastSpec
  ↓ selectRenderer(ctx)
  ├── webviewRenderer.show(spec) ──→ postMessage "toast:push" ──→ media/webview/toast-stack.js
  └── nativeRenderer.show(spec)  ──→ vscode.window.showInformationMessage(...)
  ↓ await Promise<ToastAction>
  ↓
coordinator handles action: openChat | openInbox | openUrl | markRead | dismiss
```

### ToastSpec

```ts
type ToastKind = "single" | "digest" | "multi-digest";

type ToastAction =
  | { kind: "openChat"; conversationId: string }
  | { kind: "openInbox" }
  | { kind: "openUrl"; url: string }
  | { kind: "markRead" }
  | { kind: "dismiss" };

interface ToastSpec {
  id: string;                  // unique; used for in-place counter update + dismiss
  kind: ToastKind;
  conversationId?: string;     // single / digest
  actorLogin?: string;
  actorName?: string;
  avatarUrl?: string;
  title: string;
  body: string;
  primary: ToastAction;        // body click = primary
  secondary?: ToastAction;     // optional second action (native mode only)
  notifIds: string[];          // for mark-read on action
}
```

### ToastRenderer interface

```ts
interface ToastRenderer {
  show(spec: ToastSpec): Promise<ToastAction>;
  // Called when coordinator wants to dismiss an in-flight toast (e.g. user opened the chat)
  dismiss(id: string): void;
  // Called when routing rules change mid-session; renderer clears queue + state
  reset(): void;
}
```

## Webview side — toast stack component

### Files

```
media/webview/toast-stack.css
media/webview/toast-stack.js        (IIFE; exposes window.ToastStack)
```

### API (webview → host, via `postMessage`)

```
host → webview:
  { type: "toast:push", spec: ToastSpec }
  { type: "toast:dismiss", id: string }
  { type: "toast:reset" }

webview → host:
  { type: "toast:action", id: string, action: ToastAction }
  { type: "toast:ready" }      // posted once on first mount
```

### Layout & visual

Position: `position: fixed`, right-aligned with 8 px inset. Top offset clears the main tab bar + any sub-header so toasts never overlap navigation (implementer measures current heights during Task 1 and writes the offset to a shared variable). Stack grows downward; newest on top. Max 3 cards; overflow pushes oldest out with fade-out.

Card structure:

```
┌─────────────────────────────────┐
│ [avatar 32]  Actor Name (+3)  ×│
│              You: "preview…"    │
└─────────────────────────────────┘
```

Dimensions: width 280 px, vertical padding 8 px, horizontal padding 12 px, gap between cards 8 px, border-radius 6 px.

CSS tokens only — no raw `--vscode-*`, no hardcoded colors, no font-size < 11 px. Reuse `.gs-avatar` for the avatar. Minimal new primitives, scoped under `.gs-toast-*`:

- `.gs-toast-stack` — fixed container
- `.gs-toast-card` — card
- `.gs-toast-title`, `.gs-toast-body` — text rows
- `.gs-toast-close` — codicon `×` button (reuse `.gs-btn-icon` primitive)

Background: `color-mix(in srgb, var(--gs-button-bg) 8%, var(--gs-bg))` (pattern confirmed for `--gs-msg-incoming` on 2026-04-14) unless a shared `--gs-bg-elevated` token already exists — implementer checks `shared.css` first.

Box shadow: `0 2px 8px rgba(0,0,0,0.3)` for depth over the content area.

### Animation

- Enter: `translateY(-8px) + opacity 0` → `translateY(0) + opacity 1`, 180 ms ease-out
- Exit: reverse, 150 ms ease-in
- Counter in-place update: no reorder, no slide — just swap the counter span and reset the 4 s timer. Rationale: users watching card A would be disoriented if it jumped to the top.
- Eviction of oldest card when stack is full: fade-out exit; remaining cards reflow via 200 ms FLIP transition
- `@media (prefers-reduced-motion: reduce)` disables slide + reflow; uses fade only

### Per-toast behavior

- Auto-dismiss timer: 4 s
- Hover: pause timer; leave: resume with remaining time
- Click card body: fire `toast:action` with `primary`, then close card
- Click `×`: fire `toast:action` with `{ kind: "dismiss" }`, close card, do not mark read
- Incoming `toast:push` with an existing `spec.id` (same conversation): update title counter + preview body in place, reset timer to 4 s

## State transitions in the stack

| Event | State change |
|---|---|
| `push` (new id, stack < 3) | Prepend card to top, start 4 s timer |
| `push` (new id, stack == 3) | Fade-out bottom card, prepend new card, start timer |
| `push` (existing id) | Update title + body in place, reset timer. No reorder. |
| `dismiss` (by id) | Fade-out that card |
| `reset` | Fade-out all cards; clear internal state |
| card timer elapses | Fade-out that card |
| sidebar becomes hidden | Host sends `toast:reset`; pending host-side queue now routes through native renderer for subsequent specs |

## Click semantics & mark-read

Identical to current coordinator behavior, preserved across both renderers:

- `single` / `digest` card body click → `openChat(conversationId)` + `notificationStore.markRead(notifIds)`
- `multi-digest` card body click → `openInbox` (opens Noti tab); mark-read deferred to the user via the "Mark All Read" button in the toast (native mode) or the Noti pane (webview mode — mark-all-read lives in pane header per 2026-04-17 slug-noti-v2)
- `×` click → dismiss only; no mark-read. The notification remains in the Noti list with an unread dot

## Error handling & edge cases

| Case | Behavior |
|---|---|
| Webview not yet mounted at session start | First toast routes to native; subsequent toasts route to webview after `toast:ready` is received |
| `postMessage` timeout (no action callback in 500 ms after dismiss) | Coordinator assumes delivered but action dropped. Notification remains in store; user can open it from Noti pane |
| `gitchat.openChat` throws | Catch, log `[Toast] openChat failed: …`, show native error message. Do not re-queue toast |
| `view.visible` toggles rapidly (sidebar quick-toggle) | Host debounces route decision by 100 ms before sending `toast:reset` to avoid flicker |
| Two toasts for same convo within 50 ms | Coordinator drain is already serialized by `activeToast`; digest fold produces a single spec |
| Webview reloads mid-session (F5 dev host / extension reload) | Stack cleared; `toast:ready` re-posts on fresh mount; host resumes routing. No toast history restoration |
| Sidebar becomes hidden while a toast is visible | Card closes via `toast:reset`; toast has been visible for ≥ some time already. No native re-show (avoids double-notify). Notification still in `notificationStore` |
| User clicks card and `×` race | First event wins; `×` calls `event.stopPropagation()` to prevent card click path |
| `vscode.window.state.focused === undefined` (fork editor) | Treat as `true` to bias toward webview. Documented in §Routing |

## Telemetry

- `log("[Toast] route=%s reason=%s spec-id=%s")` at route decision
- `log("[Toast] action=%s convo=%s")` at resolve time
- Reuse existing `log` utility; no new telemetry backend

## Testing

- **Unit (Mocha suite, `src/test/suite/`):**
  - Extract `selectRenderer(ctx)` as a pure function; add matrix test covering all 6 case-matrix rows
  - Extract stack reducer logic (push / push-same-id / push-full-stack / dismiss / reset) as a pure function in `toast-stack-state.ts`; add state-transition tests
  - `toast-digest` tests unchanged
- **Renderer mocks:** coordinator accepts renderer via constructor/setter → tests substitute a stub `{ show: jest.fn(), dismiss: jest.fn(), reset: jest.fn() }` and assert which renderer was called per context
- **Webview IIFE:** no browser test harness exists in this repo (noti v1 spec confirmed). Manual verification only, documented in QA matrix below
- **Integration:** none added — VS Code integration tests require GUI

### Manual QA matrix

| # | Scenario | Expected |
|---|---|---|
| 1 | Sidebar visible, focused, Chat tab open to convo A, incoming message in convo A | No toast (existing `isChatOpen` guard) |
| 2 | Sidebar visible, focused, Chat tab open to convo A, incoming message in convo B | Webview toast stacks at top-right |
| 3 | Sidebar visible, focused, on Friends tab, incoming message | Webview toast |
| 4 | Sidebar visible, focused, on Discover tab, incoming mention | Webview toast |
| 5 | Sidebar visible, focused, on Noti tab, incoming wave | Webview toast |
| 6 | Sidebar collapsed, focused in editor, incoming message | Native sticky toast |
| 7 | Window backgrounded to browser, incoming message | Native sticky toast |
| 8 | Burst: 4 messages across 2 conversations | Max 2 toast cards; counter on each |
| 9 | Burst: 5 concurrent conversations | 3 cards visible; oldest evicts on next push |
| 10 | Hover over toast | Timer pauses; leaving resumes |
| 11 | Click card body | Opens chat; marks notifs read |
| 12 | Click `×` | Card closes; notifs remain unread |
| 13 | Collapse sidebar while toast visible | Card closes cleanly; no native retry |
| 14 | Toggle sidebar rapidly (spam) | No flicker; no dropped toasts |
| 15 | Wave / mention types route identically to message | Same webview path |

## Rollout

Ship behind no feature flag — affects only FE surface of existing toast pipeline. Changes are additive (new renderer + refactor) and preserve all existing decision rules. Rollback: revert coordinator refactor.

## Related / Part 2 research spike

Part 2 (out-of-app awareness) deferred. Open questions that drive Part 2 design, collected here for follow-up:

1. Does `vscode.window.showInformationMessage({ modal: false })` surface as an OS system notification when VS Code is backgrounded on macOS? Windows? Linux (X11 / Wayland)?
2. Does `vscode.window.state.focused` transition correctly on fork editors (Cursor, Windsurf, Antigravity)? Ryan's log on 2026-04-15 indicates forks can drop the gate — Part 2 cannot assume it is reliable.
3. Does VS Code expose an application badge API (macOS dock badge)? Current public API surface does not appear to.
4. Can a status bar item be animated/pulsed (color flash, icon cycle) to signal out-of-sidebar activity?

Research spike scope (when it comes time):

- 1–2 engineer days
- Deliverable: comment on #133 with empirical findings per platform + proposed Part 2 surface choice
- Decision gate before writing Part 2 spec

## Out of scope

- Webhook, Telegram, or email integration (requires BE work; label `phase 3+`)
- User-tunable DND / per-type toggles — already exists in WP10 Settings (ryan, 2026-04-14), no change needed
- Audio alert
- Toast history panel
- Test harness for webview JS (no precedent in repo)

## Open questions for review

None at design approval time. All scoping / routing / visual decisions were confirmed during brainstorming session on 2026-04-20.
