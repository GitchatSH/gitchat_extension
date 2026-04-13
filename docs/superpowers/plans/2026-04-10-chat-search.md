# Telegram-style In-Chat Search — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clone Telegram's in-chat search UX — search bar replaces header, results list overlay, jump to message with context, user filter, jump to date.

**Architecture:** SearchManager state machine in chat.js drives all UI. Reuses existing `jumpToMessage`/`jumpToMessageResult` flow for context loading. API layer gets `user` filter param. New CSS replaces old `.search-bar` classes.

**Tech Stack:** TypeScript (chat.ts, api/index.ts), vanilla JS (chat.js), CSS (chat.css), VS Code webview postMessage API.

**Spec:** `docs/superpowers/specs/2026-04-10-chat-search-design.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `media/webview/chat.css` | Replace `.search-bar` CSS (line 38-110), add results overlay, user filter dropdown, date picker, search highlight styles |
| Modify | `media/webview/chat.js` | SearchManager state machine, search bar rendering, results list, user filter, date picker, keyboard nav, snapshot save/restore |
| Modify | `src/webviews/chat.ts` | Update `searchMessages` handler (error flag, user param), add `jumpToDate` handler |
| Modify | `src/api/index.ts` | Add `user` param to `searchMessages()`, add `getMessagesAroundDate()` |
| Create | `docs/be-requirements-search.md` | BE team requirements doc |

---

### Task 1: API Layer — Add `user` filter to `searchMessages`

**Files:**
- Modify: `src/api/index.ts:488-495`

- [ ] **Step 1: Update `searchMessages` method signature**

Change positional params to options object for extensibility:

```typescript
async searchMessages(
  conversationId: string,
  query: string,
  options?: { cursor?: string; limit?: number; user?: string }
): Promise<{ messages: Message[]; nextCursor: string | null }> {
  const params: Record<string, string | number> = { q: query };
  if (options?.cursor) { params.cursor = options.cursor; }
  if (options?.limit) { params.limit = options.limit; }
  if (options?.user) { params.user = options.user; }
  const { data } = await this._http.get(`/messages/conversations/${conversationId}/search`, { params });
  const d = data.data ?? data;
  return { messages: d.messages ?? [], nextCursor: d.nextCursor ?? null };
}
```

- [ ] **Step 2: Check for callers of `searchMessages` and update them**

Run: `grep -rn "searchMessages" src/`

The only caller is `chat.ts:674`. Update in Task 3.

- [ ] **Step 3: Commit**

```bash
git add src/api/index.ts
git commit -m "refactor(api): change searchMessages to options object, add user filter param"
```

---

### Task 2: API Layer — Add `getMessagesAroundDate` method

**Files:**
- Modify: `src/api/index.ts` (add after `searchMessages`, ~line 496)

- [ ] **Step 1: Add method**

```typescript
async getMessagesAroundDate(conversationId: string, date: string): Promise<{
  messages: Message[];
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
  previousCursor?: string;
  nextCursor?: string;
}> {
  const { data } = await this._http.get(
    `/messages/conversations/${conversationId}/messages`,
    { params: { around_date: date } }
  );
  const d = data.data ?? data;
  return {
    messages: d.messages ?? [],
    hasMoreBefore: d.hasMoreBefore ?? d.has_more_before ?? false,
    hasMoreAfter: d.hasMoreAfter ?? d.has_more_after ?? false,
    previousCursor: d.previousCursor ?? d.previous_cursor,
    nextCursor: d.nextCursor ?? d.next_cursor,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/api/index.ts
git commit -m "feat(api): add getMessagesAroundDate method for Jump to Date"
```

---

### Task 3: Extension Handler — Update `searchMessages` + add `jumpToDate`

**Files:**
- Modify: `src/webviews/chat.ts:670-678` (searchMessages handler)
- Modify: `src/webviews/chat.ts` (add jumpToDate case after line 842)

- [ ] **Step 1: Update `searchMessages` handler**

Replace lines 670-678:

```typescript
case "searchMessages": {
  const sp = msg.payload as { query: string; cursor?: string; user?: string };
  if (!sp?.query?.trim()) { break; }
  try {
    const result = await apiClient.searchMessages(this._conversationId, sp.query.trim(), {
      cursor: sp.cursor,
      user: sp.user,
    });
    this._panel.webview.postMessage({
      type: "searchResults",
      messages: result.messages,
      nextCursor: result.nextCursor,
      query: sp.query,
    });
  } catch {
    this._panel.webview.postMessage({
      type: "searchError",
      query: sp.query,
      error: true,
    });
  }
  break;
}
```

- [ ] **Step 2: Add `jumpToDate` handler**

Add after the `jumpToMessage` case (after line 842):

```typescript
case "jumpToDate": {
  const { date } = msg.payload as { date: string };
  if (!date) { break; }
  try {
    const result = await apiClient.getMessagesAroundDate(this._conversationId, date);
    this._previousCursor = result.previousCursor;
    this._nextCursor = result.nextCursor;
    this._hasMoreBefore = result.hasMoreBefore;
    this._hasMoreAfter = result.hasMoreAfter;
    this._panel.webview.postMessage({
      type: "jumpToDateResult",
      messages: result.messages,
      hasMoreBefore: result.hasMoreBefore,
      hasMoreAfter: result.hasMoreAfter,
    });
  } catch {
    this._panel.webview.postMessage({ type: "jumpToDateFailed" });
  }
  break;
}
```

- [ ] **Step 3: Run type check**

Run: `npm run check-types`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/webviews/chat.ts
git commit -m "feat(chat): update searchMessages handler with user filter + error flag, add jumpToDate handler"
```

---

### Task 4: CSS — Replace search bar + add results overlay styles

**Files:**
- Modify: `media/webview/chat.css:38-122` (replace existing search bar + highlight CSS)

- [ ] **Step 1: Replace `.search-bar` CSS block (lines 38-110) and `.search-highlight` / `.search-current` (lines 113-122)**

Remove lines 38-122 and replace with:

```css
/* ── Telegram-style search bar (replaces chat header) ── */
.search-bar {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px; background: var(--gs-bg-secondary);
  border-bottom: 1px solid var(--gs-widget-border); flex-shrink: 0;
}
.search-bar__arrows { display: flex; gap: 2px; flex-shrink: 0; }
.search-bar__arrows button {
  background: transparent; border: none; color: var(--gs-muted);
  font-size: 16px; cursor: pointer; padding: 4px 6px; border-radius: 4px;
}
.search-bar__arrows button:hover:not(:disabled) { background: var(--gs-hover); color: var(--gs-fg); }
.search-bar__arrows button:disabled { opacity: 0.3; cursor: default; }
.search-bar__input-wrap {
  flex: 1; display: flex; align-items: center;
  background: var(--gs-input-bg); border: 1px solid var(--gs-input-border);
  border-radius: 16px; padding: 4px 10px; gap: 6px;
  min-width: 0;
}
.search-bar__input-wrap:focus-within { border-color: var(--gs-focus); }
.search-bar__icon { color: var(--gs-muted); font-size: 14px; flex-shrink: 0; }
.search-bar__input {
  flex: 1; background: transparent; border: none; color: var(--gs-input-fg);
  font-size: var(--gs-font-sm); outline: none; min-width: 0;
}
.search-bar__clear {
  background: transparent; border: none; color: var(--gs-muted);
  font-size: 12px; cursor: pointer; padding: 2px; flex-shrink: 0;
}
.search-bar__clear:hover { color: var(--gs-fg); }
.search-bar__counter {
  font-size: var(--gs-font-xs); color: var(--gs-muted);
  white-space: nowrap; min-width: 52px; text-align: center; flex-shrink: 0;
}
.search-bar__actions { display: flex; gap: 2px; flex-shrink: 0; }
.search-bar__actions button {
  background: transparent; border: none; color: var(--gs-muted);
  font-size: 16px; cursor: pointer; padding: 4px 6px; border-radius: 4px;
}
.search-bar__actions button:hover { background: var(--gs-hover); color: var(--gs-fg); }
.search-bar__actions button:disabled { opacity: 0.3; cursor: default; }
.search-bar__user-badge {
  display: inline-flex; align-items: center; gap: 4px;
  background: var(--gs-hover); border-radius: 10px; padding: 2px 8px 2px 4px;
  font-size: var(--gs-font-xs); color: var(--gs-fg); white-space: nowrap; flex-shrink: 0;
}
.search-bar__user-badge button {
  background: transparent; border: none; color: var(--gs-muted);
  font-size: 10px; cursor: pointer; padding: 0 2px;
}
.search-bar__spinner {
  width: 14px; height: 14px; border: 2px solid var(--gs-muted);
  border-top-color: transparent; border-radius: 50%;
  animation: gs-spin 0.6s linear infinite; flex-shrink: 0;
}
@keyframes gs-spin { to { transform: rotate(360deg); } }

/* ── Search results overlay ── */
.search-results-overlay {
  position: absolute; top: 0; left: 0; right: 0; bottom: 0;
  background: var(--gs-bg); z-index: 40; overflow-y: auto;
  display: flex; flex-direction: column;
}
.search-results-overlay.dimmed { opacity: 0.5; pointer-events: none; }
.search-results__empty {
  display: flex; align-items: center; justify-content: center;
  flex: 1; color: var(--gs-muted); font-size: var(--gs-font-sm);
}
.search-results__spinner {
  display: flex; align-items: center; justify-content: center; flex: 1;
}

/* ── Search result row ── */
.search-result-row {
  display: flex; align-items: center; gap: 10px;
  padding: 10px var(--gs-inset-x); cursor: pointer;
  border-bottom: 1px solid var(--gs-border);
}
.search-result-row:hover { background: var(--gs-hover); }
.search-result-row.highlighted { background: var(--gs-hover); }
.search-result-row__avatar {
  width: 40px; height: 40px; border-radius: var(--gs-radius-full);
  object-fit: cover; flex-shrink: 0;
}
.search-result-row__avatar-placeholder {
  width: 40px; height: 40px; border-radius: var(--gs-radius-full);
  background: var(--gs-hover); display: flex; align-items: center;
  justify-content: center; font-size: 16px; color: var(--gs-muted); flex-shrink: 0;
}
.search-result-row__body { flex: 1; min-width: 0; }
.search-result-row__sender {
  font-weight: 600; color: var(--gs-link); font-size: var(--gs-font-sm);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.search-result-row__preview {
  color: var(--gs-muted); font-size: var(--gs-font-xs);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.search-result-row__preview mark {
  background: transparent; color: var(--gs-fg); font-weight: 600;
}
.search-result-row__date {
  font-size: var(--gs-font-xs); color: var(--gs-muted);
  flex-shrink: 0; margin-left: 8px; white-space: nowrap;
}

/* ── User card (top of results) ── */
.search-user-card {
  display: flex; align-items: center; gap: 10px;
  padding: 10px var(--gs-inset-x); cursor: pointer;
  border-bottom: 2px solid var(--gs-border);
}
.search-user-card:hover { background: var(--gs-hover); }
.search-user-card__name { font-weight: 600; color: var(--gs-fg); }
.search-user-card__handle { font-size: var(--gs-font-xs); color: var(--gs-muted); }

/* ── Search keyword highlight in chat messages ── */
.search-keyword-hl {
  background: var(--gs-warning-bg, rgba(200, 170, 0, 0.25));
  border-radius: 2px; padding: 0 2px;
}
.message.search-target {
  border-left: 3px solid var(--gs-focus);
  background: var(--gs-focus-bg, rgba(14, 99, 156, 0.1));
  transition: background 2s ease-out, border-color 2s ease-out;
}
.message.search-target-fading {
  border-left-color: transparent; background: transparent;
}

/* ── User filter dropdown ── */
.search-user-dropdown {
  position: absolute; top: 100%; right: 40px;
  background: var(--gs-bg-secondary); border: 1px solid var(--gs-widget-border);
  border-radius: var(--gs-radius-md); box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  z-index: 60; max-height: 240px; overflow-y: auto; min-width: 180px;
}
.search-user-dropdown__item {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px; cursor: pointer;
}
.search-user-dropdown__item:hover { background: var(--gs-hover); }

/* ── Date picker dropdown ── */
.search-date-picker {
  position: absolute; top: 100%; right: 0;
  background: var(--gs-bg-secondary); border: 1px solid var(--gs-widget-border);
  border-radius: var(--gs-radius-md); box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  z-index: 60; padding: 12px; min-width: 220px;
}
.search-date-picker__header {
  display: flex; justify-content: space-between; align-items: center;
  margin-bottom: 8px;
}
.search-date-picker__header button {
  background: transparent; border: none; color: var(--gs-muted);
  cursor: pointer; font-size: 16px; padding: 4px;
}
.search-date-picker__header button:hover { color: var(--gs-fg); }
.search-date-picker__year { font-weight: 600; color: var(--gs-fg); font-size: var(--gs-font-sm); }
.search-date-picker__grid {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px;
}
.search-date-picker__month {
  padding: 6px 4px; text-align: center; border-radius: var(--gs-radius-sm);
  cursor: pointer; font-size: var(--gs-font-xs); color: var(--gs-fg);
  background: transparent; border: none;
}
.search-date-picker__month:hover { background: var(--gs-hover); }
.search-date-picker__month.current { background: var(--gs-focus); color: white; }
```

- [ ] **Step 2: Commit**

```bash
git add media/webview/chat.css
git commit -m "style(chat): replace search bar CSS with Telegram-style layout + results overlay + filters"
```

---

### Task 5: JS — SearchManager state machine + search bar rendering

**Files:**
- Modify: `media/webview/chat.js`

This is the core task. Add SearchManager and search bar rendering at the **end of the file** (after all existing code, before the closing of the IIFE if any).

- [ ] **Step 1: Add SearchManager object**

Add at end of `chat.js`:

```javascript
/* ════════════════════════════════════════════════
   SEARCH MANAGER — Telegram-style in-chat search
   ════════════════════════════════════════════════ */
var SearchManager = {
  state: "idle", // idle | search-active | loading | results-list | chat-nav
  query: "",
  results: [],
  nextCursor: null,
  highlightedIndex: -1,
  currentResultIndex: 0,
  userFilter: null,
  snapshot: null, // { messages, scrollTop, previousCursor, nextCursor, hasMoreBefore, hasMoreAfter, hasMore }
  _debounceTimer: null,
  _throttleTimer: null,
  _searchKeyword: null,
  _pendingCursor: null,

  open: function() {
    if (this.state !== "idle") return;
    this.state = "search-active";
    this.query = "";
    this.results = [];
    this.nextCursor = null;
    this.highlightedIndex = -1;
    this.currentResultIndex = 0;
    this.userFilter = null;
    this._searchKeyword = null;
    this.renderSearchBar();
    this.renderResultsOverlay();
    document.querySelector(".search-bar__input")?.focus();
  },

  close: function() {
    if (this.state === "idle") return;
    // Restore snapshot if we jumped into chat
    if (this.snapshot) {
      this.restoreSnapshot();
    }
    this.state = "idle";
    this.query = "";
    this.results = [];
    this.snapshot = null;
    this._searchKeyword = null;
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    // Remove search bar, restore header
    var header = document.querySelector(".search-bar");
    if (header) {
      header.remove();
      // Re-render original header
      var headerArea = document.querySelector(".chat-header");
      if (!headerArea) {
        // Header was replaced — need to recreate
        var container = document.querySelector("#chat-container") || document.body;
        var firstChild = container.firstElementChild;
        var h = document.createElement("div");
        h.className = "chat-header";
        h.id = "header";
        container.insertBefore(h, firstChild);
      }
      if (typeof currentParticipant !== "undefined" && currentParticipant) {
        renderHeader(currentParticipant, _isGroup, typeof currentParticipants !== "undefined" ? currentParticipants : []);
      }
    }
    // Remove results overlay
    var overlay = document.querySelector(".search-results-overlay");
    if (overlay) overlay.remove();
    // Remove dimmed class from messages
    var msgs = document.getElementById("messages");
    if (msgs) msgs.style.display = "";
  },

  saveSnapshot: function() {
    var msgs = document.getElementById("messages");
    this.snapshot = {
      scrollTop: msgs ? msgs.scrollTop : 0,
      // We'll use the global messages data, not DOM
    };
  },

  restoreSnapshot: function() {
    if (!this.snapshot) return;
    // Tradeoff: We use reloadConversation (full API refetch) instead of caching the messages
    // array locally. This is simpler and always returns the latest state, but adds a brief
    // loading flash on slow connections. Acceptable for V1 — local cache restore is a V2 optimization.
    vscode.postMessage({ type: "reloadConversation" });
    this.snapshot = null;
  },

  renderSearchBar: function() {
    // Replace .chat-header with search bar
    var existingHeader = document.querySelector(".chat-header");
    if (existingHeader) existingHeader.remove();

    var bar = document.createElement("div");
    bar.className = "search-bar";

    var isGroup = typeof _isGroup !== "undefined" && _isGroup;
    var inChatNav = this.state === "chat-nav";

    bar.innerHTML =
      '<div class="search-bar__arrows">' +
        '<button class="search-bar__arrow-up" title="Previous result"' + (inChatNav ? '' : ' disabled') + '><i class="codicon codicon-chevron-up"></i></button>' +
        '<button class="search-bar__arrow-down" title="Next result"' + (inChatNav ? '' : ' disabled') + '><i class="codicon codicon-chevron-down"></i></button>' +
      '</div>' +
      (inChatNav ? '<span class="search-bar__counter">' + (this.currentResultIndex + 1) + ' of ' + this.results.length + (this.nextCursor ? '+' : '') + '</span>' : '') +
      '<div class="search-bar__input-wrap">' +
        '<i class="codicon codicon-search search-bar__icon"></i>' +
        (this.userFilter ? '<span class="search-bar__user-badge">' + escapeHtml(this.userFilter) + ' <button class="search-bar__user-badge-remove" title="Remove filter"><i class="codicon codicon-close"></i></button></span>' : '') +
        '<input class="search-bar__input" type="text" placeholder="Search messages…" value="' + escapeHtml(this.query) + '">' +
        (this.state === "loading" ? '<div class="search-bar__spinner"></div>' : '') +
        (this.query ? '<button class="search-bar__clear" title="Clear"><i class="codicon codicon-close"></i></button>' : '') +
      '</div>' +
      '<div class="search-bar__actions">' +
        (isGroup ? '<button class="search-bar__filter-user" title="Filter by user"><i class="codicon codicon-person"></i></button>' : '') +
        '<button class="search-bar__filter-date" title="Jump to date"><i class="codicon codicon-calendar"></i></button>' +
        '<button class="search-bar__close" title="Close search"><i class="codicon codicon-close"></i></button>' +
      '</div>';

    var container = document.querySelector("#chat-container") || document.body;
    container.insertBefore(bar, container.firstElementChild);
    this.bindSearchBarEvents(bar);
  },

  bindSearchBarEvents: function(bar) {
    var self = this;
    var input = bar.querySelector(".search-bar__input");

    // Input typing with debounce
    if (input) {
      input.addEventListener("input", function() {
        self.query = this.value;
        if (self._debounceTimer) clearTimeout(self._debounceTimer);
        if (!self.query.trim()) {
          self.results = [];
          self.state = "search-active";
          self.renderResultsOverlay();
          self.renderSearchBar();
          return;
        }
        self._debounceTimer = setTimeout(function() {
          self.state = "loading";
          self.renderSearchBar();
          self.renderResultsOverlay(); // dim previous results
          vscode.postMessage({
            type: "searchMessages",
            payload: { query: self.query, user: self.userFilter || undefined }
          });
        }, 300);
      });

      // Click input in chat-nav → back to results
      input.addEventListener("focus", function() {
        if (self.state === "chat-nav" && self.results.length > 0) {
          self.state = "results-list";
          self.renderSearchBar();
          self.showResultsOverlay();
        }
      });

      // Keyboard
      input.addEventListener("keydown", function(e) {
        if (e.key === "Escape") {
          self.close();
          return;
        }
        if (self.state === "results-list") {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            self.highlightedIndex = Math.min(self.highlightedIndex + 1, self.results.length - 1);
            self.updateHighlight();
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            self.highlightedIndex = Math.max(self.highlightedIndex - 1, 0);
            self.updateHighlight();
          } else if (e.key === "Enter" && self.highlightedIndex >= 0) {
            e.preventDefault();
            self.jumpToResult(self.highlightedIndex);
          }
        }
      });
    }

    // Close button
    var closeBtn = bar.querySelector(".search-bar__close");
    if (closeBtn) closeBtn.addEventListener("click", function() { self.close(); });

    // Clear button
    var clearBtn = bar.querySelector(".search-bar__clear");
    if (clearBtn) clearBtn.addEventListener("click", function() {
      self.query = "";
      self.results = [];
      self.state = "search-active";
      self.renderSearchBar();
      self.renderResultsOverlay();
      bar.querySelector(".search-bar__input")?.focus();
    });

    // Arrow buttons (chat-nav state)
    var upBtn = bar.querySelector(".search-bar__arrow-up");
    var downBtn = bar.querySelector(".search-bar__arrow-down");
    if (upBtn) upBtn.addEventListener("click", function() { self.navigatePrev(); });
    if (downBtn) downBtn.addEventListener("click", function() { self.navigateNext(); });

    // User filter button
    var userBtn = bar.querySelector(".search-bar__filter-user");
    if (userBtn) userBtn.addEventListener("click", function() { self.toggleUserFilter(); });

    // Date filter button
    var dateBtn = bar.querySelector(".search-bar__filter-date");
    if (dateBtn) dateBtn.addEventListener("click", function() { self.toggleDatePicker(); });

    // User badge remove
    var badgeRemove = bar.querySelector(".search-bar__user-badge-remove");
    if (badgeRemove) badgeRemove.addEventListener("click", function() {
      self.userFilter = null;
      self.reSearch();
    });
  },
};
```

- [ ] **Step 2: Add search icon button to `renderHeader`**

In `renderHeader` function (~line 584-604), find both `header-right` divs and add a search button before the gear button:

```javascript
// In both group and DM header-right sections, change:
'<div class="header-right">' +
  '<button class="header-icon-btn" id="searchBtn" title="Search"><span class="codicon codicon-search"></span></button>' +
  '<button class="header-icon-btn" id="menuBtn" title="Settings"><span class="codicon codicon-settings-gear"></span></button>' +
'</div>';
```

After the `menuBtn` event listener setup (~line 607-620), add:

```javascript
var searchBtn = document.getElementById("searchBtn");
if (searchBtn) {
  searchBtn.addEventListener("click", function() { SearchManager.open(); });
}
```

- [ ] **Step 3: Verify search bar opens and closes**

Test manually in VS Code: click search icon → search bar appears. Click ✕ → header restores.

- [ ] **Step 4: Commit**

```bash
git add media/webview/chat.js
git commit -m "feat(chat): add SearchManager state machine + search bar rendering"
```

---

### Task 6: JS — Results list overlay rendering + search results handler

**Files:**
- Modify: `media/webview/chat.js` (add methods to SearchManager)

- [ ] **Step 1: Add results overlay methods to SearchManager**

```javascript
// Add these methods to SearchManager object:

renderResultsOverlay: function() {
  var existing = document.querySelector(".search-results-overlay");
  if (!existing) {
    existing = document.createElement("div");
    existing.className = "search-results-overlay";
    var messagesArea = document.getElementById("messages-area") || document.getElementById("messages")?.parentElement;
    if (messagesArea) {
      messagesArea.style.position = "relative";
      messagesArea.appendChild(existing);
    }
  }

  if (this.state === "loading" && this.results.length > 0) {
    existing.classList.add("dimmed");
    return; // Keep previous results visible but dimmed
  }
  existing.classList.remove("dimmed");

  if (!this.query.trim()) {
    existing.innerHTML = '<div class="search-results__empty">Type to search messages</div>';
    return;
  }
  if (this.state === "loading" && this.results.length === 0) {
    existing.innerHTML = '<div class="search-results__spinner"><div class="search-bar__spinner" style="width:24px;height:24px;border-width:3px;"></div></div>';
    return;
  }
  if (this.results.length === 0) {
    existing.innerHTML = '<div class="search-results__empty">No messages found</div>';
    return;
  }

  var html = "";
  // User matches (client-side)
  var userMatches = this.matchUsers(this.query);
  for (var u = 0; u < userMatches.length; u++) {
    var um = userMatches[u];
    html += '<div class="search-user-card" data-user-login="' + escapeHtml(um.login) + '">' +
      (um.avatar_url ? '<img class="search-result-row__avatar" src="' + escapeHtml(um.avatar_url) + '">' :
        '<div class="search-result-row__avatar-placeholder">' + escapeHtml((um.login || "?")[0].toUpperCase()) + '</div>') +
      '<div><div class="search-user-card__name">' + escapeHtml(um.name || um.login) + '</div>' +
      '<div class="search-user-card__handle">@' + escapeHtml(um.login) + '</div></div></div>';
  }

  // Message results
  for (var i = 0; i < this.results.length; i++) {
    var msg = this.results[i];
    var preview = this.getPreviewText(msg);
    var highlighted = this.highlightKeyword(escapeHtml(preview), this.query);
    var dateStr = this.formatResultDate(msg.created_at);
    var initial = (msg.sender || "?")[0].toUpperCase();

    html += '<div class="search-result-row' + (i === this.highlightedIndex ? ' highlighted' : '') + '" data-index="' + i + '" data-msg-id="' + msg.id + '">' +
      (msg.sender_avatar ? '<img class="search-result-row__avatar" src="' + escapeHtml(msg.sender_avatar) + '">' :
        '<div class="search-result-row__avatar-placeholder">' + initial + '</div>') +
      '<div class="search-result-row__body">' +
        '<div class="search-result-row__sender">' + escapeHtml(msg.sender) + '</div>' +
        '<div class="search-result-row__preview">' + highlighted + '</div>' +
      '</div>' +
      '<div class="search-result-row__date">' + dateStr + '</div>' +
    '</div>';
  }

  existing.innerHTML = html;
  existing.style.display = "flex";

  // Bind click events
  var self = this;
  existing.querySelectorAll(".search-result-row").forEach(function(row) {
    row.addEventListener("click", function() {
      var idx = parseInt(this.getAttribute("data-index"));
      self.jumpToResult(idx);
    });
  });
  existing.querySelectorAll(".search-user-card").forEach(function(card) {
    card.addEventListener("click", function() {
      self.userFilter = this.getAttribute("data-user-login");
      self.reSearch();
    });
  });

  // Infinite scroll (only attach once)
  if (!existing._scrollBound) {
    existing._scrollBound = true;
    existing.addEventListener("scroll", function() {
      if (SearchManager.nextCursor && existing.scrollTop + existing.clientHeight >= existing.scrollHeight - 100) {
        SearchManager.loadMore();
      }
    });
  }
},

showResultsOverlay: function() {
  var overlay = document.querySelector(".search-results-overlay");
  if (overlay) {
    overlay.style.display = "flex";
    overlay.classList.remove("dimmed");
  } else {
    this.renderResultsOverlay();
  }
},

hideResultsOverlay: function() {
  var overlay = document.querySelector(".search-results-overlay");
  if (overlay) overlay.style.display = "none";
},

getPreviewText: function(msg) {
  if (msg.content) return msg.content;
  if (msg.attachment_url) {
    var parts = msg.attachment_url.split("/");
    return parts[parts.length - 1] || "Attachment";
  }
  return "";
},

highlightKeyword: function(text, query) {
  if (!query) return text;
  var escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  var regex = new RegExp("(" + escaped + ")", "gi");
  return text.replace(regex, "<mark>$1</mark>");
},

// Safe keyword highlight for chat messages — walks text nodes only, never touches HTML tags
highlightTextNodes: function(el, query) {
  if (!query) return;
  var escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  var regex = new RegExp("(" + escaped + ")", "gi");
  var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
  var textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);
  textNodes.forEach(function(node) {
    if (!regex.test(node.textContent)) return;
    regex.lastIndex = 0;
    var span = document.createElement("span");
    span.innerHTML = node.textContent.replace(/[&<>"']/g, function(c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    }).replace(regex, '<span class="search-keyword-hl">$1</span>');
    node.parentNode.replaceChild(span, node);
  });
},

formatResultDate: function(dateStr) {
  if (!dateStr) return "";
  var d = new Date(dateStr);
  var now = new Date();
  var diffMs = now - d;
  var diffDays = Math.floor(diffMs / 86400000);

  if (diffDays === 0) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } else if (diffDays === 1) {
    return "Yesterday";
  } else if (diffDays < 7) {
    return d.toLocaleDateString([], { weekday: "short" });
  } else {
    var dd = d.getDate();
    var mm = String(d.getMonth() + 1).padStart(2, "0");
    var yy = String(d.getFullYear()).slice(-2);
    return dd + "/" + mm + "/" + yy;
  }
},

matchUsers: function(query) {
  if (!query || typeof groupMembersList === "undefined" || !groupMembersList.length) return [];
  var q = query.toLowerCase();
  return groupMembersList.filter(function(m) {
    return (m.login && m.login.toLowerCase().includes(q)) ||
           (m.name && m.name.toLowerCase().includes(q));
  });
},

updateHighlight: function() {
  document.querySelectorAll(".search-result-row").forEach(function(row, i) {
    row.classList.toggle("highlighted", i === SearchManager.highlightedIndex);
  });
  // Scroll highlighted into view
  var hl = document.querySelector(".search-result-row.highlighted");
  if (hl) hl.scrollIntoView({ block: "nearest" });
},

reSearch: function() {
  this.results = [];
  this.nextCursor = null;
  this.highlightedIndex = -1;
  this.state = "loading";
  this.renderSearchBar();
  this.renderResultsOverlay();
  if (this.query.trim()) {
    vscode.postMessage({
      type: "searchMessages",
      payload: { query: this.query, user: this.userFilter || undefined }
    });
  }
},

loadMore: function() {
  if (!this.nextCursor || this.state === "loading") return;
  this._pendingCursor = this.nextCursor;
  vscode.postMessage({
    type: "searchMessages",
    payload: { query: this.query, cursor: this.nextCursor, user: this.userFilter || undefined }
  });
},
```

- [ ] **Step 2: Add message handler for `searchResults` and `searchError`**

In the `window.addEventListener("message", ...)` switch statement (around line 170), add cases:

```javascript
case "searchResults": {
  if (SearchManager.state === "idle") break;
  // Stale response check
  if (msg.query !== SearchManager.query) break;
  // Detect pagination: if we had a cursor and results exist, append
  if (SearchManager._pendingCursor && SearchManager.results.length > 0) {
    SearchManager.results = SearchManager.results.concat(msg.messages || []);
  } else {
    SearchManager.results = msg.messages || [];
  }
  SearchManager._pendingCursor = null;
  SearchManager.nextCursor = msg.nextCursor || null;
  SearchManager.highlightedIndex = SearchManager.results.length > 0 ? 0 : -1;
  SearchManager.state = "results-list";
  SearchManager.renderSearchBar();
  SearchManager.renderResultsOverlay();
  break;
}
case "searchError": {
  if (SearchManager.state === "idle") break;
  SearchManager.state = "results-list";
  SearchManager.results = [];
  SearchManager.renderSearchBar();
  var overlay = document.querySelector(".search-results-overlay");
  if (overlay) {
    overlay.innerHTML = '<div class="search-results__empty">Search unavailable</div>';
    overlay.classList.remove("dimmed");
  }
  break;
}
```

- [ ] **Step 3: Add WebSocket message guard**

In the existing `case "receive"` / `case "newMessage"` handler (where incoming WS messages are rendered), add a guard at the top:

```javascript
// If search overlay is active, suppress message rendering (results are a snapshot)
if (SearchManager.state === "results-list" || SearchManager.state === "loading") {
  // Queue the message — it'll be rendered when search closes via reloadConversation
  break;
}
// If in chat-nav viewing old context, also suppress
if (SearchManager.state === "chat-nav" && _isViewingContext) {
  break;
}
```

- [ ] **Step 4: Test search flow end-to-end**

Open chat → click search → type query → verify results appear. Verify no results shows "No messages found". Verify error shows "Search unavailable".

- [ ] **Step 4: Commit**

```bash
git add media/webview/chat.js
git commit -m "feat(chat): add search results overlay rendering + API response handlers"
```

---

### Task 7: JS — Jump to message + chat navigation

**Files:**
- Modify: `media/webview/chat.js` (add methods to SearchManager + modify jumpToMessageResult handler)

- [ ] **Step 1: Add jump and navigation methods to SearchManager**

```javascript
// Add to SearchManager:

jumpToResult: function(index) {
  if (index < 0 || index >= this.results.length) return;
  this.currentResultIndex = index;
  this._searchKeyword = this.query;

  // Save snapshot before first jump
  if (!this.snapshot) {
    this.saveSnapshot();
  }

  var msgId = this.results[index].id;

  // Check if message is already in DOM
  var existing = document.querySelector('[data-msg-id-block="' + msgId + '"]') ||
      document.querySelector('[data-msg-id="' + msgId + '"]');
  if (existing) {
    this.state = "chat-nav";
    this.hideResultsOverlay();
    this.renderSearchBar();
    this.highlightMessage(existing);
    return;
  }

  // Need to load context from API
  this.state = "chat-nav";
  this.hideResultsOverlay();
  this.renderSearchBar();
  vscode.postMessage({ type: "jumpToMessage", payload: { messageId: msgId } });
},

navigateNext: function() {
  if (this.state !== "chat-nav") return;
  if (this._throttleTimer) return;
  var self = this;
  this._throttleTimer = setTimeout(function() { self._throttleTimer = null; }, 200);

  if (this.currentResultIndex < this.results.length - 1) {
    this.jumpToResult(this.currentResultIndex + 1);
  }
},

navigatePrev: function() {
  if (this.state !== "chat-nav") return;
  if (this._throttleTimer) return;
  var self = this;
  this._throttleTimer = setTimeout(function() { self._throttleTimer = null; }, 200);

  if (this.currentResultIndex > 0) {
    this.jumpToResult(this.currentResultIndex - 1);
  }
},

highlightMessage: function(el) {
  // Remove previous highlights
  document.querySelectorAll(".message.search-target, .message.search-target-fading").forEach(function(m) {
    m.classList.remove("search-target", "search-target-fading");
  });
  el.classList.add("search-target");
  el.scrollIntoView({ behavior: "smooth", block: "center" });

  // Highlight keyword in message text (walk text nodes to avoid corrupting HTML tags)
  if (this._searchKeyword) {
    var contentEl = el.querySelector(".msg-text");
    if (contentEl && !contentEl.querySelector(".search-keyword-hl")) {
      this.highlightTextNodes(contentEl, this._searchKeyword);
    }
  }

  // Fade out after 2s
  setTimeout(function() {
    el.classList.add("search-target-fading");
    setTimeout(function() {
      el.classList.remove("search-target", "search-target-fading");
    }, 2000);
  }, 2000);
},
```

- [ ] **Step 2: Modify existing `jumpToMessageResult` handler**

In the existing `case "jumpToMessageResult"` handler (~line 298-332), add search-aware highlighting. After the target message is scrolled into view, add:

```javascript
// After existing scrollIntoView logic (~line 323):
if (SearchManager.state === "chat-nav") {
  var targetEl = document.querySelector('.message[data-id="' + msg.targetMessageId + '"]');
  if (targetEl) {
    SearchManager.highlightMessage(targetEl);
  }
}
```

- [ ] **Step 3: Add keyboard support for chat-nav arrow keys**

Add a global keydown listener (at end of chat.js):

```javascript
document.addEventListener("keydown", function(e) {
  if (SearchManager.state === "chat-nav") {
    if (e.key === "ArrowUp") { e.preventDefault(); SearchManager.navigatePrev(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); SearchManager.navigateNext(); }
    else if (e.key === "Escape") { SearchManager.close(); }
  }
});
```

- [ ] **Step 4: Test navigation flow**

Search → click result → verify jump + highlight. Use ↑↓ arrows → verify navigation between results. Click input → verify back to results list. Press Escape → verify close + restore.

- [ ] **Step 5: Commit**

```bash
git add media/webview/chat.js
git commit -m "feat(chat): add jump-to-message + chat navigation with arrow keys and highlight"
```

---

### Task 8: JS — User filter dropdown

**Files:**
- Modify: `media/webview/chat.js` (add methods to SearchManager)

- [ ] **Step 1: Add user filter methods**

```javascript
// Add to SearchManager:

toggleUserFilter: function() {
  var existing = document.querySelector(".search-user-dropdown");
  if (existing) { existing.remove(); return; }

  var members = typeof groupMembersList !== "undefined" ? groupMembersList : [];
  if (!members.length) return;

  var dropdown = document.createElement("div");
  dropdown.className = "search-user-dropdown";

  var html = "";
  for (var i = 0; i < members.length; i++) {
    var m = members[i];
    var initial = (m.login || "?")[0].toUpperCase();
    html += '<div class="search-user-dropdown__item" data-login="' + escapeHtml(m.login) + '">' +
      (m.avatar_url ? '<img style="width:28px;height:28px;border-radius:50%;" src="' + escapeHtml(m.avatar_url) + '">' :
        '<div style="width:28px;height:28px;border-radius:50%;background:var(--gs-hover);display:flex;align-items:center;justify-content:center;font-size:12px;color:var(--gs-muted);">' + initial + '</div>') +
      '<span style="font-size:var(--gs-font-sm);color:var(--gs-fg);">' + escapeHtml(m.name || m.login) + '</span>' +
    '</div>';
  }
  dropdown.innerHTML = html;

  var bar = document.querySelector(".search-bar");
  if (bar) {
    bar.style.position = "relative";
    bar.appendChild(dropdown);
  }

  var self = this;
  dropdown.querySelectorAll(".search-user-dropdown__item").forEach(function(item) {
    item.addEventListener("click", function() {
      self.userFilter = this.getAttribute("data-login");
      dropdown.remove();
      self.reSearch();
    });
  });

  // Close on click outside
  setTimeout(function() {
    document.addEventListener("click", function handler(e) {
      if (!dropdown.contains(e.target)) {
        dropdown.remove();
        document.removeEventListener("click", handler);
      }
    });
  }, 0);
},
```

- [ ] **Step 2: Test user filter**

In a group chat → open search → click person icon → verify dropdown shows members. Click a member → verify badge appears in search bar + results filtered. Click ✕ on badge → verify filter removed.

- [ ] **Step 3: Commit**

```bash
git add media/webview/chat.js
git commit -m "feat(chat): add user filter dropdown for search"
```

---

### Task 9: JS — Date picker (Jump to Date)

**Files:**
- Modify: `media/webview/chat.js` (add methods to SearchManager)
- Modify: `media/webview/chat.js` (add `jumpToDateResult` and `jumpToDateFailed` handlers)

- [ ] **Step 1: Add date picker methods**

```javascript
// Add to SearchManager:

_datePickerYear: new Date().getFullYear(),

toggleDatePicker: function() {
  var existing = document.querySelector(".search-date-picker");
  if (existing) { existing.remove(); return; }

  this._datePickerYear = new Date().getFullYear();
  this.renderDatePicker();
},

renderDatePicker: function() {
  var existing = document.querySelector(".search-date-picker");
  if (existing) existing.remove();

  var picker = document.createElement("div");
  picker.className = "search-date-picker";

  var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var now = new Date();
  var currentMonth = now.getMonth();
  var currentYear = now.getFullYear();

  var html = '<div class="search-date-picker__header">' +
    '<button class="search-date-picker__prev"><i class="codicon codicon-chevron-left"></i></button>' +
    '<span class="search-date-picker__year">' + this._datePickerYear + '</span>' +
    '<button class="search-date-picker__next"><i class="codicon codicon-chevron-right"></i></button>' +
  '</div><div class="search-date-picker__grid">';

  for (var i = 0; i < 12; i++) {
    var isCurrent = (this._datePickerYear === currentYear && i === currentMonth);
    var isFuture = (this._datePickerYear > currentYear) || (this._datePickerYear === currentYear && i > currentMonth);
    html += '<button class="search-date-picker__month' + (isCurrent ? ' current' : '') + '"' +
      (isFuture ? ' disabled style="opacity:0.3;cursor:default;"' : '') +
      ' data-month="' + i + '">' + months[i] + '</button>';
  }
  html += '</div>';
  picker.innerHTML = html;

  var bar = document.querySelector(".search-bar");
  if (bar) {
    bar.style.position = "relative";
    bar.appendChild(picker);
  }

  var self = this;
  picker.querySelector(".search-date-picker__prev").addEventListener("click", function() {
    self._datePickerYear--;
    self.renderDatePicker();
  });
  picker.querySelector(".search-date-picker__next").addEventListener("click", function() {
    self._datePickerYear++;
    self.renderDatePicker();
  });
  picker.querySelectorAll(".search-date-picker__month:not([disabled])").forEach(function(btn) {
    btn.addEventListener("click", function() {
      var month = parseInt(this.getAttribute("data-month"));
      // Jump to 15th of that month (middle of month)
      var date = new Date(self._datePickerYear, month, 15);
      var iso = date.toISOString().split("T")[0];
      picker.remove();
      self.jumpToDate(iso);
    });
  });

  // Close on click outside
  setTimeout(function() {
    document.addEventListener("click", function handler(e) {
      if (!picker.contains(e.target) && !e.target.closest(".search-bar__filter-date")) {
        picker.remove();
        document.removeEventListener("click", handler);
      }
    });
  }, 0);
},

jumpToDate: function(dateStr) {
  if (!this.snapshot) this.saveSnapshot();
  this.state = "chat-nav";
  this.hideResultsOverlay();
  this.renderSearchBar();
  vscode.postMessage({ type: "jumpToDate", payload: { date: dateStr } });
},
```

- [ ] **Step 2: Add message handlers for `jumpToDateResult` and `jumpToDateFailed`**

In the postMessage switch statement:

```javascript
case "jumpToDateResult": {
  if (SearchManager.state !== "chat-nav") break;
  var messagesEl = document.getElementById("messages");
  if (messagesEl && msg.messages && msg.messages.length) {
    renderMessages(msg.messages);
    messagesEl.scrollTop = 0; // Start at top of loaded context
    _isViewingContext = true;
    _hasMoreAfter = msg.hasMoreAfter || false;
  }
  break;
}
case "jumpToDateFailed": {
  vscode.postMessage({ type: "showInfoMessage", text: "Jump to date not available yet" });
  break;
}
```

- [ ] **Step 3: Test date picker**

Open search → click calendar → verify year navigation + month grid. Click a month → verify chat jumps to that date.

- [ ] **Step 4: Commit**

```bash
git add media/webview/chat.js
git commit -m "feat(chat): add Jump to Date picker for search"
```

---

### Task 10: BE Requirements Doc

**Files:**
- Create: `docs/be-requirements-search.md`

- [ ] **Step 1: Write BE requirements document**

```markdown
# BE Requirements — In-Chat Message Search

## 1. Search Endpoint — Add `user` filter param (extend existing)

`GET /messages/conversations/{id}/search`

Current params: `q`, `cursor`, `limit`

**Add:**
- `user` (string, optional) — Filter results by sender login
- `total` (response field, optional) — Total result count

**Response (unchanged structure):**
```json
{
  "messages": [...],
  "nextCursor": "abc123",
  "total": 42
}
```

## 2. Jump to Date — New endpoint

`GET /messages/conversations/{id}/messages?around_date={ISO date}`

Returns ~20 messages centered around the given date.

**Response shape:** Same as existing message list response:
```json
{
  "messages": [...],
  "hasMoreBefore": true,
  "hasMoreAfter": true,
  "previousCursor": "...",
  "nextCursor": "..."
}
```

## 3. Message Context — No changes needed

`GET /messages/conversations/{id}/messages/{messageId}/context` — Already exists and works.

## Priority

1. `user` filter on search — Low effort, high value
2. `total` count on search — Low effort, nice to have
3. `around_date` endpoint — Medium effort, needed for Jump to Date feature
```

- [ ] **Step 2: Commit**

```bash
git add docs/be-requirements-search.md
git commit -m "docs(search): add BE requirements for in-chat search filters and jump to date"
```

---

### Task 11: Integration test + polish

**Files:**
- Modify: `media/webview/chat.js` (any fixes found during testing)
- Modify: `media/webview/chat.css` (any fixes found during testing)

- [ ] **Step 1: Full end-to-end test**

Test in VS Code with a real conversation:
1. Click search icon → search bar replaces header
2. Type query → results appear after debounce
3. Arrow keys highlight results in list
4. Enter/click → jumps to message in chat with highlight
5. ↑↓ navigate between results in chat
6. Click input → back to results list
7. Escape → close search, header restores
8. User filter (group only): click person → dropdown → select → badge + filtered results
9. Date picker: click calendar → pick month → chat jumps to date
10. Edge: empty query, no results, rapid typing

- [ ] **Step 2: Fix any issues found**

- [ ] **Step 3: Run build**

Run: `npm run compile`
Expected: No errors

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "fix(chat): polish search integration — fixes from E2E testing"
```

---

## Task Dependencies

```
Task 1 (API: user filter) ──┐
Task 2 (API: around_date) ──┤
                             ├──► Task 3 (chat.ts handlers) ──► Task 4 (CSS)
                             │                                      │
                             │                                      ▼
                             │                               Task 5 (SearchManager + bar)
                             │                                      │
                             │                                      ▼
                             │                               Task 6 (Results overlay)
                             │                                      │
                             │                                      ▼
                             │                               Task 7 (Jump + nav)
                             │                                      │
                             │                                      ▼
                             │                               Task 8 (User filter)
                             │                                      │
                             │                                      ▼
                             │                               Task 9 (Date picker)
                             │                                      │
Task 10 (BE doc) ────────────┘                                      ▼
                                                             Task 11 (Integration)
```

Tasks 1, 2, 10 can run in parallel. Tasks 5-9 are sequential (each builds on previous).
