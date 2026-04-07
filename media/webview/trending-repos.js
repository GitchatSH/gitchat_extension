(function () {
  // vscode is provided by shared.js which must be loaded first

  const LANG_COLORS = {
    'JavaScript': '#f1e05a', 'TypeScript': '#3178c6', 'Python': '#3572A5',
    'Go': '#00ADD8', 'Rust': '#dea584', 'Java': '#b07219', 'C++': '#f34b7d',
    'C': '#555555', 'C#': '#178600', 'Ruby': '#701516', 'PHP': '#4F5D95',
    'Swift': '#F05138', 'Kotlin': '#A97BFF', 'Shell': '#89e051',
    'HTML': '#e34c26', 'CSS': '#563d7c', 'Vue': '#41b883', 'Dart': '#00B4AB',
    'Scala': '#c22d40', 'R': '#198CE7', 'Jupyter Notebook': '#DA5B0B',
  };

  function fmt(n) {
    if (n >= 1000) { return (n / 1000).toFixed(1) + 'k'; }
    return String(n || 0);
  }

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Time range bar ──────────────────────────────────────────────
  var currentRange = 'weekly'; // matches tr-range-active in HTML and _timeRange default in TS

  var rangeBar = document.getElementById('ranges');
  rangeBar.querySelectorAll('.tr-range').forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (btn.dataset.range === currentRange) { return; }
      currentRange = btn.dataset.range;
      rangeBar.querySelectorAll('.tr-range').forEach(function (b) {
        b.classList.toggle('tr-range-active', b.dataset.range === currentRange);
      });
      document.getElementById('list').innerHTML = '<div class="tr-loading">Loading…</div>';
      vscode.postMessage({ type: 'changeRange', payload: { range: currentRange } });
    });
  });

  // ── Card rendering ───────────────────────────────────────────────
  function renderRepos(repos) {
    var list = document.getElementById('list');
    var empty = document.getElementById('empty');
    if (!repos || !repos.length) {
      list.innerHTML = '';
      empty.style.display = '';
      return;
    }
    empty.style.display = 'none';
    list.innerHTML = repos.map(function (r, i) {
      var color = LANG_COLORS[r.language] || '#888';
      var isStarred = !!r.starred;
      var ownerAvatar = r.avatar_url || ('https://github.com/' + encodeURIComponent(r.owner) + '.png?size=48');
      return [
        '<div class="tr-card" data-owner="' + esc(r.owner) + '" data-repo="' + esc(r.name) + '">',
          '<div class="tr-header">',
            '<span class="tr-rank">' + (i + 1) + '</span>',
            '<img class="tr-owner-avatar" src="' + esc(ownerAvatar) + '" alt="" aria-hidden="true">',
            '<div class="tr-title-wrap">',
              '<span class="tr-owner-name">' + esc(r.owner) + '</span>',
              '<span class="tr-name-sep">/</span>',
              '<span class="tr-repo-name">' + esc(r.name) + '</span>',
            '</div>',
            '<div class="tr-actions">',
              '<button class="tr-btn tr-fork-btn" data-owner="' + esc(r.owner) + '" data-repo="' + esc(r.name) + '" title="Fork on GitHub">⑂</button>',
              '<button class="tr-btn tr-star-btn' + (isStarred ? ' tr-btn-starred' : '') + '" data-slug="' + esc(r.owner + '/' + r.name) + '" data-starred="' + (isStarred ? '1' : '0') + '" title="' + (isStarred ? 'Unstar' : 'Star') + '">',
                isStarred ? '⭐' : '☆',
              '</button>',
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

    // Fork buttons
    list.querySelectorAll('.tr-fork-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        vscode.postMessage({ type: 'fork', payload: { owner: btn.dataset.owner, repo: btn.dataset.repo } });
      });
    });

    // Star buttons
    list.querySelectorAll('.tr-star-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var slug = btn.dataset.slug;
        var isStarred = btn.dataset.starred === '1';
        btn.dataset.starred = isStarred ? '0' : '1';
        btn.classList.toggle('tr-btn-starred', !isStarred);
        btn.textContent = isStarred ? '☆' : '⭐';
        btn.title = isStarred ? 'Star' : 'Unstar';
        vscode.postMessage({ type: isStarred ? 'unstar' : 'star', payload: { slug: slug } });
      });
    });

    // Click card → view repo
    list.querySelectorAll('.tr-card').forEach(function (card) {
      card.addEventListener('click', function () {
        vscode.postMessage({ type: 'viewRepo', payload: { owner: card.dataset.owner, repo: card.dataset.repo } });
      });
    });
  }

  window.addEventListener('message', function (event) {
    var msg = event.data;
    if (msg.type === 'setRepos') {
      renderRepos(msg.repos);
    } else if (msg.type === 'error') {
      document.getElementById('list').innerHTML = '<div class="tr-loading" style="color:var(--gs-error)">' + esc(msg.message) + '</div>';
    } else if (msg.type === 'starredUpdate') {
      var btn = document.querySelector('.tr-star-btn[data-slug="' + msg.slug + '"]');
      if (btn) {
        btn.dataset.starred = msg.starred ? '1' : '0';
        btn.classList.toggle('tr-btn-starred', msg.starred);
        btn.textContent = msg.starred ? '⭐' : '☆';
        btn.title = msg.starred ? 'Unstar' : 'Star';
      }
    }
  });

  document.getElementById('list').innerHTML = '<div class="tr-loading">Loading trending repos…</div>';
  vscode.postMessage({ type: 'ready' });
})();
