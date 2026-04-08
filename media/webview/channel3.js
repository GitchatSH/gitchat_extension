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
  var feedData = { x: [], youtube: [], gitstar: [], discussion: [] };
  var nextCursors = { x: null, youtube: null, gitstar: null, discussion: null };
  var loadedSources = {};
  var isSubscribed = false;
  var discCategoriesLoaded = false;

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
  document.querySelectorAll('.channel-filter-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var src = btn.dataset.source;
      if (src === activeSource) { return; }
      activeSource = src;
      document.querySelectorAll('.channel-filter-btn').forEach(function (b) {
        b.classList.toggle('channel-filter-active', b.dataset.source === src);
      });
      // Show/hide discussion filter bar
      var discFilters = document.getElementById('disc-filters');
      if (discFilters) { discFilters.style.display = src === 'discussion' ? '' : 'none'; }
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
  // ── Discussion category filter ─────────────────────────────────────
  var discCategorySelect = document.getElementById('disc-category-select');
  if (discCategorySelect) {
    discCategorySelect.addEventListener('change', function () {
      var catId = discCategorySelect.value;
      feedData['discussion'] = [];
      nextCursors['discussion'] = null;
      showLoading();
      vscode.postMessage({ type: 'fetchFeed', payload: { source: 'discussion', categoryId: catId } });
    });
  }

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

  var emptyMessages = {};

  function renderFeed() {
    loadingEl.style.display = 'none';
    var items = feedData[activeSource] || [];
    if (items.length === 0) {
      var msg = emptyMessages[activeSource] || 'No posts yet';
      emptyEl.innerHTML = '<span class="codicon codicon-inbox"></span><p>' + esc(msg) + '</p>';
      emptyEl.style.display = '';
      feedItemsEl.innerHTML = '';
      loadMoreWrapEl.style.display = 'none';
      return;
    }
    emptyEl.style.display = 'none';
    var html = '';
    if (activeSource === 'x') {
      html = items.map(renderSocialPost).join('');
    } else if (activeSource === 'youtube') {
      html = items.map(renderYouTubeVideo).join('');
    } else if (activeSource === 'gitstar') {
      html = items.map(renderGitstarPost).join('');
    } else if (activeSource === 'discussion') {
      html = items.map(renderDiscussion).join('');
    }
    feedItemsEl.innerHTML = html;
    bindThumbClicks();
    loadMoreWrapEl.style.display = nextCursors[activeSource] ? '' : 'none';
    loadMoreBtnEl.disabled = false;
  }

  function bindThumbClicks() {
    feedItemsEl.querySelectorAll('.channel-yt-thumb').forEach(function (el) {
      el.addEventListener('click', function () {
        var videoId = el.dataset.videoid;
        if (!videoId) { return; }
        vscode.postMessage({ type: 'openExternal', payload: { url: 'https://www.youtube.com/watch?v=' + videoId } });
      });
    });
    // Discussion click → open in browser
    feedItemsEl.querySelectorAll('.channel-post-disc').forEach(function (el) {
      el.addEventListener('click', function () {
        var url = el.dataset.url;
        if (url) { vscode.postMessage({ type: 'openExternal', payload: { url: url } }); }
      });
    });
    // Show comments buttons
    feedItemsEl.querySelectorAll('.channel-yt-show-comments').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var videoId = btn.dataset.videoid;
        var commentsEl = feedItemsEl.querySelector('.channel-yt-comments[data-videoid="' + videoId + '"]');
        if (!commentsEl) { return; }
        if (commentsEl.style.display !== 'none') {
          commentsEl.style.display = 'none';
          btn.innerHTML = btn.innerHTML.replace('Hide', 'Show');
          return;
        }
        commentsEl.style.display = '';
        btn.innerHTML = btn.innerHTML.replace('Show', 'Hide');
        if (commentsEl.dataset.loaded) { return; }
        commentsEl.dataset.loaded = 'true';
        commentsEl.innerHTML = '<span class="channel-yt-comments-loading">Loading comments...</span>';
        vscode.postMessage({ type: 'fetchYouTubeComments', payload: { videoId: videoId } });
      });
    });
  }

  function appendFeedItems(items) {
    if (!items || items.length === 0) { return; }
    var html = '';
    if (activeSource === 'x') {
      html = items.map(renderSocialPost).join('');
    } else if (activeSource === 'youtube') {
      html = items.map(renderYouTubeVideo).join('');
    } else if (activeSource === 'gitstar') {
      html = items.map(renderGitstarPost).join('');
    } else if (activeSource === 'discussion') {
      html = items.map(renderDiscussion).join('');
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

  function fmtNum(n) {
    if (!n || n <= 0) { return '0'; }
    if (n >= 1000000) { return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M'; }
    if (n >= 1000) { return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K'; }
    return String(n);
  }

  function renderYouTubeVideo(post) {
    var pd = post.platformData || {};
    var videoId = pd.video_id || pd.videoId || '';
    var thumbnailUrl = pd.thumbnail_url || pd.thumbnailUrl || (videoId ? 'https://img.youtube.com/vi/' + esc(videoId) + '/hqdefault.jpg' : '');
    var channelName = pd.channel_handle || pd.channelHandle || post.authorName || '';
    var bodyLines = (post.body || '').split('\n');
    var title = bodyLines[0] || '';
    var eng = post.engagement || {};
    var viewCount = eng.views || 0;
    var likeCount = eng.likes || 0;
    var commentCount = eng.replies || 0;

    var thumbHtml = thumbnailUrl
      ? '<div class="channel-yt-thumb" data-videoid="' + esc(videoId) + '" title="Watch on YouTube">'
        + '<img class="channel-yt-thumb-img" src="' + esc(thumbnailUrl) + '" alt="" />'
        + '<span class="channel-yt-play-btn"><svg height="48" width="68" viewBox="0 0 68 48"><path class="channel-yt-play-bg" d="M66.52 7.74c-.78-2.93-2.49-5.41-5.42-6.19C55.79.13 34 0 34 0S12.21.13 6.9 1.55C3.97 2.33 2.27 4.81 1.48 7.74.06 13.05 0 24 0 24s.06 10.95 1.48 16.26c.78 2.93 2.49 5.41 5.42 6.19C12.21 47.87 34 48 34 48s21.79-.13 27.1-1.55c2.93-.78 4.64-3.26 5.42-6.19C67.94 34.95 68 24 68 24s-.06-10.95-1.48-16.26z" fill="#FF0000"/><path d="M45 24L27 14v20" fill="#fff"/></svg></span>'
        + '</div>'
      : '';

    var statsHtml = '<div class="channel-yt-stats">'
      + '<span class="channel-yt-stat"><span class="codicon codicon-eye"></span> ' + fmtNum(viewCount) + '</span>'
      + '<span class="channel-yt-stat"><span class="codicon codicon-thumbsup"></span> ' + fmtNum(likeCount) + '</span>'
      + '<span class="channel-yt-stat"><span class="codicon codicon-comment-discussion"></span> ' + fmtNum(commentCount) + '</span>'
      + '</div>';

    var commentsBtn = commentCount > 0
      ? '<button class="channel-yt-show-comments" data-videoid="' + esc(videoId) + '"><span class="codicon codicon-arrow-right"></span> Show ' + fmtNum(commentCount) + ' comment' + (commentCount !== 1 ? 's' : '') + '</button>'
      : '';

    return '<div class="channel-post channel-post-yt">'
      + '<div class="channel-yt-header">'
      + '<span class="channel-post-badge channel-badge-youtube">YouTube</span>'
      + '<span class="channel-post-time">' + timeAgo(post.platformCreatedAt) + '</span>'
      + '</div>'
      + thumbHtml
      + '<div class="channel-yt-title">' + esc(title) + '</div>'
      + '<div class="channel-yt-channel">' + esc(channelName) + '</div>'
      + statsHtml
      + commentsBtn
      + '<div class="channel-yt-comments" data-videoid="' + esc(videoId) + '" style="display:none"></div>'
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

  // GitHub emoji shortcodes → Unicode
  var EMOJI_MAP = {
    ':raised_hands:': '\uD83D\uDE4C', ':bulb:': '\uD83D\uDCA1', ':pray:': '\uD83D\uDE4F',
    ':speech_balloon:': '\uD83D\uDCAC', ':mega:': '\uD83D\uDCE3', ':rocket:': '\uD83D\uDE80',
    ':bug:': '\uD83D\uDC1B', ':star:': '\u2B50', ':question:': '\u2753', ':hash:': '#\uFE0F\u20E3',
    ':tada:': '\uD83C\uDF89', ':heart:': '\u2764\uFE0F', ':fire:': '\uD83D\uDD25',
    ':warning:': '\u26A0\uFE0F', ':gear:': '\u2699\uFE0F', ':book:': '\uD83D\uDCD6',
    ':pencil:': '\u270F\uFE0F', ':wrench:': '\uD83D\uDD27', ':package:': '\uD83D\uDCE6',
    ':shield:': '\uD83D\uDEE1\uFE0F', ':zap:': '\u26A1', ':link:': '\uD83D\uDD17',
    ':100:': '\uD83D\uDCAF', ':eyes:': '\uD83D\uDC40', ':thumbsup:': '\uD83D\uDC4D',
    ':handshake:': '\uD83E\uDD1D', ':clipboard:': '\uD83D\uDCCB', ':lock:': '\uD83D\uDD12',
  };
  function resolveEmoji(str) {
    if (!str) { return ''; }
    return str.replace(/:[a-z0-9_]+:/g, function (match) { return EMOJI_MAP[match] || match; });
  }

  function renderDiscussion(d) {
    var avatar = d.authorAvatar
      ? '<img class="channel-post-avatar" src="' + esc(d.authorAvatar) + '" alt="">'
      : '<span class="channel-post-avatar channel-post-avatar-placeholder">' + esc((d.authorLogin || '?').charAt(0)) + '</span>';
    var categoryHtml = d.category
      ? '<span class="channel-disc-category">' + (d.categoryEmoji ? resolveEmoji(d.categoryEmoji) + ' ' : '') + esc(d.category) + '</span>'
      : '';
    var bodyPreview = (d.body || '').length > 280
      ? esc(d.body.slice(0, 280)) + '<span class="channel-disc-more">... Show more</span>'
      : esc(d.body || '');
    var statsHtml = '<div class="channel-post-engagement">'
      + (d.commentCount > 0 ? '<span class="channel-eng-item"><span class="codicon codicon-comment-discussion"></span> ' + d.commentCount + '</span>' : '')
      + (d.reactionCount > 0 ? '<span class="channel-eng-item"><span class="codicon codicon-reactions"></span> ' + d.reactionCount + '</span>' : '')
      + (d.upvoteCount > 0 ? '<span class="channel-eng-item"><span class="codicon codicon-arrow-up"></span> ' + d.upvoteCount + '</span>' : '')
      + (d.isAnswered ? '<span class="channel-eng-item channel-disc-answered"><span class="codicon codicon-check"></span> Answered</span>' : '')
      + '</div>';
    return '<div class="channel-post channel-post-disc" data-url="' + esc(d.url || '') + '">'
      + '<div class="channel-post-header">'
      + avatar
      + '<div class="channel-post-meta">'
      + '<span class="channel-post-name">' + esc(d.authorLogin || '') + '</span>'
      + '<span class="channel-post-handle">@' + esc(d.authorLogin || '') + '</span>'
      + '</div>'
      + categoryHtml
      + '<span class="channel-post-time">' + timeAgo(d.createdAt) + '</span>'
      + '</div>'
      + '<div class="channel-disc-title">' + esc(d.title || '') + '</div>'
      + '<div class="channel-post-body">' + bodyPreview + '</div>'
      + statsHtml
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
        if (p.emptyMessage) { emptyMessages[src] = p.emptyMessage; }
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
        // Auto-fetch categories after discussion data loaded
        if (src === 'discussion' && !discCategoriesLoaded && incoming.length > 0) {
          discCategoriesLoaded = true;
          vscode.postMessage({ type: 'fetchDiscussionCategories', payload: {} });
        }
        break;
      }
      case 'youtubeComments': {
        var vid = msg.videoId;
        var comments = msg.comments || [];
        var cEl = feedItemsEl.querySelector('.channel-yt-comments[data-videoid="' + vid + '"]');
        if (cEl) {
          if (comments.length === 0) {
            cEl.innerHTML = '<div class="channel-yt-no-comments">No comments yet</div>';
          } else {
            cEl.innerHTML = comments.map(function (c) {
              var cAvatar = c.authorAvatar
                ? '<img class="channel-yt-comment-avatar" src="' + esc(c.authorAvatar) + '" alt="">'
                : '<span class="channel-yt-comment-avatar channel-post-avatar-placeholder">' + esc((c.authorName || '?').charAt(0)) + '</span>';
              return '<div class="channel-yt-comment">'
                + cAvatar
                + '<div class="channel-yt-comment-body">'
                + '<span class="channel-yt-comment-author">' + esc(c.authorName || '') + '</span>'
                + '<span class="channel-yt-comment-time">' + timeAgo(c.platformCreatedAt) + '</span>'
                + '<div class="channel-yt-comment-text">' + esc(c.body || '') + '</div>'
                + (c.engagement && c.engagement.likes > 0 ? '<span class="channel-yt-comment-likes"><span class="codicon codicon-thumbsup"></span> ' + c.engagement.likes + '</span>' : '')
                + '</div></div>';
            }).join('');
          }
        }
        break;
      }
      case 'discussionCategories': {
        var cats = msg.categories || [];
        if (discCategorySelect && cats.length > 0) {
          discCategorySelect.innerHTML = '<option value="">All categories</option>'
            + cats.map(function (c) {
              return '<option value="' + esc(c.id) + '">' + resolveEmoji(c.emoji || '') + ' ' + esc(c.name) + '</option>';
            }).join('');
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
