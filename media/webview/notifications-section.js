// Notifications section renderer — isolated from explore.js
// Subscribes to 'setNotifications' messages posted by explore.ts

(function () {
  "use strict";

  // Webview acquires vscode API once — explore.js already does this and attaches
  // it to window.vscode, so reuse that if present.
  var vscode = window.vscode || (window.acquireVsCodeApi && window.acquireVsCodeApi());
  if (vscode && !window.vscode) { window.vscode = vscode; }

  var MAX_VISIBLE = 5;
  var state = {
    items: [],
    unread: 0,
    collapsed: false,
  };

  var TYPE_ICONS = {
    new_message: "mail",
    mention: "mention",
    follow: "person-add",
    wave: "hand",
    repo_activity: "repo",
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
    switch (notif.type) {
      case "mention":   return { title: actor + " mentioned you", preview: meta.preview || "" };
      case "wave":      return { title: actor + " waved at you", preview: "Tap to say hi back" };
      case "new_message": return { title: actor, preview: meta.preview || "" };
      case "follow":    return { title: actor + " followed you", preview: "" };
      case "repo_activity": return {
        title: (meta.repoFullName || "repo") + " — " + (meta.eventType || "activity"),
        preview: meta.title || "",
      };
      default:          return { title: actor, preview: "" };
    }
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

    var html = visible.map(function (n) {
      var d = describe(n);
      var icon = TYPE_ICONS[n.type] || "bell";
      var readClass = n.is_read ? "read" : "unread";
      return (
        '<button class="notif-item ' + readClass + '" data-id="' + escapeHtml(n.id) + '">' +
          '<span class="codicon codicon-' + icon + '"></span>' +
          '<div class="notif-item-body">' +
            '<div class="notif-item-title">' + escapeHtml(d.title) + '</div>' +
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
        if (vscode) { vscode.postMessage({ type: "notificationClicked", payload: { id: id } }); }
      });
    });
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
        if (vscode) { vscode.postMessage({ type: "notificationMarkAllRead" }); }
      });
    }
  }

  window.addEventListener("message", function (event) {
    var data = event.data;
    if (!data || data.type !== "setNotifications") { return; }
    state.items = Array.isArray(data.items) ? data.items : [];
    state.unread = typeof data.unread === "number" ? data.unread : 0;
    render();
  });

  document.addEventListener("DOMContentLoaded", bindHeader);
  // DOMContentLoaded may have already fired by the time this script runs
  if (document.readyState !== "loading") { bindHeader(); }
})();
