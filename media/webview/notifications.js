// notifications.js
let notifications = [];
const typeIcons = { follow: '<span class="codicon codicon-person"></span>', star: '<span class="codicon codicon-star-full"></span>', mention: '<span class="codicon codicon-mention"></span>', message: '<span class="codicon codicon-comment"></span>', like: '<span class="codicon codicon-heart"></span>', comment: '<span class="codicon codicon-comment"></span>' };

document.getElementById("mark-all-read").addEventListener("click", () => { doAction("markAllRead"); });

window.addEventListener("message", (e) => {
  if (e.data.type === "setNotifications") {
    notifications = e.data.notifications || [];
    render();
  }
});

function render() {
  const container = document.getElementById("notifications");
  const empty = document.getElementById("empty");
  if (!notifications.length) { container.innerHTML = ""; empty.style.display = "block"; return; }
  empty.style.display = "none";

  const unread = notifications.filter(n => !(n.is_read || n.read));
  const read = notifications.filter(n => n.is_read || n.read);

  let html = "";
  if (unread.length) {
    html += '<div class="gs-section-title">New</div>';
    html += unread.map(n => renderNotification(n, true)).join("");
  }
  if (read.length) {
    html += '<div class="gs-section-title">Earlier</div>';
    html += read.map(n => renderNotification(n, false)).join("");
  }

  container.innerHTML = html;

  container.querySelectorAll(".notif-item").forEach(el => {
    el.addEventListener("click", () => {
      doAction("openTarget", { type: el.dataset.type, actor: el.dataset.actor, url: el.dataset.url });
    });
  });
}

function renderNotification(n, isNew) {
  const actor = n.actor_login || n.actor || "";
  const avatar = n.actor_avatar || avatarUrl(actor);
  const icon = typeIcons[n.type] || '<span class="codicon codicon-bell"></span>';
  const message = n.message || (actor + " " + (n.type || "notification"));
  const time = timeAgo(n.created_at);

  return '<div class="gs-list-item notif-item' + (isNew ? ' notif-unread' : '') + '" ' +
    'data-type="' + escapeHtml(n.type || "") + '" data-actor="' + escapeHtml(actor) + '" data-url="' + escapeHtml(n.target_url || "") + '">' +
    '<img src="' + escapeHtml(avatar) + '" class="gs-avatar gs-avatar-sm" alt="">' +
    '<div class="gs-flex-1" style="min-width:0">' +
      '<div class="gs-text-sm">' + icon + ' ' + escapeHtml(message) + '</div>' +
    '</div>' +
    '<span class="gs-text-xs gs-text-muted gs-flex-shrink-0">' + time + '</span>' +
  '</div>';
}

doAction("ready");
