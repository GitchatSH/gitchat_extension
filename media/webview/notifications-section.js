// Notifications section renderer — isolated from explore.js
// Subscribes to 'setNotifications' messages posted by explore.ts

(function () {
  "use strict";

  // shared.js (loaded earlier in explore.ts) already called acquireVsCodeApi()
  // and exposed `vscode` as a top-level const. Reuse that — calling
  // acquireVsCodeApi() a second time throws.
  var vscodeApi = (typeof vscode !== "undefined") ? vscode : null;

  var MAX_VISIBLE = 5;
  var state = {
    items: [],
    unread: 0,
    collapsed: false,
  };

  var TYPE_META = {
    new_message:   { icon: "comment",     badge: "type-message" },
    mention:       { icon: "mention",     badge: "type-mention" },
    follow:        { icon: "person-add",  badge: "type-follow"  },
    wave:          { icon: "symbol-event",badge: "type-wave"    },
    repo_activity: { icon: "rocket",      badge: "type-repo"    },
  };

  function fmtTimeAgo(iso) {
    if (!iso) { return ""; }
    var t = new Date(iso).getTime();
    if (isNaN(t)) { return ""; }
    var diff = (Date.now() - t) / 1000;
    if (diff < 60) { return Math.floor(diff) + "s"; }
    if (diff < 3600) { return Math.floor(diff / 60) + "m"; }
    if (diff < 86400) { return Math.floor(diff / 3600) + "h"; }
    return Math.floor(diff / 86400) + "d";
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
    var login = notif.actor_login;
    if (login) { return "https://github.com/" + encodeURIComponent(login) + ".png?size=64"; }
    return "";
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function render() {
    var section = document.getElementById("notif-section");
    if (!section) { return; }

    // Hide the whole section if there's nothing to show
    if (!state.items.length && state.unread === 0) {
      section.hidden = true;
      return;
    }
    section.hidden = false;

    var pill = document.getElementById("notif-unread-pill");
    if (pill) {
      pill.textContent = state.unread > 99 ? "99+" : String(state.unread);
      pill.setAttribute("data-count", String(state.unread));
    }

    var body = document.getElementById("notif-body");
    if (!body) { return; }

    var visible = state.items.slice(0, MAX_VISIBLE);
    if (visible.length === 0) {
      body.innerHTML = '<div class="gs-empty" style="padding:8px">No notifications</div>';
      return;
    }

    var moreCount = state.items.length - visible.length;
    var html = visible.map(function (n) {
      var d = describe(n);
      var meta = TYPE_META[n.type] || { icon: "bell", badge: "" };
      var readClass = n.is_read ? "read" : "unread";
      var avatar = avatarUrl(n);
      var avatarHtml = avatar
        ? '<img class="notif-avatar" src="' + escapeHtml(avatar) + '" alt="">'
        : '<div class="notif-avatar"></div>';
      return (
        '<button class="notif-item ' + readClass + '" data-id="' + escapeHtml(n.id) + '">' +
          '<div class="notif-avatar-wrap">' +
            avatarHtml +
            '<div class="notif-type-badge ' + meta.badge + '">' +
              '<span class="codicon codicon-' + meta.icon + '"></span>' +
            '</div>' +
          '</div>' +
          '<div class="notif-item-body">' +
            '<div class="notif-item-title">' + d.html + '</div>' +
            (d.preview ? '<div class="notif-item-preview">' + escapeHtml(d.preview) + '</div>' : '') +
          '</div>' +
          '<span class="notif-item-time">' + escapeHtml(fmtTimeAgo(n.created_at)) + '</span>' +
        '</button>'
      );
    }).join("");

    body.innerHTML = html;

    // Attach click handlers
    Array.prototype.forEach.call(body.querySelectorAll(".notif-item"), function (el) {
      el.addEventListener("click", function () {
        var id = el.getAttribute("data-id");
        if (vscodeApi) { vscodeApi.postMessage({ type: "notificationClicked", payload: { id: id } }); }
      });
    });

    // Update "View all" button label/visibility in the footer
    var viewAllBtn = document.getElementById("notif-view-all");
    if (viewAllBtn) {
      if (moreCount > 0) {
        viewAllBtn.textContent = "View all (" + state.items.length + ")";
        viewAllBtn.style.display = "";
      } else {
        viewAllBtn.style.display = "none";
      }
    }
  }

  function bindHeader() {
    var header = document.getElementById("notif-header");
    if (!header) { return; }
    header.addEventListener("click", function () {
      state.collapsed = !state.collapsed;
      var section = document.getElementById("notif-section");
      if (section) { section.classList.toggle("collapsed", state.collapsed); }
    });

    var markAll = document.getElementById("notif-mark-all");
    if (markAll) {
      markAll.addEventListener("click", function (e) {
        e.stopPropagation();
        if (vscodeApi) { vscodeApi.postMessage({ type: "notificationMarkAllRead" }); }
      });
    }

    var viewAll = document.getElementById("notif-view-all");
    if (viewAll) {
      viewAll.addEventListener("click", function (e) {
        e.stopPropagation();
        if (vscodeApi) { vscodeApi.postMessage({ type: "notificationViewAll" }); }
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
    if (data.type === "focusNotifications") {
      state.collapsed = false;
      var section = document.getElementById("notif-section");
      if (section) {
        section.classList.remove("collapsed");
        section.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      return;
    }
  });

  document.addEventListener("DOMContentLoaded", bindHeader);
  // DOMContentLoaded may have already fired by the time this script runs
  if (document.readyState !== "loading") { bindHeader(); }
})();
