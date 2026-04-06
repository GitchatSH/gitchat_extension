(function () {
  const vscode = acquireVsCodeApi();

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

  function renderRepos(repos) {
    const list = document.getElementById('list');
    const empty = document.getElementById('empty');
    if (!repos || !repos.length) {
      list.innerHTML = '';
      empty.style.display = '';
      return;
    }
    empty.style.display = 'none';
    list.innerHTML = repos.map(function (r, i) {
      const color = LANG_COLORS[r.language] || '#888';
      return [
        '<div class="tr-card" data-owner="' + esc(r.owner) + '" data-repo="' + esc(r.name) + '">',
          '<div class="tr-rank">#' + (i + 1) + '</div>',
          '<div class="tr-owner">' + esc(r.owner) + '</div>',
          '<div class="tr-name">' + esc(r.name) + '</div>',
          r.description ? '<div class="tr-desc">' + esc(r.description) + '</div>' : '',
          '<div class="tr-meta">',
            r.language ? '<span class="tr-lang"><span class="tr-lang-dot" style="background:' + color + '"></span>' + esc(r.language) + '</span>' : '',
            '<span class="tr-stat">⭐ ' + fmt(r.stars) + '</span>',
            r.forks ? '<span class="tr-stat">🍴 ' + fmt(r.forks) + '</span>' : '',
          '</div>',
          '<div class="tr-actions">',
            '<button class="tr-btn tr-star-btn' + (r.starred ? ' tr-btn-starred' : '') + '" data-slug="' + esc(r.slug) + '" data-starred="' + (r.starred ? '1' : '0') + '">',
              r.starred ? '⭐ Starred' : '☆ Star',
            '</button>',
            '<button class="tr-btn tr-btn-primary tr-view-btn" data-owner="' + esc(r.owner) + '" data-repo="' + esc(r.name) + '">↗ View</button>',
          '</div>',
        '</div>',
      ].join('');
    }).join('');

    list.querySelectorAll('.tr-star-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        const slug = btn.dataset.slug;
        const isStarred = btn.dataset.starred === '1';
        btn.dataset.starred = isStarred ? '0' : '1';
        btn.classList.toggle('tr-btn-starred', !isStarred);
        btn.textContent = isStarred ? '☆ Star' : '⭐ Starred';
        vscode.postMessage({ type: isStarred ? 'unstar' : 'star', payload: { slug: slug } });
      });
    });

    list.querySelectorAll('.tr-view-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        vscode.postMessage({ type: 'viewRepo', payload: { owner: btn.dataset.owner, repo: btn.dataset.repo } });
      });
    });

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
    } else if (msg.type === 'starredUpdate') {
      var btn = document.querySelector('.tr-star-btn[data-slug="' + msg.slug + '"]');
      if (btn) {
        btn.dataset.starred = msg.starred ? '1' : '0';
        btn.classList.toggle('tr-btn-starred', msg.starred);
        btn.textContent = msg.starred ? '⭐ Starred' : '☆ Star';
      }
    }
  });

  document.getElementById('list').innerHTML = '<div class="tr-loading">Loading trending repos…</div>';
  vscode.postMessage({ type: 'ready' });
})();
