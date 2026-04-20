// media/webview/toast-stack.js
(function() {
  'use strict';

  var MAX_CARDS = 3;
  var AUTO_DISMISS_MS = 4000;

  // VS Code API singleton: shared.js loads first and does `const vscode = acquireVsCodeApi()`
  // at top-level script scope. Reuse it; acquire fresh only if shared.js wasn't loaded.
  // Using a different local name to avoid shadowing the outer-scope `vscode` const.
  var vscodeApi = (typeof vscode !== 'undefined') ? vscode : acquireVsCodeApi();
  var container = null;
  // Map<string, { spec, el, timerId, remaining, startedAt }>
  var cards = new Map();

  function ensureContainer() {
    if (container) { return container; }
    container = document.createElement('div');
    container.className = 'gs-toast-stack';
    document.body.appendChild(container);
    return container;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function renderCard(spec) {
    var el = document.createElement('div');
    el.className = 'gs-toast-card';
    el.dataset.toastId = spec.id;

    var avatarHtml = spec.avatarUrl
      ? '<div class="gs-toast-avatar"><img alt="" src="' + escapeHtml(spec.avatarUrl) + '"></div>'
      : '<div class="gs-toast-avatar"></div>';

    var titleHtml = '<div class="gs-toast-title">'
      + escapeHtml(spec.title || '') + '</div>';
    var bodyHtml = spec.body
      ? '<div class="gs-toast-body">' + escapeHtml(spec.body) + '</div>'
      : '';

    el.innerHTML =
      avatarHtml +
      '<div class="gs-toast-main">' + titleHtml + bodyHtml + '</div>' +
      '<div class="gs-toast-close" role="button" aria-label="Dismiss">' +
        '<span class="codicon codicon-close"></span>' +
      '</div>';

    // Click card body → primary action
    el.addEventListener('click', function(e) {
      if (e.target && e.target.closest && e.target.closest('.gs-toast-close')) {
        e.stopPropagation();
        return;
      }
      postAction(spec.id, spec.primary);
      removeCard(spec.id);
    });

    // Click × → dismiss
    var closeBtn = el.querySelector('.gs-toast-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        postAction(spec.id, { kind: 'dismiss' });
        removeCard(spec.id);
      });
    }

    // Hover pause / resume
    el.addEventListener('mouseenter', function() { pauseTimer(spec.id); });
    el.addEventListener('mouseleave', function() { resumeTimer(spec.id); });

    return el;
  }

  function postAction(id, action) {
    try { vscodeApi.postMessage({ type: 'toast:action', id: id, action: action }); }
    catch (e) { /* swallow */ }
  }

  function startTimer(id) {
    var entry = cards.get(id);
    if (!entry) { return; }
    entry.startedAt = Date.now();
    entry.timerId = setTimeout(function() { autoDismiss(id); }, entry.remaining);
  }

  function pauseTimer(id) {
    var entry = cards.get(id);
    if (!entry || entry.timerId == null) { return; }
    clearTimeout(entry.timerId);
    entry.timerId = null;
    entry.remaining = Math.max(0, entry.remaining - (Date.now() - entry.startedAt));
  }

  function resumeTimer(id) {
    var entry = cards.get(id);
    if (!entry || entry.timerId != null) { return; }
    startTimer(id);
  }

  function autoDismiss(id) {
    // Auto-dismiss does NOT fire toast:action — only explicit user action does.
    // The host treats "no response" as equivalent to dismiss via the pending map.
    removeCard(id);
  }

  function removeCard(id) {
    var entry = cards.get(id);
    if (!entry) { return; }
    if (entry.timerId != null) { clearTimeout(entry.timerId); }
    entry.el.classList.remove('gs-toast-enter');
    entry.el.classList.add('gs-toast-exit');
    cards.delete(id);
    setTimeout(function() {
      if (entry.el.parentNode) { entry.el.parentNode.removeChild(entry.el); }
    }, 160);
  }

  function push(spec) {
    ensureContainer();

    // Update-in-place for existing id
    var existing = cards.get(spec.id);
    if (existing) {
      // Re-render the contents (title + body + avatar); keep element + position.
      var tmp = renderCard(spec);
      existing.el.innerHTML = tmp.innerHTML;
      // Re-bind handlers (innerHTML wipe removed them)
      rebindCard(existing.el, spec);
      // Reset timer
      if (existing.timerId != null) { clearTimeout(existing.timerId); }
      existing.remaining = AUTO_DISMISS_MS;
      existing.spec = spec;
      startTimer(spec.id);
      return;
    }

    // Evict oldest if at cap
    if (cards.size >= MAX_CARDS) {
      // Oldest = last child in DOM (stack renders newest first at top,
      // so appended order matches newest-first; oldest is last in container).
      var firstKey = null;
      var firstEntry = null;
      cards.forEach(function(entry, key) {
        if (firstEntry == null || entry.startedAt < firstEntry.startedAt) {
          firstKey = key; firstEntry = entry;
        }
      });
      if (firstKey) { removeCard(firstKey); }
    }

    var el = renderCard(spec);
    container.insertBefore(el, container.firstChild); // newest on top
    // Trigger animation on next frame
    requestAnimationFrame(function() { el.classList.add('gs-toast-enter'); });

    cards.set(spec.id, {
      spec: spec, el: el, timerId: null,
      remaining: AUTO_DISMISS_MS, startedAt: Date.now(),
    });
    startTimer(spec.id);
  }

  function rebindCard(el, spec) {
    // Host of handleAction for an existing card updated in place.
    // Clone-and-replace approach to drop old listeners (cheapest):
    var fresh = renderCard(spec);
    el.parentNode.replaceChild(fresh, el);
    var entry = cards.get(spec.id);
    if (entry) { entry.el = fresh; }
  }

  function dismiss(id) { removeCard(id); }

  function reset() {
    var ids = Array.from(cards.keys());
    ids.forEach(function(id) { removeCard(id); });
  }

  window.ToastStack = { push: push, dismiss: dismiss, reset: reset };

  // Announce readiness after DOM is interactive
  function announceReady() {
    try { vscodeApi.postMessage({ type: 'toast:ready' }); }
    catch (_e) { /* swallow */ }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', announceReady);
  } else {
    announceReady();
  }

  // Listen for host commands
  window.addEventListener('message', function(ev) {
    var m = ev.data;
    if (!m) { return; }
    if (m.type === 'toast:push') { push(m.spec); }
    else if (m.type === 'toast:dismiss') { dismiss(m.id); }
    else if (m.type === 'toast:reset') { reset(); }
  });
})();
