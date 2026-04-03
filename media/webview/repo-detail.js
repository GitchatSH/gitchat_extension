(function() {
  const vscode = acquireVsCodeApi();

  function escapeHtml(str) { if (!str) return ""; const div = document.createElement("div"); div.textContent = str; return div.innerHTML; }
  function formatCount(n) { if (!n && n !== 0) return "0"; n = Number(n); if (n >= 1000000) return (n / 1000000).toFixed(1) + "M"; if (n >= 1000) return (n / 1000).toFixed(1) + "k"; return String(n); }

  window.addEventListener("message", function(e) {
    if (e.data.type === "setRepo") { renderRepo(e.data.payload || e.data); }
  });

  function renderRepo(data) {
    var repo = data.repo || data;
    var owner = repo.owner || "";
    var name = repo.name || "";
    var avatar = repo.avatar_url || ("https://github.com/" + encodeURIComponent(owner) + ".png?size=128");
    var slug = owner + "/" + name;

    document.getElementById("content").innerHTML =
      // Header
      '<div class="rd-header">' +
        '<img src="' + escapeHtml(avatar) + '" class="rd-avatar" alt="">' +
        '<div class="rd-header-info">' +
          '<h1 class="rd-title">' + escapeHtml(slug) + '</h1>' +
          (repo.description ? '<p class="rd-desc">' + escapeHtml(repo.description) + '</p>' : '') +
        '</div>' +
      '</div>' +

      // Stats row
      '<div class="rd-stats">' +
        '<div class="rd-stat"><span class="rd-stat-num">' + formatCount(repo.stars || repo.stargazers_count || 0) + '</span><span class="rd-stat-label">Stars</span></div>' +
        '<div class="rd-stat"><span class="rd-stat-num">' + formatCount(repo.forks || repo.forks_count || 0) + '</span><span class="rd-stat-label">Forks</span></div>' +
        '<div class="rd-stat"><span class="rd-stat-num">' + formatCount(repo.watchers || repo.watchers_count || 0) + '</span><span class="rd-stat-label">Watchers</span></div>' +
        (repo.star_power ? '<div class="rd-stat"><span class="rd-stat-num">' + Math.round(repo.star_power * 10) / 10 + '</span><span class="rd-stat-label">Star Power</span></div>' : '') +
      '</div>' +

      // Topics
      (repo.topics && repo.topics.length ? '<div class="rd-topics">' + repo.topics.map(function(t) { return '<span class="rd-topic">' + escapeHtml(t) + '</span>'; }).join("") + '</div>' : '') +

      // Action buttons
      '<div class="rd-actions">' +
        '<button class="rd-btn rd-btn-primary" id="starBtn">&#11088; Star</button>' +
        '<button class="rd-btn rd-btn-secondary" id="githubBtn">Open on GitHub</button>' +
      '</div>' +

      // Contributors
      (repo.contributors && repo.contributors.length ?
        '<div class="rd-section">' +
          '<h2 class="rd-section-title">Top Contributors</h2>' +
          '<div class="rd-contributors">' +
          repo.contributors.slice(0, 10).map(function(c) {
            var cavatar = c.avatar_url || ("https://github.com/" + encodeURIComponent(c.login) + ".png?size=48");
            return '<div class="rd-contributor">' +
              '<img src="' + escapeHtml(cavatar) + '" class="rd-contributor-avatar" alt="">' +
              '<span class="rd-contributor-name">' + escapeHtml(c.login) + '</span>' +
              '<span class="rd-contributor-commits">' + (c.contributions || c.commits || 0) + ' commits</span>' +
            '</div>';
          }).join("") +
          '</div>' +
        '</div>'
      : '') +

      // README
      '<div class="rd-section">' +
        '<h2 class="rd-section-title">README</h2>' +
        '<div class="rd-readme markdown-body">' + sanitizeReadme(repo.readme_html || "", owner, name) + '</div>' +
      '</div>';

    // Button handlers
    document.getElementById("starBtn").addEventListener("click", function() {
      vscode.postMessage({ type: "star" });
    });
    document.getElementById("githubBtn").addEventListener("click", function() {
      vscode.postMessage({ type: "github" });
    });
  }

  function sanitizeReadme(html, owner, name) {
    if (!html) { return '<p class="rd-empty">No README available</p>'; }
    // Fix relative URLs
    var base = "https://raw.githubusercontent.com/" + encodeURIComponent(owner) + "/" + encodeURIComponent(name) + "/HEAD/";
    var linkBase = "https://github.com/" + encodeURIComponent(owner) + "/" + encodeURIComponent(name) + "/blob/HEAD/";

    // Fix relative image src
    html = html.replace(/src="(?!https?:\/\/|data:)([^"]+)"/g, 'src="' + base + '$1"');
    // Fix relative href
    html = html.replace(/href="(?!https?:\/\/|#|mailto:)([^"]+)"/g, 'href="' + linkBase + '$1" target="_blank"');
    // Add target blank to all links
    html = html.replace(/<a\s/g, '<a target="_blank" ');
    // Remove script tags
    html = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
    html = html.replace(/\son\w+="[^"]*"/gi, "");
    return html;
  }

  vscode.postMessage({ type: "ready" });
})();
