(function () {
  const vscode = acquireVsCodeApi();
  let currentUser = "";
  let typingTimeout = null;
  let friendsList = [];
  let isGroup = false;
  let isGroupCreator = false;
  let membersVisible = false;
  let otherReadAt = null;
  let otherLogin = "";
  let groupMembersList = []; // { login, name, avatar_url }
  let replyingTo = null; // { id, sender, text }
  let isMuted = false;
  let isPinned = false;
  let createdBy = "";
  let groupMembers = [];
  let groupAvatarUrl = "";
  let lastCompositionEnd = 0;
  var _newMsgCount = 0;
  var scrollBtnEl = null;
  var _tempIdCounter = 0;
  var pinnedMessages = []; // [{ id, senderName, text }]
  var currentPinIndex = 0;
  var _jumpTargetId = null;
  var _isViewingContext = false; // true when viewing old message context (after pin jump)
  var _currentEmojiPicker = null;
  var _emojiPickerMsgId = null;
  var _inputLpUrl = null;          // URL currently shown in input link preview bar
  var _inputLpDismissed = false;   // user dismissed this preview
  var _inputLpDebounce = null;     // debounce timer for URL detection
  var _suppressedTempIds = new Set(); // tempIds where link preview was dismissed
  var currentConversationId = '';
  var _conversations = [];
  var QUICK_EMOJIS = ['👍','❤️','😂','🔥'];
  var EMOJIS = [
    {e:'👍',n:'thumbs up',k:['like','good','yes','ok']},
    {e:'❤️',n:'red heart',k:['love','heart']},
    {e:'😂',n:'face with tears of joy',k:['laugh','lol','haha','funny']},
    {e:'🔥',n:'fire',k:['hot','lit','amazing']},
    {e:'😊',n:'smiling face',k:['smile','happy','pleased']},
    {e:'😍',n:'heart eyes',k:['love','adore']},
    {e:'🤔',n:'thinking face',k:['think','hmm','wonder']},
    {e:'😢',n:'crying face',k:['sad','cry','tears']},
    {e:'😮',n:'face with open mouth',k:['wow','surprised','omg']},
    {e:'🎉',n:'party popper',k:['celebrate','congrats','party']},
    {e:'💯',n:'hundred points',k:['perfect','100','score']},
    {e:'🚀',n:'rocket',k:['launch','fast','ship']},
    {e:'👀',n:'eyes',k:['look','see','watching']},
    {e:'🤣',n:'rolling on floor laughing',k:['laugh','lmao','rofl']},
    {e:'😭',n:'loudly crying',k:['cry','sob','sad']},
    {e:'🥺',n:'pleading face',k:['please','beg','puppy']},
    {e:'😤',n:'face with steam from nose',k:['angry','frustrated']},
    {e:'😎',n:'smiling face with sunglasses',k:['cool','awesome','chill']},
    {e:'🤯',n:'exploding head',k:['mindblown','wow','shocked']},
    {e:'😳',n:'flushed face',k:['embarrassed','shocked','blush']},
    {e:'🥳',n:'partying face',k:['celebrate','party','birthday']},
    {e:'😴',n:'sleeping face',k:['sleep','tired','zzz']},
    {e:'🤦',n:'face palm',k:['facepalm','ugh','sigh']},
    {e:'🤷',n:'shrug',k:['shrug','idk','whatever']},
    {e:'👏',n:'clapping hands',k:['clap','applause','bravo']},
    {e:'🙏',n:'folded hands',k:['pray','please','thank']},
    {e:'💪',n:'flexed biceps',k:['strong','muscle','power']},
    {e:'✨',n:'sparkles',k:['stars','magic','amazing']},
    {e:'💀',n:'skull',k:['dead','dying','skull']},
    {e:'😅',n:'grinning face with sweat',k:['nervous','relieved','phew']},
    {e:'🫡',n:'saluting face',k:['salute','respect']},
    {e:'🤌',n:'pinched fingers',k:['chef','kiss','perfect']},
    {e:'⚡',n:'high voltage',k:['lightning','fast','electric']},
    {e:'🎯',n:'bullseye',k:['target','goal','aim']},
    {e:'🏆',n:'trophy',k:['win','winner','champion']},
    {e:'💡',n:'light bulb',k:['idea','bright']},
    {e:'🔑',n:'key',k:['key','unlock','important']},
    {e:'💰',n:'money bag',k:['money','cash','rich']},
    {e:'🎁',n:'wrapped gift',k:['gift','present','surprise']},
    {e:'🍕',n:'pizza',k:['food','pizza']},
    {e:'🍺',n:'beer mug',k:['beer','drink','cheers']},
    {e:'☕',n:'hot beverage',k:['coffee','tea','drink']},
    {e:'🌙',n:'crescent moon',k:['moon','night','sleep']},
    {e:'⭐',n:'star',k:['star','favorite','good']},
    {e:'🌈',n:'rainbow',k:['rainbow','colorful','hope']},
    {e:'💣',n:'bomb',k:['bomb','explosion']},
    {e:'🎵',n:'musical note',k:['music','song','note']},
    {e:'🔔',n:'bell',k:['notification','bell','ring']},
    {e:'📌',n:'pushpin',k:['pin','mark','important']},
    {e:'✅',n:'check mark button',k:['done','check','complete']},
    {e:'❌',n:'cross mark',k:['no','wrong','cancel']},
    {e:'⚠️',n:'warning',k:['warning','caution','alert']},
    {e:'💬',n:'speech bubble',k:['chat','message','talk']},
    {e:'👋',n:'waving hand',k:['wave','hello','bye']},
    {e:'🤝',n:'handshake',k:['deal','agree','partner']},
    {e:'🫶',n:'heart hands',k:['love','care','support']},
    {e:'🤗',n:'hugging face',k:['hug','warm','friendly']},
    {e:'😌',n:'relieved face',k:['relieved','calm','peace']},
    {e:'🧐',n:'face with monocle',k:['curious','inspect','hmm']},
    {e:'🤓',n:'nerd face',k:['nerd','smart','geek']},
    {e:'👌',n:'ok hand',k:['ok','perfect','fine']},
    {e:'🤞',n:'crossed fingers',k:['luck','hope','wish']},
    {e:'👊',n:'oncoming fist',k:['punch','fist','bump']},
    {e:'🙌',n:'raising hands',k:['praise','celebrate','yeah']},
    {e:'🫂',n:'people hugging',k:['hug','comfort','support']},
    {e:'❤️\u200d🔥',n:'heart on fire',k:['love','passion']},
    {e:'💔',n:'broken heart',k:['heartbreak','sad','lost']},
    {e:'💙',n:'blue heart',k:['love','blue','calm']},
    {e:'💚',n:'green heart',k:['nature','health','love']},
    {e:'💜',n:'purple heart',k:['love','purple']},
    {e:'🖤',n:'black heart',k:['dark','love','aesthetic']},
    {e:'🤍',n:'white heart',k:['pure','love','clean']},
    {e:'🧡',n:'orange heart',k:['energy','warmth','love']},
    {e:'💛',n:'yellow heart',k:['happy','sunny','love']},
    {e:'🩷',n:'pink heart',k:['cute','love','pink']},
  ];

  function groupMessages(messages) {
    var toDateStr = function(d) { return new Date(d).toDateString(); };
    var getSender = function(m) { return m.sender_login || m.sender || ""; };
    return messages.map(function(msg, i) {
      var prev = messages[i - 1];
      var next = messages[i + 1];
      var newDay = !prev || toDateStr(msg.created_at) !== toDateStr(prev.created_at);
      var sameSender = prev && !newDay && getSender(prev) === getSender(msg)
        && (new Date(msg.created_at) - new Date(prev.created_at)) <= 120000;
      var nextBreaks = !next || toDateStr(next.created_at) !== toDateStr(msg.created_at)
        || getSender(next) !== getSender(msg)
        || (new Date(next.created_at) - new Date(msg.created_at)) > 120000;
      var isFirst = !sameSender;
      var isLast = nextBreaks || !next || getSender(next) !== getSender(msg);
      var groupPosition = 'single';
      if (!isFirst && !isLast) groupPosition = 'middle';
      else if (!isFirst) groupPosition = 'last';
      else if (!isLast) groupPosition = 'first';
      return Object.assign({}, msg, { showDateSeparator: newDay, groupPosition: groupPosition });
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
    return '<div class="date-separator"><span class="date-separator-label">' +
      escapeHtml(formatDateSeparator(isoDate)) + '</span></div>';
  }

  window.addEventListener("message", (event) => {
    const msg = event.data;
    switch (msg.type) {
      case "init":
        _isViewingContext = false;
        var initialUnreadCount = msg.payload.unreadCount || 0;
        currentUser = msg.payload.currentUser;
        friendsList = msg.payload.friends || [];
        isGroup = msg.payload.isGroup || false;
        isGroupCreator = msg.payload.isGroupCreator || false;
        otherReadAt = msg.payload.otherReadAt || null;
        otherLogin = msg.payload.participant?.login || "";
        groupMembersList = msg.payload.groupMembers || [];
        isMuted = msg.payload.isMuted || false;
        isPinned = msg.payload.isPinned || false;
        createdBy = msg.payload.createdBy || "";
        groupMembers = msg.payload.groupMembers || [];
        pinnedMessages = msg.payload.pinnedMessages || [];
        currentPinIndex = 0;
        currentConversationId = msg.payload.conversationId || '';
        groupAvatarUrl = msg.payload.participant?.avatar_url || "";
        renderHeader(msg.payload.participant, msg.payload.isGroup, msg.payload.participants);
        renderMessages(msg.payload.messages, initialUnreadCount);
        if (msg.payload.hasMore) { addLoadMoreButton(); }
        // Always scroll to bottom on conversation open (multiple passes for images/attachments)
        var scrollToBottom = function() {
          var c = document.getElementById('messages');
          if (c) { c.scrollTop = c.scrollHeight; }
        };
        scrollToBottom();
        setTimeout(scrollToBottom, 150);
        setTimeout(scrollToBottom, 500);
        renderPinnedBanner();
        break;
      case "newMessage": appendMessage(msg.payload); break;
      case "linkPreviewResult": {
        var lpUrl = msg.url;
        var lpData = msg.data;
        delete linkPreviewPending[lpUrl];
        if (lpData) { linkPreviewCache[lpUrl] = lpData; }
        var lpMsgEl = document.querySelector('[data-msg-id-block="' + escapeHtml(String(msg.messageId)) + '"]');
        if (lpMsgEl && lpData) { appendLinkPreviewCard(lpMsgEl, lpUrl, lpData); }
        drainLinkPreviewQueue();
        break;
      }
      case "inputLinkPreviewResult": {
        var ilpUrl = msg.url, ilpData = msg.data;
        if (ilpData) { linkPreviewCache[ilpUrl] = ilpData; }
        if (ilpUrl === _inputLpUrl && !_inputLpDismissed) {
          if (ilpData) { showInputLinkPreview(ilpUrl, ilpData); }
          else { hideInputLinkPreview(); }
        }
        break;
      }
      case "setDraft": {
        var draftInput = document.getElementById('messageInput');
        if (draftInput && msg.text) { draftInput.value = msg.text; draftInput.focus(); }
        break;
      }
      case "updatePinnedBanner":
        pinnedMessages = msg.pinnedMessages || [];
        currentPinIndex = Math.min(currentPinIndex, Math.max(0, pinnedMessages.length - 1));
        renderPinnedBanner();
        break;
      case "conversationsLoaded": {
        _conversations = msg.conversations || [];
        var fwdOverlayPending = document.getElementById('forward-modal-overlay');
        if (fwdOverlayPending && _conversations.length > 0) {
          // Forward modal was waiting for conversations — re-render it
          var fwdBody = fwdOverlayPending.querySelector('.forward-modal');
          if (fwdBody && fwdBody.innerHTML.indexOf('codicon-loading') !== -1) {
            // Still in loading state — trigger renderModal by invoking openForwardModal
            var fwdMsgId = fwdOverlayPending.dataset.msgId;
            var fwdText = fwdOverlayPending.dataset.msgText || '';
            fwdOverlayPending.remove();
            openForwardModal(fwdMsgId, fwdText);
          }
        }
        break;
      }
      case "jumpToMessageResult": {
        var jMessages = msg.messages || [];
        var jTargetId = _jumpTargetId || msg.targetMessageId;
        _jumpTargetId = null;
        // Don't set _isViewingContext yet — renderMessages() scrolls to bottom which triggers scroll listener
        var jContainer = document.getElementById('messages');
        if (jContainer && jMessages.length) {
          jContainer.innerHTML = '';
          renderMessages(jMessages);
          if (msg.hasMore) { addLoadMoreButton(); }
        }
        requestAnimationFrame(function() {
          setTimeout(function() {
            var target = document.querySelector('[data-msg-id-block="' + escapeHtml(String(jTargetId)) + '"]') ||
                         document.querySelector('[data-msg-id="' + escapeHtml(String(jTargetId)) + '"]');
            if (target) {
              target.scrollIntoView({ behavior: 'smooth', block: 'center' });
              setTimeout(function() { flashRow(target); }, 300);
            }
            renderPinnedBanner();
            // Now safe to set context flag — scroll has settled
            setTimeout(function() {
              _isViewingContext = true;
              var btn = getScrollBottomBtn();
              btn.style.display = 'flex';
            }, 500);
          }, 100);
        });
        break;
      }
      case "forwardSuccess": {
        var successOverlay = document.getElementById('forward-modal-overlay');
        if (successOverlay) { successOverlay.remove(); }
        break;
      }
      case "forwardError": {
        var fwdErrEl = document.querySelector('.forward-error');
        if (fwdErrEl) {
          fwdErrEl.textContent = 'Failed to forward. Try again.';
          fwdErrEl.style.display = 'block';
          var retryBtn = document.querySelector('.forward-send');
          if (retryBtn) { retryBtn.disabled = false; retryBtn.textContent = 'Forward'; }
        }
        break;
      }
      case "conversationRead": {
        var readAt = msg.payload.readAt;
        if (readAt) {
          otherReadAt = readAt;
          // Update all sent status icons
          document.querySelectorAll('.message.outgoing .msg-status.sent').forEach(function(el) {
            var msgBlock = el.closest('[data-msg-id-block]');
            // Find created_at from meta text (timestamp)
            if (msgBlock) {
              el.className = 'msg-status seen';
              el.title = 'Seen';
              el.textContent = '✓✓';
            }
          });
        }
        break;
      }
      case "typing": showTyping(msg.payload.user); break;
      case "presence": updatePresence(msg.payload.online); break;
      case "messageEdited": {
        const el = document.querySelector('[data-msg-id-block="' + msg.messageId + '"] .msg-text');
        if (el) { el.innerHTML = highlightMentions(escapeHtml(msg.body)); }
        const meta = document.querySelector('[data-msg-id-block="' + msg.messageId + '"] .meta');
        if (meta && !meta.textContent.includes('edited')) { meta.insertAdjacentHTML('beforeend', ' (edited)'); }
        break;
      }
      case "reactionUpdated": {
        var rp = msg.payload || {};
        var msgEl = document.querySelector('[data-msg-id-block="' + rp.messageId + '"]');
        if (msgEl) {
          // Rebuild reactions HTML
          var rGroups = {};
          (rp.reactions || []).forEach(function(r) {
            var emoji = r.emoji;
            if (!rGroups[emoji]) { rGroups[emoji] = []; }
            var login = r.user_login || r.userLogin || "";
            if (login && rGroups[emoji].indexOf(login) === -1) { rGroups[emoji].push(login); }
          });
          var rHtml = Object.keys(rGroups).map(function(emoji) {
            var users = rGroups[emoji];
            var isMine = users.indexOf(currentUser) >= 0;
            var avatars = users.slice(0, 3).map(function(login, i) {
              var url = "https://github.com/" + encodeURIComponent(login) + ".png?size=32";
              return '<img src="' + url + '" class="reaction-avatar" style="margin-left:' + (i > 0 ? '-6px' : '0') + ';z-index:' + (3 - i) + '" alt="@' + escapeHtml(login) + '" title="' + escapeHtml(login) + '">';
            }).join("");
            var extra = users.length > 3 ? '<span class="reaction-extra">+' + (users.length - 3) + '</span>' : '';
            return '<span class="reaction' + (isMine ? ' reaction-mine' : '') + '" data-msg-id="' + escapeHtml(String(rp.messageId)) + '" data-emoji="' + escapeHtml(emoji) + '">' +
              '<span class="reaction-emoji">' + escapeHtml(emoji) + '</span>' +
              '<span class="reaction-avatars">' + avatars + extra + '</span>' +
            '</span>';
          }).join("");
          var existingReactions = msgEl.querySelector('.reactions');
          if (rHtml) {
            if (existingReactions) { existingReactions.innerHTML = rHtml; }
            else { msgEl.querySelector('.meta').insertAdjacentHTML('beforebegin', '<div class="reactions">' + rHtml + '</div>'); }
          } else if (existingReactions) {
            existingReactions.remove();
          }
        }
        break;
      }
      case "messageRemoved": {
        const el = document.querySelector('[data-msg-id-block="' + msg.messageId + '"]');
        if (el) { el.remove(); }
        break;
      }
      case "messageDeleted": {
        var del = document.querySelector('[data-msg-id-block="' + msg.messageId + '"]');
        if (del) {
          del.innerHTML = '<span class="msg-placeholder msg-deleted">[This message was deleted]</span>';
          del.classList.add('msg-placeholder-bubble');
        }
        break;
      }
      case "messageFailed": {
        var failEl = msg.tempId
          ? document.querySelector('[data-msg-id-block="' + msg.tempId + '"]')
          : document.querySelector('[data-temp="true"]');
        if (failEl) {
          var statusEl = failEl.querySelector('.msg-status');
          if (statusEl) {
            statusEl.className = 'msg-status failed';
            statusEl.title = 'Failed to send';
            statusEl.innerHTML = '';
            var metaEl = failEl.querySelector('.meta');
            var retryBtn = document.createElement('span');
            retryBtn.className = 'retry-btn';
            retryBtn.textContent = 'Retry';
            if (metaEl) metaEl.appendChild(retryBtn);
            retryBtn.addEventListener('click', function() {
              retryBtn.remove();
              statusEl.className = 'msg-status sending';
              statusEl.title = 'Sending';
              statusEl.innerHTML = '<i class="codicon codicon-loading codicon-modifier-spin"></i>';
              vscode.postMessage({ type: 'send', payload: { content: msg.content, _tempId: msg.tempId } });
            });
          }
        }
        break;
      }
      case "replyFailed": {
        // Show failed state on temp message (same UX as messageFailed)
        var rfEl = msg.tempId
          ? document.querySelector('[data-msg-id-block="' + msg.tempId + '"]')
          : document.querySelector('[data-temp="true"]');
        if (rfEl) {
          var rfStatusEl = rfEl.querySelector('.msg-status');
          if (rfStatusEl) {
            rfStatusEl.className = 'msg-status failed';
            rfStatusEl.title = 'Failed to send';
            rfStatusEl.innerHTML = '';
            var rfMetaEl = rfEl.querySelector('.meta');
            var rfRetryBtn = document.createElement('span');
            rfRetryBtn.className = 'retry-btn';
            rfRetryBtn.textContent = 'Retry';
            if (rfMetaEl) rfMetaEl.appendChild(rfRetryBtn);
            rfRetryBtn.addEventListener('click', function() {
              rfRetryBtn.remove();
              rfStatusEl.className = 'msg-status sending';
              rfStatusEl.title = 'Sending';
              rfStatusEl.innerHTML = '<i class="codicon codicon-loading codicon-modifier-spin"></i>';
              vscode.postMessage({ type: 'reply', payload: { content: msg.content, replyToId: msg.replyToId, _tempId: msg.tempId } });
            });
          }
        }
        break;
      }
      case "messageUnsent": {
        var uns = document.querySelector('[data-msg-id-block="' + msg.messageId + '"]');
        if (uns) {
          uns.innerHTML = '<span class="msg-placeholder msg-unsent">[This message was unsent]</span>';
          uns.classList.add('msg-placeholder-bubble');
        }
        break;
      }
      case "olderMessages": {
        const btn = document.querySelector(".load-more-btn");
        if (btn) { btn.remove(); }
        const container = document.getElementById("messages");
        const scrollHeight = container.scrollHeight;
        const grouped = groupMessages(msg.messages || []);
        const html = grouped.map(function(m) {
          return (m.showDateSeparator ? renderDateSeparator(m.created_at) : '') + renderMessage(m);
        }).join("");
        if (html) { container.insertAdjacentHTML("afterbegin", html); }
        container.scrollTop = container.scrollHeight - scrollHeight;
        if (msg.hasMore) { addLoadMoreButton(); }
        bindSenderClicks(container);
        bindFloatingBarEvents(container);
        break;
      }
    }
  });

  function renderHeader(participant, isGroup, participants) {
    const header = document.getElementById("header");
    if (isGroup) {
      var memberCount = (participants && participants.length) || 0;
      var name = escapeHtml(participant.name || participant.login);
      var groupAvatarUrl = participant.avatar_url || '';
      var groupAvatarHtml = groupAvatarUrl
        ? '<img class="header-group-avatar" id="header-group-avatar" src="' + escapeHtml(groupAvatarUrl) + '" alt=""/>'
        : '<span class="header-group-avatar header-group-avatar-placeholder"><i class="codicon codicon-organization"></i></span>';
      header.innerHTML =
        '<div class="header-left">' +
          groupAvatarHtml +
          '<div class="header-info">' +
            '<span class="name">' + name + '</span>' +
            '<span class="header-subtitle header-member-count">' + memberCount + ' members</span>' +
          '</div>' +
        '</div>' +
        '<div class="header-right">' +
          '<button class="header-icon-btn" id="menuBtn" title="Settings"><span class="codicon codicon-settings-gear"></span></button>' +
        '</div>';
    } else {
      var dot = participant.online ? "online-dot" : "offline-dot";
      var login = escapeHtml(participant.login);
      var pname = escapeHtml(participant.name || participant.login);
      var dmAvatarHtml = participant.avatar_url
        ? '<img class="header-group-avatar" src="' + escapeHtml(participant.avatar_url) + '" alt=""/>'
        : '';
      header.innerHTML =
        '<div class="header-left">' +
          dmAvatarHtml +
          '<span class="' + dot + '"></span>' +
          '<div class="header-info">' +
            '<a class="name profile-link" href="#" data-login="' + login + '" title="View profile">' + pname + '</a>' +
            '<span class="header-subtitle status">@' + login + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="header-right">' +
          '<button class="header-icon-btn" id="menuBtn" title="Settings"><span class="codicon codicon-settings-gear"></span></button>' +
        '</div>';
    }
    var menuBtn = document.getElementById("menuBtn");
    if (menuBtn) {
      menuBtn.addEventListener("click", function(e) {
        e.stopPropagation();
        toggleHeaderMenu();
      });
    }
    header.querySelectorAll(".profile-link").forEach(function(link) {
      link.addEventListener("click", function(e) {
        e.preventDefault();
        vscode.postMessage({ type: "viewProfile", payload: { login: link.dataset.login } });
      });
    });
  }

  function addLoadMoreButton() {
    const existing = document.querySelector(".load-more-btn");
    if (existing) { existing.remove(); }
    const btn = document.createElement("button");
    btn.className = "load-more-btn";
    btn.textContent = "Load earlier messages";
    btn.onclick = () => {
      vscode.postMessage({ type: "loadMore" });
      btn.textContent = "Loading...";
      btn.disabled = true;
    };
    const container = document.getElementById("messages");
    if (container) { container.prepend(btn); }
  }

  function renderMessages(messages, unreadCount) {
    var seen = {};
    var unique = messages.filter(function(m) {
      if (!m.id || seen[m.id]) return false;
      seen[m.id] = true;
      return true;
    });
    var grouped = groupMessages(unique);
    var container = document.getElementById("messages");
    var dividerIndex = unreadCount > 0 ? grouped.length - unreadCount : -1;
    container.innerHTML = grouped.map(function(msg, i) {
      var dividerHtml = '';
      if (i === dividerIndex && dividerIndex > 0) {
        dividerHtml = '<div class="unread-divider" id="unread-divider"><span>New Messages</span></div>';
      }
      return dividerHtml + (msg.showDateSeparator ? renderDateSeparator(msg.created_at) : '') + renderMessage(msg);
    }).join("");
    if (scrollBtnEl) { scrollBtnEl = null; }
    _newMsgCount = 0;
    getScrollBottomBtn();
    container.scrollTop = container.scrollHeight;
    bindSenderClicks(container);
    bindFloatingBarEvents(container);
  }

  function getLastMsgEl(container) {
    var els = container.querySelectorAll('.message:not(.system-msg)');
    return els.length ? els[els.length - 1] : null;
  }

  function getPrevMsgEl(el) {
    var startEl = el.closest('.msg-row-wrapper') || el;
    var prev = startEl.previousElementSibling;
    while (prev) {
      if (prev.classList.contains('msg-row-wrapper')) {
        var inner = prev.querySelector('.message:not(.system-msg)');
        if (inner) return inner;
      } else if (prev.classList.contains('message') && !prev.classList.contains('system-msg')) {
        return prev;
      }
      prev = prev.previousElementSibling;
    }
    return null;
  }

  function computeIncomingGroupPos(prevEl, newMsg) {
    if (!prevEl) return 'single';
    var prevSender = prevEl.getAttribute('data-sender') || '';
    var prevCreatedAt = prevEl.getAttribute('data-created-at') || '';
    var newSender = newMsg.sender_login || newMsg.sender || '';
    if (!prevSender || !prevCreatedAt || prevSender !== newSender) return 'single';
    var diff = new Date(newMsg.created_at) - new Date(prevCreatedAt);
    if (diff > 120000 || diff < 0) return 'single';
    // Same group — upgrade prev's class and hide its timestamp
    if (prevEl.classList.contains('msg-group-single')) {
      prevEl.classList.replace('msg-group-single', 'msg-group-first');
      var pw = prevEl.closest('.msg-row-wrapper');
      if (pw) pw.classList.replace('msg-group-single', 'msg-group-first');
    } else if (prevEl.classList.contains('msg-group-last')) {
      prevEl.classList.replace('msg-group-last', 'msg-group-middle');
      var pw = prevEl.closest('.msg-row-wrapper');
      if (pw) pw.classList.replace('msg-group-last', 'msg-group-middle');
    }
    var meta = prevEl.querySelector('.meta');
    if (meta) meta.style.display = 'none';
    return 'last';
  }

  function appendMessage(message) {
    var container = document.getElementById("messages");
    var msgId = message.id || message.message_id;

    // Replace temp message sent by current user
    var tempEl = container.querySelector('[data-temp="true"][data-sender="' + escapeHtml(currentUser) + '"]');
    if (tempEl && msgId && (message.sender_login === currentUser || message.sender === currentUser)) {
      var tempElId = tempEl.getAttribute('data-msg-id-block');
      if (tempElId && _suppressedTempIds.has(tempElId)) {
        _suppressedTempIds.delete(tempElId);
        message = Object.assign({}, message, { suppress_link_preview: true });
      }
      var prevEl = getPrevMsgEl(tempEl);
      var groupPos = computeIncomingGroupPos(prevEl, message);
      (tempEl.closest('.msg-row-wrapper') || tempEl).outerHTML = renderMessage(Object.assign({}, message, { groupPosition: groupPos }));
      bindFloatingBarEvents(container);
      bindSenderClicks(container);
      hideTyping();
      return;
    }

    if (msgId && container.querySelector('[data-msg-id-block="' + msgId + '"]')) return;
    if (msgId && container.querySelector('[data-msg-id="' + msgId + '"]')) return;

    var distFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;

    var lastEl = getLastMsgEl(container);
    var showSep = lastEl
      ? new Date(lastEl.getAttribute('data-created-at') || 0).toDateString() !== new Date(message.created_at).toDateString()
      : false;
    var groupPos = showSep ? 'single' : computeIncomingGroupPos(lastEl, message);
    var html = (showSep ? renderDateSeparator(message.created_at) : '') +
      renderMessage(Object.assign({}, message, { groupPosition: groupPos }));
    container.insertAdjacentHTML("beforeend", html);

    hideTyping();
    bindSenderClicks(container);
    bindFloatingBarEvents(container);

    if (distFromBottom <= 100) {
      container.scrollTop = container.scrollHeight;
    } else {
      incrementScrollBadge();
    }
  }

  function getScrollBottomBtn() {
    if (!scrollBtnEl) {
      scrollBtnEl = document.createElement('button');
      scrollBtnEl.id = 'scroll-bottom-btn';
      scrollBtnEl.className = 'scroll-bottom-btn';
      scrollBtnEl.style.display = 'none';
      scrollBtnEl.innerHTML = '<span class="codicon codicon-chevron-down"></span>' +
        '<span class="scroll-badge" id="scroll-badge" style="display:none">0</span>';
      var container = document.getElementById('messages');
      if (container) container.appendChild(scrollBtnEl);

      scrollBtnEl.addEventListener('click', function() {
        if (_isViewingContext) {
          // Viewing old context (after pin jump) — reload latest messages
          _isViewingContext = false;
          vscode.postMessage({ type: 'reloadConversation' });
          return;
        }
        var c = document.getElementById('messages');
        c.scrollTo({ top: c.scrollHeight, behavior: 'smooth' });
        _newMsgCount = 0;
        updateScrollBadge();
      });
    }
    return scrollBtnEl;
  }

  function updateScrollBadge() {
    var btn = getScrollBottomBtn();
    var badge = btn.querySelector('.scroll-badge');
    if (!badge) return;
    if (_newMsgCount > 0) {
      badge.textContent = _newMsgCount;
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
      badge.textContent = '0';
    }
  }

  function incrementScrollBadge() {
    _newMsgCount++;
    var btn = getScrollBottomBtn();
    btn.style.display = 'flex';
    updateScrollBadge();
  }

  // Scroll listener: show/hide scroll-to-bottom button
  (function() {
    var container = document.getElementById('messages');
    if (!container) return;
    container.addEventListener('scroll', function() {
      var distFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
      var btn = getScrollBottomBtn();
      if (distFromBottom > 300) {
        btn.style.display = 'flex';
      } else if (distFromBottom <= 100) {
        if (_isViewingContext) {
          // Scrolled to bottom of old context — reload latest messages (Telegram behavior)
          _isViewingContext = false;
          vscode.postMessage({ type: 'reloadConversation' });
          return;
        }
        btn.style.display = 'none';
        _newMsgCount = 0;
        updateScrollBadge();
        var divider = document.getElementById('unread-divider');
        if (divider) { divider.remove(); }
      }
    }, { passive: true });
  })();

  function getPinnedBannerEl() {
    var el = document.getElementById('pinned-banner');
    if (!el) {
      el = document.createElement('div');
      el.id = 'pinned-banner';
      el.className = 'pinned-banner';
      el.style.display = 'none';
      var header = document.getElementById('header');
      if (header) { header.after(el); }
    }
    return el;
  }

  function flashRow(el) {
    var target = el.closest('.msg-row-wrapper') || el;
    var bubble = target.classList.contains('message') ? target : target.querySelector('.message');
    if (bubble) {
      var bg = window.getComputedStyle(bubble).backgroundColor;
      var m = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (m) {
        target.style.setProperty('--flash-bg', 'rgba(' + m[1] + ',' + m[2] + ',' + m[3] + ',0.20)');
      }
    }
    target.classList.remove('row-flash');
    void target.offsetWidth;
    target.classList.add('row-flash');
    setTimeout(function() { target.classList.remove('row-flash'); }, 1500);
  }

  function jumpToMessageById(messageId) {
    var el = document.querySelector('[data-msg-id-block="' + escapeHtml(messageId) + '"]') ||
             document.querySelector('[data-msg-id="' + escapeHtml(messageId) + '"]');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(function() { flashRow(el); }, 300);
      return;
    }
    // Not in DOM — fetch context via single API call (like Telegram)
    var banner = getPinnedBannerEl();
    var prevHtml = banner.innerHTML;
    banner.innerHTML = '<div class="pinned-content" style="padding:2px 0"><span style="opacity:0.6;font-size:var(--gs-font-xs)"><i class="codicon codicon-loading codicon-modifier-spin"></i> Loading…</span></div>';
    _jumpTargetId = messageId;
    vscode.postMessage({ type: 'jumpToMessage', payload: { messageId: messageId } });
    // Restore banner after 8s timeout if no response
    setTimeout(function() {
      if (_jumpTargetId === messageId) { _jumpTargetId = null; banner.innerHTML = prevHtml; renderPinnedBanner(); }
    }, 8000);
  }

  function renderPinnedBanner() {
    var banner = getPinnedBannerEl();
    if (!pinnedMessages.length) {
      banner.style.display = 'none';
      return;
    }
    var pin = pinnedMessages[currentPinIndex];
    var rawText = pin.text || pin.body || pin.content || '';
    var preview = rawText.length > 50 ? rawText.slice(0, 50) + '\u2026' : rawText;
    var counter = pinnedMessages.length > 1
      ? '<span class="pinned-counter">#' + (currentPinIndex + 1) + ' of ' + pinnedMessages.length + '</span>'
      : '';
    banner.innerHTML =
      '<div class="pinned-accent-bar"></div>' +
      '<div class="pinned-content">' +
        '<div class="pinned-label">Pinned message' + (counter ? ' ' + counter : '') + '</div>' +
        '<div class="pinned-preview">' + escapeHtml(preview) + '</div>' +
      '</div>' +
      '<button class="pinned-unpin-btn" data-pin-id="' + escapeHtml(String(pin.id)) + '" aria-label="Unpin">' +
        '<i class="codicon codicon-pin"></i>' +
      '</button>';
    banner.style.display = 'flex';

    banner.onclick = function(e) {
      if (e.target.closest('.pinned-unpin-btn')) return;
      var pinIdStr = escapeHtml(String(pin.id));
      var msgEl = document.querySelector('[data-msg-id-block="' + pinIdStr + '"]') ||
                  document.querySelector('[data-msg-id="' + pinIdStr + '"]');
      if (msgEl) {
        msgEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(function() { flashRow(msgEl); }, 300);
      } else {
        jumpToMessageById(String(pin.id));
      }
      if (pinnedMessages.length > 1) {
        currentPinIndex = (currentPinIndex + 1) % pinnedMessages.length;
        renderPinnedBanner();
      }
    };

    banner.querySelector('.pinned-unpin-btn').onclick = function(e) {
      e.stopPropagation();
      var pinId = e.currentTarget.dataset.pinId;
      vscode.postMessage({ type: 'unpinMessage', payload: { messageId: pinId } });
    };
  }

  function bindSenderClicks(container) {
    container.querySelectorAll(".msg-sender").forEach(function(el) {
      if (el.dataset.bound) return;
      el.dataset.bound = "1";
      el.addEventListener("click", function() {
        vscode.postMessage({ type: "viewProfile", payload: { login: el.dataset.login } });
      });
    });
  }

  var _hideTimers = {};

  function bindFloatingBarEvents(container) {
    (container || document).querySelectorAll('.message[data-msg-id]').forEach(function(msgEl) {
      if (msgEl.dataset.fbarBound) return;
      msgEl.dataset.fbarBound = '1';
      var wrapper = msgEl.closest('.msg-row-wrapper') || msgEl;
      var bar = wrapper.querySelector('.msg-floating-bar');
      if (!bar) return;

      function showBar() {
        clearTimeout(_hideTimers[msgEl.dataset.msgId]);
        bar.classList.add('fbar-visible');
      }
      function scheduleHide() {
        _hideTimers[msgEl.dataset.msgId] = setTimeout(function() {
          bar.classList.remove('fbar-visible');
        }, 150);
      }

      msgEl.addEventListener('mouseenter', showBar);
      msgEl.addEventListener('mouseleave', scheduleHide);
      bar.addEventListener('mouseenter', function() { clearTimeout(_hideTimers[msgEl.dataset.msgId]); });
      bar.addEventListener('mouseleave', scheduleHide);
    });
  }

  var _currentMoreDropdown = null;

  document.getElementById('messages').addEventListener('click', function(e) {
    var btn = e.target.closest('.fbar-btn');
    if (!btn) return;
    var msgEl = btn.closest('.message') || btn.closest('.msg-row-wrapper').querySelector('.message');
    if (!msgEl) return;
    var msgId = msgEl.dataset.msgId;
    var action = btn.dataset.action;
    var isOwn = msgEl.dataset.own === 'true';
    var textEl = msgEl.querySelector('.msg-text');
    var text = textEl ? textEl.textContent.trim() : '';

    if (action === 'react') {
      openEmojiPicker(btn, msgId);
    } else if (action === 'reply') {
      var senderVal = msgEl.dataset.sender || '';
      startReply(msgId, senderVal, text.slice(0, 100));
    } else if (action === 'copy') {
      doCopy(btn, text);
    } else if (action === 'more') {
      openMoreDropdown(btn, msgId, isOwn, text, msgEl);
    }
  });

  // Quote block click — jump to original
  document.getElementById('messages').addEventListener('click', function(e) {
    var quoteEl = e.target.closest('.quote-block');
    if (!quoteEl) return;
    var replyId = quoteEl.dataset.replyId;
    var origEl = replyId ? document.querySelector('[data-msg-id-block="' + replyId + '"]') : null;
    if (origEl) {
      origEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(function() { flashRow(origEl); }, 300);
    } else {
      vscode.postMessage({ type: 'showInfoMessage', text: 'Original message is no longer available.' });
    }
  });

  function doCopy(btn, text) {
    if (!text) return;
    navigator.clipboard.writeText(text).then(function() {
      var icon = btn.querySelector('i');
      if (icon) {
        icon.className = 'codicon codicon-check';
        setTimeout(function() { icon.className = 'codicon codicon-copy'; }, 1500);
      }
    });
  }

  function openEmojiPicker(anchorBtn, msgId) {
    if (_currentEmojiPicker) { _currentEmojiPicker.remove(); _currentEmojiPicker = null; }

    _emojiPickerMsgId = msgId;
    var picker = document.createElement('div');
    picker.className = 'emoji-picker';

    var quickHtml = QUICK_EMOJIS.map(function(e) {
      return '<button class="ep-quick" data-emoji="' + escapeHtml(e) + '" aria-label="' + escapeHtml(e) + '">' + e + '</button>';
    }).join('');

    var gridHtml = '<div class="ep-grid">' +
      EMOJIS.map(function(item) {
        return '<button class="ep-emoji" data-emoji="' + escapeHtml(item.e) + '" title="' + escapeHtml(item.n) + '" aria-label="' + escapeHtml(item.n) + '">' + item.e + '</button>';
      }).join('') +
    '</div>';

    picker.innerHTML =
      '<div class="ep-quick-row">' + quickHtml + '</div>' +
      '<div class="ep-search-row"><input class="gs-input ep-search" placeholder="Search emojis\u2026" /></div>' +
      gridHtml;

    document.body.appendChild(picker);
    _currentEmojiPicker = picker;

    // Position
    var barRect = anchorBtn.closest('.msg-floating-bar').getBoundingClientRect();
    var ph = picker.offsetHeight || 260;
    if (barRect.top < 260) {
      picker.style.top = (barRect.bottom + 4) + 'px';
    } else {
      picker.style.top = (barRect.top - ph - 4) + 'px';
    }
    var msgEl = anchorBtn.closest('.message');
    var isOut = msgEl && msgEl.classList.contains('outgoing');
    if (isOut) {
      picker.style.right = (window.innerWidth - barRect.right) + 'px';
      picker.style.left = 'auto';
    } else {
      picker.style.left = Math.min(barRect.left, window.innerWidth - 248 - 8) + 'px';
    }

    var searchInput = picker.querySelector('.ep-search');
    var grid = picker.querySelector('.ep-grid');
    searchInput.addEventListener('input', function() {
      var q = searchInput.value.toLowerCase();
      grid.querySelectorAll('.ep-emoji').forEach(function(btn) {
        var item = EMOJIS.find(function(i) { return i.e === btn.dataset.emoji; });
        if (!item) return;
        var matches = !q || item.n.includes(q) || item.k.some(function(k) { return k.includes(q); });
        btn.style.display = matches ? '' : 'none';
      });
    });

    function selectEmoji(emoji) {
      vscode.postMessage({ type: 'react', payload: { messageId: _emojiPickerMsgId, emoji: emoji } });
      addReactionToMessage(_emojiPickerMsgId, emoji);
      if (_currentEmojiPicker) { _currentEmojiPicker.remove(); _currentEmojiPicker = null; }
    }
    picker.querySelectorAll('.ep-quick').forEach(function(btn) {
      btn.addEventListener('click', function() { selectEmoji(btn.dataset.emoji); });
    });
    picker.querySelectorAll('.ep-emoji').forEach(function(btn) {
      btn.addEventListener('click', function() { selectEmoji(btn.dataset.emoji); });
    });

    setTimeout(function() {
      document.addEventListener('click', function closePicker(e) {
        if (_currentEmojiPicker && !_currentEmojiPicker.contains(e.target)) {
          _currentEmojiPicker.remove(); _currentEmojiPicker = null;
          document.removeEventListener('click', closePicker);
        }
      });
    }, 0);

    document.addEventListener('keydown', function escPicker(e) {
      if (e.key === 'Escape' && _currentEmojiPicker) {
        _currentEmojiPicker.remove(); _currentEmojiPicker = null;
        document.removeEventListener('keydown', escPicker);
      }
    });
  }

  function openMoreDropdown(btn, msgId, isOwn, text, msgEl) {
    if (_currentMoreDropdown) { _currentMoreDropdown.remove(); _currentMoreDropdown = null; }
    var menu = document.createElement('div');
    menu.className = 'more-dropdown';
    var msgType = msgEl ? msgEl.dataset.type : '';
    var isPinnedMsg = msgType !== 'system' && pinnedMessages.some(function(p) { return String(p.id) === String(msgId); });
    var items = '<button class="more-item" data-action="forward"><i class="codicon codicon-export"></i> Forward</button>';
    if (msgType !== 'system') {
      items += '<button class="more-item" data-action="' + (isPinnedMsg ? 'unpin' : 'pin') + '">' +
        '<i class="codicon codicon-pin"></i> ' + (isPinnedMsg ? 'Unpin message' : 'Pin message') + '</button>';
    }
    if (isOwn) {
      var createdAt = msgEl.dataset.createdAt ? new Date(msgEl.dataset.createdAt) : null;
      var canEdit = !createdAt || (Date.now() - createdAt.getTime() < 15 * 60 * 1000);
      if (canEdit) {
        items += '<button class="more-item" data-action="edit"><i class="codicon codicon-edit"></i> Edit</button>';
      }
      items += '<button class="more-item" data-action="unsend"><i class="codicon codicon-discard"></i> Unsend</button>';
      items += '<button class="more-item more-item-danger" data-action="delete"><i class="codicon codicon-trash"></i> Delete for me</button>';
    }
    menu.innerHTML = items;
    document.body.appendChild(menu);
    var rect = btn.getBoundingClientRect();
    menu.style.position = 'fixed';
    menu.style.top = (rect.bottom + 4) + 'px';
    menu.style.left = Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8) + 'px';
    _currentMoreDropdown = menu;

    menu.addEventListener('click', function(ev) {
      var item = ev.target.closest('.more-item');
      if (!item) return;
      var act = item.dataset.action;
      menu.remove(); _currentMoreDropdown = null;
      if (act === 'forward') { openForwardModal(msgId, text, msgEl ? msgEl.dataset.sender : ''); }
      else if (act === 'pin') { vscode.postMessage({ type: 'pinMessage', payload: { messageId: msgId } }); }
      else if (act === 'unpin') { vscode.postMessage({ type: 'unpinMessage', payload: { messageId: msgId } }); }
      else if (act === 'edit') { doEditMessage(msgId, text, msgEl); }
      else if (act === 'unsend') { doUnsend(msgId, msgEl); }
      else if (act === 'delete') { doDelete(msgId); }
    });

    setTimeout(function() {
      document.addEventListener('click', function closeDrop(ev) {
        if (!menu.contains(ev.target) && menu.parentNode) {
          menu.remove(); _currentMoreDropdown = null;
          document.removeEventListener('click', closeDrop);
        }
      });
    }, 0);
  }

  function openForwardModal(msgId, text, fromSender) {
    var existing = document.getElementById('forward-modal-overlay');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.id = 'forward-modal-overlay';
    overlay.className = 'forward-modal-overlay';
    overlay.dataset.msgId = msgId;
    overlay.dataset.msgText = text || '';

    var selectedIds = {};
    var conversationsToShow = _conversations.filter(function(c) { return c.id !== currentConversationId; });

    function renderModal() {
      var listHtml = conversationsToShow.length === 0
        ? '<div class="forward-empty">No conversations yet</div>'
        : conversationsToShow.map(function(c) {
            var dmUser = c.other_user || ((!c.group_name && !c.is_group && c.type !== 'group' && c.participants) ? c.participants.find(function(p) { return p.login !== currentUser; }) : null);
            var name = escapeHtml(c.group_name || (dmUser && (dmUser.name || dmUser.login)) || c.name || 'Chat');
            var avatar = escapeHtml(c.group_avatar_url || (dmUser && dmUser.avatar_url) || (dmUser && dmUser.login ? 'https://github.com/' + dmUser.login + '.png?size=48' : ''));
            var isGroup = c.is_group || c.type === 'group' || (c.participants && c.participants.length > 2);
            var avatarHtml = avatar
              ? '<img src="' + avatar + '" class="forward-conv-avatar" alt="">'
              : '<div class="forward-conv-avatar forward-conv-avatar-placeholder"><span class="codicon codicon-' + (isGroup ? 'organization' : 'person') + '"></span></div>';
            var isSelected = !!selectedIds[c.id];
            return '<div class="forward-conv-item' + (isSelected ? ' selected' : '') + '" data-conv-id="' + escapeHtml(c.id) + '">' +
              avatarHtml +
              '<span class="forward-conv-name">' + name + '</span>' +
              (isSelected ? '<i class="codicon codicon-check forward-check"></i>' : '') +
            '</div>';
          }).join('');

      var selectedCount = Object.keys(selectedIds).length;
      overlay.innerHTML =
        '<div class="forward-modal" role="dialog">' +
          '<div class="forward-header">' +
            '<span class="forward-title">Forward to\u2026</span>' +
            '<button class="forward-close" aria-label="Close"><i class="codicon codicon-close"></i></button>' +
          '</div>' +
          '<div class="forward-list">' + listHtml + '</div>' +
          '<div class="forward-footer">' +
            '<button class="gs-btn gs-btn-primary forward-send"' + (selectedCount === 0 ? ' disabled' : '') + '>' +
              'Forward' + (selectedCount > 0 ? ' (' + selectedCount + ')' : '') +
            '</button>' +
          '</div>' +
          '<div class="forward-error" style="display:none"></div>' +
        '</div>';

      overlay.querySelector('.forward-close').addEventListener('click', function() { overlay.remove(); });
      overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });

      overlay.querySelectorAll('.forward-conv-item').forEach(function(item) {
        item.addEventListener('click', function() {
          var id = item.dataset.convId;
          if (selectedIds[id]) { delete selectedIds[id]; } else { selectedIds[id] = true; }
          renderModal();
        });
      });

      var sendBtn = overlay.querySelector('.forward-send');
      if (sendBtn && !sendBtn.disabled) {
        sendBtn.addEventListener('click', function() {
          sendBtn.innerHTML = '<i class="codicon codicon-loading codicon-modifier-spin"></i> Forwarding\u2026';
          sendBtn.disabled = true;
          vscode.postMessage({ type: 'forwardMessage', payload: { messageId: msgId, text: text || '', fromSender: fromSender || '', targetConversationIds: Object.keys(selectedIds) } });
        });
      }
    }

    document.body.appendChild(overlay);

    if (_conversations.length > 0) {
      renderModal();
    } else {
      overlay.innerHTML = '<div class="forward-modal"><div style="padding:16px;text-align:center"><i class="codicon codicon-loading codicon-modifier-spin"></i></div></div>';
      vscode.postMessage({ type: 'getConversations' });
    }
  }

  function doEditMessage(msgId, currentText, msgEl) {
    var textEl = msgEl.querySelector('.msg-text');
    if (!textEl) return;
    var originalHtml = textEl.innerHTML;
    var textarea = document.createElement('textarea');
    textarea.className = 'edit-textarea';
    textarea.value = currentText;
    var actions = document.createElement('div');
    actions.className = 'edit-actions';
    actions.innerHTML = '<button class="gs-btn gs-btn-primary edit-save">Save</button><button class="gs-btn gs-btn-secondary edit-cancel">Cancel</button>';
    textEl.innerHTML = '';
    textEl.appendChild(textarea);
    textEl.appendChild(actions);
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    function save() {
      var newText = textarea.value.trim();
      if (newText && newText !== currentText) {
        vscode.postMessage({ type: 'editMessage', payload: { messageId: msgId, body: newText } });
      }
      textEl.innerHTML = originalHtml;
    }
    function cancel() { textEl.innerHTML = originalHtml; }
    actions.querySelector('.edit-save').addEventListener('click', save);
    actions.querySelector('.edit-cancel').addEventListener('click', cancel);
    textarea.addEventListener('keydown', function(e) { if (e.key === 'Escape') cancel(); });
  }

  function showConfirmModal(opts) {
    var existing = document.querySelector('.confirm-modal-overlay');
    if (existing) existing.remove();
    var overlay = document.createElement('div');
    overlay.className = 'confirm-modal-overlay';
    overlay.innerHTML =
      '<div class="confirm-modal" role="dialog" aria-modal="true">' +
        '<div class="confirm-modal-body">' + escapeHtml(opts.message) + '</div>' +
        '<div class="confirm-modal-actions">' +
          '<button class="gs-btn gs-btn-primary confirm-ok">' + escapeHtml(opts.confirmLabel || 'Confirm') + '</button>' +
          '<button class="gs-btn gs-btn-secondary confirm-cancel">Cancel</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.querySelector('.confirm-ok').addEventListener('click', function() { overlay.remove(); opts.onConfirm(); });
    overlay.querySelector('.confirm-cancel').addEventListener('click', function() { overlay.remove(); });
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
    document.addEventListener('keydown', function esc(e) {
      if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', esc); }
    }, { once: true });
  }

  function doUnsend(msgId, msgEl) {
    showConfirmModal({
      message: 'Remove this message for everyone?',
      confirmLabel: 'Unsend',
      onConfirm: function() {
        vscode.postMessage({ type: 'unsendMessage', payload: { messageId: msgId } });
      }
    });
  }

  function doDelete(msgId) {
    vscode.postMessage({ type: 'deleteMessage', payload: { messageId: msgId } });
  }

  function renderTempMessage(tempId, body, replyContext) {
    var time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    var statusHtml = '<span class="msg-status sending" title="Sending"><i class="codicon codicon-loading codicon-modifier-spin"></i></span>';
    var container = document.getElementById('messages');
    var lastEl = container ? getLastMsgEl(container) : null;
    var groupPos = lastEl ? computeIncomingGroupPos(lastEl, { sender_login: currentUser, sender: currentUser, created_at: new Date().toISOString() }) : 'single';
    var quoteHtml = '';
    if (replyContext && replyContext.id) {
      quoteHtml = '<div class="quote-block" data-reply-id="' + escapeHtml(String(replyContext.id)) + '" tabindex="0" role="button" aria-label="Jump to original message">' +
        '<span class="quote-sender">' + escapeHtml(replyContext.sender || '') + '</span>' +
        '<span class="quote-text">' + escapeHtml((replyContext.text || '').slice(0, 100)) + '</span>' +
      '</div>';
    }
    return '<div class="msg-row-wrapper msg-group-' + groupPos + '">' +
      '<div class="message outgoing msg-group-' + groupPos + '" data-msg-id-block="' + escapeHtml(tempId) + '" data-msg-id="' + escapeHtml(tempId) + '" data-sender="' + escapeHtml(currentUser) + '" data-own="true" data-temp="true">' +
        '<div class="msg-floating-bar fbar-outgoing" role="toolbar"></div>' +
        quoteHtml +
        '<div class="msg-text">' + highlightMentions(escapeHtml(body)) + '</div>' +
        '<div class="meta">' + time + ' ' + statusHtml + '</div>' +
      '</div>' +
    '</div>';
  }

  function renderMessage(msg) {
    var sender = msg.sender_login || msg.sender || "";
    var isMe = sender === currentUser;
    var cls = isMe ? "outgoing" : "incoming";
    var groupPos = msg.groupPosition || 'single';
    var showDetails = groupPos === 'single' || groupPos === 'first';
    var showTimestamp = groupPos === 'single' || groupPos === 'last';
    var time = showTimestamp ? new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
    var text = msg.body || msg.content || "";

    // System messages
    if (msg.type === "system") {
      return '<div class="message system-msg"><div class="system-text">' + escapeHtml(text) + '</div></div>';
    }

    // Sender name
    var senderHtml = (showDetails && !isMe && (isGroup || sender))
      ? '<div class="msg-sender" data-login="' + escapeHtml(sender) + '">@' + escapeHtml(sender) + '</div>'
      : "";

    // Reply/quote block
    var replyHtml = "";
    if (msg.reply_to_id && msg.reply) {
      var replyText = (msg.reply.body || msg.reply.content || "").slice(0, 100);
      var replySender = msg.reply.sender_login || msg.reply.sender || "";
      replyHtml = '<div class="quote-block" data-reply-id="' + escapeHtml(String(msg.reply_to_id)) + '" tabindex="0" role="button" aria-label="Jump to original message">' +
        '<span class="quote-sender">' + escapeHtml(replySender) + '</span>' +
        '<span class="quote-text">' + escapeHtml(replyText) + '</span>' +
      '</div>';
    }

    // Attachments
    var imageAttachments = (msg.attachments || []).filter(function(a) { return (a.mime_type && a.mime_type.startsWith("image/")) || a.type === "gif" || a.type === "image"; });
    var fileAttachments = (msg.attachments || []).filter(function(a) { return !((a.mime_type && a.mime_type.startsWith("image/")) || a.type === "gif" || a.type === "image"); });
    var attachments = "";
    if (imageAttachments.length > 0) {
      var count = imageAttachments.length;
      var gridClass = "img-grid img-grid-" + Math.min(count, 4);
      var imgs = imageAttachments.slice(0, 4).map(function(a) {
        return '<div class="img-grid-cell"><img src="' + escapeHtml(a.url) + '" alt="' + escapeHtml(a.filename || 'image') + '" class="chat-attachment-img" data-url="' + escapeHtml(a.url) + '" /></div>';
      }).join("");
      attachments += '<div class="' + gridClass + '">' + imgs + '</div>';
    }
    attachments += fileAttachments.map(function(a) {
      return '<a href="' + escapeHtml(a.url) + '" class="attachment-file">' + escapeHtml(a.filename || 'attachment') + '</a>';
    }).join("");

    // Reactions
    var reactionGroups = {};
    (msg.reactions || []).forEach(function(r) {
      var emoji = r.emoji;
      if (!reactionGroups[emoji]) reactionGroups[emoji] = [];
      var login = r.user_login || r.userLogin || "";
      if (login && reactionGroups[emoji].indexOf(login) === -1) reactionGroups[emoji].push(login);
    });
    var reactions = Object.keys(reactionGroups).map(function(emoji) {
      var users = reactionGroups[emoji];
      var isMine = users.indexOf(currentUser) >= 0;
      var avatars = users.slice(0, 3).map(function(login, i) {
        var url = "https://github.com/" + encodeURIComponent(login) + ".png?size=32";
        return '<img src="' + url + '" class="reaction-avatar" style="margin-left:' + (i > 0 ? '-6px' : '0') + ';z-index:' + (3 - i) + '" alt="@' + escapeHtml(login) + '" title="' + escapeHtml(login) + '">';
      }).join("");
      var extra = users.length > 3 ? '<span class="reaction-extra">+' + (users.length - 3) + '</span>' : '';
      return '<span class="reaction' + (isMine ? ' reaction-mine' : '') + '" data-msg-id="' + escapeHtml(String(msg.id)) + '" data-emoji="' + escapeHtml(emoji) + '">' +
        '<span class="reaction-emoji">' + escapeHtml(emoji) + '</span>' +
        '<span class="reaction-avatars">' + avatars + extra + '</span>' +
      '</span>';
    }).join("");

    // Forwarded label
    var forwardedHtml = "";
    var fwdMatch = text.match(/^\u21aa Forwarded(?:\s+from\s+(@\S+))?\n/);
    if (fwdMatch) {
      text = text.slice(fwdMatch[0].length);
      var fwdLogin = fwdMatch[1] ? fwdMatch[1].replace(/^@/, '') : '';
      var fwdFrom = fwdLogin
        ? ' from <span class="msg-sender msg-forwarded-sender" data-login="' + escapeHtml(fwdLogin) + '">@' + escapeHtml(fwdLogin) + '</span>'
        : '';
      forwardedHtml = '<div class="msg-forwarded"><i class="codicon codicon-export"></i> Forwarded' + fwdFrom + '</div>';
    }

    // Detect emoji-only messages (1-3 emojis, no text)
    var emojiOnlyRegex = /^(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F)(?:\s*(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F)){0,2}$/u;
    var isEmojiOnly = text && !attachments && emojiOnlyRegex.test(text.trim());
    var textHtml = text ? '<div class="msg-text' + (isEmojiOnly ? ' emoji-only' : '') + '">' + highlightMentions(escapeHtml(text)) + '</div>' : "";

    // Link preview
    var urlMatch = text.match(/https?:\/\/[^\s]+/);
    if (urlMatch && msg.id && !msg.suppress_link_preview) {
      setTimeout(function() { fetchLinkPreview(String(msg.id), urlMatch[0]); }, 100);
    }

    // Status icon
    var statusIcon = "";
    if (isMe && showTimestamp) {
      var isSeen = otherReadAt && msg.created_at && msg.created_at <= otherReadAt;
      statusIcon = isSeen
        ? '<span class="msg-status seen" title="Seen">✓✓</span>'
        : '<span class="msg-status sent" title="Sent">✓</span>';
    }

    // Floating bar
    var barBtns = '<button class="fbar-btn" data-action="react"><i class="codicon codicon-smiley"></i></button>' +
      '<button class="fbar-btn" data-action="reply"><i class="codicon codicon-reply"></i></button>' +
      '<button class="fbar-btn" data-action="copy"><i class="codicon codicon-copy"></i></button>' +
      '<button class="fbar-btn fbar-more-btn" data-action="more"><i class="codicon codicon-ellipsis"></i></button>';
    var barPos = isMe ? 'fbar-outgoing' : 'fbar-incoming';
    var floatingBar = '<div class="msg-floating-bar ' + barPos + '">' + barBtns + '</div>';

    // Avatar area for grouped incoming
    var avatarArea = '';
    if (!isMe) {
      if (showDetails) {
        avatarArea = '<img class="msg-group-avatar" src="https://github.com/' + encodeURIComponent(sender) + '.png?size=48" alt="@' + escapeHtml(sender) + '"/>';
      } else {
        avatarArea = '<span class="msg-group-avatar-spacer"></span>';
      }
    }

    var metaHtml = showTimestamp
      ? '<div class="meta">' + time + (msg.edited_at ? " (edited)" : "") + ' ' + statusIcon + '</div>'
      : '';

    var innerContent = senderHtml + forwardedHtml + replyHtml + attachments + textHtml +
      (reactions ? '<div class="reactions">' + reactions + '</div>' : '') +
      metaHtml;

    var bodyHtml = isMe
      ? innerContent
      : '<div class="msg-row">' + avatarArea + '<div class="msg-bubble-col">' + innerContent + '</div></div>';

    return '<div class="msg-row-wrapper msg-group-' + groupPos + '">' +
      floatingBar +
      '<div class="message ' + cls + ' msg-group-' + groupPos + '" ' +
      'data-msg-id-block="' + escapeHtml(String(msg.id)) + '" ' +
      'data-msg-id="' + escapeHtml(String(msg.id)) + '" ' +
      'data-sender="' + escapeHtml(sender) + '" ' +
      'data-own="' + (isMe ? 'true' : 'false') + '" ' +
      'data-type="' + escapeHtml(msg.type || 'message') + '" ' +
      'data-created-at="' + escapeHtml(msg.created_at || '') + '">' +
      bodyHtml +
      '</div>' +
    '</div>';
  }

  var typingUsersMap = {}; // { login: timeoutId }

  function updateHeaderTyping() {
    var users = Object.keys(typingUsersMap);
    var subtitle = document.querySelector(".header-subtitle");
    if (!subtitle) return;
    if (users.length === 0) {
      // Restore original subtitle
      subtitle.classList.remove("typing");
      subtitle.innerHTML = subtitle.dataset.original || subtitle.innerHTML;
      return;
    }
    // Save original subtitle text before overwriting
    if (!subtitle.dataset.original) {
      subtitle.dataset.original = subtitle.innerHTML;
    }
    // Build typing text
    var text;
    if (!isGroup) {
      text = "typing";
    } else if (users.length === 1) {
      text = escapeHtml(users[0]) + " typing";
    } else if (users.length === 2) {
      text = escapeHtml(users[0]) + " &amp; " + escapeHtml(users[1]) + " typing";
    } else {
      text = users.length + " people typing";
    }
    subtitle.classList.add("typing");
    subtitle.innerHTML = text +
      '<span class="typing-dots" aria-hidden="true" style="margin-left:3px">' +
        '<span class="typing-dot"></span>' +
        '<span class="typing-dot"></span>' +
        '<span class="typing-dot"></span>' +
      '</span>';
  }

  function showTyping(user) {
    if (typingUsersMap[user]) clearTimeout(typingUsersMap[user]);
    typingUsersMap[user] = setTimeout(function() {
      delete typingUsersMap[user];
      updateHeaderTyping();
    }, 5000);
    updateHeaderTyping();
  }
  function hideTyping() {
    typingUsersMap = {};
    var subtitle = document.querySelector(".header-subtitle");
    if (subtitle) delete subtitle.dataset.original;
    updateHeaderTyping();
  }
  function updatePresence(online) {
    const dots = document.querySelectorAll(".online-dot, .offline-dot");
    dots.forEach(d => d.className = online ? "online-dot" : "offline-dot");
  }

  const input = document.getElementById("messageInput");
  const sendBtn = document.getElementById("sendBtn");
  let lastTypingEmit = 0;

  // Auto-resize textarea (Telegram-style, max ~5 lines)
  function autoResizeInput() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 110) + 'px';
    input.style.overflowY = input.scrollHeight > 110 ? 'auto' : 'hidden';
  }
  input.addEventListener('input', autoResizeInput);

  // Input link preview — detect URL as user types/pastes (500ms debounce)
  input.addEventListener("input", function() {
    clearTimeout(_inputLpDebounce);
    var val = input.value;
    var match = val.match(/https?:\/\/[^\s]+/);
    var url = match ? match[0].replace(/[.,;:)!?]+$/, '') : null;
    if (!url) {
      _inputLpUrl = null;
      _inputLpDismissed = false;
      hideInputLinkPreview();
      return;
    }
    if (url === _inputLpUrl) return; // same URL, no change needed
    _inputLpUrl = url;
    _inputLpDismissed = false;
    // Check cache first
    if (linkPreviewCache[url]) {
      showInputLinkPreview(url, linkPreviewCache[url]);
      return;
    }
    // Show loading state then debounce-fetch
    showInputLinkPreviewLoading();
    _inputLpDebounce = setTimeout(function() {
      vscode.postMessage({ type: 'fetchInputLinkPreview', payload: { url: url } });
    }, 500);
  });

  // Draft save — debounce input and relay to sidebar panel
  var draftTimer = null;
  input.addEventListener('input', function() {
    clearTimeout(draftTimer);
    var text = this.value;
    draftTimer = setTimeout(function() {
      vscode.postMessage({ type: 'saveDraft', payload: { conversationId: currentConversationId, text: text } });
    }, 500);
  });

  function getInputLpBar() {
    var bar = document.getElementById('input-link-preview');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'input-link-preview';
      bar.className = 'input-link-preview';
      bar.style.display = 'none';
      bar.innerHTML =
        '<img class="ilp-thumb" style="display:none" alt="" />' +
        '<i class="codicon codicon-link ilp-icon"></i>' +
        '<div class="ilp-content">' +
          '<div class="ilp-domain"></div>' +
          '<div class="ilp-title"></div>' +
        '</div>' +
        '<button class="ilp-dismiss gs-btn-icon" aria-label="Dismiss preview"><i class="codicon codicon-close"></i></button>';
      bar.querySelector('.ilp-thumb').addEventListener('error', function() { this.style.display = 'none'; });
      bar.querySelector('.ilp-dismiss').addEventListener('click', function() {
        _inputLpDismissed = true;
        hideInputLinkPreview();
      });
      var chatInput = document.querySelector('.chat-input');
      if (chatInput) chatInput.before(bar);
    }
    return bar;
  }

  function showInputLinkPreview(url, data) {
    var bar = getInputLpBar();
    var domain = '';
    try { domain = new URL(url).hostname; } catch(e) {}
    bar.querySelector('.ilp-domain').textContent = domain;
    var titleEl = bar.querySelector('.ilp-title');
    if (data.title) { titleEl.textContent = data.title; titleEl.style.display = ''; }
    else { titleEl.textContent = ''; titleEl.style.display = 'none'; }
    var thumbEl = bar.querySelector('.ilp-thumb');
    var iconEl = bar.querySelector('.ilp-icon');
    if (data.image) {
      thumbEl.src = data.image;
      thumbEl.style.display = '';
      iconEl.style.display = 'none';
    } else {
      thumbEl.style.display = 'none';
      thumbEl.src = '';
      iconEl.style.display = '';
    }
    bar.style.display = 'flex';
  }

  function showInputLinkPreviewLoading() {
    var bar = getInputLpBar();
    bar.querySelector('.ilp-domain').textContent = 'Loading preview\u2026';
    var titleEl = bar.querySelector('.ilp-title');
    titleEl.textContent = '';
    titleEl.style.display = 'none';
    var thumbEl = bar.querySelector('.ilp-thumb');
    thumbEl.style.display = 'none';
    thumbEl.src = '';
    bar.querySelector('.ilp-icon').style.display = '';
    bar.style.display = 'flex';
  }

  function hideInputLinkPreview() {
    var bar = document.getElementById('input-link-preview');
    if (bar) bar.style.display = 'none';
  }

  input.addEventListener("keydown", (e) => {
    if (e.isComposing) return; // IME composition in progress (e.g. Vietnamese Telex)
    if (Date.now() - lastCompositionEnd < 50) return; // IME just confirmed, not a real send
    // Skip sending when mention dropdown is active — let the mention handler deal with Enter/Tab
    if (e.key === "Enter" && !e.shiftKey) {
      if (mentionActive && mentionDropdown.style.display !== "none") { return; }
      e.preventDefault(); sendMessage();
    }
    const now = Date.now();
    if (now - lastTypingEmit > 2000) { vscode.postMessage({ type: "typing" }); lastTypingEmit = now; }
  });
  sendBtn.addEventListener("click", sendMessage);

  // ========== Input Emoji Picker (Telegram-style) ==========
  var emojiBtn = document.getElementById('emojiBtn');
  var _inputEmojiPicker = null;

  if (emojiBtn) {
    emojiBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      if (_inputEmojiPicker) { _inputEmojiPicker.remove(); _inputEmojiPicker = null; emojiBtn.classList.remove('active'); return; }

      var picker = document.createElement('div');
      picker.className = 'input-emoji-picker';
      _inputEmojiPicker = picker;
      emojiBtn.classList.add('active');

      // Recently used (stored in memory)
      var recentKey = '__recentEmojis';
      var recent = [];
      try { recent = JSON.parse(localStorage.getItem(recentKey) || '[]'); } catch(ex) {}

      var recentHtml = recent.length > 0
        ? '<div class="iep-section"><div class="iep-section-title">RECENTLY USED</div><div class="iep-grid">' +
          recent.map(function(em) { return '<button class="iep-emoji" data-emoji="' + escapeHtml(em) + '">' + em + '</button>'; }).join('') +
          '</div></div>'
        : '';

      var gridHtml = '<div class="iep-section"><div class="iep-section-title">EMOJI & PEOPLE</div><div class="iep-grid">' +
        EMOJIS.map(function(item) {
          return '<button class="iep-emoji" data-emoji="' + escapeHtml(item.e) + '" title="' + escapeHtml(item.n) + '">' + item.e + '</button>';
        }).join('') +
        '</div></div>';

      picker.innerHTML =
        '<div class="iep-search-row"><input class="gs-input iep-search" placeholder="Search..." /></div>' +
        '<div class="iep-body">' + recentHtml + gridHtml + '</div>';

      // Insert inside .chat-input (position: absolute pops up above)
      var inputArea = document.querySelector('.chat-input');
      if (inputArea) { inputArea.appendChild(picker); }

      // Search
      var searchInput = picker.querySelector('.iep-search');
      searchInput.addEventListener('input', function() {
        var q = searchInput.value.toLowerCase();
        picker.querySelectorAll('.iep-emoji').forEach(function(btn) {
          var item = EMOJIS.find(function(i) { return i.e === btn.dataset.emoji; });
          if (!item) { btn.style.display = q ? 'none' : ''; return; }
          var matches = !q || item.n.includes(q) || item.k.some(function(k) { return k.includes(q); });
          btn.style.display = matches ? '' : 'none';
        });
        // Hide section titles when searching
        picker.querySelectorAll('.iep-section-title').forEach(function(t) {
          t.style.display = q ? 'none' : '';
        });
      });

      // Select emoji → insert into textarea
      picker.addEventListener('click', function(ev) {
        var btn = ev.target.closest('.iep-emoji');
        if (!btn) return;
        var emoji = btn.dataset.emoji;
        // Insert at cursor position
        var start = input.selectionStart || 0;
        var end = input.selectionEnd || 0;
        var before = input.value.substring(0, start);
        var after = input.value.substring(end);
        input.value = before + emoji + after;
        input.selectionStart = input.selectionEnd = start + emoji.length;
        input.focus();
        autoResizeInput();
        // Save to recent
        recent = recent.filter(function(e) { return e !== emoji; });
        recent.unshift(emoji);
        if (recent.length > 16) recent = recent.slice(0, 16);
        try { localStorage.setItem(recentKey, JSON.stringify(recent)); } catch(ex) {}
      });

      // Close on outside click
      setTimeout(function() {
        document.addEventListener('click', function closePicker(ev) {
          if (_inputEmojiPicker && !_inputEmojiPicker.contains(ev.target) && ev.target !== emojiBtn && !emojiBtn.contains(ev.target)) {
            _inputEmojiPicker.remove();
            _inputEmojiPicker = null;
            emojiBtn.classList.remove('active');
            document.removeEventListener('click', closePicker);
          }
        });
      }, 0);
    });
  }

  function sendMessage() {
    const content = input.value.trim();
    var uploading = pendingAttachments.filter(function(a) { return a.status === "uploading"; });
    if (uploading.length > 0) {
      vscode.postMessage({ type: "showWarning", payload: { message: "Please wait — " + uploading.length + " file(s) still uploading" } });
      return;
    }
    var readyAttachments = pendingAttachments.filter(function(a) { return a.status === "ready"; });
    if (!content && readyAttachments.length === 0) return;

    // Optimistic temp message (text only, not for attachment-only sends)
    var tempId = null;
    if (content && readyAttachments.length === 0) {
      tempId = 'temp-' + (++_tempIdCounter);
      var container = document.getElementById('messages');
      container.insertAdjacentHTML('beforeend', renderTempMessage(tempId, content, replyingTo));
      container.scrollTop = container.scrollHeight;
    }

    var suppressPreview = _inputLpDismissed;
    var payload = { content: content };
    if (tempId) { payload._tempId = tempId; }
    if (suppressPreview) {
      payload.suppressLinkPreview = true;
      if (tempId) { _suppressedTempIds.add(tempId); }
    }
    if (readyAttachments.length > 0) {
      payload.attachments = readyAttachments.map(function(a) {
        var mime = (a.result && a.result.mime_type) || (a.file && a.file.type) || "";
        var type = mime === "image/gif" ? "gif"
          : mime.startsWith("image/") ? "image"
          : mime.startsWith("video/") ? "video"
          : "file";
        return { type: type, ...a.result };
      });
    }
    if (replyingTo) {
      payload.replyToId = replyingTo.id;
      vscode.postMessage({ type: "reply", payload: payload });
      cancelReply();
    } else {
      vscode.postMessage({ type: "send", payload: payload });
    }
    input.value = "";
    input.style.height = 'auto';
    clearTimeout(draftTimer);
    vscode.postMessage({ type: 'saveDraft', payload: { conversationId: currentConversationId, text: '' } });
    _inputLpUrl = null;
    _inputLpDismissed = false;
    hideInputLinkPreview();
    clearAllAttachments();
  }

  // ========== Multi-Attachment System ==========
  var MAX_ATTACHMENTS = 4;
  var MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB per file
  var attachIdCounter = 0;
  var pendingAttachments = []; // [{ id, file, status: "uploading"|"ready"|"failed", result }]
  const attachPreview = document.getElementById("attachPreview");
  const attachBtn = document.getElementById("attachBtn");
  const attachMenu = document.getElementById("attachMenu");
  const attachWrapper = attachBtn && attachBtn.parentElement;

  // Attach menu — toggle on click, close on outside click
  if (attachBtn && attachMenu) {
    attachBtn.addEventListener("click", function(e) {
      e.stopPropagation();
      attachMenu.classList.toggle("visible");
      attachBtn.classList.toggle("active", attachMenu.classList.contains("visible"));
    });
    document.addEventListener("click", function(e) {
      if (!attachMenu.contains(e.target) && e.target !== attachBtn) {
        attachMenu.classList.remove("visible");
        attachBtn.classList.remove("active");
      }
    });

    attachMenu.querySelectorAll(".attach-menu-item").forEach(function(item) {
      item.addEventListener("click", function() {
        attachMenu.classList.remove("visible");
        attachBtn.classList.remove("active");
        var action = item.dataset.action;
        if (action === "photo") {
          vscode.postMessage({ type: "pickPhoto" });
        } else if (action === "document") {
          vscode.postMessage({ type: "pickDocument" });
        } else if (action === "code") {
          vscode.postMessage({ type: "insertCode" });
        }
      });
    });
  }

  // (Removed fallback click — attach menu handles all file picking)

  // Paste image from clipboard — support multiple images
  input.addEventListener("paste", function(e) {
    var items = (e.clipboardData || e.originalEvent.clipboardData).items;
    var hasImage = false;
    for (var i = 0; i < items.length; i++) {
      if (items[i].type.indexOf("image") !== -1) {
        var file = items[i].getAsFile();
        if (file) {
          hasImage = true;
          uploadFile(file);
        }
      }
    }
    if (hasImage) e.preventDefault();
  });

  // Drag and drop — support multiple files
  var chatInputEl = document.querySelector(".chat-input");
  ["dragenter", "dragover"].forEach(function(evt) {
    document.body.addEventListener(evt, function(e) {
      e.preventDefault();
      if (chatInputEl) chatInputEl.classList.add("drag-over");
    });
  });
  ["dragleave", "drop"].forEach(function(evt) {
    document.body.addEventListener(evt, function(e) {
      e.preventDefault();
      if (chatInputEl) chatInputEl.classList.remove("drag-over");
    });
  });
  document.body.addEventListener("drop", function(e) {
    e.preventDefault();
    var files = e.dataTransfer.files;
    for (var i = 0; i < files.length && pendingAttachments.length < MAX_ATTACHMENTS; i++) {
      uploadFile(files[i]);
    }
  });

  function uploadFile(file) {
    if (pendingAttachments.length >= MAX_ATTACHMENTS) {
      vscode.postMessage({ type: "showWarning", payload: { message: "Maximum " + MAX_ATTACHMENTS + " attachments allowed" } });
      return;
    }
    if (file.size > 0 && file.size > MAX_FILE_SIZE) {
      vscode.postMessage({ type: "showWarning", payload: { message: "File too large (max 10MB): " + (file.name || "file") } });
      return;
    }
    var id = ++attachIdCounter;
    var entry = { id: id, file: file, status: "uploading", result: null };
    pendingAttachments.push(entry);
    renderAttachPreviews();

    var reader = new FileReader();
    reader.onload = function() {
      var base64 = reader.result.split(",")[1];
      vscode.postMessage({
        type: "upload",
        payload: {
          id: id,
          data: base64,
          filename: file.name || "pasted-image.png",
          mimeType: file.type || "application/octet-stream",
        }
      });
    };
    reader.readAsDataURL(file);
  }

  function renderAttachPreviews() {
    // Remove old modal if exists
    var oldModal = document.getElementById('attach-modal-overlay');
    if (oldModal && pendingAttachments.length === 0) { oldModal.remove(); }
    // Hide old inline preview
    if (attachPreview) { attachPreview.style.display = "none"; attachPreview.innerHTML = ""; }

    if (pendingAttachments.length === 0) return;

    function getThumbSrc(a) {
      if (a._dataUri) return a._dataUri;
      if (a._blobUrl) return a._blobUrl;
      if (a.file instanceof Blob) { a._blobUrl = URL.createObjectURL(a.file); return a._blobUrl; }
      return '';
    }

    function buildPreviewHtml() {
      var images = pendingAttachments.filter(function(a) { return a.file.type && a.file.type.startsWith("image/"); });
      var files = pendingAttachments.filter(function(a) { return !a.file.type || !a.file.type.startsWith("image/"); });
      var html = '';

      if (images.length === 1) {
        var src = getThumbSrc(images[0]);
        html += '<img src="' + src + '" class="attach-modal-image" />';
      } else if (images.length > 1) {
        // Grid: first image large, rest small below
        var firstSrc = getThumbSrc(images[0]);
        html += '<div class="attach-modal-grid">';
        html += '<img src="' + firstSrc + '" class="attach-modal-grid-main" />';
        if (images.length > 1) {
          html += '<div class="attach-modal-grid-row">';
          for (var i = 1; i < images.length; i++) {
            var s = getThumbSrc(images[i]);
            html += '<img src="' + s + '" class="attach-modal-grid-thumb" />';
          }
          html += '</div>';
        }
        html += '</div>';
      }

      for (var f = 0; f < files.length; f++) {
        html += '<div class="attach-modal-file"><i class="codicon codicon-file" style="font-size:32px;opacity:0.5"></i><span class="attach-modal-filename">' + escapeHtml(files[f].file.name || 'file') + '</span></div>';
      }
      return html;
    }

    // Check if modal already exists — update preview + status
    if (oldModal) {
      var previewArea = oldModal.querySelector('.attach-modal-preview');
      if (previewArea) { previewArea.innerHTML = buildPreviewHtml(); }
      var titleEl = oldModal.querySelector('.attach-modal-title');
      var hasImages = pendingAttachments.some(function(a) { return a.file.type && a.file.type.startsWith("image/"); });
      if (titleEl) { titleEl.textContent = pendingAttachments.length + (hasImages ? ' Media' : ' File'); }
      var statusEl = oldModal.querySelector('.attach-modal-status');
      var sendBtn = oldModal.querySelector('.attach-modal-send');
      var allReady = pendingAttachments.every(function(a) { return a.status === "ready"; });
      var anyFailed = pendingAttachments.some(function(a) { return a.status === "failed"; });
      if (statusEl) {
        statusEl.textContent = anyFailed ? 'Upload failed' : allReady ? '' : 'Uploading...';
        statusEl.className = 'attach-modal-status' + (anyFailed ? ' attach-failed' : '');
      }
      if (sendBtn) { sendBtn.disabled = !allReady; }
      return;
    }

    // Create Telegram-style modal
    var hasImages = pendingAttachments.some(function(a) { return a.file.type && a.file.type.startsWith("image/"); });
    var overlay = document.createElement('div');
    overlay.id = 'attach-modal-overlay';
    overlay.className = 'attach-modal-overlay';

    var count = pendingAttachments.length;
    overlay.innerHTML =
      '<div class="attach-modal">' +
        '<div class="attach-modal-header">' +
          '<button class="attach-modal-close gs-btn-icon"><i class="codicon codicon-close"></i></button>' +
          '<span class="attach-modal-title">' + count + (hasImages ? ' Media' : ' File') + '</span>' +
          '<span class="attach-modal-status">Uploading...</span>' +
        '</div>' +
        '<div class="attach-modal-preview">' + buildPreviewHtml() + '</div>' +
        '<div class="attach-modal-footer">' +
          '<input type="text" class="attach-modal-caption" placeholder="Add a caption..." />' +
          '<button class="attach-modal-send gs-btn gs-btn-primary" disabled><i class="codicon codicon-send"></i></button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);

    // Close
    overlay.querySelector('.attach-modal-close').addEventListener('click', function() {
      clearAllAttachments();
      overlay.remove();
    });
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) { clearAllAttachments(); overlay.remove(); }
    });

    // Send
    var modalSendBtn = overlay.querySelector('.attach-modal-send');
    var captionInput = overlay.querySelector('.attach-modal-caption');
    captionInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey && !modalSendBtn.disabled) {
        e.preventDefault();
        modalSendBtn.click();
      }
    });
    modalSendBtn.addEventListener('click', function() {
      var caption = captionInput.value.trim();
      input.value = caption;
      overlay.remove();
      sendMessage();
    });

    // Check if already ready
    var allReady = pendingAttachments.every(function(a) { return a.status === "ready"; });
    if (allReady) {
      modalSendBtn.disabled = false;
      overlay.querySelector('.attach-modal-status').textContent = '';
      captionInput.focus();
    }
  }

  function removeAttachment(id) {
    var idx = pendingAttachments.findIndex(function(a) { return a.id === id; });
    if (idx !== -1) {
      var removed = pendingAttachments.splice(idx, 1)[0];
      if (removed._blobUrl) URL.revokeObjectURL(removed._blobUrl);
    }
    renderAttachPreviews();
  }

  function clearAllAttachments() {
    pendingAttachments.forEach(function(a) {
      if (a._blobUrl) URL.revokeObjectURL(a._blobUrl);
    });
    pendingAttachments = [];
    renderAttachPreviews();
  }

  // Handle upload results from extension
  window.addEventListener("message", function(event) {
    if (event.data.type === "uploadComplete") {
      var id = event.data.id;
      var entry = pendingAttachments.find(function(a) { return a.id === id; });
      if (entry) {
        entry.status = "ready";
        entry.result = event.data.attachment;
      }
      renderAttachPreviews();
    } else if (event.data.type === "addPickedFile") {
      // Extension picked a file via dialog — create a preview entry with optional dataUri
      var d = event.data;
      if (pendingAttachments.length < MAX_ATTACHMENTS) {
        var fakeFile = { name: d.filename, type: d.mimeType };
        pendingAttachments.push({ id: d.id, file: fakeFile, status: "uploading", result: null, _dataUri: d.dataUri || null });
        renderAttachPreviews();
      }
    } else if (event.data.type === "uploadFailed") {
      var failId = event.data.id;
      var failEntry = pendingAttachments.find(function(a) { return a.id === failId; });
      if (failEntry) {
        failEntry.status = "failed";
      }
      renderAttachPreviews();
    } else if (event.data.type === "insertText") {
      input.value = (input.value ? input.value + "\n" : "") + event.data.text;
      input.focus();
    }
  });

  document.addEventListener("click", function(e) {
    var reaction = e.target.closest(".reaction");
    if (reaction) {
      var msgId = reaction.dataset.msgId;
      var emoji = reaction.dataset.emoji;
      if (msgId && emoji) {
        // Toggle: if already reacted, remove; otherwise add
        if (reaction.classList.contains("reaction-mine")) {
          vscode.postMessage({ type: "removeReaction", payload: { messageId: msgId, emoji: emoji } });
          reaction.classList.remove("reaction-mine");
        } else {
          vscode.postMessage({ type: "react", payload: { messageId: msgId, emoji: emoji } });
          reaction.classList.add("reaction-mine");
        }
      }
    }
  });

  // Lightbox overlay with prev/next navigation
  var lightbox = document.createElement("div");
  lightbox.className = "lightbox-overlay";
  lightbox.style.display = "none";
  lightbox.innerHTML = '<div class="lightbox-backdrop"></div>' +
    '<button class="lightbox-nav lightbox-prev">\u2039</button>' +
    '<img class="lightbox-img" />' +
    '<button class="lightbox-nav lightbox-next">\u203A</button>' +
    '<button class="lightbox-close">\u2715</button>' +
    '<span class="lightbox-counter"></span>';
  document.body.appendChild(lightbox);

  var lightboxImages = [];
  var lightboxIndex = 0;
  var lightboxImg = lightbox.querySelector(".lightbox-img");
  var lightboxCounter = lightbox.querySelector(".lightbox-counter");

  function lightboxShow(idx) {
    if (idx < 0 || idx >= lightboxImages.length) return;
    lightboxIndex = idx;
    lightboxImg.src = lightboxImages[idx];
    lightboxCounter.textContent = (idx + 1) + " / " + lightboxImages.length;
    lightbox.querySelector(".lightbox-prev").style.display = idx > 0 ? "flex" : "none";
    lightbox.querySelector(".lightbox-next").style.display = idx < lightboxImages.length - 1 ? "flex" : "none";
  }

  lightbox.querySelector(".lightbox-backdrop").addEventListener("click", function() { lightbox.style.display = "none"; });
  lightbox.querySelector(".lightbox-close").addEventListener("click", function() { lightbox.style.display = "none"; });
  lightbox.querySelector(".lightbox-prev").addEventListener("click", function() { lightboxShow(lightboxIndex - 1); });
  lightbox.querySelector(".lightbox-next").addEventListener("click", function() { lightboxShow(lightboxIndex + 1); });
  document.addEventListener("keydown", function(e) {
    if (lightbox.style.display === "none") return;
    if (e.key === "Escape") lightbox.style.display = "none";
    if (e.key === "ArrowLeft") lightboxShow(lightboxIndex - 1);
    if (e.key === "ArrowRight") lightboxShow(lightboxIndex + 1);
  });

  document.addEventListener("click", (e) => {
    const img = e.target.closest(".chat-attachment-img");
    if (img && img.dataset.url) {
      // Collect all images in conversation
      lightboxImages = Array.from(document.querySelectorAll(".chat-attachment-img[data-url]")).map(function(el) { return el.dataset.url; });
      lightboxIndex = lightboxImages.indexOf(img.dataset.url);
      if (lightboxIndex === -1) lightboxIndex = 0;
      lightboxShow(lightboxIndex);
      lightbox.style.display = "flex";
    }
  });

  function escapeHtml(str) { if (!str) return ""; const div = document.createElement("div"); div.textContent = str; return div.innerHTML; }

  function highlightMentions(html) {
    // Only highlight @mentions with 3+ chars to avoid partial matches like @ak, @hu
    html = html.replace(/@([a-zA-Z0-9_-]{3,})/g, '<span class="mention">@$1</span>');
    // Convert URLs to clickable links
    html = html.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" class="msg-link">$1</a>');
    return html;
  }

  // Link preview cache + queue to avoid duplicate/concurrent fetches
  var linkPreviewCache = {};
  var linkPreviewPending = {};
  var linkPreviewQueue = [];
  var MAX_CONCURRENT_PREVIEWS = 5;

  function fetchLinkPreview(msgId, rawUrl) {
    var url = rawUrl.replace(/[.,;:)!?]+$/, '');
    if (linkPreviewCache[url]) {
      appendLinkPreviewCard(document.querySelector('[data-msg-id-block="' + escapeHtml(msgId) + '"]'), url, linkPreviewCache[url]);
      return;
    }
    if (linkPreviewPending[url]) return;
    if (Object.keys(linkPreviewPending).length >= MAX_CONCURRENT_PREVIEWS) {
      linkPreviewQueue.push({ msgId: msgId, url: url });
      return;
    }
    linkPreviewPending[url] = true;
    vscode.postMessage({ type: 'fetchLinkPreview', payload: { url: url, messageId: msgId } });
  }

  function drainLinkPreviewQueue() {
    while (linkPreviewQueue.length > 0 && Object.keys(linkPreviewPending).length < MAX_CONCURRENT_PREVIEWS) {
      var next = linkPreviewQueue.shift();
      fetchLinkPreview(next.msgId, next.url);
    }
  }

  function appendLinkPreviewCard(msgEl, url, data) {
    if (!msgEl || !data) return;
    if (msgEl.querySelector('.link-preview-card')) return; // already appended

    var domain = '';
    try { domain = new URL(url).hostname; } catch(e) {}
    var isGitHub = url.indexOf('github.com') !== -1;
    var html;

    if (isGitHub) {
      var ghPath = '';
      try { ghPath = new URL(url).pathname.replace(/^\//, '').replace(/\/$/, ''); } catch(e) {}
      var ghTitle = data.title || ghPath || domain;
      html = '<a class="link-preview-card link-preview-github" href="' + escapeHtml(url) + '" target="_blank">' +
        '<i class="codicon codicon-github lp-gh-icon"></i>' +
        '<div class="link-preview-body">' +
          '<div class="link-preview-title">' + escapeHtml(ghTitle) + '</div>' +
          (data.description ? '<div class="link-preview-desc">' + escapeHtml(data.description.slice(0, 120)) + '</div>' : '') +
          '<div class="link-preview-domain"><i class="codicon codicon-github" style="font-size:10px"></i>' + escapeHtml(domain) + '</div>' +
        '</div>' +
      '</a>';
    } else {
      html = '<a class="link-preview-card" href="' + escapeHtml(url) + '" target="_blank">';
      if (data.image) {
        html += '<img class="link-preview-img" src="' + escapeHtml(data.image) + '" alt="" onerror="this.style.display=\'none\'" />';
      }
      html += '<div class="link-preview-body">';
      if (data.title) { html += '<div class="link-preview-title">' + escapeHtml(data.title) + '</div>'; }
      if (data.description) { html += '<div class="link-preview-desc">' + escapeHtml(data.description.slice(0, 150)) + '</div>'; }
      if (domain) { html += '<div class="link-preview-domain"><i class="codicon codicon-link" style="font-size:10px"></i>' + escapeHtml(domain) + '</div>'; }
      html += '</div></a>';
    }

    var textEl = msgEl.querySelector('.msg-text');
    if (textEl) { textEl.insertAdjacentHTML('afterend', html); }
  }

  // Optimistic UI: add reaction emoji to message DOM immediately
  function addReactionToMessage(msgId, emoji) {
    var msgEl = document.querySelector('[data-msg-id="' + msgId + '"]');
    if (!msgEl) return;

    var reactionsDiv = msgEl.querySelector(".reactions");
    if (!reactionsDiv) {
      reactionsDiv = document.createElement("div");
      reactionsDiv.className = "reactions";
      var meta = msgEl.querySelector(".meta");
      if (meta) { msgEl.insertBefore(reactionsDiv, meta); }
      else { msgEl.appendChild(reactionsDiv); }
    }

    // Check if emoji already exists
    var existing = reactionsDiv.querySelector('.reaction[data-emoji="' + CSS.escape(emoji) + '"]');
    if (existing) {
      // Add my avatar to the stack
      var avatarsDiv = existing.querySelector(".reaction-avatars");
      if (avatarsDiv && !avatarsDiv.querySelector('img[alt="@' + CSS.escape(currentUser) + '"]')) {
        var img = document.createElement("img");
        img.src = "https://github.com/" + encodeURIComponent(currentUser) + ".png?size=32";
        img.className = "reaction-avatar";
        img.alt = "@" + currentUser;
        img.title = currentUser;
        img.style.marginLeft = "-6px";
        img.style.zIndex = "0";
        avatarsDiv.appendChild(img);
      }
      existing.classList.add("reaction-mine");
      existing.style.transform = "scale(1.15)";
      setTimeout(function() { existing.style.transform = ""; }, 150);
    } else {
      // Create new reaction with my avatar
      var span = document.createElement("span");
      span.className = "reaction reaction-mine";
      span.dataset.msgId = msgId;
      span.dataset.emoji = emoji;
      var avatarUrl = "https://github.com/" + encodeURIComponent(currentUser) + ".png?size=32";
      span.innerHTML = '<span class="reaction-emoji">' + escapeHtml(emoji) + '</span>' +
        '<span class="reaction-avatars"><img src="' + avatarUrl + '" class="reaction-avatar" alt="@' + escapeHtml(currentUser) + '" title="' + escapeHtml(currentUser) + '"></span>';
      // Animate entrance
      span.style.transform = "scale(0)";
      span.style.transition = "transform 0.15s ease-out";
      reactionsDiv.appendChild(span);
      requestAnimationFrame(function() { span.style.transform = "scale(1)"; });
    }
  }

  // ========== @Mention Autocomplete ==========
  let mentionActive = false;
  let mentionQuery = "";
  let mentionStartPos = -1;
  let mentionUsers = [];
  let mentionSelectedIndex = 0;
  let mentionDebounce = null;

  const mentionDropdown = document.createElement("div");
  mentionDropdown.className = "mention-dropdown";
  mentionDropdown.style.display = "none";
  document.querySelector(".chat-input").style.position = "relative";
  document.querySelector(".chat-input").appendChild(mentionDropdown);

  let isComposing = false;
  input.addEventListener("compositionstart", function() { isComposing = true; });
  input.addEventListener("compositionend", function() {
    isComposing = false;
    lastCompositionEnd = Date.now();
  });

  input.addEventListener("input", function() {
    if (isComposing) return;
    const val = input.value;
    const cursorPos = input.selectionStart || 0;

    // Find @ before cursor
    const textBeforeCursor = val.slice(0, cursorPos);
    const atIndex = textBeforeCursor.lastIndexOf("@");

    if (atIndex >= 0) {
      const charBefore = atIndex > 0 ? textBeforeCursor[atIndex - 1] : " ";
      if (charBefore === " " || charBefore === "\n" || atIndex === 0) {
        const query = textBeforeCursor.slice(atIndex + 1);
        if (query.length >= 0 && !query.includes(" ")) {
          mentionActive = true;
          mentionStartPos = atIndex;
          mentionQuery = query;
          mentionSelectedIndex = 0;

          clearTimeout(mentionDebounce);
          if (query.length >= 1) {
            // In groups: prioritize group members; in DMs: prioritize friends
            var searchPool = isGroup ? groupMembersList : friendsList;
            var localMatches = searchPool
              .filter(function(f) {
                return f.login !== currentUser && (
                  f.login.toLowerCase().includes(query.toLowerCase()) ||
                  (f.name && f.name.toLowerCase().includes(query.toLowerCase()))
                );
              })
              .sort(function(a, b) {
                if (a.online && !b.online) return -1;
                if (!a.online && b.online) return 1;
                return (b.lastSeen || 0) - (a.lastSeen || 0);
              })
              .map(function(f) {
                return { login: f.login, name: f.name, avatar_url: f.avatar_url, isFriend: true, online: f.online };
              });

            if (localMatches.length > 0) {
              mentionUsers = localMatches;
              mentionSelectedIndex = 0;
              renderMentionDropdown();
              mentionDropdown.style.display = "block";
            }

            // Only call API search for DMs (not groups — groups use local member list only)
            if (!isGroup) {
              mentionDebounce = setTimeout(function() {
                vscode.postMessage({ type: "searchUsers", payload: { query: query } });
              }, 300);
            }
          } else {
            // Show all members/friends when just "@" is typed
            var pool = isGroup ? groupMembersList : friendsList;
            var topFriends = pool
              .filter(function(f) { return f.login !== currentUser; })
              .map(function(f) {
                return { login: f.login, name: f.name, avatar_url: f.avatar_url, isFriend: true, online: f.online };
              });
            if (topFriends.length > 0) {
              mentionUsers = topFriends;
              mentionSelectedIndex = 0;
              renderMentionDropdown();
              mentionDropdown.style.display = "block";
            } else {
              mentionDropdown.style.display = "none";
            }
          }
          return;
        }
      }
    }

    hideMentionDropdown();
  });

  input.addEventListener("keydown", function(e) {
    if (e.isComposing) return;
    if (!mentionActive || mentionDropdown.style.display === "none") { return; }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      mentionSelectedIndex = Math.min(mentionSelectedIndex + 1, mentionUsers.length - 1);
      renderMentionDropdown();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      mentionSelectedIndex = Math.max(mentionSelectedIndex - 1, 0);
      renderMentionDropdown();
    } else if (e.key === "Enter" || e.key === "Tab") {
      if (mentionUsers.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        insertMention(mentionUsers[mentionSelectedIndex]);
      }
    } else if (e.key === "Escape") {
      hideMentionDropdown();
    }
  });

  window.addEventListener("message", function(event) {
    if (event.data.type === "mentionSuggestions") {
      var apiUsers = event.data.users || [];
      // Merge: keep existing friend matches on top, add API results that aren't already shown
      var existingLogins = {};
      mentionUsers.forEach(function(u) { existingLogins[u.login] = true; });
      var newUsers = apiUsers.filter(function(u) { return !existingLogins[u.login]; })
        .map(function(u) { return { login: u.login, name: u.name, avatar_url: u.avatar_url, isFriend: false, online: false }; });
      mentionUsers = mentionUsers.concat(newUsers);
      mentionSelectedIndex = 0;
      if (mentionActive && mentionUsers.length > 0) {
        renderMentionDropdown();
        mentionDropdown.style.display = "block";
      } else {
        mentionDropdown.style.display = "none";
      }
    }
  });

  function renderMentionDropdown() {
    mentionDropdown.innerHTML = mentionUsers.map(function(u, i) {
      var avatar = u.avatar_url || ("https://github.com/" + encodeURIComponent(u.login) + ".png?size=32");
      var selected = i === mentionSelectedIndex ? " mention-selected" : "";
      var dot = u.online ? '<span class="mention-dot mention-dot-online"></span>' : (u.isFriend ? '<span class="mention-dot mention-dot-offline"></span>' : '');
      return '<div class="mention-item' + selected + '" data-index="' + i + '">' +
        '<div style="position:relative;flex-shrink:0">' +
          '<img src="' + escapeHtml(avatar) + '" class="mention-avatar" alt="">' +
          dot +
        '</div>' +
        '<div class="mention-info">' +
          '<span class="mention-name">' + escapeHtml(u.name || u.login) + '</span>' +
          '<span class="mention-login">@' + escapeHtml(u.login) + '</span>' +
        '</div>' +
      '</div>';
    }).join("");

    mentionDropdown.querySelectorAll(".mention-item").forEach(function(el) {
      el.addEventListener("mousedown", function(e) {
        e.preventDefault();
        var idx = parseInt(el.dataset.index, 10);
        insertMention(mentionUsers[idx]);
      });
    });
  }

  function insertMention(user) {
    if (!user) { return; }
    var val = input.value;
    var before = val.slice(0, mentionStartPos);
    var after = val.slice(input.selectionStart || val.length);
    input.value = before + "@" + user.login + " " + after;
    var newPos = mentionStartPos + user.login.length + 2; // +2 for @ and space
    input.setSelectionRange(newPos, newPos);
    input.focus();
    hideMentionDropdown();
  }

  function hideMentionDropdown() {
    mentionActive = false;
    mentionUsers = [];
    mentionDropdown.style.display = "none";
  }

  // Close dropdown when clicking outside
  document.addEventListener("click", function(e) {
    if (!e.target.closest(".mention-dropdown") && !e.target.closest(".chat-input input")) {
      hideMentionDropdown();
    }
  });

  // ========== Group Members Dropdown (removed — now handled via Group Info Panel) ==========


  function cancelReply() {
    replyingTo = null;
    var bar = document.getElementById("replyBar");
    if (bar) { bar.style.display = "none"; }
  }

  function startReply(msgId, sender, text) {
    replyingTo = { id: msgId, sender: sender, text: text.slice(0, 100) };
    var replyBar = document.getElementById('replyBar');
    if (!replyBar) {
      replyBar = document.createElement('div');
      replyBar.id = 'replyBar';
      replyBar.className = 'reply-bar';
      document.querySelector('.chat-input').before(replyBar);
    }
    replyBar.innerHTML =
      '<div class="reply-bar-content">' +
        '<i class="codicon codicon-reply" style="color:var(--gs-link);flex-shrink:0"></i>' +
        '<div class="reply-bar-info">' +
          '<span class="reply-bar-sender">Reply to ' + escapeHtml(sender) + '</span>' +
          '<span class="reply-bar-text">' + escapeHtml(text.slice(0, 100)) + '</span>' +
        '</div>' +
      '</div>' +
      '<button class="reply-bar-close" id="replyClose" aria-label="Cancel reply"><i class="codicon codicon-close"></i></button>';
    replyBar.style.display = 'flex';
    document.getElementById('replyClose').addEventListener('click', cancelReply);
    input.focus();
  }

  // ========== Header ⋮ Menu ==========
  function toggleHeaderMenu() {
    var existing = document.querySelector(".header-menu");
    if (existing) { existing.remove(); return; }

    var menu = document.createElement("div");
    menu.className = "header-menu";

    var items = [];
    if (isGroup) {
      items.push('<div class="hm-item" data-action="groupInfo"><span class="codicon codicon-organization"></span> Manage</div>');
    }
    items.push('<div class="hm-item" data-action="togglePin">' + (isPinned ? '\u{1F4CC} Unpin conversation' : '\u{1F4CC} Pin conversation') + '</div>');
    if (!isGroup) {
      items.push('<div class="hm-item" data-action="addPeople"><i class="codicon codicon-person-add"></i> Add people</div>');
    }
    items.push('<div class="hm-item" data-action="toggleMute"><i class="codicon ' + (isMuted ? 'codicon-bell' : 'codicon-bell-slash') + '"></i> ' + (isMuted ? 'Unmute' : 'Mute') + '</div>');

    menu.innerHTML = items.join("");
    document.querySelector(".chat-header").appendChild(menu);

    menu.addEventListener("click", function(e) {
      var item = e.target.closest(".hm-item");
      if (!item) return;
      var action = item.dataset.action;
      if (action === "groupInfo") { vscode.postMessage({ type: "groupInfo" }); }
      else if (action === "togglePin") { vscode.postMessage({ type: "togglePin", payload: { isPinned: isPinned } }); isPinned = !isPinned; }
      else if (action === "addPeople") { vscode.postMessage({ type: "addPeople" }); }
      else if (action === "toggleMute") { vscode.postMessage({ type: "toggleMute", payload: { isMuted: isMuted } }); }
      else if (action === "leaveGroup") { vscode.postMessage({ type: "leaveGroup" }); }
      menu.remove();
    });

    setTimeout(function() {
      document.addEventListener("click", function closeMenu() {
        menu.remove();
        document.removeEventListener("click", closeMenu);
      }, { once: true });
    }, 0);
  }

  // ========== Group Info Panel ==========
  window.addEventListener("message", function(event) {
    if (event.data.type === "showGroupInfo") {
      groupMembers = event.data.members || [];
      showGroupInfoPanel();
    }
    if (event.data.type === "muteUpdated") {
      isMuted = event.data.isMuted;
    }
    if (event.data.type === "pinReverted") {
      isPinned = event.data.isPinned;
    }
    if (event.data.type === "showToast") {
      var toast = document.createElement("div");
      toast.className = "chat-toast";
      toast.textContent = event.data.text;
      document.body.appendChild(toast);
      setTimeout(function() { toast.remove(); }, 3500);
    }
    if (event.data.type === "groupSearchResults") {
      renderGroupSearchResults(event.data.users || []);
    }
    if (event.data.type === "inviteLinkResult") {
      var invMsg = event.data;
      var ia = document.getElementById("gip-invite-area");
      if (ia && invMsg.payload && invMsg.payload.code) {
        ia.classList.add('has-link');
        var invUrl = invMsg.payload.url || "https://gitstar.ai/join/" + invMsg.payload.code;
        ia.innerHTML =
          '<textarea class="gs-input gip-invite-input" readonly>' + escapeHtml(invUrl) + '</textarea>' +
          '<div class="gip-invite-actions">' +
            '<button class="gs-btn gs-btn-primary gip-cta-btn gip-copy-invite-btn" data-url="' + escapeHtml(invUrl) + '">Copy</button>' +
            '<button class="gs-btn gs-btn-danger gip-cta-btn gip-revoke-invite-btn">Revoke</button>' +
          '</div>';
      }
    }
    if (event.data.type === "inviteLinkRevoked") {
      var newInvUrl = event.data.payload && (event.data.payload.url || ('https://gitstar.ai/join/' + event.data.payload.code));
      if (newInvUrl) {
        var invInput = document.querySelector('.gip-invite-input');
        var copyBtn = document.querySelector('.gip-copy-invite-btn');
        if (invInput) { invInput.value = newInvUrl; }
        if (copyBtn) { copyBtn.dataset.url = newInvUrl; }
        var ia2 = document.getElementById('gip-invite-area');
        if (ia2) {
          var revokedToast = document.createElement('span');
          revokedToast.className = 'gip-revoked-toast';
          revokedToast.textContent = 'Revoked';
          ia2.appendChild(revokedToast);
          setTimeout(function() { revokedToast.remove(); }, 3000);
        }
      }
    }
  });

  function showGroupInfoPanel() {
    var existing = document.getElementById("group-info-panel");
    if (existing) { existing.remove(); }

    var panel = document.createElement("div");
    panel.id = "group-info-panel";
    panel.className = "group-info-panel";

    var isCreator = createdBy === currentUser;

    var currentAvatar = groupAvatarUrl;

    var avatarSection = isCreator
      ? '<div class="gip-avatar-section">' +
          '<div class="gip-avatar-outer">' +
            '<div class="gip-avatar-wrapper">' +
              '<img class="gip-group-avatar" id="gip-avatar-img" src="' + (currentAvatar ? escapeHtml(currentAvatar) : '') + '" alt="Group avatar"' + (currentAvatar ? '' : ' style="display:none"') + '>' +
              '<div class="gip-avatar-placeholder" id="gip-avatar-placeholder"' + (currentAvatar ? ' style="display:none"' : '') + '><i class="codicon codicon-organization"></i></div>' +
              '<div class="gip-avatar-edit-overlay" id="gip-avatar-change-btn" aria-label="Change group avatar"><i class="codicon codicon-edit"></i></div>' +
            '</div>' +
          '</div>' +
          '<div class="gip-avatar-error" id="gip-avatar-error" style="display:none"></div>' +
        '</div>'
      : '';

    panel.innerHTML =
      '<div class="gip-header"><span class="gip-title">Manage</span><button class="gip-close" id="gip-close"><i class="codicon codicon-close"></i></button></div>' +
      '<div class="gip-body">' +
        avatarSection +
        '<div class="gip-group-name' + (isCreator ? ' gip-editable' : '') + '" id="gip-group-name" title="' + (isCreator ? 'Click to edit' : '') + '">' + escapeHtml(document.querySelector(".name") ? document.querySelector(".name").textContent : "Group") + '</div>' +
        '<div class="gip-member-count">' + groupMembers.length + ' members</div>' +
        '<div class="gip-divider"></div>' +
        '<div class="gip-section">' +
          '<div class="gip-section-header"><span>MEMBERS</span>' +
          '<button class="gip-add-btn" id="gip-add-btn">+ Add Member</button>' +
          '</div>' +
          '<div id="gip-search" style="display:none;padding:8px 0"><input type="text" class="gip-search-input" id="gip-search-input" placeholder="Search users..."><div id="gip-search-results"></div></div>' +
          '<div id="gip-members">' + groupMembers.map(function(m) {
            var avatar = m.avatar_url || ("https://github.com/" + encodeURIComponent(m.login) + ".png?size=48");
            var isMe = m.login === currentUser;
            var isAdmin = m.login === createdBy;
            var removable = isCreator && !isMe && !isAdmin;
            return '<div class="gip-member gip-member-clickable" data-login="' + escapeHtml(m.login) + '" style="cursor:pointer">' +
              '<img src="' + escapeHtml(avatar) + '" class="gip-avatar" alt="">' +
              '<div class="gip-member-info">' +
                '<span class="gip-member-name">' + escapeHtml(m.name || m.login) + (isMe ? ' <span class="gip-badge">You</span>' : '') + (isAdmin ? ' <span class="gip-badge gip-badge-admin">Admin</span>' : '') + '</span>' +
                '<span class="gip-member-login">@' + escapeHtml(m.login) + '</span>' +
              '</div>' +
              (removable ? '<button class="gip-remove-btn" data-login="' + escapeHtml(m.login) + '">Remove</button>' : '') +
            '</div>';
          }).join("") + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="gip-footer">' +
        (isCreator ? '<div id="gip-invite-area"><button class="gs-btn gs-btn-secondary gs-btn-lg gip-cta-btn gip-create-invite-btn"><i class="codicon codicon-link"></i> Create Invite Link</button></div><div class="gip-divider"></div>' : '') +
        '<button class="gs-btn gs-btn-lg gip-cta-btn gs-btn-danger gip-leave-btn" id="gip-leave-btn"><i class="codicon codicon-reply"></i> Leave Group</button>' +
        (isCreator ? '<button class="gs-btn gs-btn-lg gip-cta-btn gs-btn-danger gip-delete-btn" id="gip-delete-btn"><i class="codicon codicon-trash"></i> Delete Group</button>' : '') +
      '</div>';

    document.body.appendChild(panel);

    document.getElementById("gip-close").addEventListener("click", function() { panel.remove(); });

    // Avatar upload (creator only)
    if (isCreator) {
      var changeBtn = document.getElementById('gip-avatar-change-btn');
      if (changeBtn) {
        var fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/png,image/jpeg,image/gif';
        fileInput.style.display = 'none';
        document.body.appendChild(fileInput);
        changeBtn.addEventListener('click', function() { fileInput.click(); });
        fileInput.addEventListener('change', function() {
          var file = fileInput.files && fileInput.files[0];
          if (!file) return;
          var errEl = document.getElementById('gip-avatar-error');
          if (file.size > 5 * 1024 * 1024) {
            errEl.textContent = 'Image must be under 5MB';
            errEl.style.display = 'block';
            return;
          }
          errEl.style.display = 'none';
          var avatarImg = document.getElementById('gip-avatar-img');
          var placeholder = document.getElementById('gip-avatar-placeholder');
          var prevSrc = avatarImg ? avatarImg.src : '';
          var blobUrl = URL.createObjectURL(file);
          if (avatarImg) { avatarImg.src = blobUrl; avatarImg.style.display = ''; }
          if (placeholder) { placeholder.style.display = 'none'; }
          var reader = new FileReader();
          reader.onload = function() {
            vscode.postMessage({ type: 'uploadGroupAvatar', payload: { base64: reader.result, mimeType: file.type } });
          };
          reader.readAsDataURL(file);
          fileInput.value = '';
          function onAvatarMsg(event) {
            if (event.data.type === 'groupAvatarUpdated') {
              groupAvatarUrl = event.data.avatarUrl;
              if (avatarImg) { URL.revokeObjectURL(blobUrl); avatarImg.src = event.data.avatarUrl; avatarImg.style.display = ''; }
              if (placeholder) { placeholder.style.display = 'none'; }
              var headerAvatar = document.getElementById('header-group-avatar');
              if (headerAvatar && headerAvatar.tagName === 'IMG') {
                headerAvatar.src = event.data.avatarUrl;
              } else if (headerAvatar) {
                var newImg = document.createElement('img');
                newImg.className = 'header-group-avatar';
                newImg.id = 'header-group-avatar';
                newImg.src = event.data.avatarUrl;
                newImg.alt = '';
                headerAvatar.parentNode.replaceChild(newImg, headerAvatar);
              }
              window.removeEventListener('message', onAvatarMsg);
            } else if (event.data.type === 'groupAvatarFailed') {
              if (avatarImg) { avatarImg.src = prevSrc; if (!prevSrc) { avatarImg.style.display = 'none'; if (placeholder) placeholder.style.display = ''; } }
              if (errEl) { errEl.textContent = 'Upload failed. Try again.'; errEl.style.display = 'block'; }
              window.removeEventListener('message', onAvatarMsg);
            }
          }
          window.addEventListener('message', onAvatarMsg);
        });
      }
    }
    document.getElementById("gip-leave-btn").addEventListener("click", function() {
      vscode.postMessage({ type: "leaveGroup" });
    });
    if (isCreator) {
      document.getElementById("gip-delete-btn").addEventListener("click", function() {
        vscode.postMessage({ type: "deleteGroup" });
      });
    }

    // Invite link button handlers (event delegation on footer + invite section)
    panel.addEventListener("click", function(e) {
      var target = e.target;
      if (target.classList.contains("gip-create-invite-btn")) {
        vscode.postMessage({ type: "createInviteLink" });
      } else if (target.classList.contains("gip-copy-invite-btn")) {
        vscode.postMessage({ type: "copyInviteLink", payload: { url: target.dataset.url } });
      } else if (target.classList.contains("gip-revoke-invite-btn")) {
        vscode.postMessage({ type: "revokeInviteLink" });
      } else if (target.classList.contains("gip-invite-url")) {
        e.preventDefault();
        vscode.postMessage({ type: "openExternal", payload: { url: target.dataset.url } });
      }
    });

    // Click-to-edit group name (creator only)
    if (isCreator) {
      var nameEl = document.getElementById("gip-group-name");
      nameEl.addEventListener("click", function() {
        var current = (document.querySelector(".name") ? document.querySelector(".name").textContent : "").trim();
        var input = document.createElement("input");
        input.type = "text";
        input.value = current;
        input.className = "gip-name-input";
        input.placeholder = "Group name";
        nameEl.innerHTML = "";
        nameEl.appendChild(input);
        input.focus();
        input.select();

        function save() {
          var newName = input.value.trim();
          if (newName && newName !== current) {
            vscode.postMessage({ type: "updateGroupName", payload: { name: newName } });
            nameEl.textContent = newName;
          } else {
            nameEl.textContent = current;
          }
        }
        input.addEventListener("blur", save);
        input.addEventListener("keydown", function(e) {
          if (e.key === "Enter") { e.preventDefault(); save(); }
          if (e.key === "Escape") { nameEl.textContent = current; }
        });
      });
    }

    {
      var addBtn = document.getElementById("gip-add-btn");
      var searchDiv = document.getElementById("gip-search");
      var searchInput = document.getElementById("gip-search-input");
      var searchDebounce = null;

      addBtn.addEventListener("click", function() {
        searchDiv.style.display = searchDiv.style.display === "none" ? "block" : "none";
        if (searchDiv.style.display === "block") { searchInput.focus(); }
      });

      searchInput.addEventListener("input", function() {
        clearTimeout(searchDebounce);
        var q = searchInput.value.trim();
        if (q.length >= 1) {
          searchDebounce = setTimeout(function() {
            vscode.postMessage({ type: "searchUsersForGroup", payload: { query: q } });
          }, 300);
        } else {
          document.getElementById("gip-search-results").innerHTML = "";
        }
      });
    }

    panel.querySelectorAll(".gip-remove-btn").forEach(function(btn) {
      btn.addEventListener("click", function(e) {
        e.stopPropagation();
        vscode.postMessage({ type: "removeMember", payload: { login: btn.dataset.login } });
      });
    });

    panel.querySelectorAll(".gip-member-clickable").forEach(function(el) {
      el.addEventListener("click", function() {
        var login = el.dataset.login;
        if (login) { vscode.postMessage({ type: "viewProfile", payload: { login: login } }); }
      });
    });
  }

  function renderGroupSearchResults(users) {
    var container = document.getElementById("gip-search-results");
    if (!container) return;

    var memberLogins = {};
    groupMembers.forEach(function(m) { memberLogins[m.login] = true; });
    var filtered = users.filter(function(u) { return !memberLogins[u.login]; });

    container.innerHTML = filtered.map(function(u) {
      var avatar = u.avatar_url || ("https://github.com/" + encodeURIComponent(u.login) + ".png?size=48");
      return '<div class="gip-search-item" data-login="' + escapeHtml(u.login) + '">' +
        '<img src="' + escapeHtml(avatar) + '" class="gip-avatar" alt="">' +
        '<div class="gip-member-info"><span class="gip-member-name">' + escapeHtml(u.name || u.login) + '</span><span class="gip-member-login">@' + escapeHtml(u.login) + '</span></div>' +
      '</div>';
    }).join("");

    container.querySelectorAll(".gip-search-item").forEach(function(el) {
      el.addEventListener("click", function() {
        vscode.postMessage({ type: "addMember", payload: { login: el.dataset.login } });
        el.remove();
      });
    });
  }

  vscode.postMessage({ type: "ready" });
})();
