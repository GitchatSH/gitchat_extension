// Notifications tab pane — rendered when user switches to the "Notifications" tab.
// Sibling of chat-content / friends-content / discover-content.

(function () {
  "use strict";

  // shared.js exposes `vscode` as a top-level const via acquireVsCodeApi().
  // Reuse — calling it twice throws.
  var vscodeApi = (typeof vscode !== "undefined") ? vscode : null;

  var state = {
    items: [],
    unread: 0,
    isActive: false,
  };

  var TYPE_META = {
    new_message:   { icon: "comment",      badge: "type-message" },
    mention:       { icon: "mention",      badge: "type-mention" },
    follow:        { icon: "person-add",   badge: "type-follow"  },
    wave:          { icon: "symbol-event", badge: "type-wave"    },
    repo_activity: { icon: "rocket",       badge: "type-repo"    },
  };

  function fmtTimeAgo(iso) {
    if (!iso) { return ""; }
    var t = new Date(iso).getTime();
    if (isNaN(t)) { return ""; }
    var diff = (Date.now() - t) / 1000;
    if (diff < 60)    { return Math.floor(diff) + "s"; }
    if (diff < 3600)  { return Math.floor(diff / 60) + "m"; }
    if (diff < 86400) { return Math.floor(diff / 3600) + "h"; }
    if (diff < 7 * 86400) { return Math.floor(diff / 86400) + "d"; }
    return Math.floor(diff / (7 * 86400)) + "w";
  }

  function bucket(iso) {
    if (!iso) { return "earlier"; }
    var t = new Date(iso).getTime();
    var now = new Date();
    var startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    var startOfYesterday = startOfToday - 24 * 3600 * 1000;
    if (t >= startOfToday) { return "today"; }
    if (t >= startOfYesterday) { return "yesterday"; }
    return "earlier";
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function describe(notif) {
    var meta = notif.metadata || {};
    var actor = notif.actor_name || notif.actor_login || "Someone";
    var actorTag = '<strong>' + escapeHtml(actor) + '</strong>';
    switch (notif.type) {
      case "mention":
        return { html: actorTag + " mentioned you", preview: meta.preview || "" };
      case "wave":
        return { html: actorTag + " waved at you", preview: "" };
      case "new_message":
        return { html: actorTag + " sent a message", preview: meta.preview || "" };
      case "follow":
        return { html: actorTag + " started following you", preview: "" };
      case "repo_activity": {
        // Handle both metadata shapes: WP10 BE-4 (repoFullName/eventType/title)
        // and legacy WP7 poll (repo_owner+repo_name/activity_type/activity_title).
        var repoFull = meta.repoFullName
          || (meta.repo_owner && meta.repo_name ? meta.repo_owner + "/" + meta.repo_name : null)
          || "a repo";
        var rawEvt = meta.eventType || meta.activity_type || "activity";
        var evtLabel = humanizeEvent(rawEvt);
        var title = meta.title || meta.activity_title || "";
        return {
          html: "<strong>" + escapeHtml(repoFull) + "</strong> · " + escapeHtml(evtLabel),
          preview: title,
        };
      }
      default:
        return { html: actorTag, preview: "" };
    }
  }

  function humanizeEvent(t) {
    var s = String(t || "");
    switch (s) {
      case "release":     return "new release";
      case "pr_merged":   return "PR merged";
      case "commit_main": return "commit to main";
      case "issue_opened":return "issue opened";
      default:            return s.replace(/_/g, " ");
    }
  }

  function avatarUrl(notif) {
    if (notif.actor_avatar_url) { return notif.actor_avatar_url; }
    if (notif.actor_login) { return "https://github.com/" + encodeURIComponent(notif.actor_login) + ".png?size=80"; }
    return "";
  }

  function renderItem(n) {
    var d = describe(n);
    var meta = TYPE_META[n.type] || { icon: "bell", badge: "" };
    var readClass = n.is_read ? "read" : "unread";
    var avatar = avatarUrl(n);
    var avatarHtml = avatar
      ? '<img class="notif-p-avatar" src="' + escapeHtml(avatar) + '" alt="">'
      : '<div class="notif-p-avatar"></div>';
    return (
      '<button class="notif-p-item ' + readClass + '" data-id="' + escapeHtml(n.id) + '">' +
        '<div class="notif-p-avatar-wrap">' +
          avatarHtml +
          '<div class="notif-p-type-badge ' + meta.badge + '">' +
            '<span class="codicon codicon-' + meta.icon + '"></span>' +
          '</div>' +
        '</div>' +
        '<div class="notif-p-item-body">' +
          '<div class="notif-p-item-title">' + d.html + '</div>' +
          (d.preview ? '<div class="notif-p-item-preview">' + escapeHtml(d.preview) + '</div>' : '') +
        '</div>' +
        '<span class="notif-p-item-time">' + escapeHtml(fmtTimeAgo(n.created_at)) + '</span>' +
      '</button>'
    );
  }

  function renderTabBadge() {
    var badge = document.getElementById("notif-tab-badge");
    if (!badge) { return; }
    badge.textContent = state.unread > 99 ? "99+" : String(state.unread);
    badge.setAttribute("data-count", String(state.unread));
    badge.style.display = state.unread > 0 ? "inline-flex" : "none";
  }

  function render() {
    renderTabBadge();

    var body = document.getElementById("notif-p-body");
    if (!body) { return; }

    if (state.items.length === 0) {
      body.innerHTML =
        '<div class="notif-p-empty">' +
          '<span class="codicon codicon-bell-slash"></span>' +
          '<div class="notif-p-empty-title">You\'re all caught up</div>' +
          '<div class="notif-p-empty-subtitle">No notifications yet</div>' +
        '</div>';
      return;
    }

    var groups = { today: [], yesterday: [], earlier: [] };
    for (var i = 0; i < state.items.length; i++) {
      groups[bucket(state.items[i].created_at)].push(state.items[i]);
    }

    var html = "";
    var labels = { today: "TODAY", yesterday: "YESTERDAY", earlier: "EARLIER" };
    var order = ["today", "yesterday", "earlier"];
    for (var g = 0; g < order.length; g++) {
      var items = groups[order[g]];
      if (items.length === 0) { continue; }
      html += '<div class="notif-p-group-label">' + labels[order[g]] + '</div>';
      for (var j = 0; j < items.length; j++) {
        html += renderItem(items[j]);
      }
    }

    body.innerHTML = html;

    Array.prototype.forEach.call(body.querySelectorAll(".notif-p-item"), function (el) {
      el.addEventListener("click", function () {
        var id = el.getAttribute("data-id");
        if (!vscodeApi) { return; }
        // Look up the full notification from state to branch on type.
        var notif = null;
        for (var k = 0; k < state.items.length; k++) {
          if (state.items[k].id === id) { notif = state.items[k]; break; }
        }
        if (notif && notif.type === "wave") {
          // WP8: tap wave row → respond via BE → open DM with sender.
          // Host falls back to createConversation if /waves/:id/respond missing.
          var waveId = (notif.metadata && notif.metadata.wave_id) || notif.id;
          var sender = notif.actor_login;
          if (sender) {
            vscodeApi.postMessage({
              type: "notifications:waveRespond",
              payload: { wave_id: waveId, sender_login: sender, notif_id: id }
            });
            return;
          }
        }
        vscodeApi.postMessage({ type: "notificationClicked", payload: { id: id } });
      });
    });
  }

  function showPane() {
    var pane = document.getElementById("notif-pane");
    if (!pane) { return; }
    // Hide every other tab pane / content sibling
    var siblings = ["chat-content", "chat-empty", "friends-content", "discover-content", "chat-pane-channels"];
    siblings.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) { el.style.display = "none"; }
    });
    var filterBar = document.getElementById("chat-filter-bar");
    if (filterBar) { filterBar.style.display = "none"; }

    pane.style.display = "flex";
    state.isActive = true;
    render();

    // Mark all seen on tab open (Linear pattern): clears badge but keeps per-item dots
    if (vscodeApi) { vscodeApi.postMessage({ type: "notificationDropdownOpened" }); }
  }

  function hidePane() {
    var pane = document.getElementById("notif-pane");
    if (pane) { pane.style.display = "none"; }
    state.isActive = false;
  }

  function bindTabSwitching() {
    // Listen to clicks on every main tab — fires AFTER explore.js's own handler
    // (because notifications-pane.js loads after explore.js in the HTML).
    document.querySelectorAll(".gs-main-tab").forEach(function (tab) {
      tab.addEventListener("click", function () {
        if (tab.dataset.tab === "notifications") {
          showPane();
        } else if (state.isActive) {
          hidePane();
        }
      });
    });
  }

  function bindActions() {
    var markAll = document.getElementById("notif-p-mark-all");
    if (markAll) {
      markAll.addEventListener("click", function () {
        if (vscodeApi) { vscodeApi.postMessage({ type: "notificationMarkAllRead" }); }
      });
    }
  }

  window.addEventListener("message", function (event) {
    var data = event.data;
    if (!data) { return; }
    if (data.type === "setNotifications") {
      state.items = Array.isArray(data.items) ? data.items : [];
      state.unread = typeof data.unread === "number" ? data.unread : 0;
      render();
      return;
    }
    if (data.type === "openNotificationsTab") {
      // External request (e.g. from gitchat.openNotifications command)
      var tab = document.querySelector('.gs-main-tab[data-tab="notifications"]');
      if (tab) { tab.click(); }
      return;
    }
  });

  function init() {
    bindTabSwitching();
    bindActions();
    renderTabBadge();
  }

  document.addEventListener("DOMContentLoaded", init);
  if (document.readyState !== "loading") { init(); }
})();
