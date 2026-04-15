# WP3: Onboarding (First-time User) — Design Spec

## Overview

After first sign-in, the user sees the Discover tab with a floating welcome modal that explains the three main sections (People, Communities, Teams). Clicking the CTA dismisses the modal and marks onboarding complete. Subsequent app opens default to the Chat tab with no modal.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Overlay style | Floating center card (modal) with backdrop | Best balance for narrow sidebar (~300px): focused attention without hiding content entirely |
| Completion trigger | Click CTA button ("Start Exploring") | User is in a coding context — forcing social interaction before dismiss is annoying |
| Card content | Welcome text + 3 sections (codicon + description) + CTA | Enough context without being verbose; Discover tab empty states provide further guidance |
| Auto-redirect | One-time switch to Discover tab on first sign-in only | Minimal intervention; no persistent default-tab changes needed |
| Architecture | Webview-only (Approach 1) | Modal lives inside Discover tab — user sees real content behind backdrop, fewer files changed |

## State Management

**Flag:** `gitchat.hasCompletedOnboarding.<username>` in `context.globalState`

Per-user key ensures each account gets its own onboarding. Example: `gitchat.hasCompletedOnboarding.cairo-cmd`.

- `false`/missing (default): first-time user, show onboarding
- `true`: returning user, skip onboarding

**Flow:**
```
Sign-in success (auth/index.ts)
  → username = current authenticated user
  → globalState.get("gitchat.hasCompletedOnboarding." + username, false)
  → if false:
      focus Explore panel
      webview.postMessage({ type: "showOnboarding" })
  → if true:
      existing flow (focus Explore, default tab chat)

User clicks CTA in webview
  → vscode.postMessage({ type: "onboardingComplete" })
  → extension host: globalState.update("gitchat.hasCompletedOnboarding." + username, true)
```

**Edge cases:**
- Sign out → sign in same account → flag `true` → no modal. Correct.
- Sign out → sign in new account → flag missing → show modal. Correct.

**Dev command:** `trending.resetOnboarding` — clears the onboarding flag for the current user. Useful for testing and debugging.

## Webview Communication

Two new message types:

| Message | Direction | Payload | Purpose |
|---------|-----------|---------|---------|
| `showOnboarding` | host → webview | none | Trigger Discover tab switch + modal render |
| `onboardingComplete` | webview → host | none | Persist flag, clean up |

### Extension host side (`explore.ts`)

Add handler in `onMessage`:
```typescript
case "onboardingComplete":
  this.context.globalState.update("gitchat.hasCompletedOnboarding", true);
  break;
```

### Trigger (`auth/index.ts`, post-login block ~line 115)

For first-time users:
- Keep: `gitchat.explore.focus`
- Add: send `showOnboarding` to webview
- Remove: toast "Welcome to GitChat!" (modal replaces this)
- Remove: `gitchat.whoToFollow.focus` (People section in Discover tab covers this)

For returning users:
- Keep existing flow unchanged

### Webview side (`explore.js`)

On receiving `showOnboarding`:
1. Switch active tab to `discover`
2. Render Discover tab content
3. Inject modal overlay into DOM

## UI: Modal Overlay

### HTML structure

```html
<div id="gs-onboarding-overlay">
  <div class="gs-onboarding-card">
    <h3>Welcome to GitChat!</h3>
    <p class="gs-onboarding-subtitle">
      Discover people, communities, and teams — all inside VS Code.
    </p>
    <div class="gs-onboarding-sections">
      <div class="gs-onboarding-row">
        <span class="codicon codicon-person"></span>
        <div>
          <div class="gs-onboarding-label">People</div>
          <div class="gs-onboarding-desc">Your GitHub follows</div>
        </div>
      </div>
      <div class="gs-onboarding-row">
        <span class="codicon codicon-comment-discussion"></span>
        <div>
          <div class="gs-onboarding-label">Communities</div>
          <div class="gs-onboarding-desc">Repo-based group chats</div>
        </div>
      </div>
      <div class="gs-onboarding-row">
        <span class="codicon codicon-organization"></span>
        <div>
          <div class="gs-onboarding-label">Teams</div>
          <div class="gs-onboarding-desc">Collaborate with contributors</div>
        </div>
      </div>
    </div>
    <button class="gs-btn gs-btn-primary gs-onboarding-cta">
      Start Exploring
    </button>
  </div>
</div>
```

### CSS (`explore.css`)

```css
#gs-onboarding-overlay {
  position: absolute;
  inset: 0;
  background: var(--gs-scrim);
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--gs-inset-x);
}

.gs-onboarding-card {
  background: var(--gs-widget-bg);
  border: 1px solid var(--gs-widget-border);
  border-radius: var(--gs-radius-lg);
  padding: 20px 16px;
  text-align: center;
  width: 100%;
  max-width: 280px;
}

.gs-onboarding-card h3 {
  font-size: var(--gs-font-md);
  color: var(--gs-fg);
  margin: 0 0 8px;
}

.gs-onboarding-subtitle {
  font-size: var(--gs-font-sm);
  color: var(--gs-muted);
  line-height: 1.5;
  margin: 0 0 16px;
}

.gs-onboarding-sections {
  text-align: left;
  margin-bottom: 16px;
}

.gs-onboarding-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  border-bottom: 1px solid var(--gs-divider-muted);
}

.gs-onboarding-row:last-child {
  border-bottom: none;
}

.gs-onboarding-row .codicon {
  font-size: var(--gs-font-md);
  color: var(--gs-link);
  flex-shrink: 0;
}

.gs-onboarding-label {
  font-size: var(--gs-font-sm);
  color: var(--gs-fg);
}

.gs-onboarding-desc {
  font-size: var(--gs-font-xs);
  color: var(--gs-muted);
}

.gs-onboarding-cta {
  width: 100%;
  margin-top: 4px;
}
```

### Behavior (`explore.js`)

- CTA click → remove `#gs-onboarding-overlay` from DOM → `vscode.postMessage({ type: "onboardingComplete" })`
- No animation needed (keep it simple, respects `prefers-reduced-motion` implicitly)
- Overlay sits inside `#discover-content` wrapper, above accordion sections

## Files Changed

| File | Change |
|------|--------|
| `src/auth/index.ts` | Check onboarding flag, send `showOnboarding` message, remove toast/whoToFollow for first-time |
| `src/webviews/explore.ts` | Handle `onboardingComplete` message, persist flag |
| `media/webview/explore.js` | Handle `showOnboarding` message, render modal, switch to Discover tab, CTA dismiss logic |
| `media/webview/explore.css` | Onboarding overlay and card styles |
| `src/commands/index.ts` | Register `trending.resetOnboarding` dev command |

## Out of Scope

- Multi-step tutorial / tooltip walkthrough
- Tracking which sections user interacted with
- Re-showing onboarding after sign-out/sign-in
- Onboarding for features added after initial setup
