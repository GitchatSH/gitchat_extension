// sidebar-chat.js — Self-contained chat view for ~300px sidebar
// Depends on shared.js: vscode, doAction, escapeHtml, timeAgo, avatarUrl, formatCount
(function () {
  'use strict';

  // ═══════════════════════════════════════════
  // STATE — single source of truth
  // ═══════════════════════════════════════════
  var _state = {
    conversationId: null,
    currentUser: '',
    messages: [],
    pinnedMessages: [],
    groupMembers: [],
    isGroup: false,
    isGroupCreator: false,
    hasMoreOlder: false,
    hasMoreAfter: false,
    loadingOlder: false,
    loadingNewer: false,
    isViewingContext: false,
    replyingTo: null,
    isMuted: false,
    isPinned: false,
    createdBy: '',
    otherReadAt: null,
    conversation: null,
    pendingAttachments: [],
    draft: '',
  };

  var _els = {};          // cached DOM elements
  var _scrollAttached = false;
  var _rafPending = false;
  var _goDownBtn = null;
  var _newMsgCount = 0;
  var _markReadTimer = null;
  var _lastMarkReadTime = 0;
  var _draftTimer = null;
  var _isComposing = false;  // IME
  var _lastCompositionEnd = 0;
  var _tempIdCounter = 0;
  var _initialRender = false;
  var _typingUsersMap = {};
  var _lastTypingEmit = 0;
  var _closing = false;

  // ═══════════════════════════════════════════
  // DOM HELPERS
  // ═══════════════════════════════════════════

  function getContainer() {
    return document.getElementById('gs-chat-view');
  }

  function getMsgsEl() {
    return _els.messages || null;
  }

  function getInputEl() {
    return _els.input || null;
  }

  function $(sel, ctx) {
    return (ctx || getContainer()).querySelector(sel);
  }

  // ═══════════════════════════════════════════
  // LIFECYCLE: open / close / destroy
  // ═══════════════════════════════════════════

  function open(conversationId, convData) {
    _state.conversationId = conversationId;
    _scrollAttached = false;
    _rafPending = false;
    _newMsgCount = 0;
    _initialRender = true;

    var container = getContainer();
    if (!container) return;

    container.innerHTML = buildChatHTML();

    // Cache DOM elements
    _els.header = container.querySelector('.gs-sc-header');
    _els.headerAvatar = container.querySelector('.gs-sc-header-avatar');
    _els.headerInfo = container.querySelector('.gs-sc-header-info');
    _els.headerName = container.querySelector('.gs-sc-header-name');
    _els.headerSub = container.querySelector('.gs-sc-header-subtitle');
    _els.headerRight = container.querySelector('.gs-sc-header-right');
    _els.messagesArea = container.querySelector('.gs-sc-messages-area');
    _els.messages = container.querySelector('.gs-sc-messages');
    _els.inputArea = container.querySelector('.gs-sc-input-area');
    _els.input = container.querySelector('.gs-sc-input');
    _els.sendBtn = container.querySelector('.gs-sc-send-btn');
    _els.replyBar = container.querySelector('.gs-sc-reply-bar');
    _els.pinBanner = container.querySelector('.gs-sc-pin-banner');
    _els.attachStrip = container.querySelector('.gs-sc-attach-strip');
    _els.lpBar = container.querySelector('.gs-sc-lp-bar');

    // Render immediate header from convData
    if (convData) {
      renderHeaderFromConvData(convData);
    }

    // Wire event handlers
    wireBackButton();
    wireInput();
    wireSendButton();
    wireMenuButton();
    wireSearchButton();
    wireAttachButton();
    wireEmojiButton();
    wireFloatingBar();
    wireReactionClicks();
    wireImageLightbox();
    wireMentionAutocomplete();
    wireDragDrop();
    wirePasteImage();
  }

  function close() {
    // BUG 1: Guard against infinite recursion (close -> popChatView -> close)
    if (_closing) return;
    _closing = true;

    // BUG 7: Close overlays BEFORE clearing DOM (they reference _els)
    closeSearch();
    closeEmojiPicker();
    closePinnedView();

    // BUG 11: Save conversationId before resetState clears it
    var convId = _state.conversationId;

    // Save draft
    var input = getInputEl();
    if (input && input.value.trim()) {
      doAction('chat:saveDraft', {
        conversationId: convId,
        text: input.value,
      });
    }

    // Reset state
    resetState();

    // Clear DOM
    var container = getContainer();
    if (container) {
      container.innerHTML = '';
    }
    _els = {};
    _scrollAttached = false;

    // Clear timers
    clearTimeout(_markReadTimer);
    clearTimeout(_draftTimer);
    _markReadTimer = null;
    _draftTimer = null;

    // Notify explore.js
    if (typeof popChatView === 'function') {
      popChatView();
    }

    _closing = false;
  }

  function destroy() {
    resetState();
    _els = {};
    _scrollAttached = false;
    clearTimeout(_markReadTimer);
    clearTimeout(_draftTimer);
  }

  function resetState() {
    _state.conversationId = null;
    _state.currentUser = '';
    _state.messages = [];
    _state.pinnedMessages = [];
    _state.groupMembers = [];
    _state.isGroup = false;
    _state.isGroupCreator = false;
    _state.hasMoreOlder = false;
    _state.hasMoreAfter = false;
    _state.loadingOlder = false;
    _state.loadingNewer = false;
    _state.isViewingContext = false;
    _state.replyingTo = null;
    _state.isMuted = false;
    _state.isPinned = false;
    _state.createdBy = '';
    _state.otherReadAt = null;
    _state.conversation = null;
    _state.pendingAttachments = [];
    _state.draft = '';
    _goDownBtn = null;
    _newMsgCount = 0;
    _typingUsersMap = {};
  }

  function isOpen() {
    return _state.conversationId !== null;
  }

  function getConversationId() {
    return _state.conversationId;
  }

  // ═══════════════════════════════════════════
  // HTML BUILDER
  // ═══════════════════════════════════════════

  function buildChatHTML() {
    return '' +
      '<div class="gs-sc-header">' +
        '<button class="gs-sc-back-btn gs-btn-icon" title="Back">' +
          '<i class="codicon codicon-arrow-left"></i>' +
          '<span class="gs-sc-back-badge" style="display:none"></span>' +
        '</button>' +
        '<img class="gs-sc-header-avatar" src="" alt="" style="display:none">' +
        '<div class="gs-sc-header-info">' +
          '<span class="gs-sc-header-name"></span>' +
          '<span class="gs-sc-header-subtitle"></span>' +
        '</div>' +
        '<div class="gs-sc-header-right">' +
          '<button class="gs-sc-search-btn gs-btn-icon" title="Search">' +
            '<i class="codicon codicon-search"></i>' +
          '</button>' +
          '<button class="gs-sc-menu-btn gs-btn-icon" title="Menu">' +
            '<i class="codicon codicon-ellipsis"></i>' +
          '</button>' +
        '</div>' +
      '</div>' +
      '<div class="gs-sc-pin-banner" style="display:none;"></div>' +
      '<div class="gs-sc-messages-area">' +
        '<div class="gs-sc-messages"></div>' +
      '</div>' +
      '<div class="gs-sc-reply-bar" style="display:none;"></div>' +
      '<div class="gs-sc-lp-bar" style="display:none;"></div>' +
      '<div class="gs-sc-attach-strip" style="display:none;"></div>' +
      '<div class="gs-sc-input-area">' +
        '<button class="gs-sc-attach-btn gs-btn-icon" title="Attach">' +
          '<span class="codicon codicon-attach"></span>' +
        '</button>' +
        '<textarea class="gs-sc-input" placeholder="Write a message..." rows="1"></textarea>' +
        '<button class="gs-sc-emoji-btn gs-btn-icon" title="Emoji">' +
          '<span class="codicon codicon-smiley"></span>' +
        '</button>' +
        '<button class="gs-sc-send-btn gs-btn-icon" title="Send" style="display:none;">' +
          '<span class="codicon codicon-send"></span>' +
        '</button>' +
      '</div>';
  }

  // ═══════════════════════════════════════════
  // HEADER RENDERING
  // ═══════════════════════════════════════════

  function renderHeaderFromConvData(conv) {
    if (!_els.headerName) return;
    var name = '';
    var subtitle = '';
    var avatarUrl = '';

    if (conv.isGroup || conv.is_group) {
      name = escapeHtml(conv.name || conv.group_name || 'Group');
      var memberCount = (conv.participants && conv.participants.length) || 0;
      subtitle = memberCount + ' members';
      avatarUrl = conv.group_avatar_url || (conv.participants && conv.participants[0] ? (conv.participants[0].avatar_url || '') : '');
    } else {
      var other = conv.participant || conv.other_user || {};
      name = escapeHtml(other.name || other.login || conv.name || '');
      subtitle = other.login ? '@' + escapeHtml(other.login) : '';
      avatarUrl = other.avatar_url || '';
    }

    if (_els.headerAvatar && avatarUrl) {
      _els.headerAvatar.src = avatarUrl;
      _els.headerAvatar.style.display = '';
    }
    _els.headerName.textContent = '';
    _els.headerName.innerHTML = name;
    _els.headerSub.textContent = subtitle;
    _els.headerSub.dataset.original = subtitle;
  }

  function renderHeaderFromInit(payload) {
    if (!_els.headerName) return;
    var participant = payload.participant || {};
    var isGroup = payload.isGroup || false;
    var avatarUrl = participant.avatar_url || '';

    if (isGroup) {
      _els.headerName.innerHTML = escapeHtml(participant.name || participant.login || 'Group');
      var count = (payload.participants && payload.participants.length) || 0;
      _els.headerSub.textContent = count + ' members';
      if (!avatarUrl && payload.participants && payload.participants[0]) {
        avatarUrl = payload.participants[0].avatar_url || '';
      }
    } else {
      _els.headerName.innerHTML = escapeHtml(participant.name || participant.login || '');
      _els.headerSub.textContent = participant.login ? '@' + escapeHtml(participant.login) : '';
    }
    if (_els.headerAvatar && avatarUrl) {
      _els.headerAvatar.src = avatarUrl;
      _els.headerAvatar.style.display = '';
    }
    _els.headerSub.dataset.original = _els.headerSub.textContent;
  }

  // ═══════════════════════════════════════════
  // MESSAGE RENDERING
  // ═══════════════════════════════════════════

  function groupMessages(messages) {
    var toDateStr = function (d) { return new Date(d).toDateString(); };
    var getSender = function (m) { return m.sender_login || m.sender || ''; };

    return messages.map(function (msg, i) {
      var prev = messages[i - 1];
      var next = messages[i + 1];
      var newDay = msg.created_at && (!prev || !prev.created_at || toDateStr(msg.created_at) !== toDateStr(prev.created_at));
      var sameSender = prev && !newDay && getSender(prev) === getSender(msg) &&
        (new Date(msg.created_at) - new Date(prev.created_at)) <= 120000;
      var nextBreaks = !next || toDateStr(next.created_at) !== toDateStr(msg.created_at) ||
        getSender(next) !== getSender(msg) ||
        (new Date(next.created_at) - new Date(msg.created_at)) > 120000;

      var isFirst = !sameSender;
      var isLast = nextBreaks || !next || getSender(next) !== getSender(msg);
      var groupPosition = 'single';
      if (!isFirst && !isLast) groupPosition = 'middle';
      else if (!isFirst) groupPosition = 'last';
      else if (!isLast) groupPosition = 'first';

      return Object.assign({}, msg, {
        showDateSeparator: newDay,
        groupPosition: groupPosition,
      });
    });
  }

  function formatDateSeparator(isoDate) {
    var d = new Date(isoDate);
    var now = new Date();
    if (d.toDateString() === now.toDateString()) return 'Today';
    var yesterday = new Date(now - 86400000);
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    var opts = { month: 'long', day: 'numeric' };
    if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
    return d.toLocaleDateString(undefined, opts);
  }

  function renderDateSeparator(isoDate) {
    return '<div class="gs-sc-date-sep"><div class="gs-sc-date-line"></div><span class="gs-sc-date-label">' +
      escapeHtml(formatDateSeparator(isoDate)) + '</span><div class="gs-sc-date-line"></div></div>';
  }

  function renderMessage(msg) {
    var sender = msg.sender_login || msg.sender || '';
    var isMe = sender === _state.currentUser;
    var cls = isMe ? 'gs-sc-msg-out' : 'gs-sc-msg-in';
    var groupPos = msg.groupPosition || 'single';
    var showDetails = groupPos === 'single' || groupPos === 'first';
    var showTimestamp = groupPos === 'single' || groupPos === 'last';
    var time = showTimestamp
      ? new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : '';
    var text = msg.body || msg.content || '';

    // System messages
    if (msg.type === 'system') {
      return '<div class="gs-sc-msg gs-sc-msg-system" data-msg-id="' +
        escapeHtml(String(msg.id)) + '"><span class="gs-sc-system-text">' +
        escapeHtml(text) + '</span></div>';
    }

    // Unsent messages
    if (msg.unsent_at) {
      return '<div class="gs-sc-msg-row gs-sc-group-' + groupPos + '">' +
        '<div class="gs-sc-msg ' + cls + ' gs-sc-msg-placeholder gs-sc-group-' + groupPos + '" ' +
        'data-msg-id="' + escapeHtml(String(msg.id)) + '" ' +
        'data-sender="' + escapeHtml(sender) + '">' +
        '<span class="gs-sc-placeholder-text">[This message was unsent]</span>' +
        '</div></div>';
    }

    // Deleted messages
    if (msg.is_deleted || msg.deleted) {
      return '<div class="gs-sc-msg-row gs-sc-group-' + groupPos + '">' +
        '<div class="gs-sc-msg ' + cls + ' gs-sc-msg-placeholder gs-sc-group-' + groupPos + '" ' +
        'data-msg-id="' + escapeHtml(String(msg.id)) + '" ' +
        'data-sender="' + escapeHtml(sender) + '">' +
        '<span class="gs-sc-placeholder-text">[This message was deleted]</span>' +
        '</div></div>';
    }

    // Sender name (group incoming only, first/single)
    var senderHtml = (showDetails && !isMe && _state.isGroup)
      ? '<div class="gs-sc-sender" data-login="' + escapeHtml(sender) + '">@' + escapeHtml(sender) + '</div>'
      : '';

    // Reply/quote block
    var replyHtml = '';
    if (msg.reply_to_id && msg.reply) {
      var replyText = (msg.reply.body || msg.reply.content || '').slice(0, 80);
      var replySender = msg.reply.sender_login || msg.reply.sender || '';
      replyHtml = '<div class="gs-sc-reply-quote" data-reply-id="' + escapeHtml(String(msg.reply_to_id)) + '">' +
        '<span class="gs-sc-reply-sender">' + escapeHtml(replySender) + '</span>' +
        '<span class="gs-sc-reply-text">' + escapeHtml(replyText) + '</span>' +
        '</div>';
    }

    // Attachments — images + files (Telegram-style grid/mosaic)
    var allAttachments = (msg.attachments || []).slice();
    if (!allAttachments.length && msg.attachment_url) {
      allAttachments.push({ url: msg.attachment_url, mime_type: 'image/jpeg', filename: 'image' });
    }
    function isImageAttach(a) {
      if (a.mime_type && a.mime_type.startsWith('image/')) return true;
      if (a.type === 'gif' || a.type === 'image') return true;
      var url = (a.url || a.file_url || '').split('?')[0].toLowerCase();
      return /\.(png|jpg|jpeg|gif|webp|svg|bmp)$/.test(url);
    }
    var imageAttachments = allAttachments.filter(isImageAttach);
    var fileAttachments = allAttachments.filter(function (a) { return !isImageAttach(a); });

    var attachHtml = '';
    if (imageAttachments.length > 0) {
      var imgCount = imageAttachments.length;
      if (imgCount <= 4) {
        var gridCls = 'gs-sc-img-grid gs-sc-img-grid-' + imgCount;
        var imgs = imageAttachments.map(function (a) {
          var src = escapeHtml(a.url || a.file_url);
          return '<div class="gs-sc-img-cell"><img src="' + src + '" alt="' +
            escapeHtml(a.filename || 'image') + '" class="gs-sc-attachment-img" data-url="' + src + '" /></div>';
        }).join('');
        attachHtml += '<div class="' + gridCls + '">' + imgs + '</div>';
      } else {
        // 5+ images: Telegram mosaic — hero + rows of 3
        var mosaicHtml = '<div class="gs-sc-img-mosaic">';
        var heroSrc = escapeHtml(imageAttachments[0].url || imageAttachments[0].file_url);
        mosaicHtml += '<div class="gs-sc-img-mosaic-hero"><img src="' + heroSrc + '" class="gs-sc-attachment-img" data-url="' + heroSrc + '" /></div>';
        var rest = imageAttachments.slice(1);
        for (var ri = 0; ri < rest.length; ri += 3) {
          var rowItems = rest.slice(ri, ri + 3);
          mosaicHtml += '<div class="gs-sc-img-mosaic-row gs-sc-img-mosaic-row-' + rowItems.length + '">';
          rowItems.forEach(function (a) {
            var s = escapeHtml(a.url || a.file_url);
            mosaicHtml += '<div class="gs-sc-img-mosaic-cell"><img src="' + s + '" class="gs-sc-attachment-img" data-url="' + s + '" /></div>';
          });
          mosaicHtml += '</div>';
        }
        mosaicHtml += '</div>';
        attachHtml += mosaicHtml;
      }
    }
    attachHtml += fileAttachments.map(function (a) {
      return '<a href="' + escapeHtml(a.url || a.file_url) + '" class="gs-sc-file-link">' +
        '<span class="codicon codicon-file"></span> ' + escapeHtml(a.filename || 'attachment') + '</a>';
    }).join('');

    // Reactions
    var reactionGroups = {};
    (msg.reactions || []).forEach(function (r) {
      var emoji = r.emoji;
      if (!reactionGroups[emoji]) reactionGroups[emoji] = [];
      var login = r.user_login || r.userLogin || '';
      if (login && reactionGroups[emoji].indexOf(login) === -1) reactionGroups[emoji].push(login);
    });
    var reactionsHtml = Object.keys(reactionGroups).map(function (emoji) {
      var users = reactionGroups[emoji];
      var isMine = users.indexOf(_state.currentUser) >= 0;
      return '<span class="gs-sc-reaction' + (isMine ? ' gs-sc-reaction-mine' : '') + '" ' +
        'data-msg-id="' + escapeHtml(String(msg.id)) + '" ' +
        'data-emoji="' + escapeHtml(emoji) + '">' +
        '<span class="gs-sc-reaction-emoji">' + escapeHtml(emoji) + '</span>' +
        '<span class="gs-sc-reaction-count">' + users.length + '</span>' +
        '</span>';
    }).join('');

    // Forwarded label
    var forwardedHtml = '';
    var fwdMatch = text.match(/^\u21aa Forwarded(?:\s+from\s+(@\S+))?\n/);
    if (fwdMatch) {
      text = text.slice(fwdMatch[0].length);
      forwardedHtml = '<div class="gs-sc-forwarded"><i class="codicon codicon-export"></i> Forwarded</div>';
    }

    // Message text
    var textHtml = text
      ? '<div class="gs-sc-text">' + escapeHtml(text) + '</div>'
      : '';

    // Status icon (outgoing only)
    var statusHtml = '';
    if (isMe && showTimestamp) {
      var isSeen = _state.otherReadAt && msg.created_at && msg.created_at <= _state.otherReadAt;
      if (msg._temp) {
        statusHtml = '<span class="gs-sc-status gs-sc-status-sending" title="Sending"><i class="codicon codicon-loading codicon-modifier-spin"></i></span>';
      } else if (isSeen) {
        statusHtml = '<span class="gs-sc-status gs-sc-status-seen" title="Seen">\u2713\u2713</span>';
      } else {
        statusHtml = '<span class="gs-sc-status gs-sc-status-sent" title="Sent">\u2713</span>';
      }
    }

    // Image-only: no text, has images, no forwarded, no reply
    var hasImages = imageAttachments && imageAttachments.length > 0;
    var isImageOnly = hasImages && !text && !forwardedHtml && !replyHtml;
    var extraCls = (hasImages ? ' gs-sc-msg-has-images' : '') + (isImageOnly ? ' gs-sc-msg-image-only' : '');

    // Meta (time + status) — overlay on image for image-only messages
    var metaCls = isImageOnly ? 'gs-sc-meta gs-sc-meta-overlay' : 'gs-sc-meta';
    var metaHtml = showTimestamp
      ? '<div class="' + metaCls + '">' + time + (msg.edited_at ? ' (edited)' : '') + ' ' + statusHtml + '</div>'
      : '';

    // Assemble bubble content — image-only wraps images+meta for overlay positioning
    var innerHtml;
    if (isImageOnly) {
      innerHtml = senderHtml +
        '<div class="gs-sc-img-badge-wrap">' + attachHtml + metaHtml + '</div>' +
        (reactionsHtml ? '<div class="gs-sc-reactions">' + reactionsHtml + '</div>' : '');
    } else {
      innerHtml = senderHtml + forwardedHtml + replyHtml + attachHtml + textHtml +
        (reactionsHtml ? '<div class="gs-sc-reactions">' + reactionsHtml + '</div>' : '') +
        metaHtml;
    }

    return '<div class="gs-sc-msg-row gs-sc-group-' + groupPos + '">' +
      '<div class="gs-sc-msg ' + cls + extraCls + ' gs-sc-group-' + groupPos + '" ' +
      'data-msg-id="' + escapeHtml(String(msg.id)) + '" ' +
      'data-sender="' + escapeHtml(sender) + '" ' +
      'data-created-at="' + escapeHtml(msg.created_at || '') + '"' +
      (msg._temp ? ' data-temp="true"' : '') + '>' +
      innerHtml +
      '</div></div>';
  }

  function renderMessages(messages, unreadCount) {
    var container = getMsgsEl();
    if (!container) return;

    // Dedup
    var seen = {};
    var unique = messages.filter(function (m) {
      if (!m.id || seen[m.id]) return false;
      seen[m.id] = true;
      return true;
    });

    var grouped = groupMessages(unique);
    var dividerIndex = unreadCount > 0 ? grouped.length - unreadCount : -1;

    container.innerHTML = grouped.map(function (msg, i) {
      var dividerHtml = '';
      if (i === dividerIndex && dividerIndex > 0) {
        dividerHtml = '<div class="gs-sc-unread-divider" id="gs-sc-unread-divider"><span>New Messages</span></div>';
      }
      return dividerHtml +
        (msg.showDateSeparator ? renderDateSeparator(msg.created_at) : '') +
        renderMessage(msg);
    }).join('');

    // Attach scroll listener
    attachScrollListener();

    // Scroll to position
    if (_initialRender) {
      _initialRender = false;
      var divider = container.querySelector('#gs-sc-unread-divider');
      if (divider && unreadCount > 0) {
        divider.scrollIntoView({ block: 'start' });
      } else {
        container.scrollTop = container.scrollHeight;
      }
    }

    // Mark as read if already at bottom
    setTimeout(function () {
      if (!container) return;
      var dist = container.scrollHeight - container.scrollTop - container.clientHeight;
      if (dist <= 100) {
        doAction('chat:markRead');
      }
    }, 300);
  }

  function appendMessage(message) {
    var container = getMsgsEl();
    if (!container) return;

    var msgId = message.id || message.message_id;

    // Replace temp message
    var tempEl = container.querySelector('[data-temp="true"][data-sender="' + escapeHtml(_state.currentUser) + '"]');
    if (tempEl && msgId && (message.sender_login === _state.currentUser || message.sender === _state.currentUser)) {
      var grouped = groupMessages([message]);
      var m = grouped[0] || Object.assign({}, message, { groupPosition: 'single' });
      tempEl.closest('.gs-sc-msg-row').outerHTML = renderMessage(m);
      return;
    }

    // Dedup check
    if (msgId && container.querySelector('[data-msg-id="' + escapeHtml(String(msgId)) + '"]')) return;

    var distFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;

    // Date separator check
    var allMsgs = container.querySelectorAll('[data-created-at]');
    var lastMsgEl = allMsgs.length > 0 ? allMsgs[allMsgs.length - 1] : null;
    var showSep = false;
    if (lastMsgEl && message.created_at) {
      var lastDate = lastMsgEl.getAttribute('data-created-at') || '';
      showSep = lastDate && new Date(lastDate).toDateString() !== new Date(message.created_at).toDateString();
    }

    var html = (showSep ? renderDateSeparator(message.created_at) : '') +
      renderMessage(Object.assign({}, message, { groupPosition: 'single' }));
    container.insertAdjacentHTML('beforeend', html);

    // Smart scroll
    if (distFromBottom <= 100) {
      container.scrollTop = container.scrollHeight;
    } else {
      _newMsgCount++;
      showGoDown();
      updateGoDownBadge();
    }
  }

  // ═══════════════════════════════════════════
  // SCROLL SYSTEM (single listener, all cases)
  // ═══════════════════════════════════════════

  function attachScrollListener() {
    var container = getMsgsEl();
    if (!container || _scrollAttached) return;
    _scrollAttached = true;

    container.addEventListener('scroll', function () {
      if (_rafPending) return;
      _rafPending = true;

      requestAnimationFrame(function () {
        _rafPending = false;
        if (!container) return;

        var distFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;

        // --- Infinite scroll UP: load older messages ---
        if (container.scrollTop < 200 && _state.hasMoreOlder && !_state.loadingOlder) {
          _state.loadingOlder = true;
          doAction('chat:loadMore');
        }

        // --- Hysteresis: show at >300, hide at <=100, retain in 100-300 ---
        if (distFromBottom > 300) {
          showGoDown();
        } else if (distFromBottom <= 100) {
          // Context viewing mode (bidirectional scroll)
          if (_state.isViewingContext) {
            if (_state.hasMoreAfter) {
              if (_state.loadingNewer) return;
              _state.loadingNewer = true;
              doAction('chat:loadNewer');
              return;
            }
            _state.isViewingContext = false;
            doAction('chat:reloadConversation');
            return;
          }

          hideGoDown();
          _newMsgCount = 0;
          updateGoDownBadge();

          // Remove unread divider
          var divider = container.querySelector('#gs-sc-unread-divider');
          if (divider) divider.remove();

          // Mark as read (throttled 500ms)
          var now = Date.now();
          if (now - _lastMarkReadTime >= 500) {
            _lastMarkReadTime = now;
            doAction('chat:markRead');
          } else if (!_markReadTimer) {
            _markReadTimer = setTimeout(function () {
              _markReadTimer = null;
              _lastMarkReadTime = Date.now();
              doAction('chat:markRead');
            }, 500 - (now - _lastMarkReadTime));
          }
        }
        // 100-300 range: retain current visibility (hysteresis dead zone)
      });
    }, { passive: true });
  }

  // ═══════════════════════════════════════════
  // GO DOWN BUTTON
  // ═══════════════════════════════════════════

  function getGoDownBtn() {
    if (_goDownBtn) return _goDownBtn;

    var area = _els.messagesArea;
    if (!area) return null;

    _goDownBtn = document.createElement('button');
    _goDownBtn.className = 'gs-sc-go-down';
    _goDownBtn.innerHTML = '<i class="codicon codicon-chevron-down"></i>' +
      '<span class="gs-sc-go-down-badge"></span>';

    _goDownBtn.addEventListener('click', function () {
      if (_state.isViewingContext) {
        _state.isViewingContext = false;
        _state.hasMoreAfter = false;
        _state.loadingNewer = false;
        doAction('chat:reloadConversation');
        return;
      }
      var container = getMsgsEl();
      if (container) {
        container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
      }
      _newMsgCount = 0;
      updateGoDownBadge();
    });

    area.appendChild(_goDownBtn);
    return _goDownBtn;
  }

  function showGoDown() {
    var btn = getGoDownBtn();
    if (btn) btn.classList.add('gs-sc-go-down-visible');
  }

  function hideGoDown() {
    if (_goDownBtn) _goDownBtn.classList.remove('gs-sc-go-down-visible');
  }

  function updateGoDownBadge() {
    if (!_goDownBtn) return;
    var badge = _goDownBtn.querySelector('.gs-sc-go-down-badge');
    if (!badge) return;
    if (_newMsgCount > 0) {
      badge.textContent = _newMsgCount;
      badge.classList.add('gs-sc-has-count');
    } else {
      badge.textContent = '';
      badge.classList.remove('gs-sc-has-count');
    }
  }

  // ═══════════════════════════════════════════
  // INPUT HANDLING
  // ═══════════════════════════════════════════

  function wireInput() {
    var input = getInputEl();
    if (!input) return;

    // Auto-expand
    input.addEventListener('input', function () {
      input.style.height = 'auto';
      input.style.height = input.scrollHeight + 'px';
      input.scrollTop = input.scrollHeight;

      // Show/hide send button
      if (_els.sendBtn) {
        _els.sendBtn.style.display = input.value.trim() ? '' : 'none';
      }

      // Draft save (debounce 500ms)
      clearTimeout(_draftTimer);
      var text = input.value;
      _draftTimer = setTimeout(function () {
        doAction('chat:saveDraft', {
          conversationId: _state.conversationId,
          text: text,
        });
      }, 500);
    });

    // IME composition
    input.addEventListener('compositionstart', function () {
      _isComposing = true;
    });
    input.addEventListener('compositionend', function () {
      _isComposing = false;
      _lastCompositionEnd = Date.now();
    });

    // Keydown: Enter to send, Shift+Enter for newline
    input.addEventListener('keydown', function (e) {
      if (e.isComposing || _isComposing) return;
      if (Date.now() - _lastCompositionEnd < 50) return;

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
        return;
      }

      // Up arrow: edit last own message (BUG 8: handle client-side)
      if (e.key === 'ArrowUp' && !input.value) {
        editLastOwnMessage();
        return;
      }

      // Escape: cancel reply
      if (e.key === 'Escape' && _state.replyingTo) {
        cancelReply();
        return;
      }

      // Typing indicator (throttle 2s)
      var now = Date.now();
      if (now - _lastTypingEmit > 2000) {
        doAction('chat:typing');
        _lastTypingEmit = now;
      }
    });
  }

  function wireSendButton() {
    var sendBtn = _els.sendBtn;
    if (!sendBtn) return;
    sendBtn.addEventListener('click', sendMessage);
  }

  // BUG 8: Handle editLastMessage client-side
  function editLastOwnMessage() {
    var msgs = _state.messages;
    if (!msgs || !msgs.length) return;
    var user = _state.currentUser;
    for (var i = msgs.length - 1; i >= 0; i--) {
      var m = msgs[i];
      var sender = m.sender_login || m.senderLogin || m.sender || '';
      if (sender === user && !m.is_deleted && !m.deleted && m.type !== 'system') {
        var msgEl = getMsgsEl() && getMsgsEl().querySelector('[data-msg-id="' + escapeHtml(String(m.id)) + '"]');
        var text = m.body || m.content || m.text || '';
        if (msgEl && text) {
          doEditInline(m.id, text, msgEl);
        }
        return;
      }
    }
  }

  function sendMessage() {
    var input = getInputEl();
    if (!input) return;

    var content = input.value.trim();
    var hasAttachments = _state.pendingAttachments.some(function (a) { return a.status === 'ready'; });
    if (!content && !hasAttachments) return;

    // Optimistic temp message
    var tempId = 'temp-' + (++_tempIdCounter);
    var container = getMsgsEl();
    if (container) {
      var tempMsg = {
        id: tempId,
        sender_login: _state.currentUser,
        sender: _state.currentUser,
        body: content,
        created_at: new Date().toISOString(),
        groupPosition: 'single',
        _temp: true,
      };
      if (_state.replyingTo) {
        tempMsg.reply_to_id = _state.replyingTo.id;
        tempMsg.reply = {
          sender_login: _state.replyingTo.sender,
          body: _state.replyingTo.text,
        };
      }
      container.insertAdjacentHTML('beforeend', renderMessage(tempMsg));
      container.scrollTop = container.scrollHeight;
    }
    _newMsgCount = 0;
    updateGoDownBadge();

    // Build payload
    var readyAttachments = _state.pendingAttachments.filter(function (a) { return a.status === 'ready'; });
    var payload = { content: content, _tempId: tempId };
    if (readyAttachments.length > 0) {
      payload.attachments = readyAttachments.map(function (a) { return a.result; });
    }
    if (_inputLpUrl && !_inputLpDismissed) {
      payload.linkPreviewUrl = _inputLpUrl;
    }
    if (_state.replyingTo) {
      payload.replyToId = _state.replyingTo.id;
      doAction('chat:reply', payload);
      cancelReply();
    } else {
      doAction('chat:send', payload);
    }

    // Clear input
    input.value = '';
    input.style.height = 'auto';
    if (_els.sendBtn) _els.sendBtn.style.display = 'none';

    // Clear attachments
    clearAllAttachments();
    hideInputLinkPreview();

    // Re-scroll after input shrinks (textarea resize changes messages area height)
    if (container) {
      requestAnimationFrame(function () { container.scrollTop = container.scrollHeight; });
    }

    // Clear draft
    clearTimeout(_draftTimer);
    doAction('chat:saveDraft', { conversationId: _state.conversationId, text: '' });
  }

  // ═══════════════════════════════════════════
  // REPLY
  // ═══════════════════════════════════════════

  function setReply(msgId, sender, text) {
    _state.replyingTo = { id: msgId, sender: sender, text: text };
    var bar = _els.replyBar;
    if (!bar) return;

    bar.innerHTML =
      '<div class="gs-sc-reply-bar-content">' +
        '<span class="gs-sc-reply-bar-sender">' + escapeHtml(sender) + '</span>' +
        '<span class="gs-sc-reply-bar-text">' + escapeHtml((text || '').slice(0, 80)) + '</span>' +
      '</div>' +
      '<button class="gs-sc-reply-bar-close gs-btn-icon"><i class="codicon codicon-close"></i></button>';
    bar.style.display = 'flex';

    bar.querySelector('.gs-sc-reply-bar-close').addEventListener('click', cancelReply);

    var input = getInputEl();
    if (input) input.focus();
  }

  function cancelReply() {
    _state.replyingTo = null;
    var bar = _els.replyBar;
    if (bar) {
      bar.innerHTML = '';
      bar.style.display = 'none';
    }
  }

  // ═══════════════════════════════════════════
  // BACK + MENU BUTTONS
  // ═══════════════════════════════════════════

  function wireBackButton() {
    var container = getContainer();
    if (!container) return;
    var backBtn = container.querySelector('.gs-sc-back-btn');
    if (backBtn) {
      backBtn.addEventListener('click', close);
    }
  }

  function wireMenuButton() {
    var container = getContainer();
    if (!container) return;
    var menuBtn = container.querySelector('.gs-sc-menu-btn');
    if (menuBtn) {
      menuBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        toggleHeaderMenu();
      });
    }
  }

  // ═══════════════════════════════════════════
  // TYPING INDICATOR
  // ═══════════════════════════════════════════

  function showTyping(user) {
    if (_typingUsersMap[user]) clearTimeout(_typingUsersMap[user]);
    _typingUsersMap[user] = setTimeout(function () {
      delete _typingUsersMap[user];
      updateHeaderTyping();
    }, 5000);
    updateHeaderTyping();
  }

  function hideTyping() {
    _typingUsersMap = {};
    updateHeaderTyping();
  }

  function updateHeaderTyping() {
    var subtitle = _els.headerSub;
    if (!subtitle) return;

    var users = Object.keys(_typingUsersMap);
    if (users.length === 0) {
      subtitle.classList.remove('gs-sc-typing');
      subtitle.textContent = subtitle.dataset.original || '';
      return;
    }

    if (!subtitle.dataset.original) {
      subtitle.dataset.original = subtitle.textContent;
    }

    var text;
    if (!_state.isGroup) {
      text = 'typing';
    } else if (users.length === 1) {
      text = users[0] + ' typing';
    } else if (users.length === 2) {
      text = users[0] + ' & ' + users[1] + ' typing';
    } else {
      text = users.length + ' people typing';
    }

    subtitle.classList.add('gs-sc-typing');
    subtitle.innerHTML = escapeHtml(text) +
      '<span class="gs-sc-typing-dots">' +
        '<span></span><span></span><span></span>' +
      '</span>';
  }

  // ═══════════════════════════════════════════
  // JUMP TO MESSAGE (shared helper)
  // ═══════════════════════════════════════════

  function flashMessage(el) {
    if (!el) return;
    var target = el.closest('.gs-sc-msg-row') || el;
    var bubble = target.classList.contains('gs-sc-msg') ? target : target.querySelector('.gs-sc-msg');
    if (bubble) {
      var bg = window.getComputedStyle(bubble).backgroundColor;
      var m = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (m) {
        target.style.setProperty('--flash-bg', 'rgba(' + m[1] + ',' + m[2] + ',' + m[3] + ',0.20)');
      }
    }
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.remove('gs-sc-flash');
    void target.offsetWidth;
    target.classList.add('gs-sc-flash');
    setTimeout(function () { target.classList.remove('gs-sc-flash'); }, 1500);
  }

  // ═══════════════════════════════════════════
  // TOAST
  // ═══════════════════════════════════════════

  function showToast(text, duration) {
    var area = _els.messagesArea;
    if (!area) return;

    var old = area.querySelector('.gs-sc-toast');
    if (old) old.remove();

    var toast = document.createElement('div');
    toast.className = 'gs-sc-toast';
    toast.textContent = text;
    area.appendChild(toast);

    setTimeout(function () {
      toast.classList.add('gs-sc-toast-hide');
      setTimeout(function () { toast.remove(); }, 300);
    }, duration || 3000);
  }

  // ═══════════════════════════════════════════
  // EMOJI DATA
  // ═══════════════════════════════════════════

  var QUICK_EMOJIS = ['\uD83D\uDC4D', '\u2764\uFE0F', '\uD83D\uDE02', '\uD83D\uDD25'];
  var EMOJIS = [
    {e:'\uD83D\uDC4D',n:'thumbs up',k:['like','good','yes','ok']},
    {e:'\u2764\uFE0F',n:'red heart',k:['love','heart']},
    {e:'\uD83D\uDE02',n:'face with tears of joy',k:['laugh','lol','haha','funny']},
    {e:'\uD83D\uDD25',n:'fire',k:['hot','lit','amazing']},
    {e:'\uD83D\uDE0A',n:'smiling face',k:['smile','happy','pleased']},
    {e:'\uD83D\uDE0D',n:'heart eyes',k:['love','adore']},
    {e:'\uD83E\uDD14',n:'thinking face',k:['think','hmm','wonder']},
    {e:'\uD83D\uDE22',n:'crying face',k:['sad','cry','tears']},
    {e:'\uD83D\uDE2E',n:'face with open mouth',k:['wow','surprised','omg']},
    {e:'\uD83C\uDF89',n:'party popper',k:['celebrate','congrats','party']},
    {e:'\uD83D\uDCAF',n:'hundred points',k:['perfect','100','score']},
    {e:'\uD83D\uDE80',n:'rocket',k:['launch','fast','ship']},
    {e:'\uD83D\uDC40',n:'eyes',k:['look','see','watching']},
    {e:'\uD83E\uDD23',n:'rolling on floor laughing',k:['laugh','lmao','rofl']},
    {e:'\uD83D\uDE2D',n:'loudly crying',k:['cry','sob','sad']},
    {e:'\uD83E\uDD7A',n:'pleading face',k:['please','beg','puppy']},
    {e:'\uD83D\uDE24',n:'face with steam from nose',k:['angry','frustrated']},
    {e:'\uD83D\uDE0E',n:'smiling face with sunglasses',k:['cool','awesome','chill']},
    {e:'\uD83E\uDD2F',n:'exploding head',k:['mindblown','wow','shocked']},
    {e:'\uD83D\uDE33',n:'flushed face',k:['embarrassed','shocked','blush']},
    {e:'\uD83E\uDD73',n:'partying face',k:['celebrate','party','birthday']},
    {e:'\uD83D\uDE34',n:'sleeping face',k:['sleep','tired','zzz']},
    {e:'\uD83E\uDD26',n:'face palm',k:['facepalm','ugh','sigh']},
    {e:'\uD83E\uDD37',n:'shrug',k:['shrug','idk','whatever']},
    {e:'\uD83D\uDC4F',n:'clapping hands',k:['clap','applause','bravo']},
    {e:'\uD83D\uDE4F',n:'folded hands',k:['pray','please','thank']},
    {e:'\uD83D\uDCAA',n:'flexed biceps',k:['strong','muscle','power']},
    {e:'\u2728',n:'sparkles',k:['stars','magic','amazing']},
    {e:'\uD83D\uDC80',n:'skull',k:['dead','dying','skull']},
    {e:'\uD83D\uDE05',n:'grinning face with sweat',k:['nervous','relieved','phew']},
    {e:'\uD83E\uDEE1',n:'saluting face',k:['salute','respect']},
    {e:'\uD83E\uDD0C',n:'pinched fingers',k:['chef','kiss','perfect']},
    {e:'\u26A1',n:'high voltage',k:['lightning','fast','electric']},
    {e:'\uD83C\uDFAF',n:'bullseye',k:['target','goal','aim']},
    {e:'\uD83C\uDFC6',n:'trophy',k:['win','winner','champion']},
    {e:'\uD83D\uDCA1',n:'light bulb',k:['idea','bright']},
    {e:'\uD83D\uDD11',n:'key',k:['key','unlock','important']},
    {e:'\uD83D\uDCB0',n:'money bag',k:['money','cash','rich']},
    {e:'\uD83C\uDF81',n:'wrapped gift',k:['gift','present','surprise']},
    {e:'\uD83C\uDF55',n:'pizza',k:['food','pizza']},
    {e:'\uD83C\uDF7A',n:'beer mug',k:['beer','drink','cheers']},
    {e:'\u2615',n:'hot beverage',k:['coffee','tea','drink']},
    {e:'\uD83C\uDF19',n:'crescent moon',k:['moon','night','sleep']},
    {e:'\u2B50',n:'star',k:['star','favorite','good']},
    {e:'\uD83C\uDF08',n:'rainbow',k:['rainbow','colorful','hope']},
    {e:'\uD83D\uDCA3',n:'bomb',k:['bomb','explosion']},
    {e:'\uD83C\uDFB5',n:'musical note',k:['music','song','note']},
    {e:'\uD83D\uDD14',n:'bell',k:['notification','bell','ring']},
    {e:'\uD83D\uDCCC',n:'pushpin',k:['pin','mark','important']},
    {e:'\u2705',n:'check mark button',k:['done','check','complete']},
    {e:'\u274C',n:'cross mark',k:['no','wrong','cancel']},
    {e:'\u26A0\uFE0F',n:'warning',k:['warning','caution','alert']},
    {e:'\uD83D\uDCAC',n:'speech bubble',k:['chat','message','talk']},
    {e:'\uD83D\uDC4B',n:'waving hand',k:['wave','hello','bye']},
    {e:'\uD83E\uDD1D',n:'handshake',k:['deal','agree','partner']},
    {e:'\uD83E\uDEF6',n:'heart hands',k:['love','care','support']},
    {e:'\uD83E\uDD17',n:'hugging face',k:['hug','warm','friendly']},
    {e:'\uD83D\uDE0C',n:'relieved face',k:['relieved','calm','peace']},
    {e:'\uD83E\uDDD0',n:'face with monocle',k:['curious','inspect','hmm']},
    {e:'\uD83E\uDD13',n:'nerd face',k:['nerd','smart','geek']},
    {e:'\uD83D\uDC4C',n:'ok hand',k:['ok','perfect','fine']},
    {e:'\uD83E\uDD1E',n:'crossed fingers',k:['luck','hope','wish']},
    {e:'\uD83D\uDC4A',n:'oncoming fist',k:['punch','fist','bump']},
    {e:'\uD83D\uDE4C',n:'raising hands',k:['praise','celebrate','yeah']},
    {e:'\uD83E\uDEC2',n:'people hugging',k:['hug','comfort','support']},
    {e:'\u2764\uFE0F\u200D\uD83D\uDD25',n:'heart on fire',k:['love','passion']},
    {e:'\uD83D\uDC94',n:'broken heart',k:['heartbreak','sad','lost']},
    {e:'\uD83D\uDC99',n:'blue heart',k:['love','blue','calm']},
    {e:'\uD83D\uDC9A',n:'green heart',k:['nature','health','love']},
    {e:'\uD83D\uDC9C',n:'purple heart',k:['love','purple']},
    {e:'\uD83D\uDDA4',n:'black heart',k:['dark','love','aesthetic']},
    {e:'\uD83E\uDD0D',n:'white heart',k:['pure','love','clean']},
    {e:'\uD83E\uDDE1',n:'orange heart',k:['energy','warmth','love']},
    {e:'\uD83D\uDC9B',n:'yellow heart',k:['happy','sunny','love']},
    {e:'\uD83E\uDE77',n:'pink heart',k:['cute','love','pink']},
  ];

  // ═══════════════════════════════════════════
  // EMOJI PICKER + REACTIONS
  // ═══════════════════════════════════════════

  var _emojiPicker = null;
  var _emojiPickerMsgId = null;
  var _emojiCloseHandler = null;

  function closeEmojiPicker() {
    if (_emojiCloseHandler) { document.removeEventListener('click', _emojiCloseHandler); _emojiCloseHandler = null; }
    if (_emojiPicker) { _emojiPicker.remove(); _emojiPicker = null; }
    _emojiPickerMsgId = null;
  }

  function openEmojiPicker(anchorEl, msgId) {
    closeEmojiPicker();
    _emojiPickerMsgId = msgId;

    var picker = document.createElement('div');
    picker.className = 'gs-sc-emoji-picker';

    var quickHtml = QUICK_EMOJIS.map(function (e) {
      return '<button class="gs-sc-emoji-quick" data-emoji="' + escapeHtml(e) + '">' + e + '</button>';
    }).join('');

    var gridHtml = EMOJIS.map(function (item) {
      return '<button class="gs-sc-emoji-item" data-emoji="' + escapeHtml(item.e) + '" title="' + escapeHtml(item.n) + '">' + item.e + '</button>';
    }).join('');

    picker.innerHTML =
      '<div class="gs-sc-emoji-quick-row">' + quickHtml + '</div>' +
      '<div class="gs-sc-emoji-search-row"><input class="gs-sc-emoji-search" placeholder="Search emojis\u2026" /></div>' +
      '<div class="gs-sc-emoji-grid">' + gridHtml + '</div>';

    var area = _els.messagesArea || getContainer();
    if (area) area.appendChild(picker);
    _emojiPicker = picker;

    // Position above anchor
    var aRect = anchorEl.getBoundingClientRect();
    var cRect = area.getBoundingClientRect();
    var top = aRect.top - cRect.top - picker.offsetHeight - 4;
    if (top < 0) top = aRect.bottom - cRect.top + 4;
    picker.style.top = top + 'px';

    // Search filter
    var searchInput = picker.querySelector('.gs-sc-emoji-search');
    searchInput.addEventListener('input', function () {
      var q = searchInput.value.toLowerCase();
      picker.querySelectorAll('.gs-sc-emoji-item').forEach(function (btn) {
        var item = EMOJIS.find(function (i) { return i.e === btn.dataset.emoji; });
        if (!item) return;
        var matches = !q || item.n.indexOf(q) !== -1 || item.k.some(function (k) { return k.indexOf(q) !== -1; });
        btn.style.display = matches ? '' : 'none';
      });
    });

    // Select emoji
    function selectEmoji(emoji) {
      if (msgId) {
        addReaction(msgId, emoji);
      } else {
        // Input emoji mode
        var input = getInputEl();
        if (input) {
          var start = input.selectionStart || 0;
          var end = input.selectionEnd || 0;
          input.value = input.value.substring(0, start) + emoji + input.value.substring(end);
          input.selectionStart = input.selectionEnd = start + emoji.length;
          input.focus();
          input.dispatchEvent(new Event('input'));
        }
      }
      closeEmojiPicker();
    }

    picker.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-emoji]');
      if (btn) selectEmoji(btn.dataset.emoji);
    });

    setTimeout(function () {
      _emojiCloseHandler = function (e) {
        if (_emojiPicker && !_emojiPicker.contains(e.target)) closeEmojiPicker();
      };
      document.addEventListener('click', _emojiCloseHandler);
    }, 0);
  }

  function addReaction(msgId, emoji) {
    doAction('chat:react', { messageId: msgId, emoji: emoji });
    // Optimistic update
    var msgEl = getMsgsEl() && getMsgsEl().querySelector('[data-msg-id="' + escapeHtml(String(msgId)) + '"]');
    if (!msgEl) return;
    var reactionsDiv = msgEl.querySelector('.gs-sc-reactions');
    if (!reactionsDiv) {
      reactionsDiv = document.createElement('div');
      reactionsDiv.className = 'gs-sc-reactions';
      var meta = msgEl.querySelector('.gs-sc-meta');
      if (meta) msgEl.insertBefore(reactionsDiv, meta);
      else msgEl.appendChild(reactionsDiv);
    }
    var existing = reactionsDiv.querySelector('[data-emoji="' + escapeHtml(emoji) + '"]');
    if (existing) {
      existing.classList.add('gs-sc-reaction-mine');
      var countEl = existing.querySelector('.gs-sc-reaction-count');
      if (countEl) countEl.textContent = parseInt(countEl.textContent || '0', 10) + 1;
    } else {
      var span = document.createElement('span');
      span.className = 'gs-sc-reaction gs-sc-reaction-mine';
      span.dataset.msgId = msgId;
      span.dataset.emoji = emoji;
      span.innerHTML = '<span class="gs-sc-reaction-emoji">' + escapeHtml(emoji) + '</span>' +
        '<span class="gs-sc-reaction-count">1</span>';
      reactionsDiv.appendChild(span);
    }
  }

  function wireReactionClicks() {
    var container = getMsgsEl();
    if (!container) return;
    container.addEventListener('click', function (e) {
      // Reply quote click → jump to original message (always via API, same as pin jump)
      var quote = e.target.closest('.gs-sc-reply-quote');
      if (quote) {
        var replyId = quote.dataset.replyId;
        if (replyId) doAction('chat:jumpToMessage', { messageId: replyId });
        return;
      }

      // Reaction click → toggle reaction
      var reactionEl = e.target.closest('.gs-sc-reaction');
      if (!reactionEl) return;
      var msgId = reactionEl.dataset.msgId;
      var emoji = reactionEl.dataset.emoji;
      if (msgId && emoji) addReaction(msgId, emoji);
    });
  }

  function wireEmojiButton() {
    var container = getContainer();
    if (!container) return;
    var btn = container.querySelector('.gs-sc-emoji-btn');
    if (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (_emojiPicker) { closeEmojiPicker(); return; }
        openEmojiPicker(btn, null);
      });
    }
  }

  // ═══════════════════════════════════════════
  // FLOATING ACTION BAR
  // ═══════════════════════════════════════════

  var _fbarEl = null;
  var _fbarMsgEl = null;
  var _fbarShowTimer = null;
  var _fbarHideTimer = null;

  function wireFloatingBar() {
    var container = getMsgsEl();
    if (!container) return;

    container.addEventListener('mouseover', function (e) {
      var msgEl = e.target.closest('.gs-sc-msg:not(.gs-sc-msg-system):not(.gs-sc-msg-placeholder)');
      if (!msgEl || msgEl === _fbarMsgEl) return;
      clearTimeout(_fbarHideTimer);
      _fbarShowTimer = setTimeout(function () { showFloatingBar(msgEl); }, 150);
    });

    container.addEventListener('mouseout', function (e) {
      var related = e.relatedTarget;
      if (related && (related.closest('.gs-sc-fbar') || related.closest('.gs-sc-msg'))) return;
      clearTimeout(_fbarShowTimer);
      _fbarHideTimer = setTimeout(hideFloatingBar, 150);
    });

    container.addEventListener('click', function (e) {
      var btn = e.target.closest('.gs-sc-fbar-btn');
      if (!btn) return;
      e.stopPropagation();
      var msgEl = _fbarMsgEl;
      if (!msgEl) return;
      var msgId = msgEl.dataset.msgId;
      var action = btn.dataset.action;
      var sender = msgEl.dataset.sender || '';
      var isOwn = sender === _state.currentUser;
      var textEl = msgEl.querySelector('.gs-sc-text');
      var text = textEl ? textEl.textContent.trim() : '';

      if (action === 'react') {
        openEmojiPicker(btn, msgId);
      } else if (action === 'reply') {
        setReply(msgId, sender, text.slice(0, 100));
      } else if (action === 'copy') {
        if (text) {
          navigator.clipboard.writeText(text).then(function () { showToast('Copied', 1500); });
        }
      } else if (action === 'more') {
        var btnRect = btn.getBoundingClientRect();
        openMoreMenu(msgId, isOwn, text, msgEl, btnRect);
      }
    });
  }

  function showFloatingBar(msgEl) {
    hideFloatingBar();
    _fbarMsgEl = msgEl;
    if (!_fbarEl) {
      _fbarEl = document.createElement('div');
      _fbarEl.className = 'gs-sc-fbar';
      _fbarEl.innerHTML =
        '<button class="gs-sc-fbar-btn gs-btn-icon" data-action="react" title="React"><i class="codicon codicon-smiley"></i></button>' +
        '<button class="gs-sc-fbar-btn gs-btn-icon" data-action="reply" title="Reply"><i class="codicon codicon-reply"></i></button>' +
        '<button class="gs-sc-fbar-btn gs-btn-icon" data-action="copy" title="Copy"><i class="codicon codicon-copy"></i></button>' +
        '<button class="gs-sc-fbar-btn gs-btn-icon" data-action="more" title="More"><i class="codicon codicon-ellipsis"></i></button>';
      _fbarEl.addEventListener('mouseenter', function () { clearTimeout(_fbarHideTimer); });
      _fbarEl.addEventListener('mouseleave', function () { _fbarHideTimer = setTimeout(hideFloatingBar, 150); });
    }

    var isOut = msgEl.classList.contains('gs-sc-msg-out');
    _fbarEl.style.left = isOut ? '' : '4px';
    _fbarEl.style.right = isOut ? '4px' : '';

    var row = msgEl.closest('.gs-sc-msg-row') || msgEl;
    row.style.position = 'relative';
    row.appendChild(_fbarEl);
    _fbarEl.classList.add('gs-sc-fbar-visible');
  }

  function hideFloatingBar() {
    // Don't hide if more menu is open
    if (document.querySelector('.gs-sc-more-menu')) return;
    if (_fbarEl) {
      _fbarEl.classList.remove('gs-sc-fbar-visible');
      if (_fbarEl.parentNode) _fbarEl.parentNode.removeChild(_fbarEl);
    }
    _fbarMsgEl = null;
  }

  // ═══════════════════════════════════════════
  // PINNED MESSAGES
  // ═══════════════════════════════════════════

  var _pinIndex = 0;

  function buildAccentBar(total, activeIndex) {
    if (total <= 0) return '<div class="gs-sc-pin-accent-bar"></div>';
    if (total === 1) {
      return '<div class="gs-sc-pin-accent-bar"><div class="gs-sc-pin-segments" style="top:0;bottom:0;">' +
        '<div class="gs-sc-pin-segment active" style="flex:1;"></div></div></div>';
    }
    var maxVisible = Math.min(total, 3);
    var windowStart = 0;
    if (total > 3) {
      windowStart = Math.max(0, Math.min(activeIndex - 1, total - 3));
    }
    var gapPx = 2;
    var segHeight = 'calc((100% - ' + ((maxVisible - 1) * gapPx) + 'px) / ' + maxVisible + ')';
    var segments = '';
    for (var i = 0; i < total; i++) {
      var cls = i === activeIndex ? 'gs-sc-pin-segment active' : 'gs-sc-pin-segment';
      segments += '<div class="' + cls + '" style="height:' + segHeight + ';flex-shrink:0;"></div>';
    }
    var offsetCalc = windowStart > 0
      ? 'calc(-' + windowStart + ' * (100% / ' + maxVisible + '))'
      : '0';
    return '<div class="gs-sc-pin-accent-bar">' +
      '<div class="gs-sc-pin-segments" style="top:0;bottom:0;transform:translateY(' + offsetCalc + ');">' +
      segments + '</div></div>';
  }

  function renderPinnedBanner() {
    var banner = _els.pinBanner;
    if (!banner) return;
    if (_state.pinnedMessages.length === 0) {
      banner.style.display = 'none';
      return;
    }
    var pin = _state.pinnedMessages[_pinIndex] || _state.pinnedMessages[0];
    var rawText = (pin.body || pin.content || pin.text || '');
    var hasAttach = (pin.attachments && pin.attachments.length) || pin.attachment_url;
    var preview = rawText ? (rawText.length > 50 ? rawText.slice(0, 50) + '\u2026' : rawText)
      : hasAttach ? 'Photo' : '';
    var label = _state.pinnedMessages.length === 1
      ? 'Pinned Message'
      : 'Pinned Message <span class="gs-sc-pin-counter">#' + (_pinIndex + 1) + '</span>';
    // Thumbnail for image attachments
    var thumbHtml = '';
    var attachUrl = pin.attachment_url || '';
    if (!attachUrl && pin.attachments && pin.attachments.length) {
      var imgA = pin.attachments.find(function (a) {
        return (a.mime_type && a.mime_type.startsWith('image/')) || a.type === 'gif' || a.type === 'image';
      });
      if (imgA) attachUrl = imgA.url || '';
    }
    if (attachUrl) {
      thumbHtml = '<img class="gs-sc-pin-thumb" src="' + escapeHtml(attachUrl) + '" alt="">';
    }
    banner.innerHTML =
      buildAccentBar(_state.pinnedMessages.length, _pinIndex) +
      thumbHtml +
      '<div class="gs-sc-pin-content">' +
        '<span class="gs-sc-pin-label">' + label + '</span>' +
        '<span class="gs-sc-pin-text">' + escapeHtml(preview) + '</span>' +
      '</div>' +
      '<button class="gs-sc-pin-list-btn gs-btn-icon"><span class="codicon codicon-list-flat"></span></button>';
    banner.style.display = 'flex';

    // Click banner content → cycle through or jump
    banner.querySelector('.gs-sc-pin-content').addEventListener('click', function () {
      if (_state.pinnedMessages.length > 1) {
        _pinIndex = (_pinIndex + 1) % _state.pinnedMessages.length;
        renderPinnedBanner();
      }
      var pinId = (_state.pinnedMessages[_pinIndex] || {}).id;
      if (pinId) doAction('chat:jumpToMessage', { messageId: pinId });
    });

    // Click pin icon → open pinned list view
    banner.querySelector('.gs-sc-pin-list-btn').addEventListener('click', function (e) {
      e.stopPropagation();
      openPinnedView();
    });
  }

  var _pinSearchQuery = '';
  var _pinViewMode = false;

  function openPinnedView() {
    var area = _els.messagesArea;
    if (!area) return;
    var existing = area.querySelector('.gs-sc-pin-view');
    if (existing) { closePinnedView(); return; }

    _pinViewMode = true;

    // Hide header, input, pin banner
    if (_els.header) _els.header.style.display = 'none';
    if (_els.inputArea) _els.inputArea.style.display = 'none';
    if (_els.pinBanner) _els.pinBanner.style.display = 'none';

    var overlay = document.createElement('div');
    overlay.className = 'gs-sc-pin-view';

    overlay.innerHTML =
      '<div class="gs-sc-pin-view-header">' +
        '<button class="gs-sc-pin-view-back gs-btn-icon"><i class="codicon codicon-arrow-left"></i></button>' +
        '<span class="gs-sc-pin-view-title">' + _state.pinnedMessages.length + ' Pinned Messages</span>' +
        '<button class="gs-sc-pin-view-search-btn gs-btn-icon"><i class="codicon codicon-search"></i></button>' +
      '</div>' +
      '<div class="gs-sc-pin-view-body"></div>' +
      '<div class="gs-sc-pin-view-footer">' +
        '<button class="gs-sc-pin-unpin-all">Unpin All ' + _state.pinnedMessages.length + ' Messages</button>' +
      '</div>';

    area.appendChild(overlay);
    updatePinnedViewBody(overlay);

    // Back button
    overlay.querySelector('.gs-sc-pin-view-back').addEventListener('click', function () { closePinnedView(); });

    // Search button
    overlay.querySelector('.gs-sc-pin-view-search-btn').addEventListener('click', function () { togglePinViewSearch(overlay); });

    // Unpin all — with confirm modal
    overlay.querySelector('.gs-sc-pin-unpin-all').addEventListener('click', function () {
      showConfirmModal(
        'Do you want to unpin all ' + _state.pinnedMessages.length + ' messages in this chat?',
        'Unpin All',
        function () {
          doAction('chat:unpinAllMessages', { conversationId: _state.conversationId });
          closePinnedView();
        }
      );
    });

    // Click on jump arrow only → jump
    overlay.querySelector('.gs-sc-pin-view-body').addEventListener('click', function (e) {
      var jumpBtn = e.target.closest('.gs-sc-pin-jump-btn');
      if (!jumpBtn) return;
      e.stopPropagation();
      var msgEl = jumpBtn.closest('[data-msg-id]');
      if (msgEl) {
        closePinnedView(function () { doAction('chat:jumpToMessage', { messageId: msgEl.dataset.msgId }); });
      }
    });

    // Animate open
    overlay.style.display = 'flex';
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        overlay.classList.add('gs-sc-pin-view-open');
      });
    });
  }

  function updatePinnedViewBody(overlay) {
    var body = overlay.querySelector('.gs-sc-pin-view-body');
    if (!body) return;

    var pins = _state.pinnedMessages;
    if (_pinSearchQuery) {
      var q = _pinSearchQuery.toLowerCase();
      pins = pins.filter(function (p) {
        return ((p.body || p.content || '').toLowerCase().indexOf(q) !== -1) ||
               ((p.sender_login || p.sender || '').toLowerCase().indexOf(q) !== -1);
      });
    }

    if (!pins.length) {
      body.innerHTML = '<div class="gs-sc-pin-view-empty">' + (_pinSearchQuery ? 'No matches' : 'No pinned messages') + '</div>';
      return;
    }

    // Sort by date ascending
    pins = pins.slice().sort(function (a, b) {
      return new Date(a.created_at || 0) - new Date(b.created_at || 0);
    });

    // Render as message bubbles with date separators + pin star + jump buttons
    var html = '';
    var lastDate = '';
    pins.forEach(function (m) {
      var dateStr = m.created_at ? new Date(m.created_at).toDateString() : '';
      var showDate = dateStr && dateStr !== lastDate;
      if (showDate) lastDate = dateStr;
      var pinMsg = Object.assign({}, m, { groupPosition: 'single' });
      var msgHtml = renderMessage(pinMsg);
      // Inject pin star into meta
      msgHtml = msgHtml.replace(
        /(<div[^>]*class="gs-sc-meta[^"]*"[^>]*>)/,
        '$1<span class="gs-sc-pin-star">★</span> '
      );
      if (showDate) {
        var dateLabel = new Date(m.created_at).toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
        html += '<div class="gs-sc-date-sep"><div class="gs-sc-date-line"></div><span class="gs-sc-date-label">' + escapeHtml(dateLabel) + '</span><div class="gs-sc-date-line"></div></div>';
      }
      html += msgHtml;
    });
    body.innerHTML = html;

    // Inject jump buttons below each bubble (inside .gs-sc-msg)
    body.querySelectorAll('.gs-sc-msg-row').forEach(function (row) {
      var msgEl = row.querySelector('.gs-sc-msg');
      if (!msgEl) return;
      var isOutgoing = msgEl.classList.contains('gs-sc-msg-out');
      msgEl.style.position = 'relative';
      var btn = document.createElement('button');
      btn.className = 'gs-sc-pin-jump-btn ' + (isOutgoing ? 'gs-sc-pin-jump-left' : 'gs-sc-pin-jump-right');
      btn.setAttribute('aria-label', 'Jump to message');
      btn.innerHTML = '<i class="codicon codicon-arrow-right"></i>';
      msgEl.appendChild(btn);
    });
  }

  function togglePinViewSearch(overlay) {
    var existing = overlay.querySelector('.gs-sc-pin-search-bar');
    if (existing) {
      existing.remove();
      _pinSearchQuery = '';
      updatePinnedViewBody(overlay);
      return;
    }

    var bar = document.createElement('div');
    bar.className = 'gs-sc-pin-search-bar';
    bar.innerHTML =
      '<div class="gs-search-input-wrap">' +
        '<span class="codicon codicon-search gs-search-icon"></span>' +
        '<input type="text" class="gs-input gs-search-has-icon" placeholder="Search pinned..." autocomplete="off">' +
        '<button class="gs-search-clear codicon codicon-close" style="display:none" title="Clear"></button>' +
      '</div>';

    var header = overlay.querySelector('.gs-sc-pin-view-header');
    if (header) header.after(bar);

    var input = bar.querySelector('input');
    var clearBtn = bar.querySelector('.gs-search-clear');
    input.focus();

    var debounceTimer;
    input.addEventListener('input', function () {
      clearBtn.style.display = input.value ? 'inline-flex' : 'none';
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function () {
        _pinSearchQuery = input.value.trim().toLowerCase();
        updatePinnedViewBody(overlay);
      }, 200);
    });

    clearBtn.addEventListener('click', function () {
      input.value = '';
      _pinSearchQuery = '';
      clearBtn.style.display = 'none';
      updatePinnedViewBody(overlay);
      input.focus();
    });
  }

  function closePinnedView(callback) {
    _pinViewMode = false;
    _pinSearchQuery = '';

    function restoreChat() {
      if (_els.header) _els.header.style.display = '';
      if (_els.inputArea) _els.inputArea.style.display = '';
      renderPinnedBanner();
      if (callback) callback();
    }

    var area = _els.messagesArea;
    if (!area) { restoreChat(); return; }
    var view = area.querySelector('.gs-sc-pin-view');
    if (view) {
      view.classList.remove('gs-sc-pin-view-open');
      view.classList.add('gs-sc-pin-view-closing');
      view.addEventListener('transitionend', function onEnd() {
        view.removeEventListener('transitionend', onEnd);
        view.remove();
        restoreChat();
      }, { once: true });
      // Fallback if transition doesn't fire
      setTimeout(function () {
        if (view.parentNode) {
          view.remove();
          restoreChat();
        }
      }, 300);
    } else {
      restoreChat();
    }
  }

  // ═══════════════════════════════════════════
  // IN-CHAT SEARCH
  // ═══════════════════════════════════════════

  var _searchState = 'idle'; // idle | active | loading | results | chatNav
  var _searchQuery = '';
  var _searchResults = [];
  var _searchNextCursor = null;
  var _searchPendingCursor = null;
  var _searchHighlight = -1;
  var _searchResultIdx = 0;
  var _searchUserFilter = null;
  var _searchDebounce = null;
  var _searchKeyword = null;
  var _searchSnapshot = null;

  function wireSearchButton() {
    var container = getContainer();
    if (!container) return;
    var btn = container.querySelector('.gs-sc-search-btn');
    if (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (_searchState !== 'idle') { closeSearch(); return; }
        openSearch();
      });
    }
  }

  function openSearch() {
    _searchState = 'active';
    _searchQuery = '';
    _searchResults = [];
    _searchNextCursor = null;
    _searchHighlight = -1;
    _searchResultIdx = 0;
    _searchUserFilter = null;
    _searchKeyword = null;
    _searchSnapshot = null;
    renderSearchBar();
  }

  function closeSearch() {
    if (_searchState === 'idle') return;
    if (_searchSnapshot) {
      doAction('chat:reloadConversation');
      _searchSnapshot = null;
    }
    _searchState = 'idle';
    _searchQuery = '';
    _searchResults = [];
    if (_searchDebounce) clearTimeout(_searchDebounce);
    var container = getContainer();
    if (container) {
      var bar = container.querySelector('.gs-sc-search-bar');
      if (bar) bar.remove();
      var overlay = container.querySelector('.gs-sc-search-overlay');
      if (overlay) overlay.remove();
    }
  }

  function renderSearchBar() {
    var container = getContainer();
    if (!container) return;
    var existing = container.querySelector('.gs-sc-search-bar');
    if (existing) existing.remove();

    var bar = document.createElement('div');
    bar.className = 'gs-sc-search-bar';

    var inChatNav = _searchState === 'chatNav';
    var hasResults = _searchResults.length > 0;
    var counterText = '';
    if (hasResults) {
      counterText = inChatNav
        ? (_searchResultIdx + 1) + ' of ' + _searchResults.length + (_searchNextCursor ? '+' : '')
        : _searchResults.length + ' result' + (_searchResults.length !== 1 ? 's' : '') + (_searchNextCursor ? '+' : '');
    }

    bar.innerHTML =
      '<div class="gs-sc-search-bar-left">' +
        '<button class="gs-sc-search-close gs-btn-icon"><i class="codicon codicon-arrow-left"></i></button>' +
      '</div>' +
      '<div class="gs-sc-search-input-wrap">' +
        '<i class="codicon codicon-search gs-sc-search-icon"></i>' +
        (_searchUserFilter ? '<span class="gs-sc-search-user-badge">from: <b>' + escapeHtml(_searchUserFilter) + '</b> <i class="codicon codicon-close"></i></span>' : '') +
        '<input class="gs-sc-search-input" type="text" placeholder="Search messages\u2026" value="' + escapeHtml(_searchQuery) + '">' +
        (_searchState === 'loading' ? '<div class="gs-sc-search-spinner"></div>' : '') +
        (counterText ? '<span class="gs-sc-search-counter">' + counterText + '</span>' : '') +
      '</div>' +
      '<div class="gs-sc-search-bar-right">' +
        '<button class="gs-sc-search-up gs-btn-icon" title="Previous"' + (hasResults ? '' : ' disabled') + '><i class="codicon codicon-chevron-up"></i></button>' +
        '<button class="gs-sc-search-down gs-btn-icon" title="Next"' + (hasResults ? '' : ' disabled') + '><i class="codicon codicon-chevron-down"></i></button>' +
        (_state.isGroup ? '<button class="gs-sc-search-filter-user gs-btn-icon" title="Filter by user"><i class="codicon codicon-person"></i></button>' : '') +
      '</div>';

    // Insert after header
    var header = container.querySelector('.gs-sc-header');
    if (header) header.after(bar);

    bindSearchBarEvents(bar);
  }

  function bindSearchBarEvents(bar) {
    var input = bar.querySelector('.gs-sc-search-input');
    if (input) {
      input.focus();
      input.addEventListener('input', function () {
        _searchQuery = this.value;
        if (_searchDebounce) clearTimeout(_searchDebounce);
        if (!_searchQuery.trim() && !_searchUserFilter) {
          _searchResults = [];
          _searchState = 'active';
          renderSearchResults();
          updateSearchBarState();
          return;
        }
        _searchDebounce = setTimeout(function () {
          _searchState = 'loading';
          updateSearchBarState();
          renderSearchResults();
          doAction('chat:searchMessages', { query: _searchQuery, user: _searchUserFilter || undefined, conversationId: _state.conversationId });
        }, 300);
      });
      input.addEventListener('focus', function () {
        if (_searchState === 'chatNav' && _searchResults.length > 0) {
          _searchState = 'results';
          renderSearchResults();
        }
      });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') closeSearch();
      });
    }

    bar.querySelector('.gs-sc-search-close').addEventListener('click', closeSearch);

    var upBtn = bar.querySelector('.gs-sc-search-up');
    var downBtn = bar.querySelector('.gs-sc-search-down');
    if (upBtn) upBtn.addEventListener('click', function () {
      if (_searchState === 'chatNav' && _searchResultIdx > 0) jumpToSearchResult(_searchResultIdx - 1);
    });
    if (downBtn) downBtn.addEventListener('click', function () {
      if (_searchState === 'chatNav' && _searchResultIdx < _searchResults.length - 1) jumpToSearchResult(_searchResultIdx + 1);
    });

    var filterBtn = bar.querySelector('.gs-sc-search-filter-user');
    if (filterBtn) filterBtn.addEventListener('click', toggleSearchUserFilter);

    var badge = bar.querySelector('.gs-sc-search-user-badge');
    if (badge) badge.addEventListener('click', function () {
      _searchUserFilter = null;
      reSearch();
      renderSearchBar();
    });
  }

  function updateSearchBarState() {
    var container = getContainer();
    if (!container) return;
    var bar = container.querySelector('.gs-sc-search-bar');
    if (!bar) return;
    var counter = bar.querySelector('.gs-sc-search-counter');
    var hasResults = _searchResults.length > 0;
    var inChatNav = _searchState === 'chatNav';
    if (hasResults) {
      var text = inChatNav
        ? (_searchResultIdx + 1) + ' of ' + _searchResults.length + (_searchNextCursor ? '+' : '')
        : _searchResults.length + ' result' + (_searchResults.length !== 1 ? 's' : '') + (_searchNextCursor ? '+' : '');
      if (counter) counter.textContent = text;
      else {
        var wrap = bar.querySelector('.gs-sc-search-input-wrap');
        if (wrap) wrap.insertAdjacentHTML('beforeend', '<span class="gs-sc-search-counter">' + text + '</span>');
      }
    } else if (counter) {
      counter.remove();
    }

    var upBtn = bar.querySelector('.gs-sc-search-up');
    var downBtn = bar.querySelector('.gs-sc-search-down');
    if (upBtn) upBtn.disabled = !hasResults;
    if (downBtn) downBtn.disabled = !hasResults;

    // Spinner
    var spinner = bar.querySelector('.gs-sc-search-spinner');
    if (_searchState === 'loading' && !spinner) {
      var wrap = bar.querySelector('.gs-sc-search-input-wrap');
      if (wrap) wrap.insertAdjacentHTML('beforeend', '<div class="gs-sc-search-spinner"></div>');
    } else if (_searchState !== 'loading' && spinner) {
      spinner.remove();
    }
  }

  function renderSearchResults() {
    var area = _els.messagesArea;
    if (!area) return;
    var existing = area.querySelector('.gs-sc-search-overlay');
    if (!existing) {
      existing = document.createElement('div');
      existing.className = 'gs-sc-search-overlay';
      area.appendChild(existing);
    }

    if (!_searchQuery.trim() && !_searchUserFilter) {
      existing.style.display = 'none';
      return;
    }
    existing.style.display = '';

    if (_searchState === 'loading' && _searchResults.length === 0) {
      existing.innerHTML = '<div class="gs-sc-search-empty"><div class="gs-sc-search-spinner" style="width:24px;height:24px;border-width:3px;"></div></div>';
      return;
    }
    if (_searchResults.length === 0) {
      existing.innerHTML = '<div class="gs-sc-search-empty">No messages found</div>';
      return;
    }

    var html = _searchResults.map(function (result, i) {
      var preview = (result.body || result.content || '').slice(0, 80);
      var highlighted = highlightKeyword(escapeHtml(preview), _searchQuery);
      var senderName = result.sender_login || result.sender || '';
      var dateStr = formatSearchDate(result.created_at);
      return '<div class="gs-sc-search-result' + (i === _searchHighlight ? ' gs-sc-search-highlighted' : '') + '" data-index="' + i + '">' +
        '<div class="gs-sc-search-result-body">' +
          '<div class="gs-sc-search-result-sender">@' + escapeHtml(senderName) + '</div>' +
          '<div class="gs-sc-search-result-preview">' + highlighted + '</div>' +
        '</div>' +
        '<div class="gs-sc-search-result-date">' + dateStr + '</div>' +
      '</div>';
    }).join('');
    existing.innerHTML = html;

    existing.querySelectorAll('.gs-sc-search-result').forEach(function (row) {
      row.addEventListener('click', function () {
        jumpToSearchResult(parseInt(this.dataset.index, 10));
      });
    });
  }

  function jumpToSearchResult(index) {
    if (index < 0 || index >= _searchResults.length) return;
    _searchResultIdx = index;
    _searchKeyword = _searchQuery;
    if (!_searchSnapshot) _searchSnapshot = true;
    var msgId = _searchResults[index].id;
    _searchState = 'chatNav';
    var overlay = _els.messagesArea && _els.messagesArea.querySelector('.gs-sc-search-overlay');
    if (overlay) overlay.style.display = 'none';
    updateSearchBarState();
    _state.isViewingContext = true;
    doAction('chat:jumpToMessage', { messageId: msgId });
  }

  function reSearch() {
    _searchResults = [];
    _searchNextCursor = null;
    _searchHighlight = -1;
    if (_searchQuery.trim() || _searchUserFilter) {
      _searchState = 'loading';
      renderSearchBar();
      renderSearchResults();
      doAction('chat:searchMessages', { query: _searchQuery, user: _searchUserFilter || undefined, conversationId: _state.conversationId });
    } else {
      _searchState = 'active';
      renderSearchBar();
      renderSearchResults();
    }
  }

  function toggleSearchUserFilter() {
    var area = _els.messagesArea;
    if (!area) return;
    var existing = area.querySelector('.gs-sc-search-user-dropdown');
    if (existing) { existing.remove(); return; }

    var members = _state.groupMembers || [];
    if (!members.length) return;

    var dropdown = document.createElement('div');
    dropdown.className = 'gs-sc-search-user-dropdown';
    dropdown.innerHTML = members.map(function (m) {
      return '<div class="gs-sc-search-user-item" data-login="' + escapeHtml(m.login) + '">' +
        '<span>@' + escapeHtml(m.login) + '</span>' +
      '</div>';
    }).join('');
    area.appendChild(dropdown);

    dropdown.querySelectorAll('.gs-sc-search-user-item').forEach(function (item) {
      item.addEventListener('click', function () {
        _searchUserFilter = item.dataset.login;
        dropdown.remove();
        reSearch();
      });
    });

    setTimeout(function () {
      document.addEventListener('click', function handler(e) {
        if (!dropdown.contains(e.target)) { dropdown.remove(); document.removeEventListener('click', handler); }
      });
    }, 0);
  }

  function highlightKeyword(text, query) {
    if (!query) return text;
    var escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return text.replace(new RegExp('(' + escaped + ')', 'gi'), '<mark>$1</mark>');
  }

  function formatSearchDate(dateStr) {
    if (!dateStr) return '';
    var d = new Date(dateStr);
    var now = new Date();
    var diffDays = Math.floor((now - d) / 86400000);
    if (diffDays === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return d.toLocaleDateString([], { weekday: 'short' });
    return d.getDate() + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + String(d.getFullYear()).slice(-2);
  }

  // ═══════════════════════════════════════════
  // ATTACHMENTS + LINK PREVIEWS
  // ═══════════════════════════════════════════

  var _attachIdCounter = 0;
  var MAX_ATTACHMENTS = 10;
  var MAX_FILE_SIZE = 10 * 1024 * 1024;
  var _attachModalOpen = false;
  var _inputLpUrl = null;
  var _inputLpDismissed = false;
  var _inputLpDebounce = null;
  var _linkPreviewCache = {};
  var _conversations = [];

  function wireAttachButton() {
    var container = getContainer();
    if (!container) return;
    var btn = container.querySelector('.gs-sc-attach-btn');
    if (!btn) return;
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      openAttachMenu(btn);
    });
  }

  function openAttachMenu(anchorBtn) {
    var existing = getContainer() && getContainer().querySelector('.gs-sc-attach-menu');
    if (existing) { existing.remove(); return; }

    var menu = document.createElement('div');
    menu.className = 'gs-sc-attach-menu';
    menu.innerHTML =
      '<div class="gs-sc-attach-menu-item" data-action="photo"><span class="codicon codicon-file-media"></span> Photo / Video</div>' +
      '<div class="gs-sc-attach-menu-item" data-action="document"><span class="codicon codicon-file"></span> Document</div>' +
      '<div class="gs-sc-attach-menu-item" data-action="code"><span class="codicon codicon-code"></span> Code Snippet</div>';

    var inputArea = _els.inputArea;
    if (inputArea) inputArea.appendChild(menu);

    menu.querySelectorAll('.gs-sc-attach-menu-item').forEach(function (item) {
      item.addEventListener('click', function () {
        var action = item.dataset.action;
        if (action === 'photo') doAction('chat:pickPhoto');
        else if (action === 'code') doAction('chat:insertCode');
        else doAction('chat:pickFile');
        menu.remove();
      });
    });

    setTimeout(function () {
      document.addEventListener('click', function handler(e) {
        if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', handler); }
      });
    }, 0);
  }

  // ── File picking from extension (via dialog) ──
  function addPickedFile(fileData) {
    if (_state.pendingAttachments.length >= MAX_ATTACHMENTS) return;
    var fakeFile = { name: fileData.filename || fileData.name || 'file', type: fileData.mimeType || '' };
    _state.pendingAttachments.push({
      id: fileData.id || ++_attachIdCounter,
      file: fakeFile,
      status: 'uploading',
      result: null,
      _dataUri: fileData.dataUri || null,
      _blobUrl: null,
    });
    renderAttachPreviews();
  }

  // ── Client-side file upload (paste, drag-drop) ──
  function uploadFile(file) {
    if (_state.pendingAttachments.length >= MAX_ATTACHMENTS) {
      showToast('Maximum ' + MAX_ATTACHMENTS + ' attachments', 3000);
      return;
    }
    if (file.size > MAX_FILE_SIZE) { showToast('File too large (max 10MB)', 3000); return; }
    var id = ++_attachIdCounter;
    _state.pendingAttachments.push({
      id: id,
      file: file,
      status: 'uploading',
      result: null,
      _dataUri: null,
      _blobUrl: null,
    });
    renderAttachPreviews();

    var reader = new FileReader();
    reader.onload = function () {
      var base64 = reader.result.split(',')[1];
      doAction('chat:upload', {
        id: id,
        data: base64,
        filename: file.name || 'pasted-image.png',
        mimeType: file.type || 'application/octet-stream',
      });
    };
    reader.readAsDataURL(file);
  }

  // ── Thumbnail helper ──
  function getThumbSrc(a) {
    if (a._dataUri) return a._dataUri;
    if (a._blobUrl) return a._blobUrl;
    if (a.file instanceof Blob) { a._blobUrl = URL.createObjectURL(a.file); return a._blobUrl; }
    return '';
  }

  function isImageFile(a) {
    var type = (a.file && a.file.type) || '';
    return type.startsWith('image/');
  }

  // ── Telegram-style attach modal ──
  function renderAttachPreviews() {
    var area = _els.messagesArea;
    if (!area) return;
    var oldModal = area.querySelector('.gs-sc-attach-modal-overlay');

    // No attachments → remove modal
    if (_state.pendingAttachments.length === 0) {
      if (oldModal) oldModal.remove();
      _attachModalOpen = false;
      // Also hide old strip
      if (_els.attachStrip) { _els.attachStrip.style.display = 'none'; _els.attachStrip.innerHTML = ''; }
      return;
    }

    var images = _state.pendingAttachments.filter(isImageFile);
    var files = _state.pendingAttachments.filter(function (a) { return !isImageFile(a); });

    function buildPreviewHtml() {
      var html = '';
      if (images.length === 1) {
        var src = getThumbSrc(images[0]);
        html += '<div class="gs-sc-attach-modal-single">' +
          '<img class="gs-sc-attach-modal-single-blur" src="' + src + '" aria-hidden="true" />' +
          '<img class="gs-sc-attach-modal-single-img" src="' + src + '" />' +
        '</div>';
      } else if (images.length >= 2) {
        function cell(img) {
          var s = getThumbSrc(img);
          return '<div class="gs-sc-attach-mosaic-cell">' +
            '<img class="gs-sc-attach-mosaic-blur" src="' + s + '" aria-hidden="true" />' +
            '<img class="gs-sc-attach-mosaic-img" src="' + s + '" />' +
          '</div>';
        }
        html += '<div class="gs-sc-attach-modal-mosaic">';
        if (images.length === 2) {
          html += '<div class="gs-sc-attach-mosaic-row gs-sc-attach-mosaic-row-2">' + cell(images[0]) + cell(images[1]) + '</div>';
        } else if (images.length === 3) {
          html += '<div class="gs-sc-attach-mosaic-hero-cell">' +
            '<img class="gs-sc-attach-mosaic-blur" src="' + getThumbSrc(images[0]) + '" aria-hidden="true" />' +
            '<img class="gs-sc-attach-mosaic-img" src="' + getThumbSrc(images[0]) + '" />' +
          '</div>';
          html += '<div class="gs-sc-attach-mosaic-row gs-sc-attach-mosaic-row-2">' + cell(images[1]) + cell(images[2]) + '</div>';
        } else if (images.length === 4) {
          html += '<div class="gs-sc-attach-mosaic-row gs-sc-attach-mosaic-row-2">' + cell(images[0]) + cell(images[1]) + '</div>';
          html += '<div class="gs-sc-attach-mosaic-row gs-sc-attach-mosaic-row-2">' + cell(images[2]) + cell(images[3]) + '</div>';
        } else {
          var idx = 0, rowToggle = false;
          while (idx < images.length) {
            var remaining = images.length - idx;
            var cols = remaining <= 3 ? remaining : (rowToggle ? 3 : 2);
            html += '<div class="gs-sc-attach-mosaic-row gs-sc-attach-mosaic-row-' + cols + '">';
            for (var c = 0; c < cols && idx < images.length; c++, idx++) { html += cell(images[idx]); }
            html += '</div>';
            rowToggle = !rowToggle;
          }
        }
        html += '</div>';
      }
      for (var f = 0; f < files.length; f++) {
        html += '<div class="gs-sc-attach-modal-file">' +
          '<span class="codicon codicon-file" style="font-size:32px;opacity:0.5"></span>' +
          '<span class="gs-sc-attach-modal-filename">' + escapeHtml(files[f].file.name || 'file') + '</span>' +
        '</div>';
      }
      return html;
    }

    var allReady = _state.pendingAttachments.every(function (a) { return a.status === 'ready'; });
    var anyFailed = _state.pendingAttachments.some(function (a) { return a.status === 'failed'; });

    // Update existing modal
    if (oldModal) {
      var previewArea = oldModal.querySelector('.gs-sc-attach-modal-preview');
      if (previewArea) previewArea.innerHTML = buildPreviewHtml();
      var titleEl = oldModal.querySelector('.gs-sc-attach-modal-title');
      if (titleEl) titleEl.textContent = _state.pendingAttachments.length + (images.length > 0 ? ' Media' : ' File');
      var statusEl = oldModal.querySelector('.gs-sc-attach-modal-status');
      if (statusEl) {
        statusEl.textContent = anyFailed ? 'Upload failed' : allReady ? '' : 'Uploading...';
        statusEl.className = 'gs-sc-attach-modal-status' + (anyFailed ? ' gs-sc-attach-failed' : '');
      }
      var sendBtn = oldModal.querySelector('.gs-sc-attach-modal-send');
      if (sendBtn) sendBtn.disabled = !allReady;
      if (allReady) {
        var cap = oldModal.querySelector('.gs-sc-attach-modal-caption');
        if (cap) cap.focus();
      }
      return;
    }

    // Create new modal
    _attachModalOpen = true;
    var hasImages = images.length > 0;
    var overlay = document.createElement('div');
    overlay.className = 'gs-sc-attach-modal-overlay';

    overlay.innerHTML =
      '<div class="gs-sc-attach-modal">' +
        '<div class="gs-sc-attach-modal-header">' +
          '<button class="gs-sc-attach-modal-close gs-btn-icon"><span class="codicon codicon-close"></span></button>' +
          '<span class="gs-sc-attach-modal-title">' + _state.pendingAttachments.length + (hasImages ? ' Media' : ' File') + '</span>' +
          '<span class="gs-sc-attach-modal-status">Uploading...</span>' +
        '</div>' +
        '<div class="gs-sc-attach-modal-preview">' + buildPreviewHtml() + '</div>' +
        '<div class="gs-sc-attach-modal-footer">' +
          '<textarea class="gs-sc-attach-modal-caption" placeholder="Add a caption..." rows="1"></textarea>' +
          '<button class="gs-sc-attach-modal-emoji gs-btn-icon" title="Emoji"><span class="codicon codicon-smiley"></span></button>' +
          '<button class="gs-sc-attach-modal-send gs-btn-icon" disabled><span class="codicon codicon-send"></span></button>' +
        '</div>' +
      '</div>';

    area.appendChild(overlay);

    // Close button
    overlay.querySelector('.gs-sc-attach-modal-close').addEventListener('click', function () {
      clearAllAttachments();
    });
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) clearAllAttachments();
    });

    // Caption auto-resize
    var captionInput = overlay.querySelector('.gs-sc-attach-modal-caption');
    function autoResizeCaption() {
      captionInput.style.height = 'auto';
      captionInput.style.height = Math.min(captionInput.scrollHeight, 120) + 'px';
    }
    captionInput.addEventListener('input', autoResizeCaption);

    // Send via Enter
    var modalSendBtn = overlay.querySelector('.gs-sc-attach-modal-send');
    captionInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && !modalSendBtn.disabled) {
        e.preventDefault();
        modalSendBtn.click();
      }
    });

    // Send button
    modalSendBtn.addEventListener('click', function () {
      var caption = captionInput.value.trim();
      var inputEl = getInputEl();
      if (inputEl) inputEl.value = caption;
      overlay.remove();
      _attachModalOpen = false;
      sendMessage();
    });

    // Emoji picker for caption
    var captionEmojiBtn = overlay.querySelector('.gs-sc-attach-modal-emoji');
    var captionEmojiPicker = null;
    captionEmojiBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (captionEmojiPicker) { captionEmojiPicker.remove(); captionEmojiPicker = null; captionEmojiBtn.classList.remove('active'); return; }
      var picker = document.createElement('div');
      picker.className = 'gs-sc-attach-modal-emoji-picker';
      captionEmojiPicker = picker;
      captionEmojiBtn.classList.add('active');
      var recentKey = '__recentEmojis';
      var recent = [];
      try { recent = JSON.parse(localStorage.getItem(recentKey) || '[]'); } catch (ex) { /* ignore */ }
      var recentHtml = recent.length > 0
        ? '<div class="iep-section"><div class="iep-section-title">RECENTLY USED</div><div class="iep-grid">' +
          recent.map(function (em) { return '<button class="iep-emoji" data-emoji="' + escapeHtml(em) + '">' + em + '</button>'; }).join('') +
          '</div></div>' : '';
      var gridHtml = '<div class="iep-section"><div class="iep-section-title">EMOJI & PEOPLE</div><div class="iep-grid">' +
        EMOJIS.map(function (item) { return '<button class="iep-emoji" data-emoji="' + escapeHtml(item.e) + '" title="' + escapeHtml(item.n) + '">' + item.e + '</button>'; }).join('') +
        '</div></div>';
      picker.innerHTML = '<div class="iep-search-row"><input class="gs-input iep-search" placeholder="Search..." /></div><div class="iep-body">' + recentHtml + gridHtml + '</div>';
      var btnRect = captionEmojiBtn.getBoundingClientRect();
      picker.style.position = 'fixed';
      picker.style.bottom = (window.innerHeight - btnRect.top + 4) + 'px';
      picker.style.right = (window.innerWidth - btnRect.right) + 'px';
      overlay.appendChild(picker);
      var searchInput = picker.querySelector('.iep-search');
      searchInput.addEventListener('input', function () {
        var q = searchInput.value.toLowerCase();
        picker.querySelectorAll('.iep-emoji').forEach(function (btn) {
          var item = EMOJIS.find(function (i) { return i.e === btn.dataset.emoji; });
          if (!item) { btn.style.display = q ? 'none' : ''; return; }
          var matches = !q || item.n.includes(q) || item.k.some(function (k) { return k.includes(q); });
          btn.style.display = matches ? '' : 'none';
        });
        picker.querySelectorAll('.iep-section-title').forEach(function (t) { t.style.display = q ? 'none' : ''; });
      });
      picker.addEventListener('click', function (ev) {
        var btn = ev.target.closest('.iep-emoji');
        if (!btn) return;
        var emoji = btn.dataset.emoji;
        var start = captionInput.selectionStart || 0;
        var end = captionInput.selectionEnd || 0;
        captionInput.value = captionInput.value.substring(0, start) + emoji + captionInput.value.substring(end);
        captionInput.selectionStart = captionInput.selectionEnd = start + emoji.length;
        captionInput.focus();
        autoResizeCaption();
        recent = recent.filter(function (x) { return x !== emoji; });
        recent.unshift(emoji);
        if (recent.length > 16) recent = recent.slice(0, 16);
        try { localStorage.setItem(recentKey, JSON.stringify(recent)); } catch (ex) { /* ignore */ }
      });
      setTimeout(function () {
        document.addEventListener('click', function closeCapEmoji(ev) {
          if (captionEmojiPicker && !captionEmojiPicker.contains(ev.target) && ev.target !== captionEmojiBtn && !captionEmojiBtn.contains(ev.target)) {
            captionEmojiPicker.remove(); captionEmojiPicker = null; captionEmojiBtn.classList.remove('active');
            document.removeEventListener('click', closeCapEmoji);
          }
        });
      }, 0);
    });

    // Focus caption if already ready
    if (allReady) {
      modalSendBtn.disabled = false;
      overlay.querySelector('.gs-sc-attach-modal-status').textContent = '';
      captionInput.focus();
    }
  }

  function removeAttachment(id) {
    var idx = -1;
    for (var i = 0; i < _state.pendingAttachments.length; i++) {
      if (_state.pendingAttachments[i].id === id) { idx = i; break; }
    }
    if (idx !== -1) {
      var removed = _state.pendingAttachments.splice(idx, 1)[0];
      if (removed._blobUrl) URL.revokeObjectURL(removed._blobUrl);
    }
    renderAttachPreviews();
  }

  function clearAllAttachments() {
    _state.pendingAttachments.forEach(function (a) {
      if (a._blobUrl) URL.revokeObjectURL(a._blobUrl);
    });
    _state.pendingAttachments = [];
    _attachModalOpen = false;
    renderAttachPreviews();
  }

  // ── Drag & drop with visual feedback ──
  function wireDragDrop() {
    var container = getContainer();
    if (!container) return;
    var inputArea = _els.inputArea;
    ['dragenter', 'dragover'].forEach(function (evt) {
      container.addEventListener(evt, function (e) {
        e.preventDefault();
        if (inputArea) inputArea.classList.add('gs-sc-drag-over');
      });
    });
    ['dragleave', 'drop'].forEach(function (evt) {
      container.addEventListener(evt, function (e) {
        e.preventDefault();
        if (inputArea) inputArea.classList.remove('gs-sc-drag-over');
      });
    });
    container.addEventListener('drop', function (e) {
      e.preventDefault();
      var files = e.dataTransfer.files;
      for (var i = 0; i < files.length && _state.pendingAttachments.length < MAX_ATTACHMENTS; i++) {
        uploadFile(files[i]);
      }
    });
  }

  // ── Paste image from clipboard ──
  function wirePasteImage() {
    var input = getInputEl();
    if (!input) return;
    input.addEventListener('paste', function (e) {
      var items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      var hasImage = false;
      for (var i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image/') === 0) {
          var file = items[i].getAsFile();
          if (file) { hasImage = true; uploadFile(file); }
        }
      }
      if (hasImage) e.preventDefault();
    });
  }

  // Link preview detection in input
  function detectInputLink(text) {
    var urlRegex = /https?:\/\/[^\s]+/g;
    var match = urlRegex.exec(text);
    if (match) {
      var url = match[0].replace(/[.,;:)!?]+$/, '');
      if (url !== _inputLpUrl) {
        _inputLpUrl = url;
        _inputLpDismissed = false;
        if (_inputLpDebounce) clearTimeout(_inputLpDebounce);
        _inputLpDebounce = setTimeout(function () {
          if (_linkPreviewCache[url]) {
            showInputLinkPreview(url, _linkPreviewCache[url]);
          } else {
            doAction('chat:fetchInputLinkPreview', { url: url });
          }
        }, 500);
      }
    } else {
      _inputLpUrl = null;
      hideInputLinkPreview();
    }
  }

  function showInputLinkPreview(url, data) {
    var bar = _els.lpBar;
    if (!bar) return;
    var domain = '';
    try { domain = new URL(url).hostname; } catch (e) { /* ignore */ }
    bar.innerHTML =
      '<i class="codicon codicon-link gs-sc-lp-icon"></i>' +
      '<div class="gs-sc-lp-content">' +
        '<div class="gs-sc-lp-domain">' + escapeHtml(domain) + '</div>' +
        (data.title ? '<div class="gs-sc-lp-title">' + escapeHtml(data.title) + '</div>' : '') +
      '</div>' +
      '<button class="gs-sc-lp-dismiss gs-btn-icon"><i class="codicon codicon-close"></i></button>';
    bar.style.display = 'flex';
    bar.querySelector('.gs-sc-lp-dismiss').addEventListener('click', function () {
      _inputLpDismissed = true;
      hideInputLinkPreview();
    });
  }

  function hideInputLinkPreview() {
    var bar = _els.lpBar;
    if (bar) { bar.style.display = 'none'; bar.innerHTML = ''; }
  }

  function appendLinkPreviewCard(msgEl, url, data) {
    if (!msgEl || !data) return;
    if (msgEl.querySelector('.gs-sc-lp-card')) return;
    var domain = '';
    try { domain = new URL(url).hostname; } catch (e) { /* ignore */ }
    var html = '<a class="gs-sc-lp-card" href="' + escapeHtml(url) + '" target="_blank">';
    if (data.image) html += '<img class="gs-sc-lp-card-img" src="' + escapeHtml(data.image) + '" alt="" onerror="this.style.display=\'none\'" />';
    html += '<div class="gs-sc-lp-card-body">';
    if (data.title) html += '<div class="gs-sc-lp-card-title">' + escapeHtml(data.title) + '</div>';
    if (data.description) html += '<div class="gs-sc-lp-card-desc">' + escapeHtml(data.description.slice(0, 120)) + '</div>';
    if (domain) html += '<div class="gs-sc-lp-card-domain"><i class="codicon codicon-link" style="font-size:10px"></i> ' + escapeHtml(domain) + '</div>';
    html += '</div></a>';
    var textEl = msgEl.querySelector('.gs-sc-text');
    if (textEl) textEl.insertAdjacentHTML('afterend', html);
  }

  // Image lightbox with prev/next navigation
  var _lbImages = [];
  var _lbIndex = 0;

  function wireImageLightbox() {
    var container = getMsgsEl();
    if (!container) return;
    container.addEventListener('click', function (e) {
      var img = e.target.closest('.gs-sc-attachment-img');
      if (!img || !img.dataset.url) return;
      // Don't open lightbox inside pinned view
      if (e.target.closest('.gs-sc-pin-view')) return;
      e.stopPropagation();
      // Collect all images in messages
      _lbImages = Array.from(container.querySelectorAll('.gs-sc-attachment-img[data-url]')).map(function (el) { return el.dataset.url; });
      _lbIndex = _lbImages.indexOf(img.dataset.url);
      if (_lbIndex === -1) _lbIndex = 0;
      showLightbox();
    });
  }

  function showLightbox() {
    var area = _els.messagesArea;
    if (!area || !_lbImages.length) return;
    var existing = area.querySelector('.gs-sc-lightbox');
    if (existing) existing.remove();

    var lb = document.createElement('div');
    lb.className = 'gs-sc-lightbox';
    lb.innerHTML =
      '<div class="gs-sc-lightbox-backdrop"></div>' +
      '<button class="gs-sc-lightbox-nav gs-sc-lightbox-prev">\u2039</button>' +
      '<img class="gs-sc-lightbox-img" />' +
      '<button class="gs-sc-lightbox-nav gs-sc-lightbox-next">\u203A</button>' +
      '<button class="gs-sc-lightbox-close gs-btn-icon"><span class="codicon codicon-close"></span></button>' +
      '<span class="gs-sc-lightbox-counter"></span>';
    area.appendChild(lb);

    var lbImg = lb.querySelector('.gs-sc-lightbox-img');
    var lbCounter = lb.querySelector('.gs-sc-lightbox-counter');
    var prevBtn = lb.querySelector('.gs-sc-lightbox-prev');
    var nextBtn = lb.querySelector('.gs-sc-lightbox-next');

    function updateLb(idx) {
      if (idx < 0 || idx >= _lbImages.length) return;
      _lbIndex = idx;
      lbImg.src = _lbImages[idx];
      lbCounter.textContent = (idx + 1) + ' / ' + _lbImages.length;
      prevBtn.style.display = idx > 0 ? 'flex' : 'none';
      nextBtn.style.display = idx < _lbImages.length - 1 ? 'flex' : 'none';
      lbCounter.style.display = _lbImages.length > 1 ? '' : 'none';
    }
    updateLb(_lbIndex);

    function closeLb() { lb.remove(); document.removeEventListener('keydown', lbKeyHandler); }
    lb.querySelector('.gs-sc-lightbox-backdrop').addEventListener('click', closeLb);
    lb.querySelector('.gs-sc-lightbox-close').addEventListener('click', closeLb);
    prevBtn.addEventListener('click', function () { updateLb(_lbIndex - 1); });
    nextBtn.addEventListener('click', function () { updateLb(_lbIndex + 1); });
    function lbKeyHandler(e) {
      if (e.key === 'Escape') closeLb();
      if (e.key === 'ArrowLeft') updateLb(_lbIndex - 1);
      if (e.key === 'ArrowRight') updateLb(_lbIndex + 1);
    }
    document.addEventListener('keydown', lbKeyHandler);
  }

  // ═══════════════════════════════════════════
  // MESSAGE ACTIONS (More menu)
  // ═══════════════════════════════════════════

  function openMoreMenu(msgId, isOwn, text, msgEl, btnRect) {
    var existing = getContainer() && getContainer().querySelector('.gs-sc-more-menu');
    if (existing) existing.remove();

    var isPinnedMsg = _state.pinnedMessages.some(function (p) { return String(p.id) === String(msgId); });
    var menu = document.createElement('div');
    menu.className = 'gs-sc-more-menu';

    var items = '<button class="gs-sc-more-item" data-action="forward"><i class="codicon codicon-export"></i> Forward</button>';
    items += '<button class="gs-sc-more-item" data-action="' + (isPinnedMsg ? 'unpin' : 'pin') + '"><i class="codicon codicon-pin"></i> ' + (isPinnedMsg ? 'Unpin' : 'Pin') + '</button>';
    if (isOwn) {
      var createdAt = msgEl && msgEl.dataset.createdAt ? new Date(msgEl.dataset.createdAt) : null;
      var canEdit = !createdAt || (Date.now() - createdAt.getTime() < 15 * 60 * 1000);
      if (canEdit) items += '<button class="gs-sc-more-item" data-action="edit"><i class="codicon codicon-edit"></i> Edit</button>';
      items += '<button class="gs-sc-more-item" data-action="unsend"><i class="codicon codicon-discard"></i> Unsend</button>';
    }
    items += '<button class="gs-sc-more-item" data-action="delete"><i class="codicon codicon-trash"></i> Delete</button>';

    menu.innerHTML = items;

    // Fixed position directly below the "..." button
    document.body.appendChild(menu);
    if (btnRect) {
      menu.style.position = 'fixed';
      menu.style.top = (btnRect.bottom + 2) + 'px';
      var left = btnRect.right - menu.offsetWidth;
      // Clamp to viewport
      var maxLeft = window.innerWidth - menu.offsetWidth - 4;
      if (left > maxLeft) left = maxLeft;
      if (left < 4) left = 4;
      menu.style.left = left + 'px';
    }

    menu.addEventListener('click', function (e) {
      var item = e.target.closest('.gs-sc-more-item');
      if (!item) return;
      var action = item.dataset.action;
      menu.remove();

      if (action === 'forward') openForwardModal(msgId, text);
      else if (action === 'pin') doAction('chat:pinMessage', { messageId: msgId });
      else if (action === 'unpin') doAction('chat:unpinMessage', { messageId: msgId });
      else if (action === 'edit') doEditInline(msgId, text, msgEl);
      else if (action === 'unsend') showConfirmModal('Remove this message for everyone?', 'Unsend', function () { doAction('chat:unsendMessage', { messageId: msgId }); });
      else if (action === 'delete') showConfirmModal('Delete this message for you?', 'Delete', function () { doAction('chat:deleteMessage', { messageId: msgId }); });
    });

    setTimeout(function () {
      document.addEventListener('click', function handler(e) {
        if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', handler); }
      });
    }, 0);
  }

  function doEditInline(msgId, currentText, msgEl) {
    var textEl = msgEl.querySelector('.gs-sc-text');
    if (!textEl) return;
    var originalHtml = textEl.innerHTML;

    var textarea = document.createElement('textarea');
    textarea.className = 'gs-sc-edit-textarea';
    textarea.value = currentText;
    var actions = document.createElement('div');
    actions.className = 'gs-sc-edit-actions';
    actions.innerHTML = '<button class="gs-btn gs-btn-primary gs-sc-edit-save">Save</button><button class="gs-btn gs-sc-edit-cancel">Cancel</button>';
    textEl.innerHTML = '';
    textEl.appendChild(textarea);
    textEl.appendChild(actions);
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);

    function save() {
      var newText = textarea.value.trim();
      if (newText && newText !== currentText) {
        doAction('chat:editMessage', { messageId: msgId, body: newText });
      }
      textEl.innerHTML = originalHtml;
    }
    function cancel() { textEl.innerHTML = originalHtml; }
    actions.querySelector('.gs-sc-edit-save').addEventListener('click', save);
    actions.querySelector('.gs-sc-edit-cancel').addEventListener('click', cancel);
    textarea.addEventListener('keydown', function (e) { if (e.key === 'Escape') cancel(); });
  }

  function showConfirmModal(message, confirmLabel, onConfirm) {
    var area = _els.messagesArea;
    if (!area) return;
    var existing = area.querySelector('.gs-sc-confirm-overlay');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.className = 'gs-sc-confirm-overlay';
    overlay.innerHTML =
      '<div class="gs-sc-confirm-modal">' +
        '<div class="gs-sc-confirm-body">' + escapeHtml(message) + '</div>' +
        '<div class="gs-sc-confirm-actions">' +
          '<button class="gs-btn gs-sc-confirm-cancel">Cancel</button>' +
          '<button class="gs-btn gs-btn-primary gs-sc-confirm-ok">' + escapeHtml(confirmLabel) + '</button>' +
        '</div>' +
      '</div>';
    area.appendChild(overlay);

    overlay.querySelector('.gs-sc-confirm-ok').addEventListener('click', function () { overlay.remove(); onConfirm(); });
    overlay.querySelector('.gs-sc-confirm-cancel').addEventListener('click', function () { overlay.remove(); });
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
  }

  // Forward modal
  function openForwardModal(msgId, text) {
    var area = _els.messagesArea;
    if (!area) return;
    var existing = area.querySelector('.gs-sc-forward-overlay');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.className = 'gs-sc-forward-overlay';
    overlay.dataset.msgId = msgId;
    overlay.dataset.msgText = text || '';
    var selectedIds = {};

    function renderFwdModal() {
      var convs = _conversations.filter(function (c) { return c.id !== _state.conversationId; });
      var listHtml = convs.length === 0
        ? '<div class="gs-sc-forward-empty">No conversations</div>'
        : convs.map(function (c) {
          var dmUser = c.other_user || {};
          var name = escapeHtml(c.group_name || dmUser.name || dmUser.login || c.name || 'Chat');
          var isSelected = !!selectedIds[c.id];
          return '<div class="gs-sc-forward-item' + (isSelected ? ' gs-sc-forward-selected' : '') + '" data-conv-id="' + escapeHtml(c.id) + '">' +
            '<span class="gs-sc-forward-name">' + name + '</span>' +
            (isSelected ? '<i class="codicon codicon-check"></i>' : '') +
          '</div>';
        }).join('');

      var selectedCount = Object.keys(selectedIds).length;
      overlay.innerHTML =
        '<div class="gs-sc-forward-modal">' +
          '<div class="gs-sc-forward-header">' +
            '<span>Forward to\u2026</span>' +
            '<button class="gs-sc-forward-close gs-btn-icon"><i class="codicon codicon-close"></i></button>' +
          '</div>' +
          '<div class="gs-sc-forward-list">' + listHtml + '</div>' +
          '<div class="gs-sc-forward-footer">' +
            '<button class="gs-btn gs-btn-primary gs-sc-forward-send"' + (selectedCount === 0 ? ' disabled' : '') + '>Forward' + (selectedCount > 0 ? ' (' + selectedCount + ')' : '') + '</button>' +
          '</div>' +
          '<div class="gs-sc-forward-error" style="display:none"></div>' +
        '</div>';

      overlay.querySelector('.gs-sc-forward-close').addEventListener('click', function () { overlay.remove(); });
      overlay.querySelectorAll('.gs-sc-forward-item').forEach(function (item) {
        item.addEventListener('click', function () {
          var id = item.dataset.convId;
          if (selectedIds[id]) delete selectedIds[id]; else selectedIds[id] = true;
          renderFwdModal();
        });
      });
      var sendBtn = overlay.querySelector('.gs-sc-forward-send');
      if (sendBtn && !sendBtn.disabled) {
        sendBtn.addEventListener('click', function () {
          sendBtn.innerHTML = '<i class="codicon codicon-loading codicon-modifier-spin"></i>';
          sendBtn.disabled = true;
          doAction('chat:forwardMessage', { messageId: msgId, text: text || '', targetConversationIds: Object.keys(selectedIds) });
        });
      }
    }

    area.appendChild(overlay);
    if (_conversations.length > 0) {
      renderFwdModal();
    } else {
      overlay.innerHTML = '<div class="gs-sc-forward-modal"><div style="padding:16px;text-align:center"><i class="codicon codicon-loading codicon-modifier-spin"></i></div></div>';
      doAction('chat:getConversations');
    }
  }

  // ═══════════════════════════════════════════
  // HEADER MENU (ellipsis)
  // ═══════════════════════════════════════════

  function toggleHeaderMenu() {
    var container = getContainer();
    if (!container) return;
    var existing = container.querySelector('.gs-sc-hmenu');
    if (existing) { existing.remove(); return; }

    var menu = document.createElement('div');
    menu.className = 'gs-sc-hmenu';

    var items = [];
    if (_state.isGroup) {
      items.push('<div class="gs-sc-hmenu-item" data-action="groupInfo"><i class="codicon codicon-organization"></i> Manage</div>');
    }
    items.push('<div class="gs-sc-hmenu-item" data-action="togglePin"><i class="codicon codicon-pinned' + (_state.isPinned ? '-dirty' : '') + '"></i> ' + (_state.isPinned ? 'Unpin conversation' : 'Pin conversation') + '</div>');
    if (!_state.isGroup) {
      items.push('<div class="gs-sc-hmenu-item" data-action="addPeople"><i class="codicon codicon-person-add"></i> Add people</div>');
    }
    items.push('<div class="gs-sc-hmenu-item" data-action="toggleMute"><i class="codicon ' + (_state.isMuted ? 'codicon-bell' : 'codicon-bell-slash') + '"></i> ' + (_state.isMuted ? 'Unmute' : 'Mute') + '</div>');

    menu.innerHTML = items.join('');
    var headerRight = _els.headerRight || container.querySelector('.gs-sc-header-right');
    if (headerRight) headerRight.appendChild(menu);

    menu.addEventListener('click', function (e) {
      var item = e.target.closest('.gs-sc-hmenu-item');
      if (!item) return;
      var action = item.dataset.action;
      if (action === 'groupInfo') doAction('chat:groupInfo');
      else if (action === 'togglePin') {
        doAction('chat:togglePin', { isPinned: _state.isPinned });
        _state.isPinned = !_state.isPinned;
      }
      else if (action === 'addPeople') doAction('chat:addPeople');
      else if (action === 'toggleMute') doAction('chat:toggleMute', { isMuted: _state.isMuted });
      menu.remove();
    });

    setTimeout(function () {
      document.addEventListener('click', function handler(e) {
        if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', handler); }
      });
    }, 0);
  }

  // ═══════════════════════════════════════════
  // @MENTION AUTOCOMPLETE
  // ═══════════════════════════════════════════

  var _mentionActive = false;
  var _mentionQuery = '';
  var _mentionStartPos = -1;
  var _mentionUsers = [];
  var _mentionSelIdx = 0;
  var _mentionDebounce = null;
  var _mentionDropdown = null;

  function wireMentionAutocomplete() {
    var input = getInputEl();
    if (!input) return;

    input.addEventListener('input', function () {
      if (_isComposing) return;
      var val = input.value;
      var cursorPos = input.selectionStart || 0;
      var textBefore = val.slice(0, cursorPos);
      var atIndex = textBefore.lastIndexOf('@');

      if (atIndex >= 0) {
        var charBefore = atIndex > 0 ? textBefore[atIndex - 1] : ' ';
        if (charBefore === ' ' || charBefore === '\n' || atIndex === 0) {
          var query = textBefore.slice(atIndex + 1);
          if (!query.includes(' ')) {
            _mentionActive = true;
            _mentionStartPos = atIndex;
            _mentionQuery = query;
            _mentionSelIdx = 0;

            clearTimeout(_mentionDebounce);
            var searchPool = _state.isGroup ? _state.groupMembers : [];
            var localMatches = searchPool.filter(function (f) {
              return f.login !== _state.currentUser && (
                f.login.toLowerCase().indexOf(query.toLowerCase()) !== -1 ||
                (f.name && f.name.toLowerCase().indexOf(query.toLowerCase()) !== -1)
              );
            }).map(function (f) {
              return { login: f.login, name: f.name, avatar_url: f.avatar_url, online: f.online };
            });

            if (localMatches.length > 0) {
              _mentionUsers = localMatches;
              _mentionSelIdx = 0;
              renderMentionDropdown();
            } else if (query.length >= 1) {
              _mentionDebounce = setTimeout(function () {
                doAction('chat:searchUsers', { query: query });
              }, 300);
            }
            return;
          }
        }
      }
      hideMentionDropdown();

      // Link preview detection
      detectInputLink(val);
    });

    input.addEventListener('keydown', function (e) {
      if (e.isComposing || _isComposing) return;
      if (!_mentionActive || !_mentionDropdown) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        _mentionSelIdx = Math.min(_mentionSelIdx + 1, _mentionUsers.length - 1);
        renderMentionDropdown();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        _mentionSelIdx = Math.max(_mentionSelIdx - 1, 0);
        renderMentionDropdown();
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        if (_mentionUsers.length > 0 && _mentionActive) {
          e.preventDefault();
          e.stopPropagation();
          insertMention(_mentionUsers[_mentionSelIdx]);
        }
      } else if (e.key === 'Escape') {
        hideMentionDropdown();
      }
    });
  }

  function renderMentionDropdown() {
    if (!_mentionDropdown) {
      _mentionDropdown = document.createElement('div');
      _mentionDropdown.className = 'gs-sc-mention-dropdown';
      var inputArea = _els.inputArea;
      if (inputArea) { inputArea.style.position = 'relative'; inputArea.appendChild(_mentionDropdown); }
    }
    _mentionDropdown.style.display = 'block';
    _mentionDropdown.innerHTML = _mentionUsers.map(function (u, i) {
      var avatar = u.avatar_url || ('https://github.com/' + encodeURIComponent(u.login) + '.png?size=32');
      return '<div class="gs-sc-mention-item' + (i === _mentionSelIdx ? ' gs-sc-mention-selected' : '') + '" data-index="' + i + '">' +
        '<img src="' + escapeHtml(avatar) + '" class="gs-sc-mention-avatar" alt="">' +
        '<div class="gs-sc-mention-info">' +
          '<span class="gs-sc-mention-name">' + escapeHtml(u.name || u.login) + '</span>' +
          '<span class="gs-sc-mention-login">@' + escapeHtml(u.login) + '</span>' +
        '</div>' +
      '</div>';
    }).join('');

    _mentionDropdown.querySelectorAll('.gs-sc-mention-item').forEach(function (el) {
      el.addEventListener('mousedown', function (e) {
        e.preventDefault();
        insertMention(_mentionUsers[parseInt(el.dataset.index, 10)]);
      });
    });
  }

  function insertMention(user) {
    if (!user) return;
    var input = getInputEl();
    if (!input) return;
    var val = input.value;
    var before = val.slice(0, _mentionStartPos);
    var after = val.slice(input.selectionStart || val.length);
    input.value = before + '@' + user.login + ' ' + after;
    var newPos = _mentionStartPos + user.login.length + 2;
    input.setSelectionRange(newPos, newPos);
    input.focus();
    hideMentionDropdown();
  }

  function hideMentionDropdown() {
    _mentionActive = false;
    _mentionUsers = [];
    if (_mentionDropdown) _mentionDropdown.style.display = 'none';
  }

  // ═══════════════════════════════════════════
  // GROUP INFO PANEL
  // ═══════════════════════════════════════════

  var _groupAvatarUrl = '';

  function showGroupInfoPanel() {
    var area = _els.messagesArea;
    if (!area) return;
    var existing = area.querySelector('.gs-sc-gi-panel');
    if (existing) existing.remove();

    var panel = document.createElement('div');
    panel.className = 'gs-sc-gi-panel';
    var isCreator = _state.createdBy === _state.currentUser;
    var members = _state.groupMembers || [];

    var membersHtml = members.map(function (m) {
      var avatar = m.avatar_url || ('https://github.com/' + encodeURIComponent(m.login) + '.png?size=48');
      var isMe = m.login === _state.currentUser;
      var isAdmin = m.login === _state.createdBy;
      var removable = isCreator && !isMe && !isAdmin;
      return '<div class="gs-sc-gi-member" data-login="' + escapeHtml(m.login) + '">' +
        '<img src="' + escapeHtml(avatar) + '" class="gs-sc-gi-avatar" alt="">' +
        '<div class="gs-sc-gi-member-info">' +
          '<span class="gs-sc-gi-member-name">' + escapeHtml(m.name || m.login) +
            (isMe ? ' <span class="gs-sc-gi-badge">You</span>' : '') +
            (isAdmin ? ' <span class="gs-sc-gi-badge gs-sc-gi-badge-admin">Admin</span>' : '') +
          '</span>' +
          '<span class="gs-sc-gi-member-login">@' + escapeHtml(m.login) + '</span>' +
        '</div>' +
        (removable ? '<button class="gs-sc-gi-remove" data-login="' + escapeHtml(m.login) + '">Remove</button>' : '') +
      '</div>';
    }).join('');

    var headerName = _els.headerName ? _els.headerName.textContent : 'Group';

    panel.innerHTML =
      '<div class="gs-sc-gi-header">' +
        '<span class="gs-sc-gi-title">Manage</span>' +
        '<button class="gs-sc-gi-close gs-btn-icon"><i class="codicon codicon-close"></i></button>' +
      '</div>' +
      '<div class="gs-sc-gi-body">' +
        '<div class="gs-sc-gi-name' + (isCreator ? ' gs-sc-gi-editable' : '') + '">' + escapeHtml(headerName) + '</div>' +
        '<div class="gs-sc-gi-count">' + members.length + ' members</div>' +
        '<div class="gs-sc-gi-divider"></div>' +
        '<div class="gs-sc-gi-section-header"><span>MEMBERS</span>' +
          '<button class="gs-sc-gi-add-btn">+ Add Member</button>' +
        '</div>' +
        '<div class="gs-sc-gi-search" style="display:none"><input class="gs-sc-gi-search-input" placeholder="Search users..."><div class="gs-sc-gi-search-results"></div></div>' +
        '<div class="gs-sc-gi-members">' + membersHtml + '</div>' +
      '</div>' +
      '<div class="gs-sc-gi-footer">' +
        (isCreator ? '<div id="gs-sc-gi-invite-area"><button class="gs-btn gs-sc-gi-invite-btn"><i class="codicon codicon-link"></i> Create Invite Link</button></div><div class="gs-sc-gi-divider"></div>' : '') +
        '<button class="gs-btn gs-btn-danger gs-sc-gi-leave"><i class="codicon codicon-reply"></i> Leave Group</button>' +
        (isCreator ? '<button class="gs-btn gs-btn-danger gs-sc-gi-delete"><i class="codicon codicon-trash"></i> Delete Group</button>' : '') +
      '</div>';

    area.appendChild(panel);

    // Close
    panel.querySelector('.gs-sc-gi-close').addEventListener('click', function () { panel.remove(); });

    // Edit name (creator only)
    if (isCreator) {
      var nameEl = panel.querySelector('.gs-sc-gi-name');
      nameEl.addEventListener('click', function () {
        var current = nameEl.textContent.trim();
        var inp = document.createElement('input');
        inp.type = 'text';
        inp.value = current;
        inp.className = 'gs-sc-gi-name-input';
        nameEl.innerHTML = '';
        nameEl.appendChild(inp);
        inp.focus();
        inp.select();
        function saveName() {
          var newName = inp.value.trim();
          if (newName && newName !== current) {
            doAction('chat:updateGroupName', { name: newName });
            nameEl.textContent = newName;
            if (_els.headerName) _els.headerName.textContent = newName;
          } else {
            nameEl.textContent = current;
          }
        }
        inp.addEventListener('blur', saveName);
        inp.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') { e.preventDefault(); saveName(); }
          if (e.key === 'Escape') nameEl.textContent = current;
        });
      });
    }

    // Add member
    var addBtn = panel.querySelector('.gs-sc-gi-add-btn');
    var searchDiv = panel.querySelector('.gs-sc-gi-search');
    var searchInput = panel.querySelector('.gs-sc-gi-search-input');
    var searchDebounce = null;
    addBtn.addEventListener('click', function () {
      searchDiv.style.display = searchDiv.style.display === 'none' ? 'block' : 'none';
      if (searchDiv.style.display === 'block') searchInput.focus();
    });
    searchInput.addEventListener('input', function () {
      clearTimeout(searchDebounce);
      var q = searchInput.value.trim();
      if (q.length >= 1) {
        searchDebounce = setTimeout(function () {
          doAction('chat:searchUsersForGroup', { query: q });
        }, 300);
      }
    });

    // Remove member
    panel.querySelectorAll('.gs-sc-gi-remove').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var login = btn.dataset.login;
        showConfirmModal('Remove @' + login + ' from group?', 'Remove', function () {
          doAction('chat:removeMember', { login: login });
          var memberEl = btn.closest('.gs-sc-gi-member');
          if (memberEl) memberEl.remove();
        });
      });
    });

    // Leave / Delete
    panel.querySelector('.gs-sc-gi-leave').addEventListener('click', function () {
      showConfirmModal('Leave this group?', 'Leave', function () { doAction('chat:leaveGroup'); });
    });
    var deleteBtn = panel.querySelector('.gs-sc-gi-delete');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', function () {
        showConfirmModal('Delete this group permanently?', 'Delete', function () { doAction('chat:deleteGroup'); });
      });
    }

    // Invite link (event delegation)
    panel.addEventListener('click', function (e) {
      var target = e.target;
      if (target.classList.contains('gs-sc-gi-invite-btn')) doAction('chat:createInviteLink');
      else if (target.classList.contains('gs-sc-gi-copy-invite')) {
        navigator.clipboard.writeText(target.dataset.url || '').then(function () { showToast('Copied', 1500); });
      }
      else if (target.classList.contains('gs-sc-gi-revoke-invite')) doAction('chat:revokeInviteLink');
    });
  }

  function renderGroupSearchResults(users) {
    var container = getContainer();
    if (!container) return;
    var resultsEl = container.querySelector('.gs-sc-gi-search-results');
    if (!resultsEl) return;

    var memberLogins = {};
    (_state.groupMembers || []).forEach(function (m) { memberLogins[m.login] = true; });
    var filtered = users.filter(function (u) { return !memberLogins[u.login]; });

    resultsEl.innerHTML = filtered.map(function (u) {
      var avatar = u.avatar_url || ('https://github.com/' + encodeURIComponent(u.login) + '.png?size=48');
      return '<div class="gs-sc-gi-search-item" data-login="' + escapeHtml(u.login) + '">' +
        '<img src="' + escapeHtml(avatar) + '" class="gs-sc-gi-avatar" alt="">' +
        '<span>' + escapeHtml(u.name || u.login) + '</span>' +
      '</div>';
    }).join('');

    resultsEl.querySelectorAll('.gs-sc-gi-search-item').forEach(function (el) {
      el.addEventListener('click', function () {
        doAction('chat:addMember', { login: el.dataset.login });
        el.remove();
      });
    });
  }

  // ═══════════════════════════════════════════
  // MESSAGE HANDLER (routes all chat:* messages)
  // ═══════════════════════════════════════════

  function handleMessage(data) {
    if (!data || !data.type) return;

    // Strip chat: prefix for routing
    var type = data.type;
    if (type.indexOf('chat:') === 0) {
      type = type.slice(5);
    }
    var payload = data.payload || {};

    switch (type) {
      case 'init': {
        _state.currentUser = payload.currentUser || '';
        _state.isGroup = payload.isGroup || false;
        _state.isGroupCreator = payload.isGroupCreator || false;
        _state.otherReadAt = payload.otherReadAt || null;
        _state.groupMembers = payload.groupMembers || [];
        _state.isMuted = payload.isMuted || false;
        _state.isPinned = payload.isPinned || false;
        _state.createdBy = payload.createdBy || '';
        _state.pinnedMessages = payload.pinnedMessages || [];
        _state.hasMoreOlder = !!payload.hasMore;
        _state.hasMoreAfter = false;
        _state.loadingOlder = false;
        _state.loadingNewer = false;
        _state.isViewingContext = false;
        _state.messages = payload.messages || [];
        _state.conversationId = payload.conversationId || _state.conversationId;

        _initialRender = true;
        renderHeaderFromInit(payload);
        renderMessages(payload.messages || [], payload.unreadCount || 0);
        renderPinnedBanner();

        // Restore draft
        if (payload.draft) {
          var dInput = getInputEl();
          if (dInput) { dInput.value = payload.draft; dInput.dispatchEvent(new Event('input')); }
        }
        break;
      }

      case 'newMessage': {
        if (_state.isViewingContext) break; // suppress when viewing old context
        appendMessage(payload);
        hideTyping();
        break;
      }

      case 'olderMessages': {
        var container = getMsgsEl();
        if (!container) break;

        // 1. Save scroll height BEFORE prepend
        var prevHeight = container.scrollHeight;

        // 2. Dedup + build HTML
        var olderMsgs = (data.messages || []).filter(function (m) {
          return !container.querySelector('[data-msg-id="' + escapeHtml(String(m.id)) + '"]');
        });
        var grouped = groupMessages(olderMsgs);
        var html = grouped.map(function (m) {
          return (m.showDateSeparator ? renderDateSeparator(m.created_at) : '') + renderMessage(m);
        }).join('');

        // 3. Prepend
        if (html) {
          container.insertAdjacentHTML('afterbegin', html);
        }

        // 4. Restore scroll position AFTER prepend
        container.scrollTop = container.scrollHeight - prevHeight;

        _state.hasMoreOlder = !!data.hasMore;
        if (olderMsgs.length === 0) _state.hasMoreOlder = false;

        // 5. Set loadingOlder = false after delay
        setTimeout(function () { _state.loadingOlder = false; }, 300);
        break;
      }

      case 'newerMessages': {
        var container = getMsgsEl();
        if (!container) break;

        var newMsgs = (data.messages || []).filter(function (m) {
          return !container.querySelector('[data-msg-id="' + escapeHtml(String(m.id)) + '"]');
        });
        var grouped = groupMessages(newMsgs);
        var html = grouped.map(function (m) {
          return renderMessage(m);
        }).join('');
        if (html) container.insertAdjacentHTML('beforeend', html);

        _state.hasMoreAfter = data.hasMoreAfter;
        if (!_state.hasMoreAfter) {
          _state.isViewingContext = false;
        }
        if (newMsgs.length === 0 && _state.hasMoreAfter) {
          _state.hasMoreAfter = false;
          _state.isViewingContext = false;
          doAction('chat:reloadConversation');
        }
        setTimeout(function () { _state.loadingNewer = false; }, 300);
        break;
      }

      case 'typing': {
        var user = payload.user || payload.login || '';
        if (user) showTyping(user);
        break;
      }

      case 'reactionUpdated': {
        var rp = payload || {};
        var msgEl = getMsgsEl() && getMsgsEl().querySelector('[data-msg-id="' + escapeHtml(String(rp.messageId)) + '"]');
        if (!msgEl) break;

        var rGroups = {};
        (rp.reactions || []).forEach(function (r) {
          var emoji = r.emoji;
          if (!rGroups[emoji]) rGroups[emoji] = [];
          var login = r.user_login || r.userLogin || '';
          if (login && rGroups[emoji].indexOf(login) === -1) rGroups[emoji].push(login);
        });

        var rHtml = Object.keys(rGroups).map(function (emoji) {
          var users = rGroups[emoji];
          var isMine = users.indexOf(_state.currentUser) >= 0;
          return '<span class="gs-sc-reaction' + (isMine ? ' gs-sc-reaction-mine' : '') + '" ' +
            'data-msg-id="' + escapeHtml(String(rp.messageId)) + '" ' +
            'data-emoji="' + escapeHtml(emoji) + '">' +
            '<span class="gs-sc-reaction-emoji">' + escapeHtml(emoji) + '</span>' +
            '<span class="gs-sc-reaction-count">' + users.length + '</span>' +
            '</span>';
        }).join('');

        var existingReactions = msgEl.querySelector('.gs-sc-reactions');
        if (rHtml) {
          if (existingReactions) existingReactions.innerHTML = rHtml;
          else msgEl.querySelector('.gs-sc-meta').insertAdjacentHTML('beforebegin', '<div class="gs-sc-reactions">' + rHtml + '</div>');
        } else if (existingReactions) {
          existingReactions.remove();
        }
        break;
      }

      case 'conversationRead': {
        var readAt = payload.readAt;
        if (!readAt) break;
        _state.otherReadAt = readAt;
        // Update all sent status icons to seen
        var container = getMsgsEl();
        if (!container) break;
        container.querySelectorAll('.gs-sc-msg-out .gs-sc-status-sent').forEach(function (el) {
          el.className = 'gs-sc-status gs-sc-status-seen';
          el.title = 'Seen';
          el.textContent = '\u2713\u2713';
        });
        break;
      }

      case 'messagePinned':
      case 'wsPinned': {
        var pin = data.message || payload;
        if (pin && !_state.pinnedMessages.some(function (p) { return String(p.id) === String(pin.id); })) {
          _state.pinnedMessages.unshift(pin);
        }
        renderPinnedBanner();
        break;
      }

      case 'messageUnpinned':
      case 'wsUnpinned': {
        var unpinId = data.messageId || payload.messageId;
        _state.pinnedMessages = _state.pinnedMessages.filter(function (p) {
          return String(p.id) !== String(unpinId);
        });
        renderPinnedBanner();
        break;
      }

      case 'messagesUnpinnedAll': {
        _state.pinnedMessages = [];
        renderPinnedBanner();
        closePinnedView();
        break;
      }

      case 'updatePinnedBanner': {
        var newPins = data.pinnedMessages || payload.pinnedMessages || [];
        _state.pinnedMessages = newPins;
        _pinIndex = Math.min(_pinIndex, Math.max(0, newPins.length - 1));
        renderPinnedBanner();
        if (newPins.length === 0) closePinnedView();
        break;
      }

      case 'messageEdited': {
        var editEl = getMsgsEl() && getMsgsEl().querySelector('[data-msg-id="' + escapeHtml(String(data.messageId)) + '"] .gs-sc-text');
        if (editEl) editEl.innerHTML = escapeHtml(data.body);
        var editMeta = getMsgsEl() && getMsgsEl().querySelector('[data-msg-id="' + escapeHtml(String(data.messageId)) + '"] .gs-sc-meta');
        if (editMeta && editMeta.textContent.indexOf('edited') === -1) {
          editMeta.insertAdjacentHTML('beforeend', ' (edited)');
        }
        break;
      }

      case 'messageDeleted': {
        var delEl = getMsgsEl() && getMsgsEl().querySelector('[data-msg-id="' + escapeHtml(String(data.messageId)) + '"]');
        if (delEl) {
          delEl.innerHTML = '<span class="gs-sc-placeholder-text">[This message was deleted]</span>';
          delEl.classList.add('gs-sc-msg-placeholder');
        }
        break;
      }

      case 'messageRemoved': {
        var remEl = getMsgsEl() && getMsgsEl().querySelector('[data-msg-id="' + escapeHtml(String(data.messageId)) + '"]');
        if (remEl) {
          var row = remEl.closest('.gs-sc-msg-row');
          if (row) row.remove();
          else remEl.remove();
        }
        break;
      }

      case 'messageFailed':
      case 'replyFailed': {
        var failEl = data.tempId
          ? getMsgsEl() && getMsgsEl().querySelector('[data-msg-id="' + escapeHtml(data.tempId) + '"]')
          : getMsgsEl() && getMsgsEl().querySelector('[data-temp="true"]');
        if (failEl) {
          var statusEl = failEl.querySelector('.gs-sc-status');
          if (statusEl) {
            statusEl.className = 'gs-sc-status gs-sc-status-failed';
            statusEl.title = 'Failed to send';
            statusEl.innerHTML = '<i class="codicon codicon-error"></i>';
          }
        }
        break;
      }

      case 'messageUnsent': {
        var unsEl = getMsgsEl() && getMsgsEl().querySelector('[data-msg-id="' + escapeHtml(String(data.messageId)) + '"]');
        if (unsEl) {
          unsEl.innerHTML = '<span class="gs-sc-placeholder-text">[This message was unsent]</span>';
          unsEl.classList.add('gs-sc-msg-placeholder');
        }
        break;
      }

      case 'uploadComplete': {
        var upId = data.id || (payload && payload.id);
        var upResult = data.attachment || data.result || payload;
        _state.pendingAttachments.forEach(function (a) {
          if (a.id === upId) { a.status = 'ready'; a.result = upResult; }
        });
        renderAttachPreviews();
        break;
      }

      case 'uploadFailed': {
        var failId = data.id || (payload && payload.id);
        var failEntry = null;
        _state.pendingAttachments.forEach(function (a) {
          if (a.id === failId) { a.status = 'failed'; failEntry = a; }
        });
        renderAttachPreviews();
        showToast('Upload failed', 3000);
        break;
      }

      case 'addPickedFile': {
        var pickedFile = data.file || data || payload;
        if (pickedFile) addPickedFile(pickedFile);
        break;
      }

      case 'insertText': {
        var inputEl = getInputEl();
        if (inputEl) {
          inputEl.value = (inputEl.value ? inputEl.value + '\n' : '') + (data.text || payload.text || '');
          inputEl.focus();
        }
        break;
      }

      case 'searchResults': {
        if (_searchState === 'idle') break;
        var sResults = (data.messages || payload.messages || []).filter(function (m) {
          if (m.type === 'system') return false;
          if (m.is_deleted || m.deleted) return false;
          if (!m.body && !m.content && !(m.attachments && m.attachments.length)) return false;
          return true;
        });
        var isPagination = _searchPendingCursor && _searchResults.length > 0;
        if (isPagination) {
          _searchResults = _searchResults.concat(sResults);
          _searchPendingCursor = null;
          _searchNextCursor = data.nextCursor || payload.nextCursor || null;
          _searchState = 'results';
        } else {
          _searchResults = sResults;
          _searchPendingCursor = null;
          _searchNextCursor = data.nextCursor || payload.nextCursor || null;
          _searchHighlight = _searchResults.length > 0 ? 0 : -1;
          _searchState = 'results';
        }
        renderSearchResults();
        updateSearchBarState();
        break;
      }

      case 'searchError': {
        if (_searchState === 'idle') break;
        _searchState = 'results';
        _searchResults = [];
        renderSearchResults();
        updateSearchBarState();
        break;
      }

      case 'linkPreviewResult': {
        var lpUrl = data.url || (payload && payload.url);
        var lpData = data.data || payload;
        if (lpUrl && lpData) _linkPreviewCache[lpUrl] = lpData;
        var lpMsgEl = getMsgsEl() && getMsgsEl().querySelector('[data-msg-id="' + escapeHtml(String(data.messageId || (payload && payload.messageId))) + '"]');
        if (lpMsgEl && lpData) appendLinkPreviewCard(lpMsgEl, lpUrl, lpData);
        break;
      }

      case 'inputLinkPreviewResult': {
        var ilpUrl = data.url || (payload && payload.url);
        var ilpData = data.data || payload;
        if (ilpUrl && ilpData) _linkPreviewCache[ilpUrl] = ilpData;
        if (ilpUrl === _inputLpUrl && !_inputLpDismissed) {
          if (ilpData) showInputLinkPreview(ilpUrl, ilpData);
          else hideInputLinkPreview();
        }
        break;
      }

      case 'forwardSuccess': {
        var fwdOverlay = getContainer() && getContainer().querySelector('.gs-sc-forward-overlay');
        if (fwdOverlay) fwdOverlay.remove();
        showToast('Forwarded', 2000);
        break;
      }

      case 'forwardError': {
        var fwdErr = getContainer() && getContainer().querySelector('.gs-sc-forward-error');
        if (fwdErr) {
          fwdErr.textContent = 'Failed to forward. Try again.';
          fwdErr.style.display = 'block';
        }
        var fwdRetry = getContainer() && getContainer().querySelector('.gs-sc-forward-send');
        if (fwdRetry) { fwdRetry.disabled = false; fwdRetry.textContent = 'Forward'; }
        break;
      }

      case 'conversationsLoaded': {
        _conversations = data.conversations || payload.conversations || [];
        var pendingFwd = getContainer() && getContainer().querySelector('.gs-sc-forward-overlay');
        if (pendingFwd && _conversations.length > 0) {
          var fwdMsgId = pendingFwd.dataset.msgId;
          var fwdText = pendingFwd.dataset.msgText || '';
          pendingFwd.remove();
          openForwardModal(fwdMsgId, fwdText);
        }
        break;
      }

      case 'mentionSuggestions': {
        var apiUsers = data.users || payload.users || [];
        var existingLogins = {};
        _mentionUsers.forEach(function (u) { existingLogins[u.login] = true; });
        var newMentionUsers = apiUsers.filter(function (u) { return !existingLogins[u.login]; })
          .map(function (u) { return { login: u.login, name: u.name, avatar_url: u.avatar_url, online: false }; });
        _mentionUsers = _mentionUsers.concat(newMentionUsers);
        _mentionSelIdx = 0;
        if (_mentionActive && _mentionUsers.length > 0) renderMentionDropdown();
        break;
      }

      case 'showGroupInfo':
      case 'members': {
        _state.groupMembers = data.members || payload.members || _state.groupMembers;
        showGroupInfoPanel();
        break;
      }

      case 'groupSearchResults': {
        renderGroupSearchResults(data.users || payload.users || []);
        break;
      }

      case 'groupAvatarUpdated': {
        var newAvUrl = data.avatarUrl || (payload && payload.avatarUrl);
        if (newAvUrl) _groupAvatarUrl = newAvUrl;
        break;
      }

      case 'inviteLinkResult': {
        var invP = data.payload || payload;
        var invArea = getContainer() && getContainer().querySelector('#gs-sc-gi-invite-area');
        if (invArea && invP && invP.code) {
          var invUrl = invP.url || 'https://gitstar.ai/join/' + invP.code;
          invArea.innerHTML =
            '<textarea class="gs-sc-gi-invite-input" readonly>' + escapeHtml(invUrl) + '</textarea>' +
            '<div class="gs-sc-gi-invite-actions">' +
              '<button class="gs-btn gs-btn-primary gs-sc-gi-copy-invite" data-url="' + escapeHtml(invUrl) + '">Copy</button>' +
              '<button class="gs-btn gs-btn-danger gs-sc-gi-revoke-invite">Revoke</button>' +
            '</div>';
        }
        break;
      }

      case 'inviteLinkRevoked': {
        var rvP = data.payload || payload;
        var rvUrl = rvP && (rvP.url || ('https://gitstar.ai/join/' + rvP.code));
        if (rvUrl) {
          var rvInput = getContainer() && getContainer().querySelector('.gs-sc-gi-invite-input');
          if (rvInput) rvInput.value = rvUrl;
          var rvCopy = getContainer() && getContainer().querySelector('.gs-sc-gi-copy-invite');
          if (rvCopy) rvCopy.dataset.url = rvUrl;
          showToast('Invite link revoked', 2000);
        }
        break;
      }

      case 'muteUpdated': {
        _state.isMuted = !!(data.isMuted != null ? data.isMuted : (payload && payload.isMuted));
        break;
      }

      case 'pinReverted': {
        _state.isPinned = !!(data.isPinned != null ? data.isPinned : (payload && payload.isPinned));
        break;
      }

      case 'setDraft': {
        var input = getInputEl();
        if (input && data.text) {
          input.value = data.text;
          input.focus();
          // Trigger resize
          input.dispatchEvent(new Event('input'));
        }
        break;
      }

      case 'showToast': {
        showToast(data.text || payload.text || '', data.duration || 3000);
        break;
      }

      case 'jumpToMessageResult': {
        var msgs = data.messages || [];
        var targetId = data.targetMessageId;
        var container = getMsgsEl();
        if (container && msgs.length) {
          container.innerHTML = '';
          _initialRender = true;
          renderMessages(msgs);
          _state.hasMoreOlder = !!(data.hasMoreBefore || data.hasMore);
        }
        requestAnimationFrame(function () {
          var ct = getMsgsEl();
          var target = ct && ct.querySelector('[data-msg-id="' + escapeHtml(String(targetId)) + '"]');
          flashMessage(target);
          setTimeout(function () {
            _state.hasMoreAfter = data.hasMoreAfter || false;
            _state.isViewingContext = true;
            showGoDown();
          }, 500);
        });
        break;
      }

      // BUG 9: Missing jumpToMessageFailed handler
      case 'jumpToMessageFailed': {
        showToast('Could not find message', 3000);
        break;
      }

      // BUG 10: Missing jumpToDateResult / jumpToDateFailed handlers
      case 'jumpToDateResult': {
        var dateMsgs = data.messages || [];
        var dateContainer = getMsgsEl();
        if (dateContainer && dateMsgs.length) {
          dateContainer.innerHTML = '';
          _initialRender = true;
          renderMessages(dateMsgs);
          _state.hasMoreOlder = !!(data.hasMoreBefore || data.hasMore);
        }
        requestAnimationFrame(function () {
          var dc = getMsgsEl();
          if (dc) { dc.scrollTop = 0; }
          setTimeout(function () {
            _state.hasMoreAfter = data.hasMoreAfter || false;
            _state.isViewingContext = true;
            showGoDown();
          }, 500);
        });
        break;
      }

      case 'jumpToDateFailed': {
        showToast('Could not jump to date', 3000);
        break;
      }

      case 'presence': {
        // Presence updates can be handled by updating header status dot
        break;
      }

      case 'navigate': {
        // Handled by explore.js — pushChatView
        break;
      }

      default:
        // Unknown message type — silently ignore
        break;
    }
  }

  // ═══════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════

  function updateBackBadge(totalUnread) {
    var container = getContainer();
    if (!container) return;
    var badge = container.querySelector('.gs-sc-back-badge');
    if (!badge) return;
    if (totalUnread > 0) {
      badge.textContent = totalUnread > 99 ? '99+' : String(totalUnread);
      badge.style.display = '';
    } else {
      badge.style.display = 'none';
    }
  }

  window.SidebarChat = {
    open: open,
    close: close,
    isOpen: isOpen,
    getConversationId: getConversationId,
    handleMessage: handleMessage,
    updateBackBadge: updateBackBadge,
    destroy: destroy,
  };
})();
