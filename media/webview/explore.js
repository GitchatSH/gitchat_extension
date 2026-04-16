// explore.js — Unified Explore tabbed webview
// Depends on shared.js (loaded first): vscode, doAction, escapeHtml, formatCount, timeAgo, avatarUrl
// Depends on sidebar-chat.js (loaded second): window.SidebarChat (may not exist yet)

// ===================== HELPERS =====================
var _letterAvatarGradients = [
  'linear-gradient(135deg, #ff6b6b, #ee5a24)',
  'linear-gradient(135deg, #feca57, #ff9f43)',
  'linear-gradient(135deg, #48dbfb, #0abde3)',
  'linear-gradient(135deg, #ff9ff3, #f368e0)',
  'linear-gradient(135deg, #54a0ff, #2e86de)',
  'linear-gradient(135deg, #5f27cd, #341f97)',
  'linear-gradient(135deg, #01a3a4, #00b894)',
  'linear-gradient(135deg, #ff6348, #e17055)',
];
function buildLetterAvatar(name, size) {
  var letter = (name || '?').charAt(0).toUpperCase();
  var hash = 0;
  for (var i = 0; i < (name || '').length; i++) hash = ((hash << 5) - hash) + name.charCodeAt(i);
  var gradient = _letterAvatarGradients[Math.abs(hash) % _letterAvatarGradients.length];
  var fontSize = Math.round((size || 36) * 0.45);
  return '<div class="gs-letter-avatar" style="width:' + (size || 36) + 'px;height:' + (size || 36) + 'px;background:' + gradient + ';font-size:' + fontSize + 'px">' + escapeHtml(letter) + '</div>';
}

// ===================== GLOBAL STATE =====================
var currentTab = "chat";
var navStack = "list"; // "list" or "chat"

// ===================== SEARCH STATE =====================
var searchMode = false;
var previousActiveTab = "chat";
var searchDebounceTimer = null;

// ===================== CHAT STATE =====================
var chatFriends = [];
var chatMutualFriends = [];
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
var channelsLoaded = false;     // true after first setChannelData arrives — gates Communities join-filter accuracy
var starredRepos = [];          // StarredRepo[] from the host — source for Discovery Community
var starredReposError = false;  // true if the initial fetch failed
var starredReposLoading = true; // true until BE sends a non-stale response (or an error) — prevents empty-state flash on cold cache
var contributedRepos = [];      // ContributedRepo[] from the host — source for Discovery Teams
var contributedReposError = false; // true if the initial fetch failed
var contributedReposLoading = true; // true until BE sends a non-stale response (or an error) — prevents empty-state flash on cold cache
// Discover people search (API-backed) — searches users beyond the local follow list
var discoverSearchResults = null; // null = not searched; [] = 0 matches; Array<user> = matches
var discoverSearchLoading = false;
var discoverSearchError = false;
var discoverSearchDebounce = null;
var discoverSearchLastQuery = ""; // to drop stale responses

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
// devTrendingReposCache / devTrendingPeopleCache removed (issue #49 — Develop tab dead code)
var discoverOnlineNow = []; // WP8: non-mutual online users from GET /discover/online-now
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
      var placeholders = { chat: "Search messages...", friends: "Search friends...", discover: "Search people..." };
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
      starredReposLoading = true;
      contributedReposLoading = true;
      vscode.postMessage({ type: "fetchStarredRepos" });
      vscode.postMessage({ type: "fetchContributedRepos" });
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
        // Reset discover search state on every query change
        discoverSearchResults = null;
        discoverSearchError = false;
        if (discoverSearchDebounce) { clearTimeout(discoverSearchDebounce); discoverSearchDebounce = null; }
        if (chatSearchQuery && chatSearchQuery.trim().length >= 1) {
          discoverSearchLoading = true;
          discoverSearchLastQuery = chatSearchQuery;
          discoverSearchDebounce = setTimeout(function() {
            vscode.postMessage({ type: "discoverSearchUsers", payload: { query: chatSearchQuery } });
            discoverSearchDebounce = null;
          }, 300);
        } else {
          discoverSearchLoading = false;
        }
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
      discoverSearchResults = null;
      discoverSearchLoading = false;
      discoverSearchError = false;
      discoverSearchLastQuery = "";
      if (discoverSearchDebounce) { clearTimeout(discoverSearchDebounce); discoverSearchDebounce = null; }
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
    online.map(function(f) { return buildFriendRow(f, "online"); }).join("") ||
    '<div class="gs-empty gs-text-sm"><span class="codicon codicon-circle-slash"></span> No friends online</div>'
  );

  // Offline section
  html += buildAccordionSection("friends", "offline", "OFFLINE", offline.length, state.offline !== false, "offline",
    offline.map(function(f) { return buildFriendRow(f, "offline"); }).join("") ||
    '<div class="gs-empty gs-text-sm"><span class="codicon codicon-person"></span> No offline friends</div>'
  );

  // Not on GitChat (placeholder)
  html += buildAccordionSection("friends", "notongitchat", "NOT ON GITCHAT", 0, state.notongitchat === true, "notongitchat",
    '<div class="gs-empty gs-text-sm"><span class="codicon codicon-rocket"></span> Coming soon</div>'
  );

  container.innerHTML = html;
  bindAccordionHandlers("friends");
  bindFriendRowHandlers(container);
}

function buildAccordionSection(tab, key, title, count, expanded, colorClass, bodyHtml) {
  var hId = tab + "-header-" + key;
  var bId = tab + "-body-" + key;
  var collapsed = expanded ? "" : " collapsed";
  return '<div class="gs-accordion-section gs-accordion-section--' + tab + '-' + key + '">' +
    '<div class="gs-accordion-header' + collapsed + '" id="' + hId + '" data-accordion="' + tab + '-' + key + '" ' +
    'role="button" aria-expanded="' + expanded + '" aria-controls="' + bId + '" tabindex="0">' +
    '<span class="codicon codicon-chevron-down gs-accordion-chevron"></span>' +
    '<span class="gs-accordion-title gs-accordion-title--' + colorClass + '">' + title + (count > 0 ? ' (' + count + ')' : '') + '</span>' +
    '</div>' +
    '<div class="gs-accordion-body' + collapsed + '" id="' + bId + '" role="region" aria-labelledby="' + hId + '">' +
    bodyHtml +
    '</div></div>';
}

function hasDmConversation(login) {
  if (!login || !chatConversations) { return false; }
  for (var i = 0; i < chatConversations.length; i++) {
    var c = chatConversations[i];
    var other = c.other_user || {};
    if ((other.login || "").toLowerCase() === login.toLowerCase()) { return true; }
    var parts = c.participants || [];
    for (var j = 0; j < parts.length; j++) {
      if ((parts[j].login || "").toLowerCase() === login.toLowerCase()) { return true; }
    }
  }
  return false;
}

function buildFriendRow(friend, section) {
  var avatarClass = section === "offline" ? " friend-avatar--offline" : "";
  var dotHtml = section === "online" ? '<span class="gs-dot-online"></span>' : '';
  var lastSeen = section === "offline" && friend.lastSeen
    ? '<span class="gs-text-xs gs-text-muted">' + timeAgo(friend.lastSeen) + '</span>'
    : '';
  var login = friend.login || "";
  /* WP8 Wave: "Say hi" for no-convo friends commented out for release
  var hasConvo = hasDmConversation(login);
  var tail = hasConvo ? chevron : "Say hi" button;
  */
  var tail = '<span class="codicon codicon-chevron-right gs-text-muted" style="font-size:12px;opacity:0.5"></span>';
  return '<div class="friend-row gs-row-item" data-login="' + escapeHtml(login) + '">' +
    '<div class="conv-avatar-wrap">' +
    '<img class="gs-avatar gs-avatar-md' + avatarClass + '" src="' + (friend.avatar_url || avatarUrl(login)) + '" />' +
    dotHtml +
    '</div>' +
    '<div class="gs-flex-1" style="min-width:0">' +
      '<div class="gs-truncate">' + escapeHtml(friend.name || login) + '</div>' +
      '<div class="gs-text-xs gs-text-muted gs-truncate">@' + escapeHtml(login) + '</div>' +
    '</div>' +
    lastSeen +
    tail +
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
  /* WP8 Wave: "Say hi" button handlers commented out for release
  container.querySelectorAll(".discover-wave-btn").forEach(function(btn) { ... });
  */

  // Row click → open chat in sidebar
  container.querySelectorAll(".friend-row").forEach(function(row) {
    row.addEventListener("click", function() {
      vscode.postMessage({ type: "chatOpenDM", payload: { login: row.dataset.login } });
    });
    // Profile card hover on avatar
    var avatar = row.querySelector(".gs-avatar");
    if (avatar && typeof window.ProfileCard !== "undefined" && window.ProfileCard.bindTrigger) {
      window.ProfileCard.bindTrigger(avatar, row.dataset.login);
    }
  });
}

// ===================== ONBOARDING (WP3) =====================
function renderOnboardingOverlay() {
  // Don't render if already showing
  if (document.getElementById("gs-onboarding-overlay")) return;

  var html =
    '<div id="gs-onboarding-overlay">' +
      '<div class="gs-onboarding-glow">' +
        '<div class="gs-onboarding-card">' +
          '<div class="gs-onboarding-header">' +
            '<h3>Welcome to GitChat!</h3>' +
            '<p class="gs-onboarding-subtitle">Your social hub for developers, right where you code.</p>' +
          '</div>' +
          '<div class="gs-onboarding-sections">' +
            '<div class="gs-onboarding-row">' +
              '<div class="gs-onboarding-icon gs-onboarding-icon--people">' +
                '<span class="codicon codicon-person"></span>' +
              '</div>' +
              '<div>' +
                '<div class="gs-onboarding-label">People</div>' +
                '<div class="gs-onboarding-desc">See who you follow on GitHub, check who\'s online, and start DMs instantly.</div>' +
              '</div>' +
            '</div>' +
            '<div class="gs-onboarding-row">' +
              '<div class="gs-onboarding-icon gs-onboarding-icon--communities">' +
                '<span class="codicon codicon-comment-discussion"></span>' +
              '</div>' +
              '<div>' +
                '<div class="gs-onboarding-label">Communities</div>' +
                '<div class="gs-onboarding-desc">Join group chats around your favorite repos. Star a repo to discover its community.</div>' +
              '</div>' +
            '</div>' +
            '<div class="gs-onboarding-row">' +
              '<div class="gs-onboarding-icon gs-onboarding-icon--teams">' +
                '<span class="codicon codicon-organization"></span>' +
              '</div>' +
              '<div>' +
                '<div class="gs-onboarding-label">Teams</div>' +
                '<div class="gs-onboarding-desc">Collaborate with people who contribute to the same repos as you.</div>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div class="gs-onboarding-footer">' +
            '<button class="gs-btn gs-btn-primary gs-onboarding-cta">Start Exploring</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';

  document.body.insertAdjacentHTML("beforeend", html);

  var cta = document.querySelector(".gs-onboarding-cta");
  if (cta) {
    cta.addEventListener("click", function() {
      dismissOnboarding();
    });
  }
}

function dismissOnboarding() {
  var overlay = document.getElementById("gs-onboarding-overlay");
  if (!overlay) return;
  // Animate out before removing
  overlay.classList.add("gs-ob-dismissing");
  overlay.addEventListener("animationend", function handler(e) {
    // Only react to the overlay's own fadeout, not child animations
    if (e.target === overlay) {
      overlay.removeEventListener("animationend", handler);
      overlay.remove();
    }
  });
  vscode.postMessage({ type: "onboardingComplete" });
}

// ===================== DISCOVER TAB RENDERING =====================

function renderDiscover() {
  var container = document.getElementById("discover-content");
  if (!container) return;

  var state = getAccordionState("discover");
  var people = chatFriends || [];
  // Discovery Community = starred repos ∖ repos already joined as communities.
  // "Already joined" is derived from chatChannels (same list the Chat tab renders).
  var joinedCommunityRepoSet = buildJoinedCommunityRepoSet(chatChannels, chatConversations);
  var communities = (starredRepos || [])
    .filter(function(r) {
      var key = ((r.owner || "") + "/" + (r.name || "")).toLowerCase();
      return key && key !== "/" && !joinedCommunityRepoSet.has(key);
    })
    .map(starredRepoToDiscoverCommunity);
  // WP8: use BE-supplied non-mutual online users instead of mutual chatFriends
  var onlineNow = discoverOnlineNow.length > 0
    ? discoverOnlineNow.map(function(u) {
        return { login: u.login, name: u.name, avatar_url: u.avatarUrl, online: true };
      })
    : (chatFriends || []).filter(function(f) { return f.online; });

  // Apply search filter
  if (chatSearchQuery) {
    var q = chatSearchQuery.toLowerCase();
    people = people.filter(function(f) { return (f.login || "").toLowerCase().indexOf(q) !== -1 || (f.name || "").toLowerCase().indexOf(q) !== -1; });
    communities = communities.filter(function(c) { return (c.displayName || c.repoOwner + "/" + c.repoName || c.name || "").toLowerCase().indexOf(q) !== -1; });
    onlineNow = onlineNow.filter(function(f) { return (f.login || "").toLowerCase().indexOf(q) !== -1 || (f.name || "").toLowerCase().indexOf(q) !== -1; });

    // Merge API-backed user search results into the PEOPLE section (dedup by login).
    // Tag API users with _isSearchResult so clicking opens the profile panel instead
    // of trying to DM them directly — BE requires a GitHub follow before a DM is
    // allowed, so we route through the profile where the user can follow first.
    if (Array.isArray(discoverSearchResults) && discoverSearchResults.length > 0) {
      var seenLogins = {};
      people.forEach(function(f) { if (f.login) { seenLogins[f.login.toLowerCase()] = true; } });
      discoverSearchResults.forEach(function(u) {
        if (u && u.login && !seenLogins[u.login.toLowerCase()]) {
          seenLogins[u.login.toLowerCase()] = true;
          people.push(Object.assign({}, u, { _isSearchResult: true }));
        }
      });
    }
  }

  // Search empty state — only show after API has settled (not during loading)
  var apiHasSettled = !discoverSearchLoading && discoverSearchResults !== null;
  if (chatSearchQuery && apiHasSettled && people.length === 0 && communities.length === 0 && onlineNow.length === 0) {
    container.innerHTML = '<div class="gs-empty">No results for "' + escapeHtml(chatSearchQuery) + '"</div>';
    return;
  }

  var html = "";

  // Teams section — repos the user has contributed to, minus already-joined teams
  var joinedTeamRepoSet = buildJoinedTeamRepoSet(chatChannels, chatConversations);
  var teams = (contributedRepos || [])
    .filter(function(r) {
      var key = ((r.owner || "") + "/" + (r.name || "")).toLowerCase();
      return key && key !== "/" && !joinedTeamRepoSet.has(key);
    })
    .map(contributedRepoToDiscoverTeam);
  // teamsReady: wait for BOTH contributed repos AND chatConversations — the
  // Teams filter joins contributedRepos against joinedTeamRepoSet (derived from
  // chatConversations via buildJoinedTeamRepoSet). If we render before
  // chatConversations is populated, repos the user has already joined leak
  // into the list and then vanish once setChatData arrives (issue #87 part 2).
  var teamsReady = !contributedReposLoading && chatDataLoaded;
  var teamEmpty;
  if (contributedReposError) {
    teamEmpty = '<div class="gs-empty gs-text-sm"><span class="codicon codicon-warning"></span> Couldn\'t load contributed repos.</div>';
  } else if (!teamsReady) {
    teamEmpty = '<div class="gs-empty gs-text-sm"><span class="codicon codicon-loading codicon-modifier-spin"></span> Loading your teams…</div>';
  } else if ((contributedRepos || []).length === 0) {
    teamEmpty = '<div class="gs-empty gs-text-sm"><span class="codicon codicon-git-pull-request"></span> Contribute to repos to join their teams</div>';
  } else {
    teamEmpty = '<div class="gs-empty gs-text-sm"><span class="codicon codicon-check"></span> You\'ve joined teams for all your contributed repos</div>';
  }
  // Suppress row rendering (and suppress the header count) until teamsReady —
  // stale repos + empty joinedTeamRepoSet would otherwise paint already-joined
  // rows for a split-second before the filter catches up.
  html += buildAccordionSection("discover", "teams", "TEAMS", teamsReady ? teams.length : 0, state.teams === true, "default",
    (teamsReady ? teams.map(function(t) { return buildDiscoverTeamRow(t); }).join("") : "") || teamEmpty
  );

  // People section — empty state varies by mode: search-loading / search-empty / no-follows
  var peopleEmpty;
  if (chatSearchQuery && discoverSearchLoading) {
    peopleEmpty = '<div class="gs-empty gs-text-sm"><span class="codicon codicon-loading codicon-modifier-spin"></span> Searching…</div>';
  } else if (chatSearchQuery) {
    peopleEmpty = '<div class="gs-empty gs-text-sm"><span class="codicon codicon-search"></span> No people match "' + escapeHtml(chatSearchQuery) + '"</div>';
  } else {
    peopleEmpty = '<div class="gs-empty gs-text-sm"><span class="codicon codicon-person"></span> Follow people on GitHub to see them here</div>';
  }
  html += buildAccordionSection("discover", "people", "PEOPLE", people.length, state.people !== false, "default",
    people.map(function(f) { return buildDiscoverPersonRow(f); }).join("") || peopleEmpty
  );

  // Communities section
  // communitiesReady: wait for starred repos AND chatChannels AND chatConversations —
  // buildJoinedCommunityRepoSet reads both channels (repo channels the user joined)
  // and conversations (type="community"), so BOTH must be populated before the
  // filter is reliable. Otherwise already-joined communities flash in the list.
  var communitiesReady = !starredReposLoading && chatDataLoaded && channelsLoaded;
  var communityEmpty;
  if (starredReposError) {
    communityEmpty = '<div class="gs-empty gs-text-sm"><span class="codicon codicon-warning"></span> Couldn\'t load starred repos.</div>';
  } else if (!communitiesReady) {
    communityEmpty = '<div class="gs-empty gs-text-sm"><span class="codicon codicon-loading codicon-modifier-spin"></span> Loading your communities…</div>';
  } else if ((starredRepos || []).length === 0) {
    communityEmpty = '<div class="gs-empty gs-text-sm"><span class="codicon codicon-star"></span> Star repos on GitHub to discover communities</div>';
  } else {
    communityEmpty = '<div class="gs-empty gs-text-sm"><span class="codicon codicon-check"></span> You\'ve joined communities for all your starred repos</div>';
  }
  html += buildAccordionSection("discover", "communities", "COMMUNITIES", communitiesReady ? communities.length : 0, state.communities !== false, "default",
    (communitiesReady ? communities.map(function(c) { return buildDiscoverCommunityRow(c); }).join("") : "") || communityEmpty
  );

  // Online Now — mixed mutuals + one-way follows who are active right now.
  // Row rendering decides per-row whether to show Wave (non-mutual) or
  // chevron (mutual → normal DM via row click).
  html += buildAccordionSection("discover", "onlinenow", "ONLINE NOW", onlineNow.length, state.onlinenow !== false, "online",
    onlineNow.map(function(f) { return buildDiscoverOnlineRow(f); }).join("") ||
    '<div class="gs-empty gs-text-sm"><span class="codicon codicon-circle-outline"></span> No one online right now</div>'
  );

  container.innerHTML = html;
  bindAccordionHandlers("discover");
  bindDiscoverRowHandlers(container);
}

function buildDiscoverPersonRow(friend) {
  var login = friend.login || "";
  var dotHtml = friend.online ? '<span class="gs-dot-online"></span>' : '<span class="gs-dot-offline"></span>';
  var lastSeen = !friend.online && friend.lastSeen
    ? '<span class="gs-text-xs gs-text-muted">' + timeAgo(friend.lastSeen) + '</span>'
    : '';
  var searchAttr = friend._isSearchResult ? ' data-search-result="1"' : '';
  /* WP8 Wave: commented out for release — re-enable when wave ships
  var mutual = isMutualFriend(login);
  var tail = mutual && hasDmConversation(login) ? chevron : mutual ? "Say hi" : "Wave";
  */
  var tail = '<span class="codicon codicon-chevron-right gs-text-muted" style="font-size:12px;opacity:0.5"></span>';
  return '<div class="friend-row gs-row-item" data-login="' + escapeHtml(login) + '"' + searchAttr + '>' +
    '<div class="conv-avatar-wrap">' +
    '<img class="gs-avatar gs-avatar-md" src="' + (friend.avatar_url || avatarUrl(login)) + '" />' +
    dotHtml +
    '</div>' +
    '<div class="gs-flex-1" style="min-width:0">' +
      '<div class="gs-truncate">' + escapeHtml(friend.name || login) + '</div>' +
      '<div class="gs-text-xs gs-text-muted gs-truncate">@' + escapeHtml(login) + '</div>' +
    '</div>' +
    lastSeen +
    tail +
    '</div>';
}

// Build a Set of "owner/name" strings (lowercased) for communities the user
// has already joined. Used by the Discovery Community filter so starred repos
// that are already joined are hidden from the "discover" list.
function buildJoinedCommunityRepoSet(channels, conversations) {
  var set = new Set();
  function addKey(k) {
    if (k) set.add(String(k).toLowerCase());
  }
  if (Array.isArray(channels)) {
    for (var i = 0; i < channels.length; i++) {
      var c = channels[i];
      if (!c) continue;
      if (c.repoOwner && c.repoName) {
        addKey(c.repoOwner + "/" + c.repoName);
      } else if (c.repo_full_name) {
        addKey(c.repo_full_name);
      }
    }
  }
  if (Array.isArray(conversations)) {
    for (var j = 0; j < conversations.length; j++) {
      var conv = conversations[j];
      if (!conv || conv.type !== "community") continue;
      if (conv.repo_full_name) {
        addKey(conv.repo_full_name);
      } else if (conv.repoOwner && conv.repoName) {
        addKey(conv.repoOwner + "/" + conv.repoName);
      }
    }
  }
  return set;
}

// Build a Set of "owner/name" strings (lowercased) for teams the user
// has already joined. Mirrors buildJoinedCommunityRepoSet for team conversations.
function buildJoinedTeamRepoSet(channels, conversations) {
  var set = new Set();
  function addKey(k) {
    if (k) set.add(String(k).toLowerCase());
  }
  if (Array.isArray(conversations)) {
    for (var j = 0; j < conversations.length; j++) {
      var conv = conversations[j];
      if (!conv || conv.type !== "team") continue;
      if (conv.repo_full_name) {
        addKey(conv.repo_full_name);
      } else if (conv.repoOwner && conv.repoName) {
        addKey(conv.repoOwner + "/" + conv.repoName);
      }
    }
  }
  return set;
}

// Adapt a ContributedRepo into the shape buildDiscoverTeamRow expects.
function contributedRepoToDiscoverTeam(r) {
  return {
    repoOwner: r.owner,
    repoName: r.name,
    displayName: r.owner + "/" + r.name,
    avatarUrl: r.avatarUrl,
    description: r.description || "",
    commitCount: r.commitCount || 0,
    _source: "contributed"
  };
}

function buildDiscoverTeamRow(team) {
  var repoFullName = (team.repoOwner && team.repoName) ? team.repoOwner + "/" + team.repoName : (team.repo_full_name || team.name || "");
  var displayName = team.displayName || repoFullName;
  var avatar = team.avatarUrl || (team.repoOwner ? "https://github.com/" + team.repoOwner + ".png?size=36" : "");
  var desc = (team.description || "").trim();
  var subtitleHtml = desc
    ? '<div class="gs-text-xs gs-text-muted gs-truncate">' + escapeHtml(desc) + '</div>'
    : '<div class="gs-text-xs gs-text-muted gs-truncate">Contributor team</div>';
  return '<div class="friend-row gs-row-item discover-team-row" data-repo="' + escapeHtml(repoFullName) + '">' +
    '<img class="gs-avatar gs-avatar-md conv-avatar--square" src="' + escapeHtml(avatar) + '" alt="" />' +
    '<div class="gs-flex-1" style="min-width:0">' +
      '<div class="gs-truncate">' + escapeHtml(displayName) + '</div>' +
      subtitleHtml +
    '</div>' +
    '<button class="gs-btn gs-btn-outline discover-join-team-btn" style="flex-shrink:0">Join</button>' +
    '</div>';
}

// Adapt a StarredRepo into the shape buildDiscoverCommunityRow expects.
// subscriberCount is intentionally undefined — the community may not even
// exist yet in repo_channels. The row builder falls back to description.
function starredRepoToDiscoverCommunity(r) {
  return {
    repoOwner: r.owner,
    repoName: r.name,
    displayName: r.owner + "/" + r.name,
    avatarUrl: r.avatarUrl,
    description: r.description || "",
    subscriberCount: undefined,
    _source: "starred"
  };
}

function buildDiscoverCommunityRow(channel) {
  var isStarredSource = channel._source === "starred" || channel.subscriberCount == null;
  var repoFullName = (channel.repoOwner && channel.repoName) ? channel.repoOwner + "/" + channel.repoName : (channel.repo_full_name || channel.name || "");
  var displayName = channel.displayName || repoFullName;
  var avatar = channel.avatarUrl || (channel.repoOwner ? "https://github.com/" + channel.repoOwner + ".png?size=36" : "");
  var subtitleHtml;
  if (isStarredSource) {
    var desc = (channel.description || "").trim();
    subtitleHtml = desc
      ? '<div class="gs-text-xs gs-text-muted gs-truncate">' + escapeHtml(desc) + '</div>'
      : '<div class="gs-text-xs gs-text-muted gs-truncate">New community</div>';
  } else {
    var subscriberCount = channel.subscriberCount || 0;
    subtitleHtml = '<div class="gs-text-xs gs-text-muted gs-truncate">' + subscriberCount + ' subscribers</div>';
  }
  return '<div class="friend-row gs-row-item discover-community-row" data-repo="' + escapeHtml(repoFullName) + '">' +
    '<img class="gs-avatar gs-avatar-md conv-avatar--square" src="' + escapeHtml(avatar) + '" alt="" />' +
    '<div class="gs-flex-1" style="min-width:0">' +
      '<div class="gs-truncate">' + escapeHtml(displayName) + '</div>' +
      subtitleHtml +
    '</div>' +
    '<button class="gs-btn gs-btn-outline discover-join-btn" style="flex-shrink:0">Join</button>' +
    '</div>';
}

// Session-local set of users the current user has already waved at. Seeded
// from host if GET /waves/sent is provided, otherwise populated as the user
// clicks Wave. Prevents button flicker across re-renders. Only used for
// non-mutual rows — mutuals never show a Wave button.
var wavedSetThisSession = new Set();

// Check whether the target login is a strict mutual follow. Used to decide
// whether to show the WP8 Wave button on a row (non-mutuals only).
function isMutualFriend(login) {
  if (!login || !chatMutualFriends) { return false; }
  for (var i = 0; i < chatMutualFriends.length; i++) {
    if (chatMutualFriends[i].login === login) { return true; }
  }
  return false;
}


// Build a row in the Online Now section. `chatFriends` is the FOLLOWING
// list (one-way from me) which may include non-mutuals. Rows for mutual
// friends get a chevron → (row click opens DM). Non-mutual rows get the
// WP8 Wave button as the low-friction connect action.
function buildDiscoverOnlineRow(friend) {
  var login = friend.login || "";
  var mutual = isMutualFriend(login);
  var tail;
  if (mutual) {
    tail = '<span class="codicon codicon-chevron-right gs-text-muted" style="font-size:12px;opacity:0.5"></span>';
  } else {
    var waved = wavedSetThisSession.has(login);
    tail = waved
      ? '<button class="gs-btn gs-btn-outline" disabled>Waved ✓</button>'
      : '<button class="gs-btn gs-btn-outline discover-wave-btn" data-login="' + escapeHtml(login) + '">Wave</button>';
  }
  return '<div class="friend-row gs-row-item" data-login="' + escapeHtml(login) + '">' +
    '<div class="conv-avatar-wrap">' +
    '<img class="gs-avatar gs-avatar-md" src="' + (friend.avatar_url || avatarUrl(login)) + '" />' +
    '<span class="gs-dot-online"></span>' +
    '</div>' +
    '<span class="gs-flex-1 gs-truncate">' + escapeHtml(friend.name || login) + '</span>' +
    tail +
    '</div>';
}

function bindDiscoverRowHandlers(container) {
  // People/Online Now rows → open chat in sidebar (followed users) or profile panel
  // (search results — BE requires a GitHub follow before DMing is allowed, so we open
  // the profile and let the user follow from there).
  /* WP8 Wave: discover wave button handlers commented out for release
  container.querySelectorAll(".discover-wave-btn").forEach(function(btn) { ... });
  */

  container.querySelectorAll(".friend-row:not(.discover-community-row):not(.discover-team-row)").forEach(function(row) {
    if (!row.dataset.login) return;
    row.addEventListener("click", function() {
      if (row.dataset.searchResult === "1") {
        if (window.ProfileScreen && window.ProfileScreen.show) {
          window.ProfileScreen.show(row.dataset.login);
        }
      } else {
        vscode.postMessage({ type: "chatOpenDM", payload: { login: row.dataset.login } });
      }
    });
    var avatar = row.querySelector(".gs-avatar");
    if (avatar && typeof window.ProfileCard !== "undefined" && window.ProfileCard.bindTrigger) {
      window.ProfileCard.bindTrigger(avatar, row.dataset.login);
    }
  });
  // Community rows → join (WP5 handler)
  container.querySelectorAll(".discover-community-row").forEach(function(row) {
    row.addEventListener("click", function() {
      vscode.postMessage({ type: "chat:joinCommunity", payload: { type: "community", repoFullName: row.dataset.repo } });
    });
  });
  // Join buttons (stopPropagation + optimistic update)
  container.querySelectorAll(".discover-join-btn").forEach(function(btn) {
    btn.addEventListener("click", function(e) {
      e.stopPropagation();
      var row = btn.closest(".discover-community-row");
      if (row) {
        btn.textContent = "Joined";
        btn.disabled = true;
        vscode.postMessage({ type: "chat:joinCommunity", payload: { type: "community", repoFullName: row.dataset.repo } });
      }
    });
  });
  // Team rows → join (WP5D handler)
  container.querySelectorAll(".discover-team-row").forEach(function(row) {
    row.addEventListener("click", function() {
      vscode.postMessage({ type: "chat:joinTeam", payload: { type: "team", repoFullName: row.dataset.repo } });
    });
  });
  // Join team buttons (stopPropagation + optimistic update)
  container.querySelectorAll(".discover-join-team-btn").forEach(function(btn) {
    btn.addEventListener("click", function(e) {
      e.stopPropagation();
      var row = btn.closest(".discover-team-row");
      if (row) {
        btn.textContent = "Joined";
        btn.disabled = true;
        vscode.postMessage({ type: "chat:joinTeam", payload: { type: "team", repoFullName: row.dataset.repo } });
      }
    });
  });
  // Wave buttons in Online Now → POST /waves via host handler
  container.querySelectorAll(".discover-wave-btn").forEach(function(btn) {
    btn.addEventListener("click", function(e) {
      e.stopPropagation();
      var login = btn.getAttribute("data-login");
      if (!login || wavedSetThisSession.has(login)) return;
      btn.disabled = true;
      btn.textContent = "sending…";
      vscode.postMessage({ type: "discover:wave", payload: { login: login } });
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
    return c.type === "group" || c.type === "community" || c.type === "team" || c.is_group === true || (c.participants && c.participants.length > 2);
  }

  updateChatFilterCounts();

  var filtered = chatConversations;
  if (chatFilter === "dm") { filtered = filtered.filter(function(c) { return c.type === "dm" || c.type === "direct" || (!c.type && !c.is_group); }); }
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
      var typeMap = { dm: "dm", group: "group", community: "community", team: "team" };
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
          cAvatarHtml = cAvatar
            ? '<img src="' + escapeHtml(cAvatar) + '" class="gs-avatar gs-avatar-md conv-avatar--square" alt="">'
            : buildLetterAvatar(c.group_name || 'G', 36);
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
  var dm = chatConversations.filter(function(c) { return c.type === "dm" || c.type === "direct" || (!c.type && !c.is_group); }).length;
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
  // Try other_user first (always present in conversation list), then participants
  var otherLogin = conv.other_user ? conv.other_user.login : null;
  if (!otherLogin && conv.participants) {
    var p = conv.participants.find(function(p) { return p.login !== chatCurrentUser; });
    if (p) otherLogin = p.login;
  }
  if (!otherLogin) return null;
  // Check other_user.online directly if available
  if (conv.other_user && conv.other_user.online !== undefined) {
    return conv.other_user.online ? "online" : "offline";
  }
  // Fallback: check chatFriends
  var friend = chatFriends.find(function(f) { return f.login === otherLogin; });
  return friend ? (friend.online ? "online" : "offline") : "offline";
}

function renderChatConversation(c) {
  var isGroup = c.type === "group" || c.type === "community" || c.type === "team" || c.is_group === true || (c.participants && c.participants.length > 2);
  var name, avatar, subtitle, other;
  if (isGroup) {
    name = c.group_name || "Group Chat";
    avatar = c.group_avatar_url || "";
    // Community/Team: fallback to repo owner avatar
    if (!avatar && c.repo_full_name) {
      var owner = c.repo_full_name.split("/")[0];
      if (owner) avatar = "https://github.com/" + owner + ".png?size=36";
    }
    var memberCount = (c.participants && c.participants.length) || 0;
    subtitle = c.type === "community" ? memberCount + " subscribers" : memberCount + " members";
  } else {
    other = c.other_user;
    if (!other) { return ""; }
    name = other.name || other.login;
    avatar = other.avatar_url || avatarUrl(other.login || "");
    subtitle = "";
  }
  var preview = c.last_message_preview || c.last_message_text || (c.last_message && (c.last_message.body || c.last_message.content)) || "";
  var draft = chatDrafts[c.id] || "";
  var time = timeAgo(c.last_message_at || c.updated_at);
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

  // Stack avatar handled below in avatarHtml
  var hasMentions = c.unread_mentions_count > 0;
  var hasReactions = c.unread_reactions_count > 0;
  var hasIndicators = hasMentions || hasReactions;
  var convIndicators = '';
  if (hasReactions) { convIndicators += '<span class="gs-badge-reaction"><span class="codicon codicon-smiley"></span></span>'; }
  if (hasMentions) { convIndicators += '<span class="gs-badge-mention">@</span>'; }
  var badgeClass = 'gs-badge' + (c.is_muted ? ' gs-badge-muted' : '');
  var unreadBadge = (unread && !hasIndicators) ? '<span class="' + badgeClass + '">' + (c.unread_count || '') + '</span>' : '';
  var mutedIcon = c.is_muted ? '<span class="gs-text-xs" title="Muted"><span class="codicon codicon-bell-slash"></span></span>' : '';
  var previewHtml = draft
    ? '<div class="conv-preview gs-text-sm gs-truncate"><span class="draft-label">Draft:</span> ' + escapeHtml(draft.slice(0, 60)) + '</div>'
    : '<div class="conv-preview gs-text-sm gs-text-muted gs-truncate">' + escapeHtml(preview.slice(0, 80)) + '</div>';

  // Avatar HTML — DM gets online dot wrapper, group/community/team gets square shape
  var avatarHtml;
  if (isGroup) {
    avatarHtml = avatar
      ? '<img src="' + escapeHtml(avatar) + '" class="gs-avatar gs-avatar-md conv-avatar--square" alt="">'
      : buildLetterAvatar(c.group_name || 'G', 36);
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

  var badgesHtml = (convIndicators || unreadBadge)
    ? '<span class="conv-badges">' + convIndicators + unreadBadge + '</span>'
    : '';

  return '<div class="gs-row-item conv-item' + (unread ? ' conv-unread' : '') + (c.is_muted ? ' conv-muted' : '') + '" data-id="' + c.id + '" data-pinned="' + !!(c.pinned || c.pinned_at) + '"' + (!isGroup && other ? ' data-other-login="' + escapeHtml(other.login || '') + '"' : '') + '>' +
    avatarHtml +
    '<div class="gs-flex-1" style="min-width:0">' +
      '<div class="gs-flex gs-items-center gs-gap-4">' +
        '<span class="conv-name gs-truncate">' + typeIcon + escapeHtml(name) + '</span>' +
        mutedIcon +
        '<span class="gs-text-xs gs-text-muted gs-ml-auto gs-flex-shrink-0">' + pin + time + '</span>' +
      '</div>' +
      (subtitle ? '<div class="gs-text-xs gs-text-muted">' + escapeHtml(subtitle) + '</div>' : '') +
      '<div class="conv-bottom-row">' + previewHtml + badgesHtml + '</div>' +
    '</div>' +
  '</div>';
}

function showConfirmModal(message, onConfirm) {
  var existing = document.querySelector('.gs-confirm-overlay');
  if (existing) existing.remove();

  var overlay = document.createElement('div');
  overlay.className = 'gs-confirm-overlay';
  overlay.innerHTML =
    '<div class="gs-confirm-modal">' +
      '<div class="gs-confirm-body">' + escapeHtml(message) + '</div>' +
      '<div class="gs-confirm-actions">' +
        '<button class="gs-btn gs-confirm-cancel">Cancel</button>' +
        '<button class="gs-btn gs-btn-primary gs-confirm-ok">Unpin</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);

  overlay.querySelector('.gs-confirm-ok').addEventListener('click', function () { overlay.remove(); onConfirm(); });
  overlay.querySelector('.gs-confirm-cancel').addEventListener('click', function () { overlay.remove(); });
  overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
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
      var action = item.dataset.action;
      menu.remove();
      chatContextMenuEl = null;
      if (action === "unpin") {
        showConfirmModal("Unpin this conversation?", function() {
          doAction("unpin", { conversationId: convId });
        });
      } else {
        doAction(action, { conversationId: convId });
      }
    });
  });
}


// ===================== MESSAGE HANDLER =====================
window.addEventListener("message", function(e) {
  var data = e.data;

  // Route chat: messages to SidebarChat
  if (data.type && data.type.indexOf("chat:") === 0) {
    if (data.type === "chat:joinedConversation") {
      // Remove-on-join: when a community is joined, optimistically add a
      // synthetic conversation so buildJoinedCommunityRepoSet() picks it up
      // and the row drops out of Discovery Community on the next render.
      // The real conversations refresh (fetchChatData etc.) will replace this
      // synthetic entry shortly after.
      if ((data.convType === "community" || data.convType === "team") && data.repoFullName) {
        var key = String(data.repoFullName).toLowerCase();
        var alreadyInConvs = (chatConversations || []).some(function(c) {
          return c && c.type === data.convType && c.repo_full_name && String(c.repo_full_name).toLowerCase() === key;
        });
        if (!alreadyInConvs) {
          chatConversations = (chatConversations || []).concat([{
            id: data.conversationId,
            type: data.convType,
            repo_full_name: data.repoFullName,
            _optimistic: true
          }]);
        }
        if (chatMainTab === "discover") renderDiscover();
      }
      // Re-enable any spinning join buttons for this repo (Trending cards)
      document.querySelectorAll(".tr-community-btn, .tr-team-btn").forEach(function(btn) {
        if (btn.dataset.slug === data.repoFullName) {
          btn.disabled = false;
          var isCommunity = btn.classList.contains("tr-community-btn");
          btn.innerHTML = '<span class="codicon codicon-' + (isCommunity ? 'globe' : 'organization') + '"></span>';
        }
      });
      // Discover tab: keep the "Joined" optimistic state (row will navigate away anyway)
      pushChatView(data.conversationId);
      return;
    }
    if (data.type === "chat:joinError") {
      // Re-enable the spinning button and briefly show error icon (Trending cards)
      document.querySelectorAll(".tr-community-btn, .tr-team-btn").forEach(function(btn) {
        if (btn.dataset.slug === data.repoFullName) {
          btn.disabled = false;
          var isCommunity = btn.classList.contains("tr-community-btn");
          btn.innerHTML = '<span class="codicon codicon-' + (isCommunity ? 'globe' : 'organization') + '"></span>';
        }
      });
      // Discover tab: revert optimistic "Joined" → "Join" on the matching row
      document.querySelectorAll(".discover-join-btn").forEach(function(btn) {
        var row = btn.closest(".discover-community-row");
        if (row && row.dataset.repo === data.repoFullName) {
          btn.disabled = false;
          btn.textContent = "Join";
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

  // Show ProfileCard from extension (notification clicks, etc.)
  // WP8: receive non-mutual online users from BE
  if (data.type === "setOnlineNow" && Array.isArray(data.users)) {
    discoverOnlineNow = data.users;
    if (chatMainTab === "discover") { renderDiscover(); }
    return;
  }

  if (data.type === "showProfileCard" && data.login && window.ProfileScreen) {
    window.ProfileScreen.show(data.login);
    return;
  }

  // Handle wave result from host → update the originating row
  if (data.type === "discoverWaveResult") {
    var waveLogin = data.login;
    var waveOk = !!data.success;
    var row = document.querySelector('.friend-row[data-login="' + (waveLogin || "").replace(/"/g, "") + '"]');
    var btn = row ? row.querySelector(".discover-wave-btn") : null;
    if (waveOk) {
      wavedSetThisSession.add(waveLogin);
      if (btn) {
        btn.classList.remove("discover-wave-btn");
        btn.disabled = true;
        btn.textContent = "Waved ✓";
      }
    } else if (btn) {
      btn.disabled = false;
      btn.textContent = "Wave";
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
      chatMutualFriends = data.mutualFriends || [];
      chatConversations = data.conversations || [];
      chatCurrentUser = data.currentUser;
      if (data.currentUser) window.__gsChatCurrentUser = data.currentUser;
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
    case "discoverSearchUsersResult":
      // Drop stale responses (user may have typed more since the request went out)
      if (typeof data.query === "string" && data.query === discoverSearchLastQuery) {
        discoverSearchResults = Array.isArray(data.users) ? data.users : [];
        discoverSearchLoading = false;
        discoverSearchError = false;
        if (chatMainTab === "discover") { renderDiscover(); }
      }
      break;
    case "discoverSearchUsersError":
      if (typeof data.query === "string" && data.query === discoverSearchLastQuery) {
        discoverSearchResults = [];
        discoverSearchLoading = false;
        discoverSearchError = true;
        if (chatMainTab === "discover") { renderDiscover(); }
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

    // Hydrate per-type notification toggles from BE inappPrefs
    case "notificationPrefs": {
      var prefs = data.prefs || {};
      var byKey = {
        "setting-noti-dnd":     prefs.disabled === true,
        "setting-noti-mention": prefs.mention !== false,       // default ON
        "setting-noti-wave":    prefs.wave !== false,
        "setting-noti-follow":  prefs.follow !== false,
        "setting-noti-repo":    prefs.repo_activity !== false,
      };
      Object.keys(byKey).forEach(function(id) {
        var el = document.getElementById(id);
        if (el) { el.checked = byKey[id]; }
      });
      break;
    }

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

    // Develop tab handlers removed (issue #49 — dead code, DOM targets no longer exist)

    // Develop: Channels
    case "setChannelData":
      devChannelsList = data.channels || [];
      chatChannels = data.channels || [];
      channelsLoaded = true;
      if (chatMainTab === "discover") renderDiscover();
      else devRenderChannels();
      break;

    // Discovery Community: user's starred GitHub repos
    case "setStarredReposData":
      starredRepos = Array.isArray(data.repos) ? data.repos : [];
      starredReposError = !!data.error;
      // Loading stays true only while BE indicates the payload is stale (cache filler).
      // Fresh payload (stale=false) or error payload (error=true) both end the loading state.
      starredReposLoading = !!data.stale && !data.error;
      if (chatMainTab === "discover") renderDiscover();
      break;

    // Discovery Teams: repos the user has contributed to
    case "setContributedReposData":
      contributedRepos = Array.isArray(data.repos) ? data.repos : [];
      contributedReposError = !!data.error;
      // Loading stays true only while BE indicates the payload is stale (cache filler).
      // Fresh payload (stale=false) or error payload (error=true) both end the loading state.
      contributedReposLoading = !!data.stale && !data.error;
      if (chatMainTab === "discover") renderDiscover();
      break;

    case "removeConversation": {
      var rmId = data.conversationId;
      if (rmId) {
        devChatConversations = devChatConversations.filter(function(c) { return c.id !== rmId; });
        var rmEl = document.querySelector('.conv-item[data-id="' + rmId + '"], .chat-conv-item[data-id="' + rmId + '"]');
        if (rmEl) rmEl.remove();
      }
      break;
    }

    case "mutualFriendsData":
      chatMutualFriends = data.mutualFriends || [];
      if (typeof SidebarChat !== 'undefined') {
        if (SidebarChat.handleEditMembers && SidebarChat.handleEditMembers(chatMutualFriends)) {
          // Handled by edit members modal
        } else if (SidebarChat.showNewGroupPanel) {
          SidebarChat.showNewGroupPanel(chatMutualFriends, devChatCurrentUser || chatCurrentUser);
        }
      }
      break;

    case "groupAvatarPicked": {
      var overlay = document.querySelector('.gs-sc-newchat-overlay');
      if (overlay && overlay._handleAvatarPicked) {
        overlay._handleAvatarPicked(data.dataUri);
      }
      break;
    }

    // Develop: Chat data (with drafts)
    case "setChatDataDev":
      devChatFriends = data.friends || [];
      chatMutualFriends = data.mutualFriends || [];
      devChatConversations = data.conversations || [];
      devChatCurrentUser = data.currentUser;
      if (data.currentUser) window.__gsChatCurrentUser = data.currentUser;
      devChatDrafts = data.drafts || {};
      devRenderChat();
      break;

    // WP3: Onboarding
    case "showOnboarding":
      // Pop out of chat detail view if active
      if (navStack === "chat") {
        navStack = "list";
        var obNav = document.getElementById("gs-nav");
        if (obNav) { obNav.classList.remove("chat-active"); }
        var obMainTabs2 = document.getElementById("gs-main-tabs");
        if (obMainTabs2) { obMainTabs2.style.display = ""; }
        var obSearchBar2 = document.getElementById("gs-search-bar");
        if (obSearchBar2) { obSearchBar2.style.display = ""; }
        if (typeof SidebarChat !== "undefined" && SidebarChat.close) {
          SidebarChat.close();
        }
      }
      // Switch to Discover tab
      document.querySelectorAll(".gs-main-tab").forEach(function(t) { t.classList.remove("active"); });
      var discoverTab = document.querySelector('.gs-main-tab[data-tab="discover"]');
      if (discoverTab) { discoverTab.classList.add("active"); }
      chatMainTab = "discover";
      currentTab = "discover";

      var obFilterBar = document.getElementById("chat-filter-bar");
      var obChannelsPane = document.getElementById("chat-pane-channels");
      var obChatContent = document.getElementById("chat-content");
      var obChatEmpty = document.getElementById("chat-empty");
      var obFriendsContent = document.getElementById("friends-content");
      var obDiscoverContent = document.getElementById("discover-content");
      if (obFilterBar) { obFilterBar.style.display = "none"; }
      if (obChannelsPane) { obChannelsPane.style.display = "none"; }
      if (obChatContent) { obChatContent.style.display = "none"; }
      if (obChatEmpty) { obChatEmpty.style.display = "none"; }
      if (obFriendsContent) { obFriendsContent.style.display = "none"; }
      if (obDiscoverContent) { obDiscoverContent.style.display = "flex"; }

      renderDiscover();
      renderOnboardingOverlay();
      break;

    // WP3: Switch to Chat tab (returning user)
    case "switchToChat":
      // Pop out of chat detail view if active
      if (navStack === "chat") {
        navStack = "list";
        var scNav = document.getElementById("gs-nav");
        if (scNav) { scNav.classList.remove("chat-active"); }
        var scMainTabs = document.getElementById("gs-main-tabs");
        if (scMainTabs) { scMainTabs.style.display = ""; }
        var scSearchBar = document.getElementById("gs-search-bar");
        if (scSearchBar) { scSearchBar.style.display = ""; }
        if (typeof SidebarChat !== "undefined" && SidebarChat.close) {
          SidebarChat.close();
        }
      }
      document.querySelectorAll(".gs-main-tab").forEach(function(t) { t.classList.remove("active"); });
      var chatTab = document.querySelector('.gs-main-tab[data-tab="chat"]');
      if (chatTab) { chatTab.classList.add("active"); }
      chatMainTab = "chat";
      currentTab = "chat";

      var scFilterBar = document.getElementById("chat-filter-bar");
      var scChannelsPane = document.getElementById("chat-pane-channels");
      var scChatContent = document.getElementById("chat-content");
      var scFriendsContent = document.getElementById("friends-content");
      var scDiscoverContent = document.getElementById("discover-content");
      if (scFilterBar) { scFilterBar.style.display = "flex"; }
      if (scChannelsPane) { scChannelsPane.style.display = "none"; }
      if (scChatContent) { scChatContent.style.display = ""; }
      if (scFriendsContent) { scFriendsContent.style.display = "none"; }
      if (scDiscoverContent) { scDiscoverContent.style.display = "none"; }
      chatSubTab = "inbox";
      renderChat();
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
      if (!avatar && c.repo_full_name) {
        var owner = c.repo_full_name.split('/')[0];
        if (owner) avatar = 'https://github.com/' + owner + '.png?size=36';
      }
      subtitle = c.type === 'community' ? (c.participants && c.participants.length || 0) + ' subscribers' : (c.participants && c.participants.length || 0) + ' members';
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
    var time = devChatTimeAgo(c.last_message_at || c.updated_at);
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

// devRenderRepos, devRenderPeople, devRenderMyRepos + people search/filter
// removed (issue #49 — Develop tab dead code, DOM targets no longer exist)

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
    if (window.ProfileScreen && login) {
      window.ProfileScreen.show(login);
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

// Per-type notification preferences (persisted to BE via inappPrefs)
// Mapping: checkbox CHECKED → BE stores `true` for that key.
//   mention/wave/follow/repo_activity: true = enabled (default), false = opt-out
//   disabled: true = DND on, false = DND off
var NOTI_PREF_KEYS = [
  ["setting-noti-dnd",     "disabled"],
  ["setting-noti-mention", "mention"],
  ["setting-noti-wave",    "wave"],
  ["setting-noti-follow",  "follow"],
  ["setting-noti-repo",    "repo_activity"],
];
NOTI_PREF_KEYS.forEach(function(pair) {
  var el = document.getElementById(pair[0]);
  if (!el) return;
  el.addEventListener("change", function() {
    doAction("updateNotificationPref", { key: pair[1], value: this.checked });
  });
});

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
  // Fetch fresh mutual friends before showing modal
  doAction("fetchMutualFriends");
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

  // Switch panes to match restored tab (HTML default is Chat; other tabs need
  // their content pane shown + data fetched via the tab click handler).
  if (chatMainTab !== "chat" && (state.navStack !== "chat" || !state.chatConversationId)) {
    var targetTab = document.querySelector('.gs-main-tab[data-tab="' + chatMainTab + '"]');
    if (targetTab) { targetTab.click(); }
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
