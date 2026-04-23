# Smart Notification System — Hybrid Toast (Part 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [`docs/superpowers/specs/2026-04-20-smart-notification-hybrid-delivery-design.md`](../specs/2026-04-20-smart-notification-hybrid-delivery-design.md)

**Goal:** Refactor the current single-surface native toast pipeline into a surface-aware hybrid that renders a short auto-dismiss custom webview toast when the sidebar is visible and window is focused, and falls back to the existing native VS Code toast otherwise.

**Architecture:** Extract native rendering from `toast-coordinator` into a `NativeRenderer` class, add a new `WebviewRenderer` that postMessages a new `toast-stack.js` IIFE living in the sidebar webview, and pick between them per-toast via a pure `selectRenderer(ctx)` function. Coordinator still owns queue + digest/fold logic; renderers only own presentation.

**Tech Stack:** TypeScript (strict mode), esbuild, vanilla JS (webview), CSS with `--gs-*` design tokens, Mocha unit tests (existing `src/test/suite/`).

---

## File structure

### New files
| Path | Responsibility |
|---|---|
| `src/notifications/toast-renderer.ts` | `ToastRenderer` interface, `ToastSpec` type, `ToastAction` type, `selectRenderer(ctx)` pure function |
| `src/notifications/toast-stack-state.ts` | Pure reducer `nextStack(state, action)` for card push/dismiss/reset; pure helper `formatDigestSpec(bucket)` |
| `src/notifications/renderers/native-renderer.ts` | `NativeRenderer` — extracts the current `vscode.window.showInformationMessage` calls from coordinator |
| `src/notifications/renderers/webview-renderer.ts` | `WebviewRenderer` — postMessage wrapper + pending-action promise map |
| `src/test/suite/toast-renderer.test.ts` | Tests for `selectRenderer(ctx)` matrix |
| `src/test/suite/toast-stack-state.test.ts` | Tests for stack reducer transitions |
| `media/webview/toast-stack.css` | Toast card styles (tokens only, min 11 px font) |
| `media/webview/toast-stack.js` | IIFE exposing `window.ToastStack.{push,dismiss,reset}`; handles timer, hover, click, animation |

### Modified files
| Path | Change |
|---|---|
| `src/types/index.ts` | Re-export `ToastSpec` + `ToastAction` types for cross-module use |
| `src/notifications/toast-coordinator.ts` | Replace direct `showInformationMessage` with `renderer.show(spec)`; inject renderer via setter |
| `src/notifications/index.ts` | On module activate, build renderer pair and call `toastCoordinator.setRenderers(webview, native)` |
| `src/webviews/explore.ts` | `getHtml()` adds new `<link>`/`<script>` tags; `onMessage` handles `toast:ready` + `toast:action`; `onDidChangeVisibility` debounced → `webviewRenderer.onVisibilityChange(visible)` |

---

## Task 1: Add `ToastSpec`, `ToastAction`, `ToastRenderer` interface

**Files:**
- Create: `src/notifications/toast-renderer.ts`

- [ ] **Step 1: Create `src/notifications/toast-renderer.ts`**

```ts
// src/notifications/toast-renderer.ts

export type ToastKind = "single" | "digest" | "multi-digest";

export type ToastAction =
  | { kind: "openChat"; conversationId: string }
  | { kind: "openInbox" }
  | { kind: "openUrl"; url: string }
  | { kind: "markRead" }
  | { kind: "dismiss" };

export interface ToastSpec {
  id: string;
  kind: ToastKind;
  conversationId?: string;
  actorLogin?: string;
  actorName?: string;
  avatarUrl?: string;
  title: string;
  body: string;
  primary: ToastAction;
  secondary?: ToastAction;
  notifIds: string[];
}

export interface ToastRenderer {
  show(spec: ToastSpec): Promise<ToastAction>;
  dismiss(id: string): void;
  reset(): void;
}

export interface RouteContext {
  viewVisible: boolean;
  windowFocused: boolean | undefined;
}

export type RouteDecision = "webview" | "native";

export function selectRenderer(ctx: RouteContext): RouteDecision {
  // Fork-editor fallback: treat undefined focus as true per spec §Routing
  const focused = ctx.windowFocused ?? true;
  if (ctx.viewVisible && focused) { return "webview"; }
  return "native";
}
```

- [ ] **Step 2: Verify type check**

Run: `npm run check-types`
Expected: Pass with no errors introduced by this file.

---

## Task 2: Tests for `selectRenderer`

**Files:**
- Create: `src/test/suite/toast-renderer.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/test/suite/toast-renderer.test.ts
import * as assert from "assert";
import { selectRenderer } from "../../notifications/toast-renderer";

suite("selectRenderer", () => {
  test("visible + focused → webview", () => {
    assert.strictEqual(selectRenderer({ viewVisible: true, windowFocused: true }), "webview");
  });
  test("visible + unfocused → native", () => {
    assert.strictEqual(selectRenderer({ viewVisible: true, windowFocused: false }), "native");
  });
  test("hidden + focused → native", () => {
    assert.strictEqual(selectRenderer({ viewVisible: false, windowFocused: true }), "native");
  });
  test("hidden + unfocused → native", () => {
    assert.strictEqual(selectRenderer({ viewVisible: false, windowFocused: false }), "native");
  });
  test("fork-editor: focused === undefined treated as true", () => {
    assert.strictEqual(selectRenderer({ viewVisible: true, windowFocused: undefined }), "webview");
  });
  test("fork-editor: viewVisible===false overrides undefined focus", () => {
    assert.strictEqual(selectRenderer({ viewVisible: false, windowFocused: undefined }), "native");
  });
});
```

- [ ] **Step 2: Run test — expect fail before Task 1 was written (if running after Task 1, expect pass)**

Run: `npm run compile-tests && npx mocha out/test/suite/toast-renderer.test.js`
Expected: 6/6 passing (since Task 1 already implemented `selectRenderer`).

Note: strict TDD would reverse Tasks 1 and 2. Plan keeps them split so the interface file is landed once for downstream tasks; `selectRenderer` is trivial enough that separate Red→Green ceremony would be noise.

---

## Task 3: Pure stack state reducer

**Files:**
- Create: `src/notifications/toast-stack-state.ts`

- [ ] **Step 1: Define types + reducer**

```ts
// src/notifications/toast-stack-state.ts
import type { ToastSpec } from "./toast-renderer";

export const MAX_CARDS = 3;
export const AUTO_DISMISS_MS = 4000;

export interface StackCard {
  spec: ToastSpec;
  startedAt: number; // ms epoch, for timer calculation / hover resume
}

export interface StackState {
  cards: StackCard[]; // newest first (index 0 = top)
}

export type StackAction =
  | { kind: "push"; spec: ToastSpec; now: number }
  | { kind: "dismiss"; id: string }
  | { kind: "reset" };

export function initialStackState(): StackState {
  return { cards: [] };
}

export function nextStack(state: StackState, action: StackAction): StackState {
  switch (action.kind) {
    case "push": {
      const existing = state.cards.findIndex(c => c.spec.id === action.spec.id);
      if (existing >= 0) {
        // In-place update: replace spec, reset timer, keep position
        const updated = [...state.cards];
        updated[existing] = { spec: action.spec, startedAt: action.now };
        return { cards: updated };
      }
      // New id: prepend to top, evict bottom if overflow
      const prepended = [{ spec: action.spec, startedAt: action.now }, ...state.cards];
      if (prepended.length > MAX_CARDS) {
        return { cards: prepended.slice(0, MAX_CARDS) };
      }
      return { cards: prepended };
    }
    case "dismiss": {
      return { cards: state.cards.filter(c => c.spec.id !== action.id) };
    }
    case "reset": {
      return { cards: [] };
    }
  }
}
```

- [ ] **Step 2: Verify type check**

Run: `npm run check-types`
Expected: Pass.

---

## Task 4: Tests for stack reducer

**Files:**
- Create: `src/test/suite/toast-stack-state.test.ts`

- [ ] **Step 1: Write the tests**

```ts
// src/test/suite/toast-stack-state.test.ts
import * as assert from "assert";
import {
  initialStackState,
  nextStack,
  MAX_CARDS,
} from "../../notifications/toast-stack-state";
import type { ToastSpec } from "../../notifications/toast-renderer";

function mkSpec(id: string, title = "T", body = "B"): ToastSpec {
  return {
    id, kind: "single", title, body,
    primary: { kind: "dismiss" }, notifIds: [],
  };
}

suite("nextStack", () => {
  test("push onto empty stack prepends", () => {
    const s = nextStack(initialStackState(), { kind: "push", spec: mkSpec("a"), now: 1 });
    assert.strictEqual(s.cards.length, 1);
    assert.strictEqual(s.cards[0].spec.id, "a");
    assert.strictEqual(s.cards[0].startedAt, 1);
  });

  test("push new id prepends to top (newest first)", () => {
    let s = nextStack(initialStackState(), { kind: "push", spec: mkSpec("a"), now: 1 });
    s = nextStack(s, { kind: "push", spec: mkSpec("b"), now: 2 });
    assert.deepStrictEqual(s.cards.map(c => c.spec.id), ["b", "a"]);
  });

  test("push existing id updates in place without reordering", () => {
    let s = nextStack(initialStackState(), { kind: "push", spec: mkSpec("a", "t1"), now: 1 });
    s = nextStack(s, { kind: "push", spec: mkSpec("b"), now: 2 });
    s = nextStack(s, { kind: "push", spec: mkSpec("a", "t2"), now: 3 });
    assert.deepStrictEqual(s.cards.map(c => c.spec.id), ["b", "a"]);
    const a = s.cards.find(c => c.spec.id === "a")!;
    assert.strictEqual(a.spec.title, "t2");
    assert.strictEqual(a.startedAt, 3); // timer reset
  });

  test("push at capacity evicts oldest (bottom)", () => {
    let s = initialStackState();
    s = nextStack(s, { kind: "push", spec: mkSpec("a"), now: 1 });
    s = nextStack(s, { kind: "push", spec: mkSpec("b"), now: 2 });
    s = nextStack(s, { kind: "push", spec: mkSpec("c"), now: 3 });
    assert.strictEqual(s.cards.length, MAX_CARDS);
    s = nextStack(s, { kind: "push", spec: mkSpec("d"), now: 4 });
    assert.strictEqual(s.cards.length, MAX_CARDS);
    assert.deepStrictEqual(s.cards.map(c => c.spec.id), ["d", "c", "b"]);
  });

  test("dismiss by id removes exact card", () => {
    let s = initialStackState();
    s = nextStack(s, { kind: "push", spec: mkSpec("a"), now: 1 });
    s = nextStack(s, { kind: "push", spec: mkSpec("b"), now: 2 });
    s = nextStack(s, { kind: "dismiss", id: "a" });
    assert.deepStrictEqual(s.cards.map(c => c.spec.id), ["b"]);
  });

  test("dismiss nonexistent id is a no-op", () => {
    let s = initialStackState();
    s = nextStack(s, { kind: "push", spec: mkSpec("a"), now: 1 });
    s = nextStack(s, { kind: "dismiss", id: "zzz" });
    assert.strictEqual(s.cards.length, 1);
  });

  test("reset clears all cards", () => {
    let s = initialStackState();
    s = nextStack(s, { kind: "push", spec: mkSpec("a"), now: 1 });
    s = nextStack(s, { kind: "push", spec: mkSpec("b"), now: 2 });
    s = nextStack(s, { kind: "reset" });
    assert.strictEqual(s.cards.length, 0);
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npm run compile-tests && npx mocha out/test/suite/toast-stack-state.test.js`
Expected: 7/7 passing.

---

## Task 5: `NativeRenderer` extracted from coordinator

**Files:**
- Create: `src/notifications/renderers/native-renderer.ts`

- [ ] **Step 1: Create the renderer**

```ts
// src/notifications/renderers/native-renderer.ts
import * as vscode from "vscode";
import { log } from "../../utils";
import type { ToastAction, ToastRenderer, ToastSpec } from "../toast-renderer";

export class NativeRenderer implements ToastRenderer {
  async show(spec: ToastSpec): Promise<ToastAction> {
    const primaryLabel = labelFor(spec.primary);
    const secondaryLabel = spec.secondary ? labelFor(spec.secondary) : undefined;
    const dismissLabel = "Dismiss";

    log(`[Toast] route=native kind=${spec.kind} id=${spec.id}`);

    const message = spec.body ? `${spec.title}: ${spec.body}` : spec.title;
    const buttons: string[] = secondaryLabel
      ? [primaryLabel, secondaryLabel, dismissLabel]
      : [primaryLabel, dismissLabel];

    const picked = await vscode.window.showInformationMessage(message, ...buttons);

    if (picked === primaryLabel) { return spec.primary; }
    if (secondaryLabel && picked === secondaryLabel && spec.secondary) {
      return spec.secondary;
    }
    return { kind: "dismiss" };
  }

  dismiss(_id: string): void {
    // Native toasts cannot be dismissed programmatically by extension code.
    // Best effort: no-op.
  }

  reset(): void {
    // Same — no programmatic dismiss API.
  }
}

function labelFor(action: ToastAction): string {
  switch (action.kind) {
    case "openChat":  return "Open Chat";
    case "openInbox": return "Open Inbox";
    case "openUrl":   return "Open";
    case "markRead":  return "Mark All Read";
    case "dismiss":   return "Dismiss";
  }
}
```

- [ ] **Step 2: Verify type check**

Run: `npm run check-types`
Expected: Pass.

---

## Task 6: `WebviewRenderer` with pending-action promise map

**Files:**
- Create: `src/notifications/renderers/webview-renderer.ts`

- [ ] **Step 1: Create the renderer**

```ts
// src/notifications/renderers/webview-renderer.ts
import { log } from "../../utils";
import type { ToastAction, ToastRenderer, ToastSpec } from "../toast-renderer";

export interface WebviewPoster {
  postMessage(message: unknown): Thenable<boolean> | boolean;
}

interface Pending {
  resolve: (action: ToastAction) => void;
}

/**
 * Sends toast specs to the sidebar webview and resolves show() when the
 * webview posts back `toast:action` for that id. If the webview never
 * responds (reset, user collapses sidebar), resolves to `{kind:"dismiss"}`.
 */
export class WebviewRenderer implements ToastRenderer {
  private pending = new Map<string, Pending>();
  private ready = false;

  constructor(private readonly poster: WebviewPoster) {}

  setReady(ready: boolean): void {
    this.ready = ready;
    if (!ready) {
      // Webview gone — resolve all pending as dismiss so coordinator drains.
      this.resolveAllAsDismiss();
    }
  }

  isReady(): boolean { return this.ready; }

  show(spec: ToastSpec): Promise<ToastAction> {
    log(`[Toast] route=webview kind=${spec.kind} id=${spec.id}`);
    return new Promise<ToastAction>((resolve) => {
      this.pending.set(spec.id, { resolve });
      void this.poster.postMessage({ type: "toast:push", spec });
    });
  }

  /** Called by explore.ts onMessage handler when webview posts toast:action. */
  handleAction(id: string, action: ToastAction): void {
    const p = this.pending.get(id);
    if (!p) { return; }
    this.pending.delete(id);
    p.resolve(action);
  }

  dismiss(id: string): void {
    void this.poster.postMessage({ type: "toast:dismiss", id });
    const p = this.pending.get(id);
    if (p) {
      this.pending.delete(id);
      p.resolve({ kind: "dismiss" });
    }
  }

  reset(): void {
    void this.poster.postMessage({ type: "toast:reset" });
    this.resolveAllAsDismiss();
  }

  private resolveAllAsDismiss(): void {
    for (const [, p] of this.pending) { p.resolve({ kind: "dismiss" }); }
    this.pending.clear();
  }
}
```

- [ ] **Step 2: Verify type check**

Run: `npm run check-types`
Expected: Pass.

---

## Task 7: `toast-stack.css` — card styles

**Files:**
- Create: `media/webview/toast-stack.css`

- [ ] **Step 1: Write the CSS**

```css
/* media/webview/toast-stack.css */

.gs-toast-stack {
  position: fixed;
  top: 72px; /* clears main tab bar (~36px) + sub-header (~36px). Measure + tweak if design changes. */
  right: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 9999;
  pointer-events: none; /* Container doesn't intercept; cards do */
}

.gs-toast-card {
  width: 280px;
  padding: 8px 12px;
  border: 1px solid var(--gs-border);
  border-radius: 6px;
  background: color-mix(in srgb, var(--gs-button-bg) 8%, var(--gs-bg));
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  display: flex;
  gap: 8px;
  align-items: flex-start;
  cursor: pointer;
  pointer-events: auto;
  font-size: var(--gs-font-sm);
  opacity: 0;
  transform: translateY(-8px);
  transition: opacity 180ms ease-out, transform 180ms ease-out;
}

.gs-toast-card.gs-toast-enter {
  opacity: 1;
  transform: translateY(0);
}

.gs-toast-card.gs-toast-exit {
  opacity: 0;
  transform: translateY(-8px);
  transition: opacity 150ms ease-in, transform 150ms ease-in;
}

.gs-toast-card:hover {
  border-color: var(--gs-button-bg);
}

.gs-toast-avatar {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  overflow: hidden;
  background: var(--gs-border);
}

.gs-toast-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.gs-toast-main {
  flex: 1;
  min-width: 0;
}

.gs-toast-title {
  font-weight: 600;
  font-size: var(--gs-font-sm);
  color: var(--gs-fg);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.gs-toast-count {
  font-weight: 400;
  color: var(--gs-muted);
  margin-left: 4px;
}

.gs-toast-body {
  font-size: var(--gs-font-xs); /* must be ≥ 11px per shared.css token */
  color: var(--gs-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-top: 2px;
}

.gs-toast-close {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--gs-muted);
  cursor: pointer;
  border-radius: 3px;
}

.gs-toast-close:hover {
  background: var(--gs-border);
  color: var(--gs-fg);
}

@media (prefers-reduced-motion: reduce) {
  .gs-toast-card,
  .gs-toast-card.gs-toast-enter,
  .gs-toast-card.gs-toast-exit {
    transition: opacity 100ms linear;
    transform: none;
  }
}
```

- [ ] **Step 2: Verify `--gs-font-xs` exists and is ≥ 11px in `shared.css`**

Run: `grep "\-\-gs-font-xs" media/webview/shared.css`
Expected: A line defining `--gs-font-xs` with 11px or higher. If it is below 11px, use `--gs-font-sm` instead for the body line.

---

## Task 8: `toast-stack.js` — IIFE webview component

**Files:**
- Create: `media/webview/toast-stack.js`

- [ ] **Step 1: Write the IIFE**

```js
// media/webview/toast-stack.js
(function() {
  'use strict';

  var MAX_CARDS = 3;
  var AUTO_DISMISS_MS = 4000;

  var vscode = window._gsVsCode || (window._gsVsCode = acquireVsCodeApi());
  var container = null;
  // Map<string, { spec, el, timerId, remaining, startedAt }>
  var cards = new Map();

  function ensureContainer() {
    if (container) { return container; }
    container = document.createElement('div');
    container.className = 'gs-toast-stack';
    document.body.appendChild(container);
    return container;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function renderCard(spec) {
    var el = document.createElement('div');
    el.className = 'gs-toast-card';
    el.dataset.toastId = spec.id;

    var avatarHtml = spec.avatarUrl
      ? '<div class="gs-toast-avatar"><img alt="" src="' + escapeHtml(spec.avatarUrl) + '"></div>'
      : '<div class="gs-toast-avatar"></div>';

    var titleHtml = '<div class="gs-toast-title">'
      + escapeHtml(spec.title || '') + '</div>';
    var bodyHtml = spec.body
      ? '<div class="gs-toast-body">' + escapeHtml(spec.body) + '</div>'
      : '';

    el.innerHTML =
      avatarHtml +
      '<div class="gs-toast-main">' + titleHtml + bodyHtml + '</div>' +
      '<div class="gs-toast-close" role="button" aria-label="Dismiss">' +
        '<span class="codicon codicon-close"></span>' +
      '</div>';

    // Click card body → primary action
    el.addEventListener('click', function(e) {
      if (e.target && e.target.closest && e.target.closest('.gs-toast-close')) {
        e.stopPropagation();
        return;
      }
      postAction(spec.id, spec.primary);
      removeCard(spec.id);
    });

    // Click × → dismiss
    var closeBtn = el.querySelector('.gs-toast-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        postAction(spec.id, { kind: 'dismiss' });
        removeCard(spec.id);
      });
    }

    // Hover pause / resume
    el.addEventListener('mouseenter', function() { pauseTimer(spec.id); });
    el.addEventListener('mouseleave', function() { resumeTimer(spec.id); });

    return el;
  }

  function postAction(id, action) {
    try { vscode.postMessage({ type: 'toast:action', id: id, action: action }); }
    catch (e) { /* swallow */ }
  }

  function startTimer(id) {
    var entry = cards.get(id);
    if (!entry) { return; }
    entry.startedAt = Date.now();
    entry.timerId = setTimeout(function() { autoDismiss(id); }, entry.remaining);
  }

  function pauseTimer(id) {
    var entry = cards.get(id);
    if (!entry || entry.timerId == null) { return; }
    clearTimeout(entry.timerId);
    entry.timerId = null;
    entry.remaining = Math.max(0, entry.remaining - (Date.now() - entry.startedAt));
  }

  function resumeTimer(id) {
    var entry = cards.get(id);
    if (!entry || entry.timerId != null) { return; }
    startTimer(id);
  }

  function autoDismiss(id) {
    // Auto-dismiss does NOT fire toast:action — only explicit user action does.
    // The host treats "no response" as equivalent to dismiss via the pending map.
    removeCard(id);
  }

  function removeCard(id) {
    var entry = cards.get(id);
    if (!entry) { return; }
    if (entry.timerId != null) { clearTimeout(entry.timerId); }
    entry.el.classList.remove('gs-toast-enter');
    entry.el.classList.add('gs-toast-exit');
    cards.delete(id);
    setTimeout(function() {
      if (entry.el.parentNode) { entry.el.parentNode.removeChild(entry.el); }
    }, 160);
  }

  function push(spec) {
    ensureContainer();

    // Update-in-place for existing id
    var existing = cards.get(spec.id);
    if (existing) {
      // Re-render the contents (title + body + avatar); keep element + position.
      var tmp = renderCard(spec);
      existing.el.innerHTML = tmp.innerHTML;
      // Re-bind handlers (innerHTML wipe removed them)
      rebindCard(existing.el, spec);
      // Reset timer
      if (existing.timerId != null) { clearTimeout(existing.timerId); }
      existing.remaining = AUTO_DISMISS_MS;
      existing.spec = spec;
      startTimer(spec.id);
      return;
    }

    // Evict oldest if at cap
    if (cards.size >= MAX_CARDS) {
      // Oldest = last child in DOM (stack renders newest first at top,
      // so appended order matches newest-first; oldest is last in container).
      var firstKey = null;
      var firstEntry = null;
      cards.forEach(function(entry, key) {
        if (firstEntry == null || entry.startedAt < firstEntry.startedAt) {
          firstKey = key; firstEntry = entry;
        }
      });
      if (firstKey) { removeCard(firstKey); }
    }

    var el = renderCard(spec);
    container.insertBefore(el, container.firstChild); // newest on top
    // Trigger animation on next frame
    requestAnimationFrame(function() { el.classList.add('gs-toast-enter'); });

    cards.set(spec.id, {
      spec: spec, el: el, timerId: null,
      remaining: AUTO_DISMISS_MS, startedAt: Date.now(),
    });
    startTimer(spec.id);
  }

  function rebindCard(el, spec) {
    // Host of handleAction for an existing card updated in place.
    // Clone-and-replace approach to drop old listeners (cheapest):
    var fresh = renderCard(spec);
    el.parentNode.replaceChild(fresh, el);
    var entry = cards.get(spec.id);
    if (entry) { entry.el = fresh; }
  }

  function dismiss(id) { removeCard(id); }

  function reset() {
    var ids = Array.from(cards.keys());
    ids.forEach(function(id) { removeCard(id); });
  }

  window.ToastStack = { push: push, dismiss: dismiss, reset: reset };

  // Announce readiness after DOM is interactive
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      vscode.postMessage({ type: 'toast:ready' });
    });
  } else {
    vscode.postMessage({ type: 'toast:ready' });
  }

  // Listen for host commands
  window.addEventListener('message', function(ev) {
    var m = ev.data;
    if (!m) { return; }
    if (m.type === 'toast:push') { push(m.spec); }
    else if (m.type === 'toast:dismiss') { dismiss(m.id); }
    else if (m.type === 'toast:reset') { reset(); }
  });
})();
```

- [ ] **Step 2: Verify no syntax error**

Run: `node --check media/webview/toast-stack.js`
Expected: No output (parse success).

---

## Task 9: Load toast-stack assets into explore webview

**Files:**
- Modify: `src/webviews/explore.ts` — `getHtml()` method

- [ ] **Step 1: Identify the getHtml() method that builds `<link>` and `<script>` tags. Locate the block that appends profile-card / notifications-pane assets.**

Run: `grep -n "toast-stack\|notifications-pane\.css\|notifications-pane\.js" src/webviews/explore.ts`
Expected: Find existing lines loading `notifications-pane.css` and `notifications-pane.js`. Add the new toast-stack pair adjacent to these using the same URI conversion pattern.

- [ ] **Step 2: Add `toast-stack.css` link**

Insert next to existing `.css` tags. Pattern matches sibling asset wiring:
```ts
const toastStackCssUri = webview.asWebviewUri(
  vscode.Uri.joinPath(this.extensionUri, "media", "webview", "toast-stack.css"),
);
```
And add `<link href="${toastStackCssUri}" rel="stylesheet">` in HTML.

- [ ] **Step 3: Add `toast-stack.js` script tag**

Same pattern for the JS:
```ts
const toastStackJsUri = webview.asWebviewUri(
  vscode.Uri.joinPath(this.extensionUri, "media", "webview", "toast-stack.js"),
);
```
Script tag placed AFTER `shared.js` but anywhere in the script load order — the IIFE is independent.

- [ ] **Step 4: Verify build**

Run: `npm run compile`
Expected: Pass. Open Extension Dev Host manually — `window.ToastStack` should exist in webview devtools console, and host logs should show `toast:ready` received (after Task 10 wires up the handler).

---

## Task 10: Wire `toast:ready` and `toast:action` in explore.ts onMessage

**Files:**
- Modify: `src/webviews/explore.ts` — `onMessage` switch + new field

- [ ] **Step 1: Add `WebviewRenderer` field + getter**

In the `ExploreWebviewProvider` class fields area:
```ts
private _webviewRenderer: import("../notifications/renderers/webview-renderer").WebviewRenderer | undefined;

setWebviewRenderer(r: import("../notifications/renderers/webview-renderer").WebviewRenderer): void {
  this._webviewRenderer = r;
}
```

- [ ] **Step 2: Handle `toast:ready` in onMessage**

Add case in the switch, adjacent to existing cases:
```ts
case "toast:ready":
  this._webviewRenderer?.setReady(true);
  break;
```

- [ ] **Step 3: Handle `toast:action` in onMessage**

Add case:
```ts
case "toast:action": {
  const payload = msg as unknown as { id: string; action: import("../notifications/toast-renderer").ToastAction };
  if (payload?.id && payload?.action) {
    this._webviewRenderer?.handleAction(payload.id, payload.action);
  }
  break;
}
```

- [ ] **Step 4: On visibility change, debounce + toggle renderer ready state**

Find the existing `webviewView.onDidChangeVisibility(() => { ... })` callback (around line 229) and extend it:
```ts
// Debounce 100 ms to avoid flicker on rapid toggle
let _toastVisTimer: NodeJS.Timeout | undefined;
webviewView.onDidChangeVisibility(() => {
  if (_toastVisTimer) { clearTimeout(_toastVisTimer); }
  _toastVisTimer = setTimeout(() => {
    if (!webviewView.visible) {
      this._webviewRenderer?.setReady(false);
      this._webviewRenderer?.reset();
    }
    // Don't flip to ready=true here; wait for explicit toast:ready from webview
    // after it re-mounts (if webview was disposed on hide).
  }, 100);
});
```

- [ ] **Step 5: Verify build**

Run: `npm run compile`
Expected: Pass.

---

## Task 11: Coordinator refactor — inject renderers + build ToastSpec

**Files:**
- Modify: `src/notifications/toast-coordinator.ts` (rewrite `showOne` + `showChatDigest`)

- [ ] **Step 1: Add imports + field for renderers and context fetch**

At the top of `toast-coordinator.ts`:
```ts
import type { ToastRenderer, ToastSpec, ToastAction } from "./toast-renderer";
import { selectRenderer } from "./toast-renderer";
import { notificationStore } from "./notification-store";
```

Inside the class, add fields + setter:
```ts
private webviewRenderer: ToastRenderer | null = null;
private nativeRenderer: ToastRenderer | null = null;
private getRouteCtx: (() => { viewVisible: boolean; windowFocused: boolean | undefined }) | null = null;

setRenderers(
  webview: ToastRenderer,
  native: ToastRenderer,
  getRouteCtx: () => { viewVisible: boolean; windowFocused: boolean | undefined },
): void {
  this.webviewRenderer = webview;
  this.nativeRenderer = native;
  this.getRouteCtx = getRouteCtx;
}
```

- [ ] **Step 2: Replace `showOne()` body**

Replace the entire `showOne` method:
```ts
private async showOne(
  notification: Notification,
  title: string,
  body: string,
): Promise<void> {
  const conversationId = notification.metadata?.conversationId;
  const primary: ToastAction = conversationId
    ? { kind: "openChat", conversationId }
    : notification.metadata?.url
    ? { kind: "openUrl", url: notification.metadata.url }
    : { kind: "openInbox" };

  const spec: ToastSpec = {
    id: `single:${notification.id}`,
    kind: "single",
    conversationId,
    actorLogin: notification.actor_login,
    actorName: notification.actor_name,
    avatarUrl: notification.actor_avatar_url,
    title, body, primary,
    notifIds: [notification.id],
  };

  const action = await this.route(spec);
  await this.applyAction(action, spec);
}
```

- [ ] **Step 3: Replace `showChatDigest()` body**

```ts
private async showChatDigest(buckets: ConversationBucket[]): Promise<void> {
  if (buckets.length === 0) { return; }
  const allIds = buckets.flatMap((b) => b.notifIds);

  if (buckets.length === 1) {
    const bucket = buckets[0];
    const { title, body } = formatSingleBucketDigest(bucket);
    const spec: ToastSpec = {
      id: `digest:${bucket.conversationId}`,
      kind: "digest",
      conversationId: bucket.conversationId,
      actorLogin: bucket.actorLogin,
      actorName: bucket.actorName,
      avatarUrl: bucket.avatarUrl,
      title, body,
      primary: { kind: "openChat", conversationId: bucket.conversationId },
      notifIds: allIds,
    };
    const action = await this.route(spec);
    await this.applyAction(action, spec);
    return;
  }

  const { title, body } = formatMultiBucketDigest(buckets);
  const spec: ToastSpec = {
    id: `multi-digest:${Date.now()}`,
    kind: "multi-digest",
    title, body,
    primary: { kind: "openInbox" },
    secondary: { kind: "markRead" },
    notifIds: allIds,
  };
  const action = await this.route(spec);
  await this.applyAction(action, spec);
}
```

- [ ] **Step 4: Add `route()` + `applyAction()` helpers**

```ts
private async route(spec: ToastSpec): Promise<ToastAction> {
  if (!this.webviewRenderer || !this.nativeRenderer || !this.getRouteCtx) {
    log(`[Toast] renderers not wired — dropping spec ${spec.id}`, "warn");
    return { kind: "dismiss" };
  }
  const ctx = this.getRouteCtx();
  const decision = selectRenderer({ viewVisible: ctx.viewVisible, windowFocused: ctx.windowFocused });
  const renderer = decision === "webview" ? this.webviewRenderer : this.nativeRenderer;
  // Webview renderer drops to native if not ready
  if (decision === "webview" && !(this.webviewRenderer as unknown as { isReady(): boolean }).isReady()) {
    return this.nativeRenderer.show(spec);
  }
  return renderer.show(spec);
}

private async applyAction(action: ToastAction, spec: ToastSpec): Promise<void> {
  switch (action.kind) {
    case "openChat":
      vscode.commands.executeCommand("gitchat.openChat", action.conversationId);
      await notificationStore.markRead(spec.notifIds);
      return;
    case "openInbox":
      vscode.commands.executeCommand("gitchat.openNotifications");
      return;
    case "openUrl":
      vscode.env.openExternal(vscode.Uri.parse(action.url));
      await notificationStore.markRead(spec.notifIds);
      return;
    case "markRead":
      await notificationStore.markRead(spec.notifIds);
      return;
    case "dismiss":
      return;
  }
}
```

- [ ] **Step 5: Remove now-dead imports (if `vscode.window.showInformationMessage` is no longer called directly in this file)**

Run: `grep -n "showInformationMessage" src/notifications/toast-coordinator.ts`
Expected: No matches. If any remain, remove them.

- [ ] **Step 6: Verify build**

Run: `npm run compile`
Expected: Pass. New unit tests (`toast-renderer.test.ts`, `toast-stack-state.test.ts`) still pass.

---

## Task 12: Wire renderers in `src/notifications/index.ts`

**Files:**
- Modify: `src/notifications/index.ts`

- [ ] **Step 1: Import renderers + coordinator setter**

```ts
import { NativeRenderer } from "./renderers/native-renderer";
import { WebviewRenderer } from "./renderers/webview-renderer";
```

- [ ] **Step 2: In `activate(context)`, build renderers + wire coordinator**

Add near the top of `activate`:
```ts
// Build renderer pair + route-context provider; inject into coordinator.
const native = new NativeRenderer();
// Lazy-load explore provider reference — it activates in a different module
// and may not be ready at this exact moment, so defer via getter.
let webview: WebviewRenderer | null = null;
const getWebviewRenderer = (): WebviewRenderer => {
  if (!webview) {
    // Poster indirection: explore provider exposes .view.webview only after activation
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { exploreWebviewProvider } = require("../webviews/explore") as typeof import("../webviews/explore");
    webview = new WebviewRenderer({
      postMessage: (msg) => {
        const w = exploreWebviewProvider?.view?.webview;
        if (!w) { return false; }
        return w.postMessage(msg);
      },
    });
    exploreWebviewProvider?.setWebviewRenderer(webview);
  }
  return webview;
};

toastCoordinator.setRenderers(
  getWebviewRenderer(),
  native,
  () => {
    const { exploreWebviewProvider } = require("../webviews/explore") as typeof import("../webviews/explore");
    return {
      viewVisible: exploreWebviewProvider?.view?.visible ?? false,
      windowFocused: vscode.window.state.focused,
    };
  },
);
```

- [ ] **Step 3: Verify build**

Run: `npm run compile`
Expected: Pass.

- [ ] **Step 4: Smoke-check in Extension Dev Host**

Launch via F5. Sign in. Check DevTools for sidebar webview: `window.ToastStack` is defined. Host output channel: `[Toast] route=... reason=...` starts appearing when notifications arrive.

---

## Task 13: Manual QA matrix + final polish

**Files:**
- Verify: 15-row QA matrix from spec §Testing

- [ ] **Step 1: Run full build + tests**

Run: `npm run compile && npm run compile-tests && npx mocha out/test/suite/toast-renderer.test.js out/test/suite/toast-stack-state.test.js`
Expected: 0 errors, all new tests pass.

- [ ] **Step 2: Walk through QA matrix in Extension Dev Host**

For each row of the 15-row matrix in `docs/superpowers/specs/2026-04-20-smart-notification-hybrid-delivery-design.md` §Testing, execute the scenario and confirm expected behavior. Record any discrepancies as follow-up tasks.

- [ ] **Step 3: If any QA row fails, create a new task in this plan with the exact repro + proposed fix; do not silently patch**

- [ ] **Step 4: Update `docs/contributors/nakamoto-hiru.md`** with current status (branch, what was shipped) + a single-line decision entry summarizing the hybrid toast ship.

- [ ] **Step 5: Commit everything as a batched feature commit**

```bash
git add src/notifications/ src/webviews/explore.ts src/types/index.ts \
        src/test/suite/toast-renderer.test.ts src/test/suite/toast-stack-state.test.ts \
        media/webview/toast-stack.css media/webview/toast-stack.js \
        docs/superpowers/specs/2026-04-20-smart-notification-hybrid-delivery-design.md \
        docs/superpowers/plans/2026-04-20-smart-notification-hybrid-delivery.md \
        docs/contributors/nakamoto-hiru.md
git commit -m "feat(notifications): hybrid in-app webview toast + native fallback (#133)

- New ToastRenderer interface + selectRenderer(ctx) routing
- NativeRenderer (extracted) + WebviewRenderer (new)
- toast-stack.{js,css} component in media/webview
- Coordinator refactored to emit ToastSpec and route via selectRenderer

Closes part 1 of #133. Part 2 (out-of-app) remains a research spike."
```

Per session rule from anh Hiếu (2026-04-20), commit is a single batched commit for the whole feature at the end — no intermediate commits during spec/plan drafting.

---

## Self-review

Checked against spec sections:

- §Routing decision → Task 1 (`selectRenderer`) + Task 2 (tests) ✅
- §Case matrix (A–F) → Task 2 tests cover all 6 ✅
- §Architecture file tree → Tasks 1/3/5/6/7/8 ✅
- §Coordinator data flow → Task 11 ✅
- §ToastSpec + ToastRenderer interface → Task 1 ✅
- §Webview side postMessage API → Tasks 8 + 10 ✅
- §Layout & visual (280px, right-aligned, top-offset) → Task 7 ✅
- §Animation (slide+fade, prefers-reduced-motion) → Task 7 ✅
- §Per-toast behavior (4s timer, hover pause, × dismiss, click body) → Task 8 ✅
- §State transitions (push-new, push-existing, evict, dismiss, reset) → Tasks 3/4 + Task 8 ✅
- §Click semantics & mark-read → Task 11 `applyAction` ✅
- §Error handling edge cases → Tasks 6, 10, 11 ✅
- §Telemetry log lines → Tasks 5, 6, 11 ✅
- §Manual QA matrix → Task 13 ✅
- §Part 2 research spike → Not in plan scope (deferred per spec) ✅

Type consistency:
- `ToastSpec.id`, `ToastSpec.notifIds`, `ToastAction` variants consistent across Tasks 1, 3, 6, 8, 11 ✅
- `selectRenderer` signature matches call in Task 11 ✅
- `WebviewRenderer.setReady()` / `isReady()` / `handleAction()` all referenced at call sites (Task 10, Task 11) ✅

No placeholder sentences. No "implement later". All code blocks complete.

---

## Notes for executor

- Commits: this plan batches everything into a single commit at Task 13 Step 5 per current session rule. Future sessions may override this with per-task commits.
- Semgrep hook: the repo has a `semgrep mcp -k post-tool-cli-scan` PostToolUse hook that fails without `SEMGREP_APP_TOKEN`. It does not block writes — files land despite the "blocking" error in hook output. Ignore.
- Running tests: `npm test` boots VS Code test host and requires GUI. For pure-logic tests only (our new suites are pure), use `npm run compile-tests && npx mocha out/test/suite/<file>.test.js` instead — faster, headless, sufficient.
