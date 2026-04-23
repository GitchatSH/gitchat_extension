// Notifications tab pane — rendered when user switches to the "Notifications" tab.
// Sibling of chat-content / friends-content / discover-content.

(function () {
  "use strict";

  var vscodeApi = (typeof vscode !== "undefined") ? vscode : null;

  var state = {
    items: [],
    unread: 0,
    isActive: false,
  };

  var TYPE_META = {
    new_message:   { icon: "comment",      badge: "type-message" },
    mention:       { icon: "mention",      badge: "type-mention" },
    follow:        { icon: "heart",          badge: "type-follow"  },
    wave:          { icon: "symbol-event", badge: "type-wave"    },
    repo_activity: { icon: "rocket",       badge: "type-repo"    },
  };

  // ─── Helpers ───────────────────────────────────────────────────────────────

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

  // ─── Rendering ─────────────────────────────────────────────────────────────

  function renderItem(n) {
    var d = describe(n);
    var meta = TYPE_META[n.type] || { icon: "bell", badge: "" };
    var isUnread = !n.is_read;
    var avatar = avatarUrl(n);
    var avatarHtml = avatar
      ? '<img class="notif-p-avatar" src="' + escapeHtml(avatar) + '" alt="">'
      : '<div class="notif-p-avatar"></div>';

    return (
      '<button class="notif-p-item' + (isUnread ? ' unread' : '') + '" data-id="' + escapeHtml(n.id) + '">' +
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
        '<div class="notif-p-item-tail">' +
          '<span class="notif-p-item-time">' + escapeHtml(fmtTimeAgo(n.created_at)) + '</span>' +
          (isUnread ? '<span class="notif-p-unread-dot"></span>' : '') +
        '</div>' +
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

    // Split into NEW (unread) and EARLIER (read)
    var unreadItems = [];
    var readItems = [];
    for (var i = 0; i < state.items.length; i++) {
      if (state.items[i].is_read) {
        readItems.push(state.items[i]);
      } else {
        unreadItems.push(state.items[i]);
      }
    }

    var html = "";

    // NEW section
    if (unreadItems.length > 0) {
      html += '<div class="notif-p-section-header">' +
        '<span class="notif-p-section-label">NEW</span>' +
        '<button class="notif-p-mark-all" id="notif-p-mark-all">Mark all read</button>' +
      '</div>';
      for (var u = 0; u < unreadItems.length; u++) {
        html += renderItem(unreadItems[u]);
      }
    }

    // EARLIER section
    if (readItems.length > 0) {
      html += '<div class="notif-p-section-header">' +
        '<span class="notif-p-section-label">EARLIER</span>' +
      '</div>';
      for (var r = 0; r < readItems.length; r++) {
        html += renderItem(readItems[r]);
      }
    }

    body.innerHTML = html;
  }

  // ─── Show / Hide pane ──────────────────────────────────────────────────────

  function showPane() {
    var pane = document.getElementById("notif-pane");
    if (!pane) { return; }
    var siblings = ["chat-content", "chat-empty", "friends-content", "discover-content", "chat-pane-channels"];
    siblings.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) { el.style.display = "none"; }
    });
    var filterBar = document.getElementById("chat-filter-bar");
    if (filterBar) { filterBar.style.display = "none"; }

    pane.style.display = "flex";
    state.isActive = true;
    document.body.classList.add("noti-active");
    render();
  }

  function hidePane() {
    var pane = document.getElementById("notif-pane");
    if (pane) { pane.style.display = "none"; }
    state.isActive = false;
    document.body.classList.remove("noti-active");
    stopViewportObserver();
  }

  // ─── Tab switching ─────────────────────────────────────────────────────────

  function bindTabSwitching() {
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

  // ─── Click delegation (single listener on body) ────────────────────────────

  var _clickBound = false;

  function bindClickDelegation() {
    if (_clickBound) { return; }
    var body = document.getElementById("notif-p-body");
    if (!body) { return; }

    body.addEventListener("click", function (e) {
      // Mark all read button (dynamically rendered in section header)
      var markAllBtn = e.target.closest(".notif-p-mark-all");
      if (markAllBtn) {
        if (vscodeApi) { vscodeApi.postMessage({ type: "notificationMarkAllRead" }); }
        return;
      }

      // Notification item click
      var el = e.target.closest(".notif-p-item");
      if (!el) { return; }
      var id = el.getAttribute("data-id");
      if (!vscodeApi || !id) { return; }

      var notif = null;
      for (var k = 0; k < state.items.length; k++) {
        if (state.items[k].id === id) { notif = state.items[k]; break; }
      }

      if (notif && notif.type === "wave") {
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

    _clickBound = true;
  }

  // ─── Viewport-based mark-read (issue #76) ──────────────────────────────────

  var _observer = null;
  var _timers = {};

  function startViewportObserver() {
    stopViewportObserver();
    var body = document.getElementById("notif-p-body");
    if (!body) { return; }

    _observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        var el = entry.target;
        var id = el.getAttribute("data-id");
        if (!id) { return; }
        if (entry.isIntersecting) {
          if (!_timers[id]) {
            _timers[id] = setTimeout(function () {
              delete _timers[id];
              if (vscodeApi) {
                vscodeApi.postMessage({ type: "markNotificationRead", payload: { ids: [id] } });
              }
              el.classList.remove("unread");
              el.classList.add("read");
              // Remove unread dot
              var dot = el.querySelector(".notif-p-unread-dot");
              if (dot) { dot.remove(); }
              state.unread = Math.max(0, state.unread - 1);
              renderTabBadge();
            }, 500);
          }
        } else {
          if (_timers[id]) {
            clearTimeout(_timers[id]);
            delete _timers[id];
          }
        }
      });
    }, { root: body, threshold: 0.5 });

    Array.prototype.forEach.call(body.querySelectorAll(".notif-p-item.unread"), function (el) {
      _observer.observe(el);
    });
  }

  function stopViewportObserver() {
    if (_observer) { _observer.disconnect(); _observer = null; }
    Object.keys(_timers).forEach(function (k) { clearTimeout(_timers[k]); });
    _timers = {};
  }

  // ─── Message handler ───────────────────────────────────────────────────────

  window.addEventListener("message", function (event) {
    var data = event.data;
    if (!data) { return; }

    if (data.type === "setNotifications") {
      // Defensive client-side filter: new_message rows should never appear in
      // the inbox (per BE webapp#33 fcc9a5f which renamed FOR_YOU_TYPES to
      // INBOX_VISIBLE_TYPES and dropped new_message). This filter protects
      // against api-dev deploy lag when BE hasn't picked up the rename yet.
      // The toast pipeline still renders them — only the persistent inbox is
      // affected.
      var raw = Array.isArray(data.items) ? data.items : [];
      state.items = raw.filter(function (n) { return n && n.type !== "new_message"; });
      state.unread = state.items.filter(function (n) { return !n.is_read; }).length;
      render();
      return;
    }

    if (data.type === "openNotificationsTab") {
      var tab = document.querySelector('.gs-main-tab[data-tab="notifications"]');
      if (tab) { tab.click(); }
      return;
    }
  });

  // ─── Init ──────────────────────────────────────────────────────────────────

  function init() {
    bindTabSwitching();
    bindClickDelegation();
    renderTabBadge();
  }

  document.addEventListener("DOMContentLoaded", init);
  if (document.readyState !== "loading") { init(); }
})();
