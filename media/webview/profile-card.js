(function () {
  "use strict";

  // vscode is acquired once in shared.js as a top-level const and is visible
  // cross-script. Calling acquireVsCodeApi() again here would throw and kill
  // this IIFE before window.ProfileCard gets assigned.
  const CACHE_TTL_MS = 60 * 1000; // 60 seconds
  const _cache = new Map();       // login → { data, fetchedAt }
  let _root = null;
  let _keydownHandler = null;
  let _currentUser = null;

  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatStat(n) {
    if (n >= 1000) { return (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "") + "k"; }
    return String(n);
  }

  function determineState(data, currentUser) {
    if (data.login === currentUser) { return "self"; }
    if (!data.on_gitchat) { return "not-on-gitchat"; }
    const s = data.follow_status || {};
    if (s.following && s.followed_by) { return "eligible"; }
    return "stranger";
  }

  function isFresh(entry) {
    return entry && Date.now() - entry.fetchedAt < CACHE_TTL_MS;
  }

  function show(username) {
    if (!username) { return; }
    if (_root) { close(); }

    const cached = _cache.get(username);
    if (isFresh(cached)) {
      mount(renderHtml(cached.data));
    } else {
      mount(renderSkeletonHtml(username));
      if (vscode) {
        vscode.postMessage({ type: "profileCard:fetch", payload: { username } });
      }
    }
  }

  function close() {
    if (!_root) { return; }
    const backdrop = _root;
    backdrop.classList.remove("gs-pc-open");
    const onEnd = function () {
      if (backdrop.parentNode) { backdrop.parentNode.removeChild(backdrop); }
      if (_root === backdrop) { _root = null; }
      backdrop.removeEventListener("transitionend", onEnd);
    };
    backdrop.addEventListener("transitionend", onEnd);
    setTimeout(onEnd, 300); // fallback
    if (_keydownHandler) {
      document.removeEventListener("keydown", _keydownHandler);
      _keydownHandler = null;
    }
  }

  function isOpen() { return _root !== null; }

  function mount(html) {
    const existing = document.querySelector(".gs-pc-backdrop");
    if (existing && existing.parentNode) { existing.parentNode.removeChild(existing); }

    const wrapper = document.createElement("div");
    wrapper.innerHTML = html;
    const backdrop = wrapper.firstElementChild;
    document.body.appendChild(backdrop);
    _root = backdrop;

    requestAnimationFrame(function () { backdrop.classList.add("gs-pc-open"); });

    backdrop.addEventListener("click", function (e) {
      if (e.target === backdrop) { close(); }
    });
    const closeBtn = backdrop.querySelector(".gs-pc-close");
    if (closeBtn) { closeBtn.addEventListener("click", close); }

    _keydownHandler = function (e) { if (e.key === "Escape") { close(); } };
    document.addEventListener("keydown", _keydownHandler);

    attachActions(backdrop);
  }

  function attachActions(root) {
    const actionBtns = root.querySelectorAll("[data-pc-action]");
    actionBtns.forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        const action = btn.getAttribute("data-pc-action");
        const username = btn.getAttribute("data-pc-user");
        if (!username || !vscode) { return; }
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
          case "wave":
            btn.disabled = true;
            vscode.postMessage({ type: "profileCard:wave", payload: { username } });
            break;
          case "invite":
            vscode.postMessage({ type: "profileCard:invite", payload: { username } });
            break;
          case "github":
            vscode.postMessage({ type: "profileCard:openGitHub", payload: { username } });
            break;
          case "signOut":
            vscode.postMessage({ type: "profileCard:signOut" });
            close();
            break;
          case "editProfile":
            vscode.postMessage({ type: "profileCard:openGitHub", payload: { username } });
            close();
            break;
        }
      });
    });

    // Clickable mutual friend logins → open their profile card
    root.querySelectorAll("[data-pc-mutual-login]").forEach(function (el) {
      el.addEventListener("click", function (e) {
        e.stopPropagation();
        show(el.getAttribute("data-pc-mutual-login"));
      });
    });
  }

  function renderSkeletonHtml(username) {
    return [
      '<div class="gs-pc-backdrop gs-pc-loading" role="dialog" aria-labelledby="gs-pc-title">',
      '  <div class="gs-pc-card">',
      '    <button class="gs-pc-close gs-btn-icon" aria-label="Close"><i class="codicon codicon-close"></i></button>',
      '    <div class="gs-pc-header">',
      '      <div class="gs-pc-avatar gs-pc-skel"></div>',
      '      <h2 class="gs-pc-name" id="gs-pc-title">@' + escapeHtml(username) + '</h2>',
      '      <div class="gs-pc-skel-line gs-pc-skel-sm"></div>',
      '      <div class="gs-pc-skel-line"></div>',
      '    </div>',
      '    <div class="gs-pc-stats gs-pc-skel-stats">',
      '      <div class="gs-pc-stat gs-pc-skel-line"></div>',
      '      <div class="gs-pc-stat gs-pc-skel-line"></div>',
      '      <div class="gs-pc-stat gs-pc-skel-line"></div>',
      '    </div>',
      '  </div>',
      '</div>',
    ].join("");
  }

  function renderErrorHtml(message) {
    return [
      '<div class="gs-pc-backdrop" role="dialog">',
      '  <div class="gs-pc-card">',
      '    <button class="gs-pc-close gs-btn-icon" aria-label="Close"><i class="codicon codicon-close"></i></button>',
      '    <div class="gs-pc-error">',
      '      <i class="codicon codicon-error"></i>',
      '      <p>' + escapeHtml(message) + '</p>',
      '    </div>',
      '  </div>',
      '</div>',
    ].join("");
  }

  function renderHtml(data) {
    const state = determineState(data, _currentUser);
    const user = escapeHtml(data.login);

    const statsRow = [
      '<div class="gs-pc-stats">',
      '  <div class="gs-pc-stat"><strong>' + formatStat(data.public_repos) + '</strong> Repos</div>',
      '  <div class="gs-pc-stat"><strong>' + formatStat(data.followers) + '</strong> Followers</div>',
      '  <div class="gs-pc-stat"><strong>' + formatStat(data.following) + '</strong> Following</div>',
      '</div>',
    ].join("");

    let middleBlock = "";
    if (state === "eligible") {
      middleBlock = renderMutual(data);
    } else if (state === "stranger" && data.top_repo) {
      middleBlock =
        '<div class="gs-pc-top-repo"><i class="codicon codicon-star-full"></i> ' +
        escapeHtml(data.top_repo.owner + "/" + data.top_repo.name) + "</div>";
    }

    let warning = "";
    if (state === "stranger") {
      warning =
        '<div class="gs-pc-warning"><i class="codicon codicon-warning"></i>' +
        " You don't follow each other yet</div>";
    }

    const actions = renderActions(state, data);
    const pronouns = data.pronouns ? ' <span class="gs-pc-dot">·</span> <span class="gs-pc-pronouns">' + escapeHtml(data.pronouns) + "</span>" : "";

    return [
      '<div class="gs-pc-backdrop" role="dialog" aria-labelledby="gs-pc-title">',
      '  <div class="gs-pc-card gs-pc-state-' + state + '">',
      '    <button class="gs-pc-close gs-btn-icon" aria-label="Close"><i class="codicon codicon-close"></i></button>',
      '    <div class="gs-pc-header">',
      '      <img class="gs-pc-avatar" src="' + escapeHtml(data.avatar_url) + '" alt="">',
      '      <h2 class="gs-pc-name" id="gs-pc-title">' + escapeHtml(data.name || data.login) + '</h2>',
      '      <div class="gs-pc-handle">@' + user + pronouns + '</div>',
      (data.bio ? '      <p class="gs-pc-bio">' + escapeHtml(data.bio) + '</p>' : ''),
      '    </div>',
      statsRow,
      middleBlock,
      warning,
      actions,
      '  </div>',
      '</div>',
    ].join("");
  }

  function renderMutual(data) {
    const friends = data.mutual_friends || [];
    const groups = data.mutual_groups || [];
    if (friends.length === 0 && groups.length === 0) { return ""; }

    const countText =
      (friends.length ? friends.length + " friend" + (friends.length === 1 ? "" : "s") : "") +
      (friends.length && groups.length ? " · " : "") +
      (groups.length ? groups.length + " group" + (groups.length === 1 ? "" : "s") : "");

    const friendsHtml = friends.length
      ? '<div class="gs-pc-mutual-friends">' +
          friends.map(function (f) {
            return '<a data-pc-mutual-login="' + escapeHtml(f.login) + '">' + escapeHtml(f.login) + "</a>";
          }).join(" · ") +
        "</div>"
      : "";

    const groupsHtml = groups.length
      ? '<div class="gs-pc-mutual-groups">' +
          groups.map(function (g) { return "#" + escapeHtml(g.name); }).join(" · ") +
        "</div>"
      : "";

    return [
      '<div class="gs-pc-mutual">',
      '  <div class="gs-pc-mutual-header">MUTUAL — ' + escapeHtml(countText) + '</div>',
      friendsHtml,
      groupsHtml,
      '</div>',
    ].join("");
  }

  function renderActions(state, data) {
    const u = escapeHtml(data.login);
    let primary = "";
    let secondary = "";

    if (state === "self") {
      primary = '<button class="gs-btn gs-btn-primary" data-pc-action="editProfile" data-pc-user="' + u + '"><i class="codicon codicon-edit"></i> Edit Profile</button>';
      secondary = '<button class="gs-btn gs-btn-outline" data-pc-action="signOut" data-pc-user="' + u + '"><i class="codicon codicon-sign-out"></i> Sign Out</button>';
    } else if (state === "eligible") {
      primary = '<button class="gs-btn gs-btn-primary" data-pc-action="message" data-pc-user="' + u + '"><i class="codicon codicon-comment"></i> Message</button>';
      secondary = '<button class="gs-btn gs-btn-outline" data-pc-action="unfollow" data-pc-user="' + u + '"><i class="codicon codicon-check"></i> Following</button>';
    } else if (state === "stranger") {
      primary = '<button class="gs-btn gs-btn-primary" data-pc-action="wave" data-pc-user="' + u + '"><i class="codicon codicon-heart"></i> Wave</button>';
      const isFollowing = data.follow_status && data.follow_status.following;
      secondary = isFollowing
        ? '<button class="gs-btn gs-btn-outline" data-pc-action="unfollow" data-pc-user="' + u + '"><i class="codicon codicon-check"></i> Following</button>'
        : '<button class="gs-btn gs-btn-outline" data-pc-action="follow" data-pc-user="' + u + '"><i class="codicon codicon-add"></i> Follow</button>';
    } else if (state === "not-on-gitchat") {
      primary = '<button class="gs-btn gs-btn-primary" data-pc-action="invite" data-pc-user="' + u + '"><i class="codicon codicon-mail"></i> Invite to GitChat</button>';
      secondary = '<button class="gs-btn gs-btn-outline" data-pc-action="github" data-pc-user="' + u + '"><i class="codicon codicon-github"></i> View on GitHub</button>';
    }

    return '<div class="gs-pc-actions">' + primary + secondary + "</div>";
  }

  // ── Incoming host messages ──
  window.addEventListener("message", function (event) {
    const msg = event.data;
    if (!msg) { return; }
    if (msg.type === "profileCardData") {
      const data = msg.payload;
      _cache.set(data.login, { data, fetchedAt: Date.now() });
      if (_root) {
        _root.parentNode.removeChild(_root);
        _root = null;
        mount(renderHtml(data));
      }
      return;
    }
    if (msg.type === "profileCardError") {
      if (_root) {
        _root.parentNode.removeChild(_root);
        _root = null;
        mount(renderErrorHtml(msg.message || "Failed to load"));
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
      // Re-render current overlay if still open for same user
      if (_root && cached && isOpen()) {
        const titleEl = _root.querySelector("#gs-pc-title");
        if (titleEl && (titleEl.textContent === cached.data.name || titleEl.textContent === cached.data.login)) {
          _root.parentNode.removeChild(_root);
          _root = null;
          mount(renderHtml(cached.data));
        }
      }
      if (msg.action === "follow" && !msg.success) {
        // Revert button disabled state
        const btn = document.querySelector('[data-pc-action="follow"]');
        if (btn) { btn.disabled = false; }
      }
      return;
    }
    if (msg.type === "setChatData" || msg.type === "setChatDataDev") {
      if (msg.currentUser) { _currentUser = msg.currentUser; }
      return;
    }
  });

  window.ProfileCard = {
    show: show,
    close: close,
    isOpen: isOpen,
    bindTrigger: function (el, username) {
      if (!el || !username) { return; }
      el.addEventListener("click", function (e) {
        e.stopPropagation();
        show(username);
      });
    },
  };
})();
