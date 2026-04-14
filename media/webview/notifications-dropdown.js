// Notifications dropdown — anchored to the title-bar bell.
// Listens for postMessage('toggleNotificationDropdown') from the extension
// host (fired by gitchat.openNotifications command).

(function () {
  "use strict";

  // shared.js (loaded earlier in explore.ts) exposes `vscode` as a top-level
  // const via acquireVsCodeApi(). Reuse — calling acquireVsCodeApi() twice throws.
  var vscodeApi = (typeof vscode !== "undefined") ? vscode : null;

  var state = {
    items: [],
    unread: 0,
    open: false,
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
        var repo = escapeHtml(meta.repoFullName || "a repo");
        var evt = String(meta.eventType || "activity").replace(/_/g, " ");
        return { html: "<strong>" + repo + "</strong> · " + escapeHtml(evt), preview: meta.title || "" };
      }
      default:
        return { html: actorTag, preview: "" };
    }
  }

  function avatarUrl(notif) {
    if (notif.actor_avatar_url) { return notif.actor_avatar_url; }
    if (notif.actor_login) { return "https://github.com/" + encodeURIComponent(notif.actor_login) + ".png?size=64"; }
    return "";
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderItem(n) {
    var d = describe(n);
    var meta = TYPE_META[n.type] || { icon: "bell", badge: "" };
    var readClass = n.is_read ? "read" : "unread";
    var avatar = avatarUrl(n);
    var avatarHtml = avatar
      ? '<img class="notif-d-avatar" src="' + escapeHtml(avatar) + '" alt="">'
      : '<div class="notif-d-avatar"></div>';
    return (
      '<button class="notif-d-item ' + readClass + '" data-id="' + escapeHtml(n.id) + '">' +
        '<div class="notif-d-avatar-wrap">' +
          avatarHtml +
          '<div class="notif-d-type-badge ' + meta.badge + '">' +
            '<span class="codicon codicon-' + meta.icon + '"></span>' +
          '</div>' +
        '</div>' +
        '<div class="notif-d-item-body">' +
          '<div class="notif-d-item-title">' + d.html + '</div>' +
          (d.preview ? '<div class="notif-d-item-preview">' + escapeHtml(d.preview) + '</div>' : '') +
        '</div>' +
        '<span class="notif-d-item-time">' + escapeHtml(fmtTimeAgo(n.created_at)) + '</span>' +
      '</button>'
    );
  }

  function render() {
    var dropdown = document.getElementById("notif-dropdown");
    if (!dropdown) { return; }

    var pill = document.getElementById("notif-d-pill");
    if (pill) {
      pill.textContent = state.unread > 99 ? "99+" : String(state.unread);
      pill.setAttribute("data-count", String(state.unread));
    }

    var body = document.getElementById("notif-d-body");
    if (!body) { return; }

    if (state.items.length === 0) {
      body.innerHTML =
        '<div class="notif-d-empty">' +
          '<span class="codicon codicon-bell-slash"></span>' +
          '<div class="notif-d-empty-title">You\'re all caught up</div>' +
          '<div class="notif-d-empty-subtitle">No new notifications</div>' +
        '</div>';
      var footer = document.getElementById("notif-d-footer");
      if (footer) { footer.style.display = "none"; }
      return;
    }

    var groups = { today: [], yesterday: [], earlier: [] };
    for (var i = 0; i < state.items.length; i++) {
      var n = state.items[i];
      groups[bucket(n.created_at)].push(n);
    }

    var html = "";
    var labelMap = { today: "TODAY", yesterday: "YESTERDAY", earlier: "EARLIER" };
    var order = ["today", "yesterday", "earlier"];
    for (var g = 0; g < order.length; g++) {
      var key = order[g];
      var items = groups[key];
      if (items.length === 0) { continue; }
      html += '<div class="notif-group-label">' + labelMap[key] + '</div>';
      for (var j = 0; j < items.length; j++) {
        html += renderItem(items[j]);
      }
    }

    body.innerHTML = html;

    var footerEl = document.getElementById("notif-d-footer");
    if (footerEl) { footerEl.style.display = state.items.length > 5 ? "" : "none"; }

    Array.prototype.forEach.call(body.querySelectorAll(".notif-d-item"), function (el) {
      el.addEventListener("click", function () {
        var id = el.getAttribute("data-id");
        if (vscodeApi) { vscodeApi.postMessage({ type: "notificationClicked", payload: { id: id } }); }
        closeDropdown();
      });
    });
  }

  function openDropdown() {
    var d = document.getElementById("notif-dropdown");
    var b = document.getElementById("notif-backdrop");
    if (!d || !b) { return; }
    d.classList.add("open");
    b.classList.add("open");
    state.open = true;
    // Auto mark-as-seen: clear pill but keep individual unread dots
    if (vscodeApi) { vscodeApi.postMessage({ type: "notificationDropdownOpened" }); }
  }

  function closeDropdown() {
    var d = document.getElementById("notif-dropdown");
    var b = document.getElementById("notif-backdrop");
    if (d) { d.classList.remove("open"); }
    if (b) { b.classList.remove("open"); }
    state.open = false;
  }

  function toggleDropdown() {
    if (state.open) { closeDropdown(); } else { openDropdown(); }
  }

  function bind() {
    var backdrop = document.getElementById("notif-backdrop");
    if (backdrop) { backdrop.addEventListener("click", closeDropdown); }

    var markAll = document.getElementById("notif-d-mark-all");
    if (markAll) {
      markAll.addEventListener("click", function (e) {
        e.stopPropagation();
        if (vscodeApi) { vscodeApi.postMessage({ type: "notificationMarkAllRead" }); }
      });
    }

    var viewAll = document.getElementById("notif-d-view-all");
    if (viewAll) {
      viewAll.addEventListener("click", function (e) {
        e.stopPropagation();
        if (vscodeApi) { vscodeApi.postMessage({ type: "notificationViewAll" }); }
        closeDropdown();
      });
    }

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && state.open) { closeDropdown(); }
    });
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
    if (data.type === "toggleNotificationDropdown") {
      // Re-render fresh state then toggle
      render();
      toggleDropdown();
      return;
    }
  });

  document.addEventListener("DOMContentLoaded", bind);
  if (document.readyState !== "loading") { bind(); }
})();
