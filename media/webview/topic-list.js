(function () {
  "use strict";

  var _topics = [];
  var _parentConvId = null;

  var EMOJI_PRESETS = ["💬", "🐛", "🚀", "📋", "💡", "🔌", "📐", "🧪", "📢", "📖", "🔧", "🌐"];

  function render(container, topics, parentConvId) {
    _topics = topics || [];
    _parentConvId = parentConvId;
    var sorted = sortTopics(_topics.filter(function (t) { return !t.is_archived; }));
    container.innerHTML = buildRows(sorted);
    bindRowHandlers(container);
  }

  function sortTopics(topics) {
    return topics.slice().sort(function (a, b) {
      if (a.is_general && !b.is_general) return -1;
      if (!a.is_general && b.is_general) return 1;
      var aT = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
      var bT = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
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
      var badge = t.unread_count > 0
        ? '<span class="gs-topic-row__badge">' + t.unread_count + '</span>'
        : '';
      var preview = '';
      if (t.last_message_preview) {
        var sender = t.last_message_sender ? escapeHtml(t.last_message_sender) + ': ' : '';
        preview = '<div class="gs-topic-row__preview">' + sender + escapeHtml(t.last_message_preview) + '</div>';
      }
      var time = t.last_message_at ? timeAgo(t.last_message_at) : '';
      var icon = t.iconEmoji || '💬';
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
      + '<div class="gs-topic-modal__title">New Topic<span class="gs-topic-modal__close">&times;</span></div>'
      + '<div class="gs-topic-modal__label">TOPIC NAME</div>'
      + '<input class="gs-topic-modal__input" placeholder="e.g. Bug Reports" maxlength="50" />'
      + '<div class="gs-topic-modal__label">ICON (optional)</div>'
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
      var active = _topics.filter(function (t) { return !t.is_archived; });
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
    if (t) t.is_archived = true;
  }

  window.TopicList = {
    render: render,
    showCreateModal: showCreateModal,
    bindSearch: bindSearch,
    addTopic: addTopic,
    updateTopic: updateTopic,
    removeTopic: removeTopic,
    getTopics: function () { return _topics; },
  };
})();
