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

  // ── Global Search ────────────────────────────────────────────────
  var searchMode = false;
  var searchDebounceTimer = null;
  var recentSearches = [];

  var searchHeaderEl = document.getElementById('explore-header');
  var searchInputEl = document.getElementById('global-search');
  var searchClearEl = document.getElementById('search-clear');
  var searchIconEl = document.querySelector('.search-wrapper .search-icon');
  var searchHomeEl = document.getElementById('search-home');
  var searchResultsEl = document.getElementById('search-results');

  function showSearchOverlay() {
    searchMode = true;
    searchHeaderEl.style.display = 'flex';
    // Hide tabs and all tab panes
    document.querySelector('.ex-tabs').style.display = 'none';
    document.querySelectorAll('.ex-pane').forEach(function (p) { p.style.display = 'none'; });
    // Show search home, hide results
    searchResultsEl.style.display = 'none';
    searchHomeEl.style.display = '';
    renderSearchHome();
    searchInputEl.focus();
    vscode.postMessage({ type: 'getRecentSearches' });
  }

  function hideSearchOverlay() {
    searchMode = false;
    searchInputEl.value = '';
    searchClearEl.style.display = 'none';
    searchIconEl.classList.remove('loading', 'codicon-loading');
    searchIconEl.classList.add('codicon-search');
    searchResultsEl.style.display = 'none';
    searchHomeEl.style.display = 'none';
    searchHeaderEl.style.display = 'none';
    // Restore tabs
    document.querySelector('.ex-tabs').style.display = '';
    document.querySelectorAll('.ex-pane').forEach(function (p) {
      p.style.display = p.dataset.pane === activeTab ? '' : 'none';
    });
  }

  function enterSearchResults() {
    searchHomeEl.style.display = 'none';
    searchResultsEl.style.display = 'flex';
  }

  function showSearchHome() {
    searchResultsEl.style.display = 'none';
    searchHomeEl.style.display = '';
    renderSearchHome();
  }

  function doGlobalSearch(query) {
    if (query.length < 2) { return; }
    enterSearchResults();
    searchIconEl.classList.remove('codicon-search');
    searchIconEl.classList.add('codicon-loading', 'loading');
    vscode.postMessage({ type: 'globalSearch', payload: { query: query } });
  }

  function fillSearch(query) {
    searchInputEl.value = query;
    searchClearEl.style.display = 'inline-flex';
    doGlobalSearch(query);
  }

  // Search input events
  searchInputEl.addEventListener('input', function () {
    var val = searchInputEl.value.trim();
    searchClearEl.style.display = val ? 'inline-flex' : 'none';
    clearTimeout(searchDebounceTimer);
    if (!val) {
      showSearchHome();
      return;
    }
    if (val.length >= 2) {
      searchDebounceTimer = setTimeout(function () { doGlobalSearch(val); }, 300);
    }
  });

  searchInputEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      var val = searchInputEl.value.trim();
      if (val.length >= 2) {
        clearTimeout(searchDebounceTimer);
        doGlobalSearch(val);
        vscode.postMessage({ type: 'saveRecentSearch', payload: { query: val } });
      }
    }
    if (e.key === 'Escape') {
      hideSearchOverlay();
      searchInputEl.blur();
    }
  });

  searchClearEl.addEventListener('click', function () {
    hideSearchOverlay();
  });

  // ── Search Home Rendering ────────────────────────────────────────
  // trendingReposCache and trendingPeopleCache are populated by message handler
  var trendingReposCache = [];
  var trendingPeopleCache = [];

  function renderSearchHome() {
    // Recent searches section
    var recentSection = document.getElementById('search-home-recent');
    var recentList = document.getElementById('search-home-recent-list');
    if (recentSearches.length > 0) {
      recentSection.style.display = '';
      recentList.innerHTML = recentSearches.map(function (q) {
        return '<div class="search-home-item" data-query="' + esc(q) + '">'
          + '<span class="codicon codicon-history"></span>'
          + '<span class="search-home-item-text">' + esc(q) + '</span>'
          + '<button class="search-home-remove codicon codicon-close" data-query="' + esc(q) + '" title="Remove"></button>'
          + '</div>';
      }).join('');
    } else {
      recentSection.style.display = 'none';
    }

    // Trending repos (top 5)
    var trendingReposSection = document.getElementById('search-home-trending-repos');
    var trendingReposList = document.getElementById('search-home-trending-repos-list');
    var topRepos = trendingReposCache.slice(0, 5).filter(function (r) { return r.name; });
    if (topRepos.length > 0) {
      trendingReposSection.style.display = '';
      trendingReposList.innerHTML = topRepos.map(function (r) {
        var name = esc((r.owner || '') + '/' + (r.name || ''));
        return '<div class="search-home-item" data-query="' + esc(r.name || '') + '">'
          + '<span class="codicon codicon-repo"></span>'
          + '<span class="search-home-item-text">' + name + '</span>'
          + '</div>';
      }).join('');
    } else {
      trendingReposSection.style.display = 'none';
    }

    // Trending people (top 5)
    var trendingPeopleSection = document.getElementById('search-home-trending-people');
    var trendingPeopleList = document.getElementById('search-home-trending-people-list');
    var topPeople = trendingPeopleCache.slice(0, 5).filter(function (p) { return p.login; });
    if (topPeople.length > 0) {
      trendingPeopleSection.style.display = '';
      trendingPeopleList.innerHTML = topPeople.map(function (p) {
        return '<div class="search-home-item" data-query="' + esc(p.login) + '">'
          + '<span class="codicon codicon-person"></span>'
          + '<span class="search-home-item-text">@' + esc(p.login) + '</span>'
          + '</div>';
      }).join('');
    } else {
      trendingPeopleSection.style.display = 'none';
    }
  }

  // Search home click delegation
  searchHomeEl.addEventListener('click', function (e) {
    var removeBtn = e.target.closest('.search-home-remove');
    if (removeBtn) {
      e.stopPropagation();
      var q = removeBtn.dataset.query;
      recentSearches = recentSearches.filter(function (s) { return s !== q; });
      vscode.postMessage({ type: 'clearRecentSearches' });
      recentSearches.slice().reverse().forEach(function (s) {
        vscode.postMessage({ type: 'saveRecentSearch', payload: { query: s } });
      });
      renderSearchHome();
      return;
    }
    var item = e.target.closest('.search-home-item');
    if (item && item.dataset.query) {
      fillSearch(item.dataset.query);
    }
  });

  var clearRecentBtn = document.getElementById('search-clear-recent');
  if (clearRecentBtn) {
    clearRecentBtn.addEventListener('click', function () {
      recentSearches = [];
      vscode.postMessage({ type: 'clearRecentSearches' });
      renderSearchHome();
    });
  }

  // ── Search Results Rendering ─────────────────────────────────────
  function renderSearchResults(repos, users) {
    searchIconEl.classList.remove('loading', 'codicon-loading');
    searchIconEl.classList.add('codicon-search');

    var reposList = document.getElementById('search-repos-list');
    var peopleList = document.getElementById('search-people-list');
    var reposCount = document.getElementById('search-repos-count');
    var peopleCount = document.getElementById('search-people-count');
    var emptyEl = document.getElementById('search-empty');
    var reposSection = document.getElementById('search-repos-section');
    var peopleSection = document.getElementById('search-people-section');

    if ((!repos || repos.length === 0) && (!users || users.length === 0)) {
      reposSection.style.display = 'none';
      peopleSection.style.display = 'none';
      emptyEl.style.display = 'block';
      emptyEl.textContent = "No results for '" + (searchInputEl.value.trim()) + "'";
      return;
    }

    emptyEl.style.display = 'none';

    if (repos && repos.length > 0) {
      reposSection.style.display = '';
      reposCount.textContent = '(' + repos.length + ')';
      reposList.innerHTML = repos.map(function (r) {
        var fullName = esc((r.owner || '') + '/' + (r.name || r.repo || ''));
        var desc = r.description ? esc(r.description) : '';
        var stars = r.stars != null ? fmt(r.stars) : '';
        var repoAvatar = r.avatar_url || ('https://github.com/' + encodeURIComponent(r.owner || '') + '.png?size=48');
        return '<div class="search-repo-item" data-owner="' + esc(r.owner || '') + '" data-repo="' + esc(r.name || r.repo || '') + '">'
          + '<img class="search-repo-avatar" src="' + esc(repoAvatar) + '" alt="">'
          + '<div class="search-repo-info">'
          + '<div class="search-repo-name">' + fullName + '</div>'
          + (desc ? '<div class="search-repo-desc">' + desc + '</div>' : '')
          + '</div>'
          + (stars ? '<span class="search-repo-stat">\u2605 ' + stars + '</span>' : '')
          + '</div>';
      }).join('');
    } else {
      reposSection.style.display = 'none';
    }

    if (users && users.length > 0) {
      peopleSection.style.display = '';
      peopleCount.textContent = '(' + users.length + ')';
      peopleList.innerHTML = users.map(function (u) {
        var login = esc(u.login || '');
        var name = u.name ? esc(u.name) : '';
        var bio = u.bio ? esc(u.bio) : '';
        var avatar = u.avatar_url || ('https://github.com/' + encodeURIComponent(u.login || '') + '.png?size=48');
        return '<div class="search-person-item" data-login="' + login + '">'
          + '<img class="search-person-avatar" src="' + esc(avatar) + '" alt="">'
          + '<div class="search-person-info">'
          + '<div class="search-person-name">' + (name ? name + ' <span style="color:var(--gs-muted);font-weight:400">@' + login + '</span>' : '@' + login) + '</div>'
          + (bio ? '<div class="search-person-bio">' + bio + '</div>' : '')
          + '</div>'
          + '</div>';
      }).join('');
    } else {
      peopleSection.style.display = 'none';
    }
  }

  function renderSearchError() {
    searchIconEl.classList.remove('loading', 'codicon-loading');
    searchIconEl.classList.add('codicon-search');
    document.getElementById('search-repos-section').style.display = 'none';
    document.getElementById('search-people-section').style.display = 'none';
    var emptyEl = document.getElementById('search-empty');
    emptyEl.style.display = 'block';
    emptyEl.textContent = 'Search failed. Try again.';
  }

  // Search results click delegation
  searchResultsEl.addEventListener('click', function (e) {
    var repoItem = e.target.closest('.search-repo-item');
    if (repoItem) {
      vscode.postMessage({ type: 'viewRepo', payload: { owner: repoItem.dataset.owner, repo: repoItem.dataset.repo } });
      return;
    }
    var personItem = e.target.closest('.search-person-item');
    if (personItem) {
      vscode.postMessage({ type: 'viewProfile', payload: { login: personItem.dataset.login } });
      return;
    }
  });

  // ── Repos tab ────────────────────────────────────────────────────
  var currentRange = 'weekly';
  var reposSearchTimer = null;

  var reposSearchInput = document.getElementById('repos-search');
  var rangesEl = document.getElementById('repos-ranges');

  reposSearchInput.addEventListener('input', function () {
    clearTimeout(reposSearchTimer);
    var q = reposSearchInput.value.trim();
    if (q) {
      rangesEl.style.display = 'none';
      reposSearchTimer = setTimeout(function () {
        document.getElementById('repos-list').innerHTML = '<div class="ex-loading">Searching\u2026</div>';
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
      document.getElementById('repos-list').innerHTML = '<div class="ex-loading">Loading\u2026</div>';
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
              '<button class="tr-btn tr-fork-btn" data-owner="' + esc(r.owner) + '" data-repo="' + esc(r.name) + '" title="Fork">\u2442</button>',
              '<button class="tr-btn tr-star-btn' + (isStarred ? ' tr-btn-starred' : '') + '" data-slug="' + esc(r.owner + '/' + r.name) + '" data-starred="' + (isStarred ? '1' : '0') + '" title="' + (isStarred ? 'Unstar' : 'Star') + '">' + (isStarred ? '\u2b50' : '\u2606') + '</button>',
            '</div>',
          '</div>',
          r.description ? '<div class="tr-desc">' + esc(r.description) + '</div>' : '',
          '<div class="tr-meta">',
            r.language ? '<span class="tr-lang"><span class="tr-lang-dot" style="background:' + color + '"></span>' + esc(r.language) + '</span>' : '',
            '<span class="tr-stat">\u2b50 ' + fmt(r.stars) + '</span>',
            r.forks ? '<span class="tr-stat">\u2442 ' + fmt(r.forks) + '</span>' : '',
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
        btn.textContent = isStarred ? '\u2606' : '\u2b50';
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
              starPower ? '<span>\u2b50 ' + fmt(starPower) + ' star power</span>' : '',
              p.followers ? '<span>\u00b7 ' + fmt(p.followers) + ' followers</span>' : '',
            '</div>',
            '<div class="tp-actions">',
              '<button class="tp-btn tp-follow-btn' + (p.following ? ' tp-btn-following' : '') + '" data-login="' + esc(p.login) + '" data-following="' + (p.following ? '1' : '0') + '">' + (p.following ? '\u2713 Following' : '+ Follow') + '</button>',
              '<button class="tp-btn tp-btn-primary tp-profile-btn" data-login="' + esc(p.login) + '">\u2197 Profile</button>',
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
        btn.textContent = isFollowing ? '+ Follow' : '\u2713 Following';
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
              '<span class="mr-icon">' + (r.private ? '\ud83d\udd12' : '\ud83d\udcc1') + '</span>',
              '<div class="mr-info">',
                '<div class="mr-name">' + esc(r.name) + '</div>',
                r.description ? '<div class="mr-desc">' + esc(r.description) + '</div>' : '',
              '</div>',
              '<div class="mr-meta">\u2b50 ' + fmt(r.stars) + (r.language ? ' \u00b7 ' + esc(r.language) : '') + '</div>',
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
      trendingReposCache = msg.repos || [];
      renderRepos(msg.repos);
    } else if (msg.type === 'starredUpdate') {
      var btn = document.querySelector('.tr-star-btn[data-slug="' + msg.slug + '"]');
      if (btn) {
        btn.dataset.starred = msg.starred ? '1' : '0';
        btn.classList.toggle('tr-btn-starred', msg.starred);
        btn.textContent = msg.starred ? '\u2b50' : '\u2606';
      }
    } else if (msg.type === 'setPeople') {
      trendingPeopleCache = msg.people || [];
      renderPeople(msg.people);
    } else if (msg.type === 'followUpdate') {
      var fbtn = document.querySelector('.tp-follow-btn[data-login="' + msg.login + '"]');
      if (fbtn) {
        fbtn.dataset.following = msg.following ? '1' : '0';
        fbtn.classList.toggle('tp-btn-following', msg.following);
        fbtn.textContent = msg.following ? '\u2713 Following' : '+ Follow';
      }
    } else if (msg.type === 'setMyRepos') {
      renderMyRepos(msg.data);
    } else if (msg.type === 'setLoading') {
      document.getElementById('repos-list').innerHTML = '<div class="ex-loading">Searching\u2026</div>';
    } else if (msg.type === 'error') {
      document.getElementById('repos-list').innerHTML = '<div class="ex-loading" style="color:var(--gs-error)">' + esc(msg.message) + '</div>';
    } else if (msg.type === 'showSearch') {
      showSearchOverlay();
    } else if (msg.type === 'recentSearches') {
      recentSearches = msg.searches || [];
      if (searchMode) { renderSearchHome(); }
    } else if (msg.type === 'globalSearchResults') {
      var payload = msg.payload || {};
      renderSearchResults(payload.repos || [], payload.users || []);
    } else if (msg.type === 'globalSearchError') {
      renderSearchError();
    }
  });

  // ── Init ─────────────────────────────────────────────────────────
  loadedTabs['repos'] = true;
  document.getElementById('repos-list').innerHTML = '<div class="ex-loading">Loading trending repos\u2026</div>';
  vscode.postMessage({ type: 'ready' });
})();
