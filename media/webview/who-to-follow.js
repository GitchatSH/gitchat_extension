// who-to-follow.js
let suggestions = [];
let hoverTimeout = null;

window.addEventListener("message", (e) => {
  const data = e.data;
  if (data.type === "setSuggestions") {
    suggestions = data.suggestions || [];
    render();
  } else if (data.type === "setPreview") {
    showHoverCard(data.login, data.preview);
  } else if (data.type === "followChanged" && data.following) {
    // Another component followed this user — update button
    var btn = document.querySelector('.follow-btn[data-login="' + CSS.escape(data.login) + '"]');
    if (btn) { btn.textContent = "Following"; btn.disabled = true; btn.classList.remove("gs-btn-primary"); btn.classList.add("gs-btn-secondary"); }
  }
});

function render() {
  const container = document.getElementById("suggestions");
  const empty = document.getElementById("empty");

  if (!suggestions.length) {
    container.innerHTML = "";
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";

  container.innerHTML = suggestions.slice(0, 10).map(s => {
    const avatar = s.avatar_url || avatarUrl(s.login);
    const reason = s.reason || "";
    return '<div class="gs-list-item suggestion-item" data-login="' + escapeHtml(s.login) + '">' +
      '<img src="' + escapeHtml(avatar) + '" class="gs-avatar gs-avatar-md" alt="">' +
      '<div class="gs-flex-1" style="min-width:0">' +
        '<div class="gs-truncate" style="font-weight:500">@' + escapeHtml(s.login) + '</div>' +
        (reason ? '<div class="gs-text-xs gs-text-muted gs-truncate">' + escapeHtml(reason) + '</div>' : '') +
      '</div>' +
      '<button class="gs-btn-icon dm-btn" data-login="' + escapeHtml(s.login) + '" title="Message"><span class="codicon codicon-mail"></span></button>' +
      '<button class="gs-btn gs-btn-primary follow-btn" data-login="' + escapeHtml(s.login) + '">Follow</button>' +
    '</div>';
  }).join("");

  // Click handlers
  container.querySelectorAll(".suggestion-item").forEach(el => {
    el.addEventListener("click", (e) => {
      if (e.target.closest(".dm-btn") || e.target.closest(".follow-btn")) return;
      doAction("viewProfile", { login: el.dataset.login });
    });
    el.addEventListener("mouseenter", () => {
      const login = el.dataset.login;
      hoverTimeout = setTimeout(() => {
        doAction("getPreview", { login });
      }, 500);
    });
    el.addEventListener("mouseleave", () => {
      clearTimeout(hoverTimeout);
      hideHoverCard();
    });
  });
  container.querySelectorAll(".dm-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      doAction("message", { login: btn.dataset.login });
    });
  });
  container.querySelectorAll(".follow-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      doAction("follow", { login: btn.dataset.login });
      btn.textContent = "Following";
      btn.disabled = true;
      btn.classList.remove("gs-btn-primary");
      btn.classList.add("gs-btn-secondary");
    });
  });
}

function showHoverCard(login, preview) {
  if (!preview) return;
  const card = document.getElementById("hover-card");
  const item = document.querySelector('.suggestion-item[data-login="' + CSS.escape(login) + '"]');
  if (!item || !card) return;

  const avatar = preview.avatar_url || avatarUrl(login, 120);
  card.innerHTML =
    '<div class="gs-flex gs-gap-8 gs-items-center" style="margin-bottom:8px">' +
      '<img src="' + escapeHtml(avatar) + '" class="gs-avatar gs-avatar-lg" alt="">' +
      '<div class="gs-flex-1">' +
        '<div style="font-weight:600">' + escapeHtml(preview.name || login) + '</div>' +
        '<div class="gs-text-sm gs-text-muted">@' + escapeHtml(login) + '</div>' +
      '</div>' +
    '</div>' +
    (preview.bio ? '<div class="gs-text-sm" style="margin-bottom:8px">' + escapeHtml(preview.bio) + '</div>' : '') +
    '<div class="gs-text-xs gs-text-muted">' +
      '<strong>' + formatCount(preview.following || 0) + '</strong> Following  ' +
      '<strong>' + formatCount(preview.followers || 0) + '</strong> Followers' +
    '</div>';

  const rect = item.getBoundingClientRect();
  card.style.top = rect.top + "px";
  card.style.left = (rect.right + 8) + "px";
  card.classList.add("visible");
}

function hideHoverCard() {
  const card = document.getElementById("hover-card");
  if (card) card.classList.remove("visible");
}

doAction("ready");
