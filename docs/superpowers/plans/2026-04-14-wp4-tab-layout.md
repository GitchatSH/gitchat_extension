# WP4 Tab Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the Explore panel from Inbox|Friends|Channels to Chat|Friends|Discover with filter chips, accordion sections, type-aware display, and tab-aware search.

**Architecture:** Monolith rewrite in explore.js/explore.css. New branch from develop. All 3 tabs render in a single JS file with shared state. Accordion and filter chip logic built on existing shared.css components.

**Tech Stack:** TypeScript (explore.ts), vanilla JS (explore.js), CSS (explore.css), VS Code Webview API, Codicons

**Spec:** `docs/superpowers/specs/2026-04-14-wp4-tab-layout-design.md`

---

## File Structure

| File | Responsibility | Action |
|------|---------------|--------|
| `src/webviews/explore.ts` | Tab HTML, filter chips HTML, search bar, postMessage data flow | Modify (lines 975-1015 tab/filter HTML) |
| `media/webview/explore.js` | Tab switching, accordion, render functions, state persistence | Modify (major rewrite ~2186 lines) |
| `media/webview/explore.css` | Accordion colors, avatar shapes, icon prefix, skeletons | Modify (remove Feed/Trending styles, add new) |
| `media/webview/shared.css` | No changes — reuse existing components | Read-only reference |

---

## Task 1: Create branch + cleanup Feed/Trending dead code

**Files:**
- Modify: `media/webview/explore.js` (remove lines 32-57 state vars, 938-960 initFeed, 966-1186 render functions, 1285-1325 message handlers, 1430+ hovercard)
- Modify: `media/webview/explore.css` (remove lines 449-457 feed pane, 542-674 feed styles, 716-1196 trending styles)
- Modify: `src/webviews/explore.ts` (remove Feed/Trending postMessage calls if any)

- [ ] **Step 1: Create new branch from develop**

```bash
git fetch origin
git checkout develop && git pull origin develop
git checkout -b slug-wp4-tab-layout-v2
```

- [ ] **Step 2: Remove Feed/Trending state variables from explore.js**

Remove these global variables (lines ~32-57):
- `feedEvents`, `feedActiveFilter`, and all feed-related vars
- `trendingRepos`, `trendingReposStarred`, `trendingPeople`, `trendingPeopleFollow`, `trendingSuggestions`, `trendingSubTab`
- `myRepos`, `myStarred`

- [ ] **Step 3: Remove Feed/Trending render functions from explore.js**

Remove these functions:
- `initFeed()` (~lines 938-960)
- `renderFeed()`, `renderFeedEvent()` (~lines 966-1071)
- `renderTrending()`, `renderTrendingRepos()`, `renderTrendingPeople()`, `renderTrendingSuggestions()` (~lines 1072-1186)
- `showTrendingHoverCard()` (~line 1430+)

- [ ] **Step 4: Remove Feed/Trending message handlers from explore.js**

Remove these cases from the message handler (~lines 1285-1325):
- `setFeedEvents`
- `setTrendingRepos`, `setTrendingPeople`, `setTrendingSuggestions`
- `showTrendingHoverCard`

- [ ] **Step 5: Remove Feed/Trending CSS from explore.css**

Remove these style blocks:
- Feed tab pane styles (~lines 449-457)
- Feed event styles (~lines 542-674)
- Trending tab pane (~lines 716-885)
- Trending repo card styles (~lines 886-1014)
- Trending people card styles (~lines 1015-1196)

- [ ] **Step 6: Verify compile passes**

```bash
npm run compile
```

Expected: no errors. If type errors appear from removed code, trace and remove the dead references.

- [ ] **Step 7: Commit**

```bash
git add media/webview/explore.js media/webview/explore.css src/webviews/explore.ts
git commit -m "chore(cleanup): remove Feed/Trending dead code from explore panel"
```

---

## Task 2: Rename tabs — Inbox→Chat, Channels→Discover

**Files:**
- Modify: `src/webviews/explore.ts:975-979` (tab HTML buttons)
- Modify: `media/webview/explore.js:6,18,130,132-179` (tab state + click handlers)

- [ ] **Step 1: Update tab HTML in explore.ts**

Change the main tab buttons (~line 975-979) from:
```html
<button class="gs-main-tab active" data-tab="inbox">Inbox</button>
<button class="gs-main-tab" data-tab="friends">Friends</button>
<button class="gs-main-tab" data-tab="channels">Channels</button>
```
To:
```html
<button class="gs-main-tab active" data-tab="chat">Chat <span id="chat-main-badge" class="tab-badge" style="display:none"></span></button>
<button class="gs-main-tab" data-tab="friends">Friends</button>
<button class="gs-main-tab" data-tab="discover">Discover</button>
```

- [ ] **Step 2: Update state variables in explore.js**

- Change `currentTab = "inbox"` → `currentTab = "chat"` (line ~6)
- Keep `chatSubTab` for now (will be reworked in Task 5 when Friends tab replaces the old friends rendering)
- Change `chatMainTab = "inbox"` → `chatMainTab = "chat"` (line ~130)

- [ ] **Step 3: Update tab click handler in explore.js**

Update the main tab click handler (~lines 132-179) to use new tab names: `"chat"`, `"friends"`, `"discover"`. Update visibility logic:
- `"chat"`: show `#chat-filter-bar`, show `#chat-content`, hide `#friends-content`, hide `#discover-content`
- `"friends"`: hide `#chat-filter-bar`, hide `#chat-content`, show `#friends-content`, hide `#discover-content`
- `"discover"`: hide `#chat-filter-bar`, hide `#chat-content`, hide `#friends-content`, show `#discover-content`

- [ ] **Step 4: Update state persistence in explore.js**

In `restoreState()` (~line 2144), add backward compat migration:
```javascript
if (state.chatMainTab === "inbox") chatMainTab = "chat";
else if (state.chatMainTab === "channels") chatMainTab = "discover";
else if (["chat", "friends", "discover"].indexOf(state.chatMainTab) !== -1) chatMainTab = state.chatMainTab;
else chatMainTab = "chat"; // fallback for unknown values
```

- [ ] **Step 5: Verify compile + basic tab switching works**

```bash
npm run compile
```

- [ ] **Step 6: Commit**

```bash
git add src/webviews/explore.ts media/webview/explore.js
git commit -m "refactor(tabs): rename Inbox→Chat, Channels→Discover + state migration"
```

---

## Task 3: Update filter chips — All|DM|Groups|Communities|Teams

**Files:**
- Modify: `src/webviews/explore.ts:1010-1015` (filter bar HTML)
- Modify: `media/webview/explore.js:20,467-551` (filter state + chip handlers)

- [ ] **Step 1: Update filter bar HTML in explore.ts**

Replace the filter bar (~lines 1010-1015) with:
```html
<div id="chat-filter-bar" class="gs-filter-bar" style="display:flex" role="radiogroup" aria-label="Filter conversations">
  <button class="gs-chip active" data-filter="all" role="radio" aria-checked="true">All <span class="gs-chip-count" id="chat-count-all"></span></button>
  <button class="gs-chip" data-filter="dm" role="radio" aria-checked="false">DM <span class="gs-chip-count" id="chat-count-dm"></span></button>
  <button class="gs-chip" data-filter="group" role="radio" aria-checked="false">Groups <span class="gs-chip-count" id="chat-count-group"></span></button>
  <button class="gs-chip" data-filter="community" role="radio" aria-checked="false">Communities <span class="gs-chip-count" id="chat-count-community"></span></button>
  <button class="gs-chip" data-filter="team" role="radio" aria-checked="false">Teams <span class="gs-chip-count" id="chat-count-team"></span></button>
</div>
```

- [ ] **Step 2: Update filter state in explore.js**

Change `chatInboxFilter = "all"` (line ~20) — keep as `"all"` but rename to `chatFilter`:
```javascript
var chatFilter = "all"; // "all" | "dm" | "group" | "community" | "team"
```

- [ ] **Step 3: Update chip click handler in explore.js**

Update the filter chip click handler (~lines 467-551) to:
- Set `chatFilter` to the `data-filter` value
- Update `aria-checked` on all chips
- Call `renderChatInbox()`
- Add keyboard handler: arrow keys navigate chips, Enter/Space activates

- [ ] **Step 4: Update filter logic in renderChatInbox()**

Update the conversation filtering (~line 683+) to use new filter values:
```javascript
var filtered = chatConversations;
if (chatFilter === "dm") filtered = filtered.filter(function(c) { return c.type === "direct"; });
else if (chatFilter === "group") filtered = filtered.filter(function(c) { return c.type === "group"; });
else if (chatFilter === "community") filtered = filtered.filter(function(c) { return c.type === "community"; });
else if (chatFilter === "team") filtered = filtered.filter(function(c) { return c.type === "team"; });
```

- [ ] **Step 5: Update count badge logic**

Add/update `updateChatFilterCounts()` function:
```javascript
function updateChatFilterCounts() {
  var all = chatConversations.length;
  var dm = chatConversations.filter(function(c) { return c.type === "direct"; }).length;
  var group = chatConversations.filter(function(c) { return c.type === "group"; }).length;
  var el;
  el = document.getElementById("chat-count-all"); if (el) el.textContent = all ? "(" + all + ")" : "";
  el = document.getElementById("chat-count-dm"); if (el) el.textContent = dm ? "(" + dm + ")" : "";
  el = document.getElementById("chat-count-group"); if (el) el.textContent = group ? "(" + group + ")" : "";
  var community = chatConversations.filter(function(c) { return c.type === "community"; }).length;
  var team = chatConversations.filter(function(c) { return c.type === "team"; }).length;
  el = document.getElementById("chat-count-community"); if (el) el.textContent = community ? "(" + community + ")" : "";
  el = document.getElementById("chat-count-team"); if (el) el.textContent = team ? "(" + team + ")" : "";
}
```

- [ ] **Step 6: Verify compile**

```bash
npm run compile
```

- [ ] **Step 7: Commit**

```bash
git add src/webviews/explore.ts media/webview/explore.js
git commit -m "feat(chat): update filter chips — All, DM, Groups, Communities, Teams"
```

---

## Task 4: Type display — avatar shapes + codicon prefix + online dot

**Files:**
- Modify: `media/webview/explore.js` (renderChatInbox conversation row HTML)
- Modify: `media/webview/explore.css` (avatar shape override, dot positioning, icon prefix)

- [ ] **Step 1: Add CSS for avatar shapes and online dot in explore.css**

```css
/* Square rounded avatar for group/community/team */
.conv-avatar--square {
  border-radius: 6px;
}

/* Avatar wrapper for status dot positioning */
.conv-avatar-wrap {
  position: relative;
  display: inline-flex;
  width: 36px;
  height: 36px;
  flex-shrink: 0;
}
.conv-avatar-wrap .gs-dot-online,
.conv-avatar-wrap .gs-dot-offline {
  position: absolute;
  bottom: -1px;
  right: -1px;
  border: 1.5px solid var(--gs-bg);
}

/* Type icon prefix before conversation name */
.conv-type-icon {
  color: var(--gs-muted);
  font-size: 14px;
  margin-right: 4px;
  flex-shrink: 0;
}
```

- [ ] **Step 2: Update conversation row rendering in explore.js**

In `renderChatInbox()`, update the avatar HTML generation per conversation type:

For DM (type === "direct"):
```html
<div class="conv-avatar-wrap">
  <img class="gs-avatar gs-avatar-md" src="..." />
  <span class="gs-dot-online"></span>  <!-- or gs-dot-offline -->
</div>
```

For Group (type === "group"):
```html
<div class="conv-avatar-wrap">
  <img class="gs-avatar gs-avatar-md conv-avatar--square" src="..." />
</div>
<!-- In name area: -->
<span class="conv-type-icon codicon codicon-organization"></span>
<span class="conv-name">Group Name</span>
```

For Community (future — type === "community"):
```html
<span class="conv-type-icon codicon codicon-star"></span>
```

For Team (future — type === "team"):
```html
<span class="conv-type-icon codicon codicon-git-pull-request"></span>
```

- [ ] **Step 3: Add online/offline status logic for DM conversations**

Check `conversation.participants` to find the other user, check their `online` field against `chatFriends`:
```javascript
function getDMOnlineStatus(conv) {
  if (conv.type !== "direct") return null;
  var otherUser = conv.participants && conv.participants.find(function(p) {
    return p.login !== chatCurrentUser;
  });
  if (!otherUser) return null;
  var friend = chatFriends.find(function(f) { return f.login === otherUser.login; });
  return friend ? (friend.online ? "online" : "offline") : null;
}
```

- [ ] **Step 4: Verify compile + visual check**

```bash
npm run compile
```

- [ ] **Step 5: Commit**

```bash
git add media/webview/explore.js media/webview/explore.css
git commit -m "feat(chat): type display — avatar shapes, codicon prefix, online dot"
```

---

## Task 5: Friends tab — accordion layout

**Files:**
- Modify: `src/webviews/explore.ts` (add friends content container to HTML)
- Modify: `media/webview/explore.js` (new renderFriends() function + accordion logic)
- Modify: `media/webview/explore.css` (accordion section colors, friend row styles)

- [ ] **Step 1: Add Friends tab content container in explore.ts**

Inside the nav container HTML (~line 991+), add after `#chat-content`:
```html
<div id="friends-content" style="display:none; flex-direction:column; flex:1; overflow-y:auto;"></div>
```

- [ ] **Step 2: Add accordion CSS in explore.css**

```css
/* Friends accordion section colors */
.gs-accordion-title--online { color: var(--gs-success); }
.gs-accordion-title--offline { color: var(--gs-muted); }
.gs-accordion-title--notongitchat { color: var(--gs-muted); opacity: 0.5; }

/* Accordion count badge base */
.gs-accordion-count {
  margin-left: auto;
  font-size: var(--gs-font-xs);
  color: var(--gs-muted);
  padding: 0 6px;
  border-radius: var(--gs-radius-pill);
}

/* Online count badge green tint */
.gs-accordion-count--online {
  background: color-mix(in srgb, var(--gs-success) 15%, transparent);
  color: var(--gs-success);
}

/* Friend row */
.friend-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px var(--gs-inset-x);
  cursor: pointer;
}
.friend-row:hover {
  background: var(--gs-hover);
}

/* Offline avatar dimmed */
.friend-avatar--offline {
  opacity: 0.5;
}

/* Not on GitChat avatar grayscale */
.friend-avatar--grayscale {
  filter: grayscale(1);
}

/* Last seen text */
.friend-lastseen {
  color: var(--gs-muted);
  font-size: var(--gs-font-xs);
}
```

- [ ] **Step 3: Write renderFriends() function in explore.js**

```javascript
function renderFriends() {
  var container = document.getElementById("friends-content");
  if (!container) return;

  // Tab-level empty state
  if (!chatFriends || chatFriends.length === 0) {
    container.innerHTML = '<div class="gs-empty"><span class="codicon codicon-person-add"></span><p>Follow people on GitHub to see them here</p></div>';
    return;
  }

  var online = chatFriends.filter(function(f) { return f.online; })
    .sort(function(a, b) { return (a.login || "").localeCompare(b.login || ""); });
  var offline = chatFriends.filter(function(f) { return !f.online; })
    .sort(function(a, b) { return (b.lastSeen || 0) - (a.lastSeen || 0); });

  // Apply search filter
  if (chatSearchQuery) {
    var q = chatSearchQuery.toLowerCase();
    online = online.filter(function(f) { return (f.login || "").toLowerCase().indexOf(q) !== -1; });
    offline = offline.filter(function(f) { return (f.login || "").toLowerCase().indexOf(q) !== -1; });
  }

  var state = getAccordionState("friends");
  var html = "";

  // Online section
  html += buildAccordionSection("friends", "online", "ONLINE", online.length, state.online !== false, "online",
    online.map(function(f) { return buildFriendRow(f, "online"); }).join("") || '<div class="gs-empty gs-text-sm">No friends online</div>'
  );

  // Offline section
  html += buildAccordionSection("friends", "offline", "OFFLINE", offline.length, state.offline !== false, "offline",
    offline.map(function(f) { return buildFriendRow(f, "offline"); }).join("") || '<div class="gs-empty gs-text-sm">No offline friends</div>'
  );

  // Not on GitChat section (placeholder)
  html += buildAccordionSection("friends", "notongitchat", "NOT ON GITCHAT", 0, state.notongitchat === true, "notongitchat",
    '<div class="gs-empty gs-text-sm">Coming soon</div>'
  );

  container.innerHTML = html;
  bindAccordionHandlers("friends");
  bindFriendRowHandlers(container);
}
```

- [ ] **Step 4: Write buildAccordionSection() helper**

```javascript
function buildAccordionSection(tab, key, title, count, expanded, colorClass, bodyHtml) {
  var hId = tab + "-header-" + key;
  var bId = tab + "-body-" + key;
  var collapsed = expanded ? "" : " collapsed";
  return '<div class="gs-accordion-section">' +
    '<div class="gs-accordion-header' + collapsed + '" id="' + hId + '" data-accordion="' + tab + '-' + key + '" ' +
    'role="button" aria-expanded="' + expanded + '" aria-controls="' + bId + '" tabindex="0">' +
    '<span class="codicon codicon-chevron-down gs-accordion-chevron"></span>' +
    '<span class="gs-accordion-title gs-accordion-title--' + colorClass + '">' + title + '</span>' +
    '<span class="gs-accordion-count gs-accordion-count--' + colorClass + '">' + count + '</span>' +
    '</div>' +
    '<div class="gs-accordion-body' + collapsed + '" id="' + bId + '" role="region" aria-labelledby="' + hId + '">' +
    bodyHtml +
    '</div></div>';
}
```

- [ ] **Step 5: Write buildFriendRow() helper**

```javascript
function buildFriendRow(friend, section) {
  var avatarClass = section === "offline" ? " friend-avatar--offline" : "";
  var dotHtml = section === "online" ? '<span class="gs-dot-online"></span>' : '';
  var lastSeen = section === "offline" && friend.lastSeen
    ? ' <span class="friend-lastseen">· ' + timeAgo(friend.lastSeen) + '</span>'
    : '';
  var btnHtml = '<button class="gs-btn gs-btn-ghost friend-dm-btn" data-login="' + friend.login + '" title="Send message">DM</button>';

  return '<div class="friend-row gs-row-item" data-login="' + friend.login + '">' +
    '<div class="conv-avatar-wrap">' +
    '<img class="gs-avatar-md' + avatarClass + '" src="' + avatarUrl(friend.avatar_url || friend.avatarUrl, 36) + '" />' +
    dotHtml +
    '</div>' +
    '<span class="gs-flex-1 gs-truncate">' + escapeHtml(friend.login || friend.name || "") + lastSeen + '</span>' +
    btnHtml +
    '</div>';
}
```

- [ ] **Step 6: Write accordion state helpers**

```javascript
function getAccordionState(tab) {
  var s = vscode.getState() || {};
  if (!s.accordionState) return {};
  return s.accordionState[tab] || {};
}

function setAccordionState(tab, key, expanded) {
  var s = vscode.getState() || {};
  if (!s.accordionState) s.accordionState = {};
  if (!s.accordionState[tab]) s.accordionState[tab] = {};
  s.accordionState[tab][key] = expanded;
  vscode.setState(s);
}

function bindAccordionHandlers(tab) {
  document.querySelectorAll('[data-accordion^="' + tab + '-"]').forEach(function(header) {
    header.addEventListener("click", function() { toggleAccordion(header, tab); });
    header.addEventListener("keydown", function(e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleAccordion(header, tab); }
    });
  });
}

function toggleAccordion(header, tab) {
  var key = header.dataset.accordion.replace(tab + "-", "");
  var body = document.getElementById(header.getAttribute("aria-controls"));
  var expanded = header.classList.contains("collapsed");
  header.classList.toggle("collapsed");
  if (body) body.classList.toggle("collapsed");
  header.setAttribute("aria-expanded", String(expanded));
  setAccordionState(tab, key, expanded);
}
```

- [ ] **Step 7: Write bindFriendRowHandlers()**

```javascript
function bindFriendRowHandlers(container) {
  // Row click → profile
  container.querySelectorAll(".friend-row").forEach(function(row) {
    row.addEventListener("click", function() {
      vscode.postMessage({ type: "viewProfile", payload: { login: row.dataset.login } });
    });
    // Profile card hover on avatar
    var avatar = row.querySelector(".gs-avatar-md");
    if (avatar && typeof window.ProfileCard !== "undefined" && window.ProfileCard.bindTrigger) {
      window.ProfileCard.bindTrigger(avatar, row.dataset.login);
    }
  });
  // DM button click → open chat (stopPropagation)
  container.querySelectorAll(".friend-dm-btn").forEach(function(btn) {
    btn.addEventListener("click", function(e) {
      e.stopPropagation();
      vscode.postMessage({ type: "chatOpenDM", payload: { login: btn.dataset.login } });
    });
  });
}
```

- [ ] **Step 8: Update tab click handler to call renderFriends()**

In the tab click handler, when `chatMainTab === "friends"`, call `renderFriends()`.

- [ ] **Step 9: Verify compile + visual check**

```bash
npm run compile
```

- [ ] **Step 10: Commit**

```bash
git add src/webviews/explore.ts media/webview/explore.js media/webview/explore.css
git commit -m "feat(friends): accordion layout — Online, Offline, Not on GitChat"
```

---

## Task 6: Discover tab — accordion layout

**Files:**
- Modify: `src/webviews/explore.ts` (add discover content container)
- Modify: `media/webview/explore.js` (new renderDiscover() function)
- Modify: `media/webview/explore.css` (discover-specific styles)

- [ ] **Step 1: Add Discover tab content container in explore.ts**

After `#friends-content`, add:
```html
<div id="discover-content" style="display:none; flex-direction:column; flex:1; overflow-y:auto;"></div>
```

- [ ] **Step 2: Write renderDiscover() function in explore.js**

```javascript
function renderDiscover() {
  var container = document.getElementById("discover-content");
  if (!container) return;

  var state = getAccordionState("discover");
  var people = chatFriends || [];
  var communities = chatChannels || [];
  var onlineNow = (chatFriends || []).filter(function(f) { return f.online; });

  // Apply search filter
  if (chatSearchQuery) {
    var q = chatSearchQuery.toLowerCase();
    people = people.filter(function(f) { return (f.login || "").toLowerCase().indexOf(q) !== -1; });
    communities = communities.filter(function(c) { return (c.name || "").toLowerCase().indexOf(q) !== -1; });
    onlineNow = onlineNow.filter(function(f) { return (f.login || "").toLowerCase().indexOf(q) !== -1; });
  }

  var html = "";

  // People section
  html += buildAccordionSection("discover", "people", "PEOPLE", people.length, state.people !== false, "default",
    people.map(function(f) { return buildDiscoverPersonRow(f); }).join("") ||
    '<div class="gs-empty gs-text-sm"><span class="codicon codicon-person"></span> Follow people on GitHub to see them here</div>'
  );

  // Communities section
  html += buildAccordionSection("discover", "communities", "COMMUNITIES", communities.length, state.communities !== false, "default",
    communities.map(function(c) { return buildDiscoverCommunityRow(c); }).join("") ||
    '<div class="gs-empty gs-text-sm"><span class="codicon codicon-star"></span> Star repos on GitHub to discover communities</div>'
  );

  // Teams section (placeholder)
  html += buildAccordionSection("discover", "teams", "TEAMS", 0, state.teams === true, "default",
    '<div class="gs-empty gs-text-sm"><span class="codicon codicon-git-pull-request"></span> Contribute to repos to join their teams</div>'
  );

  // Online Now section
  html += buildAccordionSection("discover", "onlinenow", "ONLINE NOW", onlineNow.length, state.onlinenow !== false, "online",
    onlineNow.map(function(f) { return buildDiscoverOnlineRow(f); }).join("") ||
    '<div class="gs-empty gs-text-sm"><span class="codicon codicon-circle-outline"></span> No one online right now</div>'
  );

  container.innerHTML = html;
  bindAccordionHandlers("discover");
  bindDiscoverRowHandlers(container);
}
```

- [ ] **Step 3: Write row builder helpers**

```javascript
function buildDiscoverPersonRow(friend) {
  return '<div class="friend-row gs-row-item" data-login="' + friend.login + '">' +
    '<img class="gs-avatar gs-avatar-md" src="' + avatarUrl(friend.avatar_url || friend.avatarUrl, 36) + '" />' +
    '<span class="gs-flex-1 gs-truncate">' + escapeHtml(friend.login || "") + '</span>' +
    '<button class="gs-btn gs-btn-ghost friend-dm-btn" data-login="' + friend.login + '">DM</button>' +
    '</div>';
}

function buildDiscoverCommunityRow(channel) {
  var memberCount = channel.member_count || 0;
  var joined = channel.joined ? "Joined" : "Join";
  var btnClass = channel.joined ? "gs-btn-ghost" : "gs-btn-primary";
  var repoName = channel.repo_full_name || channel.name || "";
  return '<div class="friend-row gs-row-item discover-community-row" data-repo="' + escapeHtml(repoName) + '">' +
    '<span class="conv-type-icon codicon codicon-star"></span>' +
    '<span class="gs-flex-1 gs-truncate">' + escapeHtml(repoName) + '</span>' +
    '<span class="gs-text-xs gs-text-muted">' + memberCount + '</span>' +
    '<button class="gs-btn ' + btnClass + ' discover-join-btn">' + joined + '</button>' +
    '</div>';
}

function buildDiscoverOnlineRow(friend) {
  return '<div class="friend-row gs-row-item" data-login="' + friend.login + '">' +
    '<div class="conv-avatar-wrap">' +
    '<img class="gs-avatar gs-avatar-md" src="' + avatarUrl(friend.avatar_url || friend.avatarUrl, 36) + '" />' +
    '<span class="gs-dot-online"></span>' +
    '</div>' +
    '<span class="gs-flex-1 gs-truncate">' + escapeHtml(friend.login || "") + '</span>' +
    '<button class="gs-btn gs-btn-ghost" disabled title="Coming soon">Wave</button>' +
    '</div>';
}
```

- [ ] **Step 4: Write bindDiscoverRowHandlers()**

```javascript
function bindDiscoverRowHandlers(container) {
  // People rows → profile
  container.querySelectorAll(".friend-row:not(.discover-community-row)").forEach(function(row) {
    if (!row.dataset.login) return;
    row.addEventListener("click", function() {
      vscode.postMessage({ type: "viewProfile", payload: { login: row.dataset.login } });
    });
    var avatar = row.querySelector(".gs-avatar-md");
    if (avatar && typeof window.ProfileCard !== "undefined" && window.ProfileCard.bindTrigger) {
      window.ProfileCard.bindTrigger(avatar, row.dataset.login);
    }
  });
  // Community rows → join community (WP5 handler)
  container.querySelectorAll(".discover-community-row").forEach(function(row) {
    row.addEventListener("click", function() {
      vscode.postMessage({ type: "joinCommunity", payload: { type: "community", repoFullName: row.dataset.repo } });
    });
  });
  // Join buttons (stopPropagation)
  container.querySelectorAll(".discover-join-btn").forEach(function(btn) {
    btn.addEventListener("click", function(e) {
      e.stopPropagation();
      var row = btn.closest(".discover-community-row");
      if (row) vscode.postMessage({ type: "joinCommunity", payload: { type: "community", repoFullName: row.dataset.repo } });
    });
  });
  // DM buttons
  container.querySelectorAll(".friend-dm-btn").forEach(function(btn) {
    btn.addEventListener("click", function(e) {
      e.stopPropagation();
      vscode.postMessage({ type: "chatOpenDM", payload: { login: btn.dataset.login } });
    });
  });
}
```

- [ ] **Step 5: Add chatChannels state variable (should already be declared from Step 2 dependency)**

Ensure this variable exists near the top of explore.js (add if not already there):
```javascript
var chatChannels = [];
var chatDataLoaded = false; // track if initial data has arrived
```

Update the `setChannelData` message handler to store channels:
```javascript
case "setChannelData":
  chatChannels = data.channels || [];
  if (chatMainTab === "discover") renderDiscover();
  break;
```

- [ ] **Step 6: Update tab click handler to call renderDiscover()**

When `chatMainTab === "discover"`, call `renderDiscover()` and `vscode.postMessage({ type: "fetchChannels" })`.

- [ ] **Step 7: Verify compile + visual check**

```bash
npm run compile
```

- [ ] **Step 8: Commit**

```bash
git add src/webviews/explore.ts media/webview/explore.js media/webview/explore.css
git commit -m "feat(discover): accordion layout — People, Communities, Teams, Online Now"
```

---

## Task 7: Tab-aware search

**Files:**
- Modify: `media/webview/explore.js` (search input handler, placeholder update)

- [ ] **Step 1: Update search placeholder on tab switch**

In the tab click handler, update the search bar placeholder:
```javascript
var searchInput = document.getElementById("gs-global-search");
if (searchInput) {
  var placeholders = { chat: "Search messages...", friends: "Search friends...", discover: "Search..." };
  searchInput.placeholder = placeholders[chatMainTab] || "Search...";
  searchInput.value = "";
  chatSearchQuery = "";
}
```

- [ ] **Step 2: Update search input handler for tab-aware behavior**

Update the search input listener to dispatch per-tab:
```javascript
searchInput.addEventListener("input", function() {
  chatSearchQuery = this.value.trim();
  // Show/hide clear button
  var clearBtn = document.getElementById("gs-search-clear");
  if (clearBtn) clearBtn.style.display = chatSearchQuery ? "" : "none";

  if (chatMainTab === "chat") {
    // Debounced BE search
    clearTimeout(chatGlobalSearchDebounce);
    if (chatSearchQuery.length >= 2) {
      chatGlobalSearchLoading = true;
      renderChatInbox();
      chatGlobalSearchDebounce = setTimeout(function() {
        vscode.postMessage({ type: "searchInboxMessages", payload: { query: chatSearchQuery } });
      }, 300);
    } else {
      chatGlobalSearchResults = null;
      chatGlobalSearchLoading = false;
      renderChatInbox();
    }
  } else if (chatMainTab === "friends") {
    renderFriends(); // client-side, instant
  } else if (chatMainTab === "discover") {
    renderDiscover(); // client-side, instant
  }
});
```

- [ ] **Step 2.5: Post-filter search results by active chip type**

In `renderChatInbox()`, when rendering `chatGlobalSearchResults`, apply chip type filter:
```javascript
// After BE search results arrive, post-filter by active chip
var searchResults = chatGlobalSearchResults || [];
if (chatFilter !== "all" && searchResults.length > 0) {
  var typeMap = { dm: "direct", group: "group", community: "community", team: "team" };
  var filterType = typeMap[chatFilter];
  if (filterType) {
    searchResults = searchResults.filter(function(msg) {
      return msg.conversationType === filterType || msg.conversation_type === filterType;
    });
  }
}
```

- [ ] **Step 3: Clear search on tab switch**

In the tab click handler, before switching content, clear search:
```javascript
chatSearchQuery = "";
chatGlobalSearchResults = null;
chatGlobalSearchLoading = false;
chatGlobalSearchError = false;
var searchInput = document.getElementById("gs-global-search");
if (searchInput) searchInput.value = "";
var clearBtn = document.getElementById("gs-search-clear");
if (clearBtn) clearBtn.style.display = "none";
```

- [ ] **Step 4: Add search empty states in render functions**

In `renderFriends()` and `renderDiscover()`, after search filter, if all sections empty and query exists:
```javascript
if (chatSearchQuery && online.length === 0 && offline.length === 0) {
  container.innerHTML = '<div class="gs-empty">No results for "' + escapeHtml(chatSearchQuery) + '"</div>';
  return;
}
```

- [ ] **Step 5: Verify compile**

```bash
npm run compile
```

- [ ] **Step 6: Commit**

```bash
git add media/webview/explore.js
git commit -m "feat(search): tab-aware search — placeholders, client-side filter, clear on switch"
```

---

## Task 8: Scroll position per tab + loading skeletons

**Files:**
- Modify: `media/webview/explore.js` (scroll save/restore per tab)
- Modify: `media/webview/explore.css` (skeleton styles)

- [ ] **Step 1: Add per-tab scroll state**

```javascript
var tabScrollPositions = { chat: 0, friends: 0, discover: 0 };
```

In tab click handler, save current scroll before switching:
```javascript
var currentContainer = document.getElementById(chatMainTab === "chat" ? "chat-content" : chatMainTab + "-content");
if (currentContainer) tabScrollPositions[chatMainTab] = currentContainer.scrollTop;
```

After switching, restore scroll:
```javascript
var newContainer = document.getElementById(chatMainTab === "chat" ? "chat-content" : chatMainTab + "-content");
if (newContainer) newContainer.scrollTop = tabScrollPositions[chatMainTab] || 0;
```

- [ ] **Step 2: Add skeleton loading CSS in explore.css**

```css
/* Loading skeleton */
.gs-skeleton-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px var(--gs-inset-x);
}
.gs-skeleton-circle {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--gs-hover);
  flex-shrink: 0;
  animation: gs-pulse 1.5s ease-in-out infinite;
}
.gs-skeleton-line {
  height: 12px;
  border-radius: 4px;
  background: var(--gs-hover);
  animation: gs-pulse 1.5s ease-in-out infinite;
}
.gs-skeleton-line--long { width: 60%; }
.gs-skeleton-line--short { width: 30%; }

@keyframes gs-pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 0.8; }
}

@media (prefers-reduced-motion: reduce) {
  .gs-skeleton-circle, .gs-skeleton-line {
    animation: none;
    opacity: 0.4;
  }
}
```

- [ ] **Step 3: Add skeleton rendering helper**

```javascript
function renderSkeletonRows(count) {
  var html = "";
  for (var i = 0; i < count; i++) {
    html += '<div class="gs-skeleton-row"><div class="gs-skeleton-circle"></div>' +
      '<div class="gs-flex-col gs-flex-1 gs-gap-4">' +
      '<div class="gs-skeleton-line gs-skeleton-line--long"></div>' +
      '<div class="gs-skeleton-line gs-skeleton-line--short"></div></div></div>';
  }
  return html;
}
```

- [ ] **Step 4: Show skeletons on initial load**

In the render functions, if data hasn't loaded yet:
```javascript
// In renderChatInbox()
if (!chatDataLoaded) {
  document.getElementById("chat-content").innerHTML = renderSkeletonRows(4);
  return;
}
// Set chatDataLoaded = true in the setChatData message handler
```

- [ ] **Step 5: Verify compile**

```bash
npm run compile
```

- [ ] **Step 6: Commit**

```bash
git add media/webview/explore.js media/webview/explore.css
git commit -m "feat(ui): per-tab scroll position + loading skeletons"
```

---

## Task 9: State persistence + existing behavior verification

**Files:**
- Modify: `media/webview/explore.js` (persistState, restoreState, verify preserved features)

- [ ] **Step 1: Update persistState()**

```javascript
function persistState() {
  var chatConvId = (typeof SidebarChat !== "undefined" && SidebarChat.isOpen && SidebarChat.isOpen())
    ? (SidebarChat.getConversationId && SidebarChat.getConversationId()) : undefined;
  var s = vscode.getState() || {};
  s.navStack = navStack;
  s.chatMainTab = chatMainTab;
  s.currentTab = currentTab;
  s.chatConversationId = chatConvId || undefined;
  s.tabScrollPositions = tabScrollPositions;
  // accordionState is already handled by setAccordionState()
  vscode.setState(s);
}
```

- [ ] **Step 2: Update restoreState()**

```javascript
function restoreState() {
  var state = vscode.getState();
  if (!state) return;

  // Migrate old tab names
  if (state.chatMainTab === "inbox") chatMainTab = "chat";
  else if (state.chatMainTab === "channels") chatMainTab = "discover";
  else if (["chat", "friends", "discover"].indexOf(state.chatMainTab) !== -1) chatMainTab = state.chatMainTab;
  else chatMainTab = "chat";

  // Restore scroll positions
  if (state.tabScrollPositions) tabScrollPositions = state.tabScrollPositions;

  // Update active tab UI
  document.querySelectorAll(".gs-main-tab").forEach(function(t) {
    t.classList.toggle("active", t.dataset.tab === chatMainTab);
  });

  // Update search placeholder
  var searchInput = document.getElementById("gs-global-search");
  if (searchInput) {
    var placeholders = { chat: "Search messages...", friends: "Search friends...", discover: "Search..." };
    searchInput.placeholder = placeholders[chatMainTab] || "Search...";
  }

  // Restore nav stack
  if (state.navStack === "chat" && state.chatConversationId) {
    navStack = "chat";
    // Trigger chat view restoration via existing logic
  }
}
```

- [ ] **Step 3: Ensure existing behaviors survive the rewrite**

**Critical code paths to carry forward from old renderChatInbox():**
- **Muted conversations**: apply `conv-muted` class, show `codicon-bell-slash` icon, sort muted to bottom
- **Draft display**: check `chatDrafts[conv.id]`, if exists show "Draft: ..." in preview with `conv-draft` class
- **Typing indicator**: check `chatTypingUsers[otherLogin]`, if active show "typing..." in preview
- **Context menu**: keep right-click handler on conversation rows (pin/unpin/mark-read/delete)
- **Notification section**: keep `#notifications-section` container and `setNotifications` message handler untouched
- **User menu**: keep user avatar click → dropdown toggle logic untouched

Walk through checklist:
- [ ] Context menu (right-click conversation) still works
- [ ] Typing indicators show in conversation preview
- [ ] Draft prefix shows on conversations
- [ ] Muted conversations display correctly
- [ ] Profile card hover works on avatars
- [ ] SidebarChat push/pop works
- [ ] Notifications section works
- [ ] User menu works

- [ ] **Step 4: Commit**

```bash
git add media/webview/explore.js
git commit -m "feat(state): persistence + backward compat migration + scroll restore"
```

---

## Task 10: Final polish + error states + compile verification

**Files:**
- Modify: `media/webview/explore.js` (error states, search loading)
- Modify: `media/webview/explore.css` (error state styling)

- [ ] **Step 1: Add error state rendering**

In `renderChatInbox()`, add error state for search:
```javascript
if (chatGlobalSearchError) {
  // Show error inline below search results
  html += '<div class="gs-empty"><span class="codicon codicon-warning"></span>' +
    '<p>Search failed</p>' +
    '<button class="gs-btn gs-btn-secondary search-retry-btn">Retry</button></div>';
}
```

Add search loading state:
```javascript
if (chatGlobalSearchLoading) {
  html += '<div class="gs-text-sm gs-text-muted" style="padding:8px var(--gs-inset-x)">Searching...</div>';
}
```

- [ ] **Step 2: Add retry handler**

```javascript
document.addEventListener("click", function(e) {
  if (e.target.classList.contains("search-retry-btn")) {
    chatGlobalSearchError = false;
    chatGlobalSearchLoading = true;
    renderChatInbox();
    vscode.postMessage({ type: "searchInboxMessages", payload: { query: chatSearchQuery } });
  }
});
```

- [ ] **Step 3: Full compile verification**

```bash
npm run compile
```

Expected: 0 errors.

- [ ] **Step 4: Manual testing checklist**

Press F5 in VS Code, sign in, verify:
- [ ] 3 tabs visible: Chat | Friends | Discover
- [ ] Chat tab: filter chips work, conversations show with correct type display
- [ ] Friends tab: accordion sections collapse/expand, state persists
- [ ] Discover tab: accordion sections work, communities show
- [ ] Search: placeholder changes per tab, filters work
- [ ] Tab switching preserves scroll position
- [ ] Back button from chat returns to correct tab
- [ ] Dark + light theme both look correct

- [ ] **Step 5: Commit**

```bash
git add media/webview/explore.js media/webview/explore.css
git commit -m "feat(ui): error states, search loading, final polish"
```

---

## Task 11: Update contributor doc + final commit

**Files:**
- Modify: `docs/contributors/slugmacro.md`

- [ ] **Step 1: Update contributor status**

Update `docs/contributors/slugmacro.md` with:
- Current: branch `slug-wp4-tab-layout-v2`, WP4 tab layout implementation complete
- Decisions: any architectural choices made during implementation

- [ ] **Step 2: Commit**

```bash
git add docs/contributors/slugmacro.md
git commit -m "docs: update contributor status — WP4 tab layout v2 complete"
```

- [ ] **Step 3: Ready for QA**

Run through QA checklist at `docs/QA/QA-wp4-tab-layout.md` or hand off to QA.
