(function () {
  "use strict";

  // ProfileCard — lightweight 220px hover popover preview of a user profile,
  // anchored to the trigger element. Shares host message protocol with
  // profile-screen.js (profileCard:fetch / profileCardData). Clicking
  // "View Profile" inside escalates to the full sidebar screen via
  // window.ProfileScreen.show.

  const OPEN_DELAY_MS = 150;
  const CLOSE_DELAY_MS = 200;
  const _inflight = new Set(); // logins currently being fetched (dedup)
  const CACHE_TTL_MS = 60 * 1000;
  const POPOVER_WIDTH = 220;
  const VIEWPORT_MARGIN = 8;

  const _cache = new Map(); // login → { data, fetchedAt }
  let _currentUser = null;
  let _root = null;
  let _currentLogin = null;
  let _openTimer = null;
  let _closeTimer = null;

  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatStat(n) {
    if (typeof n !== "number") { return "0"; }
    if (n >= 1000) { return (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "") + "k"; }
    return String(n);
  }

  function determineState(data, currentUser) {
    // Mirror of src/utils/profile-card-state.ts::getProfileCardState.
    // If you change these rules, also update that TS helper (tested) and
    // media/webview/profile-screen.js.
    if (data.is_self || data.login === currentUser) { return "self"; }
    if (!data.on_gitchat) { return "not-on-gitchat"; }
    // #112 — Organizations must not show a Message button.
    if (data.type === "Organization") { return "view-only"; }
    const s = data.follow_status || {};
    if (s.following) { return "eligible"; }
    return "stranger";
  }

  function isFresh(entry) {
    return entry && Date.now() - entry.fetchedAt < CACHE_TTL_MS;
  }

  function cancelTimers() {
    if (_openTimer) { clearTimeout(_openTimer); _openTimer = null; }
    if (_closeTimer) { clearTimeout(_closeTimer); _closeTimer = null; }
  }

  function prefetch(username) {
    if (!username) { return; }
    const cached = _cache.get(username);
    if (isFresh(cached)) { return; }
    if (_inflight.has(username)) { return; }
    if (typeof vscode === "undefined" || !vscode) { return; }
    _inflight.add(username);
    vscode.postMessage({ type: "profileCard:fetch", payload: { username } });
  }

  function scheduleOpen(anchor, username) {
    cancelTimers();
    // Kick off fetch immediately so data arrives while the delay timer is
    // still running — by the time the popover mounts, the cache is usually warm.
    prefetch(username);
    _openTimer = setTimeout(function () {
      _openTimer = null;
      open(anchor, username);
    }, OPEN_DELAY_MS);
  }

  function scheduleClose() {
    if (_openTimer) { clearTimeout(_openTimer); _openTimer = null; }
    if (_closeTimer) { return; }
    _closeTimer = setTimeout(function () {
      _closeTimer = null;
      close();
    }, CLOSE_DELAY_MS);
  }

  function open(anchor, username) {
    if (!username) { return; }
    // If Profile Screen is already open (full sidebar takeover), don't layer
    // a hover popover on top — click navigates in-place instead.
    if (window.ProfileScreen && window.ProfileScreen.isOpen && window.ProfileScreen.isOpen()) { return; }
    _currentLogin = username;

    const cached = _cache.get(username);
    if (isFresh(cached)) {
      mount(renderHtml(cached.data), anchor);
    } else {
      // Fetch was already kicked off in scheduleOpen; just show skeleton
      // until the profileCardData message lands and re-renders us.
      mount(renderSkeletonHtml(username), anchor);
      prefetch(username); // no-op if already inflight
    }
  }

  function close() {
    cancelTimers();
    _currentLogin = null;
    if (!_root) { return; }
    const node = _root;
    _root = null;
    node.classList.remove("gs-pch-open");
    const onEnd = function () {
      if (node.parentNode) { node.parentNode.removeChild(node); }
      node.removeEventListener("transitionend", onEnd);
    };
    node.addEventListener("transitionend", onEnd);
    setTimeout(onEnd, 250);
  }

  function mount(html, anchor) {
    // Remove any stale popover
    const existing = document.querySelector(".gs-pch-popover");
    if (existing && existing.parentNode) { existing.parentNode.removeChild(existing); }

    const wrapper = document.createElement("div");
    wrapper.innerHTML = html;
    const node = wrapper.firstElementChild;
    document.body.appendChild(node);
    _root = node;

    position(node, anchor);
    requestAnimationFrame(function () { node.classList.add("gs-pch-open"); });

    // Keep popover open while cursor inside
    node.addEventListener("mouseenter", function () {
      if (_closeTimer) { clearTimeout(_closeTimer); _closeTimer = null; }
    });
    node.addEventListener("mouseleave", scheduleClose);

    attachActions(node);
  }

  function position(node, anchor) {
    const rect = anchor.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Measure popover
    node.style.visibility = "hidden";
    node.style.left = "0px";
    node.style.top = "0px";
    const pw = node.offsetWidth || POPOVER_WIDTH;
    const ph = node.offsetHeight || 200;

    // Prefer right of anchor
    let left = rect.right + 8;
    let placement = "right";
    if (left + pw > vw - VIEWPORT_MARGIN) {
      // Flip to left
      left = rect.left - pw - 8;
      placement = "left";
      if (left < VIEWPORT_MARGIN) {
        // Not enough space either side — clamp to viewport, place below
        left = Math.max(VIEWPORT_MARGIN, Math.min(vw - pw - VIEWPORT_MARGIN, rect.left));
        placement = "below";
      }
    }

    let top;
    if (placement === "below") {
      top = rect.bottom + 8;
      if (top + ph > vh - VIEWPORT_MARGIN) {
        top = rect.top - ph - 8;
      }
    } else {
      // Align top of popover near anchor center
      top = rect.top + rect.height / 2 - 32;
      if (top + ph > vh - VIEWPORT_MARGIN) {
        top = vh - ph - VIEWPORT_MARGIN;
      }
      if (top < VIEWPORT_MARGIN) { top = VIEWPORT_MARGIN; }
    }

    node.style.left = Math.round(left) + "px";
    node.style.top = Math.round(top) + "px";
    node.setAttribute("data-placement", placement);
    node.style.visibility = "";
  }

  function swapContent(html) {
    if (!_root) { return; }
    // Replace innerHTML of the existing popover instead of unmount+remount
    // so the box stays anchored at its original position. We only nudge up
    // if the new content overflows the viewport bottom.
    const wrapper = document.createElement("div");
    wrapper.innerHTML = html;
    const fresh = wrapper.firstElementChild;
    if (!fresh) { return; }

    // Preserve anchor, openness, and the root node itself
    _root.innerHTML = fresh.innerHTML;
    _root.className = fresh.className + " gs-pch-open";

    // Re-bind mouse handlers (inner nodes replaced)
    _root.addEventListener("mouseenter", function () {
      if (_closeTimer) { clearTimeout(_closeTimer); _closeTimer = null; }
    });
    _root.addEventListener("mouseleave", scheduleClose);
    attachActions(_root);

    // Nudge vertically if the taller content now overflows viewport bottom
    const vh = window.innerHeight;
    const rect = _root.getBoundingClientRect();
    if (rect.bottom > vh - VIEWPORT_MARGIN) {
      const overflow = rect.bottom - (vh - VIEWPORT_MARGIN);
      const newTop = Math.max(VIEWPORT_MARGIN, rect.top - overflow);
      _root.style.top = Math.round(newTop) + "px";
    }
  }

  function attachActions(root) {
    root.querySelectorAll("[data-pch-action]").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        const action = btn.getAttribute("data-pch-action");
        const username = btn.getAttribute("data-pch-user");
        if (!username) { return; }
        if (action === "viewProfile") {
          close();
          if (window.ProfileScreen && window.ProfileScreen.show) {
            window.ProfileScreen.show(username);
          }
          return;
        }
        if (typeof vscode === "undefined" || !vscode) { return; }
        switch (action) {
          case "message":
            vscode.postMessage({ type: "profileCard:message", payload: { username } });
            close();
            break;
          case "follow":
            btn.disabled = true;
            vscode.postMessage({ type: "profileCard:follow", payload: { username } });
            break;
          case "unfollow":
            btn.disabled = true;
            vscode.postMessage({ type: "profileCard:unfollow", payload: { username } });
            break;
          case "invite":
            vscode.postMessage({ type: "profileCard:invite", payload: { username } });
            break;
          case "editProfile":
            vscode.postMessage({ type: "profileCard:openGitHub", payload: { username } });
            close();
            break;
          case "openGitHub":
            vscode.postMessage({ type: "profileCard:openGitHub", payload: { username } });
            close();
            break;
        }
      });
    });
  }

  function renderSkeletonHtml(username) {
    return [
      '<div class="gs-pch-popover gs-pch-loading" role="tooltip">',
      '  <div class="gs-pch-avatar gs-pch-skel"></div>',
      '  <div class="gs-pch-name">@' + escapeHtml(username) + '</div>',
      '  <div class="gs-pch-skel-line"></div>',
      '  <div class="gs-pch-skel-line gs-pch-skel-sm"></div>',
      '  <div class="gs-pch-actions">',
      '    <div class="gs-pch-skel-btn"></div>',
      '    <div class="gs-pch-skel-btn"></div>',
      '  </div>',
      '</div>',
    ].join("");
  }

  function renderErrorHtml(message) {
    return [
      '<div class="gs-pch-popover" role="tooltip">',
      '  <div class="gs-pch-error">',
      '    <i class="codicon codicon-error"></i>',
      '    <span>' + escapeHtml(message) + '</span>',
      '  </div>',
      '</div>',
    ].join("");
  }

  function renderHtml(data) {
    const state = determineState(data, _currentUser);
    const user = escapeHtml(data.login);
    const primary = renderPrimaryBtn(state, data);

    const name = escapeHtml(data.name || data.login);
    const bio = data.bio
      ? '<p class="gs-pch-bio">' + escapeHtml(data.bio) + '</p>'
      : '';

    const stats = [
      '<div class="gs-pch-stats">',
      '  <span><strong>' + formatStat(data.following) + '</strong> Following</span>',
      '  <span><strong>' + formatStat(data.followers) + '</strong> Followers</span>',
      '</div>',
    ].join("");

    const viewProfileBtn =
      '<button class="gs-btn gs-btn-outline" data-pch-action="viewProfile" data-pch-user="' + user + '">View Profile</button>';

    return [
      '<div class="gs-pch-popover gs-pch-state-' + state + '" role="tooltip">',
      '  <img class="gs-pch-avatar" src="' + escapeHtml(data.avatar_url) + '" alt="">',
      '  <div class="gs-pch-name">' + name + '</div>',
      '  <div class="gs-pch-handle">@' + user + '</div>',
      bio,
      stats,
      '  <div class="gs-pch-actions">' + primary + viewProfileBtn + '</div>',
      '</div>',
    ].join("");
  }

  function renderPrimaryBtn(state, data) {
    const u = escapeHtml(data.login);
    if (state === "self") {
      return '<button class="gs-btn gs-btn-primary" data-pch-action="editProfile" data-pch-user="' + u + '">Edit</button>';
    }
    if (state === "eligible") {
      if (window.__gsActiveDmLogin && data.login === window.__gsActiveDmLogin) { return ""; }
      return '<button class="gs-btn gs-btn-primary" data-pch-action="message" data-pch-user="' + u + '">Message</button>';
    }
    if (state === "stranger") {
      // Stranger = I don't follow target → DM gated per spec §5A. Follow is
      // the unlock step; Message becomes primary in eligible state.
      return '<button class="gs-btn gs-btn-primary" data-pch-action="follow" data-pch-user="' + u + '">Follow</button>';
    }
    if (state === "not-on-gitchat") {
      return '<button class="gs-btn gs-btn-primary" data-pch-action="invite" data-pch-user="' + u + '">Invite</button>';
    }
    if (state === "view-only") {
      return '<button class="gs-btn gs-btn-outline" data-pch-action="openGitHub" data-pch-user="' + u + '">View on GitHub</button>';
    }
    return "";
  }

  // ── Incoming host messages ──
  window.addEventListener("message", function (event) {
    const msg = event.data;
    if (!msg) { return; }
    if (msg.type === "profileCardData") {
      const data = msg.payload;
      _cache.set(data.login, { data, fetchedAt: Date.now() });
      _inflight.delete(data.login);
      if (_root && _currentLogin === data.login) {
        swapContent(renderHtml(data));
      }
      return;
    }
    if (msg.type === "profileCardError") {
      if (msg.username) { _inflight.delete(msg.username); }
      if (_root && _currentLogin) {
        swapContent(renderErrorHtml(msg.message || "Failed to load"));
      }
      return;
    }
    if (msg.type === "profileCardActionResult") {
      const username = msg.username;
      const cached = _cache.get(username);
      if (cached && cached.data && cached.data.follow_status) {
        if (msg.action === "follow" && msg.success) { cached.data.follow_status.following = true; }
        if (msg.action === "unfollow" && msg.success) { cached.data.follow_status.following = false; }
      }
      if (_root && _currentLogin === username && cached) {
        swapContent(renderHtml(cached.data));
      }
      return;
    }
    if (msg.type === "setChatData" || msg.type === "setChatDataDev") {
      if (msg.currentUser) { _currentUser = msg.currentUser; }
      return;
    }
  });

  // Close on Escape / scroll
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && _root) { close(); }
  });
  window.addEventListener("scroll", function () {
    if (_root) { close(); }
  }, true);

  // ProfileCard = the actual hover popover (lightweight 220px preview). The
  // full sidebar takeover lives in profile-screen.js as window.ProfileScreen.
  window.ProfileCard = {
    bindTrigger: function (el, username) {
      if (!el || !username) { return; }
      el.addEventListener("mouseenter", function () {
        scheduleOpen(el, username);
        // Stash anchor on root once mounted for later re-positions
        setTimeout(function () { if (_root) { _root.__anchor = el; } }, 0);
      });
      el.addEventListener("mouseleave", scheduleClose);
    },
    close: close,
  };
})();
