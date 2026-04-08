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
        if (tab === 'chat') {
          vscode.postMessage({ type: 'fetchChatData' });
        } else {
          vscode.postMessage({ type: 'switchTab', payload: { tab: tab } });
        }
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

  // ── Chat tab (embedded Inbox + Friends) ──────────────────────────
  var chatFriends = [];
  var chatConversations = [];
  var chatCurrentUser = null;
  var channelsList = [];
  var chatActiveTab = 'inbox';
  var chatFilter = 'all';
  var chatSearchQuery = '';
  var chatContextMenu = null;

  function chatTimeAgo(dateStr) {
    if (!dateStr) return '';
    var diff = Date.now() - new Date(dateStr).getTime();
    var mins = Math.floor(diff / 60000);
    if (mins < 1) return 'now';
    if (mins < 60) return mins + 'm';
    var hours = Math.floor(mins / 60);
    if (hours < 24) return hours + 'h';
    var days = Math.floor(hours / 24);
    if (days < 30) return days + 'd';
    return new Date(dateStr).toLocaleDateString();
  }

  function chatAvatarUrl(login) {
    return 'https://github.com/' + encodeURIComponent(login) + '.png?size=72';
  }

  // Chat inner tab switching
  document.querySelectorAll('.chat-tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      document.querySelectorAll('.chat-tab').forEach(function (t) { t.classList.remove('chat-tab-active'); });
      tab.classList.add('chat-tab-active');
      chatActiveTab = tab.dataset.chatTab;
      document.getElementById('chat-search-bar').style.display = chatActiveTab === 'friends' ? 'block' : 'none';
      document.getElementById('chat-filter-bar').style.display = chatActiveTab === 'inbox' ? 'flex' : 'none';
      var channelsPane = document.getElementById('chat-pane-channels');
      var chatContent = document.getElementById('chat-content');
      var chatEmpty = document.getElementById('chat-empty');
      if (chatActiveTab === 'channels') {
        if (channelsPane) { channelsPane.style.display = ''; }
        if (chatContent) { chatContent.style.display = 'none'; }
        if (chatEmpty) { chatEmpty.style.display = 'none'; }
        if (channelsList.length === 0) { vscode.postMessage({ type: 'fetchChannels' }); }
        renderChannels();
      } else {
        if (channelsPane) { channelsPane.style.display = 'none'; }
        if (chatContent) { chatContent.style.display = ''; }
        renderChat();
      }
    });
  });

  // Chat filter buttons
  document.querySelectorAll('.chat-filter-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.chat-filter-btn').forEach(function (b) { b.classList.remove('chat-filter-active'); });
      btn.classList.add('chat-filter-active');
      chatFilter = btn.dataset.filter;
      renderChat();
    });
  });

  // New chat button
  var chatNewBtn = document.getElementById('chat-new-btn');
  if (chatNewBtn) {
    chatNewBtn.addEventListener('click', function () {
      vscode.postMessage({ type: 'chatNewChat' });
    });
  }

  // Chat search
  var chatSearchInput = document.getElementById('chat-search');
  if (chatSearchInput) {
    chatSearchInput.addEventListener('input', function () {
      chatSearchQuery = chatSearchInput.value.toLowerCase();
      renderChat();
    });
  }

  // Context menu dismiss
  document.addEventListener('click', function () {
    if (chatContextMenu) { chatContextMenu.remove(); chatContextMenu = null; }
  });

  function renderChat() {
    updateChatCounts();
    if (chatActiveTab === 'friends') { renderChatFriends(); }
    else { renderChatInbox(); }
  }

  function updateChatCounts() {
    var inboxUnread = chatConversations.reduce(function (sum, c) {
      return sum + ((c.unread_count > 0 || c.is_unread) ? (c.unread_count || 1) : 0);
    }, 0);
    var el = document.getElementById('chat-inbox-count');
    if (el) { el.textContent = inboxUnread > 0 ? '(' + inboxUnread + ')' : ''; }
    var onlineCount = chatFriends.filter(function (f) { return f.online; }).length;
    var fel = document.getElementById('chat-friends-count');
    if (fel) { fel.textContent = '(' + onlineCount + '/' + chatFriends.length + ')'; }
  }

  function isGroupConv(c) {
    return c.type === 'group' || c.is_group === true || (c.participants && c.participants.length > 2);
  }

  function renderChatInbox() {
    var container = document.getElementById('chat-content');
    var empty = document.getElementById('chat-empty');
    var filtered = chatConversations;

    // Update filter counts
    var countAll = chatConversations.length;
    var countDirect = chatConversations.filter(function (c) { return !isGroupConv(c); }).length;
    var countGroup = chatConversations.filter(function (c) { return isGroupConv(c); }).length;
    var countUnread = chatConversations.filter(function (c) { return c.unread_count > 0 || c.is_unread; }).length;
    var setCount = function (id, n) { var e = document.getElementById(id); if (e) { e.textContent = n > 0 ? '(' + n + ')' : ''; } };
    setCount('chat-count-all', countAll);
    setCount('chat-count-direct', countDirect);
    setCount('chat-count-group', countGroup);
    setCount('chat-count-unread', countUnread);

    if (chatFilter === 'unread') { filtered = chatConversations.filter(function (c) { return c.unread_count > 0 || c.is_unread; }); }
    else if (chatFilter === 'direct') { filtered = chatConversations.filter(function (c) { return !isGroupConv(c); }); }
    else if (chatFilter === 'group') { filtered = chatConversations.filter(function (c) { return isGroupConv(c); }); }

    if (!filtered.length) {
      container.innerHTML = '';
      empty.style.display = 'block';
      empty.textContent = chatFilter === 'all' ? 'No conversations yet' : 'No ' + chatFilter + ' conversations';
      return;
    }
    empty.style.display = 'none';

    filtered.sort(function (a, b) {
      var aPinned = !!(a.pinned || a.pinned_at);
      var bPinned = !!(b.pinned || b.pinned_at);
      if (aPinned && !bPinned) return -1;
      if (!aPinned && bPinned) return 1;
      var aMuted = a.is_muted ? 1 : 0;
      var bMuted = b.is_muted ? 1 : 0;
      if (aMuted !== bMuted) return aMuted - bMuted;
      var dateA = new Date(a.last_message_at || a.updated_at || 0);
      var dateB = new Date(b.last_message_at || b.updated_at || 0);
      return dateB - dateA;
    });

    container.innerHTML = filtered.map(function (c) {
      var isGroup = isGroupConv(c);
      var name, avatar, subtitle;
      if (isGroup) {
        name = c.group_name || 'Group Chat';
        avatar = c.group_avatar_url || '';
        subtitle = (c.participants && c.participants.length || 0) + ' members';
      } else {
        var other = c.other_user;
        if (!other) return '';
        name = other.name || other.login;
        avatar = other.avatar_url || chatAvatarUrl(other.login || '');
        subtitle = '';
      }
      if (isGroup && !avatar && c.participants && c.participants.length > 0) {
        avatar = c.participants[0].avatar_url || chatAvatarUrl(c.participants[0].login || '');
      }
      var preview = c.last_message_preview || c.last_message_text || (c.last_message && (c.last_message.body || c.last_message.content)) || '';
      var time = chatTimeAgo(c.updated_at || c.last_message_at);
      var unread = c.unread_count > 0 || c.is_unread;
      var pin = (c.pinned || c.pinned_at) ? '<span class="codicon codicon-pin"></span> ' : '';
      var typeIcon = isGroup ? '<span class="codicon codicon-organization"></span> ' : '';
      var unreadBadge = unread ? '<span class="gs-badge">' + (c.unread_count || '') + '</span>' : '';
      var mutedIcon = c.is_muted ? '<span class="gs-text-xs" title="Muted"><span class="codicon codicon-bell-slash"></span></span>' : '';

      return '<div class="gs-list-item chat-conv-item' + (unread ? ' chat-conv-unread' : '') + (c.is_muted ? ' chat-conv-muted' : '') + '" data-id="' + c.id + '" data-pinned="' + !!(c.pinned || c.pinned_at) + '">' +
        '<img src="' + esc(avatar) + '" class="gs-avatar gs-avatar-md" style="' + (isGroup ? 'border-radius:8px' : '') + '" alt="">' +
        '<div class="gs-flex-1" style="min-width:0">' +
          '<div class="gs-flex gs-items-center gs-gap-4">' +
            '<span class="chat-conv-name gs-truncate">' + pin + typeIcon + esc(name) + '</span>' +
            mutedIcon +
            '<span class="gs-text-xs gs-text-muted gs-ml-auto gs-flex-shrink-0">' + time + '</span>' +
            unreadBadge +
          '</div>' +
          (subtitle ? '<div class="gs-text-xs gs-text-muted">' + esc(subtitle) + '</div>' : '') +
          '<div class="chat-conv-preview gs-text-sm gs-text-muted gs-truncate">' + esc(preview.slice(0, 80)) + '</div>' +
        '</div>' +
      '</div>';
    }).join('');

    container.querySelectorAll('.chat-conv-item').forEach(function (el) {
      el.addEventListener('click', function () {
        vscode.postMessage({ type: 'openConversation', payload: { conversationId: el.dataset.id } });
      });
      el.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        showChatContextMenu(e, el.dataset.id, el.dataset.pinned === 'true');
      });
    });
  }

  function renderChatFriends() {
    var container = document.getElementById('chat-content');
    var empty = document.getElementById('chat-empty');
    var filtered = chatFriends;
    if (chatSearchQuery) {
      filtered = chatFriends.filter(function (f) {
        return f.login.toLowerCase().includes(chatSearchQuery) || f.name.toLowerCase().includes(chatSearchQuery);
      });
    }
    if (!filtered.length) {
      container.innerHTML = '';
      empty.style.display = 'block';
      empty.textContent = chatSearchQuery ? 'No matches' : 'No friends yet. Follow people to see them here!';
      return;
    }
    empty.style.display = 'none';

    var online = filtered.filter(function (f) { return f.online; });
    var recent = filtered.filter(function (f) { return !f.online && f.lastSeen > 0 && (Date.now() - f.lastSeen < 3600000); });
    var offline = filtered.filter(function (f) { return !f.online && (f.lastSeen === 0 || Date.now() - f.lastSeen >= 3600000); });

    var html = '';
    function renderFriend(f) {
      var avatar = f.avatar_url || chatAvatarUrl(f.login);
      var dot = f.online ? '<span class="gs-dot-online"></span>' : '<span class="gs-dot-offline"></span>';
      var status = f.online ? 'online' : (f.lastSeen > 0 ? chatTimeAgo(new Date(f.lastSeen).toISOString()) + ' ago' : '');
      var unread = f.unread > 0 ? '<span class="gs-badge">' + f.unread + '</span>' : '';
      return '<div class="gs-list-item chat-friend-item" data-login="' + esc(f.login) + '">' +
        '<img src="' + esc(avatar) + '" class="gs-avatar gs-avatar-md" alt="">' +
        '<div class="gs-flex-1" style="min-width:0">' +
          '<div class="gs-flex gs-items-center gs-gap-4">' + dot +
            '<span class="gs-truncate" style="font-weight:500">' + esc(f.name) + '</span>' + unread +
          '</div>' +
          '<div class="gs-text-xs gs-text-muted">' + esc(status) + '</div>' +
        '</div>' +
        '<button class="gs-btn-icon chat-friend-msg-btn" data-login="' + esc(f.login) + '" title="Chat"><span class="codicon codicon-comment"></span></button>' +
      '</div>';
    }
    if (online.length) {
      html += '<div class="gs-section-title">Online (' + online.length + ')</div>';
      html += online.map(renderFriend).join('');
    }
    if (recent.length) {
      html += '<div class="gs-section-title">Recently Active</div>';
      html += recent.map(renderFriend).join('');
    }
    if (offline.length) {
      html += '<div class="gs-section-title">Offline</div>';
      html += offline.map(renderFriend).join('');
    }
    container.innerHTML = html;

    container.querySelectorAll('.chat-friend-item').forEach(function (el) {
      el.addEventListener('click', function () {
        vscode.postMessage({ type: 'chatOpenDM', payload: { login: el.dataset.login } });
      });
    });
    container.querySelectorAll('.chat-friend-msg-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        vscode.postMessage({ type: 'chatOpenDM', payload: { login: btn.dataset.login } });
      });
    });
  }

  function showChatContextMenu(e, convId, isPinned) {
    if (chatContextMenu) { chatContextMenu.remove(); }
    var menu = document.createElement('div');
    menu.className = 'chat-context-menu';
    menu.innerHTML =
      '<div class="chat-ctx-item" data-action="' + (isPinned ? 'chatUnpin' : 'chatPin') + '">' + (isPinned ? 'Unpin' : 'Pin') + '</div>' +
      '<div class="chat-ctx-item" data-action="chatMarkRead">Mark as read</div>';
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';
    document.body.appendChild(menu);
    chatContextMenu = menu;
    menu.querySelectorAll('.chat-ctx-item').forEach(function (item) {
      item.addEventListener('click', function (ev) {
        ev.stopPropagation();
        vscode.postMessage({ type: item.dataset.action, payload: { conversationId: convId } });
        menu.remove();
        chatContextMenu = null;
      });
    });
  }

  // ── Channels tab ─────────────────────────────────────────────────
  function renderChannels() {
    var listEl = document.getElementById('channels-list');
    var emptyEl = document.getElementById('channels-empty');
    if (!listEl || !emptyEl) { return; }

    if (channelsList.length === 0) {
      listEl.innerHTML = '';
      emptyEl.style.display = '';
      return;
    }
    emptyEl.style.display = 'none';

    listEl.innerHTML = channelsList.map(function (ch) {
      var avatar = ch.avatarUrl
        ? '<img class="channel-avatar" src="' + esc(ch.avatarUrl) + '" alt="" />'
        : '<div class="channel-avatar channel-avatar-placeholder"><span class="codicon codicon-megaphone"></span></div>';
      var badge = ch.role === 'owner' ? '<span class="channel-role-badge">Owner</span>'
        : ch.role === 'admin' ? '<span class="channel-role-badge">Admin</span>'
        : '';
      return '<div class="channel-item" data-channel-id="' + esc(ch.id) + '" data-repo-owner="' + esc(ch.repoOwner) + '" data-repo-name="' + esc(ch.repoName) + '">'
        + avatar
        + '<div class="channel-info">'
        + '<div class="channel-name">' + esc(ch.displayName || ch.repoOwner + '/' + ch.repoName) + ' ' + badge + '</div>'
        + '<div class="channel-meta">' + fmt(ch.subscriberCount) + ' subscribers</div>'
        + '</div>'
        + '</div>';
    }).join('');

    listEl.querySelectorAll('.channel-item').forEach(function (el) {
      el.addEventListener('click', function () {
        vscode.postMessage({
          type: 'openChannel',
          payload: {
            channelId: el.dataset.channelId,
            repoOwner: el.dataset.repoOwner,
            repoName: el.dataset.repoName,
          },
        });
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
    } else if (msg.type === 'setChatData') {
      chatFriends = msg.friends || [];
      chatConversations = msg.conversations || [];
      chatCurrentUser = msg.currentUser;
      renderChat();
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
    } else if (msg.type === 'setChannelData') {
      channelsList = msg.channels || [];
      renderChannels();
    }
  });

  // ── Init ─────────────────────────────────────────────────────────
  loadedTabs['repos'] = true;
  document.getElementById('repos-list').innerHTML = '<div class="ex-loading">Loading trending repos\u2026</div>';
  vscode.postMessage({ type: 'ready' });
})();
