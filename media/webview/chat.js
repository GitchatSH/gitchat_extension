(function () {
  const vscode = acquireVsCodeApi();
  let currentUser = "";
  let typingTimeout = null;
  let friendsList = [];
  let isGroup = false;
  let isGroupCreator = false;
  let membersVisible = false;
  let otherReadAt = null;
  let groupMembersList = []; // { login, name, avatar_url }
  let replyingTo = null; // { id, sender, text }
  let isMuted = false;
  let isPinned = false;
  let createdBy = "";
  let groupMembers = [];

  window.addEventListener("message", (event) => {
    const msg = event.data;
    switch (msg.type) {
      case "init":
        currentUser = msg.payload.currentUser;
        friendsList = msg.payload.friends || [];
        isGroup = msg.payload.isGroup || false;
        isGroupCreator = msg.payload.isGroupCreator || false;
        otherReadAt = msg.payload.otherReadAt || null;
        groupMembersList = msg.payload.groupMembers || [];
        isMuted = msg.payload.isMuted || false;
        isPinned = msg.payload.isPinned || false;
        createdBy = msg.payload.createdBy || "";
        groupMembers = msg.payload.groupMembers || [];
        renderHeader(msg.payload.participant, msg.payload.isGroup, msg.payload.participants);
        renderMessages(msg.payload.messages);
        if (msg.payload.hasMore) { addLoadMoreButton(); }
        break;
      case "newMessage": appendMessage(msg.payload); break;
      case "linkPreview": renderLinkPreview(msg.msgId, msg.preview); break;
      case "typing": showTyping(msg.payload.user); break;
      case "presence": updatePresence(msg.payload.online); break;
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
      var memberCount = (participants && participants.length) || 0;
      var name = escapeHtml(participant.name || participant.login);
      header.innerHTML =
        '<div class="header-left">' +
          '<span class="name"><span class="codicon codicon-organization"></span> ' + name + '</span>' +
          '<span class="header-member-count">' + memberCount + ' members</span>' +
        '</div>' +
        '<div class="header-right">' +
          '<button class="header-icon-btn" id="menuBtn" title="Settings"><span class="codicon codicon-settings-gear"></span></button>' +
        '</div>';
    } else {
      var dot = participant.online ? "online-dot" : "offline-dot";
      var login = escapeHtml(participant.login);
      var pname = escapeHtml(participant.name || participant.login);
      header.innerHTML =
        '<div class="header-left">' +
          '<span class="' + dot + '"></span>' +
          '<a class="name profile-link" href="#" data-login="' + login + '" title="View profile">' + pname + '</a>' +
          '<span class="status">@' + login + '</span>' +
        '</div>' +
        '<div class="header-right">' +
          '<button class="header-icon-btn" id="menuBtn" title="Settings"><span class="codicon codicon-settings-gear"></span></button>' +
        '</div>';
    }
    var menuBtn = document.getElementById("menuBtn");
    if (menuBtn) {
      menuBtn.addEventListener("click", function(e) {
        e.stopPropagation();
        toggleHeaderMenu();
      });
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
    // Dedup by message id
    var seen = {};
    var unique = messages.filter(function(m) {
      if (!m.id || seen[m.id]) return false;
      seen[m.id] = true;
      return true;
    });
    const container = document.getElementById("messages");
    container.innerHTML = unique.map(renderMessage).join("");
    container.scrollTop = container.scrollHeight;
    bindSenderClicks(container);
  }

  function appendMessage(message) {
    const container = document.getElementById("messages");
    // Skip if already rendered (check by ID, or by data-msg-id attribute)
    var msgId = message.id || message.message_id;
    if (msgId && container.querySelector('[data-msg-id-block="' + msgId + '"]')) return;
    if (msgId && container.querySelector('[data-msg-id="' + msgId + '"]')) return;
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

    // Separate images from other files
    var imageAttachments = (msg.attachments || []).filter(function(a) { return a.mime_type && a.mime_type.startsWith("image/"); });
    var fileAttachments = (msg.attachments || []).filter(function(a) { return !a.mime_type || !a.mime_type.startsWith("image/"); });

    // X/Twitter-style image grid
    var attachments = "";
    if (imageAttachments.length > 0) {
      var count = imageAttachments.length;
      var gridClass = "img-grid img-grid-" + Math.min(count, 4);
      var imgs = imageAttachments.slice(0, 4).map(function(a) {
        return '<div class="img-grid-cell"><img src="' + escapeHtml(a.url) + '" alt="' + escapeHtml(a.filename || 'image') + '" class="chat-attachment-img" data-url="' + escapeHtml(a.url) + '" /></div>';
      }).join("");
      attachments += '<div class="' + gridClass + '">' + imgs + '</div>';
    }
    // Non-image files
    attachments += fileAttachments.map(function(a) {
      return '<a href="' + escapeHtml(a.url) + '" class="attachment-file">' + escapeHtml(a.filename || 'attachment') + '</a>';
    }).join("");

    // Group reactions by emoji, collect user_logins
    const reactionGroups = {};
    (msg.reactions || []).forEach(function(r) {
      var emoji = r.emoji;
      if (!reactionGroups[emoji]) { reactionGroups[emoji] = []; }
      var login = r.user_login || r.userLogin || "";
      if (login && reactionGroups[emoji].indexOf(login) === -1) {
        reactionGroups[emoji].push(login);
      }
    });

    const reactions = Object.keys(reactionGroups).map(function(emoji) {
      var users = reactionGroups[emoji];
      var isMine = users.indexOf(currentUser) >= 0;
      var avatars = users.slice(0, 3).map(function(login, i) {
        var url = "https://github.com/" + encodeURIComponent(login) + ".png?size=32";
        return '<img src="' + url + '" class="reaction-avatar" style="margin-left:' + (i > 0 ? '-6px' : '0') + ';z-index:' + (3 - i) + '" alt="@' + escapeHtml(login) + '" title="' + escapeHtml(login) + '">';
      }).join("");
      var extra = users.length > 3 ? '<span class="reaction-extra">+' + (users.length - 3) + '</span>' : '';
      return '<span class="reaction' + (isMine ? ' reaction-mine' : '') + '" data-msg-id="' + escapeHtml(String(msg.id)) + '" data-emoji="' + escapeHtml(emoji) + '">' +
        '<span class="reaction-emoji">' + escapeHtml(emoji) + '</span>' +
        '<span class="reaction-avatars">' + avatars + extra + '</span>' +
      '</span>';
    }).join("");

    const textHtml = text ? '<div class="msg-text">' + highlightMentions(escapeHtml(text)) + '</div>' : "";

    // Extract first URL for link preview (fetched after render)
    var urlMatch = text.match(/https?:\/\/[^\s]+/);
    if (urlMatch && msg.id) {
      setTimeout(function() { fetchLinkPreview(String(msg.id), urlMatch[0]); }, 100);
    }

    // Seen status
    let statusIcon = "";
    if (isMe) {
      const isSeen = otherReadAt && msg.created_at && msg.created_at <= otherReadAt;
      statusIcon = isSeen ? '<span class="msg-status seen" title="Seen">✓✓</span>' : '<span class="msg-status sent" title="Sent">✓</span>';
    }

    const actions = "";

    return '<div class="message ' + cls + '" data-msg-id-block="' + escapeHtml(String(msg.id)) + '" data-msg-id="' + escapeHtml(String(msg.id)) + '" data-sender="' + escapeHtml(sender) + '">' +
      senderHtml + replyHtml + textHtml + attachments +
      (reactions ? '<div class="reactions">' + reactions + '</div>' : '') +
      '<div class="meta">' + time + (msg.edited_at ? " (edited)" : "") + ' ' + statusIcon + '</div>' +
    '</div>';
  }

  var typingUsersMap = {}; // { login: timeoutId }

  function updateHeaderTyping() {
    var users = Object.keys(typingUsersMap);
    var el = document.querySelector(".header-typing");
    var statusEl = document.querySelector(".header-left .status");
    var memberCountEl = document.querySelector(".header-member-count");
    if (users.length === 0) {
      if (el) el.remove();
      if (statusEl) statusEl.style.display = "";
      if (memberCountEl) memberCountEl.style.display = "";
      return;
    }
    // Hide normal status/member count
    if (statusEl) statusEl.style.display = "none";
    if (memberCountEl) memberCountEl.style.display = "none";
    // Build typing text (Telegram style)
    var text;
    if (!isGroup) {
      text = "typing";
    } else if (users.length === 1) {
      text = escapeHtml(users[0]) + " is typing";
    } else if (users.length === 2) {
      text = escapeHtml(users[0]) + " and " + escapeHtml(users[1]) + " are typing";
    } else {
      text = users.length + " people are typing";
    }
    var html = '<span class="header-typing-text">' + text + '<span class="header-typing-dots"><span></span><span></span><span></span></span></span>';
    if (!el) {
      el = document.createElement("span");
      el.className = "header-typing";
      var headerLeft = document.querySelector(".header-left");
      if (headerLeft) headerLeft.appendChild(el);
    }
    el.innerHTML = html;
  }

  function showTyping(user) {
    if (typingUsersMap[user]) clearTimeout(typingUsersMap[user]);
    typingUsersMap[user] = setTimeout(function() {
      delete typingUsersMap[user];
      updateHeaderTyping();
    }, 5000);
    updateHeaderTyping();
  }
  function hideTyping() {
    typingUsersMap = {};
    updateHeaderTyping();
  }
  function updatePresence(online) {
    const dots = document.querySelectorAll(".online-dot, .offline-dot");
    dots.forEach(d => d.className = online ? "online-dot" : "offline-dot");
  }

  const input = document.getElementById("messageInput");
  const sendBtn = document.getElementById("sendBtn");
  let lastTypingEmit = 0;

  input.addEventListener("keydown", (e) => {
    // Skip sending when mention dropdown is active — let the mention handler deal with Enter/Tab
    if (e.key === "Enter" && !e.shiftKey) {
      if (mentionActive && mentionDropdown.style.display !== "none") { return; }
      e.preventDefault(); sendMessage();
    }
    const now = Date.now();
    if (now - lastTypingEmit > 2000) { vscode.postMessage({ type: "typing" }); lastTypingEmit = now; }
  });
  sendBtn.addEventListener("click", sendMessage);

  function sendMessage() {
    const content = input.value.trim();
    var uploading = pendingAttachments.filter(function(a) { return a.status === "uploading"; });
    if (uploading.length > 0) {
      vscode.postMessage({ type: "showWarning", payload: { message: "Please wait — " + uploading.length + " file(s) still uploading" } });
      return;
    }
    var readyAttachments = pendingAttachments.filter(function(a) { return a.status === "ready"; });
    if (!content && readyAttachments.length === 0) return;
    var payload = { content: content };
    if (readyAttachments.length > 0) {
      payload.attachments = readyAttachments.map(function(a) { return { type: "image", ...a.result }; });
    }
    if (replyingTo) {
      payload.replyToId = replyingTo.id;
      vscode.postMessage({ type: "reply", payload: payload });
      cancelReply();
    } else {
      vscode.postMessage({ type: "send", payload: payload });
    }
    input.value = "";
    clearAllAttachments();
  }

  // ========== Multi-Attachment System ==========
  var MAX_ATTACHMENTS = 4;
  var MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB per file
  var attachIdCounter = 0;
  var pendingAttachments = []; // [{ id, file, status: "uploading"|"ready"|"failed", result }]
  const attachPreview = document.getElementById("attachPreview");
  const attachBtn = document.getElementById("attachBtn");
  const attachMenu = document.getElementById("attachMenu");
  const attachWrapper = attachBtn && attachBtn.parentElement;

  // Attach menu — show on hover, hide on leave
  if (attachWrapper && attachMenu) {
    var hideTimeout = null;
    function showMenu() {
      clearTimeout(hideTimeout);
      attachMenu.classList.add("visible");
    }
    function scheduleHide() {
      hideTimeout = setTimeout(function() { attachMenu.classList.remove("visible"); }, 200);
    }
    attachWrapper.addEventListener("mouseenter", showMenu);
    attachWrapper.addEventListener("mouseleave", scheduleHide);
    attachMenu.addEventListener("mouseenter", showMenu);
    attachMenu.addEventListener("mouseleave", scheduleHide);

    attachMenu.querySelectorAll(".attach-menu-item").forEach(function(item) {
      item.addEventListener("click", function() {
        attachMenu.classList.remove("visible");
        var action = item.dataset.action;
        if (action === "photo") {
          vscode.postMessage({ type: "pickPhoto" });
        } else if (action === "document") {
          vscode.postMessage({ type: "pickDocument" });
        } else if (action === "code") {
          vscode.postMessage({ type: "insertCode" });
        }
      });
    });
  }

  // Fallback: click attach button directly opens file picker
  if (attachBtn) {
    attachBtn.addEventListener("click", function() {
      vscode.postMessage({ type: "pickFile" });
    });
  }

  // Paste image from clipboard — support multiple images
  input.addEventListener("paste", function(e) {
    var items = (e.clipboardData || e.originalEvent.clipboardData).items;
    var hasImage = false;
    for (var i = 0; i < items.length; i++) {
      if (items[i].type.indexOf("image") !== -1) {
        var file = items[i].getAsFile();
        if (file) {
          hasImage = true;
          uploadFile(file);
        }
      }
    }
    if (hasImage) e.preventDefault();
  });

  // Drag and drop — support multiple files
  var chatInputEl = document.querySelector(".chat-input");
  ["dragenter", "dragover"].forEach(function(evt) {
    document.body.addEventListener(evt, function(e) {
      e.preventDefault();
      if (chatInputEl) chatInputEl.classList.add("drag-over");
    });
  });
  ["dragleave", "drop"].forEach(function(evt) {
    document.body.addEventListener(evt, function(e) {
      e.preventDefault();
      if (chatInputEl) chatInputEl.classList.remove("drag-over");
    });
  });
  document.body.addEventListener("drop", function(e) {
    e.preventDefault();
    var files = e.dataTransfer.files;
    for (var i = 0; i < files.length && pendingAttachments.length < MAX_ATTACHMENTS; i++) {
      uploadFile(files[i]);
    }
  });

  function uploadFile(file) {
    if (pendingAttachments.length >= MAX_ATTACHMENTS) {
      vscode.postMessage({ type: "showWarning", payload: { message: "Maximum " + MAX_ATTACHMENTS + " attachments allowed" } });
      return;
    }
    if (file.size > 0 && file.size > MAX_FILE_SIZE) {
      vscode.postMessage({ type: "showWarning", payload: { message: "File too large (max 10MB): " + (file.name || "file") } });
      return;
    }
    var id = ++attachIdCounter;
    var entry = { id: id, file: file, status: "uploading", result: null };
    pendingAttachments.push(entry);
    renderAttachPreviews();

    var reader = new FileReader();
    reader.onload = function() {
      var base64 = reader.result.split(",")[1];
      vscode.postMessage({
        type: "upload",
        payload: {
          id: id,
          data: base64,
          filename: file.name || "pasted-image.png",
          mimeType: file.type || "application/octet-stream",
        }
      });
    };
    reader.readAsDataURL(file);
  }

  function renderAttachPreviews() {
    if (!attachPreview) return;
    if (pendingAttachments.length === 0) {
      attachPreview.innerHTML = "";
      attachPreview.style.display = "none";
      return;
    }
    attachPreview.style.display = "flex";
    attachPreview.innerHTML = pendingAttachments.map(function(a) {
      var isImage = a.file.type && a.file.type.startsWith("image/");
      var statusText = a.status === "uploading" ? "Uploading..." : a.status === "ready" ? "Ready" : "Failed";
      var statusClass = a.status === "ready" ? " attach-ready" : a.status === "failed" ? " attach-failed" : "";
      var thumbHtml;
      if (isImage && a._blobUrl) {
        thumbHtml = '<img src="' + a._blobUrl + '" class="attach-thumb" />';
      } else if (isImage) {
        a._blobUrl = URL.createObjectURL(a.file);
        thumbHtml = '<img src="' + a._blobUrl + '" class="attach-thumb" />';
      } else {
        thumbHtml = '<span class="attach-icon">📄</span>';
      }
      return '<div class="attach-preview-inner" data-attach-id="' + a.id + '">' +
        thumbHtml +
        '<span class="attach-name">' + escapeHtml(a.file.name || "file") + '</span>' +
        '<span class="attach-status' + statusClass + '">' + statusText + '</span>' +
        '<button class="attach-remove" title="Remove">✕</button>' +
      '</div>';
    }).join("");

    attachPreview.querySelectorAll(".attach-remove").forEach(function(btn) {
      btn.addEventListener("click", function() {
        var card = btn.closest(".attach-preview-inner");
        var id = parseInt(card.dataset.attachId, 10);
        removeAttachment(id);
      });
    });
  }

  function removeAttachment(id) {
    var idx = pendingAttachments.findIndex(function(a) { return a.id === id; });
    if (idx !== -1) {
      var removed = pendingAttachments.splice(idx, 1)[0];
      if (removed._blobUrl) URL.revokeObjectURL(removed._blobUrl);
    }
    renderAttachPreviews();
  }

  function clearAllAttachments() {
    pendingAttachments.forEach(function(a) {
      if (a._blobUrl) URL.revokeObjectURL(a._blobUrl);
    });
    pendingAttachments = [];
    renderAttachPreviews();
  }

  // Handle upload results from extension
  window.addEventListener("message", function(event) {
    if (event.data.type === "uploadComplete") {
      var id = event.data.id;
      var entry = pendingAttachments.find(function(a) { return a.id === id; });
      if (entry) {
        entry.status = "ready";
        entry.result = event.data.attachment;
      }
      renderAttachPreviews();
    } else if (event.data.type === "addPickedFile") {
      // Extension picked a file via dialog — create a preview entry
      var d = event.data;
      if (pendingAttachments.length < MAX_ATTACHMENTS) {
        var fakeFile = { name: d.filename, type: d.mimeType };
        pendingAttachments.push({ id: d.id, file: fakeFile, status: "uploading", result: null });
        renderAttachPreviews();
      }
    } else if (event.data.type === "uploadFailed") {
      var failId = event.data.id;
      var failEntry = pendingAttachments.find(function(a) { return a.id === failId; });
      if (failEntry) {
        failEntry.status = "failed";
      }
      renderAttachPreviews();
    } else if (event.data.type === "insertText") {
      input.value = (input.value ? input.value + "\n" : "") + event.data.text;
      input.focus();
    }
  });

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

  // Lightbox overlay with prev/next navigation
  var lightbox = document.createElement("div");
  lightbox.className = "lightbox-overlay";
  lightbox.style.display = "none";
  lightbox.innerHTML = '<div class="lightbox-backdrop"></div>' +
    '<button class="lightbox-nav lightbox-prev">\u2039</button>' +
    '<img class="lightbox-img" />' +
    '<button class="lightbox-nav lightbox-next">\u203A</button>' +
    '<button class="lightbox-close">\u2715</button>' +
    '<span class="lightbox-counter"></span>';
  document.body.appendChild(lightbox);

  var lightboxImages = [];
  var lightboxIndex = 0;
  var lightboxImg = lightbox.querySelector(".lightbox-img");
  var lightboxCounter = lightbox.querySelector(".lightbox-counter");

  function lightboxShow(idx) {
    if (idx < 0 || idx >= lightboxImages.length) return;
    lightboxIndex = idx;
    lightboxImg.src = lightboxImages[idx];
    lightboxCounter.textContent = (idx + 1) + " / " + lightboxImages.length;
    lightbox.querySelector(".lightbox-prev").style.display = idx > 0 ? "flex" : "none";
    lightbox.querySelector(".lightbox-next").style.display = idx < lightboxImages.length - 1 ? "flex" : "none";
  }

  lightbox.querySelector(".lightbox-backdrop").addEventListener("click", function() { lightbox.style.display = "none"; });
  lightbox.querySelector(".lightbox-close").addEventListener("click", function() { lightbox.style.display = "none"; });
  lightbox.querySelector(".lightbox-prev").addEventListener("click", function() { lightboxShow(lightboxIndex - 1); });
  lightbox.querySelector(".lightbox-next").addEventListener("click", function() { lightboxShow(lightboxIndex + 1); });
  document.addEventListener("keydown", function(e) {
    if (lightbox.style.display === "none") return;
    if (e.key === "Escape") lightbox.style.display = "none";
    if (e.key === "ArrowLeft") lightboxShow(lightboxIndex - 1);
    if (e.key === "ArrowRight") lightboxShow(lightboxIndex + 1);
  });

  document.addEventListener("click", (e) => {
    const img = e.target.closest(".chat-attachment-img");
    if (img && img.dataset.url) {
      // Collect all images in conversation
      lightboxImages = Array.from(document.querySelectorAll(".chat-attachment-img[data-url]")).map(function(el) { return el.dataset.url; });
      lightboxIndex = lightboxImages.indexOf(img.dataset.url);
      if (lightboxIndex === -1) lightboxIndex = 0;
      lightboxShow(lightboxIndex);
      lightbox.style.display = "flex";
    }
  });

  function escapeHtml(str) { if (!str) return ""; const div = document.createElement("div"); div.textContent = str; return div.innerHTML; }

  function highlightMentions(html) {
    // Only highlight @mentions with 3+ chars to avoid partial matches like @ak, @hu
    html = html.replace(/@([a-zA-Z0-9_-]{3,})/g, '<span class="mention">@$1</span>');
    // Convert URLs to clickable links
    html = html.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" class="msg-link">$1</a>');
    return html;
  }

  // Link preview cache to avoid duplicate fetches
  var linkPreviewCache = {};

  function fetchLinkPreview(msgId, url) {
    if (linkPreviewCache[url]) return;
    linkPreviewCache[url] = true;
    vscode.postMessage({ type: "getLinkPreview", payload: { msgId: msgId, url: url } });
  }

  function renderLinkPreview(msgId, preview) {
    var msgEl = document.querySelector('[data-msg-id-block="' + msgId + '"]');
    if (!msgEl || !preview || (!preview.title && !preview.image)) return;
    // Don't add duplicate preview
    if (msgEl.querySelector('.link-preview')) return;

    var html = '<div class="link-preview">';
    if (preview.image) {
      html += '<img src="' + escapeHtml(preview.image) + '" class="link-preview-img" alt="" />';
    }
    html += '<div class="link-preview-body">';
    if (preview.title) {
      html += '<div class="link-preview-title">' + escapeHtml(preview.title) + '</div>';
    }
    if (preview.description) {
      html += '<div class="link-preview-desc">' + escapeHtml(preview.description.length > 120 ? preview.description.slice(0, 117) + '...' : preview.description) + '</div>';
    }
    var domain = '';
    try { domain = new URL(preview.url).hostname; } catch(e) {}
    if (domain) {
      html += '<div class="link-preview-domain">🔗 ' + escapeHtml(domain) + '</div>';
    }
    html += '</div></div>';

    var textEl = msgEl.querySelector('.msg-text');
    if (textEl) {
      textEl.insertAdjacentHTML('afterend', html);
    }
  }

  // Optimistic UI: add reaction emoji to message DOM immediately
  function addReactionToMessage(msgId, emoji) {
    var msgEl = document.querySelector('[data-msg-id="' + msgId + '"]');
    if (!msgEl) return;

    var reactionsDiv = msgEl.querySelector(".reactions");
    if (!reactionsDiv) {
      reactionsDiv = document.createElement("div");
      reactionsDiv.className = "reactions";
      var meta = msgEl.querySelector(".meta");
      if (meta) { msgEl.insertBefore(reactionsDiv, meta); }
      else { msgEl.appendChild(reactionsDiv); }
    }

    // Check if emoji already exists
    var existing = reactionsDiv.querySelector('.reaction[data-emoji="' + CSS.escape(emoji) + '"]');
    if (existing) {
      // Add my avatar to the stack
      var avatarsDiv = existing.querySelector(".reaction-avatars");
      if (avatarsDiv && !avatarsDiv.querySelector('img[alt="@' + CSS.escape(currentUser) + '"]')) {
        var img = document.createElement("img");
        img.src = "https://github.com/" + encodeURIComponent(currentUser) + ".png?size=32";
        img.className = "reaction-avatar";
        img.alt = "@" + currentUser;
        img.title = currentUser;
        img.style.marginLeft = "-6px";
        img.style.zIndex = "0";
        avatarsDiv.appendChild(img);
      }
      existing.classList.add("reaction-mine");
      existing.style.transform = "scale(1.15)";
      setTimeout(function() { existing.style.transform = ""; }, 150);
    } else {
      // Create new reaction with my avatar
      var span = document.createElement("span");
      span.className = "reaction reaction-mine";
      span.dataset.msgId = msgId;
      span.dataset.emoji = emoji;
      var avatarUrl = "https://github.com/" + encodeURIComponent(currentUser) + ".png?size=32";
      span.innerHTML = '<span class="reaction-emoji">' + escapeHtml(emoji) + '</span>' +
        '<span class="reaction-avatars"><img src="' + avatarUrl + '" class="reaction-avatar" alt="@' + escapeHtml(currentUser) + '" title="' + escapeHtml(currentUser) + '"></span>';
      // Animate entrance
      span.style.transform = "scale(0)";
      span.style.transition = "transform 0.15s ease-out";
      reactionsDiv.appendChild(span);
      requestAnimationFrame(function() { span.style.transform = "scale(1)"; });
    }
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

  // ========== Group Members Dropdown (removed — now handled via Group Info Panel) ==========


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


  function showMessageMenu(msgId, isOwn, text) {
    var menu = document.createElement("div");
    menu.className = "msg-context-menu";
    var items = '<div class="msg-menu-item" data-action="reply"><span class="codicon codicon-reply"></span> Reply</div>';
    items += '<div class="msg-menu-item" data-action="pin"><span class="codicon codicon-pin"></span> Pin</div>';
    if (isOwn) {
      items += '<div class="msg-menu-item" data-action="edit"><span class="codicon codicon-edit"></span> Edit</div>';
      items += '<div class="msg-menu-item" data-action="unsend"><span class="codicon codicon-discard"></span> Unsend</div>';
      items += '<div class="msg-menu-item msg-menu-danger" data-action="delete"><span class="codicon codicon-trash"></span> Delete</div>';
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

  // ========== Compact Inline Reaction Bar ==========
  // First 5 visible, scroll for more (Telegram-style)
  const QUICK_REACTIONS = ["😄", "🔥", "👍", "❤️", "👀", "🚀", "😂", "😮", "😢", "🎉", "💯", "🤔"];
  let reactionPicker = null;
  let reactionPickerTimeout = null;
  let reactionTargetMsgId = null;

  function createReactionPicker() {
    const picker = document.createElement("div");
    picker.className = "reaction-picker";

    // Reply button + emojis + pin button
    picker.innerHTML =
      '<button class="rp-btn rp-reply" data-action="reply" title="Reply">↩</button>' +
      QUICK_REACTIONS.map(function(emoji) {
        return '<button class="rp-btn rp-emoji" data-emoji="' + emoji + '">' + emoji + '</button>';
      }).join("") +
      '<button class="rp-btn rp-pin" data-action="pin" title="Pin" style="display:none"><span class="codicon codicon-pin"></span></button>';

    picker.addEventListener("mouseenter", function() {
      clearTimeout(reactionPickerTimeout);
    });
    picker.addEventListener("mouseleave", function() {
      hideReactionPicker();
    });
    picker.addEventListener("click", function(e) {
      var btn = e.target.closest(".rp-btn");
      if (!btn || !reactionTargetMsgId) return;

      if (btn.dataset.action === "reply") {
        var msgEl = document.querySelector('[data-msg-id="' + reactionTargetMsgId + '"]');
        if (msgEl) {
          var sender = msgEl.dataset.sender || "";
          var textEl = msgEl.querySelector(".msg-text");
          var text = textEl ? textEl.textContent : "";
          startReply(reactionTargetMsgId, sender, text);
        }
        hideReactionPicker();
      } else if (btn.dataset.action === "pin") {
        vscode.postMessage({ type: "pinMessage", payload: { messageId: reactionTargetMsgId } });
        hideReactionPicker();
      } else if (btn.dataset.emoji) {
        vscode.postMessage({ type: "react", payload: { messageId: reactionTargetMsgId, emoji: btn.dataset.emoji } });
        addReactionToMessage(reactionTargetMsgId, btn.dataset.emoji);
        hideReactionPicker();
      }
    });
    return picker;
  }

  function startReply(msgId, sender, text) {
    replyingTo = { id: msgId, sender: sender, text: text };
    var replyBar = document.getElementById("replyBar");
    if (!replyBar) {
      replyBar = document.createElement("div");
      replyBar.id = "replyBar";
      replyBar.className = "reply-bar";
      document.querySelector(".chat-input").before(replyBar);
    }
    replyBar.innerHTML = '<div class="reply-bar-content"><span class="reply-bar-sender">Replying to @' + escapeHtml(sender) + '</span><span class="reply-bar-text">' + escapeHtml(text.slice(0, 50)) + '</span></div><button class="reply-bar-close" id="replyClose">✕</button>';
    replyBar.style.display = "flex";
    document.getElementById("replyClose").addEventListener("click", cancelReply);
    input.focus();
  }

  function showReactionPicker(msgEl) {
    clearTimeout(reactionPickerTimeout);
    if (!reactionPicker) {
      reactionPicker = createReactionPicker();
      document.body.appendChild(reactionPicker);
    }

    var msgId = msgEl.dataset.msgId;
    if (!msgId) return;
    reactionTargetMsgId = msgId;

    // Show/hide pin button based on group ownership
    var pinBtn = reactionPicker.querySelector(".rp-pin");
    if (pinBtn) {
      pinBtn.style.display = (isGroup && isGroupCreator) ? "inline-flex" : "none";
    }

    // Position: vertical, to the RIGHT of incoming / LEFT of outgoing (Telegram style)
    var rect = msgEl.getBoundingClientRect();
    var isOutgoing = msgEl.classList.contains("outgoing");

    reactionPicker.style.display = "flex";

    var pickerWidth = reactionPicker.offsetWidth;
    var pickerHeight = reactionPicker.offsetHeight;

    if (isOutgoing) {
      // Left of outgoing message
      reactionPicker.style.left = (rect.left - pickerWidth - 4) + "px";
    } else {
      // Right of incoming message
      reactionPicker.style.left = (rect.right + 4) + "px";
    }

    // Vertically center on message
    var top = rect.top + (rect.height / 2) - (pickerHeight / 2);
    top = Math.max(4, Math.min(top, window.innerHeight - pickerHeight - 4));
    reactionPicker.style.top = top + "px";

    // Clamp horizontal
    var left = parseInt(reactionPicker.style.left);
    if (left < 4) { reactionPicker.style.left = (rect.right + 4) + "px"; }
    if (left + pickerWidth > window.innerWidth - 4) { reactionPicker.style.left = (rect.left - pickerWidth - 4) + "px"; }
  }

  function hideReactionPicker() {
    reactionPickerTimeout = setTimeout(function() {
      if (reactionPicker) {
        reactionPicker.style.display = "none";
      }
      reactionTargetMsgId = null;
    }, 200);
  }

  // Event delegation for message hover
  var messagesContainer = document.getElementById("messages");
  messagesContainer.addEventListener("mouseover", function(e) {
    var msgEl = e.target.closest(".message");
    if (msgEl && msgEl.dataset.msgId) {
      showReactionPicker(msgEl);
    }
  });
  messagesContainer.addEventListener("mouseout", function(e) {
    var msgEl = e.target.closest(".message");
    var related = e.relatedTarget;
    if (msgEl && related && !msgEl.contains(related) && !(reactionPicker && reactionPicker.contains(related))) {
      hideReactionPicker();
    }
  });

  // ========== Header ⋮ Menu ==========
  function toggleHeaderMenu() {
    var existing = document.querySelector(".header-menu");
    if (existing) { existing.remove(); return; }

    var menu = document.createElement("div");
    menu.className = "header-menu";

    var items = [];
    if (isGroup) {
      items.push('<div class="hm-item" data-action="groupInfo"><span class="codicon codicon-organization"></span> Group info</div>');
    }
    items.push('<div class="hm-item" data-action="togglePin">' + (isPinned ? '\u{1F4CC} Unpin conversation' : '\u{1F4CC} Pin conversation') + '</div>');
    if (!isGroup) {
      items.push('<div class="hm-item" data-action="addPeople">\u{1F465} Add people</div>');
    }
    items.push('<div class="hm-item" data-action="toggleMute">' + (isMuted ? '\uD83D\uDD14 Unmute' : '\uD83D\uDD15 Mute') + '</div>');

    menu.innerHTML = items.join("");
    document.querySelector(".chat-header").appendChild(menu);

    menu.addEventListener("click", function(e) {
      var item = e.target.closest(".hm-item");
      if (!item) return;
      var action = item.dataset.action;
      if (action === "groupInfo") { vscode.postMessage({ type: "groupInfo" }); }
      else if (action === "togglePin") { vscode.postMessage({ type: "togglePin", payload: { isPinned: isPinned } }); isPinned = !isPinned; }
      else if (action === "addPeople") { vscode.postMessage({ type: "addPeople" }); }
      else if (action === "toggleMute") { vscode.postMessage({ type: "toggleMute", payload: { isMuted: isMuted } }); }
      else if (action === "leaveGroup") { vscode.postMessage({ type: "leaveGroup" }); }
      menu.remove();
    });

    setTimeout(function() {
      document.addEventListener("click", function closeMenu() {
        menu.remove();
        document.removeEventListener("click", closeMenu);
      }, { once: true });
    }, 0);
  }

  // ========== Group Info Panel ==========
  window.addEventListener("message", function(event) {
    if (event.data.type === "showGroupInfo") {
      groupMembers = event.data.members || [];
      showGroupInfoPanel();
    }
    if (event.data.type === "muteUpdated") {
      isMuted = event.data.isMuted;
    }
    if (event.data.type === "pinReverted") {
      isPinned = event.data.isPinned;
    }
    if (event.data.type === "showToast") {
      var toast = document.createElement("div");
      toast.className = "chat-toast";
      toast.textContent = event.data.text;
      document.body.appendChild(toast);
      setTimeout(function() { toast.remove(); }, 3500);
    }
    if (event.data.type === "groupSearchResults") {
      renderGroupSearchResults(event.data.users || []);
    }
  });

  function showGroupInfoPanel() {
    var existing = document.getElementById("group-info-panel");
    if (existing) { existing.remove(); }

    var panel = document.createElement("div");
    panel.id = "group-info-panel";
    panel.className = "group-info-panel";

    var isCreator = createdBy === currentUser;

    panel.innerHTML =
      '<div class="gip-header"><span class="gip-title">Group Info</span><button class="gip-close" id="gip-close">\u2715</button></div>' +
      '<div class="gip-body">' +
        '<div class="gip-group-name' + (isCreator ? ' gip-editable' : '') + '" id="gip-group-name" title="' + (isCreator ? 'Click to edit' : '') + '">\ud83d\udc65 ' + escapeHtml(document.querySelector(".name") ? document.querySelector(".name").textContent : "Group") + '</div>' +
        '<div class="gip-member-count">' + groupMembers.length + ' members</div>' +
        '<div class="gip-section">' +
          '<div class="gip-section-header"><span>MEMBERS</span>' +
          '<button class="gip-add-btn" id="gip-add-btn">+ Add Member</button>' +
          '</div>' +
          '<div id="gip-search" style="display:none;padding:8px 0"><input type="text" class="gip-search-input" id="gip-search-input" placeholder="Search users..."><div id="gip-search-results"></div></div>' +
          '<div id="gip-members">' + groupMembers.map(function(m) {
            var avatar = m.avatar_url || ("https://github.com/" + encodeURIComponent(m.login) + ".png?size=48");
            var isMe = m.login === currentUser;
            var isAdmin = m.login === createdBy;
            var removable = isCreator && !isMe && !isAdmin;
            return '<div class="gip-member gip-member-clickable" data-login="' + escapeHtml(m.login) + '" style="cursor:pointer">' +
              '<img src="' + escapeHtml(avatar) + '" class="gip-avatar" alt="">' +
              '<div class="gip-member-info">' +
                '<span class="gip-member-name">' + escapeHtml(m.name || m.login) + (isMe ? ' <span class="gip-badge">You</span>' : '') + (isAdmin ? ' <span class="gip-badge gip-badge-admin">Admin</span>' : '') + '</span>' +
                '<span class="gip-member-login">@' + escapeHtml(m.login) + '</span>' +
              '</div>' +
              (removable ? '<button class="gip-remove-btn" data-login="' + escapeHtml(m.login) + '">Remove</button>' : '') +
            '</div>';
          }).join("") + '</div>' +
        '</div>' +
        '<button class="gip-leave-btn" id="gip-leave-btn">\u21A9 Leave Group</button>' +
      '</div>';

    document.body.appendChild(panel);

    document.getElementById("gip-close").addEventListener("click", function() { panel.remove(); });
    document.getElementById("gip-leave-btn").addEventListener("click", function() {
      vscode.postMessage({ type: "leaveGroup" });
    });

    // Click-to-edit group name (creator only)
    if (isCreator) {
      var nameEl = document.getElementById("gip-group-name");
      nameEl.addEventListener("click", function() {
        var current = (document.querySelector(".name") ? document.querySelector(".name").textContent : "").trim();
        var input = document.createElement("input");
        input.type = "text";
        input.value = current;
        input.className = "gip-name-input";
        input.placeholder = "Group name";
        nameEl.innerHTML = "";
        nameEl.appendChild(input);
        input.focus();
        input.select();

        function save() {
          var newName = input.value.trim();
          if (newName && newName !== current) {
            vscode.postMessage({ type: "updateGroupName", payload: { name: newName } });
            nameEl.textContent = "\ud83d\udc65 " + newName;
          } else {
            nameEl.textContent = "\ud83d\udc65 " + current;
          }
        }
        input.addEventListener("blur", save);
        input.addEventListener("keydown", function(e) {
          if (e.key === "Enter") { e.preventDefault(); save(); }
          if (e.key === "Escape") { nameEl.textContent = "\ud83d\udc65 " + current; }
        });
      });
    }

    {
      var addBtn = document.getElementById("gip-add-btn");
      var searchDiv = document.getElementById("gip-search");
      var searchInput = document.getElementById("gip-search-input");
      var searchDebounce = null;

      addBtn.addEventListener("click", function() {
        searchDiv.style.display = searchDiv.style.display === "none" ? "block" : "none";
        if (searchDiv.style.display === "block") { searchInput.focus(); }
      });

      searchInput.addEventListener("input", function() {
        clearTimeout(searchDebounce);
        var q = searchInput.value.trim();
        if (q.length >= 1) {
          searchDebounce = setTimeout(function() {
            vscode.postMessage({ type: "searchUsersForGroup", payload: { query: q } });
          }, 300);
        } else {
          document.getElementById("gip-search-results").innerHTML = "";
        }
      });
    }

    panel.querySelectorAll(".gip-remove-btn").forEach(function(btn) {
      btn.addEventListener("click", function(e) {
        e.stopPropagation();
        vscode.postMessage({ type: "removeMember", payload: { login: btn.dataset.login } });
      });
    });

    panel.querySelectorAll(".gip-member-clickable").forEach(function(el) {
      el.addEventListener("click", function() {
        var login = el.dataset.login;
        if (login) { vscode.postMessage({ type: "viewProfile", payload: { login: login } }); }
      });
    });
  }

  function renderGroupSearchResults(users) {
    var container = document.getElementById("gip-search-results");
    if (!container) return;

    var memberLogins = {};
    groupMembers.forEach(function(m) { memberLogins[m.login] = true; });
    var filtered = users.filter(function(u) { return !memberLogins[u.login]; });

    container.innerHTML = filtered.map(function(u) {
      var avatar = u.avatar_url || ("https://github.com/" + encodeURIComponent(u.login) + ".png?size=48");
      return '<div class="gip-search-item" data-login="' + escapeHtml(u.login) + '">' +
        '<img src="' + escapeHtml(avatar) + '" class="gip-avatar" alt="">' +
        '<div class="gip-member-info"><span class="gip-member-name">' + escapeHtml(u.name || u.login) + '</span><span class="gip-member-login">@' + escapeHtml(u.login) + '</span></div>' +
      '</div>';
    }).join("");

    container.querySelectorAll(".gip-search-item").forEach(function(el) {
      el.addEventListener("click", function() {
        vscode.postMessage({ type: "addMember", payload: { login: el.dataset.login } });
        el.remove();
      });
    });
  }

  vscode.postMessage({ type: "ready" });
})();
