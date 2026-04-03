(function () {
  const vscode = acquireVsCodeApi();
  window.addEventListener("message", (event) => {
    const message = event.data;
    if (message.type === "setProfile") { renderProfile(message.payload); }
  });
  function renderProfile(profile) {
    const root = document.getElementById("root");
    root.innerHTML = `
      <div class="profile-header">
        <img src="${escapeHtml(profile.avatar_url)}" alt="${escapeHtml(profile.login)}" />
        <div><h1>${escapeHtml(profile.name || profile.login)}</h1><div class="login">@${escapeHtml(profile.login)}</div></div>
      </div>
      ${profile.bio ? `<div class="bio">${escapeHtml(profile.bio)}</div>` : ""}
      <div class="meta">
        ${profile.company ? `<span>🏢 ${escapeHtml(profile.company)}</span>` : ""}
        ${profile.location ? `<span>📍 ${escapeHtml(profile.location)}</span>` : ""}
        ${profile.blog ? `<span>🔗 ${escapeHtml(profile.blog)}</span>` : ""}
      </div>
      <div class="stats">
        <div class="stat"><div class="value">${formatCount(profile.followers)}</div><div class="label">Followers</div></div>
        <div class="stat"><div class="value">${formatCount(profile.following)}</div><div class="label">Following</div></div>
        <div class="stat"><div class="value">${formatCount(profile.public_repos)}</div><div class="label">Repos</div></div>
        ${profile.star_power ? `<div class="stat"><div class="value">${profile.star_power}</div><div class="label">Star Power</div></div>` : ""}
      </div>
      <div class="actions">
        <button onclick="doAction('follow')">Follow</button>
        <button class="secondary" onclick="doAction('message')">Message</button>
        <button class="secondary" onclick="doAction('github')">GitHub Profile</button>
      </div>
      ${profile.top_repos?.length ? `<div class="repos"><h3>Top Repositories</h3>
        ${profile.top_repos.map(r => `<div class="repo-item">
          <div class="name" onclick="doAction('viewRepo', '${escapeHtml(r.owner)}', '${escapeHtml(r.name)}')">${escapeHtml(r.owner + '/' + r.name)}</div>
          <div class="desc">${escapeHtml(r.description || "")}</div>
          <div class="meta">${r.language ? `<span>${escapeHtml(r.language)}</span>` : ""}<span>⭐ ${formatCount(r.stars)}</span></div>
        </div>`).join("")}</div>` : ""}`;
  }
  function doAction(action, arg1, arg2) { vscode.postMessage({ type: action, payload: { arg1, arg2 } }); }
  function escapeHtml(str) { if (!str) return ""; const div = document.createElement("div"); div.textContent = str; return div.innerHTML; }
  function formatCount(n) { if (!n) return "0"; if (n >= 1000000) return (n/1000000).toFixed(1)+"M"; if (n >= 1000) return (n/1000).toFixed(1)+"k"; return String(n); }
  vscode.postMessage({ type: "ready" });
})();
