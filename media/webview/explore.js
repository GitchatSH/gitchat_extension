(function () {
  // vscode is provided by shared.js which must be loaded first

  var LANG_COLORS = {
    'JavaScript': '#f1e05a', 'TypeScript': '#3178c6', 'Python': '#3572A5',
    'Go': '#00ADD8', 'Rust': '#dea584', 'Java': '#b07219', 'C++': '#f34b7d',
    'C': '#555555', 'C#': '#178600', 'Ruby': '#701516', 'PHP': '#4F5D95',
    'Swift': '#F05138', 'Kotlin': '#A97BFF', 'Shell': '#89e051',
    'HTML': '#e34c26', 'CSS': '#563d7c', 'Vue': '#41b883', 'Dart': '#00B4AB',
  };

  function fmt(n) { return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n || 0); }
  function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  // ── Tab switching ────────────────────────────────────────────────
  var activeTab = 'repos';
  var loadedTabs = {};

  document.querySelectorAll('.ex-tab').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var tab = btn.dataset.tab;
      if (tab === activeTab) { return; }
      activeTab = tab;
      document.querySelectorAll('.ex-tab').forEach(function (b) {
        b.classList.toggle('ex-tab-active', b.dataset.tab === tab);
      });
      document.querySelectorAll('.ex-pane').forEach(function (p) {
        p.style.display = p.dataset.pane === tab ? '' : 'none';
      });
      if (!loadedTabs[tab]) {
        loadedTabs[tab] = true;
        vscode.postMessage({ type: 'switchTab', payload: { tab: tab } });
      }
    });
  });

  // ── Repos tab ───────────────────────────────────────────────────
  var currentRange = 'weekly';
  var searchTimer = null;

  var searchInput = document.getElementById('repos-search');
  var rangesEl = document.getElementById('repos-ranges');

  searchInput.addEventListener('input', function () {
    clearTimeout(searchTimer);
    var q = searchInput.value.trim();
    if (q) {
      rangesEl.style.display = 'none';
      searchTimer = setTimeout(function () {
        document.getElementById('repos-list').innerHTML = '<div class="ex-loading">Searching…</div>';
        vscode.postMessage({ type: 'search', payload: { query: q } });
      }, 350);
    } else {
      rangesEl.style.display = '';
      vscode.postMessage({ type: 'refreshRepos' });
    }
  });

  rangesEl.querySelectorAll('.ex-range').forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (btn.dataset.range === currentRange) { return; }
      currentRange = btn.dataset.range;
      rangesEl.querySelectorAll('.ex-range').forEach(function (b) {
        b.classList.toggle('ex-range-active', b.dataset.range === currentRange);
      });
      document.getElementById('repos-list').innerHTML = '<div class="ex-loading">Loading…</div>';
      vscode.postMessage({ type: 'changeRange', payload: { range: currentRange } });
    });
  });

  function renderRepos(repos) {
    var list = document.getElementById('repos-list');
    if (!repos || !repos.length) {
      list.innerHTML = '<div class="gs-empty">No repos found.</div>';
      return;
    }
    list.innerHTML = repos.map(function (r, i) {
      var color = LANG_COLORS[r.language] || '#888';
      var isStarred = !!r.starred;
      var ownerAvatar = r.avatar_url || ('https://github.com/' + encodeURIComponent(r.owner) + '.png?size=48');
      return [
        '<div class="tr-card" data-owner="' + esc(r.owner) + '" data-repo="' + esc(r.name) + '">',
          '<div class="tr-header">',
            '<span class="tr-rank">' + (i + 1) + '</span>',
            '<img class="tr-owner-avatar" src="' + esc(ownerAvatar) + '" alt="">',
            '<div class="tr-title-wrap">',
              '<span class="tr-owner-name">' + esc(r.owner) + '</span>',
              '<span class="tr-name-sep">/</span>',
              '<span class="tr-repo-name">' + esc(r.name) + '</span>',
            '</div>',
            '<div class="tr-actions">',
              '<button class="tr-btn tr-fork-btn" data-owner="' + esc(r.owner) + '" data-repo="' + esc(r.name) + '" title="Fork">⑂</button>',
              '<button class="tr-btn tr-star-btn' + (isStarred ? ' tr-btn-starred' : '') + '" data-slug="' + esc(r.owner + '/' + r.name) + '" data-starred="' + (isStarred ? '1' : '0') + '" title="' + (isStarred ? 'Unstar' : 'Star') + '">' + (isStarred ? '⭐' : '☆') + '</button>',
            '</div>',
          '</div>',
          r.description ? '<div class="tr-desc">' + esc(r.description) + '</div>' : '',
          '<div class="tr-meta">',
            r.language ? '<span class="tr-lang"><span class="tr-lang-dot" style="background:' + color + '"></span>' + esc(r.language) + '</span>' : '',
            '<span class="tr-stat">⭐ ' + fmt(r.stars) + '</span>',
            r.forks ? '<span class="tr-stat">⑂ ' + fmt(r.forks) + '</span>' : '',
            r.topics && r.topics.length ? '<span class="tr-topic-pill">' + esc(r.topics[0]) + '</span>' : '',
          '</div>',
        '</div>',
      ].join('');
    }).join('');

    list.querySelectorAll('.tr-fork-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        vscode.postMessage({ type: 'fork', payload: { owner: btn.dataset.owner, repo: btn.dataset.repo } });
      });
    });
    list.querySelectorAll('.tr-star-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var slug = btn.dataset.slug;
        var isStarred = btn.dataset.starred === '1';
        btn.dataset.starred = isStarred ? '0' : '1';
        btn.classList.toggle('tr-btn-starred', !isStarred);
        btn.textContent = isStarred ? '☆' : '⭐';
        vscode.postMessage({ type: isStarred ? 'unstar' : 'star', payload: { slug: slug } });
      });
    });
    list.querySelectorAll('.tr-card').forEach(function (card) {
      card.addEventListener('click', function () {
        vscode.postMessage({ type: 'viewRepo', payload: { owner: card.dataset.owner, repo: card.dataset.repo } });
      });
    });
  }

  // ── People tab ───────────────────────────────────────────────────
  function renderPeople(people) {
    var list = document.getElementById('people-list');
    if (!people || !people.length) {
      list.innerHTML = '<div class="gs-empty">No trending developers found.</div>';
      return;
    }
    list.innerHTML = people.map(function (p) {
      var avatar = p.avatar_url || ('https://github.com/' + encodeURIComponent(p.login) + '.png?size=72');
      var displayName = p.name || p.login;
      var starPower = Math.round((p.star_power || 0) * 10) / 10;
      return [
        '<div class="tp-card" data-login="' + esc(p.login) + '">',
          '<img class="tp-avatar" src="' + esc(avatar) + '" alt="">',
          '<div class="tp-info">',
            '<div class="tp-name">' + esc(displayName) + '</div>',
            p.name ? '<div class="tp-login">@' + esc(p.login) + '</div>' : '',
            p.bio ? '<div class="tp-bio">' + esc(p.bio) + '</div>' : '',
            '<div class="tp-meta">',
              starPower ? '<span>⭐ ' + fmt(starPower) + ' star power</span>' : '',
              p.followers ? '<span>· ' + fmt(p.followers) + ' followers</span>' : '',
            '</div>',
            '<div class="tp-actions">',
              '<button class="tp-btn tp-follow-btn' + (p.following ? ' tp-btn-following' : '') + '" data-login="' + esc(p.login) + '" data-following="' + (p.following ? '1' : '0') + '">' + (p.following ? '✓ Following' : '+ Follow') + '</button>',
              '<button class="tp-btn tp-btn-primary tp-profile-btn" data-login="' + esc(p.login) + '">↗ Profile</button>',
            '</div>',
          '</div>',
        '</div>',
      ].join('');
    }).join('');

    list.querySelectorAll('.tp-follow-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var login = btn.dataset.login;
        var isFollowing = btn.dataset.following === '1';
        btn.dataset.following = isFollowing ? '0' : '1';
        btn.classList.toggle('tp-btn-following', !isFollowing);
        btn.textContent = isFollowing ? '+ Follow' : '✓ Following';
        vscode.postMessage({ type: isFollowing ? 'unfollow' : 'follow', payload: { login: login } });
      });
    });
    list.querySelectorAll('.tp-profile-btn, .tp-card').forEach(function (el) {
      el.addEventListener('click', function (e) {
        if (e.target.classList.contains('tp-follow-btn')) { return; }
        var login = el.dataset.login;
        if (login) { vscode.postMessage({ type: 'viewProfile', payload: { login: login } }); }
      });
    });
  }

  // ── My Repos tab ─────────────────────────────────────────────────
  function renderMyRepos(data) {
    var list = document.getElementById('myrepos-list');
    var groups = [
      { key: 'public', label: 'Public', repos: data.public || [] },
      { key: 'private', label: 'Private', repos: data.private || [] },
      { key: 'starred', label: 'Starred', repos: data.starred || [] },
    ].filter(function (g) { return g.repos.length > 0; });

    if (!groups.length) {
      list.innerHTML = '<div class="gs-empty">No repos found.</div>';
      return;
    }
    list.innerHTML = groups.map(function (g) {
      return '<div class="mr-group">' + esc(g.label) + ' (' + g.repos.length + ')</div>' +
        g.repos.map(function (r) {
          return [
            '<div class="mr-card" data-owner="' + esc(r.owner) + '" data-repo="' + esc(r.name) + '">',
              '<span class="mr-icon">' + (r.private ? '🔒' : '📁') + '</span>',
              '<div class="mr-info">',
                '<div class="mr-name">' + esc(r.name) + '</div>',
                r.description ? '<div class="mr-desc">' + esc(r.description) + '</div>' : '',
              '</div>',
              '<div class="mr-meta">⭐ ' + fmt(r.stars) + (r.language ? ' · ' + esc(r.language) : '') + '</div>',
            '</div>',
          ].join('');
        }).join('');
    }).join('');

    list.querySelectorAll('.mr-card').forEach(function (card) {
      card.addEventListener('click', function () {
        vscode.postMessage({ type: 'viewRepo', payload: { owner: card.dataset.owner, repo: card.dataset.repo } });
      });
    });
  }

  // ── Message handler ──────────────────────────────────────────────
  window.addEventListener('message', function (event) {
    var msg = event.data;
    if (msg.type === 'setRepos') {
      renderRepos(msg.repos);
    } else if (msg.type === 'starredUpdate') {
      var btn = document.querySelector('.tr-star-btn[data-slug="' + msg.slug + '"]');
      if (btn) {
        btn.dataset.starred = msg.starred ? '1' : '0';
        btn.classList.toggle('tr-btn-starred', msg.starred);
        btn.textContent = msg.starred ? '⭐' : '☆';
      }
    } else if (msg.type === 'setPeople') {
      renderPeople(msg.people);
    } else if (msg.type === 'followUpdate') {
      var fbtn = document.querySelector('.tp-follow-btn[data-login="' + msg.login + '"]');
      if (fbtn) {
        fbtn.dataset.following = msg.following ? '1' : '0';
        fbtn.classList.toggle('tp-btn-following', msg.following);
        fbtn.textContent = msg.following ? '✓ Following' : '+ Follow';
      }
    } else if (msg.type === 'setMyRepos') {
      renderMyRepos(msg.data);
    } else if (msg.type === 'setLoading') {
      document.getElementById('repos-list').innerHTML = '<div class="ex-loading">Searching…</div>';
    } else if (msg.type === 'error') {
      document.getElementById('repos-list').innerHTML = '<div class="ex-loading" style="color:var(--gs-error)">' + esc(msg.message) + '</div>';
    }
  });

  // ── Init ─────────────────────────────────────────────────────────
  loadedTabs['repos'] = true;
  document.getElementById('repos-list').innerHTML = '<div class="ex-loading">Loading trending repos…</div>';
  vscode.postMessage({ type: 'ready' });
})();
