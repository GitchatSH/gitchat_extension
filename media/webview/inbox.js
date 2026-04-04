// inbox.js — Inbox webview script
let conversations = [];
let currentFilter = "all";
let currentUser = null;
let contextMenuEl = null;

document.getElementById("filter").addEventListener("change", (e) => {
  currentFilter = e.target.value;
  render();
});

document.getElementById("new-chat").addEventListener("click", () => {
  doAction("newChat");
});

window.addEventListener("message", (e) => {
  const data = e.data;
  if (data.type === "setConversations") {
    conversations = data.conversations || [];
    currentUser = data.currentUser;
    render();
  }
});

// Close context menu on click elsewhere
document.addEventListener("click", () => {
  if (contextMenuEl) { contextMenuEl.remove(); contextMenuEl = null; }
});

function render() {
  const container = document.getElementById("conversations");
  const empty = document.getElementById("empty");

  let filtered = conversations;
  if (currentFilter === "unread") {
    filtered = conversations.filter(c => c.unread_count > 0 || c.is_unread);
  } else if (currentFilter === "direct") {
    filtered = conversations.filter(c => !c.is_request);
  } else if (currentFilter === "requests") {
    filtered = conversations.filter(c => c.is_request);
  }

  if (!filtered.length) {
    container.innerHTML = "";
    empty.style.display = "block";
    empty.textContent = currentFilter === "all" ? "No conversations yet" : "No " + currentFilter + " conversations";
    return;
  }
  empty.style.display = "none";

  // Sort: pinned first, then by date
  filtered.sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    const dateA = new Date(a.updated_at || a.last_message_at || 0);
    const dateB = new Date(b.updated_at || b.last_message_at || 0);
    return dateB - dateA;
  });

  container.innerHTML = filtered.map(c => {
    const other = c.other_user;
    if (!other) return "";
    const avatar = other.avatar_url || avatarUrl(other.login);
    const preview = c.last_message_preview || (c.last_message && c.last_message.content) || "";
    const time = timeAgo(c.updated_at || c.last_message_at);
    const unread = (c.unread_count > 0 || c.is_unread);
    const pin = c.pinned ? '<span class="codicon codicon-pin"></span> ' : "";

    return '<div class="gs-list-item conv-item" data-id="' + c.id + '" data-pinned="' + (c.pinned || false) + '">' +
      '<img src="' + escapeHtml(avatar) + '" class="gs-avatar gs-avatar-md" alt="">' +
      '<div class="gs-flex-1" style="min-width:0">' +
        '<div class="gs-flex gs-items-center gs-gap-4">' +
          '<span class="gs-truncate" style="font-weight:' + (unread ? '600' : '400') + '">' + pin + escapeHtml(other.name || other.login) + '</span>' +
          '<span class="gs-text-xs gs-text-muted gs-ml-auto gs-flex-shrink-0">' + time + '</span>' +
          (unread ? '<span class="gs-dot-online"></span>' : '') +
        '</div>' +
        '<div class="gs-text-sm gs-text-muted gs-truncate">' + escapeHtml(preview.slice(0, 80)) + '</div>' +
      '</div>' +
    '</div>';
  }).join("");

  // Click handlers
  container.querySelectorAll(".conv-item").forEach(el => {
    el.addEventListener("click", () => {
      doAction("openChat", { conversationId: el.dataset.id });
    });
    el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      showContextMenu(e, el.dataset.id, el.dataset.pinned === "true");
    });
  });
}

function showContextMenu(e, convId, isPinned) {
  if (contextMenuEl) contextMenuEl.remove();
  const menu = document.createElement("div");
  menu.className = "context-menu";
  menu.innerHTML =
    '<div class="context-menu-item" data-action="' + (isPinned ? 'unpin' : 'pin') + '">' + (isPinned ? 'Unpin' : 'Pin') + '</div>' +
    '<div class="context-menu-item" data-action="markRead">Mark as read</div>' +
    '<div class="context-menu-item context-menu-danger" data-action="delete">Delete</div>';
  menu.style.left = e.clientX + "px";
  menu.style.top = e.clientY + "px";
  document.body.appendChild(menu);
  contextMenuEl = menu;

  menu.querySelectorAll(".context-menu-item").forEach(item => {
    item.addEventListener("click", (ev) => {
      ev.stopPropagation();
      doAction(item.dataset.action, { conversationId: convId });
      menu.remove();
      contextMenuEl = null;
    });
  });
}
