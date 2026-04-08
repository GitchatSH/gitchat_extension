# Global Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add inline global search to the Explore panel with custom header (logo + search input), replacing native title bar actions, showing results in two sections (Repos / People).

**Architecture:** Custom header row injected above tabs in the explore webview. Search state managed in `explore.js` with debounced API calls via message passing to `explore.ts`. Results replace tabs+content when active.

**Tech Stack:** TypeScript (VS Code extension), vanilla JS (webview), CSS with `--gs-*` design tokens, VS Code Codicons.

---

### Task 1: Minimize Native Title Bar

**Files:**
- Modify: `package.json:279` (view name)
- Modify: `package.json:288-298` (view/title menus)

- [ ] **Step 1: Change view name to space**

In `package.json`, change the explore view name from `"Explore"` to `" "`:

```json
{
  "id": "trending.explore",
  "name": " ",
  "type": "webview",
  "visibility": "visible",
  "when": "trending.isSignedIn"
}
```

- [ ] **Step 2: Remove explore view/title menu actions**

In `package.json`, remove the two `view/title` menu entries for `trending.explore` (signIn and signOut). Keep the notification entries. The menus array becomes:

```json
"view/title": [
  {
    "command": "trending.notifications.refresh",
    "when": "view == trending.notifications",
    "group": "navigation"
  },
  {
    "command": "trending.notifications.markAllRead",
    "when": "view == trending.notifications",
    "group": "navigation"
  }
]
```

Sign-out is already available in the webview settings dropdown (`chat-setting-signout`).

- [ ] **Step 3: Verify build**

Run: `npm run compile`
Expected: No errors. Extension compiles.

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "feat(search): minimize native title bar for explore view"
```

---

### Task 2: Add Header HTML + Logo URI

**Files:**
- Modify: `src/webviews/explore.ts:403-425` (getHtml method)

- [ ] **Step 1: Add logo URI**

In `getHtml()`, after the existing URI declarations (line ~409), add:

```typescript
const logoUri = getUri(webview, this.extensionUri, ["media", "sidebar-icon.svg"]);
```

- [ ] **Step 2: Insert header HTML before tabs**

Replace the opening of the body HTML (just after `</head><body>`) to insert the new header before `.explore-tabs`. The HTML from `<!-- Main Tab Bar -->` onwards becomes:

```html
<!-- Search Header -->
<div class="explore-header">
  <img class="explore-logo" src="${logoUri}" alt="" width="16" height="16">
  <div class="search-wrapper">
    <span class="search-icon codicon codicon-search"></span>
    <input type="text" class="gs-input" id="global-search" placeholder="Search repos & people..." autocomplete="off">
    <button class="search-clear codicon codicon-close" id="search-clear" style="display:none" title="Clear search"></button>
  </div>
</div>

<!-- Main Tab Bar -->
<div class="explore-tabs">
```

- [ ] **Step 3: Add search results container**

After the closing `</div>` of `#pane-trending` (line ~510), add:

```html
<!-- Search Results -->
<div id="search-results" class="search-results" style="display:none">
  <div class="search-section" id="search-repos-section">
    <div class="gs-accordion-header" data-toggle="search-repos-list">
      <span class="gs-accordion-chevron codicon codicon-chevron-down"></span>
      <span class="gs-accordion-title">Repos</span>
      <span class="gs-accordion-count" id="search-repos-count"></span>
    </div>
    <div id="search-repos-list" class="gs-accordion-body"></div>
  </div>
  <div class="search-section" id="search-people-section">
    <div class="gs-accordion-header" data-toggle="search-people-list">
      <span class="gs-accordion-chevron codicon codicon-chevron-down"></span>
      <span class="gs-accordion-title">People</span>
      <span class="gs-accordion-count" id="search-people-count"></span>
    </div>
    <div id="search-people-list" class="gs-accordion-body"></div>
  </div>
  <div id="search-empty" class="gs-empty" style="display:none"></div>
</div>
```

- [ ] **Step 4: Verify build**

Run: `npm run compile`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/webviews/explore.ts
git commit -m "feat(search): add header HTML with logo and search input"
```

---

### Task 3: Header + Search CSS

**Files:**
- Modify: `media/webview/explore.css` (add at top, before existing `.explore-tabs` section)

- [ ] **Step 1: Add header CSS**

Insert at the very top of `explore.css`, before the `/* ===================== MAIN TAB BAR */` comment:

```css
/* ===================== SEARCH HEADER ===================== */
.explore-header {
  display: flex;
  align-items: center;
  height: 36px;
  padding: 0 12px 0 12px;
  background: var(--gs-bg);
  border-bottom: 1px solid var(--gs-divider);
  flex-shrink: 0;
  gap: 8px;
}
.explore-logo {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  opacity: 0.85;
}
.search-wrapper {
  flex: 1;
  position: relative;
  display: flex;
  align-items: center;
}
.search-wrapper .search-icon {
  position: absolute;
  left: 8px;
  font-size: 14px;
  color: var(--gs-muted);
  pointer-events: none;
}
.search-wrapper #global-search {
  width: 100%;
  padding: 4px 28px 4px 28px;
  font-size: 12px;
  height: 26px;
  box-sizing: border-box;
}
.search-wrapper .search-clear {
  position: absolute;
  right: 4px;
  background: none;
  border: none;
  color: var(--gs-muted);
  cursor: pointer;
  font-size: 12px;
  padding: 2px;
  border-radius: var(--gs-radius-xs);
}
.search-wrapper .search-clear:hover {
  color: var(--gs-fg);
  background: var(--gs-hover);
}

/* Loading spinner in search */
.search-wrapper .search-icon.loading {
  animation: searchSpin 0.8s linear infinite;
}
@keyframes searchSpin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
```

- [ ] **Step 2: Add search results CSS**

Append after the header CSS:

```css
/* ===================== SEARCH RESULTS ===================== */
.search-results {
  flex: 1;
  overflow-y: auto;
}
.search-results .search-section {
  border-bottom: 1px solid var(--gs-divider);
}
.search-results .search-section:last-child {
  border-bottom: none;
}

.search-repo-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px 6px 16px;
  cursor: pointer;
}
.search-repo-item:hover {
  background: var(--gs-hover);
}
.search-repo-info {
  flex: 1;
  min-width: 0;
}
.search-repo-name {
  font-size: 13px;
  color: var(--gs-link);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.search-repo-desc {
  font-size: 12px;
  color: var(--gs-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.search-repo-stat {
  font-size: 11px;
  color: var(--gs-muted);
  flex-shrink: 0;
}

.search-person-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px 6px 16px;
  cursor: pointer;
}
.search-person-item:hover {
  background: var(--gs-hover);
}
.search-person-avatar {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
}
.search-person-info {
  flex: 1;
  min-width: 0;
}
.search-person-name {
  font-size: 13px;
  color: var(--gs-fg);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.search-person-bio {
  font-size: 12px;
  color: var(--gs-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.search-person-action {
  padding: 3px 10px;
  font-size: 11px;
  font-family: inherit;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  flex-shrink: 0;
}
.search-person-action.follow-btn {
  background: var(--gs-button-bg);
  color: var(--gs-button-fg);
}
.search-person-action.chat-btn {
  background: var(--gs-button-secondary-bg);
  color: var(--gs-button-secondary-fg);
}
.search-person-action:hover {
  opacity: 0.8;
}
```

- [ ] **Step 3: Update body layout for new header**

The current `body` CSS at line 73-78 uses `height: 100vh` and flex column. The `.explore-tabs` has `flex-shrink: 0`. The new `.explore-header` also needs `flex-shrink: 0` (already set in Step 1). The `.search-results` needs `flex: 1` to fill remaining space (already set in Step 2).

Add this rule to handle the search-active layout state:

```css
/* When search is active, results take the flex space instead of tab-pane */
.search-results.active {
  display: flex;
  flex-direction: column;
}
```

- [ ] **Step 4: Verify build**

Run: `npm run compile`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add media/webview/explore.css
git commit -m "style(search): add header and search results CSS"
```

---

### Task 4: Search State & Message Handling (explore.js)

**Files:**
- Modify: `media/webview/explore.js` (add search state + event handlers)

- [ ] **Step 1: Add search state variables**

After line 4 (`var currentTab = "chat";`), add:

```javascript
// ===================== SEARCH STATE =====================
var searchMode = false;
var previousActiveTab = "chat";
var searchDebounceTimer = null;
```

- [ ] **Step 2: Add search event handlers**

After the main tab switching block (after the closing `});` of the `document.querySelectorAll(".explore-tab").forEach(...)` at line 55), add:

```javascript
// ===================== GLOBAL SEARCH =====================
(function initSearch() {
  var searchInput = document.getElementById("global-search");
  var searchClear = document.getElementById("search-clear");
  var searchIcon = document.querySelector(".search-wrapper .search-icon");

  function enterSearchMode() {
    if (searchMode) { return; }
    previousActiveTab = currentTab;
    searchMode = true;
    document.querySelector(".explore-tabs").style.display = "none";
    document.querySelectorAll(".tab-pane").forEach(function(p) { p.style.display = "none"; });
    document.getElementById("search-results").style.display = "flex";
  }

  function exitSearchMode() {
    if (!searchMode) { return; }
    searchMode = false;
    searchInput.value = "";
    searchClear.style.display = "none";
    searchIcon.classList.remove("loading");
    searchIcon.classList.remove("codicon-loading");
    searchIcon.classList.add("codicon-search");
    document.getElementById("search-results").style.display = "none";
    document.querySelector(".explore-tabs").style.display = "";
    document.querySelectorAll(".tab-pane").forEach(function(p) { p.style.display = ""; });
    // Re-activate the previous tab
    document.querySelectorAll(".explore-tab").forEach(function(t) {
      t.classList.toggle("active", t.dataset.tab === previousActiveTab);
    });
    document.querySelectorAll(".tab-pane").forEach(function(p) {
      p.classList.toggle("active", p.id === "pane-" + previousActiveTab);
    });
    currentTab = previousActiveTab;
  }

  function doSearch(query) {
    if (query.length < 2) { return; }
    // Show loading
    searchIcon.classList.remove("codicon-search");
    searchIcon.classList.add("codicon-loading", "loading");
    vscode.postMessage({ type: "globalSearch", payload: { query: query } });
  }

  searchInput.addEventListener("input", function() {
    var val = searchInput.value.trim();
    searchClear.style.display = val ? "inline-flex" : "none";

    clearTimeout(searchDebounceTimer);

    if (!val) {
      exitSearchMode();
      return;
    }

    enterSearchMode();

    if (val.length >= 2) {
      searchDebounceTimer = setTimeout(function() {
        doSearch(val);
      }, 300);
    }
  });

  searchInput.addEventListener("keydown", function(e) {
    if (e.key === "Enter") {
      var val = searchInput.value.trim();
      if (val.length >= 2) {
        clearTimeout(searchDebounceTimer);
        doSearch(val);
      }
    }
    if (e.key === "Escape") {
      exitSearchMode();
      searchInput.blur();
    }
  });

  searchClear.addEventListener("click", function() {
    exitSearchMode();
    searchInput.focus();
  });
})();
```

- [ ] **Step 3: Verify build**

Run: `npm run compile`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add media/webview/explore.js
git commit -m "feat(search): add search state management and event handlers"
```

---

### Task 5: Render Search Results (explore.js)

**Files:**
- Modify: `media/webview/explore.js` (add render functions + message handler)

- [ ] **Step 1: Add search results render functions**

After the `initSearch` IIFE from Task 4, add:

```javascript
// ===================== SEARCH RESULTS RENDERING =====================
function renderSearchResults(repos, users) {
  var searchIcon = document.querySelector(".search-wrapper .search-icon");
  searchIcon.classList.remove("loading", "codicon-loading");
  searchIcon.classList.add("codicon-search");

  var reposList = document.getElementById("search-repos-list");
  var peopleList = document.getElementById("search-people-list");
  var reposCount = document.getElementById("search-repos-count");
  var peopleCount = document.getElementById("search-people-count");
  var emptyEl = document.getElementById("search-empty");
  var reposSection = document.getElementById("search-repos-section");
  var peopleSection = document.getElementById("search-people-section");

  if ((!repos || repos.length === 0) && (!users || users.length === 0)) {
    reposSection.style.display = "none";
    peopleSection.style.display = "none";
    emptyEl.style.display = "block";
    emptyEl.textContent = "No results for '" + escapeHtml(document.getElementById("global-search").value.trim()) + "'";
    return;
  }

  emptyEl.style.display = "none";

  // Repos section
  if (repos && repos.length > 0) {
    reposSection.style.display = "";
    reposCount.textContent = "(" + repos.length + ")";
    reposList.innerHTML = repos.map(function(r) {
      var fullName = escapeHtml((r.owner || "") + "/" + (r.name || r.repo || ""));
      var desc = r.description ? escapeHtml(r.description) : "";
      var stars = r.stars != null ? formatCount(r.stars) : "";
      return '<div class="search-repo-item" data-owner="' + escapeHtml(r.owner || "") + '" data-repo="' + escapeHtml(r.name || r.repo || "") + '">'
        + '<div class="search-repo-info">'
        + '<div class="search-repo-name">' + fullName + '</div>'
        + (desc ? '<div class="search-repo-desc">' + desc + '</div>' : '')
        + '</div>'
        + (stars ? '<span class="search-repo-stat">\u2605 ' + stars + '</span>' : '')
        + '</div>';
    }).join("");
  } else {
    reposSection.style.display = "none";
  }

  // People section
  if (users && users.length > 0) {
    peopleSection.style.display = "";
    peopleCount.textContent = "(" + users.length + ")";
    peopleList.innerHTML = users.map(function(u) {
      var login = escapeHtml(u.login || "");
      var name = u.name ? escapeHtml(u.name) : "";
      var bio = u.bio ? escapeHtml(u.bio) : "";
      var avatar = u.avatar_url || avatarUrl(u.login);
      var isFriend = chatFriends.some(function(f) { return f.login === u.login; });
      var actionBtn = isFriend
        ? '<button class="search-person-action chat-btn" data-login="' + login + '" data-action="chat">Chat</button>'
        : '<button class="search-person-action follow-btn" data-login="' + login + '" data-action="follow">Follow</button>';
      return '<div class="search-person-item" data-login="' + login + '">'
        + '<img class="search-person-avatar" src="' + escapeHtml(avatar) + '" alt="">'
        + '<div class="search-person-info">'
        + '<div class="search-person-name">' + (name ? name + ' <span style="color:var(--gs-muted);font-weight:400">@' + login + '</span>' : '@' + login) + '</div>'
        + (bio ? '<div class="search-person-bio">' + bio + '</div>' : '')
        + '</div>'
        + actionBtn
        + '</div>';
    }).join("");
  } else {
    peopleSection.style.display = "none";
  }
}

function renderSearchError() {
  var searchIcon = document.querySelector(".search-wrapper .search-icon");
  searchIcon.classList.remove("loading", "codicon-loading");
  searchIcon.classList.add("codicon-search");

  document.getElementById("search-repos-section").style.display = "none";
  document.getElementById("search-people-section").style.display = "none";
  var emptyEl = document.getElementById("search-empty");
  emptyEl.style.display = "block";
  emptyEl.textContent = "Search failed. Try again.";
}
```

- [ ] **Step 2: Add click handlers for search results**

After the render functions, add:

```javascript
// Search results click delegation
document.getElementById("search-results").addEventListener("click", function(e) {
  // Handle action buttons (Follow / Chat) — stop propagation so row click doesn't fire
  var actionBtn = e.target.closest(".search-person-action");
  if (actionBtn) {
    e.stopPropagation();
    var login = actionBtn.dataset.login;
    var action = actionBtn.dataset.action;
    if (action === "follow") {
      doAction("followUser", { login: login });
      // Optimistic update
      actionBtn.textContent = "Chat";
      actionBtn.className = "search-person-action chat-btn";
      actionBtn.dataset.action = "chat";
    } else if (action === "chat") {
      doAction("message", { login: login });
    }
    return;
  }

  // Repo row click
  var repoItem = e.target.closest(".search-repo-item");
  if (repoItem) {
    doAction("viewRepo", { owner: repoItem.dataset.owner, repo: repoItem.dataset.repo });
    return;
  }

  // Person row click
  var personItem = e.target.closest(".search-person-item");
  if (personItem) {
    doAction("viewProfile", { login: personItem.dataset.login });
    return;
  }
});
```

- [ ] **Step 3: Add message listener for search results**

In the existing `window.addEventListener("message", ...)` handler in `explore.js`, add cases for `globalSearchResults` and `globalSearchError`. Find the message handler (look for `window.addEventListener("message"` block) and add inside the switch/if chain:

```javascript
    if (event.data.type === "globalSearchResults") {
      var payload = event.data.payload || {};
      renderSearchResults(payload.repos || [], payload.users || []);
    }
    if (event.data.type === "globalSearchError") {
      renderSearchError();
    }
```

- [ ] **Step 4: Verify build**

Run: `npm run compile`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add media/webview/explore.js
git commit -m "feat(search): render search results with repo/people sections"
```

---

### Task 6: Extension-Side Search Message Handler (explore.ts)

**Files:**
- Modify: `src/webviews/explore.ts:293-399` (onMessage switch)

- [ ] **Step 1: Add globalSearch case**

In the `onMessage` method, before the closing of the switch (before the final `}` around line 399), add a new case:

```typescript
      case "globalSearch": {
        const query = (p.query as string || "").trim();
        if (!query) { break; }
        try {
          const results = await apiClient.search(query);
          this.view?.webview.postMessage({
            type: "globalSearchResults",
            payload: { repos: results.repos || [], users: results.users || [] },
          });
        } catch (err) {
          log(`[Explore/Search] search failed: ${err}`, "warn");
          this.view?.webview.postMessage({ type: "globalSearchError" });
        }
        break;
      }
      case "viewProfile": {
        const login = p.login as string;
        if (login) { vscode.commands.executeCommand("trending.viewProfile", login); }
        break;
      }
```

Note: `viewRepo` case already exists (line ~354). `followUser` case already exists (line ~360). `message` case already exists (line ~379). `viewProfile` is new — add it.

- [ ] **Step 2: Verify build**

Run: `npm run compile`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/webviews/explore.ts
git commit -m "feat(search): add extension-side search message handler"
```

---

### Task 7: Manual Testing & Polish

**Files:**
- All files from previous tasks

- [ ] **Step 1: Test in VS Code**

1. Run extension (`F5` in VS Code)
2. Open sidebar — verify header with logo + search input appears
3. Native title bar should be minimal (no "EXPLORE" text, no logout icon)
4. Type "react" in search — verify:
   - Debounce: no API call while typing fast
   - Loading spinner appears
   - Results show with Repos and People sections
   - Tabs are hidden
5. Click a repo result — verify RepoDetailPanel opens
6. Click a person result — verify ProfilePanel opens
7. Click Follow button — verify it changes to Chat (optimistic)
8. Click Chat button — verify DM opens
9. Click X to clear — verify tabs return to previous active tab
10. Press Escape — verify same behavior as clear
11. Type 1 character — verify no API call
12. Type "asdfghjklzxcvbnm" — verify "No results" message

- [ ] **Step 2: Fix any issues found**

Address any visual or functional issues from testing.

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "fix(search): polish from manual testing"
```

(Only if changes were needed.)
