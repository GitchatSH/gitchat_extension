(function () {
  const vscode = acquireVsCodeApi();

  function fmt(n) {
    if (n >= 1000) { return (n / 1000).toFixed(1) + 'k'; }
    return String(n || 0);
  }

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function renderPeople(people) {
    var list = document.getElementById('list');
    var empty = document.getElementById('empty');
    if (!people || !people.length) {
      list.innerHTML = '';
      empty.style.display = '';
      return;
    }
    empty.style.display = 'none';
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
              '<button class="tp-btn tp-follow-btn' + (p.following ? ' tp-btn-following' : '') + '" data-login="' + esc(p.login) + '" data-following="' + (p.following ? '1' : '0') + '">',
                p.following ? '✓ Following' : '+ Follow',
              '</button>',
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

    list.querySelectorAll('.tp-profile-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        vscode.postMessage({ type: 'viewProfile', payload: { login: btn.dataset.login } });
      });
    });

    list.querySelectorAll('.tp-card').forEach(function (card) {
      card.addEventListener('click', function () {
        vscode.postMessage({ type: 'viewProfile', payload: { login: card.dataset.login } });
      });
    });
  }

  window.addEventListener('message', function (event) {
    var msg = event.data;
    if (msg.type === 'setPeople') {
      renderPeople(msg.people);
    } else if (msg.type === 'followUpdate') {
      var btn = document.querySelector('.tp-follow-btn[data-login="' + msg.login + '"]');
      if (btn) {
        btn.dataset.following = msg.following ? '1' : '0';
        btn.classList.toggle('tp-btn-following', msg.following);
        btn.textContent = msg.following ? '✓ Following' : '+ Follow';
      }
    }
  });

  document.getElementById('list').innerHTML = '<div class="tp-loading">Loading trending developers…</div>';
  vscode.postMessage({ type: 'ready' });
})();
