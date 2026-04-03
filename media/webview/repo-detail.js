(function () {
  const vscode = acquireVsCodeApi();
  window.addEventListener("message", (event) => {
    const message = event.data;
    if (message.type === "setRepo") { renderRepo(message.payload); }
  });
  function renderRepo(repo) {
    const root = document.getElementById("root");
    root.innerHTML = `
      <div class="repo-header">
        <img src="${escapeHtml(repo.avatar_url)}" alt="${escapeHtml(repo.owner + '/' + repo.name)}" />
        <div>
          <h1>${escapeHtml(repo.owner + '/' + repo.name)}</h1>
          <p class="description">${escapeHtml(repo.description || "")}</p>
        </div>
      </div>
      <div class="stats">
        <div class="stat"><div class="value">${formatCount(repo.stars)}</div><div class="label">Stars</div></div>
        <div class="stat"><div class="value">${formatCount(repo.forks)}</div><div class="label">Forks</div></div>
        <div class="stat"><div class="value">${formatCount(repo.watchers)}</div><div class="label">Watchers</div></div>
        ${repo.star_power ? `<div class="stat"><div class="value">${repo.star_power}</div><div class="label">Star Power</div></div>` : ""}
      </div>
      ${repo.topics?.length ? `<div class="topics">${repo.topics.map(t => `<span class="topic">${escapeHtml(t)}</span>`).join("")}</div>` : ""}
      <div class="actions">
        <button onclick="doAction('star')">⭐ Star</button>
        <button class="secondary" onclick="doAction('github')">Open on GitHub</button>
      </div>
      ${repo.contributors?.length ? `
        <div class="contributors"><h3>Top Contributors</h3>
          ${repo.contributors.slice(0, 10).map(c => `
            <div class="contributor">
              <img src="${escapeHtml(c.avatar_url)}" alt="${escapeHtml(c.login)}" />
              <span>${escapeHtml(c.login)}</span>
              <span style="color: var(--vscode-descriptionForeground)">${c.contributions} commits</span>
            </div>`).join("")}
        </div>` : ""}
      ${repo.readme_html ? `<div class="readme">${repo.readme_html}</div>` : ""}`;
  }
  function doAction(action) { vscode.postMessage({ type: action }); }
  function escapeHtml(str) { const div = document.createElement("div"); div.textContent = str; return div.innerHTML; }
  function formatCount(n) { if (n >= 1000000) return (n/1000000).toFixed(1)+"M"; if (n >= 1000) return (n/1000).toFixed(1)+"k"; return String(n); }
  vscode.postMessage({ type: "ready" });
})();
