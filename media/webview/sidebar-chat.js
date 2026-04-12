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

    // Render immediate header from convData
    if (convData) {
      renderHeaderFromConvData(convData);
    }

    // Wire event handlers
    wireBackButton();
    wireInput();
    wireSendButton();
    wireMenuButton();
  }

  function close() {
    // Save draft
    var input = getInputEl();
    if (input && input.value.trim()) {
      doAction('chat:saveDraft', {
        conversationId: _state.conversationId,
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
        '</button>' +
        '<div class="gs-sc-header-info">' +
          '<span class="gs-sc-header-name"></span>' +
          '<span class="gs-sc-header-subtitle"></span>' +
        '</div>' +
        '<div class="gs-sc-header-right">' +
          '<button class="gs-sc-menu-btn gs-btn-icon" title="Menu">' +
            '<i class="codicon codicon-ellipsis"></i>' +
          '</button>' +
        '</div>' +
      '</div>' +
      '<div class="gs-sc-messages-area">' +
        '<div class="gs-sc-messages"></div>' +
      '</div>' +
      '<div class="gs-sc-reply-bar" style="display:none;"></div>' +
      '<div class="gs-sc-input-area">' +
        '<textarea class="gs-sc-input" placeholder="Message..." rows="1"></textarea>' +
        '<button class="gs-sc-send-btn gs-btn-icon" title="Send" style="display:none;">' +
          '<i class="codicon codicon-send"></i>' +
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

    if (conv.isGroup || conv.is_group) {
      name = escapeHtml(conv.name || conv.group_name || 'Group');
      var memberCount = (conv.participants && conv.participants.length) || 0;
      subtitle = memberCount + ' members';
    } else {
      var other = conv.participant || conv.other_user || {};
      name = escapeHtml(other.name || other.login || conv.name || '');
      subtitle = other.login ? '@' + escapeHtml(other.login) : '';
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

    if (isGroup) {
      _els.headerName.innerHTML = escapeHtml(participant.name || participant.login || 'Group');
      var count = (payload.participants && payload.participants.length) || 0;
      _els.headerSub.textContent = count + ' members';
    } else {
      _els.headerName.innerHTML = escapeHtml(participant.name || participant.login || '');
      _els.headerSub.textContent = participant.login ? '@' + escapeHtml(participant.login) : '';
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
      var newDay = !prev || toDateStr(msg.created_at) !== toDateStr(prev.created_at);
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
    return '<div class="gs-sc-date-sep"><span class="gs-sc-date-label">' +
      escapeHtml(formatDateSeparator(isoDate)) + '</span></div>';
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

    // Attachments — images
    var imageAttachments = (msg.attachments || []).filter(function (a) {
      return (a.mime_type && a.mime_type.startsWith('image/')) || a.type === 'gif' || a.type === 'image';
    });
    var fileAttachments = (msg.attachments || []).filter(function (a) {
      return !((a.mime_type && a.mime_type.startsWith('image/')) || a.type === 'gif' || a.type === 'image');
    });

    var attachHtml = '';
    if (imageAttachments.length > 0) {
      var count = Math.min(imageAttachments.length, 4);
      var gridCls = 'gs-sc-img-grid gs-sc-img-grid-' + count;
      var imgs = imageAttachments.slice(0, 4).map(function (a) {
        return '<div class="gs-sc-img-cell"><img src="' + escapeHtml(a.url) + '" alt="' +
          escapeHtml(a.filename || 'image') + '" /></div>';
      }).join('');
      attachHtml += '<div class="' + gridCls + '">' + imgs + '</div>';
    }
    attachHtml += fileAttachments.map(function (a) {
      return '<a href="' + escapeHtml(a.url) + '" class="gs-sc-file-link">' +
        '<i class="codicon codicon-file"></i> ' + escapeHtml(a.filename || 'attachment') + '</a>';
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

    // Meta (time + status)
    var metaHtml = showTimestamp
      ? '<div class="gs-sc-meta">' + time + (msg.edited_at ? ' (edited)' : '') + ' ' + statusHtml + '</div>'
      : '';

    // Assemble bubble content
    var innerHtml = senderHtml + forwardedHtml + replyHtml + attachHtml + textHtml +
      (reactionsHtml ? '<div class="gs-sc-reactions">' + reactionsHtml + '</div>' : '') +
      metaHtml;

    return '<div class="gs-sc-msg-row gs-sc-group-' + groupPos + '">' +
      '<div class="gs-sc-msg ' + cls + ' gs-sc-group-' + groupPos + '" ' +
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
    var lastMsgEl = container.querySelector('.gs-sc-msg:last-child');
    var showSep = false;
    if (lastMsgEl) {
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
      input.style.height = Math.min(input.scrollHeight, 100) + 'px';
      input.style.overflowY = input.scrollHeight > 100 ? 'auto' : 'hidden';

      // Show/hide send button
      var sendBtn = _els.sendBtn;
      if (sendBtn) {
        sendBtn.style.display = input.value.trim() ? '' : 'none';
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

      // Up arrow: edit last own message
      if (e.key === 'ArrowUp' && !input.value) {
        doAction('chat:editLastMessage');
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

  function sendMessage() {
    var input = getInputEl();
    if (!input) return;

    var content = input.value.trim();
    if (!content) return;

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
    var payload = { content: content, _tempId: tempId };
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
        doAction('chat:openMenu', { conversationId: _state.conversationId });
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
        break;
      }

      case 'messageUnpinned':
      case 'wsUnpinned': {
        var unpinId = data.messageId || payload.messageId;
        _state.pinnedMessages = _state.pinnedMessages.filter(function (p) {
          return String(p.id) !== String(unpinId);
        });
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
        // Pending attachments handled by Task 8
        break;
      }

      case 'uploadFailed': {
        showToast('Upload failed', 3000);
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
          _state.hasMoreOlder = !!data.hasMore;
        }
        requestAnimationFrame(function () {
          var ct = getMsgsEl();
          var target = ct && ct.querySelector('[data-msg-id="' + escapeHtml(String(targetId)) + '"]');
          if (target) {
            target.scrollIntoView({ behavior: 'smooth', block: 'center' });
            target.classList.add('gs-sc-flash');
            setTimeout(function () { target.classList.remove('gs-sc-flash'); }, 1500);
          }
          setTimeout(function () {
            _state.hasMoreAfter = data.hasMoreAfter || false;
            _state.isViewingContext = true;
            showGoDown();
          }, 500);
        });
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

  window.SidebarChat = {
    open: open,
    close: close,
    isOpen: isOpen,
    getConversationId: getConversationId,
    handleMessage: handleMessage,
    destroy: destroy,
  };
})();
