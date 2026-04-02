(function () {
  const vscode = acquireVsCodeApi();
  let currentUser = "";
  let typingTimeout = null;

  window.addEventListener("message", (event) => {
    const msg = event.data;
    switch (msg.type) {
      case "init":
        currentUser = msg.payload.currentUser;
        renderHeader(msg.payload.participant);
        renderMessages(msg.payload.messages);
        break;
      case "newMessage": appendMessage(msg.payload); break;
      case "typing": showTyping(msg.payload.user); break;
      case "presence": updatePresence(msg.payload.online); break;
    }
  });

  function renderHeader(participant) {
    const header = document.getElementById("header");
    const dot = participant.online ? "online-dot" : "offline-dot";
    header.innerHTML = `<span class="${dot}"></span><span class="name">${escapeHtml(participant.name || participant.login)}</span><span class="status">@${escapeHtml(participant.login)}</span>`;
  }

  function renderMessages(messages) {
    const container = document.getElementById("messages");
    container.innerHTML = messages.map(renderMessage).join("");
    container.scrollTop = container.scrollHeight;
  }

  function appendMessage(message) {
    const container = document.getElementById("messages");
    container.insertAdjacentHTML("beforeend", renderMessage(message));
    container.scrollTop = container.scrollHeight;
    hideTyping();
  }

  function renderMessage(msg) {
    const isMe = msg.sender === currentUser;
    const cls = isMe ? "outgoing" : "incoming";
    const time = new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const reactions = (msg.reactions || []).map(r =>
      `<span class="reaction" onclick="react('${msg.id}', '${r.emoji}')">${r.emoji} ${r.count}</span>`
    ).join("");
    return `<div class="message ${cls}"><div>${escapeHtml(msg.content)}</div>${reactions ? `<div class="reactions">${reactions}</div>` : ""}<div class="meta">${time}${msg.edited_at ? " (edited)" : ""}</div></div>`;
  }

  function showTyping(user) {
    const el = document.getElementById("typing");
    el.textContent = `${user} is typing...`;
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(hideTyping, 3000);
  }
  function hideTyping() { document.getElementById("typing").textContent = ""; }
  function updatePresence(online) {
    const dots = document.querySelectorAll(".online-dot, .offline-dot");
    dots.forEach(d => d.className = online ? "online-dot" : "offline-dot");
  }

  const input = document.getElementById("messageInput");
  const sendBtn = document.getElementById("sendBtn");
  let lastTypingEmit = 0;

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    const now = Date.now();
    if (now - lastTypingEmit > 2000) { vscode.postMessage({ type: "typing" }); lastTypingEmit = now; }
  });
  sendBtn.addEventListener("click", sendMessage);

  function sendMessage() {
    const content = input.value.trim();
    if (!content) return;
    vscode.postMessage({ type: "send", payload: { content } });
    input.value = "";
  }

  window.react = function (messageId, emoji) {
    vscode.postMessage({ type: "react", payload: { messageId, emoji } });
  };

  function escapeHtml(str) { if (!str) return ""; const div = document.createElement("div"); div.textContent = str; return div.innerHTML; }
  vscode.postMessage({ type: "ready" });
})();
