(function() {
  const vscode = acquireVsCodeApi();

  function escapeHtml(str) { if (!str) return ""; const div = document.createElement("div"); div.textContent = str; return div.innerHTML; }
  function formatCount(n) { if (!n && n !== 0) return "0"; n = Number(n); if (n >= 1000000) return (n / 1000000).toFixed(1) + "M"; if (n >= 1000) return (n / 1000).toFixed(1) + "k"; return String(n); }

  const langColors = {
    TypeScript: '#3178c6', JavaScript: '#f1e05a', Python: '#3572A5', Rust: '#dea584',
    Go: '#00ADD8', Java: '#b07219', 'C++': '#f34b7d', Ruby: '#701516', Swift: '#F05138',
    Kotlin: '#A97BFF', PHP: '#4F5D95', Shell: '#89e051', Vue: '#41b883', HTML: '#e34c26', CSS: '#563d7c',
  };

  window.addEventListener("message", function(e) {
    if (e.data.type === "setProfile") { renderProfile(e.data.payload || e.data); }
  });

  function buildMetaRow(u) {
    var items = [];
    if (u.company) items.push('<span class="pf-meta-item">\uD83C\uDFE2 ' + escapeHtml(u.company) + '</span>');
    if (u.location) items.push('<span class="pf-meta-item">\uD83D\uDCCD ' + escapeHtml(u.location) + '</span>');
    if (u.blog) {
      var href = u.blog.startsWith("http") ? u.blog : "https://" + u.blog;
      items.push('<span class="pf-meta-item">\uD83D\uDD17 <a href="' + escapeHtml(href) + '" target="_blank">' + escapeHtml(u.blog) + '</a></span>');
    }
    if (!items.length) return '';
    return '<div class="pf-meta">' + items.join('<span class="pf-meta-sep">\u00B7</span>') + '</div>';
  }

  function buildStatsRow(u) {
    var items = [];
    if (u.following !== undefined) items.push('<span class="pf-stat-item"><span class="pf-stat-num">' + formatCount(u.following) + '</span><span class="pf-stat-label">Following</span></span>');
    if (u.followers !== undefined) items.push('<span class="pf-stat-item"><span class="pf-stat-num">' + formatCount(u.followers) + '</span><span class="pf-stat-label">Followers</span></span>');
    if (u.public_repos !== undefined) items.push('<span class="pf-stat-item"><span class="pf-stat-num">' + formatCount(u.public_repos) + '</span><span class="pf-stat-label">Repos</span></span>');
    if (!items.length) return '';
    return '<div class="pf-stats">' + items.join('<span class="pf-stats-sep">\u00B7</span>') + '</div>';
  }

  function buildRepoCard(r, ownerLogin) {
    var owner = r.owner || ownerLogin;
    var stars = r.stars || r.stargazers_count || 0;
    var forks = r.forks || r.forks_count || 0;
    var langColor = langColors[r.language] || '#888';

    var footer = [];
    if (r.language) footer.push('<span class="pf-repo-lang"><span class="lang-dot" style="background:' + langColor + '"></span>' + escapeHtml(r.language) + '</span>');
    footer.push('<span class="pf-repo-stat">\u2605 ' + formatCount(stars) + '</span>');
    if (forks) footer.push('<span class="pf-repo-stat">\u{1F374} ' + formatCount(forks) + '</span>');

    return '<div class="pf-repo" data-owner="' + escapeHtml(owner) + '" data-name="' + escapeHtml(r.name) + '">' +
      '<span class="pf-repo-name">' + escapeHtml(owner + '/' + r.name) + '</span>' +
      (r.description ? '<p class="pf-repo-desc">' + escapeHtml(r.description) + '</p>' : '<p class="pf-repo-desc" style="margin-bottom:8px"></p>') +
      '<div class="pf-repo-footer">' + footer.join('') + '</div>' +
    '</div>';
  }

  function renderProfile(data) {
    var u = data.profile || data;
    var avatar = u.avatar_url || ("https://github.com/" + encodeURIComponent(u.login) + ".png?size=128");

    var html =
      // ── Profile card ──
      '<div class="pf-card">' +

        '<div class="pf-header">' +
          '<img src="' + escapeHtml(avatar) + '" class="pf-avatar" alt="">' +
          '<div class="pf-header-info">' +
            '<h1 class="pf-name">' + escapeHtml(u.name || u.login) + '</h1>' +
            '<span class="pf-login">@' + escapeHtml(u.login) + '</span>' +
            '<div class="pf-actions">' +
              '<button class="pf-btn pf-btn-primary" id="followBtn">Follow</button>' +
              '<button class="pf-btn pf-btn-secondary" id="messageBtn">\uD83D\uDCAC Message</button>' +
              '<button class="pf-btn pf-btn-secondary" id="githubBtn">GitHub \u2197</button>' +
            '</div>' +
          '</div>' +
        '</div>' +

        (u.bio ? '<p class="pf-bio">' + escapeHtml(u.bio) + '</p>' : '') +

        buildMetaRow(u) +
        buildStatsRow(u) +

        (u.star_power ?
          '<div class="pf-star-power"><span class="pf-star-power-icon">\u2B50</span> Star Power: ' + (Math.round(u.star_power * 10) / 10) + '</div>'
        : '') +

      '</div>' +

      // ── Top Repositories ──
      (u.top_repos && u.top_repos.length ?
        '<div class="pf-section">' +
          '<div class="pf-section-title">Top Repositories</div>' +
          u.top_repos.map(function(r) { return buildRepoCard(r, u.login); }).join("") +
        '</div>'
      : '');

    document.getElementById("content").innerHTML = html;

    // Event handlers
    document.getElementById("followBtn").addEventListener("click", function() { vscode.postMessage({ type: "follow" }); });
    document.getElementById("messageBtn").addEventListener("click", function() { vscode.postMessage({ type: "message" }); });
    document.getElementById("githubBtn").addEventListener("click", function() { vscode.postMessage({ type: "github" }); });
    document.querySelectorAll(".pf-repo").forEach(function(el) {
      el.addEventListener("click", function() {
        vscode.postMessage({ type: "viewRepo", payload: { owner: el.dataset.owner, repo: el.dataset.name } });
      });
    });
  }

  vscode.postMessage({ type: "ready" });
})();
