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

  function renderProfile(data) {
    var u = data.profile || data;
    var avatar = u.avatar_url || ("https://github.com/" + encodeURIComponent(u.login) + ".png?size=128");

    document.getElementById("content").innerHTML =
      // Header
      '<div class="pf-header">' +
        '<img src="' + escapeHtml(avatar) + '" class="pf-avatar" alt="">' +
        '<div class="pf-header-info">' +
          '<h1 class="pf-name">' + escapeHtml(u.name || u.login) + '</h1>' +
          '<span class="pf-login">@' + escapeHtml(u.login) + '</span>' +
        '</div>' +
      '</div>' +

      // Bio
      (u.bio ? '<p class="pf-bio">' + escapeHtml(u.bio) + '</p>' : '') +

      // Meta (company, location, blog)
      '<div class="pf-meta">' +
        (u.company ? '<span class="pf-meta-item">\uD83C\uDFE2 ' + escapeHtml(u.company) + '</span>' : '') +
        (u.location ? '<span class="pf-meta-item">\uD83D\uDCCD ' + escapeHtml(u.location) + '</span>' : '') +
        (u.blog ? '<span class="pf-meta-item">\uD83D\uDD17 <a href="' + escapeHtml(u.blog.startsWith("http") ? u.blog : "https://" + u.blog) + '" target="_blank">' + escapeHtml(u.blog) + '</a></span>' : '') +
      '</div>' +

      // Stats
      '<div class="pf-stats">' +
        '<div class="pf-stat"><span class="pf-stat-num">' + formatCount(u.followers) + '</span><span class="pf-stat-label">Followers</span></div>' +
        '<div class="pf-stat"><span class="pf-stat-num">' + formatCount(u.following) + '</span><span class="pf-stat-label">Following</span></div>' +
        '<div class="pf-stat"><span class="pf-stat-num">' + formatCount(u.public_repos) + '</span><span class="pf-stat-label">Repos</span></div>' +
        (u.star_power ? '<div class="pf-stat"><span class="pf-stat-num">' + Math.round(u.star_power * 10) / 10 + '</span><span class="pf-stat-label">Star Power</span></div>' : '') +
      '</div>' +

      // Action buttons
      '<div class="pf-actions">' +
        '<button class="pf-btn pf-btn-primary" id="followBtn">Follow</button>' +
        '<button class="pf-btn pf-btn-secondary" id="messageBtn">\uD83D\uDCAC Message</button>' +
        '<button class="pf-btn pf-btn-secondary" id="githubBtn">GitHub \u2197</button>' +
      '</div>' +

      // Top Repos
      (u.top_repos && u.top_repos.length ?
        '<div class="pf-section">' +
          '<h2 class="pf-section-title">Top Repositories</h2>' +
          u.top_repos.map(function(r) {
            var langColor = langColors[r.language] || '#888';
            return '<div class="pf-repo" data-owner="' + escapeHtml(r.owner || u.login) + '" data-name="' + escapeHtml(r.name) + '">' +
              '<div class="pf-repo-header">' +
                '<span class="pf-repo-name">' + escapeHtml((r.owner || u.login) + '/' + r.name) + '</span>' +
                '<span class="pf-repo-stars">&#11088; ' + formatCount(r.stars || r.stargazers_count || 0) + '</span>' +
              '</div>' +
              (r.description ? '<p class="pf-repo-desc">' + escapeHtml(r.description) + '</p>' : '') +
              '<div class="pf-repo-meta">' +
                (r.language ? '<span class="pf-repo-lang"><span class="lang-dot" style="background:' + langColor + '"></span>' + escapeHtml(r.language) + '</span>' : '') +
                '<span>&#11088; ' + formatCount(r.stars || 0) + '</span>' +
                (r.forks ? '<span>\uD83C\uDF74 ' + formatCount(r.forks) + '</span>' : '') +
              '</div>' +
            '</div>';
          }).join("") +
        '</div>'
      : '');

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
