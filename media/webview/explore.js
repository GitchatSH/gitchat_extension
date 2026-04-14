// explore.js — Unified Explore tabbed webview
// Depends on shared.js (loaded first): vscode, doAction, escapeHtml, formatCount, timeAgo, avatarUrl
// Depends on sidebar-chat.js (loaded second): window.SidebarChat (may not exist yet)

// ===================== GLOBAL STATE =====================
var currentTab = "chat";
var navStack = "list"; // "list" or "chat"

// ===================== SEARCH STATE =====================
var searchMode = false;
var previousActiveTab = "chat";
var searchDebounceTimer = null;

// ===================== CHAT STATE =====================
var chatFriends = [];
var chatConversations = [];
var chatCurrentUser = null;
var chatSubTab = "inbox";
var chatSearchQuery = "";
var chatFilter = "all";
var chatContextMenuEl = null;
var chatTypingUsers = {};
var chatDrafts = {};
// Global message search (Telegram-style) — results from backend /messages/search
var chatGlobalSearchResults = null;      // null = not fetched; [] = fetched 0 matches; Array<msg> = matches
var chatGlobalSearchLoading = false;
var chatGlobalSearchError = false;
var chatGlobalSearchNextCursor = null;
var chatGlobalSearchDebounce = null;

// ===================== PER-TAB SCROLL & LOADING STATE =====================
var tabScrollPositions = { chat: 0, friends: 0, discover: 0 };
var chatDataLoaded = false;

// ===================== DISCOVER TAB STATE =====================
var chatChannels = [];

// ===================== DEVELOP TAB STATE =====================
var LANG_COLORS = {
  'JavaScript': '#f1e05a', 'TypeScript': '#3178c6', 'Python': '#3572A5',
  'Go': '#00ADD8', 'Rust': '#dea584', 'Java': '#b07219', 'C++': '#f34b7d',
  'C': '#555555', 'C#': '#178600', 'Ruby': '#701516', 'PHP': '#4F5D95',
  'Swift': '#F05138', 'Kotlin': '#A97BFF', 'Shell': '#89e051',
  'HTML': '#e34c26', 'CSS': '#563d7c', 'Vue': '#41b883', 'Dart': '#00B4AB',
};
var devLoadedTabs = {};
var devCurrentRange = 'weekly';
var devReposSearchTimer = null;
var devTrendingReposCache = [];
var devTrendingPeopleCache = [];
var devChannelsList = [];
var devChatFriends = [];
var devChatConversations = [];
var devChatCurrentUser = null;
var devChatDrafts = {};
var devChatActiveTab = 'inbox';
var devChatFilter = 'all';
var devChatSearchQuery = '';
var devChatContextMenu = null;
function devFmt(n) { return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n || 0); }

// ===================== NAV: PUSH / POP CHAT VIEW =====================
var _listScrollTop = 0;

function pushChatView(conversationId, convData) {
  // Save list scroll position before switching
  var listEl = document.getElementById("chat-content");
  if (listEl) { _listScrollTop = listEl.scrollTop; }

  navStack = "chat";
  var nav = document.getElementById("gs-nav");
  if (nav) { nav.classList.add("chat-active"); }
  var mainTabs = document.getElementById("gs-main-tabs");
  if (mainTabs) { mainTabs.style.display = "none"; }
  var searchBar = document.getElementById("gs-search-bar");
  if (searchBar) { searchBar.style.display = "none"; }
  if (typeof SidebarChat !== "undefined" && SidebarChat.open) {
    SidebarChat.open(conversationId, convData);
  }
  // Tell provider to load conversation data
  vscode.postMessage({ type: "chat:open", payload: { conversationId: conversationId } });
  persistState();
}

function popChatView() {
  navStack = "list";
  var nav = document.getElementById("gs-nav");
  if (nav) { nav.classList.remove("chat-active"); }
  var mainTabs = document.getElementById("gs-main-tabs");
  if (mainTabs) { mainTabs.style.display = ""; }
  var searchBar = document.getElementById("gs-search-bar");
  if (searchBar) { searchBar.style.display = ""; }
  if (typeof SidebarChat !== "undefined" && SidebarChat.close) {
    SidebarChat.close();
  }
  vscode.postMessage({ type: "chat:close" });
  persistState();

  // Restore list scroll position
  var listEl = document.getElementById("chat-content");
  if (listEl) { listEl.scrollTop = _listScrollTop; }
}

// ===================== MAIN TAB SWITCHING =====================
var chatMainTab = "chat"; // chat | friends | discover

document.querySelectorAll(".gs-main-tab").forEach(function(tab) {
  tab.addEventListener("click", function() {
    // Save current tab scroll position before switching
    var currentId = chatMainTab === "chat" ? "chat-content" : chatMainTab + "-content";
    var currentContainer = document.getElementById(currentId);
    if (currentContainer) tabScrollPositions[chatMainTab] = currentContainer.scrollTop;

    document.querySelectorAll(".gs-main-tab").forEach(function(t) { t.classList.remove("active"); });
    tab.classList.add("active");
    chatMainTab = tab.dataset.tab;
    currentTab = chatMainTab;

    // Show/hide sub-elements based on tab
    var filterBar = document.getElementById("chat-filter-bar");
    var channelsPane = document.getElementById("chat-pane-channels");
    var chatContent = document.getElementById("chat-content");
    var chatEmpty = document.getElementById("chat-empty");
    var globalSearch = document.getElementById("gs-global-search");

    // Clear search state before switching tabs
    chatSearchQuery = "";
    chatGlobalSearchResults = null;
    chatGlobalSearchLoading = false;
    chatGlobalSearchError = false;
    if (chatGlobalSearchDebounce) { clearTimeout(chatGlobalSearchDebounce); chatGlobalSearchDebounce = null; }
    if (globalSearch) {
      globalSearch.value = "";
      var placeholders = { chat: "Search messages...", friends: "Search friends...", discover: "Search channels..." };
      globalSearch.placeholder = placeholders[chatMainTab] || "Search...";
    }
    var clrBtn = document.getElementById("gs-search-clear");
    if (clrBtn) { clrBtn.style.display = "none"; }

    var friendsContent = document.getElementById("friends-content");
    var discoverContent = document.getElementById("discover-content");

    if (chatMainTab === "discover") {
      if (filterBar) { filterBar.style.display = "none"; }
      if (channelsPane) { channelsPane.style.display = "none"; }
      if (chatContent) { chatContent.style.display = "none"; }
      if (chatEmpty) { chatEmpty.style.display = "none"; }
      if (friendsContent) { friendsContent.style.display = "none"; }
      if (discoverContent) { discoverContent.style.display = "flex"; }
      vscode.postMessage({ type: "fetchChannels" });
      renderDiscover();
    } else if (chatMainTab === "friends") {
      if (filterBar) { filterBar.style.display = "none"; }
      if (channelsPane) { channelsPane.style.display = "none"; }
      if (chatContent) { chatContent.style.display = "none"; }
      if (chatEmpty) { chatEmpty.style.display = "none"; }
      if (friendsContent) { friendsContent.style.display = "flex"; }
      if (discoverContent) { discoverContent.style.display = "none"; }
      chatSubTab = "friends";
      renderFriends();
    } else {
      // chat
      if (filterBar) { filterBar.style.display = "flex"; }
      if (channelsPane) { channelsPane.style.display = "none"; }
      if (chatContent) { chatContent.style.display = ""; }
      if (friendsContent) { friendsContent.style.display = "none"; }
      if (discoverContent) { discoverContent.style.display = "none"; }
      chatSubTab = "inbox";
      renderChat();
    }
    // Restore scroll position for new tab
    var newId = chatMainTab === "chat" ? "chat-content" : chatMainTab + "-content";
    var newContainer = document.getElementById(newId);
    if (newContainer) newContainer.scrollTop = tabScrollPositions[chatMainTab] || 0;

    persistState();
  });
});

// ===================== GLOBAL SEARCH =====================
var searchHeader = document.getElementById("explore-header");
var searchInput = document.getElementById("global-search");
var searchClear = document.getElementById("search-clear");
var searchIcon = document.querySelector(".search-wrapper .search-icon");
var searchHome = document.getElementById("search-home");
var searchResults = document.getElementById("search-results");
var recentSearches = [];

function hideTabs() {
  var mainTabs = document.getElementById("gs-main-tabs");
  if (mainTabs) { mainTabs.style.display = "none"; }
  var nav = document.getElementById("gs-nav");
  if (nav) { nav.style.display = "none"; }
}

function restoreTabs() {
  var mainTabs = document.getElementById("gs-main-tabs");
  if (mainTabs) { mainTabs.style.display = ""; }
  var nav = document.getElementById("gs-nav");
  if (nav) { nav.style.display = ""; }
  currentTab = previousActiveTab;
}

function showSearchBar() {
  if (!searchMode) { previousActiveTab = currentTab; }
  searchMode = true;
  searchHeader.style.display = "flex";
  hideTabs();
  // Show search home, hide results
  searchResults.style.display = "none";
  searchHome.style.display = "";
  renderSearchHome();
  searchInput.focus();
  vscode.postMessage({ type: "getRecentSearches" });
}

function hideSearchBar() {
  searchMode = false;
  searchInput.value = "";
  searchClear.style.display = "none";
  searchIcon.classList.remove("loading", "codicon-loading");
  searchIcon.classList.add("codicon-search");
  searchResults.style.display = "none";
  searchHome.style.display = "none";
  searchHeader.style.display = "none";
  restoreTabs();
}

function enterSearchResults() {
  searchHome.style.display = "none";
  searchResults.style.display = "flex";
}

function showSearchHome() {
  searchResults.style.display = "none";
  searchHome.style.display = "";
  renderSearchHome();
}

function doSearch(query) {
  if (query.length < 2) { return; }
  enterSearchResults();
  searchIcon.classList.remove("codicon-search");
  searchIcon.classList.add("codicon-loading", "loading");
  vscode.postMessage({ type: "globalSearch", payload: { query: query } });
}

function fillSearch(query) {
  searchInput.value = query;
  searchClear.style.display = "inline-flex";
  doSearch(query);
}

// ===================== SEARCH HOME RENDERING =====================
function renderSearchHome() {
  // Recent searches
  var recentSection = document.getElementById("search-home-recent");
  var recentList = document.getElementById("search-home-recent-list");
  if (recentSearches.length > 0) {
    recentSection.style.display = "";
    recentList.innerHTML = recentSearches.map(function(q) {
      return '<div class="search-home-item" data-query="' + escapeHtml(q) + '">'
        + '<span class="codicon codicon-history"></span>'
        + '<span class="search-home-item-text">' + escapeHtml(q) + '</span>'
        + '<button class="search-home-remove codicon codicon-close" data-query="' + escapeHtml(q) + '" title="Remove"></button>'
        + '</div>';
    }).join("");
  } else {
    recentSection.style.display = "none";
  }

  // Trending repos (top 5)
  var trendingReposSection = document.getElementById("search-home-trending-repos");
  var trendingReposList = document.getElementById("search-home-trending-repos-list");
  var topRepos = trendingRepos.slice(0, 5).filter(function(r) { return r.name || r.repo; });
  if (topRepos.length > 0) {
    trendingReposSection.style.display = "";
    trendingReposList.innerHTML = topRepos.map(function(r) {
      var name = escapeHtml((r.owner || "") + "/" + (r.name || r.repo || ""));
      return '<div class="search-home-item" data-query="' + escapeHtml(r.name || r.repo || "") + '">'
        + '<span class="codicon codicon-repo"></span>'
        + '<span class="search-home-item-text">' + name + '</span>'
        + '</div>';
    }).join("");
  } else {
    trendingReposSection.style.display = "none";
  }

  // Trending people (top 5)
  var trendingPeopleSection = document.getElementById("search-home-trending-people");
  var trendingPeopleList = document.getElementById("search-home-trending-people-list");
  var topPeople = trendingPeople.slice(0, 5).filter(function(p) { return p.login; });
  if (topPeople.length > 0) {
    trendingPeopleSection.style.display = "";
    trendingPeopleList.innerHTML = topPeople.map(function(p) {
      return '<div class="search-home-item" data-query="' + escapeHtml(p.login) + '">'
        + '<span class="codicon codicon-person"></span>'
        + '<span class="search-home-item-text">@' + escapeHtml(p.login) + '</span>'
        + '</div>';
    }).join("");
  } else {
    trendingPeopleSection.style.display = "none";
  }
}

// Search home click handlers
searchHome.addEventListener("click", function(e) {
  // Remove single recent search
  var removeBtn = e.target.closest(".search-home-remove");
  if (removeBtn) {
    e.stopPropagation();
    var q = removeBtn.dataset.query;
    recentSearches = recentSearches.filter(function(s) { return s !== q; });
    vscode.postMessage({ type: "saveRecentSearch", payload: { query: "" } }); // trigger re-save
    vscode.postMessage({ type: "clearRecentSearches" });
    // Re-save remaining
    recentSearches.slice().reverse().forEach(function(s) {
      vscode.postMessage({ type: "saveRecentSearch", payload: { query: s } });
    });
    renderSearchHome();
    return;
  }
  // Click on search item
  var item = e.target.closest(".search-home-item");
  if (item && item.dataset.query) {
    fillSearch(item.dataset.query);
  }
});

// Clear all recent
document.getElementById("search-clear-recent").addEventListener("click", function() {
  recentSearches = [];
  vscode.postMessage({ type: "clearRecentSearches" });
  renderSearchHome();
});

searchInput.addEventListener("input", function() {
  var val = searchInput.value.trim();
  searchClear.style.display = val ? "inline-flex" : "none";
  clearTimeout(searchDebounceTimer);
  if (!val) {
    // Back to search home
    showSearchHome();
    return;
  }
  if (val.length >= 2) {
    searchDebounceTimer = setTimeout(function() { doSearch(val); }, 300);
  }
});

searchInput.addEventListener("keydown", function(e) {
  if (e.key === "Enter") {
    var val = searchInput.value.trim();
    if (val.length >= 2) {
      clearTimeout(searchDebounceTimer);
      doSearch(val);
      vscode.postMessage({ type: "saveRecentSearch", payload: { query: val } });
    }
  }
  if (e.key === "Escape") {
    hideSearchBar();
    searchInput.blur();
  }
});

searchClear.addEventListener("click", function() {
  hideSearchBar();
});

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
      var repoAvatar = r.avatar_url || avatarUrl(r.owner);
      return '<div class="search-repo-item" data-owner="' + escapeHtml(r.owner || "") + '" data-repo="' + escapeHtml(r.name || r.repo || "") + '">'
        + '<img class="search-repo-avatar" src="' + escapeHtml(repoAvatar) + '" alt="">'
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

// ===================== CHAT TAB LOGIC =====================
(function initChat() {
  // Global search input — filters based on active tab
  var globalSearchEl = document.getElementById("gs-global-search");
  var searchClearBtn = document.getElementById("gs-search-clear");
  if (globalSearchEl) {
    globalSearchEl.addEventListener("input", function(e) {
      chatSearchQuery = e.target.value.toLowerCase();
      if (searchClearBtn) { searchClearBtn.style.display = chatSearchQuery ? "inline-flex" : "none"; }

      // Reset previous global message search state on query change
      chatGlobalSearchResults = null;
      chatGlobalSearchError = false;
      chatGlobalSearchNextCursor = null;
      if (chatGlobalSearchDebounce) { clearTimeout(chatGlobalSearchDebounce); chatGlobalSearchDebounce = null; }

      if (chatMainTab === "discover") {
        chatGlobalSearchLoading = false;
        renderDiscover();
        return;
      }

      if (chatMainTab === "friends") {
        chatGlobalSearchLoading = false;
        renderFriends();
        return;
      }

      // Kick off debounced global message search
      if (chatSearchQuery && chatSearchQuery.trim().length >= 1) {
        chatGlobalSearchLoading = true;
        chatGlobalSearchDebounce = setTimeout(function() {
          vscode.postMessage({ type: "searchInboxMessages", payload: { query: chatSearchQuery } });
          chatGlobalSearchDebounce = null;
        }, 300);
      } else {
        chatGlobalSearchLoading = false;
      }

      renderChat();
    });
  }
  if (searchClearBtn) {
    searchClearBtn.addEventListener("click", function() {
      globalSearchEl.value = "";
      chatSearchQuery = "";
      searchClearBtn.style.display = "none";
      chatGlobalSearchResults = null;
      chatGlobalSearchLoading = false;
      chatGlobalSearchError = false;
      chatGlobalSearchNextCursor = null;
      if (chatGlobalSearchDebounce) { clearTimeout(chatGlobalSearchDebounce); chatGlobalSearchDebounce = null; }
      if (chatMainTab === "discover") { renderDiscover(); }
      else if (chatMainTab === "friends") { renderFriends(); }
      else { renderChat(); }
      globalSearchEl.focus();
    });
  }

  // Inbox filter buttons
  document.querySelectorAll("#chat-filter-bar .gs-chip").forEach(function(btn) {
    btn.addEventListener("click", function() {
      document.querySelectorAll("#chat-filter-bar .gs-chip").forEach(function(b) {
        b.classList.remove("active");
        b.setAttribute("aria-checked", "false");
      });
      btn.classList.add("active");
      btn.setAttribute("aria-checked", "true");
      chatFilter = btn.dataset.filter;
      renderChat();
    });
    btn.addEventListener("keydown", function(e) {
      var chips = Array.from(document.querySelectorAll("#chat-filter-bar .gs-chip"));
      var idx = chips.indexOf(btn);
      var next = -1;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") { next = (idx + 1) % chips.length; }
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { next = (idx - 1 + chips.length) % chips.length; }
      if (next >= 0) { e.preventDefault(); chips[next].click(); chips[next].focus(); }
    });
  });

  // Close context menu on any click
  document.addEventListener("click", function() {
    if (chatContextMenuEl) { chatContextMenuEl.remove(); chatContextMenuEl = null; }
  });

  // Show filter bar by default
  var filterBar = document.getElementById("chat-filter-bar");
  if (filterBar) { filterBar.style.display = "flex"; }
})();

function renderChat() {
  updateChatTabCounts();
  if (chatSubTab === "friends") { renderChatFriends(); }
  else { renderChatInbox(); }
}

function updateSidebarBackBadge() {
  if (typeof SidebarChat === "undefined" || !SidebarChat.updateBackBadge) return;
  var currentConvId = SidebarChat.getConversationId && SidebarChat.getConversationId();
  var totalUnread = chatConversations.reduce(function(sum, c) {
    if (c.id === currentConvId) return sum;
    return sum + ((c.unread_count > 0 || c.is_unread) ? (c.unread_count || 1) : 0);
  }, 0);
  SidebarChat.updateBackBadge(totalUnread);
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
    el.addEventListener("click", function() {
      // Use messageUser command which creates/finds DM then navigates to sidebar chat
      doAction("openChat", { login: el.dataset.login });
    });
  });
  container.querySelectorAll(".friend-profile-btn").forEach(function(btn) {
    btn.addEventListener("click", function(e) { e.stopPropagation(); doAction("viewProfile", { login: btn.dataset.login }); });
  });
  // Bind avatar to ProfileCard; row click still opens DM
  if (window.ProfileCard) {
    container.querySelectorAll(".friend-item[data-login]").forEach(function(el) {
      var avatar = el.querySelector(".gs-avatar");
      if (avatar) {
        window.ProfileCard.bindTrigger(avatar, el.getAttribute("data-login"));
      }
    });
  }
}

function renderChatFriend(f) {
  var avatar = f.avatar_url || avatarUrl(f.login);
  var isTyping = !!chatTypingUsers[f.login];
  var dot = f.online ? '<span class="gs-dot-online"></span>' : '<span class="gs-dot-offline"></span>';
  var status = isTyping ? '<span class="typing-status">typing...</span>' : (f.online ? "online" : (f.lastSeen > 0 ? timeAgo(new Date(f.lastSeen).toISOString()) + " ago" : ""));
  var unreadBadge = f.unread > 0 ? '<span class="gs-badge">' + f.unread + '</span>' : '';
  return '<div class="gs-row-item friend-item" data-login="' + escapeHtml(f.login) + '">' +
    '<img src="' + escapeHtml(avatar) + '" class="gs-avatar gs-avatar-md" alt="">' +
    '<div class="gs-flex-1" style="min-width:0">' +
      '<div class="gs-flex gs-items-center gs-gap-4">' + dot + '<span class="gs-truncate" style="font-weight:500">' + escapeHtml(f.name) + '</span>' + unreadBadge + '</div>' +
      '<div class="gs-text-xs gs-text-muted">' + escapeHtml(status) + '</div>' +
    '</div>' +
  '</div>';
}

// ===================== FRIENDS TAB — ACCORDION =====================

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

  // Apply search filter if active
  if (chatSearchQuery) {
    var q = chatSearchQuery.toLowerCase();
    online = online.filter(function(f) { return (f.login || "").toLowerCase().indexOf(q) !== -1 || (f.name || "").toLowerCase().indexOf(q) !== -1; });
    offline = offline.filter(function(f) { return (f.login || "").toLowerCase().indexOf(q) !== -1 || (f.name || "").toLowerCase().indexOf(q) !== -1; });
  }

  // Search empty state
  if (chatSearchQuery && online.length === 0 && offline.length === 0) {
    container.innerHTML = '<div class="gs-empty">No results for "' + escapeHtml(chatSearchQuery) + '"</div>';
    return;
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

  // Not on GitChat (placeholder)
  html += buildAccordionSection("friends", "notongitchat", "NOT ON GITCHAT", 0, state.notongitchat === true, "notongitchat",
    '<div class="gs-empty gs-text-sm">Coming soon</div>'
  );

  container.innerHTML = html;
  bindAccordionHandlers("friends");
  bindFriendRowHandlers(container);
}

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

function buildFriendRow(friend, section) {
  var avatarClass = section === "offline" ? " friend-avatar--offline" : "";
  var dotHtml = section === "online" ? '<span class="gs-dot-online"></span>' : '';
  var lastSeen = section === "offline" && friend.lastSeen
    ? ' <span class="friend-lastseen">\u00B7 ' + timeAgo(friend.lastSeen) + '</span>'
    : '';
  var btnHtml = '<button class="gs-btn gs-btn-ghost friend-dm-btn" data-login="' + escapeHtml(friend.login || "") + '" title="Send message">DM</button>';

  return '<div class="friend-row gs-row-item" data-login="' + escapeHtml(friend.login || "") + '">' +
    '<div class="conv-avatar-wrap">' +
    '<img class="gs-avatar gs-avatar-md' + avatarClass + '" src="' + avatarUrl(friend.avatar_url || friend.avatarUrl, 36) + '" />' +
    dotHtml +
    '</div>' +
    '<span class="gs-flex-1 gs-truncate">' + escapeHtml(friend.name || friend.login || "") + lastSeen + '</span>' +
    btnHtml +
    '</div>';
}

// ===================== ACCORDION STATE HELPERS =====================

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
  var isCollapsed = header.classList.contains("collapsed");
  var nowExpanded = isCollapsed;
  header.classList.toggle("collapsed");
  if (body) body.classList.toggle("collapsed");
  header.setAttribute("aria-expanded", String(nowExpanded));
  setAccordionState(tab, key, nowExpanded);
}

function bindFriendRowHandlers(container) {
  // Row click → profile
  container.querySelectorAll(".friend-row").forEach(function(row) {
    row.addEventListener("click", function() {
      vscode.postMessage({ type: "viewProfile", payload: { login: row.dataset.login } });
    });
    // Profile card hover on avatar
    var avatar = row.querySelector(".gs-avatar");
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

// ===================== DISCOVER TAB RENDERING =====================

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
    people = people.filter(function(f) { return (f.login || "").toLowerCase().indexOf(q) !== -1 || (f.name || "").toLowerCase().indexOf(q) !== -1; });
    communities = communities.filter(function(c) { return (c.name || c.repo_full_name || "").toLowerCase().indexOf(q) !== -1; });
    onlineNow = onlineNow.filter(function(f) { return (f.login || "").toLowerCase().indexOf(q) !== -1 || (f.name || "").toLowerCase().indexOf(q) !== -1; });
  }

  // Search empty state
  if (chatSearchQuery && people.length === 0 && communities.length === 0 && onlineNow.length === 0) {
    container.innerHTML = '<div class="gs-empty">No results for "' + escapeHtml(chatSearchQuery) + '"</div>';
    return;
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

function buildDiscoverPersonRow(friend) {
  return '<div class="friend-row gs-row-item" data-login="' + escapeHtml(friend.login || "") + '">' +
    '<img class="gs-avatar gs-avatar-md" src="' + avatarUrl(friend.avatar_url || friend.avatarUrl, 36) + '" />' +
    '<span class="gs-flex-1 gs-truncate">' + escapeHtml(friend.name || friend.login || "") + '</span>' +
    '<button class="gs-btn gs-btn-ghost friend-dm-btn" data-login="' + escapeHtml(friend.login || "") + '">DM</button>' +
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
  return '<div class="friend-row gs-row-item" data-login="' + escapeHtml(friend.login || "") + '">' +
    '<div class="conv-avatar-wrap">' +
    '<img class="gs-avatar gs-avatar-md" src="' + avatarUrl(friend.avatar_url || friend.avatarUrl, 36) + '" />' +
    '<span class="gs-dot-online"></span>' +
    '</div>' +
    '<span class="gs-flex-1 gs-truncate">' + escapeHtml(friend.name || friend.login || "") + '</span>' +
    '<button class="gs-btn gs-btn-ghost" disabled title="Coming soon">Wave</button>' +
    '</div>';
}

function bindDiscoverRowHandlers(container) {
  // People rows → profile
  container.querySelectorAll(".friend-row:not(.discover-community-row)").forEach(function(row) {
    if (!row.dataset.login) return;
    row.addEventListener("click", function() {
      vscode.postMessage({ type: "viewProfile", payload: { login: row.dataset.login } });
    });
    var avatar = row.querySelector(".gs-avatar");
    if (avatar && typeof window.ProfileCard !== "undefined" && window.ProfileCard.bindTrigger) {
      window.ProfileCard.bindTrigger(avatar, row.dataset.login);
    }
  });
  // Community rows → join (WP5 handler)
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

function renderChatInbox() {
  if (!chatDataLoaded) {
    var chatContent = document.getElementById("chat-content");
    if (chatContent) chatContent.innerHTML = renderSkeletonRows(4);
    return;
  }
  var container = document.getElementById("chat-content");
  var empty = document.getElementById("chat-empty");

  function isGroupConv(c) {
    return c.type === "group" || c.is_group === true || (c.participants && c.participants.length > 2);
  }

  updateChatFilterCounts();

  var filtered = chatConversations;
  if (chatFilter === "dm") { filtered = filtered.filter(function(c) { return c.type === "direct" || (!c.type && !c.is_group); }); }
  else if (chatFilter === "group") { filtered = filtered.filter(function(c) { return c.type === "group" || (!c.type && c.is_group); }); }
  else if (chatFilter === "community") { filtered = filtered.filter(function(c) { return c.type === "community"; }); }
  else if (chatFilter === "team") { filtered = filtered.filter(function(c) { return c.type === "team"; }); }

  // ── Search mode: 2 sections (Chats + Messages) ──
  if (chatSearchQuery) {
    var chatMatches = filtered.filter(function(c) {
      var name = (c.name || "").toLowerCase();
      var groupName = (c.group_name || "").toLowerCase();
      var otherName = c.other_user ? (c.other_user.name || c.other_user.login || "").toLowerCase() : "";
      var otherLogin = c.other_user ? (c.other_user.login || "").toLowerCase() : "";
      return name.includes(chatSearchQuery) || groupName.includes(chatSearchQuery) ||
        otherName.includes(chatSearchQuery) || otherLogin.includes(chatSearchQuery);
    });

    // MESSAGES section comes from backend global search API (chatGlobalSearchResults)
    var messageMatches = Array.isArray(chatGlobalSearchResults) ? chatGlobalSearchResults : [];

    // Post-filter search results by active chip type
    if (chatFilter !== "all" && messageMatches.length > 0) {
      var typeMap = { dm: "direct", group: "group", community: "community", team: "team" };
      var filterType = typeMap[chatFilter];
      if (filterType) {
        messageMatches = messageMatches.filter(function(msg) {
          return msg.conversationType === filterType || msg.conversation_type === filterType;
        });
      }
    }

    // Empty check — only if not still loading/erroring
    if (!chatMatches.length && !messageMatches.length && !chatGlobalSearchLoading && !chatGlobalSearchError) {
      container.innerHTML = "";
      empty.style.display = "block";
      empty.textContent = "No matches";
      return;
    }
    empty.style.display = "none";

    var html = "";

    // Section 1: Chats & Contacts
    if (chatMatches.length) {
      html += '<div class="gs-section-title">CHATS</div>';
      html += chatMatches.map(function(c) {
        // Compact row: avatar + name only (no preview)
        var cIsGroup = isGroupConv(c);
        var cName, cAvatar;
        if (cIsGroup) {
          cName = c.group_name || "Group Chat";
          cAvatar = c.group_avatar_url || "";
          if (!cAvatar && c.participants && c.participants.length > 0) {
            cAvatar = c.participants[0].avatar_url || avatarUrl(c.participants[0].login || "");
          }
        } else {
          cName = c.other_user ? (c.other_user.name || c.other_user.login) : "";
          cAvatar = c.other_user ? (c.other_user.avatar_url || avatarUrl(c.other_user.login || "")) : "";
        }
        // Type icon per conversation type
        var typeIcon = "";
        if (c.type === "group") { typeIcon = '<span class="conv-type-icon codicon codicon-organization"></span>'; }
        else if (c.type === "community") { typeIcon = '<span class="conv-type-icon codicon codicon-star"></span>'; }
        else if (c.type === "team") { typeIcon = '<span class="conv-type-icon codicon codicon-git-pull-request"></span>'; }
        // Avatar HTML
        var cAvatarHtml;
        if (cIsGroup) {
          cAvatarHtml = '<img src="' + escapeHtml(cAvatar) + '" class="gs-avatar gs-avatar-md conv-avatar--square" alt="">';
        } else {
          var cOnline = getDMOnlineStatus(c);
          var cDot = "";
          if (cOnline === "online") { cDot = '<span class="gs-dot-online"></span>'; }
          else if (cOnline === "offline") { cDot = '<span class="gs-dot-offline"></span>'; }
          cAvatarHtml = '<div class="conv-avatar-wrap">' +
            '<img src="' + escapeHtml(cAvatar) + '" class="gs-avatar gs-avatar-md" alt="">' +
            cDot +
          '</div>';
        }
        return '<div class="gs-row-item conv-item" data-id="' + c.id + '">' +
          cAvatarHtml +
          '<div class="gs-flex-1" style="min-width:0">' +
            '<span class="conv-name gs-truncate" style="font-weight:500">' + typeIcon + escapeHtml(cName) + '</span>' +
          '</div>' +
        '</div>';
      }).join("");
    }

    // Section 2: Messages (from backend /messages/search)
    html += '<div class="gs-section-title">MESSAGES</div>';
    if (chatGlobalSearchLoading) {
      html += '<div class="gs-text-sm gs-text-muted" style="padding:8px var(--gs-inset-x)">Searching...</div>';
    } else if (chatGlobalSearchError) {
      html += '<div class="gs-empty"><span class="codicon codicon-warning"></span>' +
        '<p>Search failed</p>' +
        '<button class="gs-btn gs-btn-secondary search-retry-btn">Retry</button></div>';
    } else if (messageMatches.length) {
      html += messageMatches.map(renderGlobalSearchMessageRow).join("");
      if (chatGlobalSearchNextCursor) {
        html += '<div class="gs-text-muted gs-text-xs" style="padding:8px var(--gs-inset-x); text-align:center">Showing top ' + messageMatches.length + ' matches</div>';
      }
    } else {
      html += '<div class="gs-text-muted gs-text-xs" style="padding:8px var(--gs-inset-x)">No message matches</div>';
    }

    container.innerHTML = html;
    container.querySelectorAll(".conv-item").forEach(function(el) {
      el.addEventListener("click", function() {
        var convId = el.dataset.id;
        var convData = chatConversations.find(function(c) { return c.id === convId; });
        pushChatView(convId, convData);
      });
    });
    container.querySelectorAll(".msg-match-item").forEach(function(el) {
      el.addEventListener("click", function() {
        var convId = el.dataset.convId;
        var convData = chatConversations.find(function(c) { return c.id === convId; });
        pushChatView(convId, convData);
      });
    });
    return;
  }

  // ── Normal mode (no search) ──
  if (!filtered.length) {
    container.innerHTML = "";
    empty.style.display = "block";
    var filterLabels = { all: "", dm: "DM", group: "group", community: "community", team: "team" };
    empty.textContent = chatFilter === "all" ? "No conversations yet" : "No " + (filterLabels[chatFilter] || chatFilter) + " conversations";
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
    el.addEventListener("click", function() {
      var convId = el.dataset.id;
      var convData = chatConversations.find(function(c) { return c.id === convId; });
      pushChatView(convId, convData);
    });
    el.addEventListener("contextmenu", function(e) {
      e.preventDefault();
      showChatContextMenu(e, el.dataset.id, el.dataset.pinned === "true");
    });
  });
  // Bind avatar clicks to ProfileCard (stopPropagation inside bindTrigger prevents opening conversation)
  if (window.ProfileCard) {
    container.querySelectorAll(".conv-item[data-other-login]").forEach(function(el) {
      var avatar = el.querySelector(".gs-avatar");
      if (avatar) {
        window.ProfileCard.bindTrigger(avatar, el.getAttribute("data-other-login"));
      }
    });
  }
}

function updateChatFilterCounts() {
  var all = chatConversations.length;
  var dm = chatConversations.filter(function(c) { return c.type === "direct" || (!c.type && !c.is_group); }).length;
  var group = chatConversations.filter(function(c) { return c.type === "group" || (!c.type && c.is_group); }).length;
  var community = chatConversations.filter(function(c) { return c.type === "community"; }).length;
  var team = chatConversations.filter(function(c) { return c.type === "team"; }).length;
  var el;
  el = document.getElementById("chat-count-all"); if (el) el.textContent = all ? "(" + all + ")" : "";
  el = document.getElementById("chat-count-dm"); if (el) el.textContent = dm ? "(" + dm + ")" : "";
  el = document.getElementById("chat-count-group"); if (el) el.textContent = group ? "(" + group + ")" : "";
  el = document.getElementById("chat-count-community"); if (el) el.textContent = community ? "(" + community + ")" : "";
  el = document.getElementById("chat-count-team"); if (el) el.textContent = team ? "(" + team + ")" : "";
}

function setChatCount(id, count) {
  var el = document.getElementById(id);
  if (el) { el.textContent = count > 0 ? "(" + count + ")" : ""; }
}

// Render one row for a message returned by backend global search (/messages/search).
// Each match is its own row (Telegram-style), not grouped by conversation.
function renderGlobalSearchMessageRow(m) {
  var senderLogin = m.sender_login || "";
  var avatar = m.sender_avatar_url || avatarUrl(senderLogin);
  var name = m.sender_name || senderLogin || "";
  var body = (m.body || "").trim();

  // Highlight matching substring in the body
  var q = chatSearchQuery || "";
  var bodyHtml = escapeHtml(body);
  if (q) {
    var re = new RegExp("(" + q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "ig");
    bodyHtml = escapeHtml(body).replace(re, "<mark>$1</mark>");
  }

  var when = m.created_at ? timeAgo(m.created_at) : "";

  // Parent conversation context ("in <group>" or "in <user>") — from cached list if available
  var parentConv = chatConversations.find(function(c) { return c.id === m.conversation_id; });
  var parentLabel = "";
  if (parentConv) {
    if (parentConv.type === "group" || parentConv.is_group) {
      parentLabel = parentConv.group_name || "Group";
    } else if (parentConv.other_user) {
      parentLabel = parentConv.other_user.name || parentConv.other_user.login || "";
    }
  }

  return '<div class="gs-row-item msg-match-item" data-conv-id="' + escapeHtml(m.conversation_id || "") + '" data-msg-id="' + escapeHtml(m.id || "") + '">' +
    '<img src="' + escapeHtml(avatar) + '" class="gs-avatar gs-avatar-md" alt="">' +
    '<div class="gs-flex-1" style="min-width:0">' +
      '<div class="gs-flex gs-items-center gs-gap-4">' +
        '<span class="gs-truncate" style="font-weight:500">' + escapeHtml(name) + '</span>' +
        (parentLabel ? '<span class="gs-text-xs gs-text-muted gs-truncate">in ' + escapeHtml(parentLabel) + '</span>' : '') +
        '<span class="gs-text-xs gs-text-muted" style="margin-left:auto">' + escapeHtml(when) + '</span>' +
      '</div>' +
      '<div class="gs-text-xs gs-truncate" style="margin-top:2px">' + bodyHtml + '</div>' +
    '</div>' +
  '</div>';
}

function getDMOnlineStatus(conv) {
  if (conv.type === "group" || conv.type === "community" || conv.type === "team" || conv.is_group) return null;
  var otherUser = conv.participants && conv.participants.find(function(p) {
    return p.login !== chatCurrentUser;
  });
  if (!otherUser) return null;
  var friend = chatFriends.find(function(f) { return f.login === otherUser.login; });
  return friend ? (friend.online ? "online" : "offline") : null;
}

function renderChatConversation(c) {
  var isGroup = c.type === "group" || c.type === "community" || c.type === "team" || c.is_group === true || (c.participants && c.participants.length > 2);
  var name, avatar, subtitle, other;
  if (isGroup) {
    name = c.group_name || "Group Chat";
    avatar = c.group_avatar_url || "";
    var memberCount = (c.participants && c.participants.length) || 0;
    subtitle = memberCount + " members";
  } else {
    other = c.other_user;
    if (!other) { return ""; }
    name = other.name || other.login;
    avatar = other.avatar_url || avatarUrl(other.login || "");
    subtitle = "";
  }
  var preview = c.last_message_preview || c.last_message_text || (c.last_message && (c.last_message.body || c.last_message.content)) || "";
  var draft = chatDrafts[c.id] || "";
  var time = timeAgo(c.updated_at || c.last_message_at);
  var unread = (c.unread_count > 0 || c.is_unread);
  var pin = c.pinned || c.pinned_at ? '<span class="codicon codicon-pin"></span> ' : "";

  // Type icon prefix — per conversation type
  var typeIcon = "";
  if (c.type === "group") {
    typeIcon = '<span class="conv-type-icon codicon codicon-organization"></span>';
  } else if (c.type === "community") {
    typeIcon = '<span class="conv-type-icon codicon codicon-star"></span>';
  } else if (c.type === "team") {
    typeIcon = '<span class="conv-type-icon codicon codicon-git-pull-request"></span>';
  }

  if (isGroup && !avatar && c.participants && c.participants.length > 0) {
    avatar = c.participants[0].avatar_url || avatarUrl(c.participants[0].login || "");
  }
  var unreadBadge = unread ? '<span class="gs-badge">' + (c.unread_count || '') + '</span>' : '';
  var mutedIcon = c.is_muted ? '<span class="gs-text-xs" title="Muted"><span class="codicon codicon-bell-slash"></span></span>' : '';
  var previewHtml = draft
    ? '<div class="conv-preview gs-text-sm gs-truncate"><span class="draft-label">Draft:</span> ' + escapeHtml(draft.slice(0, 60)) + '</div>'
    : '<div class="conv-preview gs-text-sm gs-text-muted gs-truncate">' + escapeHtml(preview.slice(0, 80)) + '</div>';

  // Avatar HTML — DM gets online dot wrapper, group/community/team gets square shape
  var avatarHtml;
  if (isGroup) {
    avatarHtml = '<img src="' + escapeHtml(avatar) + '" class="gs-avatar gs-avatar-md conv-avatar--square" alt="">';
  } else {
    var onlineStatus = getDMOnlineStatus(c);
    var dotHtml = "";
    if (onlineStatus === "online") {
      dotHtml = '<span class="gs-dot-online"></span>';
    } else if (onlineStatus === "offline") {
      dotHtml = '<span class="gs-dot-offline"></span>';
    }
    avatarHtml = '<div class="conv-avatar-wrap">' +
      '<img src="' + escapeHtml(avatar) + '" class="gs-avatar gs-avatar-md" alt="">' +
      dotHtml +
    '</div>';
  }

  return '<div class="gs-row-item conv-item' + (unread ? ' conv-unread' : '') + (c.is_muted ? ' conv-muted' : '') + '" data-id="' + c.id + '" data-pinned="' + (c.pinned || c.pinned_at || false) + '"' + (!isGroup && other ? ' data-other-login="' + escapeHtml(other.login || '') + '"' : '') + '>' +
    avatarHtml +
    '<div class="gs-flex-1" style="min-width:0">' +
      '<div class="gs-flex gs-items-center gs-gap-4">' +
        '<span class="conv-name gs-truncate">' + typeIcon + escapeHtml(name) + '</span>' +
        mutedIcon +
        '<span class="gs-text-xs gs-text-muted gs-ml-auto gs-flex-shrink-0">' + pin + time + '</span>' +
        unreadBadge +
      '</div>' +
      (subtitle ? '<div class="gs-text-xs gs-text-muted">' + escapeHtml(subtitle) + '</div>' : '') +
      previewHtml +
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
  document.body.appendChild(menu);
  var menuW = menu.offsetWidth || 140;
  var menuH = menu.offsetHeight || 80;
  var maxX = document.documentElement.clientWidth - menuW - 4;
  var maxY = document.documentElement.clientHeight - menuH - 4;
  menu.style.left = Math.min(e.clientX, maxX) + "px";
  menu.style.top = Math.min(e.clientY, maxY) + "px";
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


// ===================== MESSAGE HANDLER =====================
window.addEventListener("message", function(e) {
  var data = e.data;

  // Route chat: messages to SidebarChat
  if (data.type && data.type.indexOf("chat:") === 0) {
    if (typeof SidebarChat !== "undefined" && SidebarChat.isOpen && SidebarChat.isOpen()) {
      SidebarChat.handleMessage(data);
    }
    if (data.type === "chat:navigate") {
      pushChatView(data.conversationId);
    }
    return;
  }

  // Handle showNewChatMenu from title bar button — show dropdown in webview
  if (data.type === "showNewChatMenu") {
    // Ignore if new chat panel is already open
    if (document.querySelector('.gs-sc-newchat-overlay')) return;
    var menu = document.getElementById("new-chat-menu");
    if (menu) {
      menu.style.display = menu.style.display === "none" ? "" : "none";
      if (menu.style.display !== "none") {
        // Close on click outside
        setTimeout(function () {
          document.addEventListener("click", function closeMenu(e) {
            if (!menu.contains(e.target)) { menu.style.display = "none"; }
            document.removeEventListener("click", closeMenu);
          });
        }, 0);
      }
    }
    return;
  }

  switch (data.type) {
    // Chat messages
    case "setChatData":
      chatDataLoaded = true;
      chatFriends = data.friends || [];
      chatConversations = data.conversations || [];
      chatCurrentUser = data.currentUser;
      if (data.drafts) { chatDrafts = data.drafts; }
      if (chatMainTab === "friends") { renderFriends(); }
      else if (chatMainTab === "discover") { renderDiscover(); }
      else { renderChat(); }
      updateSidebarBackBadge();
      break;
    case "updateDrafts":
      chatDrafts = data.drafts || {};
      if (chatSubTab === "inbox") { renderChatInbox(); }
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
    case "inboxMessageSearchResults":
      // Only apply if query still matches (user may have typed more since request)
      if (typeof data.query === "string" && data.query.toLowerCase() === chatSearchQuery) {
        chatGlobalSearchResults = data.messages || [];
        chatGlobalSearchNextCursor = data.nextCursor || null;
        chatGlobalSearchLoading = false;
        chatGlobalSearchError = false;
        if (chatSubTab === "inbox") { renderChatInbox(); }
      }
      break;
    case "inboxMessageSearchError":
      if (typeof data.query === "string" && data.query.toLowerCase() === chatSearchQuery) {
        chatGlobalSearchResults = [];
        chatGlobalSearchNextCursor = null;
        chatGlobalSearchLoading = false;
        chatGlobalSearchError = true;
        if (chatSubTab === "inbox") { renderChatInbox(); }
      }
      break;
    case "settings":
      document.getElementById("chat-setting-notifications").checked = data.showMessageNotifications !== false;
      document.getElementById("chat-setting-sound").checked = data.messageSound === true;
      if (data.devMode) {
        var debugRow = document.getElementById("chat-setting-debug-row");
        if (debugRow) { debugRow.style.display = ""; }
        var debugCheck = document.getElementById("chat-setting-debug");
        if (debugCheck) {
          debugCheck.checked = data.debugLogs === true;
          debugCheck.addEventListener("change", function() { doAction("updateSetting", { key: "debug", value: this.checked }); });
        }
      }
      break;

    // Search messages
    case "globalSearchResults":
      console.log("[Search] got results:", JSON.stringify(data));
      var payload = data.payload || {};
      renderSearchResults(payload.repos || [], payload.users || []);
      break;
    case "globalSearchError":
      console.log("[Search] got error");
      renderSearchError();
      break;
    case "recentSearches":
      recentSearches = data.searches || [];
      renderSearchHome();
      break;
    case "setUser":
      if (userMenuEl) {
        userMenuEl.dataset.login = data.login || "";
        var avatarEl = document.getElementById("user-menu-avatar");
        var nameEl = document.getElementById("user-menu-name");
        var loginEl = document.getElementById("user-menu-login");
        if (avatarEl) { avatarEl.src = data.avatar || ""; }
        if (nameEl) { nameEl.textContent = data.name || data.login || ""; }
        if (loginEl) { loginEl.textContent = "@" + (data.login || ""); }
      }
      break;
    case "toggleUserMenu":
      toggleUserMenu();
      break;
    case "toggleSearch":
      if (searchHeader.style.display === "none" || searchHeader.style.display === "") {
        showSearchBar();
      } else {
        hideSearchBar();
      }
      break;
    case "showSearch":
      showSearchBar();
      break;

    // Develop: Repos tab
    case "setRepos":
      devTrendingReposCache = data.repos || [];
      devRenderRepos(data.repos);
      break;
    case "starredUpdate":
      var starBtn = document.querySelector('.tr-star-btn[data-slug="' + (data.slug || '') + '"]');
      if (starBtn) {
        starBtn.dataset.starred = data.starred ? "1" : "0";
        starBtn.classList.toggle("tr-btn-starred", data.starred);
        starBtn.innerHTML = '<span class="codicon codicon-star' + (data.starred ? '-full' : '-empty') + '"></span>';
      }
      break;
    case "setLoading":
      var rl = document.getElementById("repos-list");
      if (rl) { rl.innerHTML = '<div class="ex-loading">Searching\u2026</div>'; }
      break;
    case "error":
      var el2 = document.getElementById("repos-list");
      if (el2) { el2.innerHTML = '<div class="ex-loading" style="color:var(--gs-error)">' + escapeHtml(data.message) + '</div>'; }
      break;

    // Develop: People tab
    case "setPeople":
      devTrendingPeopleCache = data.people || [];
      devRenderPeople(data.people);
      break;
    case "followUpdate":
      var devFBtn = document.querySelector('.tp-follow-btn[data-login="' + (data.login || '') + '"]');
      if (devFBtn) {
        devFBtn.dataset.following = data.following ? "1" : "0";
        devFBtn.classList.toggle("tp-btn-following", data.following);
        devFBtn.textContent = data.following ? '\u2713 Following' : '+ Follow';
      }
      break;

    // Develop: My Repos tab
    case "setMyReposDev":
      devRenderMyRepos(data.data);
      break;

    // Develop: Channels
    case "setChannelData":
      devChannelsList = data.channels || [];
      chatChannels = data.channels || [];
      if (chatMainTab === "discover") renderDiscover();
      else devRenderChannels();
      break;

    // Develop: Chat data (with drafts)
    case "setChatDataDev":
      devChatFriends = data.friends || [];
      devChatConversations = data.conversations || [];
      devChatCurrentUser = data.currentUser;
      devChatDrafts = data.drafts || {};
      devRenderChat();
      break;
  }
});

// ===================== DEV: CHAT TAB =====================
function devChatTimeAgo(dateStr) {
  if (!dateStr) return '';
  var diff = Date.now() - new Date(dateStr).getTime();
  var mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return mins + 'm';
  var hours = Math.floor(mins / 60);
  if (hours < 24) return hours + 'h';
  var days = Math.floor(hours / 24);
  if (days < 30) return days + 'd';
  return new Date(dateStr).toLocaleDateString();
}
function devChatAvatarUrl(login) {
  return 'https://github.com/' + encodeURIComponent(login) + '.png?size=72';
}

// Dev chat sub-tab switching
document.querySelectorAll('.dev-chat-tab').forEach(function (tab) {
  tab.addEventListener('click', function () {
    document.querySelectorAll('.dev-chat-tab').forEach(function (t) { t.classList.remove('dev-chat-tab-active'); });
    tab.classList.add('dev-chat-tab-active');
    devChatActiveTab = tab.dataset.devChatTab;
    document.getElementById('dev-chat-search-bar').style.display = devChatActiveTab === 'friends' ? 'block' : 'none';
    document.getElementById('dev-chat-filter-bar').style.display = devChatActiveTab === 'inbox' ? 'flex' : 'none';
    var channelsPane = document.getElementById('dev-chat-pane-channels');
    var chatContent = document.getElementById('dev-chat-content');
    var chatEmpty = document.getElementById('dev-chat-empty');
    if (devChatActiveTab === 'channels') {
      if (channelsPane) { channelsPane.style.display = ''; }
      if (chatContent) { chatContent.style.display = 'none'; }
      if (chatEmpty) { chatEmpty.style.display = 'none'; }
      if (devChannelsList.length === 0) { vscode.postMessage({ type: 'fetchChannels' }); }
      devRenderChannels();
    } else {
      if (channelsPane) { channelsPane.style.display = 'none'; }
      if (chatContent) { chatContent.style.display = ''; }
      devRenderChat();
    }
  });
});

// Dev chat filter buttons
document.querySelectorAll('.dev-chat-filter-btn').forEach(function (btn) {
  btn.addEventListener('click', function () {
    document.querySelectorAll('.dev-chat-filter-btn').forEach(function (b) { b.classList.remove('dev-chat-filter-active'); });
    btn.classList.add('dev-chat-filter-active');
    devChatFilter = btn.dataset.filter;
    devRenderChat();
  });
});

// Dev new chat button
var devChatNewBtn = document.getElementById('dev-chat-new-btn');
if (devChatNewBtn) {
  devChatNewBtn.addEventListener('click', function () {
    vscode.postMessage({ type: 'chatNewChat' });
  });
}

// Dev chat search
var devChatSearchInput = document.getElementById('dev-chat-search');
if (devChatSearchInput) {
  devChatSearchInput.addEventListener('input', function () {
    devChatSearchQuery = devChatSearchInput.value.toLowerCase();
    devRenderChat();
  });
}

// Dev context menu dismiss
document.addEventListener('click', function () {
  if (devChatContextMenu) { devChatContextMenu.remove(); devChatContextMenu = null; }
});

function devRenderChat() {
  devUpdateChatCounts();
  if (devChatActiveTab === 'friends') { devRenderChatFriends(); }
  else { devRenderChatInbox(); }
}

function devUpdateChatCounts() {
  var inboxUnread = devChatConversations.reduce(function (sum, c) {
    return sum + ((c.unread_count > 0 || c.is_unread) ? (c.unread_count || 1) : 0);
  }, 0);
  var el = document.getElementById('dev-chat-inbox-count');
  if (el) { el.textContent = inboxUnread > 0 ? '(' + inboxUnread + ')' : ''; }
  var onlineCount = devChatFriends.filter(function (f) { return f.online; }).length;
  var fel = document.getElementById('dev-chat-friends-count');
  if (fel) { fel.textContent = '(' + onlineCount + '/' + devChatFriends.length + ')'; }
}

function devIsGroupConv(c) {
  return c.type === 'group' || c.is_group === true || (c.participants && c.participants.length > 2);
}

function devRenderChatInbox() {
  var container = document.getElementById('dev-chat-content');
  var empty = document.getElementById('dev-chat-empty');
  var filtered = devChatConversations;
  var countAll = devChatConversations.length;
  var countDirect = devChatConversations.filter(function (c) { return !devIsGroupConv(c); }).length;
  var countGroup = devChatConversations.filter(function (c) { return devIsGroupConv(c); }).length;
  var countUnread = devChatConversations.filter(function (c) { return c.unread_count > 0 || c.is_unread; }).length;
  var setCount = function (id, n) { var e = document.getElementById(id); if (e) { e.textContent = n > 0 ? '(' + n + ')' : ''; } };
  setCount('dev-chat-count-all', countAll);
  setCount('dev-chat-count-direct', countDirect);
  setCount('dev-chat-count-group', countGroup);
  setCount('dev-chat-count-unread', countUnread);
  if (devChatFilter === 'unread') { filtered = devChatConversations.filter(function (c) { return c.unread_count > 0 || c.is_unread; }); }
  else if (devChatFilter === 'direct') { filtered = devChatConversations.filter(function (c) { return !devIsGroupConv(c); }); }
  else if (devChatFilter === 'group') { filtered = devChatConversations.filter(function (c) { return devIsGroupConv(c); }); }
  if (!filtered.length) {
    container.innerHTML = '';
    empty.style.display = 'block';
    empty.textContent = devChatFilter === 'all' ? 'No conversations yet' : 'No ' + devChatFilter + ' conversations';
    return;
  }
  empty.style.display = 'none';
  filtered.sort(function (a, b) {
    var aPinned = !!(a.pinned || a.pinned_at);
    var bPinned = !!(b.pinned || b.pinned_at);
    if (aPinned && !bPinned) return -1;
    if (!aPinned && bPinned) return 1;
    var aMuted = a.is_muted ? 1 : 0;
    var bMuted = b.is_muted ? 1 : 0;
    if (aMuted !== bMuted) return aMuted - bMuted;
    var dateA = new Date(a.last_message_at || a.updated_at || 0);
    var dateB = new Date(b.last_message_at || b.updated_at || 0);
    return dateB - dateA;
  });
  container.innerHTML = filtered.map(function (c) {
    var isGroup = devIsGroupConv(c);
    var name, avatar, subtitle;
    if (isGroup) {
      name = c.group_name || 'Group Chat';
      avatar = c.group_avatar_url || '';
      subtitle = (c.participants && c.participants.length || 0) + ' members';
    } else {
      var other = c.other_user;
      if (!other) return '';
      name = other.name || other.login;
      avatar = other.avatar_url || devChatAvatarUrl(other.login || '');
      subtitle = '';
    }
    if (isGroup && !avatar && c.participants && c.participants.length > 0) {
      avatar = c.participants[0].avatar_url || devChatAvatarUrl(c.participants[0].login || '');
    }
    var preview = c.last_message_preview || c.last_message_text || (c.last_message && (c.last_message.body || c.last_message.content)) || '';
    var draft = devChatDrafts[c.id] || '';
    var time = devChatTimeAgo(c.updated_at || c.last_message_at);
    var unread = c.unread_count > 0 || c.is_unread;
    var pin = (c.pinned || c.pinned_at) ? '<span class="codicon codicon-pin"></span> ' : '';
    var typeIcon = isGroup ? '<span class="codicon codicon-organization"></span> ' : '';
    var unreadBadge = unread ? '<span class="gs-badge">' + (c.unread_count || '') + '</span>' : '';
    var mutedIcon = c.is_muted ? '<span class="gs-text-xs" title="Muted"><span class="codicon codicon-bell-slash"></span></span>' : '';
    var previewHtml = draft
      ? '<div class="chat-conv-preview gs-text-sm gs-truncate"><span class="draft-label">Draft:</span> ' + escapeHtml(draft.slice(0, 60)) + '</div>'
      : '<div class="chat-conv-preview gs-text-sm gs-text-muted gs-truncate">' + escapeHtml(preview.slice(0, 80)) + '</div>';
    return '<div class="gs-row-item chat-conv-item' + (unread ? ' chat-conv-unread' : '') + (c.is_muted ? ' chat-conv-muted' : '') + '" data-id="' + c.id + '" data-pinned="' + !!(c.pinned || c.pinned_at) + '"' + (!isGroup && other ? ' data-other-login="' + escapeHtml(other.login || '') + '"' : '') + '>' +
      '<img src="' + escapeHtml(avatar) + '" class="gs-avatar gs-avatar-md" style="' + (isGroup ? 'border-radius:8px' : '') + '" alt="">' +
      '<div class="gs-flex-1" style="min-width:0">' +
        '<div class="gs-flex gs-items-center gs-gap-4">' +
          '<span class="chat-conv-name gs-truncate">' + typeIcon + escapeHtml(name) + '</span>' +
          mutedIcon +
          '<span class="gs-text-xs gs-text-muted gs-ml-auto gs-flex-shrink-0">' + pin + time + '</span>' +
          unreadBadge +
        '</div>' +
        (subtitle ? '<div class="gs-text-xs gs-text-muted">' + escapeHtml(subtitle) + '</div>' : '') +
        previewHtml +
      '</div>' +
    '</div>';
  }).join('');
  container.querySelectorAll('.chat-conv-item').forEach(function (el) {
    el.addEventListener('click', function () {
      vscode.postMessage({ type: 'openConversation', payload: { conversationId: el.dataset.id } });
    });
    el.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      devShowChatContextMenu(e, el.dataset.id, el.dataset.pinned === 'true');
    });
  });
  // Bind avatar clicks to ProfileCard (stopPropagation inside bindTrigger prevents opening conversation)
  if (window.ProfileCard) {
    container.querySelectorAll('.chat-conv-item[data-other-login]').forEach(function (el) {
      var avatar = el.querySelector('.gs-avatar');
      if (avatar) {
        window.ProfileCard.bindTrigger(avatar, el.getAttribute('data-other-login'));
      }
    });
  }
}

function devRenderChatFriends() {
  var container = document.getElementById('dev-chat-content');
  var empty = document.getElementById('dev-chat-empty');
  var filtered = devChatFriends;
  if (devChatSearchQuery) {
    filtered = devChatFriends.filter(function (f) {
      return f.login.toLowerCase().includes(devChatSearchQuery) || f.name.toLowerCase().includes(devChatSearchQuery);
    });
  }
  if (!filtered.length) {
    container.innerHTML = '';
    empty.style.display = 'block';
    empty.textContent = devChatSearchQuery ? 'No matches' : 'No friends yet. Follow people to see them here!';
    return;
  }
  empty.style.display = 'none';
  var online = filtered.filter(function (f) { return f.online; });
  var recent = filtered.filter(function (f) { return !f.online && f.lastSeen > 0 && (Date.now() - f.lastSeen < 3600000); });
  var offline = filtered.filter(function (f) { return !f.online && (f.lastSeen === 0 || Date.now() - f.lastSeen >= 3600000); });
  var html = '';
  function renderFriend(f) {
    var avatar = f.avatar_url || devChatAvatarUrl(f.login);
    var dot = f.online ? '<span class="gs-dot-online"></span>' : '<span class="gs-dot-offline"></span>';
    var status = f.online ? 'online' : (f.lastSeen > 0 ? devChatTimeAgo(new Date(f.lastSeen).toISOString()) + ' ago' : '');
    var unread = f.unread > 0 ? '<span class="gs-badge">' + f.unread + '</span>' : '';
    return '<div class="gs-row-item chat-friend-item" data-login="' + escapeHtml(f.login) + '">' +
      '<img src="' + escapeHtml(avatar) + '" class="gs-avatar gs-avatar-md" alt="">' +
      '<div class="gs-flex-1" style="min-width:0">' +
        '<div class="gs-flex gs-items-center gs-gap-4">' + dot +
          '<span class="gs-truncate" style="font-weight:500">' + escapeHtml(f.name) + '</span>' + unread +
        '</div>' +
        '<div class="gs-text-xs gs-text-muted">' + escapeHtml(status) + '</div>' +
      '</div>' +
      '<button class="gs-btn-icon chat-friend-msg-btn" data-login="' + escapeHtml(f.login) + '" title="Chat"><span class="codicon codicon-comment"></span></button>' +
    '</div>';
  }
  if (online.length) { html += '<div class="gs-section-title">Online (' + online.length + ')</div>'; html += online.map(renderFriend).join(''); }
  if (recent.length) { html += '<div class="gs-section-title">Recently Active</div>'; html += recent.map(renderFriend).join(''); }
  if (offline.length) { html += '<div class="gs-section-title">Offline</div>'; html += offline.map(renderFriend).join(''); }
  container.innerHTML = html;
  container.querySelectorAll('.chat-friend-item').forEach(function (el) {
    el.addEventListener('click', function () {
      vscode.postMessage({ type: 'chatOpenDM', payload: { login: el.dataset.login } });
    });
  });
  container.querySelectorAll('.chat-friend-msg-btn').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      vscode.postMessage({ type: 'chatOpenDM', payload: { login: btn.dataset.login } });
    });
  });
  // Bind avatar to ProfileCard; row click still opens DM, msg-btn still works via stopPropagation
  if (window.ProfileCard) {
    container.querySelectorAll('.chat-friend-item[data-login]').forEach(function (el) {
      var avatar = el.querySelector('.gs-avatar');
      if (avatar) {
        window.ProfileCard.bindTrigger(avatar, el.getAttribute('data-login'));
      }
    });
  }
}

function devShowChatContextMenu(e, convId, isPinned) {
  if (devChatContextMenu) { devChatContextMenu.remove(); }
  var menu = document.createElement('div');
  menu.className = 'chat-context-menu';
  menu.innerHTML =
    '<div class="chat-ctx-item" data-action="' + (isPinned ? 'chatUnpin' : 'chatPin') + '">' + (isPinned ? 'Unpin' : 'Pin') + '</div>' +
    '<div class="chat-ctx-item" data-action="chatMarkRead">Mark as read</div>';
  menu.style.left = e.clientX + 'px';
  menu.style.top = e.clientY + 'px';
  document.body.appendChild(menu);
  devChatContextMenu = menu;
  menu.querySelectorAll('.chat-ctx-item').forEach(function (item) {
    item.addEventListener('click', function (ev) {
      ev.stopPropagation();
      vscode.postMessage({ type: item.dataset.action, payload: { conversationId: convId } });
      menu.remove();
      devChatContextMenu = null;
    });
  });
}

// ===================== TRENDING SUB-TAB SWITCHING =====================
document.querySelectorAll("[data-trending-tab]").forEach(function(tab) {
  tab.addEventListener("click", function() {
    document.querySelectorAll("[data-trending-tab]").forEach(function(t) { t.classList.remove("active"); });
    tab.classList.add("active");
    trendingSubTab = tab.dataset.trendingTab;
    document.getElementById("trending-sub-repos").style.display = trendingSubTab === "repos" ? "" : "none";
    document.getElementById("trending-sub-people").style.display = trendingSubTab === "people" ? "" : "none";
    // Lazy-load people
    if (trendingSubTab === "people" && !trendingPeopleLoaded) {
      trendingPeopleLoaded = true;
      vscode.postMessage({ type: "switchTab", payload: { tab: "dev-people" } });
    }
  });
});

// ===================== DEV: REPOS TAB =====================
var devReposSearchInput = document.getElementById("repos-search");
var devRangesEl = document.getElementById("repos-ranges");

var devReposSearchClear = document.getElementById("repos-search-clear");
if (devReposSearchInput) {
  devReposSearchInput.addEventListener("input", function () {
    clearTimeout(devReposSearchTimer);
    var q = devReposSearchInput.value.trim();
    if (devReposSearchClear) { devReposSearchClear.style.display = q ? "inline-flex" : "none"; }
    if (q) {
      if (devRangesEl) { devRangesEl.style.display = "none"; }
      devReposSearchTimer = setTimeout(function () {
        document.getElementById("repos-list").innerHTML = '<div class="ex-loading">Searching\u2026</div>';
        vscode.postMessage({ type: "searchRepos", payload: { query: q } });
      }, 350);
    } else {
      if (devRangesEl) { devRangesEl.style.display = ""; }
      vscode.postMessage({ type: "refreshRepos" });
    }
  });
}
if (devReposSearchClear) {
  devReposSearchClear.addEventListener("click", function () {
    devReposSearchInput.value = "";
    devReposSearchClear.style.display = "none";
    if (devRangesEl) { devRangesEl.style.display = ""; }
    vscode.postMessage({ type: "refreshRepos" });
    devReposSearchInput.focus();
  });
}

if (devRangesEl) {
  devRangesEl.querySelectorAll(".gs-chip[data-range]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      if (btn.dataset.range === devCurrentRange) { return; }
      devCurrentRange = btn.dataset.range;
      devRangesEl.querySelectorAll(".gs-chip[data-range]").forEach(function (b) {
        b.classList.toggle("active", b.dataset.range === devCurrentRange);
      });
      document.getElementById("repos-list").innerHTML = '<div class="ex-loading">Loading\u2026</div>';
      vscode.postMessage({ type: "changeRange", payload: { range: devCurrentRange } });
    });
  });
}

function devRenderRepos(repos) {
  var list = document.getElementById("repos-list");
  if (!list) { return; }
  if (!repos || !repos.length) {
    list.innerHTML = '<div class="gs-empty">No repos found.</div>';
    return;
  }
  list.innerHTML = repos.map(function (r, i) {
    var color = LANG_COLORS[r.language] || '#888';
    var isStarred = !!r.starred;
    var ownerAvatar = r.avatar_url || ('https://github.com/' + encodeURIComponent(r.owner) + '.png?size=48');
    return '<div class="gs-row-item tr-card" data-owner="' + escapeHtml(r.owner) + '" data-repo="' + escapeHtml(r.name) + '">' +
      '<span class="gs-rank" data-rank="' + (i + 1) + '">' + (i + 1) + '</span>' +
      '<img class="tr-owner-avatar" src="' + escapeHtml(ownerAvatar) + '" alt="">' +
      '<div class="tr-content">' +
        '<div class="tr-title-wrap">' +
          '<span class="tr-owner-name">' + escapeHtml(r.owner) + '</span>' +
          '<span class="tr-name-sep">/</span>' +
          '<span class="tr-repo-name">' + escapeHtml(r.name) + '</span>' +
        '</div>' +
        (r.description ? '<div class="tr-desc">' + escapeHtml(r.description) + '</div>' : '') +
        '<div class="tr-meta">' +
          (r.language ? '<span class="tr-lang"><span class="tr-lang-dot" style="background:' + color + '"></span>' + escapeHtml(r.language) + '</span>' : '') +
          (r.score ? '<span class="tr-stat">\u25b2 ' + devFmt(r.score) + '</span>' : '') +
          (r.topics && r.topics.length ? '<span class="tr-topic-pill">' + escapeHtml(r.topics[0]) + '</span>' : '') +
        '</div>' +
      '</div>' +
      '<div class="tr-actions">' +
        '<button class="tr-btn tr-star-btn' + (isStarred ? ' tr-btn-starred' : '') + '" data-slug="' + escapeHtml(r.owner + '/' + r.name) + '" data-starred="' + (isStarred ? '1' : '0') + '" title="' + (isStarred ? 'Unstar' : 'Star') + '"><span class="codicon codicon-star' + (isStarred ? '-full' : '-empty') + '"></span></button>' +
        '<span class="tr-star-count">' + devFmt(r.stars) + '</span>' +
      '</div>' +
    '</div>';
  }).join('');

  list.querySelectorAll(".tr-star-btn").forEach(function (btn) {
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      var slug = btn.dataset.slug;
      var isStarred = btn.dataset.starred === "1";
      btn.dataset.starred = isStarred ? "0" : "1";
      btn.classList.toggle("tr-btn-starred", !isStarred);
      btn.innerHTML = '<span class="codicon codicon-star' + (isStarred ? '-empty' : '-full') + '"></span>';
      vscode.postMessage({ type: isStarred ? "unstar" : "star", payload: { slug: slug } });
    });
  });
  list.querySelectorAll(".tr-card").forEach(function (card) {
    card.addEventListener("click", function () {
      vscode.postMessage({ type: "viewRepo", payload: { owner: card.dataset.owner, repo: card.dataset.repo } });
    });
  });
}

// ===================== DEV: PEOPLE TAB =====================
var devCurrentPeopleRange = 'weekly';
var devPeopleRangesEl = document.getElementById("people-ranges");
if (devPeopleRangesEl) {
  devPeopleRangesEl.querySelectorAll(".gs-chip[data-people-range]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      if (btn.dataset.peopleRange === devCurrentPeopleRange) { return; }
      devCurrentPeopleRange = btn.dataset.peopleRange;
      devPeopleRangesEl.querySelectorAll(".gs-chip[data-people-range]").forEach(function (b) {
        b.classList.toggle("active", b.dataset.peopleRange === devCurrentPeopleRange);
      });
      document.getElementById("people-list").innerHTML = '<div class="ex-loading">Loading\u2026</div>';
      vscode.postMessage({ type: "changePeopleRange", payload: { range: devCurrentPeopleRange } });
    });
  });
}

var peopleSearchTimer = null;
var peopleSearchInput = document.getElementById("people-search");
var peopleSearchClear = document.getElementById("people-search-clear");
if (peopleSearchInput) {
  peopleSearchInput.addEventListener("input", function () {
    clearTimeout(peopleSearchTimer);
    var q = peopleSearchInput.value.trim().toLowerCase();
    if (peopleSearchClear) { peopleSearchClear.style.display = q ? "inline-flex" : "none"; }
    peopleSearchTimer = setTimeout(function () {
      if (!q) {
        devRenderPeople(devTrendingPeopleCache);
      } else {
        var filtered = devTrendingPeopleCache.filter(function (p) {
          return (p.login || "").toLowerCase().includes(q) || (p.name || "").toLowerCase().includes(q) || (p.bio || "").toLowerCase().includes(q);
        });
        devRenderPeople(filtered);
      }
    }, 200);
  });
}
if (peopleSearchClear) {
  peopleSearchClear.addEventListener("click", function () {
    peopleSearchInput.value = "";
    peopleSearchClear.style.display = "none";
    devRenderPeople(devTrendingPeopleCache);
    peopleSearchInput.focus();
  });
}

function devRenderPeople(people) {
  var list = document.getElementById("people-list");
  if (!list) { return; }
  if (!people || !people.length) {
    list.innerHTML = '<div class="gs-empty">No trending developers found.</div>';
    return;
  }
  list.innerHTML = people.map(function (p, i) {
    var avatar = p.avatar_url || ('https://github.com/' + encodeURIComponent(p.login) + '.png?size=72');
    var displayName = p.name || p.login;
    var starPower = Math.round((p.star_power || 0) * 10) / 10;
    return '<div class="gs-row-item tp-card" data-login="' + escapeHtml(p.login) + '">' +
      '<span class="gs-rank" data-rank="' + (i + 1) + '">' + (i + 1) + '</span>' +
      '<img class="tp-avatar" src="' + escapeHtml(avatar) + '" alt="">' +
      '<div class="tp-info">' +
        '<div class="tp-name">' + escapeHtml(displayName) + '</div>' +
        (p.name ? '<div class="tp-login">@' + escapeHtml(p.login) + '</div>' : '') +
        (p.bio ? '<div class="tp-bio">' + escapeHtml(p.bio) + '</div>' : '') +
        '<div class="tp-meta">' +
          (starPower ? '<span>\u2b50 ' + devFmt(starPower) + '</span>' : '') +
          (p.followers ? '<span>\u00b7 ' + devFmt(p.followers) + ' followers</span>' : '') +
        '</div>' +
      '</div>' +
      '<button class="gs-btn ' + (p.following ? 'gs-btn-secondary tp-btn-following' : 'gs-btn-primary') + ' tp-follow-btn" data-login="' + escapeHtml(p.login) + '" data-following="' + (p.following ? '1' : '0') + '">' + (p.following ? 'Following' : 'Follow') + '</button>' +
    '</div>';
  }).join('');

  list.querySelectorAll(".tp-follow-btn").forEach(function (btn) {
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      var login = btn.dataset.login;
      var isFollowing = btn.dataset.following === "1";
      btn.dataset.following = isFollowing ? "0" : "1";
      btn.classList.toggle("tp-btn-following", !isFollowing);
      btn.classList.toggle("gs-btn-primary", isFollowing);
      btn.classList.toggle("gs-btn-secondary", !isFollowing);
      btn.textContent = isFollowing ? 'Follow' : 'Following';
      vscode.postMessage({ type: isFollowing ? "unfollow" : "follow", payload: { login: login } });
    });
  });
  list.querySelectorAll(".tp-card").forEach(function (el) {
    el.addEventListener("click", function (e) {
      if (e.target.closest(".tp-follow-btn")) { return; }
      var login = el.dataset.login;
      if (login) { vscode.postMessage({ type: "viewProfile", payload: { login: login } }); }
    });
  });
}

// ===================== DEV: MY REPOS TAB =====================
function devRenderMyRepos(data) {
  var list = document.getElementById("myrepos-list");
  if (!list) { return; }
  var groups = [
    { key: 'public', label: 'Public', repos: data.public || [] },
    { key: 'private', label: 'Private', repos: data.private || [] },
    { key: 'starred', label: 'Starred', repos: data.starred || [] },
  ].filter(function (g) { return g.repos.length > 0; });

  if (!groups.length) {
    list.innerHTML = '<div class="gs-empty">No repos found.</div>';
    return;
  }
  list.innerHTML = groups.map(function (g) {
    return '<div class="mr-group">' + escapeHtml(g.label) + ' (' + g.repos.length + ')</div>' +
      g.repos.map(function (r) {
        return '<div class="mr-card" data-owner="' + escapeHtml(r.owner) + '" data-repo="' + escapeHtml(r.name) + '">' +
          '<span class="mr-icon">' + (r.private ? '\ud83d\udd12' : '\ud83d\udcc1') + '</span>' +
          '<div class="mr-info">' +
            '<div class="mr-name">' + escapeHtml(r.name) + '</div>' +
            (r.description ? '<div class="mr-desc">' + escapeHtml(r.description) + '</div>' : '') +
          '</div>' +
          '<div class="mr-meta">\u2b50 ' + devFmt(r.stars) + (r.language ? ' \u00b7 ' + escapeHtml(r.language) : '') + '</div>' +
        '</div>';
      }).join('');
  }).join('');

  list.querySelectorAll(".mr-card").forEach(function (card) {
    card.addEventListener("click", function () {
      vscode.postMessage({ type: "viewRepo", payload: { owner: card.dataset.owner, repo: card.dataset.repo } });
    });
  });
}

// ===================== DEV: CHANNELS =====================
function devRenderChannels() {
  var listEl = document.getElementById("channels-list");
  var emptyEl = document.getElementById("channels-empty");
  if (!listEl || !emptyEl) { return; }
  if (devChannelsList.length === 0) {
    listEl.innerHTML = '';
    emptyEl.style.display = '';
    return;
  }
  var channelsFiltered = devChannelsList;
  if (chatSearchQuery) {
    channelsFiltered = devChannelsList.filter(function(ch) {
      var name = (ch.displayName || ch.repoOwner + '/' + ch.repoName).toLowerCase();
      return name.includes(chatSearchQuery);
    });
  }
  if (channelsFiltered.length === 0) {
    listEl.innerHTML = '';
    emptyEl.style.display = '';
    emptyEl.textContent = chatSearchQuery ? 'No matches' : 'No channels yet';
    return;
  }
  emptyEl.style.display = 'none';
  listEl.innerHTML = channelsFiltered.map(function (ch) {
    var avatar = ch.avatarUrl
      ? '<img class="channel-avatar" src="' + escapeHtml(ch.avatarUrl) + '" alt="" />'
      : '<div class="channel-avatar channel-avatar-placeholder"><span class="codicon codicon-megaphone"></span></div>';
    var badge = ch.role === 'owner' ? '<span class="channel-role-badge">Owner</span>'
      : ch.role === 'admin' ? '<span class="channel-role-badge">Admin</span>'
      : '';
    return '<div class="gs-row-item channel-item" data-channel-id="' + escapeHtml(ch.id) + '" data-repo-owner="' + escapeHtml(ch.repoOwner) + '" data-repo-name="' + escapeHtml(ch.repoName) + '">' +
      avatar +
      '<div class="channel-info">' +
        '<div class="channel-name">' + escapeHtml(ch.displayName || ch.repoOwner + '/' + ch.repoName) + ' ' + badge + '</div>' +
        '<div class="channel-meta">' + devFmt(ch.subscriberCount) + ' subscribers</div>' +
      '</div>' +
    '</div>';
  }).join('');
  listEl.querySelectorAll(".channel-item").forEach(function (el) {
    el.addEventListener("click", function () {
      vscode.postMessage({ type: "openChannel", payload: { channelId: el.dataset.channelId, repoOwner: el.dataset.repoOwner, repoName: el.dataset.repoName } });
    });
  });
}

// ===================== USER MENU =====================
var userMenuEl = document.getElementById("user-menu");

function toggleUserMenu() {
  if (!userMenuEl) { return; }
  // Close settings panel first
  var sp = document.getElementById("settings-panel");
  if (sp) sp.style.display = "none";
  // Toggle user menu
  var isOpen = userMenuEl.style.display !== "none" && userMenuEl.style.display !== "";
  closeAllPopups();
  if (!isOpen) { userMenuEl.style.display = "block"; }
}

// Close ALL dropdowns on outside click
document.addEventListener("click", function(e) {
  if (e.target.closest(".gs-dropdown") || e.target.closest(".gs-btn-icon")) { return; }
  document.querySelectorAll(".gs-dropdown").forEach(function(dd) {
    dd.style.display = "none";
  });
});

// ── Search retry handler ──
document.addEventListener("click", function(e) {
  if (e.target && e.target.classList && e.target.classList.contains("search-retry-btn")) {
    chatGlobalSearchError = false;
    chatGlobalSearchLoading = true;
    renderChatInbox();
    vscode.postMessage({ type: "searchInboxMessages", payload: { query: chatSearchQuery } });
  }
});

var userMenuProfile = document.getElementById("user-menu-profile");
if (userMenuProfile) {
  userMenuProfile.addEventListener("click", function() {
    userMenuEl.style.display = "none";
    var login = userMenuEl.dataset.login || "";
    if (window.ProfileCard && login) {
      window.ProfileCard.show(login);
    } else {
      doAction("viewProfile", { login: login });
    }
  });
}

var userMenuSignout = document.getElementById("user-menu-signout");
if (userMenuSignout) {
  userMenuSignout.addEventListener("click", function() {
    userMenuEl.style.display = "none";
    doAction("signOut");
  });
}

// ===================== SETTINGS PANEL =====================
var settingsPanel = document.getElementById("settings-panel");
var userMenuSettings = document.getElementById("user-menu-settings");
var settingsBack = document.getElementById("settings-back");

if (userMenuSettings && settingsPanel) {
  userMenuSettings.addEventListener("click", function() {
    userMenuEl.style.display = "none";
    settingsPanel.style.display = "block";
  });
}
if (settingsBack && settingsPanel) {
  settingsBack.addEventListener("click", function() {
    settingsPanel.style.display = "none";
    userMenuEl.style.display = "block";
  });
}
var settingNotif = document.getElementById("chat-setting-notifications");
if (settingNotif) settingNotif.addEventListener("change", function() { doAction("updateSetting", { key: "notifications", value: this.checked }); });
var settingSound = document.getElementById("chat-setting-sound");
if (settingSound) settingSound.addEventListener("change", function() { doAction("updateSetting", { key: "sound", value: this.checked }); });
var settingDebug = document.getElementById("chat-setting-debug");
if (settingDebug) settingDebug.addEventListener("change", function() { doAction("updateSetting", { key: "debug", value: this.checked }); });

// ===================== NEW CHAT DROPDOWN =====================
var newChatDm = document.getElementById("new-chat-dm");
if (newChatDm) newChatDm.addEventListener("click", function() {
  closeAllPopups();
  document.getElementById("new-chat-menu").style.display = "none";
  if (typeof SidebarChat !== 'undefined' && SidebarChat.showNewDMPanel) {
    SidebarChat.showNewDMPanel(chatFriends);
  }
});
var newChatGroup = document.getElementById("new-chat-group");
if (newChatGroup) newChatGroup.addEventListener("click", function() {
  closeAllPopups();
  document.getElementById("new-chat-menu").style.display = "none";
  if (typeof SidebarChat !== 'undefined' && SidebarChat.showNewGroupPanel) {
    SidebarChat.showNewGroupPanel(chatFriends);
  }
});

// ===================== INIT =====================
// Refresh buttons (safe — elements may not exist)
var feedReposRefresh = document.getElementById("feed-repos-refresh");
if (feedReposRefresh) { feedReposRefresh.addEventListener("click", function(e) { e.stopPropagation(); doAction("refreshMyRepos"); }); }
var trendingRefresh = document.getElementById("trending-refresh");
if (trendingRefresh) {
  trendingRefresh.addEventListener("click", function(e) {
    e.stopPropagation();
    if (trendingSubTab === "repos") {
      document.getElementById("repos-list").innerHTML = '<div class="ex-loading">Loading\u2026</div>';
      vscode.postMessage({ type: "switchTab", payload: { tab: "dev-repos" } });
    } else {
      document.getElementById("people-list").innerHTML = '<div class="ex-loading">Loading\u2026</div>';
      vscode.postMessage({ type: "switchTab", payload: { tab: "dev-people" } });
    }
  });
}

// Section collapse/expand
document.querySelectorAll(".gs-accordion-header[data-toggle]").forEach(function(header) {
  header.addEventListener("click", function(e) {
    if (e.target.closest(".gs-btn-icon")) { return; }
    var targetId = header.dataset.toggle;
    var body = document.getElementById(targetId);
    if (body) {
      body.classList.toggle("collapsed");
      header.classList.toggle("collapsed");
    }
  });
});

// ===================== STATE PERSISTENCE =====================
function persistState() {
  var chatConvId = (typeof SidebarChat !== "undefined" && SidebarChat.isOpen && SidebarChat.isOpen())
    ? (SidebarChat.getConversationId && SidebarChat.getConversationId()) : undefined;
  var s = vscode.getState() || {};
  s.navStack = navStack;
  s.chatMainTab = chatMainTab;
  s.currentTab = currentTab;
  s.chatConversationId = chatConvId || undefined;
  s.tabScrollPositions = tabScrollPositions;
  // accordionState is already handled by setAccordionState() — don't overwrite
  vscode.setState(s);
}

function restoreState() {
  var state = vscode.getState();
  if (!state) return;

  // Migrate old tab names
  if (state.chatMainTab === "inbox") chatMainTab = "chat";
  else if (state.chatMainTab === "channels") chatMainTab = "discover";
  else if (["chat", "friends", "discover"].indexOf(state.chatMainTab) !== -1) chatMainTab = state.chatMainTab;
  else chatMainTab = "chat";

  currentTab = chatMainTab;

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

  // Restore nav stack (chat view)
  if (state.navStack === "chat" && state.chatConversationId) {
    navStack = "chat";
    var nav = document.getElementById("gs-nav");
    if (nav) { nav.classList.add("chat-active"); }
    var mainTabs = document.getElementById("gs-main-tabs");
    if (mainTabs) { mainTabs.style.display = "none"; }
    var searchBar = document.getElementById("gs-search-bar");
    if (searchBar) { searchBar.style.display = "none"; }
    if (typeof SidebarChat !== "undefined" && SidebarChat.open) {
      SidebarChat.open(state.chatConversationId);
    }
    vscode.postMessage({ type: "chat:open", payload: { conversationId: state.chatConversationId } });
  }
}

// ===================== CLOSE ALL POPUPS =====================
function closeAllPopups() {
  document.querySelectorAll(".gs-dropdown").forEach(function(dd) { dd.style.display = "none"; });
  if (chatContextMenuEl) { chatContextMenuEl.remove(); chatContextMenuEl = null; }
  if (devChatContextMenu) { devChatContextMenu.remove(); devChatContextMenu = null; }
}

window.addEventListener("blur", function() {
  closeAllPopups();
});

restoreState();
doAction("ready");
