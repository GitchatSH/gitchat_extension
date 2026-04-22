(function () {
  "use strict";

  var _topics = [];
  var _parentConvId = null;

  var EMOJI_PRESETS = ["💬", "🐛", "🚀", "📋", "💡", "🔌", "📐", "🧪", "📢", "📖", "🔧", "🌐"];

  function render(container, topics, parentConvId) {
    _topics = topics || [];
    _parentConvId = parentConvId;
    var sorted = sortTopics(_topics.filter(function (t) { return !isArchived(t); }));
    container.innerHTML = buildRows(sorted);
    bindRowHandlers(container);
  }

  function isGeneral(t) { return t.is_general || t.isGeneral; }
  function isArchived(t) { return t.is_archived || t.isArchived; }

  function sortTopics(topics) {
    return topics.slice().sort(function (a, b) {
      if (isGeneral(a) && !isGeneral(b)) return -1;
      if (!isGeneral(a) && isGeneral(b)) return 1;
      var aT = (a.last_message_at || a.lastMessageAt) ? new Date(a.last_message_at || a.lastMessageAt).getTime() : 0;
      var bT = (b.last_message_at || b.lastMessageAt) ? new Date(b.last_message_at || b.lastMessageAt).getTime() : 0;
      return bT - aT;
    });
  }

  function buildRows(topics) {
    if (topics.length === 0) {
      return '<div style="padding:20px;text-align:center;color:var(--gs-muted);font-size:var(--gs-font-sm)">'
        + '<span class="codicon codicon-comment-discussion" style="font-size:24px;display:block;margin-bottom:8px"></span>'
        + 'No topics yet</div>';
    }
    return topics.map(function (t) {
      var unread = t.unread_count || t.unreadCount || 0;
      var badge = unread > 0
        ? '<span class="gs-topic-row__badge">' + unread + '</span>'
        : '';
      // BE exposes lastMessageText/lastSenderLogin on TopicResponseDto
      // (consistent with parent message_conversations DTO). Fall back to the
      // lastMessagePreview/Sender names this view originally expected, in
      // case the shape ever shifts back.
      var msgPreview = t.last_message_text || t.lastMessageText
        || t.last_message_preview || t.lastMessagePreview || '';
      var msgSender = t.last_sender_login || t.lastSenderLogin
        || t.last_message_sender || t.lastMessageSender || '';
      var msgTime = t.last_message_at || t.lastMessageAt || '';
      var preview = '';
      if (msgPreview) {
        var sender = msgSender ? escapeHtml(msgSender) + ': ' : '';
        preview = '<div class="gs-topic-row__preview">' + sender + escapeHtml(msgPreview) + '</div>';
      }
      var time = msgTime ? timeAgo(msgTime) : '';
      var icon = t.iconEmoji || t.icon_emoji || '💬';
      return '<div class="gs-topic-row" data-topic-id="' + t.id + '">'
        + '<div class="gs-topic-row__icon">' + icon + '</div>'
        + '<div class="gs-topic-row__body">'
        + '<div class="gs-topic-row__top">'
        + '<span class="gs-topic-row__name">' + escapeHtml(t.name) + '</span>'
        + '<span class="gs-topic-row__time">' + time + '</span>'
        + '</div>'
        + preview
        + '</div>'
        + badge
        + '</div>';
    }).join('');
  }

  function timeAgo(dateStr) {
    var diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
    if (diff < 60) return 'now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h';
    return Math.floor(diff / 86400) + 'd';
  }

  function bindRowHandlers(container) {
    container.querySelectorAll('.gs-topic-row').forEach(function (row) {
      row.addEventListener('click', function () {
        var topicId = row.dataset.topicId;
        var topic = _topics.find(function (t) { return t.id === topicId; });
        if (topic && window.ExploreTopics) {
          window.ExploreTopics.openTopic(topicId, topic);
        }
      });
    });

    container.addEventListener('contextmenu', function (e) {
      var row = e.target.closest('.gs-topic-row');
      if (!row) return;
      e.preventDefault();
      var topicId = row.getAttribute('data-topic-id');
      var topic = _topics.find(function (t) { return t.id === topicId; });
      if (topic) showContextMenu(e, topic);
    });
  }

  function showCreateModal(container) {
    var selectedIcon = '💬';
    var iconsHtml = EMOJI_PRESETS.map(function (e) {
      var cls = e === selectedIcon ? ' gs-topic-modal__icon-btn--selected' : '';
      return '<button class="gs-topic-modal__icon-btn' + cls + '" data-icon="' + e + '">' + e + '</button>';
    }).join('');

    var modal = document.createElement('div');
    modal.className = 'gs-topic-modal';
    modal.innerHTML = '<div class="gs-topic-modal__card">'
      + '<div class="gs-topic-modal__title"><span class="gs-topic-modal__title-text">New Topic</span><button class="gs-btn-icon gs-topic-modal__close" title="Close"><i class="codicon codicon-close"></i></button></div>'
      + '<div class="gs-topic-modal__label">Topic name</div>'
      + '<input class="gs-topic-modal__input" placeholder="e.g. Bug Reports" maxlength="50" />'
      + '<div class="gs-topic-modal__label">Icon (optional)</div>'
      + '<div class="gs-topic-modal__icons">' + iconsHtml + '</div>'
      + '<div class="gs-topic-modal__actions">'
      + '<button class="gs-btn" data-action="cancel">Cancel</button>'
      + '<button class="gs-btn gs-btn-primary" data-action="create">Create</button>'
      + '</div></div>';

    container.appendChild(modal);
    var input = modal.querySelector('.gs-topic-modal__input');
    input.focus();

    modal.querySelectorAll('.gs-topic-modal__icon-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        modal.querySelectorAll('.gs-topic-modal__icon-btn--selected').forEach(function (b) {
          b.classList.remove('gs-topic-modal__icon-btn--selected');
        });
        btn.classList.add('gs-topic-modal__icon-btn--selected');
        selectedIcon = btn.dataset.icon;
      });
    });

    modal.querySelector('[data-action="cancel"]').addEventListener('click', function () { modal.remove(); });
    modal.querySelector('.gs-topic-modal__close').addEventListener('click', function () { modal.remove(); });
    modal.addEventListener('click', function (e) { if (e.target === modal) modal.remove(); });

    modal.querySelector('[data-action="create"]').addEventListener('click', function () {
      var name = input.value.trim();
      if (!name) { input.focus(); return; }
      vscode.postMessage({ type: 'topic:create', name: name, iconEmoji: selectedIcon });
      modal.remove();
    });

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') modal.querySelector('[data-action="create"]').click();
      else if (e.key === 'Escape') modal.remove();
    });
  }

  function bindSearch(searchInput, itemsContainer) {
    searchInput.addEventListener('input', function () {
      var q = searchInput.value.trim().toLowerCase();
      var active = _topics.filter(function (t) { return !isArchived(t); });
      var filtered = q ? active.filter(function (t) { return t.name.toLowerCase().indexOf(q) !== -1; }) : active;
      itemsContainer.innerHTML = buildRows(sortTopics(filtered));
      bindRowHandlers(itemsContainer);
    });
  }

  function addTopic(topic) {
    if (_topics.some(function (t) { return t.id === topic.id; })) return;
    _topics.push(topic);
  }

  function updateTopic(topicId, updates) {
    var t = _topics.find(function (t) { return t.id === topicId; });
    if (!t) return;
    if (updates.name !== undefined) t.name = updates.name;
    if (updates.iconEmoji !== undefined) t.iconEmoji = updates.iconEmoji;
  }

  function removeTopic(topicId) {
    var t = _topics.find(function (t) { return t.id === topicId; });
    if (t) { t.is_archived = true; t.isArchived = true; }
  }

  function renderSkeleton(container) {
    var rows = '';
    for (var i = 0; i < 5; i++) {
      rows += '<div class="gs-topic-row" style="pointer-events:none;opacity:' + (1 - i * 0.15) + '">' +
        '<div class="gs-topic-row__icon gs-skeleton-circle" style="width:32px;height:32px;border-radius:6px"></div>' +
        '<div style="flex:1;display:flex;flex-direction:column;gap:4px">' +
        '<div class="gs-skeleton-line" style="width:' + (60 + i * 8) + '%;height:13px;border-radius:4px"></div>' +
        '<div class="gs-skeleton-line" style="width:' + (80 - i * 10) + '%;height:11px;border-radius:4px"></div>' +
        '</div></div>';
    }
    container.innerHTML = rows;
  }

  function renderError(container, errorMsg, parentConvId) {
    container.innerHTML = '<div class="gs-empty" style="padding:24px 16px">' +
      '<span class="codicon codicon-warning" style="font-size:24px;color:var(--gs-warning);margin-bottom:8px;display:block"></span>' +
      '<div style="margin-bottom:12px">' + escapeHtml(errorMsg || 'Failed to load topics') + '</div>' +
      '<button class="gs-btn gs-btn-primary gs-topic-retry-btn">Retry</button>' +
      '</div>';
    var retryBtn = container.querySelector('.gs-topic-retry-btn');
    if (retryBtn) {
      retryBtn.addEventListener('click', function () {
        renderSkeleton(container);
        vscode.postMessage({ type: 'topic:loadList', conversationId: parentConvId });
      });
    }
  }

  // ——— Context menu ———
  var _activeMenu = null;

  function showContextMenu(e, topic) {
    hideContextMenu();
    var isGen = topic.is_general || topic.isGeneral;
    var items = '';
    if (!isGen) {
      items += '<div class="gs-dropdown-item" data-action="edit"><span class="codicon codicon-edit"></span> Edit Topic</div>';
    }
    if (topic.unread_count > 0) {
      items += '<div class="gs-dropdown-item" data-action="markRead"><span class="codicon codicon-check"></span> Mark as Read</div>';
    }
    if (!isGen) {
      items += '<div class="gs-dropdown-divider"></div>';
      items += '<div class="gs-dropdown-item gs-dropdown-item--danger" data-action="archive"><span class="codicon codicon-archive"></span> Archive Topic</div>';
    }
    if (!items) return;

    var menu = document.createElement('div');
    menu.className = 'gs-dropdown';
    menu.style.position = 'fixed';
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';
    menu.style.zIndex = '9999';
    menu.innerHTML = items;
    document.body.appendChild(menu);
    _activeMenu = menu;

    menu.addEventListener('click', function (ev) {
      var item = ev.target.closest('[data-action]');
      if (!item) return;
      var action = item.getAttribute('data-action');
      if (action === 'edit') showEditModal(topic);
      else if (action === 'markRead') vscode.postMessage({ type: 'topic:markRead', topicId: topic.id });
      else if (action === 'archive') showArchiveConfirm(topic);
      hideContextMenu();
    });

    setTimeout(function () {
      document.addEventListener('click', hideContextMenu, { once: true });
      document.addEventListener('keydown', function onEsc(ev) {
        if (ev.key === 'Escape') { hideContextMenu(); document.removeEventListener('keydown', onEsc); }
      });
    }, 0);
  }

  function hideContextMenu() {
    if (_activeMenu) { _activeMenu.remove(); _activeMenu = null; }
  }

  // ——— Edit topic modal ———
  function showEditModal(topic) {
    var container = document.getElementById('topic-items');
    if (!container) return;
    var parent = container.parentElement || container;

    var selectedIcon = topic.iconEmoji || topic.icon_emoji || '\u{1F4AC}';
    var overlay = document.createElement('div');
    overlay.className = 'gs-topic-modal';
    overlay.innerHTML =
      '<div class="gs-topic-modal__card">' +
      '<div class="gs-topic-modal__title">Edit Topic</div>' +
      '<input class="gs-topic-modal__input" value="' + escapeHtml(topic.name) + '" maxlength="50" placeholder="Topic name">' +
      '<div class="gs-topic-modal__icons">' +
      EMOJI_PRESETS.map(function (em) {
        return '<button class="gs-topic-modal__icon-btn' + (em === selectedIcon ? ' gs-topic-modal__icon-btn--selected' : '') + '" data-emoji="' + em + '">' + em + '</button>';
      }).join('') +
      '</div>' +
      '<div class="gs-topic-modal__actions">' +
      '<button class="gs-btn gs-topic-modal__cancel">Cancel</button>' +
      '<button class="gs-btn gs-btn-primary gs-topic-modal__submit">Save</button>' +
      '</div></div>';

    parent.appendChild(overlay);

    var input = overlay.querySelector('.gs-topic-modal__input');
    var submitBtn = overlay.querySelector('.gs-topic-modal__submit');
    input.focus();
    input.select();

    overlay.querySelectorAll('.gs-topic-modal__icon-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        overlay.querySelectorAll('.gs-topic-modal__icon-btn--selected').forEach(function (b) {
          b.classList.remove('gs-topic-modal__icon-btn--selected');
        });
        btn.classList.add('gs-topic-modal__icon-btn--selected');
        selectedIcon = btn.getAttribute('data-emoji');
      });
    });

    function close() { overlay.remove(); }
    overlay.querySelector('.gs-topic-modal__cancel').addEventListener('click', close);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    submitBtn.addEventListener('click', function () {
      var name = input.value.trim();
      if (!name) return;
      vscode.postMessage({ type: 'topic:update', topicId: topic.id, name: name, iconEmoji: selectedIcon });
      close();
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') submitBtn.click();
      if (e.key === 'Escape') close();
    });
  }

  // ——— Archive confirm modal ———
  function showArchiveConfirm(topic) {
    var container = document.getElementById('topic-items');
    if (!container) return;
    var parent = container.parentElement || container;

    var overlay = document.createElement('div');
    overlay.className = 'gs-confirm-overlay';
    overlay.innerHTML =
      '<div class="gs-confirm-modal" style="max-width:320px">' +
      '<div class="gs-confirm-body">' +
      '<div style="font-weight:600;margin-bottom:8px">GitChat</div>' +
      '<div>Are you sure you want to archive "' + escapeHtml(topic.name) + '"? Messages will be preserved but the topic will be hidden.</div>' +
      '</div>' +
      '<div class="gs-confirm-actions">' +
      '<button class="gs-btn gs-confirm-cancel">Cancel</button>' +
      '<button class="gs-btn gs-btn-danger gs-confirm-ok">Archive</button>' +
      '</div></div>';

    parent.appendChild(overlay);
    function close() { overlay.remove(); }
    overlay.querySelector('.gs-confirm-cancel').addEventListener('click', close);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    overlay.querySelector('.gs-confirm-ok').addEventListener('click', function () {
      vscode.postMessage({ type: 'topic:archive', topicId: topic.id });
      close();
    });
    document.addEventListener('keydown', function onEsc(e) {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onEsc); }
    });
  }

  window.TopicList = {
    render: render,
    renderSkeleton: renderSkeleton,
    renderError: renderError,
    showCreateModal: showCreateModal,
    bindSearch: bindSearch,
    addTopic: addTopic,
    updateTopic: updateTopic,
    removeTopic: removeTopic,
    getTopics: function () { return _topics; },
  };
})();
