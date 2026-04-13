// chat-panel.js — Combined Friends + Inbox with tabs
let friends = [];
let conversations = [];
var drafts = {};
let currentUser = null;
let activeTab = "inbox";
let searchQuery = "";
let inboxFilter = "all";
let contextMenuEl = null;
var typingUsers = {}; // { login: timeoutId }

function setCount(id, count) {
  var el = document.getElementById(id);
  if (el) { el.textContent = count > 0 ? "(" + count + ")" : ""; }
}

function updateTabCounts() {
  // Inbox: unread count from all conversations (DM + group)
  var inboxUnread = conversations.reduce(function(sum, c) {
    return sum + ((c.unread_count > 0 || c.is_unread) ? (c.unread_count || 1) : 0);
  }, 0);
  var inboxEl = document.getElementById("tab-inbox-count");
  if (inboxEl) { inboxEl.textContent = inboxUnread > 0 ? "(" + inboxUnread + ")" : ""; }

  // Friends: online/total
  var onlineCount = friends.filter(function(f) { return f.online; }).length;
  var totalCount = friends.length;
  var friendsEl = document.getElementById("tab-friends-count");
  if (friendsEl) { friendsEl.textContent = "(" + onlineCount + "/" + totalCount + ")"; }
}

// Tab switching
document.querySelectorAll(".tab").forEach(function(tab) {
  tab.addEventListener("click", function() {
    document.querySelectorAll(".tab").forEach(function(t) { t.classList.remove("active"); });
    tab.classList.add("active");
    activeTab = tab.dataset.tab;
    document.getElementById("search-bar").style.display = activeTab === "friends" ? "block" : "none";
    document.getElementById("filter-bar").style.display = activeTab === "inbox" ? "block" : "none";
    render();
  });
});

document.getElementById("new-chat").addEventListener("click", function() { doAction("newChat"); });
document.getElementById("search").addEventListener("input", function(e) { searchQuery = e.target.value.toLowerCase(); render(); });

// Settings dropdown
var settingsDropdown = document.getElementById("settings-dropdown");
document.getElementById("settings-btn").addEventListener("click", function(e) {
  e.stopPropagation();
  settingsDropdown.style.display = settingsDropdown.style.display === "none" ? "block" : "none";
});
document.addEventListener("click", function(e) {
  if (!e.target.closest(".settings-dropdown") && !e.target.closest("#settings-btn")) {
    settingsDropdown.style.display = "none";
  }
});
document.getElementById("setting-notifications").addEventListener("change", function() {
  doAction("updateSetting", { key: "notifications", value: this.checked });
});
document.getElementById("setting-sound").addEventListener("change", function() {
  doAction("updateSetting", { key: "sound", value: this.checked });
});
document.getElementById("setting-debug").addEventListener("change", function() {
  doAction("updateSetting", { key: "debug", value: this.checked });
});
document.getElementById("setting-signout").addEventListener("click", function() {
  doAction("signOut");
});
document.querySelectorAll(".filter-btn").forEach(function(btn) {
  btn.addEventListener("click", function() {
    document.querySelectorAll(".filter-btn").forEach(function(b) { b.classList.remove("active"); });
    btn.classList.add("active");
    inboxFilter = btn.dataset.filter;
    render();
  });
});
document.addEventListener("click", function() { if (contextMenuEl) { contextMenuEl.remove(); contextMenuEl = null; } });

// Show filter bar by default for inbox tab
document.getElementById("filter-bar").style.display = "flex";

// Signal to extension that webview JS is ready to receive messages
doAction("ready");

window.addEventListener("message", function(e) {
  var data = e.data;
  if (data.type === "setData") {
    friends = data.friends || [];
    conversations = data.conversations || [];
    drafts = data.drafts || {};
    currentUser = data.currentUser;
    render();
  } else if (data.type === "clearUnread") {
    var f = friends.find(function(fr) { return fr.login === data.login; });
    if (f) { f.unread = 0; }
    render();
  } else if (data.type === "friendTyping") {
    // Mark friend as typing, auto-clear after 5s
    var login = data.login;
    if (typingUsers[login]) { clearTimeout(typingUsers[login]); }
    typingUsers[login] = setTimeout(function() { delete typingUsers[login]; render(); }, 5000);
    render();
  } else if (data.type === "settings") {
    document.getElementById("setting-notifications").checked = data.showMessageNotifications !== false;
    document.getElementById("setting-sound").checked = data.messageSound === true;
    document.getElementById("setting-debug").checked = data.debugLogs === true;
  }
});

function render() {
  updateTabCounts();
  if (activeTab === "friends") { renderFriends(); }
  else { renderInbox(); }
}

// ===================== FRIENDS =====================
function renderFriends() {
  var container = document.getElementById("content");
  var empty = document.getElementById("empty");

  var filtered = friends;
  if (searchQuery) {
    filtered = friends.filter(function(f) {
      return f.login.toLowerCase().includes(searchQuery) || f.name.toLowerCase().includes(searchQuery);
    });
  }

  if (!filtered.length) {
    container.innerHTML = "";
    empty.style.display = "block";
    empty.textContent = searchQuery ? "No matches" : "No friends yet. Follow people to see them here!";
    return;
  }
  empty.style.display = "none";

  // Typing and unread friends bubble to top
  var typing = filtered.filter(function(f) { return typingUsers[f.login]; });
  var unread = filtered.filter(function(f) { return !typingUsers[f.login] && f.unread > 0; });
  var rest = filtered.filter(function(f) { return !typingUsers[f.login] && !f.unread; });

  var online = rest.filter(function(f) { return f.online; });
  var recent = rest.filter(function(f) { return !f.online && f.lastSeen > 0 && (Date.now() - f.lastSeen < 3600000); });
  var offline = rest.filter(function(f) { return !f.online && (f.lastSeen === 0 || Date.now() - f.lastSeen >= 3600000); });

  var html = "";
  if (typing.length) {
    html += typing.map(renderFriend).join("");
  }
  if (unread.length) {
    html += unread.map(renderFriend).join("");
  }
  if (online.length) {
    html += '<div class="gs-section-title">Online (' + online.length + ')</div>';
    html += online.map(renderFriend).join("");
  }
  if (recent.length) {
    html += '<div class="gs-section-title">Recently Active</div>';
    html += recent.map(renderFriend).join("");
  }
  if (offline.length) {
    html += '<div class="gs-section-title">Offline</div>';
    html += offline.map(renderFriend).join("");
  }

  container.innerHTML = html;

  container.querySelectorAll(".friend-item").forEach(function(el) {
    el.addEventListener("click", function() { doAction("openChat", { login: el.dataset.login }); });
  });
  container.querySelectorAll(".friend-profile-btn").forEach(function(btn) {
    btn.addEventListener("click", function(e) {
      e.stopPropagation();
      doAction("viewProfile", { login: btn.dataset.login });
    });
  });
}

function renderFriend(f) {
  var avatar = f.avatar_url || avatarUrl(f.login);
  var isTyping = !!typingUsers[f.login];
  var dot = f.online ? '<span class="gs-dot-online"></span>' : '<span class="gs-dot-offline"></span>';
  var status = isTyping ? '<span class="typing-status">typing...</span>' : (f.online ? "online" : (f.lastSeen > 0 ? timeAgo(new Date(f.lastSeen).toISOString()) + " ago" : ""));
  var unread = f.unread > 0 ? '<span class="gs-badge">' + f.unread + '</span>' : '';

  return '<div class="gs-list-item friend-item" data-login="' + escapeHtml(f.login) + '">' +
    '<img src="' + escapeHtml(avatar) + '" class="gs-avatar gs-avatar-md" alt="">' +
    '<div class="gs-flex-1" style="min-width:0">' +
      '<div class="gs-flex gs-items-center gs-gap-4">' +
        dot +
        '<span class="gs-truncate" style="font-weight:500">' + escapeHtml(f.name) + '</span>' +
        unread +
      '</div>' +
      '<div class="gs-text-xs gs-text-muted">' + escapeHtml(status) + '</div>' +
    '</div>' +
    '<button class="gs-btn-icon friend-profile-btn" data-login="' + escapeHtml(f.login) + '" title="View Profile"><span class="codicon codicon-comment"></span></button>' +
  '</div>';
}

// ===================== INBOX =====================
function renderInbox() {
  var container = document.getElementById("content");
  var empty = document.getElementById("empty");

  // Helper to detect group conversations
  function isGroupConv(c) {
    return c.type === "group" || c.is_group === true || (c.participants && c.participants.length > 2);
  }

  // Update filter counts
  var countAll = conversations.length;
  var countDirect = conversations.filter(function(c) { return !isGroupConv(c) && !c.is_request; }).length;
  var countGroup = conversations.filter(function(c) { return isGroupConv(c); }).length;
  var countRequests = conversations.filter(function(c) { return c.is_request; }).length;
  var countUnread = conversations.filter(function(c) { return c.unread_count > 0 || c.is_unread; }).length;

  setCount("count-all", countAll);
  setCount("count-direct", countDirect);
  setCount("count-group", countGroup);
  setCount("count-requests", countRequests);
  setCount("count-unread", countUnread);

  var filtered = conversations;
  if (inboxFilter === "unread") {
    filtered = conversations.filter(function(c) { return c.unread_count > 0 || c.is_unread; });
  } else if (inboxFilter === "direct") {
    filtered = conversations.filter(function(c) { return !isGroupConv(c) && !c.is_request; });
  } else if (inboxFilter === "group") {
    filtered = conversations.filter(function(c) { return isGroupConv(c); });
  } else if (inboxFilter === "requests") {
    filtered = conversations.filter(function(c) { return c.is_request; });
  }

  if (!filtered.length) {
    container.innerHTML = "";
    empty.style.display = "block";
    empty.textContent = inboxFilter === "all" ? "No conversations yet" : "No " + inboxFilter + " conversations";
    return;
  }
  empty.style.display = "none";

  filtered.sort(function(a, b) {
    // Pinned always first
    var aPinned = !!(a.pinned || a.pinned_at);
    var bPinned = !!(b.pinned || b.pinned_at);
    if (aPinned && !bPinned) { return -1; }
    if (!aPinned && bPinned) { return 1; }
    // Muted conversations go to bottom
    var aMuted = a.is_muted ? 1 : 0;
    var bMuted = b.is_muted ? 1 : 0;
    if (aMuted !== bMuted) { return aMuted - bMuted; }
    // Sort by most recent activity (like Telegram/WhatsApp)
    var dateA = new Date(a.last_message_at || a.updated_at || 0);
    var dateB = new Date(b.last_message_at || b.updated_at || 0);
    return dateB - dateA;
  });

  container.innerHTML = filtered.map(renderConversation).join("");

  container.querySelectorAll(".conv-item").forEach(function(el) {
    el.addEventListener("click", function() { doAction("openConversation", { conversationId: el.dataset.id }); });
    el.addEventListener("contextmenu", function(e) {
      e.preventDefault();
      showContextMenu(e, el.dataset.id, el.dataset.pinned === "true");
    });
  });
}

function renderConversation(c) {
  var convType = c.type || (c.is_group ? "group" : "direct");
  var isGroup = ["group", "community", "team"].indexOf(convType) !== -1 || c.is_group === true || (c.participants && c.participants.length > 2);
  var name, avatar, subtitle;

  if (convType === "community" || convType === "team") {
    var repoLabel = convType === "community" ? " · Community" : " · Team";
    name = c.group_name || (c.repo_full_name ? c.repo_full_name + repoLabel : (convType === "community" ? "Community" : "Team"));
    avatar = c.group_avatar_url || "";
    subtitle = c.repo_full_name || "";
  } else if (isGroup) {
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
  var draft = drafts[c.id] || "";
  var time = timeAgo(c.updated_at || c.last_message_at);
  var unread = (c.unread_count > 0 || c.is_unread);
  var pin = c.pinned || c.pinned_at ? '<span class="codicon codicon-pin"></span> ' : "";
  var typeIcon = "";
  if (convType === "community") {
    typeIcon = '<span class="codicon codicon-star" style="margin-right:3px;font-size:11px;opacity:0.8"></span>';
  } else if (convType === "team") {
    typeIcon = '<span class="codicon codicon-git-pull-request" style="margin-right:3px;font-size:11px;opacity:0.8"></span>';
  }

  if (isGroup && !avatar && c.participants && c.participants.length > 0) {
    avatar = c.participants[0].avatar_url || avatarUrl(c.participants[0].login || "");
  }

  var hasMentions = c.unread_mentions_count > 0;
  var hasReactions = c.unread_reactions_count > 0;
  var hasIndicators = hasMentions || hasReactions;
  // Telegram: if ❤️ or @ exist, show those instead of count badge
  var convIndicators = '';
  if (hasReactions) { convIndicators += '<span class="gs-badge-reaction"><span class="codicon codicon-heart"></span></span>'; }
  if (hasMentions) { convIndicators += '<span class="gs-badge-mention">@</span>'; }
  var badgeClass = 'gs-badge' + (c.is_muted ? ' gs-badge-muted' : '');
  var unreadBadge = (unread && !hasIndicators) ? '<span class="' + badgeClass + '">' + (c.unread_count || '') + '</span>' : '';
  var mutedIcon = c.is_muted ? '<span class="gs-text-xs" title="Muted"><span class="codicon codicon-bell-slash"></span></span>' : '';

  return '<div class="gs-list-item conv-item' + (unread ? ' conv-unread' : '') + (c.is_muted ? ' conv-muted' : '') + '" data-id="' + c.id + '" data-pinned="' + (c.pinned || c.pinned_at || false) + '">' +
    '<img src="' + escapeHtml(avatar) + '" class="gs-avatar gs-avatar-md" style="' + (isGroup ? 'border-radius:8px' : '') + '" alt="">' +
    '<div class="gs-flex-1" style="min-width:0">' +
      '<div class="gs-flex gs-items-center gs-gap-4">' +
        '<span class="conv-name gs-truncate">' + pin + typeIcon + escapeHtml(name) + '</span>' +
        mutedIcon +
        '<span class="gs-text-xs gs-text-muted gs-ml-auto gs-flex-shrink-0">' + time + '</span>' +
      '</div>' +
      (subtitle ? '<div class="gs-text-xs gs-text-muted">' + escapeHtml(subtitle) + '</div>' : '') +
      '<div class="conv-bottom-row">' +
        (draft
          ? '<div class="conv-preview gs-text-sm gs-truncate"><span class="draft-label">Draft:</span> ' + escapeHtml(draft.slice(0, 80)) + '</div>'
          : '<div class="conv-preview gs-text-sm gs-text-muted gs-truncate">' + escapeHtml(preview.slice(0, 80)) + '</div>') +
        (convIndicators || unreadBadge ? '<div class="conv-badges">' + convIndicators + unreadBadge + '</div>' : '') +
      '</div>' +
    '</div>' +
  '</div>';
}

function showContextMenu(e, convId, isPinned) {
  if (contextMenuEl) { contextMenuEl.remove(); }
  var menu = document.createElement("div");
  menu.className = "context-menu";
  menu.innerHTML =
    '<div class="context-menu-item" data-action="' + (isPinned ? 'unpin' : 'pin') + '">' + (isPinned ? 'Unpin' : 'Pin') + '</div>' +
    '<div class="context-menu-item" data-action="markRead">Mark as read</div>' +
    '<div class="context-menu-item context-menu-danger" data-action="deleteConversation">Delete</div>';
  menu.style.left = e.clientX + "px";
  menu.style.top = e.clientY + "px";
  document.body.appendChild(menu);
  contextMenuEl = menu;

  menu.querySelectorAll(".context-menu-item").forEach(function(item) {
    item.addEventListener("click", function(ev) {
      ev.stopPropagation();
      doAction(item.dataset.action, { conversationId: convId });
      menu.remove();
      contextMenuEl = null;
    });
  });
}
