// feed.js — For You feed
let events = [];
let activeFilter = "all";

const eventIcons = {
  "trending": "🔥",
  "release": "📦",
  "pr-merged": "🔀",
  "notable-star": "⭐"
};

const eventLabels = {
  "trending": "Trending",
  "release": "New Release",
  "pr-merged": "PR Merged",
  "notable-star": "Notable Star"
};

// Filter chips
document.querySelectorAll(".feed-chip").forEach(function(chip) {
  chip.addEventListener("click", function() {
    document.querySelectorAll(".feed-chip").forEach(function(c) { c.classList.remove("active"); });
    chip.classList.add("active");
    activeFilter = chip.dataset.filter;
    render();
  });
});

document.getElementById("load-more").addEventListener("click", function() {
  doAction("loadMore");
  var btn = document.getElementById("load-more");
  btn.textContent = "Loading...";
  btn.disabled = true;
});

window.addEventListener("message", function(e) {
  var data = e.data;
  if (data.type === "setEvents") {
    if (data.replace) { events = data.events || []; }
    else { events = events.concat(data.events || []); }
    render();
    var btn = document.getElementById("load-more");
    btn.textContent = "Load more";
    btn.disabled = false;
    btn.style.display = data.hasMore ? "block" : "none";
  }
});

function render() {
  var container = document.getElementById("events");
  var empty = document.getElementById("empty");
  var filtered = activeFilter === "all" ? events : events.filter(function(ev) { return ev.type === activeFilter; });
  if (!filtered.length) {
    container.innerHTML = "";
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";

  container.innerHTML = filtered.map(renderEvent).join("");

  // Click handlers for repo links
  container.querySelectorAll(".feed-repo-link").forEach(function(el) {
    el.addEventListener("click", function() {
      doAction("viewRepo", { owner: el.dataset.owner, repo: el.dataset.repo });
    });
  });
  container.querySelectorAll(".feed-actor-link").forEach(function(el) {
    el.addEventListener("click", function() {
      doAction("viewProfile", { login: el.dataset.login });
    });
  });
}

function renderEvent(ev) {
  var type = ev.type || "trending";
  var icon = eventIcons[type] || "📋";
  var label = eventLabels[type] || type;
  var repo = ev.repo || {};
  var actor = ev.actor || null;
  var narration = ev.narration || {};
  var time = timeAgo(ev.timestamp);
  var repoSlug = (repo.owner || "") + "/" + (repo.name || "");
  var repoAvatar = repo.avatar_url || avatarUrl(repo.owner || "github");

  // Type-specific details
  var detail = "";
  if (type === "trending" && ev.trending) {
    detail = '<span class="feed-detail-badge feed-trending">🔥 +' + formatCount(ev.trending.stars_this_week) + ' stars this week</span>';
  } else if (type === "release" && ev.release) {
    detail = '<span class="feed-detail-badge feed-release">📦 ' + escapeHtml(ev.release.tag || "") + '</span>';
  } else if (type === "pr-merged" && ev.prMerged) {
    detail = '<span class="feed-detail-badge feed-pr">🔀 +' + (ev.prMerged.additions || 0) + ' -' + (ev.prMerged.deletions || 0) + '</span>';
  } else if (type === "notable-star" && ev.notableStar) {
    detail = '<span class="feed-detail-badge feed-star">⭐ ' + formatCount(ev.notableStar.actor_followers) + ' followers</span>';
  }

  // Actor line
  var actorHtml = "";
  if (actor && actor.login) {
    var actorAvatar = actor.avatar_url || avatarUrl(actor.login);
    actorHtml = '<div class="feed-actor">' +
      '<img src="' + escapeHtml(actorAvatar) + '" class="feed-actor-avatar" alt="">' +
      '<a class="feed-actor-link" href="#" data-login="' + escapeHtml(actor.login) + '">' + escapeHtml(actor.login) + '</a>' +
      (type === "notable-star" && actor.followers > 100 ? ' <span class="feed-actor-followers">' + formatCount(actor.followers) + ' followers</span>' : '') +
    '</div>';
  }

  // Narration
  var narrationHtml = "";
  if (narration.body) {
    narrationHtml = '<div class="feed-narration">' + escapeHtml(narration.body) + '</div>';
  }

  // Event description (PR title, release notes preview, etc.)
  var descHtml = "";
  if (type === "pr-merged" && ev.prMerged && ev.prMerged.title) {
    descHtml = '<div class="feed-event-desc">🔀 ' + escapeHtml(ev.prMerged.title) + '</div>';
  } else if (type === "release" && ev.release && ev.release.body) {
    descHtml = '<div class="feed-event-desc">' + escapeHtml(ev.release.body.slice(0, 150)) + (ev.release.body.length > 150 ? "..." : "") + '</div>';
  } else if (narration.event_description) {
    descHtml = '<div class="feed-event-desc">' + escapeHtml(narration.event_description.slice(0, 150)) + '</div>';
  }

  return '<div class="feed-event">' +
    '<div class="feed-event-header">' +
      '<span class="feed-type-label">' + icon + ' ' + escapeHtml(label) + '</span>' +
      '<span class="feed-time">' + time + '</span>' +
    '</div>' +
    '<div class="feed-repo feed-repo-link" data-owner="' + escapeHtml(repo.owner || "") + '" data-repo="' + escapeHtml(repo.name || "") + '">' +
      '<img src="' + escapeHtml(repoAvatar) + '" class="feed-repo-avatar" alt="">' +
      '<div class="feed-repo-info">' +
        '<span class="feed-repo-name">' + escapeHtml(repoSlug) + '</span>' +
        (repo.description ? '<span class="feed-repo-desc">' + escapeHtml(repo.description.slice(0, 100)) + '</span>' : '') +
        '<div class="feed-repo-meta">' +
          '<span>⭐ ' + formatCount(repo.stars || 0) + '</span>' +
          (repo.language ? '<span>· ' + escapeHtml(repo.language) + '</span>' : '') +
          ' ' + detail +
        '</div>' +
      '</div>' +
    '</div>' +
    actorHtml +
    descHtml +
    narrationHtml +
  '</div>';
}

doAction("ready");
