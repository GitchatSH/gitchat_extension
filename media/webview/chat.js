(function () {
  const vscode = acquireVsCodeApi();
  let currentUser = "";
  let typingTimeout = null;
  let friendsList = [];
  let isGroup = false;
  let membersVisible = false;
  let otherReadAt = null;
  let groupMembersList = []; // { login, name, avatar_url }
  let replyingTo = null; // { id, sender, text }

  window.addEventListener("message", (event) => {
    const msg = event.data;
    switch (msg.type) {
      case "init":
        currentUser = msg.payload.currentUser;
        friendsList = msg.payload.friends || [];
        isGroup = msg.payload.isGroup || false;
        otherReadAt = msg.payload.otherReadAt || null;
        groupMembersList = msg.payload.groupMembers || [];
        renderHeader(msg.payload.participant, msg.payload.isGroup, msg.payload.participants);
        renderMessages(msg.payload.messages);
        if (msg.payload.hasMore) { addLoadMoreButton(); }
        // members dropdown starts hidden, toggled via header click
        break;
      case "newMessage": appendMessage(msg.payload); break;
      case "typing": showTyping(msg.payload.user); break;
      case "presence": updatePresence(msg.payload.online); break;
      case "members": renderMembers(msg.members, msg.currentUser); break;
      case "messageEdited": {
        const el = document.querySelector('[data-msg-id-block="' + msg.messageId + '"] .msg-text');
        if (el) { el.innerHTML = highlightMentions(escapeHtml(msg.body)); }
        const meta = document.querySelector('[data-msg-id-block="' + msg.messageId + '"] .meta');
        if (meta && !meta.textContent.includes('edited')) { meta.insertAdjacentHTML('beforeend', ' (edited)'); }
        break;
      }
      case "messageRemoved": {
        const el = document.querySelector('[data-msg-id-block="' + msg.messageId + '"]');
        if (el) { el.remove(); }
        break;
      }
      case "olderMessages": {
        const btn = document.querySelector(".load-more-btn");
        if (btn) { btn.remove(); }
        const container = document.getElementById("messages");
        const scrollHeight = container.scrollHeight;
        const html = (msg.messages || []).map(renderMessage).join("");
        if (html) { container.insertAdjacentHTML("afterbegin", html); }
        container.scrollTop = container.scrollHeight - scrollHeight;
        if (msg.hasMore) { addLoadMoreButton(); }
        break;
      }
    }
  });

  function renderHeader(participant, isGroup, participants) {
    const header = document.getElementById("header");
    if (isGroup) {
      const memberCount = (participants && participants.length) || 0;
      header.innerHTML = `<span class="name">\u{1F465} ${escapeHtml(participant.name || participant.login)}</span>` +
        `<span class="status members-toggle" id="membersToggleInline" title="Show members">${memberCount} members ▾</span>`;
      document.getElementById("membersToggleInline").addEventListener("click", function() {
        membersVisible = !membersVisible;
        var dd = document.getElementById("membersDropdown");
        if (membersVisible) {
          dd.style.display = "block";
          vscode.postMessage({ type: "getMembers" });
        } else {
          dd.style.display = "none";
        }
      });
    } else {
      const dot = participant.online ? "online-dot" : "offline-dot";
      const login = escapeHtml(participant.login);
      const name = escapeHtml(participant.name || participant.login);
      header.innerHTML = `<span class="${dot}"></span><a class="name profile-link" href="#" data-login="${login}" title="View profile">${name}</a><span class="status">@${login}</span>`;
    }
    header.querySelectorAll(".profile-link").forEach(function(link) {
      link.addEventListener("click", function(e) {
        e.preventDefault();
        vscode.postMessage({ type: "viewProfile", payload: { login: link.dataset.login } });
      });
    });
  }

  function addLoadMoreButton() {
    const existing = document.querySelector(".load-more-btn");
    if (existing) { existing.remove(); }
    const btn = document.createElement("button");
    btn.className = "load-more-btn";
    btn.textContent = "Load earlier messages";
    btn.onclick = () => {
      vscode.postMessage({ type: "loadMore" });
      btn.textContent = "Loading...";
      btn.disabled = true;
    };
    const container = document.getElementById("messages");
    if (container) { container.prepend(btn); }
  }

  function renderMessages(messages) {
    const container = document.getElementById("messages");
    container.innerHTML = messages.map(renderMessage).join("");
    container.scrollTop = container.scrollHeight;
    bindSenderClicks(container);
  }

  function appendMessage(message) {
    const container = document.getElementById("messages");
    container.insertAdjacentHTML("beforeend", renderMessage(message));
    container.scrollTop = container.scrollHeight;
    hideTyping();
    bindSenderClicks(container);
  }

  function bindSenderClicks(container) {
    container.querySelectorAll(".msg-sender").forEach(function(el) {
      if (el.dataset.bound) return;
      el.dataset.bound = "1";
      el.addEventListener("click", function() {
        vscode.postMessage({ type: "viewProfile", payload: { login: el.dataset.login } });
      });
    });
  }

  function renderMessage(msg) {
    const sender = msg.sender_login || msg.sender || "";
    const isMe = sender === currentUser;
    const cls = isMe ? "outgoing" : "incoming";
    const time = new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const text = msg.body || msg.content || "";

    // System messages
    if (msg.type === "system") {
      return '<div class="message system-msg"><div class="system-text">' + escapeHtml(text) + '</div></div>';
    }

    // Sender name for incoming
    const senderHtml = (!isMe && (isGroup || sender)) ?
      '<div class="msg-sender" data-login="' + escapeHtml(sender) + '">@' + escapeHtml(sender) + '</div>' : "";

    // Reply preview
    let replyHtml = "";
    if (msg.reply_to_id && msg.reply) {
      const replyText = msg.reply.body || msg.reply.content || "";
      const replySender = msg.reply.sender_login || msg.reply.sender || "";
      replyHtml = '<div class="reply-preview"><span class="reply-sender">@' + escapeHtml(replySender) + '</span> ' + escapeHtml(replyText.slice(0, 100)) + '</div>';
    }

    const attachments = (msg.attachments || []).map(function(a) {
      if (a.mime_type && a.mime_type.startsWith("image/")) {
        return '<img src="' + escapeHtml(a.url) + '" alt="' + escapeHtml(a.filename || 'image') + '" class="attachment-img chat-attachment-img" data-url="' + escapeHtml(a.url) + '" style="max-width:300px;max-height:300px;border-radius:8px;margin:4px 0;cursor:pointer;" />';
      }
      return '<a href="' + escapeHtml(a.url) + '" class="attachment-file">' + escapeHtml(a.filename || 'attachment') + '</a>';
    }).join("");

    const reactions = (msg.reactions || []).map(function(r) {
      return '<span class="reaction" data-msg-id="' + escapeHtml(String(msg.id)) + '" data-emoji="' + escapeHtml(r.emoji) + '">' + escapeHtml(r.emoji) + (r.count > 1 ? " " + r.count : "") + '</span>';
    }).join("");

    const textHtml = text ? '<div class="msg-text">' + highlightMentions(escapeHtml(text)) + '</div>' : "";

    // Seen status
    let statusIcon = "";
    if (isMe) {
      const isSeen = otherReadAt && msg.created_at && msg.created_at <= otherReadAt;
      statusIcon = isSeen ? '<span class="msg-status seen" title="Seen">✓✓</span>' : '<span class="msg-status sent" title="Sent">✓</span>';
    }

    // Hover action buttons
    const actions = '<div class="msg-actions">' +
      '<button class="msg-action-btn" data-action="reply" title="Reply">↩</button>' +
      '<button class="msg-action-btn" data-action="react" title="React">😊</button>' +
      (isMe ? '<button class="msg-action-btn" data-action="more" title="More">⋯</button>' : '<button class="msg-action-btn" data-action="pin" title="Pin">📌</button>') +
      '</div>';

    return '<div class="message ' + cls + '" data-msg-id-block="' + escapeHtml(String(msg.id)) + '" data-sender="' + escapeHtml(sender) + '">' +
      actions + senderHtml + replyHtml + textHtml + attachments +
      (reactions ? '<div class="reactions">' + reactions + '</div>' : '') +
      '<div class="meta">' + time + (msg.edited_at ? " (edited)" : "") + ' ' + statusIcon + '</div>' +
    '</div>';
  }

  function showTyping(user) {
    const el = document.getElementById("typing");
    if (!el) return;
    el.innerHTML = '<span class="typing-dots">' + escapeHtml(user) + ' is typing<span>.</span><span>.</span><span>.</span></span>';
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(hideTyping, 5000);
  }
  function hideTyping() { const el = document.getElementById("typing"); if (el) el.innerHTML = ""; }
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
    if (replyingTo) {
      vscode.postMessage({ type: "reply", payload: { content: content, replyToId: replyingTo.id } });
      cancelReply();
    } else {
      vscode.postMessage({ type: "send", payload: { content } });
    }
    input.value = "";
  }

  document.addEventListener("click", function(e) {
    var reaction = e.target.closest(".reaction");
    if (reaction) {
      var msgId = reaction.dataset.msgId;
      var emoji = reaction.dataset.emoji;
      if (msgId && emoji) {
        // Toggle: if already reacted, remove; otherwise add
        if (reaction.classList.contains("reaction-mine")) {
          vscode.postMessage({ type: "removeReaction", payload: { messageId: msgId, emoji: emoji } });
          reaction.classList.remove("reaction-mine");
        } else {
          vscode.postMessage({ type: "react", payload: { messageId: msgId, emoji: emoji } });
          reaction.classList.add("reaction-mine");
        }
      }
    }
  });

  document.addEventListener("click", (e) => {
    const img = e.target.closest(".chat-attachment-img");
    if (img && img.dataset.url) {
      if (img.dataset.url.startsWith("https://")) {
        window.open(img.dataset.url);
      }
    }
  });

  function escapeHtml(str) { if (!str) return ""; const div = document.createElement("div"); div.textContent = str; return div.innerHTML; }

  function highlightMentions(html) {
    return html.replace(/@([a-zA-Z0-9_-]+)/g, '<span class="mention">@$1</span>');
  }

  // ========== @Mention Autocomplete ==========
  let mentionActive = false;
  let mentionQuery = "";
  let mentionStartPos = -1;
  let mentionUsers = [];
  let mentionSelectedIndex = 0;
  let mentionDebounce = null;

  const mentionDropdown = document.createElement("div");
  mentionDropdown.className = "mention-dropdown";
  mentionDropdown.style.display = "none";
  document.querySelector(".chat-input").style.position = "relative";
  document.querySelector(".chat-input").appendChild(mentionDropdown);

  input.addEventListener("input", function() {
    const val = input.value;
    const cursorPos = input.selectionStart || 0;

    // Find @ before cursor
    const textBeforeCursor = val.slice(0, cursorPos);
    const atIndex = textBeforeCursor.lastIndexOf("@");

    if (atIndex >= 0) {
      const charBefore = atIndex > 0 ? textBeforeCursor[atIndex - 1] : " ";
      if (charBefore === " " || charBefore === "\n" || atIndex === 0) {
        const query = textBeforeCursor.slice(atIndex + 1);
        if (query.length >= 0 && !query.includes(" ")) {
          mentionActive = true;
          mentionStartPos = atIndex;
          mentionQuery = query;
          mentionSelectedIndex = 0;

          clearTimeout(mentionDebounce);
          if (query.length >= 1) {
            // In groups: prioritize group members; in DMs: prioritize friends
            var searchPool = isGroup ? groupMembersList : friendsList;
            var localMatches = searchPool
              .filter(function(f) {
                return f.login !== currentUser && (
                  f.login.toLowerCase().includes(query.toLowerCase()) ||
                  (f.name && f.name.toLowerCase().includes(query.toLowerCase()))
                );
              })
              .sort(function(a, b) {
                if (a.online && !b.online) return -1;
                if (!a.online && b.online) return 1;
                return (b.lastSeen || 0) - (a.lastSeen || 0);
              })
              .map(function(f) {
                return { login: f.login, name: f.name, avatar_url: f.avatar_url, isFriend: true, online: f.online };
              });

            if (localMatches.length > 0) {
              mentionUsers = localMatches;
              mentionSelectedIndex = 0;
              renderMentionDropdown();
              mentionDropdown.style.display = "block";
            }

            // Only call API search for DMs (not groups — groups use local member list only)
            if (!isGroup) {
              mentionDebounce = setTimeout(function() {
                vscode.postMessage({ type: "searchUsers", payload: { query: query } });
              }, 300);
            }
          } else {
            // Show all members/friends when just "@" is typed
            var pool = isGroup ? groupMembersList : friendsList;
            var topFriends = pool
              .filter(function(f) { return f.login !== currentUser; })
              .map(function(f) {
                return { login: f.login, name: f.name, avatar_url: f.avatar_url, isFriend: true, online: f.online };
              });
            if (topFriends.length > 0) {
              mentionUsers = topFriends;
              mentionSelectedIndex = 0;
              renderMentionDropdown();
              mentionDropdown.style.display = "block";
            } else {
              mentionDropdown.style.display = "none";
            }
          }
          return;
        }
      }
    }

    hideMentionDropdown();
  });

  input.addEventListener("keydown", function(e) {
    if (!mentionActive || mentionDropdown.style.display === "none") { return; }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      mentionSelectedIndex = Math.min(mentionSelectedIndex + 1, mentionUsers.length - 1);
      renderMentionDropdown();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      mentionSelectedIndex = Math.max(mentionSelectedIndex - 1, 0);
      renderMentionDropdown();
    } else if (e.key === "Enter" || e.key === "Tab") {
      if (mentionUsers.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        insertMention(mentionUsers[mentionSelectedIndex]);
      }
    } else if (e.key === "Escape") {
      hideMentionDropdown();
    }
  });

  window.addEventListener("message", function(event) {
    if (event.data.type === "mentionSuggestions") {
      var apiUsers = event.data.users || [];
      // Merge: keep existing friend matches on top, add API results that aren't already shown
      var existingLogins = {};
      mentionUsers.forEach(function(u) { existingLogins[u.login] = true; });
      var newUsers = apiUsers.filter(function(u) { return !existingLogins[u.login]; })
        .map(function(u) { return { login: u.login, name: u.name, avatar_url: u.avatar_url, isFriend: false, online: false }; });
      mentionUsers = mentionUsers.concat(newUsers);
      mentionSelectedIndex = 0;
      if (mentionActive && mentionUsers.length > 0) {
        renderMentionDropdown();
        mentionDropdown.style.display = "block";
      } else {
        mentionDropdown.style.display = "none";
      }
    }
  });

  function renderMentionDropdown() {
    mentionDropdown.innerHTML = mentionUsers.map(function(u, i) {
      var avatar = u.avatar_url || ("https://github.com/" + encodeURIComponent(u.login) + ".png?size=32");
      var selected = i === mentionSelectedIndex ? " mention-selected" : "";
      var dot = u.online ? '<span class="mention-dot mention-dot-online"></span>' : (u.isFriend ? '<span class="mention-dot mention-dot-offline"></span>' : '');
      return '<div class="mention-item' + selected + '" data-index="' + i + '">' +
        '<div style="position:relative;flex-shrink:0">' +
          '<img src="' + escapeHtml(avatar) + '" class="mention-avatar" alt="">' +
          dot +
        '</div>' +
        '<div class="mention-info">' +
          '<span class="mention-name">' + escapeHtml(u.name || u.login) + '</span>' +
          '<span class="mention-login">@' + escapeHtml(u.login) + '</span>' +
        '</div>' +
      '</div>';
    }).join("");

    mentionDropdown.querySelectorAll(".mention-item").forEach(function(el) {
      el.addEventListener("mousedown", function(e) {
        e.preventDefault();
        var idx = parseInt(el.dataset.index, 10);
        insertMention(mentionUsers[idx]);
      });
    });
  }

  function insertMention(user) {
    if (!user) { return; }
    var val = input.value;
    var before = val.slice(0, mentionStartPos);
    var after = val.slice(input.selectionStart || val.length);
    input.value = before + "@" + user.login + " " + after;
    var newPos = mentionStartPos + user.login.length + 2; // +2 for @ and space
    input.setSelectionRange(newPos, newPos);
    input.focus();
    hideMentionDropdown();
  }

  function hideMentionDropdown() {
    mentionActive = false;
    mentionUsers = [];
    mentionDropdown.style.display = "none";
  }

  // Close dropdown when clicking outside
  document.addEventListener("click", function(e) {
    if (!e.target.closest(".mention-dropdown") && !e.target.closest(".chat-input input")) {
      hideMentionDropdown();
    }
  });

  // ========== Group Members Dropdown ==========
  document.getElementById("addMemberBtn").addEventListener("click", function() {
    vscode.postMessage({ type: "addMember" });
  });

  document.getElementById("leaveBtn").addEventListener("click", function() {
    vscode.postMessage({ type: "leaveGroup" });
  });

  function renderMembers(members, me) {
    var list = document.getElementById("membersList");
    if (!members || !members.length) { list.innerHTML = '<div style="padding:8px;opacity:0.6">No members</div>'; return; }
    // Update header member count
    var toggle = document.getElementById("membersToggleInline");
    if (toggle) { toggle.textContent = members.length + " members ▾"; }
    list.innerHTML = members.map(function(m) {
      var avatar = m.avatar_url || ("https://github.com/" + encodeURIComponent(m.login) + ".png?size=32");
      var isMe = m.login === me;
      var removeBtn = !isMe ? '<button class="remove-member-btn" data-login="' + escapeHtml(m.login) + '" title="Remove">✕</button>' : '';
      return '<div class="member-item">' +
        '<img src="' + escapeHtml(avatar) + '" class="member-avatar" alt="">' +
        '<div class="member-info">' +
          '<span class="member-name">' + escapeHtml(m.name || m.login) + (isMe ? ' (you)' : '') + '</span>' +
          '<span class="member-login">@' + escapeHtml(m.login) + '</span>' +
        '</div>' +
        removeBtn +
      '</div>';
    }).join("");

    list.querySelectorAll(".remove-member-btn").forEach(function(btn) {
      btn.addEventListener("click", function() {
        vscode.postMessage({ type: "removeMember", payload: { login: btn.dataset.login } });
      });
    });

    list.querySelectorAll(".member-item").forEach(function(el) {
      el.addEventListener("click", function(e) {
        if (e.target.closest(".remove-member-btn")) return;
        var login = el.querySelector(".member-login").textContent.replace("@", "");
        vscode.postMessage({ type: "viewProfile", payload: { login: login } });
      });
    });
  }

  // ========== Message Actions ==========
  document.getElementById("messages").addEventListener("click", function(e) {
    var btn = e.target.closest(".msg-action-btn");
    if (!btn) return;
    var msgEl = btn.closest(".message");
    var msgId = msgEl ? msgEl.dataset.msgIdBlock : null;
    var sender = msgEl ? msgEl.dataset.sender : "";
    var textEl = msgEl ? msgEl.querySelector(".msg-text") : null;
    var text = textEl ? textEl.textContent : "";
    var action = btn.dataset.action;

    if (action === "reply") {
      replyingTo = { id: msgId, sender: sender, text: text.slice(0, 80) };
      showReplyBar();
    } else if (action === "react") {
      showEmojiPicker(msgId);
    } else if (action === "pin") {
      vscode.postMessage({ type: "pinMessage", payload: { messageId: msgId } });
    } else if (action === "more") {
      showMessageMenu(msgId, sender === currentUser, text);
    }
  });

  function showReplyBar() {
    var bar = document.getElementById("replyBar");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "replyBar";
      bar.className = "reply-bar";
      document.querySelector(".chat-input").before(bar);
    }
    bar.innerHTML = '<div class="reply-bar-content"><span class="reply-bar-sender">Replying to @' + escapeHtml(replyingTo.sender) + '</span><span class="reply-bar-text">' + escapeHtml(replyingTo.text) + '</span></div><button class="reply-bar-close" id="replyClose">✕</button>';
    bar.style.display = "flex";
    document.getElementById("replyClose").addEventListener("click", cancelReply);
    document.getElementById("messageInput").focus();
  }

  function cancelReply() {
    replyingTo = null;
    var bar = document.getElementById("replyBar");
    if (bar) { bar.style.display = "none"; }
  }

  function showEmojiPicker(msgId) {
    var emojis = ["👍", "❤️", "😂", "😮", "😢", "🔥", "👎", "🎉"];
    var picker = document.createElement("div");
    picker.className = "emoji-picker";
    picker.innerHTML = emojis.map(function(e) {
      return '<span class="emoji-option" data-emoji="' + e + '">' + e + '</span>';
    }).join("");
    var msgEl = document.querySelector('[data-msg-id-block="' + msgId + '"]');
    if (msgEl) {
      msgEl.style.position = "relative";
      msgEl.appendChild(picker);
    }
    picker.addEventListener("click", function(ev) {
      var emoji = ev.target.dataset.emoji;
      if (emoji) {
        vscode.postMessage({ type: "react", payload: { messageId: msgId, emoji: emoji } });
      }
      picker.remove();
    });
    setTimeout(function() { document.addEventListener("click", function handler() { picker.remove(); document.removeEventListener("click", handler); }); }, 10);
  }

  function showMessageMenu(msgId, isOwn, text) {
    var menu = document.createElement("div");
    menu.className = "msg-context-menu";
    var items = '<div class="msg-menu-item" data-action="reply">↩ Reply</div>';
    items += '<div class="msg-menu-item" data-action="pin">📌 Pin</div>';
    if (isOwn) {
      items += '<div class="msg-menu-item" data-action="edit">✏ Edit</div>';
      items += '<div class="msg-menu-item" data-action="unsend">🚫 Unsend</div>';
      items += '<div class="msg-menu-item msg-menu-danger" data-action="delete">🗑 Delete</div>';
    }
    menu.innerHTML = items;
    var msgEl = document.querySelector('[data-msg-id-block="' + msgId + '"]');
    if (msgEl) {
      msgEl.style.position = "relative";
      msgEl.appendChild(menu);
    }
    menu.addEventListener("click", function(ev) {
      var action = ev.target.closest(".msg-menu-item")?.dataset.action;
      if (!action) return;
      menu.remove();
      if (action === "reply") {
        replyingTo = { id: msgId, sender: msgEl.dataset.sender, text: text.slice(0, 80) };
        showReplyBar();
      } else if (action === "pin") {
        vscode.postMessage({ type: "pinMessage", payload: { messageId: msgId } });
      } else if (action === "edit") {
        var newText = prompt("Edit message:", text);
        if (newText !== null && newText !== text) {
          vscode.postMessage({ type: "editMessage", payload: { messageId: msgId, body: newText } });
        }
      } else if (action === "unsend") {
        vscode.postMessage({ type: "unsendMessage", payload: { messageId: msgId } });
      } else if (action === "delete") {
        vscode.postMessage({ type: "deleteMessage", payload: { messageId: msgId } });
      }
    });
    setTimeout(function() { document.addEventListener("click", function handler() { menu.remove(); document.removeEventListener("click", handler); }); }, 10);
  }

  vscode.postMessage({ type: "ready" });
})();
