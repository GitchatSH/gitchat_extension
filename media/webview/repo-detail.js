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
    var stars = repo.stars || repo.stargazers_count || 0;
    var forks = repo.forks || repo.forks_count || 0;
    var watchers = repo.watchers || repo.watchers_count || 0;
    var openIssues = repo.open_issues || repo.open_issues_count || 0;

    // Build inline stats row parts
    var statsParts = [];
    statsParts.push('<span class="rd-stat-item"><span class="rd-stat-icon">&#11088;</span> ' + formatCount(stars) + ' Stars</span>');
    statsParts.push('<span class="rd-stat-item"><span class="rd-stat-icon">&#x2387;</span> ' + formatCount(forks) + ' Forks</span>');
    if (openIssues) {
      statsParts.push('<span class="rd-stat-item"><span class="rd-stat-icon">&#9679;</span> ' + formatCount(openIssues) + ' Issues</span>');
    }
    if (repo.language) {
      statsParts.push('<span class="rd-stat-item"><span class="rd-stat-icon">&#9679;</span> ' + escapeHtml(repo.language) + '</span>');
    }
    if (repo.license && repo.license.spdx_id) {
      statsParts.push('<span class="rd-stat-item"><span class="rd-stat-icon">&#128196;</span> ' + escapeHtml(repo.license.spdx_id) + '</span>');
    }

    var statsRowHtml = statsParts.join('<span class="rd-dot">&middot;</span>');

    // Topics
    var topicsHtml = "";
    if (repo.topics && repo.topics.length) {
      topicsHtml = '<div class="rd-topics">' +
        repo.topics.map(function(t) {
          return '<span class="rd-topic">' + escapeHtml(t) + '</span>';
        }).join("") +
      '</div>';
    }

    // Contributors
    var contributorsHtml = "";
    if (repo.contributors && repo.contributors.length) {
      contributorsHtml =
        '<div class="rd-card">' +
          '<p class="rd-card-title">Top Contributors</p>' +
          '<div class="rd-contributors">' +
          repo.contributors.slice(0, 10).map(function(c) {
            var cavatar = c.avatar_url || ("https://github.com/" + encodeURIComponent(c.login) + ".png?size=64");
            var commits = c.contributions || c.commits || 0;
            return '<div class="rd-contributor">' +
              '<img src="' + escapeHtml(cavatar) + '" class="rd-contributor-avatar" alt="">' +
              '<div class="rd-contributor-info">' +
                '<span class="rd-contributor-name">' + escapeHtml(c.login) + '</span>' +
                '<span class="rd-contributor-commits">' + formatCount(commits) + ' commits</span>' +
              '</div>' +
            '</div>';
          }).join("") +
          '</div>' +
        '</div>';
    }

    document.getElementById("content").innerHTML =
      // ── Header ──────────────────────────────────────────────
      '<div class="rd-header">' +
        '<img src="' + escapeHtml(avatar) + '" class="rd-avatar" alt="">' +
        '<div class="rd-header-info">' +
          '<div class="rd-header-top">' +
            '<h1 class="rd-title">' +
              '<span class="rd-owner">' + escapeHtml(owner) + '</span>' +
              '<span class="rd-sep">/</span>' +
              '<span class="rd-repo">' + escapeHtml(name) + '</span>' +
            '</h1>' +
          '</div>' +
          (repo.description ? '<p class="rd-desc">' + escapeHtml(repo.description) + '</p>' : '') +
          '<div class="rd-stats-row">' + statsRowHtml + '</div>' +
        '</div>' +
      '</div>' +

      // ── Topics ───────────────────────────────────────────────
      topicsHtml +

      // ── Actions ──────────────────────────────────────────────
      '<div class="rd-actions">' +
        '<button class="rd-btn rd-btn-primary" id="starBtn">&#11088; Star</button>' +
        '<button class="rd-btn rd-btn-secondary" id="githubBtn">&#128279; Open on GitHub</button>' +
      '</div>' +

      // ── Contributors ─────────────────────────────────────────
      contributorsHtml +

      // ── README ───────────────────────────────────────────────
      '<div class="rd-readme-card">' +
        '<div class="rd-readme-header"><p class="rd-readme-title">README</p></div>' +
        '<div class="rd-readme-body markdown-body">' + sanitizeReadme(repo.readme_html || repo.readme || "", owner, name) + '</div>' +
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
