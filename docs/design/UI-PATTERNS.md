# UI Patterns Reference

> Quick reference for all shared UI components in `shared.css`. Use these classes — do NOT create custom variants in view CSS.

---

## Buttons — `.gs-btn`

| Class | Height | Padding | Font | Radius | Use |
|-------|--------|---------|------|--------|-----|
| `.gs-btn.gs-btn-primary` | auto | 4px 12px | 12px | 4px | Primary actions (Sign In, Follow) |
| `.gs-btn.gs-btn-secondary` | auto | 4px 12px | 12px | 4px | Secondary actions (Cancel, Dismiss) |
| `.gs-btn.gs-btn-ghost` | auto | 4px 12px | 12px | 4px | Subtle actions (View More) |
| `.gs-btn.gs-btn-lg` | auto | 6px 16px | 13px 500w | 4px | Large CTA buttons |
| `.gs-btn-icon` | 28px | 0 | 16px | 4px | Icon-only buttons (refresh, close) |

```html
<button class="gs-btn gs-btn-primary">Sign In</button>
<button class="gs-btn gs-btn-secondary">Cancel</button>
<button class="gs-btn gs-btn-ghost">View More</button>
<button class="gs-btn gs-btn-primary gs-btn-lg">Get Started</button>
<button class="gs-btn-icon"><span class="codicon codicon-refresh"></span></button>
```

---

## Chips — `.gs-chip`

| Property | Value |
|----------|-------|
| Height | **22px** (fixed) |
| Padding | 0 8px |
| Font size | 10px |
| Border | 1px solid `--gs-border` |
| Radius | 12px (`--gs-radius-lg`) |
| Gap (icon) | 3px |
| Active | bg: `--gs-button-bg`, color: `--gs-button-fg` |

```html
<!-- Text only -->
<button class="gs-chip active" data-filter="all">All</button>

<!-- With icon -->
<button class="gs-chip" data-filter="trending">
  <span class="codicon codicon-flame"></span> Repos
</button>

<!-- With count -->
<button class="gs-chip" data-filter="direct">
  Direct <span class="gs-chip-count">(5)</span>
</button>
```

Chips with or without icons render at the same height (22px).

---

## Topic Chip — `.gs-topic-chip`

Compact inline indicator for topics in conversation list rows.

| Property | Value |
|----------|-------|
| Height | **20px** (fixed) |
| Padding | 0 6px |
| Font size | `--gs-font-xs` (11px) |
| Border | 1px solid `--gs-border` |
| Border-radius | 6px |
| Gap | 2px (exception: 4px grid too loose for inline chip) |
| Cursor | pointer |
| Unread variant | error border + error text + error-tinted background |

```html
<span class="gs-topic-chip">
  <span class="gs-topic-chip__icon">💬</span> General
</span>
<span class="gs-topic-chip gs-topic-chip--unread">
  <span class="gs-topic-chip__icon">🐛</span> Bug Reports
</span>
```

**Design exception:** Topic icons use emoji (user-chosen decorative content), not Codicons. This matches Slack/Discord channel icon patterns and is consistent with the BE `iconEmoji` field.

---

## Accordion — `.gs-accordion-*`

| Class | Property | Value |
|-------|----------|-------|
| `.gs-accordion-header` | Height | **32px** |
| | Padding | 0 12px |
| | Hover | `--gs-hover` bg |
| `.gs-accordion-chevron` | Size | 16px |
| | Color | `--gs-muted` |
| | Collapsed | rotate(-90deg) |
| `.gs-accordion-title` | Font | 11px, 600 weight, uppercase |
| | Color | `--gs-muted` |
| | Spacing | letter-spacing: 0.5px |
| `.gs-accordion-count` | Font | 11px, `--gs-muted` |
| | Position | pushed right via `margin-left: auto` |
| `.gs-accordion-body` | Collapsed | `display: none` |

### Basic accordion

```html
<div class="gs-accordion-header" data-toggle="section-id">
  <span class="gs-accordion-chevron codicon codicon-chevron-down"></span>
  <span class="gs-accordion-title">Section Name</span>
  <button class="gs-btn-icon" title="Refresh">
    <span class="codicon codicon-refresh"></span>
  </button>
</div>
<div id="section-id" class="gs-accordion-body">
  <!-- content -->
</div>
```

Add `.collapsed` to both header and body to start collapsed.

### With count

```html
<div class="gs-accordion-header" data-toggle="section-id">
  <span class="gs-accordion-chevron codicon codicon-chevron-down"></span>
  <span class="gs-accordion-title">Repos</span>
  <span class="gs-accordion-count">(10)</span>
</div>
```

### Scrollable accordion (flex container)

When multiple accordions share a flex column container, use this pattern so expanded sections scroll internally while headers stay fixed:

```css
/* Container */
.my-container {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
/* Sections expand to fill space */
.my-section {
  display: flex;
  flex-direction: column;
  min-height: 32px;
}
.my-section:has(.gs-accordion-body:not(.collapsed)) {
  flex: 1;
  overflow: hidden;
}
.my-section .gs-accordion-body {
  flex: 1;
  overflow-y: auto;
}
```

Used in: Trending tab (repos/people/suggestions), Search results (repos/people).

### Fill-height accordion (primary + secondary sections)

When a tab has 3–4 accordion sections and you want one or two *primary* sections to fill the available height while *secondary* sections stay at natural height:

**Rules:**
1. `.gs-accordion-header` must have `flex-shrink: 0` (already set in shared.css) so headers can't collapse when parent flex is tight
2. Add a per-section marker class when building: `.gs-accordion-section--{tab}-{key}` so you can target individual sections from CSS
3. The immediate parent of the accordion sections must be `display: flex; flex-direction: column; min-height: 0; overflow: hidden`
4. Secondary (auto-height) sections: `flex: 0 0 auto` — they take only their natural height
5. Primary (fill) sections: `flex: 1 1 0; min-height: <N>px` — they share the remaining space equally
6. Primary section bodies: `flex: 1 1 auto; min-height: <N>px; overflow-y: auto` — scroll internally when content exceeds allocated space
7. All expanded bodies should have a `min-height` (e.g. 64–120px) so empty-state content doesn't trigger an inner scrollbar

```css
/* Container: flex column, no outer scroll */
#my-tab-content {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}
#my-tab-content .gs-accordion-section {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

/* Default: natural height, no grow */
#my-tab-content .gs-accordion-section:has(.gs-accordion-body:not(.collapsed)) {
  flex: 0 0 auto;
}
#my-tab-content .gs-accordion-body:not(.collapsed) {
  min-height: 64px; /* floor for empty states */
}

/* Primary sections fill remaining space with internal scroll */
#my-tab-content .gs-accordion-section--my-tab-primary:has(.gs-accordion-body:not(.collapsed)) {
  flex: 1 1 0;
  min-height: 120px;
}
#my-tab-content .gs-accordion-section--my-tab-primary .gs-accordion-body:not(.collapsed) {
  flex: 1 1 auto;
  min-height: 120px;
  overflow-y: auto;
}
```

Used in: **Discover tab** (PEOPLE + COMMUNITIES fill, TEAMS + ONLINE NOW natural height), **Friends tab** (ONLINE + OFFLINE fill, NOT ON GITCHAT natural height).

---

## Avatars — `.gs-avatar`

| Class | Size | Use |
|-------|------|-----|
| `.gs-avatar-sm` | 24px | Inline, lists, feed actors |
| `.gs-avatar-md` | 36px | List items, conversation rows |
| `.gs-avatar-lg` | 48px | Cards, hover cards |
| `.gs-avatar-xl` | 64px | Profile pages |

All avatars: `border-radius: 50%`, `object-fit: cover`, `flex-shrink: 0`.

```html
<img class="gs-avatar gs-avatar-md" src="..." alt="..." />
```

Max avatar size in sidebar: **80px**. For profile hero, use `gs-avatar-xl` + custom size in view CSS.

---

## Main Tabs — `.gs-main-tab`

Segmented top-level tabs used for the primary navigation of the Explore webview (Inbox / Friends / Channels). Full-width, equal-flex segments separated by vertical dividers; the active tab is highlighted by a top-accent line + lifted background.

| Class | Property | Value |
|-------|----------|-------|
| `.gs-main-tabs` | Layout | flex, gap 0, `flex-shrink: 0`, `z-index: 20` |
| | Background | `--vscode-titleBar-activeBackground` (fallback `--gs-bg`) |
| `.gs-main-tab` | Layout | `flex: 1`, inline-flex, center, gap 4px |
| | Padding | `8px 4px 7px` |
| | Font | `--gs-font-base`, weight 400 (inactive) / 500 (active) |
| | Color | `--gs-muted` (inactive) → `--gs-fg` (hover/active) |
| | Border | bottom 1px `--gs-divider` (inactive), transparent (active) |
| | Divider | left 1px `--gs-divider` between siblings (`+` combinator) |
| | Hover bg | `color-mix(in srgb, var(--gs-fg) 6%, transparent)` |
| `.gs-main-tab.active` | Background | `--gs-bg` (lifted into content area) |
| | Accent | top 1px via `box-shadow: inset 0 1px 0 var(--gs-button-bg)` |
| `.gs-main-tab .tab-badge` | Shape | min-width 16px, height 16px, radius 8px, padding 0 4px |
| | Font | 9px, weight 700 |
| | Color | `--gs-badge-bg` / `--gs-badge-fg` |

```html
<div class="gs-main-tabs" role="tablist">
  <button class="gs-main-tab active" data-tab="inbox">
    Inbox <span class="tab-badge">5</span>
  </button>
  <button class="gs-main-tab" data-tab="friends">Friends</button>
  <button class="gs-main-tab" data-tab="channels">Channels</button>
</div>
```

**When to use:** primary navigation at the top of a webview pane, when tabs represent fully distinct content surfaces (not subsections). For switching within a single surface, use **Sub-tabs** instead.

**Notes:**
- The active tab visually merges with the content area below via `background: --gs-bg` + transparent bottom border — no gap between tab and content.
- Top-accent uses the button blue (`--gs-button-bg`) as a focus marker without needing a separate underline element.
- Badge font-size is 9px (outside the 11px minimum) — acceptable only for numeric counters inside a 16px pill. Do not reuse 9px for text.

---

## Sub-tabs — `.gs-sub-tab`

Underline-style tabs for switching content within a pane. Used in Trending (Repos/People) and other secondary groupings inside a single surface.

| Class | Property | Value |
|-------|----------|-------|
| `.gs-sub-header` | Layout | flex, center, padding 4px 8px |
| | Border | bottom 1px solid `--gs-divider` |
| `.gs-sub-tabs` | Layout | flex, gap 16px, flex: 1 |
| | Padding | 0 4px |
| `.gs-sub-tab` | Font | 12px, 500 weight |
| | Color | `--gs-muted` (inactive), `--gs-fg` (active/hover) |
| | Active | 1px underline `--gs-fg` |

```html
<div class="gs-sub-header">
  <div class="gs-sub-tabs">
    <button class="gs-sub-tab active" data-tab="repos">Repos</button>
    <button class="gs-sub-tab" data-tab="people">People</button>
  </div>
  <!-- optional actions on the right -->
  <button class="gs-btn-icon"><span class="codicon codicon-settings-gear"></span></button>
</div>
```

Items after `.gs-sub-tabs` are pushed right automatically (flex layout).

---

## Row Items — `.gs-row-item`

Content rows with inset margins and subtle dividers. Base layout class for chat conversations, trending repos, trending people, and any list with avatar + content.

| Property | Value |
|----------|-------|
| Layout | flex, align-items: center |
| Gap | **12px** (horizontal between all children) |
| Margin | 0 `--gs-inset-x` (inset from edges) |
| Padding | 8px 4px |
| Divider | bottom 1px solid `--gs-divider-muted` |
| Hover | `--gs-hover` bg |
| Radius | 0 (no rounding) |

### Typography rules within rows

| Element | Font size | Weight |
|---------|-----------|--------|
| Title / Name | `--gs-font-md` (14px) | 600 |
| Description / Subtitle | `--gs-font-sm` (12px) | normal |
| Meta line | `--gs-font-sm` (12px) | normal, `--gs-muted` |
| Avatar | **32px** round | — |

### Basic row

```html
<div class="gs-row-item">
  <img class="gs-avatar gs-avatar-md" src="..." alt="">
  <div class="gs-flex-1" style="min-width:0">
    <div style="font-weight:600">Title</div>
    <div class="gs-text-sm gs-text-muted">Description</div>
  </div>
</div>
```

### With rank + actions (repos)

```html
<div class="gs-row-item tr-card">
  <span class="gs-rank" data-rank="1">1</span>
  <img class="tr-owner-avatar" src="..." alt="">
  <div class="tr-content">
    <div class="tr-title-wrap">owner/<strong>repo</strong></div>
    <div class="tr-desc">Description...</div>
    <div class="tr-meta">Language · ▲ 1.2k</div>
  </div>
  <div class="tr-actions"><!-- star button + count --></div>
</div>
```

### With rank + follow button (people)

```html
<div class="gs-row-item tp-card">
  <span class="gs-rank" data-rank="1">1</span>
  <img class="tp-avatar" src="..." alt="">
  <div class="tp-info">
    <div class="tp-name">Display Name</div>
    <div class="tp-login">@login</div>
    <div class="tp-bio">Bio text...</div>
  </div>
  <button class="gs-btn gs-btn-primary tp-follow-btn">Follow</button>
</div>
```

Combine with modifier classes (`conv-item`, `tr-card`, `tp-card`) for view-specific styling. Never override layout properties in modifiers — only add visual variants (e.g. unread bold, muted opacity).

---

## Filter Bar — `.gs-filter-bar`

Horizontal chip row for filtering content. Used in Chat inbox, Feed, Trending time ranges.

| Property | Value |
|----------|-------|
| Layout | flex, wrap |
| Gap | 6px |
| Padding | 6px `--gs-inset-x` |

```html
<div class="gs-filter-bar">
  <button class="gs-chip active" data-filter="all">All</button>
  <button class="gs-chip" data-filter="direct">Direct</button>
</div>
```

---

## Inputs — `.gs-input`

| Property | Value |
|----------|-------|
| Padding | 6px 10px |
| Font size | 13px |
| Radius | 4px (`--gs-radius-sm`) |
| Border | 1px solid `--gs-input-border` |
| Focus | border-color: `--gs-button-bg` |
| Width | 100% |

```html
<input class="gs-input" placeholder="Search..." />
```

---

## List Items — `.gs-list-item`

| Property | Value |
|----------|-------|
| Layout | flex, align-items: center |
| Gap | 10px |
| Padding | 8px 12px |
| Radius | 4px (`--gs-radius-sm`) |
| Hover | `--gs-hover` bg |

```html
<div class="gs-list-item">
  <img class="gs-avatar gs-avatar-md" src="..." />
  <div class="gs-flex-1 gs-truncate">
    <div>Name</div>
    <div class="gs-text-xs gs-text-muted">Description</div>
  </div>
</div>
```

---

## Cards — `.gs-card`

| Property | Value |
|----------|-------|
| Border | 1px solid `--gs-border` |
| Radius | 8px (`--gs-radius`) |
| Padding | 12px |
| Background | `--gs-bg-secondary` |

```html
<div class="gs-card">
  <div class="gs-card-title">Section Title</div>
  <!-- content -->
</div>
```

`.gs-card-title`: 11px, 600 weight, uppercase, `--gs-muted`, letter-spacing: 0.06em.

---

## Dropdown — `.gs-dropdown`

Overlay popup menu. Used for user menu, settings, context menus.

| Class | Property | Value |
|-------|----------|-------|
| `.gs-dropdown` | Position | absolute, z-index 200 |
| | Background | `--gs-bg` |
| | Border | 1px solid `--gs-border`, radius `--gs-radius` |
| | Shadow | `--gs-shadow-md` |
| | Padding | 4px 0 |
| | Min-width | 200px |
| `.gs-dropdown-header` | Layout | flex, center, gap 10px, padding 10px 12px |
| `.gs-dropdown-title` | Font | `--gs-font-md`, 600 weight |
| `.gs-dropdown-divider` | Height | 1px, `--gs-divider` bg, margin 4px 0 |
| `.gs-dropdown-item` | Layout | flex, center, gap 8px |
| | Padding | 6px 12px |
| | Font | `--gs-font-sm` |
| | Hover | `--gs-hover` bg |
| `.gs-dropdown-item--danger` | Color | `--gs-error` |

```html
<!-- Basic dropdown -->
<div class="gs-dropdown" style="right:8px;top:36px">
  <button class="gs-dropdown-item"><span class="codicon codicon-person"></span> View Profile</button>
  <div class="gs-dropdown-divider"></div>
  <button class="gs-dropdown-item gs-dropdown-item--danger"><span class="codicon codicon-sign-out"></span> Sign Out</button>
</div>

<!-- With header (user menu) -->
<div class="gs-dropdown" style="right:8px;top:0">
  <div class="gs-dropdown-header">
    <img class="gs-avatar gs-avatar-md" src="..." alt="">
    <div>
      <div class="gs-dropdown-title">Name</div>
      <div class="gs-text-sm gs-text-muted">@login</div>
    </div>
  </div>
  <div class="gs-dropdown-divider"></div>
  <button class="gs-dropdown-item">...</button>
</div>
```

Position with inline `style` — parent must be `position: relative`.

---

## Badges — `.gs-badge`

| Property | Value |
|----------|-------|
| Min-width | 18px |
| Height | 18px |
| Padding | 0 5px |
| Font | 11px, 600 weight |
| Radius | full (pill) |
| Colors | `--gs-badge-bg` / `--gs-badge-fg` |

```html
<span class="gs-badge">5</span>
```

---

## Status Dots — `.gs-dot-*`

| Class | Color | Use |
|-------|-------|-----|
| `.gs-dot-online` | `--gs-success` (#4ade80) | User online |
| `.gs-dot-offline` | `--gs-muted` | User offline |

Both: 8x8px, `border-radius: 50%`, `display: inline-block`.

```html
<span class="gs-dot-online"></span>
```

**Never hardcode** `#3fb950` or any other green. Always use `.gs-dot-online`.

---

## Headers — `.gs-header`

| Property | Value |
|----------|-------|
| Layout | flex, space-between, center |
| Padding | 10px 12px |
| Border | bottom 1px solid `--gs-divider` |
| Position | sticky top: 0, z-index: 10 |
| Background | `--gs-bg` |

```html
<div class="gs-header">
  <span class="gs-header-title">Title</span>
  <button class="gs-btn-icon"><span class="codicon codicon-refresh"></span></button>
</div>
```

### Section headers with count badge

For in-panel section headers (e.g. `MUTUAL FRIENDS (4)`, `MEMBERS (8)`, `ONLINE (2)`),
use **parentheses** for the count, NOT an em-dash or colon. Keeps the title compact
and consistent across the app.

```html
<!-- ✓ Correct -->
<div class="gs-pc-section-header">MUTUAL FRIENDS (4)</div>
<div class="gs-sc-gi-section-header"><span>MEMBERS (8)</span></div>

<!-- ✗ Avoid -->
<div>MUTUAL FRIENDS — 4</div>
<div>MUTUAL FRIENDS: 4</div>
```

Convention:
- Title in UPPERCASE
- Space before parenthesis: `TITLE (N)` not `TITLE(N)`
- Always render count even when it is 1 (`MEMBERS (1)`, not `MEMBER`)
- Use `--gs-font-xs`, `--gs-muted`, `font-weight: 600`, `letter-spacing: 0.5px`

---

## Empty States — `.gs-empty`

| Property | Value |
|----------|-------|
| Align | center |
| Padding | 32px 16px |
| Font | 13px, `--gs-muted` |

```html
<div class="gs-empty">
  <i class="codicon codicon-inbox" style="font-size: 32px; margin-bottom: 8px;"></i>
  <div>No messages yet</div>
  <div class="gs-text-xs" style="margin-top: 4px;">Start a conversation!</div>
</div>
```

---

## Loading States — `.gs-loading`

| Property | Value |
|----------|-------|
| Layout | flex, center |
| Padding | 60px 20px |
| Font | 14px (`--gs-font-md`), `--gs-muted` |

```html
<div class="gs-loading">
  <i class="codicon codicon-loading codicon-modifier-spin"></i>
</div>
```

---

## Hover Card — `.gs-hover-card`

| Property | Value |
|----------|-------|
| Position | absolute, z-index: 100 |
| Padding | 12px |
| Radius | 8px |
| Shadow | `--gs-shadow-md` |
| Min-width | 220px |
| Default | `display: none` |

Toggle with `.visible` class.

---

## Banner — `.gs-banner`

| Property | Value |
|----------|-------|
| Padding | 8px 12px |
| Background | `--gs-bg-secondary` |
| Border | bottom 1px solid `--gs-divider` |
| Font | 12px |
| Layout | flex, center, gap: 8px |

---

## Utility Classes

| Class | Property |
|-------|----------|
| `.gs-truncate` | overflow: hidden, text-overflow: ellipsis, white-space: nowrap |
| `.gs-text-sm` | font-size: 12px |
| `.gs-text-xs` | font-size: 11px |
| `.gs-text-muted` | color: `--gs-muted` |
| `.gs-flex` | display: flex |
| `.gs-flex-col` | display: flex, flex-direction: column |
| `.gs-gap-4` | gap: 4px |
| `.gs-gap-8` | gap: 8px |
| `.gs-items-center` | align-items: center |
| `.gs-flex-1` | flex: 1, min-width: 0 |
| `.gs-ml-auto` | margin-left: auto |
| `.gs-flex-shrink-0` | flex-shrink: 0 |
| `.gs-divider` | border-bottom: 1px solid `--gs-divider` |

---

## Layout Patterns

### Sidebar View (~300px)

```
┌─────────────────────────────┐
│ Header (sticky)        [⟳] │  ← gs-sub-header or native title
├─────────────────────────────┤
│ Filter/Tabs (optional)      │  ← gs-filter-bar / gs-sub-tabs
├─────────────────────────────┤
│                             │
│  Scrollable content         │  ← flex: 1, overflow-y: auto
│  - gs-row-item rows        │
│  - gs-card cards            │
│                             │
├─────────────────────────────┤
│ Sticky bottom (optional)    │  ← accordion, input bar
└─────────────────────────────┘
```

- Always single column — never 2 columns in sidebar
- Horizontal inset: `--gs-inset-x` (8px) for all sections
- Truncate long text with `gs-truncate`

### Editor Panel (profile, repo-detail, chat)

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

## Migration Needed

These view-specific patterns should be migrated to `--gs-*` tokens:

| View | Custom Classes | Status |
|------|---------------|--------|
| `profile.css` | `.pf-btn`, `.pf-card`, `.pf-loading` — use raw `--vscode-*` vars | Pending |
| `repo-detail.css` | `.rd-btn`, `.rd-card`, `.rd-loading` — use raw `--vscode-*` vars | Pending |
| `chat.css` | Custom button/layout styles — use raw `--vscode-*` vars | Pending |
| `welcome.css` | Custom card/CTA styles — use raw `--vscode-*` vars | Pending |
