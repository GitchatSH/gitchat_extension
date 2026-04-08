(function () {
  // vscode is provided by shared.js which must be loaded first

  function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  function timeAgo(dateStr) {
    if (!dateStr) { return ''; }
    var d = new Date(dateStr);
    var now = Date.now();
    var diff = Math.floor((now - d.getTime()) / 1000);
    if (diff < 60) { return diff + 's ago'; }
    if (diff < 3600) { return Math.floor(diff / 60) + 'm ago'; }
    if (diff < 86400) { return Math.floor(diff / 3600) + 'h ago'; }
    if (diff < 604800) { return Math.floor(diff / 86400) + 'd ago'; }
    return d.toLocaleDateString();
  }

  // ── State ────────────────────────────────────────────────────────
  var activeSource = 'x';
  var feedData = { x: [], youtube: [], gitstar: [], github: [] };
  var nextCursors = { x: null, youtube: null, gitstar: null, github: null };
  var loadedSources = {};
  var isSubscribed = false;

  // ── Elements ─────────────────────────────────────────────────────
  var channelNameEl = document.getElementById('channel-name');
  var subscribeBtnEl = document.getElementById('subscribe-btn');
  var feedItemsEl = document.getElementById('feed-items');
  var loadingEl = document.getElementById('channel-loading');
  var emptyEl = document.getElementById('channel-empty');
  var loadMoreWrapEl = document.getElementById('load-more-wrap');
  var loadMoreBtnEl = document.getElementById('load-more-btn');
  var adminPostEl = document.getElementById('admin-post');
  var adminPostInputEl = document.getElementById('admin-post-input');
  var adminPostSubmitEl = document.getElementById('admin-post-submit');

  // ── Tab switching ─────────────────────────────────────────────────
  document.querySelectorAll('.channel-tab').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var src = btn.dataset.source;
      if (src === activeSource) { return; }
      activeSource = src;
      document.querySelectorAll('.channel-tab').forEach(function (b) {
        b.classList.toggle('channel-tab-active', b.dataset.source === src);
      });
      if (!loadedSources[src]) {
        loadedSources[src] = true;
        showLoading();
        vscode.postMessage({ type: 'fetchFeed', payload: { source: src } });
      } else {
        renderFeed();
      }
    });
  });

  // ── Subscribe button ──────────────────────────────────────────────
  subscribeBtnEl.addEventListener('click', function () {
    if (isSubscribed) {
      vscode.postMessage({ type: 'unsubscribe', payload: {} });
    } else {
      vscode.postMessage({ type: 'subscribe', payload: {} });
    }
  });

  // ── Load more button ──────────────────────────────────────────────
  loadMoreBtnEl.addEventListener('click', function () {
    var cursor = nextCursors[activeSource];
    if (!cursor) { return; }
    loadMoreBtnEl.disabled = true;
    vscode.postMessage({ type: 'fetchFeed', payload: { source: activeSource, cursor: cursor } });
  });

  // ── Admin post submit ─────────────────────────────────────────────
  adminPostSubmitEl.addEventListener('click', function () {
    var body = adminPostInputEl.value.trim();
    if (!body) { return; }
    adminPostSubmitEl.disabled = true;
    vscode.postMessage({ type: 'adminPost', payload: { body: body } });
  });

  // ── Rendering helpers ─────────────────────────────────────────────
  function showLoading() {
    loadingEl.style.display = '';
    emptyEl.style.display = 'none';
    feedItemsEl.innerHTML = '';
    loadMoreWrapEl.style.display = 'none';
  }

  function renderFeed() {
    loadingEl.style.display = 'none';
    var items = feedData[activeSource] || [];
    if (items.length === 0) {
      emptyEl.style.display = '';
      feedItemsEl.innerHTML = '';
      loadMoreWrapEl.style.display = 'none';
      return;
    }
    emptyEl.style.display = 'none';
    var html = '';
    if (activeSource === 'x' || activeSource === 'youtube') {
      html = items.map(renderSocialPost).join('');
    } else if (activeSource === 'gitstar') {
      html = items.map(renderGitstarPost).join('');
    } else if (activeSource === 'github') {
      html = items.map(renderGitHubEvent).join('');
    }
    feedItemsEl.innerHTML = html;
    loadMoreWrapEl.style.display = nextCursors[activeSource] ? '' : 'none';
    loadMoreBtnEl.disabled = false;
  }

  function appendFeedItems(items) {
    if (!items || items.length === 0) { return; }
    var html = '';
    if (activeSource === 'x' || activeSource === 'youtube') {
      html = items.map(renderSocialPost).join('');
    } else if (activeSource === 'gitstar') {
      html = items.map(renderGitstarPost).join('');
    } else if (activeSource === 'github') {
      html = items.map(renderGitHubEvent).join('');
    }
    feedItemsEl.insertAdjacentHTML('beforeend', html);
    loadMoreWrapEl.style.display = nextCursors[activeSource] ? '' : 'none';
    loadMoreBtnEl.disabled = false;
  }

  function stripAt(h) { return h && h.charAt(0) === '@' ? h.slice(1) : (h || ''); }

  function renderSocialPost(post) {
    var platform = esc(post.platform || '');
    var badgeClass = platform === 'youtube' ? 'channel-badge-youtube' : 'channel-badge-x';
    var badgeLabel = platform === 'youtube' ? 'YouTube' : 'X';
    var handle = stripAt(post.authorHandle || '');
    var name = post.authorName || handle || '';
    var avatar = post.authorAvatar
      ? '<img class="channel-post-avatar" src="' + esc(post.authorAvatar) + '" alt="">'
      : '<span class="channel-post-avatar channel-post-avatar-placeholder">' + esc(name.charAt(0) || '?') + '</span>';
    var mediaHtml = '';
    var mediaUrls = post.mediaUrls || [];
    if (mediaUrls.length > 0) {
      mediaHtml = '<div class="channel-post-images">' + mediaUrls.map(function (url) {
        return '<img class="channel-post-image" src="' + esc(url) + '" alt="">';
      }).join('') + '</div>';
    }
    var eng = post.engagement || {};
    var engParts = [];
    if (eng.replies > 0) { engParts.push('<span class="channel-eng-item"><span class="codicon codicon-comment"></span> ' + eng.replies + '</span>'); }
    if (eng.reposts > 0) { engParts.push('<span class="channel-eng-item"><span class="codicon codicon-sync"></span> ' + eng.reposts + '</span>'); }
    if (eng.likes > 0) { engParts.push('<span class="channel-eng-item"><span class="codicon codicon-heart"></span> ' + eng.likes + '</span>'); }
    if (eng.views > 0) { engParts.push('<span class="channel-eng-item"><span class="codicon codicon-eye"></span> ' + eng.views + '</span>'); }
    var engHtml = engParts.length > 0 ? '<div class="channel-post-engagement">' + engParts.join('') + '</div>' : '';
    return '<div class="channel-post">'
      + '<div class="channel-post-header">'
      + avatar
      + '<div class="channel-post-meta">'
      + '<span class="channel-post-name">' + esc(name) + '</span>'
      + (handle ? '<span class="channel-post-handle">@' + esc(handle) + '</span>' : '')
      + '</div>'
      + '<span class="channel-post-badge ' + badgeClass + '">' + badgeLabel + '</span>'
      + '<span class="channel-post-time">' + timeAgo(post.platformCreatedAt) + '</span>'
      + '</div>'
      + '<div class="channel-post-body">' + esc(post.body || '') + '</div>'
      + mediaHtml
      + engHtml
      + '</div>';
  }

  function renderGitstarPost(post) {
    var avatar = post.authorAvatar
      ? '<img class="channel-post-avatar" src="' + esc(post.authorAvatar) + '" alt="">'
      : '<span class="channel-post-avatar channel-post-avatar-placeholder codicon codicon-person"></span>';
    var images = '';
    if (post.imageUrls && post.imageUrls.length > 0) {
      images = '<div class="channel-post-images">'
        + post.imageUrls.map(function (url) {
          return '<img class="channel-post-image" src="' + esc(url) + '" alt="">';
        }).join('')
        + '</div>';
    }
    return '<div class="channel-post">'
      + '<div class="channel-post-header">'
      + avatar
      + '<div class="channel-post-meta">'
      + '<span class="channel-post-name">' + esc(post.authorName || post.authorLogin || '') + '</span>'
      + '<span class="channel-post-handle">@' + esc(post.authorLogin || '') + '</span>'
      + '</div>'
      + '<span class="channel-post-badge channel-badge-gitstar">Gitstar</span>'
      + '<span class="channel-post-time">' + timeAgo(post.createdAt) + '</span>'
      + '</div>'
      + '<div class="channel-post-body">' + esc(post.body || '') + '</div>'
      + images
      + '</div>';
  }

  var EVENT_ICONS = {
    PushEvent: 'codicon-git-commit',
    PullRequestEvent: 'codicon-git-pull-request',
    IssuesEvent: 'codicon-issues',
    IssueCommentEvent: 'codicon-comment',
    WatchEvent: 'codicon-star',
    ForkEvent: 'codicon-repo-forked',
    ReleaseEvent: 'codicon-tag',
    CreateEvent: 'codicon-add',
    DeleteEvent: 'codicon-trash',
    PublicEvent: 'codicon-globe',
  };

  function renderGitHubEvent(event) {
    var icon = EVENT_ICONS[event.type] || 'codicon-git-commit';
    var title = event.prTitle || event.issueTitle || event.releaseTag || event.type || '';
    var repoFull = esc((event.repoOwner || '') + '/' + (event.repoName || ''));
    return '<div class="channel-post channel-post-event">'
      + '<div class="channel-post-header">'
      + '<span class="channel-event-icon codicon ' + icon + '"></span>'
      + '<div class="channel-post-meta">'
      + '<span class="channel-post-name">@' + esc(event.actorLogin || '') + '</span>'
      + '<span class="channel-event-repo">' + repoFull + '</span>'
      + '</div>'
      + '<span class="channel-post-time">' + timeAgo(event.eventCreatedAt) + '</span>'
      + '</div>'
      + (title ? '<div class="channel-post-body">' + esc(title) + '</div>' : '')
      + (event.narrationBody ? '<div class="channel-event-narration">' + esc(event.narrationBody) + '</div>' : '')
      + '</div>';
  }

  // ── Message listener ──────────────────────────────────────────────
  window.addEventListener('message', function (e) {
    var msg = e.data;
    switch (msg.type) {
      case 'channelInfo': {
        var ch = msg.payload;
        if (channelNameEl) {
          channelNameEl.textContent = (ch.repoOwner || '') + '/' + (ch.repoName || '');
        }
        isSubscribed = ch.role === 'subscriber' || ch.role === 'admin' || ch.role === 'member';
        subscribeBtnEl.textContent = isSubscribed ? 'Subscribed' : 'Subscribe';
        subscribeBtnEl.dataset.subscribed = isSubscribed ? 'true' : 'false';
        subscribeBtnEl.classList.toggle('channel-subscribe-btn-active', isSubscribed);
        if (ch.role === 'admin') {
          adminPostEl.style.display = '';
        }
        break;
      }
      case 'feedData': {
        var p = msg.payload;
        var src = p.source;
        var incoming = p.items || [];
        // DEBUG removed
        var isCursor = !!(p.cursor || (incoming.length > 0 && feedData[src].length > 0 && p.nextCursor !== undefined && p.items !== undefined && feedData[src].length > 0));
        // Detect append vs replace: if there are already items and cursor was used
        if (feedData[src].length > 0 && !p.isFirst) {
          // Appending (load more)
          feedData[src] = feedData[src].concat(incoming);
          nextCursors[src] = p.nextCursor;
          if (src === activeSource) { appendFeedItems(incoming); }
        } else {
          feedData[src] = incoming;
          nextCursors[src] = p.nextCursor;
          if (src === activeSource) { renderFeed(); }
        }
        break;
      }
      case 'subscribeResult': {
        isSubscribed = msg.subscribed;
        subscribeBtnEl.textContent = isSubscribed ? 'Subscribed' : 'Subscribe';
        subscribeBtnEl.dataset.subscribed = isSubscribed ? 'true' : 'false';
        subscribeBtnEl.classList.toggle('channel-subscribe-btn-active', isSubscribed);
        break;
      }
      case 'postCreated': {
        adminPostInputEl.value = '';
        adminPostSubmitEl.disabled = false;
        // Refresh gitstar feed to show new post
        feedData['gitstar'] = [];
        nextCursors['gitstar'] = null;
        loadedSources['gitstar'] = true;
        if (activeSource === 'gitstar') { showLoading(); }
        vscode.postMessage({ type: 'fetchFeed', payload: { source: 'gitstar' } });
        break;
      }
    }
  });

  // ── Init ──────────────────────────────────────────────────────────
  loadedSources['x'] = true;
  vscode.postMessage({ type: 'ready', payload: {} });
})();
