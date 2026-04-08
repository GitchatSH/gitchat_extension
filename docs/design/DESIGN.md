# Gitstar Extension — Design Guidelines

> UI/UX guidelines for the VS Code extension. All UI changes must follow this document.

---

## 1. Core Principles

1. **Blend into the IDE** — The extension must look like a native part of VS Code, not an embedded web app
2. **Theme-aware** — Must work across Dark, Light, and High Contrast themes
3. **Sidebar-first** — Sidebar is ~300px wide; all layouts must fit in narrow space
4. **Performance** — Webviews consume memory; avoid heavy animations, lazy load data
5. **Accessible** — Keyboard navigation, focus indicators, screen reader support

---

## 2. Design Tokens

All UI **MUST** use `--gs-*` tokens from `shared.css`. **DO NOT** use `--vscode-*` directly in view CSS.

### Colors

```css
/* Text */
--gs-fg                    /* primary text */
--gs-muted                 /* secondary/description text */
--gs-link                  /* links, interactive text */
--gs-error                 /* error text */
--gs-success               /* success, online status (#4ade80 fallback) */

/* Backgrounds */
--gs-bg                    /* primary background */
--gs-bg-secondary          /* cards, sidebar, elevated surfaces */
--gs-hover                 /* hover state */
--gs-active                /* active/selected state */

/* Borders */
--gs-border                /* card/container borders */
--gs-divider               /* section dividers (thinner) */

/* Inputs */
--gs-input-bg / --gs-input-fg / --gs-input-border

/* Buttons */
--gs-button-bg / --gs-button-fg               /* primary */
--gs-button-secondary-bg / --gs-button-secondary-fg  /* secondary */

/* Badges */
--gs-badge-bg / --gs-badge-fg
```

**Never hardcode colors.** If a new semantic color is needed (warning, info...), add a token to `shared.css` `:root` with a `--vscode-*` fallback.

### Typography

```css
--gs-font-xs:   11px   /* labels, captions, timestamps */
--gs-font-sm:   12px   /* secondary text, small buttons */
--gs-font-base: 13px   /* body text, inputs (VS Code default) */
--gs-font-md:   14px   /* subheadings, emphasized text */
--gs-font-lg:   18px   /* headings */
--gs-font-xl:   22px   /* page titles (rarely used) */
```

- **Minimum allowed font size: `11px`** (`--gs-font-xs`). Never use `9px` or `10px`
- Always use `font-family: inherit` (inherits from VS Code)
- Line-height: `1.4` (set in body)

### Spacing (4px grid)

```
4px   — icon gap, inline spacing
8px   — compact padding, small gaps
12px  — standard padding, list item gaps
16px  — section padding
20px  — page padding (editor panels)
24px  — section spacing
32px  — large spacing (empty states)
```

### Border Radius

```css
--gs-radius-xs:   2px    /* VS Code native feel — inputs, small elements */
--gs-radius-sm:   4px    /* buttons, list items, inputs (DEFAULT) */
--gs-radius:      8px    /* cards, containers */
--gs-radius-lg:   12px   /* large cards, panels (use sparingly) */
--gs-radius-pill: 20px   /* pills, tags, chat bubbles */
--gs-radius-full: 9999px /* avatars, dots, badges */
```

**Note:** VS Code native uses radius `2-4px`. Radius `12px+` should only be used for chat bubbles, not regular buttons/cards.

### Shadows

```css
--gs-shadow-sm: 0 2px 8px rgba(0,0,0,0.15)    /* dropdowns, tooltips */
--gs-shadow-md: 0 4px 12px rgba(0,0,0,0.2)     /* hover cards, modals */
--gs-shadow-lg: 0 8px 16px rgba(0,0,0,0.25)    /* lightbox, overlays */
```

VS Code rarely uses shadows. Only use them for overlays/dropdowns.

### Animations

```css
--gs-duration: 0.15s   /* default transition */
```

- Use `transition: property var(--gs-duration) ease` for hover/focus
- Keyframe animations only for typing indicators, loading spinners
- **Must** wrap animations in `@media (prefers-reduced-motion: reduce)` to disable

---

## 3. Components (from shared.css)

### Buttons — ONLY use `.gs-btn`

```html
<!-- Primary action -->
<button class="gs-btn gs-btn-primary">Sign In</button>

<!-- Secondary action -->
<button class="gs-btn gs-btn-secondary">Cancel</button>

<!-- Ghost/subtle -->
<button class="gs-btn gs-btn-ghost">View More</button>

<!-- Icon button -->
<button class="gs-btn-icon"><i class="codicon codicon-refresh"></i></button>

<!-- Large variant -->
<button class="gs-btn gs-btn-primary gs-btn-lg">Get Started</button>
```

**DO NOT** create `.pf-btn`, `.rd-btn`, or custom button styles in view CSS.

### Avatars

```html
<img class="gs-avatar gs-avatar-sm" src="..." />  <!-- 24px — inline, lists -->
<img class="gs-avatar gs-avatar-md" src="..." />  <!-- 36px — list items -->
<img class="gs-avatar gs-avatar-lg" src="..." />  <!-- 48px — cards, headers -->
<img class="gs-avatar gs-avatar-xl" src="..." />  <!-- 64px — profile pages -->
```

For larger avatars (profile hero), use `gs-avatar-xl` + custom size in view CSS, but **never exceed 80px** in sidebar.

### Inputs

```html
<input class="gs-input" placeholder="Search..." />
```

### List Items

```html
<div class="gs-list-item">
  <img class="gs-avatar gs-avatar-md" />
  <div class="gs-flex-1 gs-truncate">
    <div>Name</div>
    <div class="gs-text-xs gs-text-muted">Description</div>
  </div>
</div>
```

### Cards

```html
<div class="gs-card">
  <div class="gs-card-title">Section Title</div>
  <!-- content -->
</div>
```

### Empty States

```html
<div class="gs-empty">
  <i class="codicon codicon-inbox" style="font-size: 32px; margin-bottom: 8px;"></i>
  <div>No messages yet</div>
  <div class="gs-text-xs" style="margin-top: 4px;">Start a conversation!</div>
</div>
```

### Badges

```html
<span class="gs-badge">5</span>
```

### Status Dots

```html
<span class="gs-dot-online"></span>  <!-- #4ade80 — online -->
<span class="gs-dot-offline"></span> <!-- muted — offline -->
```

**Always** use `.gs-dot-online` for online status. DO NOT hardcode `#3fb950` or any other green.

---

## 4. Icons — Codicons Only

Use [VS Code Codicons](https://microsoft.github.io/vscode-codicons/dist/codicon.html):

```html
<i class="codicon codicon-flame"></i>      <!-- trending -->
<i class="codicon codicon-person"></i>     <!-- user -->
<i class="codicon codicon-star-full"></i>  <!-- starred -->
<i class="codicon codicon-star-empty"></i> <!-- not starred -->
<i class="codicon codicon-comment-discussion"></i> <!-- chat -->
<i class="codicon codicon-bell"></i>       <!-- notifications -->
<i class="codicon codicon-search"></i>     <!-- search -->
<i class="codicon codicon-refresh"></i>    <!-- refresh -->
<i class="codicon codicon-link-external"></i> <!-- external link -->
```

Do not add external icon libraries. Do not use inline SVGs except for logo/branding.

---

## 5. Layout Rules

### Sidebar Views (~300px width)

```
┌─────────────────────────────┐
│ Header (sticky)        [⟳] │  ← gs-header, 10px 12px padding
├─────────────────────────────┤
│ Filter/Tabs (optional)      │  ← sticky below header if needed
├─────────────────────────────┤
│                             │
│  Scrollable content         │  ← flex: 1, overflow-y: auto
│  - List items               │
│  - Cards                    │
│                             │
├─────────────────────────────┤
│ Input/Action bar (sticky)   │  ← at bottom if needed
└─────────────────────────────┘
```

- Always **single column** — never 2 columns in sidebar
- Truncate long text — `gs-truncate`
- Horizontal padding: `12px`

### Editor Panels (profile, repo-detail, chat)

```
┌──────────────────────────────────────┐
│ Header (sticky)               [✕]   │
├──────────────────────────────────────┤
│                                      │
│  Content (max-width: 720px, center)  │
│  - Can use 2 columns if needed      │
│  - Padding: 16-20px                 │
│                                      │
├──────────────────────────────────────┤
│ Footer/Input (sticky, if needed)     │
└──────────────────────────────────────┘
```

---

## 6. Required UX Patterns

### Loading States

Every view **MUST** have a loading state when fetching data:

```html
<!-- Option 1: Simple spinner -->
<div class="gs-loading">
  <i class="codicon codicon-loading codicon-modifier-spin"></i>
</div>

<!-- Option 2: Text -->
<div class="gs-loading">Loading...</div>
```

### Error States

```html
<div class="gs-empty">
  <i class="codicon codicon-error" style="font-size: 32px; color: var(--gs-error);"></i>
  <div style="margin-top: 8px;">Something went wrong</div>
  <button class="gs-btn gs-btn-secondary" style="margin-top: 12px;">Retry</button>
</div>
```

### Empty States

Every view must have an empty state with icon + description + CTA (if actionable).

### Confirmations

Use VS Code native dialogs via postMessage. **DO NOT** use `prompt()`, `confirm()`, or `alert()`.

---

## 7. Accessibility Checklist

- [ ] All interactive elements are focusable via Tab
- [ ] Focus visible indicators (using `outline` or `border`)
- [ ] `aria-label` on icon buttons
- [ ] Never use color alone to convey information — add text/icon
- [ ] Font size >= 11px
- [ ] `@media (prefers-reduced-motion: reduce)` disables animations
- [ ] High Contrast theme does not break layout

---

## 8. File Organization

### Correct structure

```
media/webview/
├── shared.css          ← Design tokens + base components (SOURCE OF TRUTH)
├── shared.js           ← Shared utilities (escapeHtml, timeAgo, doAction...)
├── explore.css/js      ← Unified Explore panel (Chat | Feed | Trending tabs)
├── chat.css/js         ← Chat conversation view
├── chat-panel.css/js   ← Sidebar: Friends + Inbox tabs
├── feed.css/js         ← For You feed
├── welcome.css/js      ← Welcome/sign-in page
├── profile.css/js      ← User profile (editor panel)
├── repo-detail.css/js  ← Repo detail (editor panel)
├── who-to-follow.css/js ← Follow suggestions
├── notifications.css/js ← Notifications
├── codicon.css/ttf     ← VS Code icon font (vendor, do not modify)
```

### Rules

1. **All view CSS must use `--gs-*` tokens** — do not use `--vscode-*` directly
2. **No duplicate utilities** — `escapeHtml`, `formatCount`, `timeAgo` only in `shared.js`
3. **No custom button classes** — extend `.gs-btn` variants
4. If a new component is used in 2+ views → add it to `shared.css`
5. CSS files < 10 lines → merge into `shared.css` or the relevant view CSS

---

## 9. Known Issues to Fix

### Critical
- [ ] `repo-detail.js`: `sanitizeReadme()` uses regex — replace with DOMPurify
- [ ] `chat.css`, `welcome.css`, `profile.css`, `repo-detail.css` do not use `--gs-*` tokens

### High
- [ ] 4 different button systems (`gs-btn`, `pf-btn`, `rd-btn`, chat pills) → unify to `gs-btn`
- [ ] Duplicate code: `inbox.js/css`, `friends.js/css` → remove (already merged into `chat-panel`)
- [ ] `escapeHtml`/`formatCount` redefined in `profile.js`, `repo-detail.js`, `chat.js`
- [ ] Online dot color: `#3fb950` (chat) vs `#4ade80` (shared) → use `--gs-success`

### Medium
- [ ] `chat.js` monolith 1287 LOC → split into modules
- [ ] Missing loading states in most views
- [ ] `prompt()` for message editing in chat → inline edit
- [ ] Missing `prefers-reduced-motion`
- [ ] Welcome stats hardcoded (`15K+`, `2.8K`, `50K+`)

### Low
- [ ] `main.css` (2 lines) → merge into `shared.css`
- [ ] Padding inconsistency: `.conv-item` `8px 12px` vs `10px 12px`
- [ ] `line-height` `1.5` (main) vs `1.4` (shared)
