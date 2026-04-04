// friends.js
let friends = [];
let searchQuery = "";

const searchInput = document.getElementById("search");
searchInput.addEventListener("input", (e) => {
  searchQuery = e.target.value.toLowerCase();
  render();
});

window.addEventListener("message", (e) => {
  if (e.data.type === "setFriends") {
    friends = e.data.friends || [];
    render();
  }
});

function render() {
  const container = document.getElementById("friends-list");
  const empty = document.getElementById("empty");
  const title = document.getElementById("title");

  let filtered = friends;
  if (searchQuery) {
    filtered = friends.filter(f =>
      f.login.toLowerCase().includes(searchQuery) ||
      f.name.toLowerCase().includes(searchQuery)
    );
  }

  title.textContent = "Friends (" + friends.length + ")";

  if (!filtered.length) {
    container.innerHTML = "";
    empty.style.display = "block";
    empty.textContent = searchQuery ? "No matches" : "No friends yet. Follow people to see them here!";
    return;
  }
  empty.style.display = "none";

  // Group by status
  const online = filtered.filter(f => f.online);
  const recentlyActive = filtered.filter(f => !f.online && f.lastSeen > 0 && (Date.now() - f.lastSeen < 3600000));
  const offline = filtered.filter(f => !f.online && (f.lastSeen === 0 || Date.now() - f.lastSeen >= 3600000));

  let html = "";

  if (online.length) {
    html += '<div class="gs-section-title">Online (' + online.length + ')</div>';
    html += online.map(renderFriend).join("");
  }
  if (recentlyActive.length) {
    html += '<div class="gs-section-title">Recently Active</div>';
    html += recentlyActive.map(renderFriend).join("");
  }
  if (offline.length) {
    html += '<div class="gs-section-title">Offline</div>';
    html += offline.map(renderFriend).join("");
  }

  container.innerHTML = html;

  // Add click handlers
  container.querySelectorAll(".friend-item").forEach(el => {
    el.addEventListener("click", () => {
      doAction("viewProfile", { login: el.dataset.login });
    });
  });
  container.querySelectorAll(".friend-chat-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      doAction("openChat", { login: btn.dataset.login });
    });
  });
}

function renderFriend(f) {
  const avatar = f.avatar_url || avatarUrl(f.login);
  const dot = f.online ? '<span class="gs-dot-online"></span>' : '<span class="gs-dot-offline"></span>';
  const status = f.online ? "online" : (f.lastSeen > 0 ? timeAgo(new Date(f.lastSeen).toISOString()) + " ago" : "");
  const unread = f.unread > 0 ? '<span class="gs-badge">' + f.unread + '</span>' : '';

  return '<div class="gs-list-item friend-item" data-login="' + escapeHtml(f.login) + '">' +
    '<img src="' + escapeHtml(avatar) + '" class="gs-avatar gs-avatar-md" alt="">' +
    '<div class="gs-flex-1" style="min-width:0">' +
      '<div class="gs-flex gs-items-center gs-gap-4">' +
        dot +
        '<span class="gs-truncate" style="font-weight:500">' + escapeHtml(f.name) + '</span>' +
        unread +
      '</div>' +
      '<div class="gs-text-xs gs-text-muted">' + escapeHtml(status) + '</div>' +
    '</div>' +
    '<button class="gs-btn-icon friend-chat-btn" data-login="' + escapeHtml(f.login) + '" title="Message"><span class="codicon codicon-comment"></span></button>' +
  '</div>';
}
