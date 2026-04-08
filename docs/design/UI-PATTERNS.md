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
| `.gs-accordion-body` | Collapsed | `display: none` |

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

## Migration Needed

These view-specific patterns should be migrated to `--gs-*` tokens:

| View | Custom Classes | Status |
|------|---------------|--------|
| `profile.css` | `.pf-btn`, `.pf-card`, `.pf-loading` — use raw `--vscode-*` vars | Pending |
| `repo-detail.css` | `.rd-btn`, `.rd-card`, `.rd-loading` — use raw `--vscode-*` vars | Pending |
| `chat.css` | Custom button/layout styles — use raw `--vscode-*` vars | Pending |
| `welcome.css` | Custom card/CTA styles — use raw `--vscode-*` vars | Pending |
