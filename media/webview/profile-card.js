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
    // DM spec §5A: "Mình follow người đó → nhắn được". One-way follow from
    // my side unlocks DM. They don't need to follow me back.
    if (data.is_self || data.login === currentUser) { return "self"; }
    if (!data.on_gitchat) { return "not-on-gitchat"; }
    const s = data.follow_status || {};
    if (s.following) { return "eligible"; }
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

    // Clickable top repo rows → open on GitHub
    root.querySelectorAll("[data-pc-repo-owner]").forEach(function (el) {
      el.addEventListener("click", function (e) {
        e.stopPropagation();
        const owner = el.getAttribute("data-pc-repo-owner");
        const name = el.getAttribute("data-pc-repo-name");
        if (owner && name && vscode) {
          vscode.postMessage({ type: "profileCard:openRepo", payload: { owner, name } });
        }
      });
    });
  }

  function renderSkeletonHtml(username) {
    return [
      '<div class="gs-pc-backdrop gs-pc-loading" role="dialog" aria-labelledby="gs-pc-title">',
      '  <div class="gs-pc-card">',
      '    <button class="gs-pc-close gs-btn-icon" aria-label="Back"><i class="codicon codicon-arrow-left"></i></button>',
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
      '    <button class="gs-pc-close gs-btn-icon" aria-label="Back"><i class="codicon codicon-arrow-left"></i></button>',
      '    <div class="gs-pc-error">',
      '      <i class="codicon codicon-error"></i>',
      '      <p>' + escapeHtml(message) + '</p>',
      '    </div>',
      '  </div>',
      '</div>',
    ].join("");
  }

  function formatJoinedDate(iso) {
    if (!iso) { return ""; }
    const d = new Date(iso);
    if (isNaN(d.getTime())) { return ""; }
    const months = ["January", "February", "March", "April", "May", "June",
                    "July", "August", "September", "October", "November", "December"];
    return months[d.getMonth()] + " " + d.getFullYear();
  }

  function renderFollowedBy(data) {
    const friends = data.mutual_friends || [];
    if (friends.length === 0) { return ""; }
    const shown = friends.slice(0, 2);
    const rest = friends.length - shown.length;

    const avatars = shown.map(function (f) {
      return '<img class="gs-pc-fb-avatar" src="' + escapeHtml(f.avatar_url || "") + '" alt="">';
    }).join("");

    const names = shown.map(function (f) {
      return '<a class="gs-pc-fb-name" data-pc-mutual-login="' + escapeHtml(f.login) + '">' + escapeHtml(f.login) + "</a>";
    }).join(", ");

    const suffix = rest > 0
      ? ' and <span class="gs-pc-fb-rest">' + rest + " other" + (rest === 1 ? "" : "s") + "</span>"
      : "";

    return [
      '<div class="gs-pc-followed-by">',
      '  <div class="gs-pc-fb-avatars">' + avatars + '</div>',
      '  <div class="gs-pc-fb-text">Followed by ' + names + suffix + '</div>',
      '</div>',
    ].join("");
  }

  function renderHtml(data) {
    const state = determineState(data, _currentUser);
    const user = escapeHtml(data.login);

    const joinedDate = formatJoinedDate(data.created_at);
    const joinedRow = joinedDate
      ? '<div class="gs-pc-joined"><i class="codicon codicon-calendar"></i> Joined ' + escapeHtml(joinedDate) + '</div>'
      : "";

    const statsRow = [
      '<div class="gs-pc-stats-inline">',
      '  <span><strong>' + formatStat(data.following) + '</strong> Following</span>',
      '  <span class="gs-pc-dot">·</span>',
      '  <span><strong>' + formatStat(data.followers) + '</strong> Followers</span>',
      '  <span class="gs-pc-dot">·</span>',
      '  <span><strong>' + formatStat(data.public_repos) + '</strong> Repos</span>',
      '</div>',
    ].join("");

    const followedByRow = (state !== "self") ? renderFollowedBy(data) : "";

    const mutualBlock = (state !== "self") ? renderMutual(data) : "";
    const topReposBlock = renderTopRepos(data);

    let warning = "";
    const displayName = escapeHtml(data.name || data.login);
    if (state === "stranger") {
      warning =
        '<div class="gs-pc-warning"><i class="codicon codicon-warning"></i> ' +
        "Follow " + displayName + " to unlock DM" + '</div>';
    } else if (state === "eligible" && data.follow_status && !data.follow_status.followed_by) {
      // DM works one-way (spec §5A) but it's still useful to know they
      // haven't followed back yet — pure FYI, no blocker.
      warning =
        '<div class="gs-pc-warning"><i class="codicon codicon-info"></i> ' +
        displayName + " doesn't follow you back yet" + '</div>';
    }

    const headerActions = renderHeaderActions(state, data);
    const pronouns = data.pronouns ? ' <span class="gs-pc-dot">·</span> <span class="gs-pc-pronouns">' + escapeHtml(data.pronouns) + "</span>" : "";

    return [
      '<div class="gs-pc-backdrop" role="dialog" aria-labelledby="gs-pc-title">',
      '  <div class="gs-pc-card gs-pc-state-' + state + '">',
      '    <button class="gs-pc-close gs-btn-icon" aria-label="Back"><i class="codicon codicon-arrow-left"></i></button>',
      '    <div class="gs-pc-header">',
      '      <div class="gs-pc-header-row">',
      '        <img class="gs-pc-avatar" src="' + escapeHtml(data.avatar_url) + '" alt="">',
      '        <div class="gs-pc-header-actions">' + headerActions + '</div>',
      '      </div>',
      '      <h2 class="gs-pc-name" id="gs-pc-title">' + escapeHtml(data.name || data.login) + '</h2>',
      '      <div class="gs-pc-handle">@' + user + pronouns + '</div>',
      (data.bio ? '      <p class="gs-pc-bio">' + escapeHtml(data.bio) + '</p>' : ''),
      joinedRow,
      '    </div>',
      statsRow,
      followedByRow,
      mutualBlock,
      topReposBlock,
      warning,
      '  </div>',
      '</div>',
    ].join("");
  }

  function renderTopRepos(data) {
    const repos = data.top_repos || [];
    if (repos.length === 0) { return ""; }
    const items = repos.map(function (r) {
      const slug = escapeHtml(r.owner + "/" + r.name);
      const owner = escapeHtml(r.owner);
      const name = escapeHtml(r.name);
      const avatar = 'https://github.com/' + encodeURIComponent(r.owner) + '.png?size=80';
      const lang = r.language
        ? '<span class="gs-pc-repo-lang"><span class="gs-pc-lang-dot"></span>' + escapeHtml(r.language) + '</span>'
        : '';
      const stars = (typeof r.stars === "number")
        ? '<span class="gs-pc-repo-stars"><i class="codicon codicon-star-full"></i>' + formatStat(r.stars) + '</span>'
        : '';
      const metaParts = [lang, stars].filter(Boolean).join('<span class="gs-pc-dot">·</span>');
      return [
        '<li class="gs-pc-repo" data-pc-repo-owner="' + owner + '" data-pc-repo-name="' + name + '">',
        '  <img class="gs-pc-repo-avatar" src="' + avatar + '" alt="">',
        '  <div class="gs-pc-repo-body">',
        '    <div class="gs-pc-repo-slug">' + slug + '</div>',
        (r.description ? '    <div class="gs-pc-repo-desc">' + escapeHtml(r.description) + '</div>' : ''),
        (metaParts ? '    <div class="gs-pc-repo-meta">' + metaParts + '</div>' : ''),
        '  </div>',
        '</li>',
      ].join("");
    }).join("");
    return [
      '<div class="gs-pc-top-repos">',
      '  <div class="gs-pc-section-header">TOP REPOS</div>',
      '  <ul class="gs-pc-repo-list">' + items + '</ul>',
      '</div>',
    ].join("");
  }

  function renderMutual(data) {
    const friends = data.mutual_friends || [];
    const groups = data.mutual_groups || [];
    if (friends.length === 0 && groups.length === 0) { return ""; }

    const friendsBlock = friends.length
      ? [
          '<div class="gs-pc-mutual">',
          '  <div class="gs-pc-section-header">MUTUAL FRIENDS (' + friends.length + ')</div>',
          '  <div class="gs-pc-mutual-friends">' +
            friends.map(function (f) {
              return '<a data-pc-mutual-login="' + escapeHtml(f.login) + '">' + escapeHtml(f.login) + "</a>";
            }).join(" · ") +
          '</div>',
          '</div>',
        ].join("")
      : "";

    const groupsBlock = groups.length
      ? [
          '<div class="gs-pc-mutual">',
          '  <div class="gs-pc-section-header">MUTUAL GROUPS (' + groups.length + ')</div>',
          '  <div class="gs-pc-mutual-groups">' +
            groups.map(function (g) { return "#" + escapeHtml(g.name); }).join(" · ") +
          '</div>',
          '</div>',
        ].join("")
      : "";

    return friendsBlock + groupsBlock;
  }

  function renderHeaderActions(state, data) {
    const u = escapeHtml(data.login);
    // Twitter-style header: icon-only outline buttons on the left, primary pill on the right.
    const ghBtn = '<button class="gs-btn gs-btn-outline gs-btn-icon" data-pc-action="github" data-pc-user="' + u + '" title="View on GitHub" aria-label="View on GitHub"><i class="codicon codicon-github"></i></button>';

    let stateIcon = "";
    let primary = "";

    // Following toggle: outline button that turns red "Unfollow" on hover.
    const followingBtn =
      '<button class="gs-btn gs-btn-outline gs-pc-following" data-pc-action="unfollow" data-pc-user="' + u + '">' +
      '  <span class="gs-pc-following-label">Following</span>' +
      '  <span class="gs-pc-unfollow-label">Unfollow</span>' +
      '</button>';

    if (state === "self") {
      primary = '<button class="gs-btn gs-btn-primary" data-pc-action="editProfile" data-pc-user="' + u + '">Edit Profile</button>';
    } else if (state === "eligible") {
      stateIcon = '<button class="gs-btn gs-btn-outline gs-btn-icon" data-pc-action="message" data-pc-user="' + u + '" title="Message" aria-label="Message"><i class="codicon codicon-mail"></i></button>';
      primary = followingBtn;
    } else if (state === "stranger") {
      // stranger now always means: I don't follow them yet.
      // Wave is the low-friction ice-breaker, Follow is the commit action.
      stateIcon = '<button class="gs-btn gs-btn-outline gs-btn-icon gs-pc-wave-btn" data-pc-action="wave" data-pc-user="' + u + '" title="Wave" aria-label="Wave"><span class="gs-pc-wave-emoji" aria-hidden="true">👋</span></button>';
      primary = '<button class="gs-btn gs-btn-primary" data-pc-action="follow" data-pc-user="' + u + '">Follow</button>';
    } else if (state === "not-on-gitchat") {
      primary = '<button class="gs-btn gs-btn-primary" data-pc-action="invite" data-pc-user="' + u + '">Invite</button>';
    }

    return ghBtn + stateIcon + primary;
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
      // Click is retired: hover is now the only entry point for the preview
      // popover. Delegate to ProfileCardHover which escalates to the full
      // overlay via its "View Profile" button.
      if (!el || !username) { return; }
      if (window.ProfileCardHover && window.ProfileCardHover.bindTrigger) {
        window.ProfileCardHover.bindTrigger(el, username);
      }
    },
  };
})();
