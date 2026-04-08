# Unified Explore Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace 7 separate sidebar views (6 Explore + 1 Chat) with a single tabbed webview containing Chat | Feed | Trending tabs.

**Architecture:** One `ExploreWebviewProvider` registers as `trending.explore` webview. It consolidates data-fetching from chat-panel, feed, tree-views, and who-to-follow into a single provider. A unified JS/CSS pair handles tab switching and all renderers client-side.

**Tech Stack:** VS Code Webview API, TypeScript, vanilla JS/CSS

---

### Task 1: Update package.json — Views & Containers

**Files:**
- Modify: `package.json:40-57` (activationEvents)
- Modify: `package.json:259-324` (viewsContainers + views)
- Modify: `package.json:325-490` (menus)

- [ ] **Step 1: Replace activationEvents**

In `package.json`, replace the view-based activation events (lines 40-47):

```json
"activationEvents": [
  "onView:trending.welcome",
  "onView:trending.explore",
  "onCommand:trending.signIn",
  "onCommand:trending.search",
  "onCommand:trending.browseTrendingRepos",
  "onCommand:trending.browseTrendingPeople",
  "onCommand:trending.openFeed",
  "onCommand:trending.openInbox",
  "onCommand:trending.openNotifications",
  "onCommand:trending.messageUser",
  "onCommand:trending.createGroup"
],
```

- [ ] **Step 2: Replace viewsContainers — remove chatSidebar**

Replace the `viewsContainers` section (lines 259-272) to remove `chatSidebar`:

```json
"viewsContainers": {
  "activitybar": [
    {
      "id": "trendingSidebar",
      "title": "Explore",
      "icon": "media/sidebar-icon.svg"
    }
  ]
},
```

- [ ] **Step 3: Replace views — single explore webview**

Replace the `views` section (lines 273-324):

```json
"views": {
  "trendingSidebar": [
    {
      "id": "trending.welcome",
      "name": "Welcome",
      "type": "webview",
      "visibility": "visible",
      "when": "!trending.isSignedIn"
    },
    {
      "id": "trending.explore",
      "name": "Explore",
      "type": "webview",
      "visibility": "visible",
      "when": "trending.isSignedIn"
    }
  ]
},
```

- [ ] **Step 4: Simplify menus — remove tree-view-specific entries**

Replace the entire `menus` section (lines 325-490). Remove all `view/title` entries that reference old views (`trending.trendingRepos`, `trending.trendingPeople`, `trending.chatPanel`, `trending.feed`, `trending.myRepos`, `trending.inbox`). Keep only `trending.explore`-relevant and notifications entries. Remove all `view/item/context` entries (actions will be handled in-webview).

```json
"menus": {
  "view/title": [
    {
      "command": "trending.signIn",
      "when": "view == trending.explore && !trending.isSignedIn",
      "group": "navigation@0"
    },
    {
      "command": "trending.signOut",
      "when": "view == trending.explore && trending.isSignedIn",
      "group": "navigation@0"
    },
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
  ],
  "view/item/context": [
    {
      "command": "trending.notifications.markAllRead",
      "when": "viewItem == notification",
      "group": "1_actions"
    }
  ]
},
```

- [ ] **Step 5: Verify JSON validity**

Run: `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'));console.log('Valid JSON')"`
Expected: `Valid JSON`

- [ ] **Step 6: Commit**

```bash
git add package.json
git commit -m "refactor: replace 7 sidebar views with single explore webview in package.json"
```

---

### Task 2: Create explore.css

**Files:**
- Create: `media/webview/explore.css`

- [ ] **Step 1: Create the unified CSS file**

This file consolidates styles from `chat-panel.css`, `feed.css`, and `who-to-follow.css`, plus adds new styles for the main tab bar and trending sections.

```css
/* explore.css — Unified Explore tabbed webview */

/* ===================== MAIN TAB BAR ===================== */
.explore-tabs {
  display: flex;
  background: var(--gs-bg);
  border-bottom: 1px solid var(--gs-divider);
  position: sticky;
  top: 0;
  z-index: 20;
}
.explore-tab {
  flex: 1;
  padding: 8px 4px;
  font-size: 12px;
  font-weight: 500;
  font-family: inherit;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--gs-muted);
  cursor: pointer;
  text-align: center;
  transition: color 0.15s, border-color 0.15s;
}
.explore-tab:hover { color: var(--gs-fg); }
.explore-tab.active {
  color: var(--gs-fg);
  border-bottom-color: var(--gs-button-bg);
}
.explore-tab .tab-badge {
  display: inline-block;
  min-width: 16px;
  height: 16px;
  line-height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: var(--gs-badge-bg);
  color: var(--gs-badge-fg);
  font-size: 9px;
  font-weight: 700;
  margin-left: 4px;
  vertical-align: middle;
}

.tab-pane { display: none; }
.tab-pane.active { display: block; }

/* ===================== CHAT TAB (from chat-panel.css) ===================== */
.chat-header {
  display: flex;
  align-items: center;
  padding: 4px 8px;
  border-bottom: 1px solid var(--gs-divider);
}
.chat-sub-tabs {
  display: flex;
  gap: 0;
  flex: 1;
}
.chat-sub-tab {
  padding: 6px 14px;
  font-size: 13px;
  font-weight: 500;
  font-family: inherit;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--gs-muted);
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
}
.chat-sub-tab:hover { color: var(--gs-fg); }
.chat-sub-tab.active {
  color: var(--gs-fg);
  border-bottom-color: var(--gs-button-bg);
}

.friend-item,
.conv-item {
  border-bottom: 1px solid var(--gs-divider);
  padding: 8px 12px;
}
.friend-item:last-child,
.conv-item:last-child {
  border-bottom: none;
}

.context-menu {
  position: fixed;
  z-index: 200;
  background: var(--gs-bg);
  border: 1px solid var(--gs-border);
  border-radius: var(--gs-radius-sm);
  box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  min-width: 140px;
  padding: 4px 0;
}
.context-menu-item {
  padding: 6px 12px;
  cursor: pointer;
  font-size: 12px;
}
.context-menu-item:hover { background: var(--gs-hover); }
.context-menu-danger { color: var(--gs-error); }

.settings-dropdown {
  position: absolute;
  right: 8px;
  top: 36px;
  z-index: 200;
  background: var(--gs-bg);
  border: 1px solid var(--gs-border);
  border-radius: var(--gs-radius-sm);
  box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  min-width: 180px;
  padding: 6px 0;
}
.settings-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 12px;
  font-size: 11px;
  cursor: pointer;
  white-space: nowrap;
}
.settings-item:hover { background: var(--gs-hover); }
.settings-item input[type="checkbox"] {
  margin: 0;
  accent-color: var(--gs-button-bg);
}
.settings-divider {
  height: 1px;
  background: var(--gs-divider);
  margin: 4px 0;
}
.settings-action {
  display: block;
  width: 100%;
  padding: 5px 12px;
  font-size: 11px;
  font-family: inherit;
  background: transparent;
  border: none;
  color: var(--gs-error);
  cursor: pointer;
  text-align: left;
}
.settings-action:hover { background: var(--gs-hover); }

.typing-status {
  color: var(--gs-button-bg);
  font-style: italic;
  animation: typingPulse 1.5s infinite;
}
@keyframes typingPulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.filter-bar {
  display: flex;
  gap: 3px;
  padding: 4px 12px;
  overflow-x: auto;
  flex-wrap: wrap;
}
.filter-btn {
  padding: 2px 8px;
  font-size: 10px;
  font-family: inherit;
  background: transparent;
  border: 1px solid var(--gs-border);
  border-radius: 12px;
  color: var(--gs-muted);
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s;
}
.filter-btn:hover { color: var(--gs-fg); border-color: var(--gs-fg); }
.filter-btn.active {
  color: var(--gs-button-fg);
  background: var(--gs-button-bg);
  border-color: var(--gs-button-bg);
}
.filter-count { font-size: 10px; opacity: 0.8; }

.conv-item.conv-unread .conv-name { font-weight: 700; }
.conv-item.conv-unread .conv-preview { font-weight: 600; color: var(--gs-fg); }
.conv-item.conv-muted { opacity: 0.6; }
.conv-item.conv-muted:hover { opacity: 0.8; }

/* ===================== FEED TAB (from feed.css) ===================== */
.feed-filters {
  display: flex;
  gap: 4px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--gs-divider);
  overflow-x: auto;
  flex-wrap: nowrap;
  scrollbar-width: none;
}
.feed-filters::-webkit-scrollbar { display: none; }
.feed-chip {
  padding: 2px 8px;
  font-size: 10px;
  font-family: inherit;
  background: transparent;
  border: 1px solid var(--gs-border);
  border-radius: 10px;
  color: var(--gs-muted);
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s;
}
.feed-chip:hover { color: var(--gs-fg); border-color: var(--gs-fg); }
.feed-chip.active {
  color: var(--gs-button-fg);
  background: var(--gs-button-bg);
  border-color: var(--gs-button-bg);
}

.feed-event {
  padding: 12px;
  border-bottom: 1px solid var(--gs-divider);
}
.feed-event:last-child { border-bottom: none; }
.feed-event-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.feed-type-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--gs-muted);
  letter-spacing: 0.3px;
}
.feed-time { font-size: 11px; color: var(--gs-muted); }

.feed-repo {
  display: flex;
  gap: 10px;
  padding: 8px;
  border-radius: 8px;
  border: 1px solid var(--gs-border);
  cursor: pointer;
  margin-bottom: 6px;
}
.feed-repo:hover { background: var(--gs-hover); }
.feed-repo-avatar {
  width: 36px; height: 36px;
  border-radius: 8px;
  object-fit: cover;
  flex-shrink: 0;
}
.feed-repo-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.feed-repo-name { font-size: 13px; font-weight: 600; color: var(--gs-link); }
.feed-repo-desc {
  font-size: 12px;
  color: var(--gs-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.feed-repo-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--gs-muted);
  flex-wrap: wrap;
}

.feed-detail-badge {
  padding: 1px 6px;
  border-radius: 10px;
  font-size: 10px;
  font-weight: 500;
}
.feed-trending { background: var(--vscode-inputValidation-errorBackground, rgba(239,68,68,0.15)); color: var(--vscode-errorForeground, #ef4444); }
.feed-release { background: color-mix(in srgb, var(--vscode-charts-blue) 15%, transparent); color: var(--vscode-charts-blue, #3b82f6); }
.feed-pr { background: color-mix(in srgb, var(--vscode-charts-purple, #a855f7) 15%, transparent); color: var(--vscode-charts-purple, #a855f7); }
.feed-star { background: color-mix(in srgb, var(--vscode-charts-yellow, #eab308) 15%, transparent); color: var(--vscode-charts-yellow, #eab308); }

.feed-actor {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 6px 0;
  font-size: 12px;
}
.feed-actor-avatar { width: 20px; height: 20px; border-radius: 50%; object-fit: cover; }
.feed-actor-link { color: var(--gs-link); text-decoration: none; cursor: pointer; font-weight: 500; }
.feed-actor-link:hover { text-decoration: underline; }
.feed-actor-followers { color: var(--gs-muted); font-size: 11px; }

.feed-event-desc { font-size: 12px; color: var(--gs-fg); margin: 4px 0; line-height: 1.4; opacity: 0.85; }
.feed-narration { font-size: 12px; color: var(--gs-muted); font-style: italic; margin-top: 4px; line-height: 1.4; }

.load-more-btn {
  display: block;
  margin: 12px auto;
  padding: 6px 20px;
  background: var(--gs-button-secondary-bg);
  color: var(--gs-button-secondary-fg);
  border: none;
  border-radius: 12px;
  cursor: pointer;
  font-size: 12px;
}
.load-more-btn:hover { opacity: 0.8; }
.load-more-btn:disabled { opacity: 0.5; cursor: default; }

/* ===================== TRENDING TAB ===================== */
.trending-section {
  border-bottom: 1px solid var(--gs-divider);
}
.trending-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  cursor: pointer;
}
.trending-section-title {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--gs-muted);
  letter-spacing: 0.5px;
}

.trending-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px 5px 16px;
  cursor: pointer;
}
.trending-item:hover { background: var(--gs-hover); }
.trending-rank {
  font-size: 10px;
  font-weight: 700;
  min-width: 14px;
  text-align: right;
}
.trending-rank-top { color: var(--vscode-charts-orange, #f97316); }
.trending-rank-rest { color: var(--gs-muted); }
.trending-name {
  font-size: 11px;
  color: var(--gs-fg);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.trending-stat {
  font-size: 9px;
  color: var(--gs-muted);
  flex-shrink: 0;
}
.trending-action-btn {
  padding: 2px 8px;
  font-size: 10px;
  font-family: inherit;
  background: var(--gs-button-bg);
  color: var(--gs-button-fg);
  border: none;
  border-radius: 4px;
  cursor: pointer;
  flex-shrink: 0;
}
.trending-action-btn:hover { opacity: 0.8; }
.trending-action-btn.following {
  background: var(--gs-button-secondary-bg);
  color: var(--gs-button-secondary-fg);
}

/* MY REPOS section in Feed tab */
.my-repos-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px 4px 16px;
  cursor: pointer;
}
.my-repos-item:hover { background: var(--gs-hover); }

/* WHO TO FOLLOW (from who-to-follow.css) */
.suggestion-item {
  border-bottom: 1px solid var(--gs-divider);
  padding: 8px 12px;
}
.suggestion-item:last-child { border-bottom: none; }
.follow-btn { font-size: 11px; padding: 3px 10px; }
```

- [ ] **Step 2: Commit**

```bash
git add media/webview/explore.css
git commit -m "feat: add explore.css — unified styles for tabbed explore webview"
```

---

### Task 3: Create explore.js

**Files:**
- Create: `media/webview/explore.js`

- [ ] **Step 1: Create the unified JS file**

This file consolidates `chat-panel.js`, `feed.js`, and `who-to-follow.js` into a single file with tab-scoped state and renderers. All functions from `shared.js` (`doAction`, `escapeHtml`, `formatCount`, `timeAgo`, `avatarUrl`) are available globally since `shared.js` loads first.

```js
// explore.js — Unified Explore tabbed webview
// Depends on shared.js (loaded first): vscode, doAction, escapeHtml, formatCount, timeAgo, avatarUrl

// ===================== GLOBAL STATE =====================
var currentTab = "chat";

// ===================== CHAT STATE =====================
var chatFriends = [];
var chatConversations = [];
var chatCurrentUser = null;
var chatSubTab = "inbox";
var chatSearchQuery = "";
var chatInboxFilter = "all";
var chatContextMenuEl = null;
var chatTypingUsers = {};

// ===================== FEED STATE =====================
var feedEvents = [];
var feedActiveFilter = "all";

var feedEventIcons = {
  "trending": '<span class="codicon codicon-flame"></span>',
  "release": '<span class="codicon codicon-package"></span>',
  "pr-merged": '<span class="codicon codicon-git-merge"></span>',
  "notable-star": '<span class="codicon codicon-star-full"></span>'
};
var feedEventLabels = {
  "trending": "Trending",
  "release": "New Release",
  "pr-merged": "PR Merged",
  "notable-star": "Notable Star"
};

// ===================== TRENDING STATE =====================
var trendingRepos = [];
var trendingReposStarred = {};
var trendingPeople = [];
var trendingPeopleFollow = {};
var trendingSuggestions = [];
var trendingHoverTimeout = null;

// ===================== MY REPOS STATE =====================
var myRepos = [];
var myStarred = [];

// ===================== MAIN TAB SWITCHING =====================
document.querySelectorAll(".explore-tab").forEach(function(tab) {
  tab.addEventListener("click", function() {
    document.querySelectorAll(".explore-tab").forEach(function(t) { t.classList.remove("active"); });
    tab.classList.add("active");
    currentTab = tab.dataset.tab;
    document.querySelectorAll(".tab-pane").forEach(function(p) { p.classList.remove("active"); });
    document.getElementById("pane-" + currentTab).classList.add("active");
  });
});

// ===================== CHAT TAB LOGIC =====================
(function initChat() {
  // Sub-tab switching
  document.querySelectorAll(".chat-sub-tab").forEach(function(tab) {
    tab.addEventListener("click", function() {
      document.querySelectorAll(".chat-sub-tab").forEach(function(t) { t.classList.remove("active"); });
      tab.classList.add("active");
      chatSubTab = tab.dataset.tab;
      document.getElementById("chat-search-bar").style.display = chatSubTab === "friends" ? "block" : "none";
      document.getElementById("chat-filter-bar").style.display = chatSubTab === "inbox" ? "flex" : "none";
      renderChat();
    });
  });

  document.getElementById("chat-new").addEventListener("click", function() { doAction("newChat"); });
  document.getElementById("chat-search").addEventListener("input", function(e) { chatSearchQuery = e.target.value.toLowerCase(); renderChat(); });

  // Settings dropdown
  var settingsDropdown = document.getElementById("chat-settings-dropdown");
  document.getElementById("chat-settings-btn").addEventListener("click", function(e) {
    e.stopPropagation();
    settingsDropdown.style.display = settingsDropdown.style.display === "none" ? "block" : "none";
  });
  document.addEventListener("click", function(e) {
    if (!e.target.closest(".settings-dropdown") && !e.target.closest("#chat-settings-btn")) {
      settingsDropdown.style.display = "none";
    }
  });
  document.getElementById("chat-setting-notifications").addEventListener("change", function() {
    doAction("updateSetting", { key: "notifications", value: this.checked });
  });
  document.getElementById("chat-setting-sound").addEventListener("change", function() {
    doAction("updateSetting", { key: "sound", value: this.checked });
  });
  document.getElementById("chat-setting-debug").addEventListener("change", function() {
    doAction("updateSetting", { key: "debug", value: this.checked });
  });
  document.getElementById("chat-setting-signout").addEventListener("click", function() { doAction("signOut"); });

  // Inbox filter buttons
  document.querySelectorAll("#chat-filter-bar .filter-btn").forEach(function(btn) {
    btn.addEventListener("click", function() {
      document.querySelectorAll("#chat-filter-bar .filter-btn").forEach(function(b) { b.classList.remove("active"); });
      btn.classList.add("active");
      chatInboxFilter = btn.dataset.filter;
      renderChat();
    });
  });

  // Close context menu on any click
  document.addEventListener("click", function() {
    if (chatContextMenuEl) { chatContextMenuEl.remove(); chatContextMenuEl = null; }
  });

  // Show filter bar by default
  document.getElementById("chat-filter-bar").style.display = "flex";
})();

function renderChat() {
  updateChatTabCounts();
  if (chatSubTab === "friends") { renderChatFriends(); }
  else { renderChatInbox(); }
}

function updateChatTabCounts() {
  var inboxUnread = chatConversations.reduce(function(sum, c) {
    return sum + ((c.unread_count > 0 || c.is_unread) ? (c.unread_count || 1) : 0);
  }, 0);
  var inboxEl = document.getElementById("chat-tab-inbox-count");
  if (inboxEl) { inboxEl.textContent = inboxUnread > 0 ? "(" + inboxUnread + ")" : ""; }

  // Update main tab badge
  var mainBadge = document.getElementById("chat-main-badge");
  if (mainBadge) { mainBadge.style.display = inboxUnread > 0 ? "inline-block" : "none"; mainBadge.textContent = inboxUnread; }

  var onlineCount = chatFriends.filter(function(f) { return f.online; }).length;
  var totalCount = chatFriends.length;
  var friendsEl = document.getElementById("chat-tab-friends-count");
  if (friendsEl) { friendsEl.textContent = "(" + onlineCount + "/" + totalCount + ")"; }
}

function renderChatFriends() {
  var container = document.getElementById("chat-content");
  var empty = document.getElementById("chat-empty");
  var filtered = chatFriends;
  if (chatSearchQuery) {
    filtered = chatFriends.filter(function(f) {
      return f.login.toLowerCase().includes(chatSearchQuery) || f.name.toLowerCase().includes(chatSearchQuery);
    });
  }
  if (!filtered.length) {
    container.innerHTML = "";
    empty.style.display = "block";
    empty.textContent = chatSearchQuery ? "No matches" : "No friends yet. Follow people to see them here!";
    return;
  }
  empty.style.display = "none";

  var typing = filtered.filter(function(f) { return chatTypingUsers[f.login]; });
  var unread = filtered.filter(function(f) { return !chatTypingUsers[f.login] && f.unread > 0; });
  var rest = filtered.filter(function(f) { return !chatTypingUsers[f.login] && !f.unread; });
  var online = rest.filter(function(f) { return f.online; });
  var recent = rest.filter(function(f) { return !f.online && f.lastSeen > 0 && (Date.now() - f.lastSeen < 3600000); });
  var offline = rest.filter(function(f) { return !f.online && (f.lastSeen === 0 || Date.now() - f.lastSeen >= 3600000); });

  var html = "";
  if (typing.length) { html += typing.map(renderChatFriend).join(""); }
  if (unread.length) { html += unread.map(renderChatFriend).join(""); }
  if (online.length) { html += '<div class="gs-section-title">Online (' + online.length + ')</div>'; html += online.map(renderChatFriend).join(""); }
  if (recent.length) { html += '<div class="gs-section-title">Recently Active</div>'; html += recent.map(renderChatFriend).join(""); }
  if (offline.length) { html += '<div class="gs-section-title">Offline</div>'; html += offline.map(renderChatFriend).join(""); }

  container.innerHTML = html;
  container.querySelectorAll(".friend-item").forEach(function(el) {
    el.addEventListener("click", function() { doAction("openChat", { login: el.dataset.login }); });
  });
  container.querySelectorAll(".friend-profile-btn").forEach(function(btn) {
    btn.addEventListener("click", function(e) { e.stopPropagation(); doAction("viewProfile", { login: btn.dataset.login }); });
  });
}

function renderChatFriend(f) {
  var avatar = f.avatar_url || avatarUrl(f.login);
  var isTyping = !!chatTypingUsers[f.login];
  var dot = f.online ? '<span class="gs-dot-online"></span>' : '<span class="gs-dot-offline"></span>';
  var status = isTyping ? '<span class="typing-status">typing...</span>' : (f.online ? "online" : (f.lastSeen > 0 ? timeAgo(new Date(f.lastSeen).toISOString()) + " ago" : ""));
  var unreadBadge = f.unread > 0 ? '<span class="gs-badge">' + f.unread + '</span>' : '';
  return '<div class="gs-list-item friend-item" data-login="' + escapeHtml(f.login) + '">' +
    '<img src="' + escapeHtml(avatar) + '" class="gs-avatar gs-avatar-md" alt="">' +
    '<div class="gs-flex-1" style="min-width:0">' +
      '<div class="gs-flex gs-items-center gs-gap-4">' + dot + '<span class="gs-truncate" style="font-weight:500">' + escapeHtml(f.name) + '</span>' + unreadBadge + '</div>' +
      '<div class="gs-text-xs gs-text-muted">' + escapeHtml(status) + '</div>' +
    '</div>' +
    '<button class="gs-btn-icon friend-profile-btn" data-login="' + escapeHtml(f.login) + '" title="View Profile"><span class="codicon codicon-comment"></span></button>' +
  '</div>';
}

function renderChatInbox() {
  var container = document.getElementById("chat-content");
  var empty = document.getElementById("chat-empty");

  function isGroupConv(c) {
    return c.type === "group" || c.is_group === true || (c.participants && c.participants.length > 2);
  }

  var countAll = chatConversations.length;
  var countDirect = chatConversations.filter(function(c) { return !isGroupConv(c) && !c.is_request; }).length;
  var countGroup = chatConversations.filter(function(c) { return isGroupConv(c); }).length;
  var countRequests = chatConversations.filter(function(c) { return c.is_request; }).length;
  var countUnread = chatConversations.filter(function(c) { return c.unread_count > 0 || c.is_unread; }).length;

  setChatCount("chat-count-all", countAll);
  setChatCount("chat-count-direct", countDirect);
  setChatCount("chat-count-group", countGroup);
  setChatCount("chat-count-requests", countRequests);
  setChatCount("chat-count-unread", countUnread);

  var filtered = chatConversations;
  if (chatInboxFilter === "unread") { filtered = chatConversations.filter(function(c) { return c.unread_count > 0 || c.is_unread; }); }
  else if (chatInboxFilter === "direct") { filtered = chatConversations.filter(function(c) { return !isGroupConv(c) && !c.is_request; }); }
  else if (chatInboxFilter === "group") { filtered = chatConversations.filter(function(c) { return isGroupConv(c); }); }
  else if (chatInboxFilter === "requests") { filtered = chatConversations.filter(function(c) { return c.is_request; }); }

  if (!filtered.length) {
    container.innerHTML = "";
    empty.style.display = "block";
    empty.textContent = chatInboxFilter === "all" ? "No conversations yet" : "No " + chatInboxFilter + " conversations";
    return;
  }
  empty.style.display = "none";

  filtered.sort(function(a, b) {
    var aPinned = !!(a.pinned || a.pinned_at);
    var bPinned = !!(b.pinned || b.pinned_at);
    if (aPinned && !bPinned) { return -1; }
    if (!aPinned && bPinned) { return 1; }
    var aMuted = a.is_muted ? 1 : 0;
    var bMuted = b.is_muted ? 1 : 0;
    if (aMuted !== bMuted) { return aMuted - bMuted; }
    var dateA = new Date(a.last_message_at || a.updated_at || 0);
    var dateB = new Date(b.last_message_at || b.updated_at || 0);
    return dateB - dateA;
  });

  container.innerHTML = filtered.map(renderChatConversation).join("");
  container.querySelectorAll(".conv-item").forEach(function(el) {
    el.addEventListener("click", function() { doAction("openConversation", { conversationId: el.dataset.id }); });
    el.addEventListener("contextmenu", function(e) {
      e.preventDefault();
      showChatContextMenu(e, el.dataset.id, el.dataset.pinned === "true");
    });
  });
}

function setChatCount(id, count) {
  var el = document.getElementById(id);
  if (el) { el.textContent = count > 0 ? "(" + count + ")" : ""; }
}

function renderChatConversation(c) {
  var isGroup = c.type === "group" || c.is_group === true || (c.participants && c.participants.length > 2);
  var name, avatar, subtitle;
  if (isGroup) {
    name = c.group_name || "Group Chat";
    avatar = c.group_avatar_url || "";
    var memberCount = (c.participants && c.participants.length) || 0;
    subtitle = memberCount + " members";
  } else {
    var other = c.other_user;
    if (!other) { return ""; }
    name = other.name || other.login;
    avatar = other.avatar_url || avatarUrl(other.login || "");
    subtitle = "";
  }
  var preview = c.last_message_preview || c.last_message_text || (c.last_message && (c.last_message.body || c.last_message.content)) || "";
  var time = timeAgo(c.updated_at || c.last_message_at);
  var unread = (c.unread_count > 0 || c.is_unread);
  var pin = c.pinned || c.pinned_at ? '<span class="codicon codicon-pin"></span> ' : "";
  var typeIcon = isGroup ? '<span class="codicon codicon-organization"></span> ' : "";
  if (isGroup && !avatar && c.participants && c.participants.length > 0) {
    avatar = c.participants[0].avatar_url || avatarUrl(c.participants[0].login || "");
  }
  var unreadBadge = unread ? '<span class="gs-badge">' + (c.unread_count || '') + '</span>' : '';
  var mutedIcon = c.is_muted ? '<span class="gs-text-xs" title="Muted"><span class="codicon codicon-bell-slash"></span></span>' : '';

  return '<div class="gs-list-item conv-item' + (unread ? ' conv-unread' : '') + (c.is_muted ? ' conv-muted' : '') + '" data-id="' + c.id + '" data-pinned="' + (c.pinned || c.pinned_at || false) + '">' +
    '<img src="' + escapeHtml(avatar) + '" class="gs-avatar gs-avatar-md" style="' + (isGroup ? 'border-radius:8px' : '') + '" alt="">' +
    '<div class="gs-flex-1" style="min-width:0">' +
      '<div class="gs-flex gs-items-center gs-gap-4">' +
        '<span class="conv-name gs-truncate">' + pin + typeIcon + escapeHtml(name) + '</span>' +
        mutedIcon +
        '<span class="gs-text-xs gs-text-muted gs-ml-auto gs-flex-shrink-0">' + time + '</span>' +
        unreadBadge +
      '</div>' +
      (subtitle ? '<div class="gs-text-xs gs-text-muted">' + escapeHtml(subtitle) + '</div>' : '') +
      '<div class="conv-preview gs-text-sm gs-text-muted gs-truncate">' + escapeHtml(preview.slice(0, 80)) + '</div>' +
    '</div>' +
  '</div>';
}

function showChatContextMenu(e, convId, isPinned) {
  if (chatContextMenuEl) { chatContextMenuEl.remove(); }
  var menu = document.createElement("div");
  menu.className = "context-menu";
  menu.innerHTML =
    '<div class="context-menu-item" data-action="' + (isPinned ? 'unpin' : 'pin') + '">' + (isPinned ? 'Unpin' : 'Pin') + '</div>' +
    '<div class="context-menu-item" data-action="markRead">Mark as read</div>' +
    '<div class="context-menu-item context-menu-danger" data-action="deleteConversation">Delete</div>';
  menu.style.left = e.clientX + "px";
  menu.style.top = e.clientY + "px";
  document.body.appendChild(menu);
  chatContextMenuEl = menu;
  menu.querySelectorAll(".context-menu-item").forEach(function(item) {
    item.addEventListener("click", function(ev) {
      ev.stopPropagation();
      doAction(item.dataset.action, { conversationId: convId });
      menu.remove();
      chatContextMenuEl = null;
    });
  });
}

// ===================== FEED TAB LOGIC =====================
(function initFeed() {
  document.querySelectorAll(".feed-chip").forEach(function(chip) {
    chip.addEventListener("click", function() {
      document.querySelectorAll(".feed-chip").forEach(function(c) { c.classList.remove("active"); });
      chip.classList.add("active");
      feedActiveFilter = chip.dataset.filter;
      renderFeed();
    });
  });
  document.getElementById("feed-load-more").addEventListener("click", function() {
    doAction("loadMore");
    var btn = document.getElementById("feed-load-more");
    btn.textContent = "Loading...";
    btn.disabled = true;
  });
})();

function renderFeed() {
  var container = document.getElementById("feed-events");
  var empty = document.getElementById("feed-empty");
  var filtered = feedActiveFilter === "all" ? feedEvents : feedEvents.filter(function(ev) { return ev.type === feedActiveFilter; });
  if (!filtered.length) {
    container.innerHTML = "";
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";
  container.innerHTML = filtered.map(renderFeedEvent).join("");
  container.querySelectorAll(".feed-repo-link").forEach(function(el) {
    el.addEventListener("click", function() { doAction("viewRepo", { owner: el.dataset.owner, repo: el.dataset.repo }); });
  });
  container.querySelectorAll(".feed-actor-link").forEach(function(el) {
    el.addEventListener("click", function() { doAction("viewProfile", { login: el.dataset.login }); });
  });
}

function renderFeedEvent(ev) {
  var type = ev.type || "trending";
  var icon = feedEventIcons[type] || '<span class="codicon codicon-note"></span>';
  var label = feedEventLabels[type] || type;
  var repo = ev.repo || {};
  var actor = ev.actor || null;
  var narration = ev.narration || {};
  var time = timeAgo(ev.timestamp);
  var repoSlug = (repo.owner || "") + "/" + (repo.name || "");
  var repoAvatar = repo.avatar_url || avatarUrl(repo.owner || "github");
  var detail = "";
  if (type === "trending" && ev.trending) {
    detail = '<span class="feed-detail-badge feed-trending"><span class="codicon codicon-flame"></span> +' + formatCount(ev.trending.stars_this_week) + ' stars this week</span>';
  } else if (type === "release" && ev.release) {
    detail = '<span class="feed-detail-badge feed-release"><span class="codicon codicon-package"></span> ' + escapeHtml(ev.release.tag || "") + '</span>';
  } else if (type === "pr-merged" && ev.prMerged) {
    detail = '<span class="feed-detail-badge feed-pr"><span class="codicon codicon-git-merge"></span> +' + (ev.prMerged.additions || 0) + ' -' + (ev.prMerged.deletions || 0) + '</span>';
  } else if (type === "notable-star" && ev.notableStar) {
    detail = '<span class="feed-detail-badge feed-star"><span class="codicon codicon-star-full"></span> ' + formatCount(ev.notableStar.actor_followers) + ' followers</span>';
  }
  var actorHtml = "";
  if (actor && actor.login) {
    var actorAvatar = actor.avatar_url || avatarUrl(actor.login);
    actorHtml = '<div class="feed-actor"><img src="' + escapeHtml(actorAvatar) + '" class="feed-actor-avatar" alt="">' +
      '<a class="feed-actor-link" href="#" data-login="' + escapeHtml(actor.login) + '">' + escapeHtml(actor.login) + '</a>' +
      (type === "notable-star" && actor.followers > 100 ? ' <span class="feed-actor-followers">' + formatCount(actor.followers) + ' followers</span>' : '') + '</div>';
  }
  var narrationHtml = narration.body ? '<div class="feed-narration">' + escapeHtml(narration.body) + '</div>' : "";
  var descHtml = "";
  if (type === "pr-merged" && ev.prMerged && ev.prMerged.title) {
    descHtml = '<div class="feed-event-desc"><span class="codicon codicon-git-merge"></span> ' + escapeHtml(ev.prMerged.title) + '</div>';
  } else if (type === "release" && ev.release && ev.release.body) {
    descHtml = '<div class="feed-event-desc">' + escapeHtml(ev.release.body.slice(0, 150)) + (ev.release.body.length > 150 ? "..." : "") + '</div>';
  } else if (narration.event_description) {
    descHtml = '<div class="feed-event-desc">' + escapeHtml(narration.event_description.slice(0, 150)) + '</div>';
  }
  return '<div class="feed-event">' +
    '<div class="feed-event-header"><span class="feed-type-label">' + icon + ' ' + escapeHtml(label) + '</span><span class="feed-time">' + time + '</span></div>' +
    '<div class="feed-repo feed-repo-link" data-owner="' + escapeHtml(repo.owner || "") + '" data-repo="' + escapeHtml(repo.name || "") + '">' +
      '<img src="' + escapeHtml(repoAvatar) + '" class="feed-repo-avatar" alt="">' +
      '<div class="feed-repo-info"><span class="feed-repo-name">' + escapeHtml(repoSlug) + '</span>' +
        (repo.description ? '<span class="feed-repo-desc">' + escapeHtml(repo.description.slice(0, 100)) + '</span>' : '') +
        '<div class="feed-repo-meta"><span><span class="codicon codicon-star-full"></span> ' + formatCount(repo.stars || 0) + '</span>' +
          (repo.language ? '<span>· ' + escapeHtml(repo.language) + '</span>' : '') + ' ' + detail + '</div></div></div>' +
    actorHtml + descHtml + narrationHtml + '</div>';
}

function renderMyRepos() {
  var container = document.getElementById("feed-my-repos");
  if (!myRepos.length && !myStarred.length) {
    container.innerHTML = '<div class="gs-empty" style="padding:12px">Loading repos...</div>';
    return;
  }
  var publicRepos = myRepos.filter(function(r) { return !r.private; });
  var privateRepos = myRepos.filter(function(r) { return r.private; });

  var html = '';
  if (publicRepos.length) {
    html += '<div class="gs-section-title">Public (' + publicRepos.length + ')</div>';
    html += publicRepos.map(renderMyRepo).join("");
  }
  if (privateRepos.length) {
    html += '<div class="gs-section-title">Private (' + privateRepos.length + ')</div>';
    html += privateRepos.map(renderMyRepo).join("");
  }
  if (myStarred.length) {
    html += '<div class="gs-section-title">Starred (' + myStarred.length + ')</div>';
    html += myStarred.map(renderMyRepo).join("");
  }
  container.innerHTML = html;
  container.querySelectorAll(".my-repos-item").forEach(function(el) {
    el.addEventListener("click", function() { doAction("viewRepo", { owner: el.dataset.owner, repo: el.dataset.repo }); });
  });
}

function renderMyRepo(repo) {
  var icon = repo.private ? "🔒" : "📁";
  return '<div class="my-repos-item" data-owner="' + escapeHtml(repo.owner) + '" data-repo="' + escapeHtml(repo.name) + '">' +
    '<span style="font-size:10px">' + icon + '</span>' +
    '<span class="gs-truncate gs-flex-1" style="font-size:11px;color:var(--gs-fg)">' + escapeHtml(repo.name) + '</span>' +
    '<span class="gs-text-xs gs-text-muted">' + formatCount(repo.stars) + ' ⭐' + (repo.language ? '  ·  ' + escapeHtml(repo.language) : '') + '</span>' +
  '</div>';
}

// ===================== TRENDING TAB LOGIC =====================
function renderTrending() {
  renderTrendingRepos();
  renderTrendingPeople();
  renderTrendingSuggestions();
}

function renderTrendingRepos() {
  var container = document.getElementById("trending-repos-list");
  if (!trendingRepos.length) {
    container.innerHTML = '<div class="gs-empty" style="padding:12px">Loading trending repos...</div>';
    return;
  }
  container.innerHTML = trendingRepos.map(function(repo, i) {
    var slug = repo.owner + "/" + repo.name;
    var starred = trendingReposStarred[slug] || false;
    var rankClass = i < 3 ? "trending-rank-top" : "trending-rank-rest";
    return '<div class="trending-item" data-owner="' + escapeHtml(repo.owner) + '" data-repo="' + escapeHtml(repo.name) + '">' +
      '<span class="trending-rank ' + rankClass + '">' + (i + 1) + '</span>' +
      '<span class="trending-name">' + escapeHtml(slug) + '</span>' +
      '<span class="trending-stat">' + formatCount(repo.stars) + ' ☆</span>' +
    '</div>';
  }).join("");
  container.querySelectorAll(".trending-item").forEach(function(el) {
    el.addEventListener("click", function() { doAction("viewRepo", { owner: el.dataset.owner, repo: el.dataset.repo }); });
  });
}

function renderTrendingPeople() {
  var container = document.getElementById("trending-people-list");
  if (!trendingPeople.length) {
    container.innerHTML = '<div class="gs-empty" style="padding:12px">Loading trending people...</div>';
    return;
  }
  container.innerHTML = trendingPeople.map(function(person, i) {
    var following = trendingPeopleFollow[person.login] || false;
    var rankClass = i < 3 ? "trending-rank-top" : "trending-rank-rest";
    var starPower = Math.round((person.star_power || person.followers || 0) * 10) / 10;
    return '<div class="trending-item" data-login="' + escapeHtml(person.login) + '">' +
      '<span class="trending-rank ' + rankClass + '">' + (i + 1) + '</span>' +
      '<span class="trending-name">' + escapeHtml(person.name || person.login) + '</span>' +
      '<span class="trending-stat">⭐ ' + starPower + '</span>' +
      '<button class="trending-action-btn' + (following ? ' following' : '') + '" data-login="' + escapeHtml(person.login) + '">' +
        (following ? 'Following' : 'Follow') + '</button>' +
    '</div>';
  }).join("");
  container.querySelectorAll(".trending-item").forEach(function(el) {
    el.addEventListener("click", function(e) {
      if (e.target.closest(".trending-action-btn")) { return; }
      doAction("viewProfile", { login: el.dataset.login });
    });
  });
  container.querySelectorAll(".trending-action-btn").forEach(function(btn) {
    btn.addEventListener("click", function(e) {
      e.stopPropagation();
      var login = btn.dataset.login;
      if (trendingPeopleFollow[login]) {
        doAction("unfollowUser", { login: login });
        trendingPeopleFollow[login] = false;
      } else {
        doAction("followUser", { login: login });
        trendingPeopleFollow[login] = true;
      }
      renderTrendingPeople();
    });
  });
}

function renderTrendingSuggestions() {
  var container = document.getElementById("trending-suggestions-list");
  if (!trendingSuggestions.length) {
    container.innerHTML = '<div class="gs-empty" style="padding:12px">No suggestions available</div>';
    return;
  }
  container.innerHTML = trendingSuggestions.slice(0, 10).map(function(s) {
    var avatar = s.avatar_url || avatarUrl(s.login);
    var reason = s.reason || "";
    return '<div class="gs-list-item suggestion-item" data-login="' + escapeHtml(s.login) + '">' +
      '<img src="' + escapeHtml(avatar) + '" class="gs-avatar gs-avatar-md" alt="">' +
      '<div class="gs-flex-1" style="min-width:0">' +
        '<div class="gs-truncate" style="font-weight:500">@' + escapeHtml(s.login) + '</div>' +
        (reason ? '<div class="gs-text-xs gs-text-muted gs-truncate">' + escapeHtml(reason) + '</div>' : '') +
      '</div>' +
      '<button class="gs-btn-icon dm-btn" data-login="' + escapeHtml(s.login) + '" title="Message"><span class="codicon codicon-mail"></span></button>' +
      '<button class="gs-btn gs-btn-primary follow-btn" data-login="' + escapeHtml(s.login) + '">Follow</button>' +
    '</div>';
  }).join("");

  container.querySelectorAll(".suggestion-item").forEach(function(el) {
    el.addEventListener("click", function(e) {
      if (e.target.closest(".dm-btn") || e.target.closest(".follow-btn")) { return; }
      doAction("viewProfile", { login: el.dataset.login });
    });
    el.addEventListener("mouseenter", function() {
      trendingHoverTimeout = setTimeout(function() { doAction("getPreview", { login: el.dataset.login }); }, 500);
    });
    el.addEventListener("mouseleave", function() {
      clearTimeout(trendingHoverTimeout);
      var card = document.getElementById("trending-hover-card");
      if (card) { card.classList.remove("visible"); }
    });
  });
  container.querySelectorAll(".dm-btn").forEach(function(btn) {
    btn.addEventListener("click", function(e) { e.stopPropagation(); doAction("message", { login: btn.dataset.login }); });
  });
  container.querySelectorAll(".follow-btn").forEach(function(btn) {
    btn.addEventListener("click", function(e) {
      e.stopPropagation();
      doAction("followUser", { login: btn.dataset.login });
      btn.textContent = "Following";
      btn.disabled = true;
      btn.classList.remove("gs-btn-primary");
      btn.classList.add("gs-btn-secondary");
    });
  });
}

// ===================== MESSAGE HANDLER =====================
window.addEventListener("message", function(e) {
  var data = e.data;
  switch (data.type) {
    // Chat messages
    case "setChatData":
      chatFriends = data.friends || [];
      chatConversations = data.conversations || [];
      chatCurrentUser = data.currentUser;
      renderChat();
      break;
    case "clearUnread":
      var f = chatFriends.find(function(fr) { return fr.login === data.login; });
      if (f) { f.unread = 0; }
      renderChat();
      break;
    case "friendTyping":
      var login = data.login;
      if (chatTypingUsers[login]) { clearTimeout(chatTypingUsers[login]); }
      chatTypingUsers[login] = setTimeout(function() { delete chatTypingUsers[login]; renderChat(); }, 5000);
      renderChat();
      break;
    case "settings":
      document.getElementById("chat-setting-notifications").checked = data.showMessageNotifications !== false;
      document.getElementById("chat-setting-sound").checked = data.messageSound === true;
      document.getElementById("chat-setting-debug").checked = data.debugLogs === true;
      break;

    // Feed messages
    case "setFeedEvents":
      if (data.replace) { feedEvents = data.events || []; }
      else { feedEvents = feedEvents.concat(data.events || []); }
      renderFeed();
      var btn = document.getElementById("feed-load-more");
      btn.textContent = "Load more";
      btn.disabled = false;
      btn.style.display = data.hasMore ? "block" : "none";
      break;
    case "setMyRepos":
      myRepos = data.repos || [];
      myStarred = data.starred || [];
      renderMyRepos();
      break;

    // Trending messages
    case "setTrendingRepos":
      trendingRepos = data.repos || [];
      trendingReposStarred = data.starred || {};
      renderTrendingRepos();
      break;
    case "setTrendingPeople":
      trendingPeople = data.people || [];
      trendingPeopleFollow = data.followMap || {};
      renderTrendingPeople();
      break;
    case "setSuggestions":
      trendingSuggestions = data.suggestions || [];
      renderTrendingSuggestions();
      break;
    case "setPreview":
      showTrendingHoverCard(data.login, data.preview);
      break;
    case "followChanged":
      // Update trending people follow state
      if (data.login) {
        trendingPeopleFollow[data.login] = data.following;
        renderTrendingPeople();
      }
      // Update suggestion button
      if (data.following) {
        var fbtn = document.querySelector('.follow-btn[data-login="' + CSS.escape(data.login) + '"]');
        if (fbtn) { fbtn.textContent = "Following"; fbtn.disabled = true; fbtn.classList.remove("gs-btn-primary"); fbtn.classList.add("gs-btn-secondary"); }
      }
      break;
  }
});

function showTrendingHoverCard(login, preview) {
  if (!preview) { return; }
  var card = document.getElementById("trending-hover-card");
  var item = document.querySelector('.suggestion-item[data-login="' + CSS.escape(login) + '"]');
  if (!item || !card) { return; }
  var avatar = preview.avatar_url || avatarUrl(login, 120);
  card.innerHTML =
    '<div class="gs-flex gs-gap-8 gs-items-center" style="margin-bottom:8px">' +
      '<img src="' + escapeHtml(avatar) + '" class="gs-avatar gs-avatar-lg" alt="">' +
      '<div class="gs-flex-1"><div style="font-weight:600">' + escapeHtml(preview.name || login) + '</div>' +
        '<div class="gs-text-sm gs-text-muted">@' + escapeHtml(login) + '</div></div></div>' +
    (preview.bio ? '<div class="gs-text-sm" style="margin-bottom:8px">' + escapeHtml(preview.bio) + '</div>' : '') +
    '<div class="gs-text-xs gs-text-muted"><strong>' + formatCount(preview.following || 0) + '</strong> Following  <strong>' + formatCount(preview.followers || 0) + '</strong> Followers</div>';
  var rect = item.getBoundingClientRect();
  card.style.top = rect.top + "px";
  card.style.left = (rect.right + 8) + "px";
  card.classList.add("visible");
}

// ===================== INIT =====================
doAction("ready");
```

- [ ] **Step 2: Commit**

```bash
git add media/webview/explore.js
git commit -m "feat: add explore.js — unified JS for tabbed explore webview"
```

---

### Task 4: Create explore.ts — Unified Provider

**Files:**
- Create: `src/webviews/explore.ts`

- [ ] **Step 1: Create the ExploreWebviewProvider**

This provider consolidates all data-fetching and message-routing from chat-panel.ts, feed.ts, who-to-follow.ts, and tree-view providers. The HTML template renders 3 tab panes.

```typescript
import * as vscode from "vscode";
import { apiClient, getOtherUser } from "../api";
import { authManager } from "../auth";
import { realtimeClient } from "../realtime";
import { configManager } from "../config";
import { getNonce, getUri, log } from "../utils";
import { formatCount } from "../utils";
import { fireFollowChanged, onDidChangeFollow } from "../events/follow";
import type { Conversation, ExtensionModule, TrendingRepo, TrendingPerson, UserRepo, WebviewMessage } from "../types";

export class ExploreWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "trending.explore";
  private view?: vscode.WebviewView;

  // Chat state
  private _dmConvMap = new Map<string, string>();
  private _mutedConvs = new Set<string>();

  // Feed state
  private _feedPage = 1;

  // Polling
  private _trendingInterval?: ReturnType<typeof setInterval>;
  private _refreshTimer?: ReturnType<typeof setTimeout>;

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")],
    };
    webviewView.webview.html = this.getHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage((msg: WebviewMessage) => this.onMessage(msg));
  }

  // ===================== CHAT DATA =====================
  debouncedRefreshChat(): void {
    clearTimeout(this._refreshTimer);
    this._refreshTimer = setTimeout(() => this.refreshChat(), 500);
  }

  async refreshChat(): Promise<void> {
    if (!authManager.isSignedIn || !this.view) { return; }
    apiClient.invalidateConversationsCache();
    try {
      let following = await apiClient.getFollowing(1, 100);
      log(`[Explore/Chat] getFollowing returned ${following.length} friends`);
      if (following.length === 0 && authManager.token) {
        following = await this.fetchGitHubFollowing(authManager.token);
      }
      const logins = following.map((f: { login: string }) => f.login);
      let presenceData: Record<string, string | null> = {};
      if (logins.length) {
        try {
          presenceData = await apiClient.getPresence(logins.slice(0, 50));
        } catch (err) {
          log(`[Explore/Chat] getPresence failed: ${err}`, "warn");
        }
      }

      let conversations: Conversation[] = [];
      try {
        conversations = await apiClient.getConversations();
        realtimeClient.subscribeToConversations(conversations.map(c => c.id));
      } catch (err) {
        log(`[Explore/Chat] getConversations failed: ${err}`, "warn");
      }

      const unreadCounts: Record<string, number> = {};
      for (const conv of conversations) {
        const other = getOtherUser(conv, authManager.login);
        if (other && ((conv as unknown as Record<string, number>).unread_count > 0)) {
          unreadCounts[other.login] = (conv as unknown as Record<string, number>).unread_count || 1;
        }
      }

      const threshold = configManager.current.presenceHeartbeat * 5;
      const friends = following.map((f: { login: string; name?: string; avatar_url?: string }) => {
        const lastSeenStr = presenceData[f.login];
        const lastSeen = lastSeenStr ? new Date(lastSeenStr).getTime() : 0;
        const online = lastSeen > 0 && (Date.now() - lastSeen < threshold);
        return { login: f.login, name: f.name || f.login, avatar_url: f.avatar_url || "", online, lastSeen, unread: unreadCounts[f.login] || 0 };
      });

      friends.sort((a: { online: boolean; lastSeen: number; name: string }, b: { online: boolean; lastSeen: number; name: string }) => {
        if (a.online && !b.online) { return -1; }
        if (!a.online && b.online) { return 1; }
        if (a.lastSeen !== b.lastSeen) { return b.lastSeen - a.lastSeen; }
        return a.name.localeCompare(b.name);
      });

      this._dmConvMap.clear();
      this._mutedConvs.clear();
      const convData = conversations.map((c: Conversation) => {
        const other = getOtherUser(c, authManager.login);
        if (c.type !== "group" && !c.is_group && other) { this._dmConvMap.set(c.id, other.login); }
        if ((c as unknown as Record<string, boolean>).is_muted) { this._mutedConvs.add(c.id); }
        return { ...c, other_user: other };
      });

      this.view.webview.postMessage({ type: "setChatData", friends, conversations: convData, currentUser: authManager.login });
    } catch (err) {
      log(`[Explore/Chat] refresh failed: ${err}`, "warn");
    }
  }

  setBadge(count: number): void {
    if (this.view) {
      this.view.badge = count > 0 ? { value: count, tooltip: `${count} unread message${count !== 1 ? "s" : ""}` } : undefined;
    }
  }

  clearUnread(login: string): void {
    this.view?.webview.postMessage({ type: "clearUnread", login });
  }

  isConversationMuted(conversationId: string): boolean {
    return this._mutedConvs.has(conversationId);
  }

  showTyping(conversationId: string, user: string): void {
    if (conversationId) {
      const dmLogin = this._dmConvMap.get(conversationId);
      if (dmLogin && dmLogin === user) {
        this.view?.webview.postMessage({ type: "friendTyping", login: user });
      }
    } else {
      for (const [, login] of this._dmConvMap) {
        if (login === user) {
          this.view?.webview.postMessage({ type: "friendTyping", login: user });
          break;
        }
      }
    }
  }

  private async fetchGitHubFollowing(token: string): Promise<{ login: string; name: string; avatar_url: string }[]> {
    try {
      const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" };
      const res = await fetch("https://api.github.com/user/following?per_page=100", { headers });
      if (!res.ok) { return []; }
      const users = (await res.json()) as { login: string; avatar_url?: string }[];
      return users.map(u => ({ login: u.login, name: u.login, avatar_url: u.avatar_url || "" }));
    } catch { return []; }
  }

  // ===================== FEED DATA =====================
  async refreshFeed(): Promise<void> {
    if (!authManager.isSignedIn || !this.view) { return; }
    try {
      this._feedPage = 1;
      const { results, hasMore } = await apiClient.getForYouFeed(this._feedPage);
      log(`[Explore/Feed] loaded ${results.length} for-you items`);
      this.view.webview.postMessage({ type: "setFeedEvents", events: results, replace: true, hasMore });
    } catch (err) {
      log(`[Explore/Feed] refresh failed: ${err}`, "warn");
    }
  }

  async refreshMyRepos(): Promise<void> {
    if (!authManager.isSignedIn || !this.view) { return; }
    try {
      const [repos, starred] = await Promise.all([
        apiClient.getUserRepos().catch(() => [] as UserRepo[]),
        apiClient.getStarredRepos().catch(() => [] as UserRepo[]),
      ]);
      this.view.webview.postMessage({ type: "setMyRepos", repos, starred });
    } catch (err) {
      log(`[Explore/MyRepos] refresh failed: ${err}`, "warn");
    }
  }

  // ===================== TRENDING DATA =====================
  async refreshTrendingRepos(): Promise<void> {
    if (!this.view) { return; }
    try {
      const repos = await apiClient.getTrendingRepos();
      let starred: Record<string, boolean> = {};
      if (authManager.isSignedIn && repos.length) {
        const slugs = repos.map((r: TrendingRepo) => `${r.owner}/${r.name}`);
        starred = await apiClient.batchCheckStarred(slugs);
      }
      this.view.webview.postMessage({ type: "setTrendingRepos", repos, starred });
    } catch (err) {
      log(`[Explore/TrendingRepos] refresh failed: ${err}`, "warn");
    }
  }

  async refreshTrendingPeople(): Promise<void> {
    if (!this.view) { return; }
    try {
      const people = await apiClient.getTrendingPeople();
      const followMap: Record<string, boolean> = {};
      if (authManager.isSignedIn && people.length) {
        const logins = people.map((p: TrendingPerson) => p.login);
        const statuses = await apiClient.batchFollowStatus(logins);
        for (const [login, status] of Object.entries(statuses)) {
          followMap[login] = (status as { following: boolean }).following;
        }
      }
      this.view.webview.postMessage({ type: "setTrendingPeople", people, followMap });
    } catch (err) {
      log(`[Explore/TrendingPeople] refresh failed: ${err}`, "warn");
    }
  }

  async refreshSuggestions(): Promise<void> {
    if (!authManager.isSignedIn || !this.view) { return; }
    try {
      const suggestions = await apiClient.getFollowingSuggestions();
      this.view.webview.postMessage({ type: "setSuggestions", suggestions });
    } catch (err) {
      log(`[Explore/WhoToFollow] refresh failed: ${err}`, "warn");
    }
  }

  // ===================== REFRESH ALL =====================
  async refreshAll(): Promise<void> {
    await Promise.allSettled([
      this.refreshChat(),
      this.refreshFeed(),
      this.refreshMyRepos(),
      this.refreshTrendingRepos(),
      this.refreshTrendingPeople(),
      this.refreshSuggestions(),
    ]);
  }

  startPolling(context: vscode.ExtensionContext): void {
    const interval = configManager.current.trendingPollInterval;
    this._trendingInterval = setInterval(() => {
      this.refreshTrendingRepos();
      this.refreshTrendingPeople();
    }, interval);

    configManager.onDidChangeFocus((focused) => {
      if (this._trendingInterval) { clearInterval(this._trendingInterval); }
      const newInterval = focused ? interval : interval * 3;
      if (focused) {
        this.refreshTrendingRepos();
        this.refreshTrendingPeople();
      }
      this._trendingInterval = setInterval(() => {
        this.refreshTrendingRepos();
        this.refreshTrendingPeople();
      }, newInterval);
    });

    context.subscriptions.push({ dispose: () => { if (this._trendingInterval) { clearInterval(this._trendingInterval); } } });
  }

  // ===================== MESSAGE HANDLER =====================
  private async onMessage(msg: WebviewMessage): Promise<void> {
    const p = msg.payload as Record<string, string>;
    switch (msg.type) {
      case "ready": {
        const cfg = configManager.current;
        this.view?.webview.postMessage({
          type: "settings",
          showMessageNotifications: cfg.showMessageNotifications,
          messageSound: cfg.messageSound,
          debugLogs: cfg.debugLogs,
        });
        this.refreshAll();
        break;
      }

      // Settings
      case "updateSetting": {
        const { key, value } = msg.payload as { key: string; value: boolean };
        const settingMap: Record<string, string> = {
          notifications: "trending.showMessageNotifications",
          sound: "trending.messageSound",
          debug: "trending.debugLogs",
        };
        const settingKey = settingMap[key];
        if (settingKey) {
          await vscode.workspace.getConfiguration().update(settingKey, value, vscode.ConfigurationTarget.Global);
        }
        break;
      }
      case "signOut":
        vscode.commands.executeCommand("trending.signOut");
        break;

      // Chat actions
      case "openChat":
        vscode.commands.executeCommand("trending.messageUser", p.login);
        break;
      case "viewProfile":
        vscode.commands.executeCommand("trending.viewProfile", p.login);
        break;
      case "openConversation":
        vscode.commands.executeCommand("trending.openChat", p.conversationId);
        break;
      case "newChat": {
        const choice = await vscode.window.showQuickPick(
          [
            { label: "$(comment-discussion) New Message", description: "Direct message to a user", value: "dm" },
            { label: "$(organization) New Group", description: "Create a group chat", value: "group" },
          ],
          { placeHolder: "Start a new conversation" }
        );
        if (choice?.value === "dm") { vscode.commands.executeCommand("trending.messageUser"); }
        else if (choice?.value === "group") { vscode.commands.executeCommand("trending.createGroup"); }
        break;
      }
      case "pin":
        try { await apiClient.pinConversation(p.conversationId); this.refreshChat(); }
        catch { vscode.window.showErrorMessage("Failed to pin conversation"); }
        break;
      case "unpin":
        try { await apiClient.unpinConversation(p.conversationId); this.refreshChat(); }
        catch { vscode.window.showErrorMessage("Failed to unpin conversation"); }
        break;
      case "markRead":
        try {
          await apiClient.markConversationRead(p.conversationId);
          this.refreshChat();
          import("../statusbar").then(m => m.fetchCounts()).catch(() => {});
        }
        catch { vscode.window.showErrorMessage("Failed to mark as read"); }
        break;
      case "deleteConversation": {
        const confirm = await vscode.window.showWarningMessage("Delete this conversation?", { modal: true }, "Delete");
        if (confirm === "Delete") {
          try { await apiClient.deleteConversation(p.conversationId); this.refreshChat(); }
          catch { vscode.window.showErrorMessage("Failed to delete conversation"); }
        }
        break;
      }

      // Feed actions
      case "loadMore":
        this._feedPage++;
        try {
          const { results, hasMore } = await apiClient.getForYouFeed(this._feedPage);
          this.view?.webview.postMessage({ type: "setFeedEvents", events: results, replace: false, hasMore });
        } catch (err) {
          log(`[Explore/Feed] loadMore failed: ${err}`, "warn");
        }
        break;
      case "like":
        try {
          const [owner, repo] = (p.repoSlug || "").split("/");
          if (owner && repo) { await apiClient.toggleLike(owner, repo, p.eventId); }
        } catch { /* ignore */ }
        break;
      case "openUrl":
        if (p.url) { vscode.env.openExternal(vscode.Uri.parse(p.url)); }
        break;
      case "viewRepo": {
        const { owner, repo } = msg.payload as { owner: string; repo: string };
        if (owner && repo) { vscode.commands.executeCommand("trending.viewRepoDetail", owner, repo); }
        break;
      }

      // Trending actions
      case "followUser":
        try {
          await apiClient.followUser(p.login);
          fireFollowChanged(p.login, true);
        } catch {
          vscode.window.showErrorMessage("Failed to follow user");
          this.refreshTrendingPeople();
          this.refreshSuggestions();
        }
        break;
      case "unfollowUser":
        try {
          await apiClient.unfollowUser(p.login);
          fireFollowChanged(p.login, false);
        } catch {
          vscode.window.showErrorMessage("Failed to unfollow user");
          this.refreshTrendingPeople();
        }
        break;
      case "message":
        vscode.commands.executeCommand("trending.messageUser", p.login);
        break;
      case "getPreview":
        try {
          const preview = await apiClient.getUserPreview(p.login);
          this.view?.webview.postMessage({ type: "setPreview", login: p.login, preview });
        } catch { /* ignore */ }
        break;
    }
  }

  // ===================== HTML TEMPLATE =====================
  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const sharedCss = getUri(webview, this.extensionUri, ["media", "webview", "shared.css"]);
    const codiconCss = getUri(webview, this.extensionUri, ["media", "webview", "codicon.css"]);
    const css = getUri(webview, this.extensionUri, ["media", "webview", "explore.css"]);
    const sharedJs = getUri(webview, this.extensionUri, ["media", "webview", "shared.js"]);
    const js = getUri(webview, this.extensionUri, ["media", "webview", "explore.js"]);

    return `<!DOCTYPE html>
<html><head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} https:;">
  <link rel="stylesheet" href="${sharedCss}">
  <link rel="stylesheet" href="${codiconCss}">
  <link rel="stylesheet" href="${css}">
</head><body>

<!-- Main Tab Bar -->
<div class="explore-tabs">
  <button class="explore-tab active" data-tab="chat">💬 Chat <span id="chat-main-badge" class="tab-badge" style="display:none"></span></button>
  <button class="explore-tab" data-tab="feed">📰 Feed</button>
  <button class="explore-tab" data-tab="trending">🔥 Trending</button>
</div>

<!-- ===================== CHAT PANE ===================== -->
<div id="pane-chat" class="tab-pane active">
  <div class="chat-header" style="position:relative">
    <div class="chat-sub-tabs">
      <button class="chat-sub-tab active" data-tab="inbox">Inbox <span id="chat-tab-inbox-count"></span></button>
      <button class="chat-sub-tab" data-tab="friends">Friends <span id="chat-tab-friends-count"></span></button>
    </div>
    <div class="gs-flex gs-gap-4 gs-items-center">
      <button class="gs-btn-icon" id="chat-settings-btn" title="Settings"><span class="codicon codicon-settings-gear"></span></button>
      <button class="gs-btn-icon" id="chat-new" title="New message"><span class="codicon codicon-comment"></span></button>
    </div>
    <div class="settings-dropdown" id="chat-settings-dropdown" style="display:none">
      <label class="settings-item"><input type="checkbox" id="chat-setting-notifications" checked /> Message notifications</label>
      <label class="settings-item"><input type="checkbox" id="chat-setting-sound" /> Message sound</label>
      <label class="settings-item"><input type="checkbox" id="chat-setting-debug" /> Debug logs</label>
      <div class="settings-divider"></div>
      <button class="settings-action" id="chat-setting-signout">Sign Out</button>
    </div>
  </div>
  <div id="chat-search-bar" style="padding:6px 12px;display:none">
    <input type="text" id="chat-search" class="gs-input" placeholder="Search..." style="font-size:12px">
  </div>
  <div id="chat-filter-bar" class="filter-bar" style="display:none">
    <button class="filter-btn active" data-filter="all">All <span class="filter-count" id="chat-count-all"></span></button>
    <button class="filter-btn" data-filter="direct">Direct <span class="filter-count" id="chat-count-direct"></span></button>
    <button class="filter-btn" data-filter="group">Group <span class="filter-count" id="chat-count-group"></span></button>
    <button class="filter-btn" data-filter="requests">Requests <span class="filter-count" id="chat-count-requests"></span></button>
    <button class="filter-btn" data-filter="unread">Unread <span class="filter-count" id="chat-count-unread"></span></button>
  </div>
  <div id="chat-content"></div>
  <div id="chat-empty" class="gs-empty" style="display:none"></div>
</div>

<!-- ===================== FEED PANE ===================== -->
<div id="pane-feed" class="tab-pane">
  <div class="feed-filters" id="feed-filters">
    <button class="feed-chip active" data-filter="all">All</button>
    <button class="feed-chip" data-filter="trending"><span class="codicon codicon-flame"></span> Repos</button>
    <button class="feed-chip" data-filter="release"><span class="codicon codicon-package"></span> Released</button>
    <button class="feed-chip" data-filter="pr-merged"><span class="codicon codicon-git-merge"></span> Merged</button>
    <button class="feed-chip" data-filter="notable-star"><span class="codicon codicon-star-full"></span> Notable</button>
  </div>
  <div id="feed-events"></div>
  <div id="feed-empty" class="gs-empty" style="display:none">Follow people to see their activity here</div>
  <button id="feed-load-more" class="load-more-btn" style="display:none">Load more</button>
  <div style="border-top:1px solid var(--gs-divider);margin-top:8px">
    <div class="trending-section-header">
      <span class="trending-section-title">My Repos</span>
      <button class="gs-btn-icon" id="feed-repos-refresh" title="Refresh"><span class="codicon codicon-refresh"></span></button>
    </div>
    <div id="feed-my-repos"></div>
  </div>
</div>

<!-- ===================== TRENDING PANE ===================== -->
<div id="pane-trending" class="tab-pane">
  <div class="trending-section">
    <div class="trending-section-header">
      <span class="trending-section-title">Repos</span>
      <button class="gs-btn-icon" id="trending-repos-refresh" title="Refresh"><span class="codicon codicon-refresh"></span></button>
    </div>
    <div id="trending-repos-list"></div>
  </div>
  <div class="trending-section">
    <div class="trending-section-header">
      <span class="trending-section-title">People</span>
      <button class="gs-btn-icon" id="trending-people-refresh" title="Refresh"><span class="codicon codicon-refresh"></span></button>
    </div>
    <div id="trending-people-list"></div>
  </div>
  <div class="trending-section">
    <div class="trending-section-header">
      <span class="trending-section-title">Who to Follow</span>
    </div>
    <div id="trending-suggestions-list"></div>
    <div id="trending-hover-card" class="gs-hover-card"></div>
  </div>
</div>

<script nonce="${nonce}" src="${sharedJs}"></script>
<script nonce="${nonce}" src="${js}"></script>
</body></html>`;
  }
}

// ===================== MODULE EXPORT =====================
export let exploreWebviewProvider: ExploreWebviewProvider;

export const exploreWebviewModule: ExtensionModule = {
  id: "explore",
  activate(context) {
    exploreWebviewProvider = new ExploreWebviewProvider(context.extensionUri);
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(ExploreWebviewProvider.viewType, exploreWebviewProvider)
    );

    // Auth change → refresh all
    authManager.onDidChangeAuth(() => exploreWebviewProvider.refreshAll());

    // Realtime events → chat updates
    realtimeClient.onNewMessage(() => exploreWebviewProvider.debouncedRefreshChat());
    realtimeClient.onPresence(() => exploreWebviewProvider.debouncedRefreshChat());
    realtimeClient.onConversationUpdated(() => exploreWebviewProvider.debouncedRefreshChat());
    realtimeClient.onTyping((data) => exploreWebviewProvider.showTyping(data.conversationId, data.user));

    // Follow state sync
    const followSub = onDidChangeFollow((e) => {
      exploreWebviewProvider.view?.webview.postMessage({ type: "followChanged", login: e.username, following: e.following });
    });
    context.subscriptions.push(followSub);

    // Trending polling
    exploreWebviewProvider.startPolling(context);

    // If already signed in, trigger initial refresh
    if (authManager.isSignedIn) { exploreWebviewProvider.refreshAll(); }
  },
};
```

**Note:** The `view` field needs to be accessible from the module export for follow events. Add this to the class:

Add `get webview() { return this.view; }` — actually, let's just make `view` non-private. Change `private view?` to `view?` (package-level access in the module).

- [ ] **Step 2: Commit**

```bash
git add src/webviews/explore.ts
git commit -m "feat: add ExploreWebviewProvider — unified tabbed explore webview"
```

---

### Task 5: Update extension.ts — Replace Modules

**Files:**
- Modify: `src/extension.ts`

- [ ] **Step 1: Update imports — remove old, add new**

Replace lines 11-16 of `src/extension.ts`:

Old:
```typescript
import { myReposModule } from "./tree-views/my-repos";
import { trendingReposModule } from "./tree-views/trending-repos";
import { trendingPeopleModule } from "./tree-views/trending-people";
import { whoToFollowWebviewModule } from "./webviews/who-to-follow";
import { chatPanelWebviewModule } from "./webviews/chat-panel";
import { feedWebviewModule } from "./webviews/feed";
```

New:
```typescript
import { exploreWebviewModule } from "./webviews/explore";
```

- [ ] **Step 2: Update modules array**

Replace the `modules` array (lines 24-42):

```typescript
const modules: ExtensionModule[] = [
  configModule,
  authModule,
  apiClientModule,
  realtimeModule,
  commandsModule,
  statusBarModule,
  exploreWebviewModule,
  notificationsWebviewModule,
  repoDetailModule,
  profileModule,
  chatModule,
  welcomeModule,
];
```

- [ ] **Step 3: Update parallelModules array**

Replace the `parallelModules` array (lines 49-56):

```typescript
const parallelModules: ExtensionModule[] = [
  welcomeModule,
  telemetryModule,
  statusBarModule, exploreWebviewModule,
  notificationsWebviewModule, repoDetailModule,
  profileModule, chatModule,
];
```

- [ ] **Step 4: Update statusbar imports**

Check if `src/statusbar/index.ts` imports `chatPanelWebviewProvider` for badge updates. If so, update it to import `exploreWebviewProvider` from `../webviews/explore` instead.

Run: `grep -rn "chatPanelWebviewProvider" src/`

Update any references to use `exploreWebviewProvider` instead (same `.setBadge()`, `.isConversationMuted()`, `.clearUnread()` methods exist on the new provider).

- [ ] **Step 5: Verify compilation**

Run: `npm run check-types`
Expected: No type errors

- [ ] **Step 6: Commit**

```bash
git add src/extension.ts src/statusbar/
git commit -m "refactor: replace 6 sidebar modules with unified exploreWebviewModule"
```

---

### Task 6: Wire up refresh buttons in explore.js

**Files:**
- Modify: `media/webview/explore.js`

- [ ] **Step 1: Add click handlers for refresh buttons**

Add to the bottom of `explore.js`, before the `doAction("ready")` line:

```js
// Refresh buttons
document.getElementById("trending-repos-refresh").addEventListener("click", function() { doAction("refreshTrendingRepos"); });
document.getElementById("trending-people-refresh").addEventListener("click", function() { doAction("refreshTrendingPeople"); });
document.getElementById("feed-repos-refresh").addEventListener("click", function() { doAction("refreshMyRepos"); });
```

- [ ] **Step 2: Add message handlers in explore.ts**

Add these cases to the `onMessage` switch in `explore.ts`:

```typescript
case "refreshTrendingRepos":
  this.refreshTrendingRepos();
  break;
case "refreshTrendingPeople":
  this.refreshTrendingPeople();
  break;
case "refreshMyRepos":
  this.refreshMyRepos();
  break;
```

- [ ] **Step 3: Commit**

```bash
git add media/webview/explore.js src/webviews/explore.ts
git commit -m "feat: wire up refresh buttons for trending and my repos sections"
```

---

### Task 7: Fix References — statusbar, commands, notifications

**Files:**
- Modify: Files that reference old providers (find with grep)

- [ ] **Step 1: Find all references to old providers**

Run: `grep -rn "chatPanelWebviewProvider\|feedWebviewProvider\|whoToFollowWebviewProvider\|trendingReposProvider\|trendingPeopleProvider\|myReposProvider" src/ --include="*.ts"`

- [ ] **Step 2: Update each reference**

For each file found:
- Replace `import { chatPanelWebviewProvider } from "./webviews/chat-panel"` with `import { exploreWebviewProvider } from "./webviews/explore"`
- Replace `chatPanelWebviewProvider.setBadge(...)` with `exploreWebviewProvider.setBadge(...)`
- Replace `chatPanelWebviewProvider.isConversationMuted(...)` with `exploreWebviewProvider.isConversationMuted(...)`
- Replace `chatPanelWebviewProvider.clearUnread(...)` with `exploreWebviewProvider.clearUnread(...)`
- Replace any `feedWebviewProvider.refresh()` with `exploreWebviewProvider.refreshFeed()`
- Replace any `trendingReposProvider.fetchAndRefresh()` with `exploreWebviewProvider.refreshTrendingRepos()`
- Replace any `trendingPeopleProvider.fetchAndRefresh()` with `exploreWebviewProvider.refreshTrendingPeople()`

- [ ] **Step 3: Verify compilation**

Run: `npm run check-types`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add src/
git commit -m "refactor: update all provider references to use exploreWebviewProvider"
```

---

### Task 8: Build & Test

**Files:** None (verification only)

- [ ] **Step 1: Run full build**

Run: `npm run compile`
Expected: Clean build with no errors

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: No lint errors (or only pre-existing ones)

- [ ] **Step 3: Manual test in Extension Development Host**

1. Press F5 to launch Extension Development Host
2. Verify: Explore sidebar shows single webview with 3 tabs (Chat | Feed | Trending)
3. Verify: Chat tab — Inbox/Friends sub-tabs work, conversations load, context menu works
4. Verify: Feed tab — filter chips work, events load, Load more works, My Repos section shows
5. Verify: Trending tab — repos list with rankings, people list with follow/unfollow, Who to Follow with hover cards
6. Verify: Clicking a chat item opens conversation panel in editor
7. Verify: Activity bar shows only Explore icon (no separate Chat icon)
8. Verify: Badge count on Explore icon for unread messages

- [ ] **Step 4: Commit any fixes**

```bash
git add .
git commit -m "fix: address issues found during manual testing"
```

---

### Task 9: Cleanup — Remove old CSS/JS references from esbuild

**Files:**
- Check: `esbuild.js` for any references to old files

- [ ] **Step 1: Verify esbuild doesn't bundle webview files**

Run: `grep -n "chat-panel\|who-to-follow\|feed" esbuild.js`

Webview CSS/JS files are typically served directly (not bundled). If esbuild references them, no changes needed since they stay in `media/webview/`. The old files remain but are unused — they can be removed in a follow-up PR.

- [ ] **Step 2: Final compile check**

Run: `npm run compile`
Expected: Clean

- [ ] **Step 3: Commit**

```bash
git commit --allow-empty -m "chore: verify build after explore tabs migration"
```
