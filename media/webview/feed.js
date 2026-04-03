// feed.js
let events = [];
const eventIcons = { commit: "🔨", pr: "🔀", issue: "🐛", release: "📦", star: "⭐", fork: "🍴" };

document.getElementById("load-more").addEventListener("click", () => { doAction("loadMore"); });

window.addEventListener("message", (e) => {
  const data = e.data;
  if (data.type === "setEvents") {
    if (data.replace) events = data.events || [];
    else events = events.concat(data.events || []);
    render();
    document.getElementById("load-more").style.display = (data.events && data.events.length >= 20) ? "block" : "none";
  }
});

function render() {
  const container = document.getElementById("events");
  const empty = document.getElementById("empty");
  if (!events.length) { container.innerHTML = ""; empty.style.display = "block"; return; }
  empty.style.display = "none";

  container.innerHTML = events.map(ev => {
    const icon = eventIcons[ev.type] || "📋";
    const avatar = ev.author_avatar || avatarUrl(ev.author || "github");
    const title = ev.title || ev.narration || ev.repo_slug || "";
    const time = timeAgo(ev.created_at);
    const liked = ev.liked ? "liked" : "";

    return '<div class="feed-event">' +
      '<div class="gs-flex gs-gap-8">' +
        '<img src="' + escapeHtml(avatar) + '" class="gs-avatar gs-avatar-md" alt="">' +
        '<div class="gs-flex-1" style="min-width:0">' +
          '<div class="gs-flex gs-items-center gs-gap-4">' +
            '<span style="font-weight:500">' + escapeHtml(ev.author || "") + '</span>' +
            '<span class="gs-text-xs gs-text-muted">' + icon + ' ' + escapeHtml(ev.type || "") + '</span>' +
            '<span class="gs-text-xs gs-text-muted gs-ml-auto">' + time + '</span>' +
          '</div>' +
          '<div class="gs-text-sm" style="margin-top:2px">' + escapeHtml(title.slice(0, 120)) + '</div>' +
          (ev.repo_slug ? '<div class="gs-text-xs gs-text-muted" style="margin-top:2px">📁 ' + escapeHtml(ev.repo_slug) + '</div>' : '') +
          '<div class="gs-flex gs-items-center gs-gap-8" style="margin-top:4px">' +
            '<button class="gs-btn-ghost gs-text-xs like-btn ' + liked + '" data-id="' + ev.id + '" data-repo="' + escapeHtml(ev.repo_slug || "") + '">♥ ' + (ev.like_count || 0) + '</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }).join("");

  container.querySelectorAll(".like-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      doAction("like", { eventId: btn.dataset.id, repoSlug: btn.dataset.repo });
      btn.classList.toggle("liked");
    });
  });
}

doAction("ready");
