// explore.js — Unified Explore tabbed webview
// Depends on shared.js (loaded first): vscode, doAction, escapeHtml, formatCount, timeAgo, avatarUrl
// Depends on sidebar-chat.js (loaded second): window.SidebarChat (may not exist yet)

// ===================== GLOBAL STATE =====================
var currentTab = "inbox";
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
var chatInboxFilter = "all";
var chatContextMenuEl = null;
var chatTypingUsers = {};
var chatDrafts = {};
// Global message search (Telegram-style) — results from backend /messages/search
var chatGlobalSearchResults = null;      // null = not fetched; [] = fetched 0 matches; Array<msg> = matches
var chatGlobalSearchLoading = false;
var chatGlobalSearchError = false;
var chatGlobalSearchNextCursor = null;
var chatGlobalSearchDebounce = null;

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
var trendingSubTab = "repos";
var trendingReposLoaded = false;
var trendingPeopleLoaded = false;

// ===================== MY REPOS STATE =====================
var myRepos = [];
var myStarred = [];

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
var chatMainTab = "inbox"; // inbox | friends | channels

document.querySelectorAll(".gs-main-tab").forEach(function(tab) {
  tab.addEventListener("click", function() {
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

    // Update search placeholder based on tab
    if (globalSearch) {
      var placeholders = { inbox: "Search messages...", friends: "Search friends...", channels: "Search channels..." };
      globalSearch.placeholder = placeholders[chatMainTab] || "Search...";
      globalSearch.value = "";
      chatSearchQuery = "";
      var clrBtn = document.getElementById("gs-search-clear");
      if (clrBtn) { clrBtn.style.display = "none"; }
    }

    if (chatMainTab === "channels") {
      if (filterBar) { filterBar.style.display = "none"; }
      if (channelsPane) { channelsPane.style.display = ""; }
      if (chatContent) { chatContent.style.display = "none"; }
      if (chatEmpty) { chatEmpty.style.display = "none"; }
      if (devChannelsList.length === 0) { vscode.postMessage({ type: "fetchChannels" }); }
      devRenderChannels();
    } else if (chatMainTab === "friends") {
      if (filterBar) { filterBar.style.display = "none"; }
      if (channelsPane) { channelsPane.style.display = "none"; }
      if (chatContent) { chatContent.style.display = ""; }
      chatSubTab = "friends";
      renderChat();
    } else {
      // inbox
      if (filterBar) { filterBar.style.display = "flex"; }
      if (channelsPane) { channelsPane.style.display = "none"; }
      if (chatContent) { chatContent.style.display = ""; }
      chatSubTab = "inbox";
      renderChat();
    }
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

      if (chatMainTab === "channels") {
        chatGlobalSearchLoading = false;
        devRenderChannels();
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
      if (chatMainTab === "channels") { devRenderChannels(); }
      else { renderChat(); }
      globalSearchEl.focus();
    });
  }

  // Inbox filter buttons
  document.querySelectorAll("#chat-filter-bar .gs-chip").forEach(function(btn) {
    btn.addEventListener("click", function() {
      document.querySelectorAll("#chat-filter-bar .gs-chip").forEach(function(b) { b.classList.remove("active"); });
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

function renderChatInbox() {
  var container = document.getElementById("chat-content");
  var empty = document.getElementById("chat-empty");

  function isGroupConv(c) {
    return c.type === "group" || c.type === "community" || c.type === "team" || c.is_group === true || (c.participants && c.participants.length > 2);
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
        var typeIcon = cIsGroup ? '<span class="codicon codicon-organization"></span> ' : '';
        return '<div class="gs-row-item conv-item" data-id="' + c.id + '">' +
          '<img src="' + escapeHtml(cAvatar) + '" class="gs-avatar gs-avatar-md" style="' + (cIsGroup ? 'border-radius:8px' : '') + '" alt="">' +
          '<div class="gs-flex-1" style="min-width:0">' +
            '<span class="conv-name gs-truncate" style="font-weight:500">' + typeIcon + escapeHtml(cName) + '</span>' +
          '</div>' +
        '</div>';
      }).join("");
    }

    // Section 2: Messages (from backend /messages/search)
    html += '<div class="gs-section-title">MESSAGES</div>';
    if (chatGlobalSearchLoading) {
      html += '<div class="gs-text-muted gs-text-xs" style="padding:8px var(--gs-inset-x)">Searching…</div>';
    } else if (chatGlobalSearchError) {
      html += '<div class="gs-text-muted gs-text-xs" style="padding:8px var(--gs-inset-x)">Search failed. Try again.</div>';
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

function renderChatConversation(c) {
  var isGroup = c.type === "group" || c.type === "community" || c.type === "team" || c.is_group === true || (c.participants && c.participants.length > 2);
  var name, avatar, subtitle;
  if (isGroup) {
    name = c.group_name || "Group Chat";
    avatar = c.group_avatar_url || "";
    if (!avatar && (c.type === "community" || c.type === "team") && c.repo_full_name) {
      avatar = "https://github.com/" + c.repo_full_name.split("/")[0] + ".png?size=48";
    }
    var memberCount = (c.participants && c.participants.length) || 0;
    subtitle = (c.type === "community" || c.type === "team") && c.repo_full_name ? c.repo_full_name : memberCount + " members";
  } else {
    var other = c.other_user;
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
  var typeIcon = c.type === "community" ? '<span class="codicon codicon-star"></span> '
    : c.type === "team" ? '<span class="codicon codicon-git-pull-request"></span> '
    : isGroup ? '<span class="codicon codicon-organization"></span> ' : "";
  if (isGroup && !avatar && c.participants && c.participants.length > 0) {
    avatar = c.participants[0].avatar_url || avatarUrl(c.participants[0].login || "");
  }
  var unreadBadge = unread ? '<span class="gs-badge">' + (c.unread_count || '') + '</span>' : '';
  var mutedIcon = c.is_muted ? '<span class="gs-text-xs" title="Muted"><span class="codicon codicon-bell-slash"></span></span>' : '';
  var previewHtml = draft
    ? '<div class="conv-preview gs-text-sm gs-truncate"><span class="draft-label">Draft:</span> ' + escapeHtml(draft.slice(0, 60)) + '</div>'
    : '<div class="conv-preview gs-text-sm gs-text-muted gs-truncate">' + escapeHtml(preview.slice(0, 80)) + '</div>';

  return '<div class="gs-row-item conv-item' + (unread ? ' conv-unread' : '') + (c.is_muted ? ' conv-muted' : '') + '" data-id="' + c.id + '" data-pinned="' + (c.pinned || c.pinned_at || false) + '"' + (!isGroup && other ? ' data-other-login="' + escapeHtml(other.login || '') + '"' : '') + '>' +
    '<img src="' + escapeHtml(avatar) + '" class="gs-avatar gs-avatar-md" style="' + (isGroup ? 'border-radius:8px' : '') + '" alt="">' +
    '<div class="gs-flex-1" style="min-width:0">' +
      '<div class="gs-flex gs-items-center gs-gap-4">' +
        '<span class="conv-name gs-truncate">' + pin + typeIcon + escapeHtml(name) + '</span>' +
        mutedIcon +
        '<span class="gs-text-xs gs-text-muted gs-ml-auto gs-flex-shrink-0">' + time + '</span>' +
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

// ===================== FEED TAB LOGIC =====================
(function initFeed() {
  var feedFiltersEl = document.getElementById("feed-filters");
  if (!feedFiltersEl) return; // Feed tab hidden by feature flag
  feedFiltersEl.querySelectorAll(".gs-chip").forEach(function(chip) {
    chip.addEventListener("click", function() {
      // Click active filter again → reset to "all"
      if (chip.classList.contains("active") && chip.dataset.filter !== "all") {
        chip.classList.remove("active");
        feedFiltersEl.querySelector('.gs-chip[data-filter="all"]').classList.add("active");
        feedActiveFilter = "all";
      } else {
        feedFiltersEl.querySelectorAll(".gs-chip").forEach(function(c) { c.classList.remove("active"); });
        chip.classList.add("active");
        feedActiveFilter = chip.dataset.filter;
      }
      renderFeed();
    });
  });
  var feedLoadMoreEl = document.getElementById("feed-load-more");
  if (!feedLoadMoreEl) return;
  feedLoadMoreEl.addEventListener("click", function() {
    doAction("loadMore");
    var btn = document.getElementById("feed-load-more");
    btn.textContent = "Loading...";
    btn.disabled = true;
  });
})();

function renderFeed() {
  var container = document.getElementById("feed-events");
  var empty = document.getElementById("feed-empty");
  if (!container || !empty) return; // Feed tab hidden by feature flag
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
  if (!container) { return; }
  if (!myRepos.length && !myStarred.length) {
    container.innerHTML = '<div class="gs-empty" style="padding:12px">No repos found</div>';
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
  if (!container) return; // Trending tab hidden by feature flag
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
  if (!container) return; // Trending tab hidden by feature flag
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
  if (!container) return; // Trending tab hidden by feature flag
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

  // Route chat: messages to SidebarChat
  if (data.type && data.type.indexOf("chat:") === 0) {
    if (data.type === "chat:joinedConversation") {
      // Re-enable any spinning join buttons for this repo
      document.querySelectorAll(".tr-community-btn, .tr-team-btn").forEach(function(btn) {
        if (btn.dataset.slug === data.repoFullName) {
          btn.disabled = false;
          var isCommunity = btn.classList.contains("tr-community-btn");
          btn.innerHTML = '<span class="codicon codicon-' + (isCommunity ? 'globe' : 'organization') + '"></span>';
        }
      });
      pushChatView(data.conversationId);
      return;
    }
    if (data.type === "chat:joinError") {
      // Re-enable the spinning button and briefly show error icon
      document.querySelectorAll(".tr-community-btn, .tr-team-btn").forEach(function(btn) {
        if (btn.dataset.slug === data.repoFullName) {
          btn.disabled = false;
          var isCommunity = btn.classList.contains("tr-community-btn");
          btn.innerHTML = '<span class="codicon codicon-' + (isCommunity ? 'globe' : 'organization') + '"></span>';
        }
      });
      return;
    }
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
      chatFriends = data.friends || [];
      chatConversations = data.conversations || [];
      chatCurrentUser = data.currentUser;
      if (data.drafts) { chatDrafts = data.drafts; }
      renderChat();
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

    // Feed messages
    case "setFeedEvents":
      if (data.replace) { feedEvents = data.events || []; }
      else { feedEvents = feedEvents.concat(data.events || []); }
      renderFeed();
      var feedBtn = document.getElementById("feed-load-more");
      if (feedBtn) {
        feedBtn.textContent = "Load more";
        feedBtn.disabled = false;
        feedBtn.style.display = data.hasMore ? "block" : "none";
      }
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
      devRenderChannels();
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
  return c.type === 'group' || c.type === 'community' || c.type === 'team' || c.is_group === true || (c.participants && c.participants.length > 2);
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
      if (!avatar && (c.type === 'community' || c.type === 'team') && c.repo_full_name) {
        avatar = 'https://github.com/' + c.repo_full_name.split('/')[0] + '.png?size=48';
      }
      subtitle = (c.type === 'community' || c.type === 'team') && c.repo_full_name ? c.repo_full_name : (c.participants && c.participants.length || 0) + ' members';
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
    var typeIcon = c.type === 'community' ? '<span class="codicon codicon-star"></span> '
      : c.type === 'team' ? '<span class="codicon codicon-git-pull-request"></span> '
      : isGroup ? '<span class="codicon codicon-organization"></span> ' : '';
    var unreadBadge = unread ? '<span class="gs-badge">' + (c.unread_count || '') + '</span>' : '';
    var mutedIcon = c.is_muted ? '<span class="gs-text-xs" title="Muted"><span class="codicon codicon-bell-slash"></span></span>' : '';
    var previewHtml = draft
      ? '<div class="chat-conv-preview gs-text-sm gs-truncate"><span class="draft-label">Draft:</span> ' + escapeHtml(draft.slice(0, 60)) + '</div>'
      : '<div class="chat-conv-preview gs-text-sm gs-text-muted gs-truncate">' + escapeHtml(preview.slice(0, 80)) + '</div>';
    return '<div class="gs-row-item chat-conv-item' + (unread ? ' chat-conv-unread' : '') + (c.is_muted ? ' chat-conv-muted' : '') + '" data-id="' + c.id + '" data-pinned="' + !!(c.pinned || c.pinned_at) + '"' + (!isGroup && other ? ' data-other-login="' + escapeHtml(other.login || '') + '"' : '') + '>' +
      '<img src="' + escapeHtml(avatar) + '" class="gs-avatar gs-avatar-md" style="' + (isGroup ? 'border-radius:8px' : '') + '" alt="">' +
      '<div class="gs-flex-1" style="min-width:0">' +
        '<div class="gs-flex gs-items-center gs-gap-4">' +
          '<span class="chat-conv-name gs-truncate">' + pin + typeIcon + escapeHtml(name) + '</span>' +
          mutedIcon +
          '<span class="gs-text-xs gs-text-muted gs-ml-auto gs-flex-shrink-0">' + time + '</span>' +
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
        '<button class="tr-btn tr-community-btn" data-slug="' + escapeHtml(r.owner + '/' + r.name) + '" title="Join Community (stargazers only)"><span class="codicon codicon-globe"></span></button>' +
        '<button class="tr-btn tr-team-btn" data-slug="' + escapeHtml(r.owner + '/' + r.name) + '" title="Join Team (contributors only)"><span class="codicon codicon-organization"></span></button>' +
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
  list.querySelectorAll(".tr-community-btn").forEach(function (btn) {
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      var slug = btn.dataset.slug;
      btn.disabled = true;
      btn.innerHTML = '<span class="codicon codicon-loading codicon-modifier-spin"></span>';
      vscode.postMessage({ type: "chat:joinCommunity", payload: { repoFullName: slug } });
    });
  });
  list.querySelectorAll(".tr-team-btn").forEach(function (btn) {
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      var slug = btn.dataset.slug;
      btn.disabled = true;
      btn.innerHTML = '<span class="codicon codicon-loading codicon-modifier-spin"></span>';
      vscode.postMessage({ type: "chat:joinTeam", payload: { repoFullName: slug } });
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
    ? SidebarChat.getConversationId && SidebarChat.getConversationId()
    : undefined;
  vscode.setState({
    navStack: navStack,
    chatMainTab: chatMainTab,
    currentTab: currentTab,
    chatConversationId: chatConvId || undefined,
    listScrollTop: _listScrollTop,
  });
}

function restoreState() {
  var state = vscode.getState();
  if (!state) return;
  if (state.chatMainTab) {
    chatMainTab = state.chatMainTab;
    currentTab = state.chatMainTab;
    document.querySelectorAll(".gs-main-tab").forEach(function(t) {
      t.classList.toggle("active", t.dataset.tab === chatMainTab);
    });
  }
  if (state.listScrollTop) {
    _listScrollTop = state.listScrollTop;
  }
  // Restore chat view if was open — ask provider to re-send conversation data
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
