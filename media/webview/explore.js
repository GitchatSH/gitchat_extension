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
  document.querySelectorAll(".gs-chip").forEach(function(chip) {
    chip.addEventListener("click", function() {
      document.querySelectorAll(".gs-chip").forEach(function(c) { c.classList.remove("active"); });
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
// Refresh buttons
document.getElementById("trending-repos-refresh").addEventListener("click", function(e) { e.stopPropagation(); doAction("refreshTrendingRepos"); });
document.getElementById("trending-people-refresh").addEventListener("click", function(e) { e.stopPropagation(); doAction("refreshTrendingPeople"); });
document.getElementById("feed-repos-refresh").addEventListener("click", function(e) { e.stopPropagation(); doAction("refreshMyRepos"); });

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

doAction("ready");
