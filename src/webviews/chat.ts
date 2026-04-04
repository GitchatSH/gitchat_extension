import * as vscode from "vscode";
import type { ExtensionModule, Message, WebviewMessage } from "../types";
import { apiClient } from "../api";
import { authManager } from "../auth";
import { realtimeClient } from "../realtime";
import { getNonce, getUri, log } from "../utils";

class ChatPanel {
  private static instances = new Map<string, ChatPanel>();
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];
  private _conversationId: string;
  private _recipientLogin: string | undefined;
  private _cursor: string | undefined;
  private _hasMore = true;
  private _isGroup = false;
  private _recentlySentIds = new Set<string>();

  private constructor(panel: vscode.WebviewPanel, private readonly _extensionUri: vscode.Uri, conversationId: string, recipientLogin?: string) {
    this._panel = panel;
    this._conversationId = conversationId;
    this._recipientLogin = recipientLogin;
    this._panel.webview.html = this.getHtml(this._panel.webview);
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._panel.webview.onDidReceiveMessage((msg: WebviewMessage) => this.onMessage(msg), null, this._disposables);

    const msgSub = realtimeClient.onNewMessage((message: Message) => {
      if (message.conversation_id === this._conversationId) {
        // Skip if this exact message was already appended via send response (sent from this extension)
        const msgId = (message as unknown as Record<string, string>).id;
        if (msgId && this._recentlySentIds.has(msgId)) {
          this._recentlySentIds.delete(msgId);
          return;
        }
        this._panel.webview.postMessage({ type: "newMessage", payload: message });
        // Only mark read if this chat panel is actually visible
        if (this._panel.visible) {
          apiClient.markConversationRead(this._conversationId).catch(() => {});
          import("../statusbar").then(m => m.fetchCounts(true)).catch(() => {});
        }
      }
    });
    const typingSub = realtimeClient.onTyping((data) => {
      // typing:start is room-scoped by Socket.IO, so if we receive it, it's for our conversation
      if (data.user !== authManager.login) {
        this._panel.webview.postMessage({ type: "typing", payload: { user: data.user } });
      }
    });
    const presenceSub = realtimeClient.onPresence((data) => {
      this._panel.webview.postMessage({ type: "presence", payload: data });
    });
    this._disposables.push(msgSub, typingSub, presenceSub);
  }

  static isOpen(conversationId: string): boolean {
    return ChatPanel.instances.has(conversationId);
  }

  static async show(extensionUri: vscode.Uri, conversationId: string, recipientLogin?: string): Promise<void> {
    const existing = ChatPanel.instances.get(conversationId);
    if (existing) { existing._panel.reveal(); return; }
    const panel = vscode.window.createWebviewPanel("trending.chat", recipientLogin ? `Chat: @${recipientLogin}` : "Chat", vscode.ViewColumn.One, {
      enableScripts: true, retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, "media")],
    });
    const instance = new ChatPanel(panel, extensionUri, conversationId, recipientLogin);
    ChatPanel.instances.set(conversationId, instance);
    realtimeClient.joinConversation(conversationId);
    await instance.loadData();
  }

  private async loadData(): Promise<void> {
    try {
      const result = await apiClient.getMessages(this._conversationId, 1);
      this._hasMore = result.hasMore;
      this._cursor = result.cursor;
      const messages = result.messages;
      log(`Chat loaded: convId=${this._conversationId}, messages=${messages.length}, hasMore=${result.hasMore}, sample=${JSON.stringify(messages[0] ?? {})}`);
      const currentUser = authManager.login ?? "me";

      // Use recipient login if provided, otherwise try to find from conversations
      let recipientLogin = this._recipientLogin;
      let conv: Record<string, unknown> | undefined;
      if (!recipientLogin) {
        try {
          apiClient.invalidateConversationsCache();
          const conversations = await apiClient.getConversations();
          conv = conversations.find((c) => c.id === this._conversationId) as Record<string, unknown> | undefined;
          // DM: other_user field; Group: participants array
          const otherUser = conv?.other_user as { login: string } | undefined;
          recipientLogin = otherUser?.login
            || (conv?.participants as { login: string }[] | undefined)?.find((p) => p.login !== currentUser)?.login;
        } catch { /* ignore */ }
      }

      // Detect group: check conv data or try fetching members as fallback
      let isGroup = conv?.type === "group" || conv?.is_group === true || ((conv?.participants as unknown[] | undefined)?.length ?? 0) > 2;
      let groupTitle = isGroup ? ((conv?.group_name as string) || "Group Chat") : undefined;
      if (!isGroup && !conv) {
        // Conv not in list yet (just created) — try fetching members to detect group
        try {
          const members = await apiClient.getGroupMembers(this._conversationId);
          if (members.length > 2) {
            isGroup = true;
            groupTitle = "Group Chat";
          }
        } catch { /* not a group or doesn't exist */ }
      }
      this._isGroup = isGroup;
      const isPinned = !!(conv?.pinned_at || conv?.pinned);

      recipientLogin = recipientLogin || "Unknown";
      this._panel.title = isGroup ? `Chat: \u{1F465} ${groupTitle}` : `Chat: @${recipientLogin}`;

      // Fetch group members for @mention in groups
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let groupMembers: any[] = [];
      if (isGroup) {
        try {
          groupMembers = await apiClient.getGroupMembers(this._conversationId);
        } catch { /* ignore */ }
      }

      // Friends for @mention — lazy loaded on first @ keystroke (avoid 2 API calls on open)
      const friends: { login: string; name?: string; avatar_url?: string; online?: boolean; lastSeen?: number }[] = [];

      this._panel.webview.postMessage({
        type: "init",
        payload: {
          currentUser,
          participant: isGroup
            ? { login: groupTitle, name: groupTitle, online: false }
            : { login: recipientLogin, name: recipientLogin, online: false },
          isGroup,
          isGroupCreator: isGroup && (conv?.["created_by"] as string | undefined) === authManager.login,
          participants: isGroup ? conv?.participants : undefined,
          messages,
          hasMore: this._hasMore,
          otherReadAt: result.otherReadAt,
          friends,
          groupMembers,
          isMuted: (conv as Record<string, unknown>)?.["is_muted"] || false,
          isPinned,
          createdBy: isGroup ? ((conv as Record<string, unknown>)?.["created_by"] as string || "") : "",
        },
      });
      await apiClient.markConversationRead(this._conversationId).catch(() => {});
      import("../statusbar").then(m => m.fetchCounts()).catch(() => {});
    } catch (err) { log(`Failed to load chat: ${err}`, "error"); }
  }

  private async onMessage(msg: WebviewMessage): Promise<void> {
    switch (msg.type) {
      case "send": {
        const sp = msg.payload as { content?: string; attachments?: { type: string; url: string; storage_path: string; filename?: string; mime_type?: string; size_bytes?: number }[] };
        if (sp?.content || sp?.attachments?.length) {
          try {
            const sent = await apiClient.sendMessage(this._conversationId, sp.content || "", sp.attachments);
            const sentId = (sent as unknown as Record<string, string>).id;
            if (sentId) { this._recentlySentIds.add(sentId); }
            this._panel.webview.postMessage({ type: "newMessage", payload: sent });
          } catch { vscode.window.showErrorMessage("Failed to send message"); }
        }
        break;
      }
      case "typing": realtimeClient.emitTyping(this._conversationId); break;
      case "getLinkPreview": {
        const { msgId, url } = msg.payload as { msgId: string; url: string };
        try {
          const preview = await apiClient.getLinkPreview(url);
          this._panel.webview.postMessage({ type: "linkPreview", msgId, preview });
        } catch { /* ignore - no preview available */ }
        break;
      }
      case "react": {
        const { messageId, emoji } = msg.payload as { messageId: string; emoji: string };
        try {
          await apiClient.addReaction(emoji, messageId);
        } catch {
          vscode.window.showWarningMessage("Failed to add reaction");
        }
        break;
      }
      case "loadMore": {
        if (!this._conversationId || !this._hasMore) { break; }
        try {
          const result = await apiClient.getMessages(this._conversationId, 1, this._cursor);
          this._hasMore = result.hasMore;
          this._cursor = result.cursor;
          this._panel.webview.postMessage({
            type: "olderMessages",
            messages: result.messages,
            hasMore: result.hasMore,
          });
        } catch { log("Failed to load more messages", "error"); }
        break;
      }
      case "searchUsers": {
        const query = (msg.payload as Record<string, string>)?.query;
        if (query) {
          try {
            const users = await apiClient.searchUsers(query);
            this._panel.webview.postMessage({ type: "mentionSuggestions", users });
          } catch {
            this._panel.webview.postMessage({ type: "mentionSuggestions", users: [] });
          }
        }
        break;
      }
      case "viewProfile": {
        const login = (msg.payload as Record<string, string>)?.login;
        if (login) { vscode.commands.executeCommand("trending.viewProfile", login); }
        break;
      }
      case "getMembers": {
        try {
          const members = await apiClient.getGroupMembers(this._conversationId);
          log(`[Chat] getGroupMembers returned ${members.length} members for ${this._conversationId}`);
          this._panel.webview.postMessage({ type: "members", members, currentUser: authManager.login });
        } catch (err) {
          log(`[Chat] getGroupMembers failed: ${err}`, "error");
          vscode.window.showErrorMessage("Failed to load members");
        }
        break;
      }
      case "addMember": {
        const addLogin = (msg.payload as Record<string, string>)?.login;
        if (addLogin) {
          // Called from group info panel with a specific login
          try {
            await apiClient.addGroupMember(this._conversationId, addLogin);
            const members = await apiClient.getGroupMembers(this._conversationId);
            this._panel.webview.postMessage({ type: "showGroupInfo", members });
          } catch { vscode.window.showErrorMessage("Failed to add member"); }
        } else {
          // Legacy: pick from QuickPick
          const following = await apiClient.getFollowing(1, 100);
          const picks = following.map((f: { login: string; name?: string }) => ({
            label: f.name || f.login, description: `@${f.login}`, login: f.login,
          }));
          const selected = await vscode.window.showQuickPick(picks, { placeHolder: "Add member to group", matchOnDescription: true });
          if (selected) {
            try {
              await apiClient.addGroupMember(this._conversationId, selected.login);
              vscode.window.showInformationMessage(`Added @${selected.login} to group`);
              const members = await apiClient.getGroupMembers(this._conversationId);
              this._panel.webview.postMessage({ type: "members", members, currentUser: authManager.login });
            } catch { vscode.window.showErrorMessage(`Failed to add @${selected.login}`); }
          }
        }
        break;
      }
      case "removeMember": {
        const memberLogin = (msg.payload as Record<string, string>)?.login;
        if (!memberLogin) { break; }
        try {
          await apiClient.removeGroupMember(this._conversationId, memberLogin);
          const members = await apiClient.getGroupMembers(this._conversationId);
          this._panel.webview.postMessage({ type: "showGroupInfo", members });
        } catch { vscode.window.showErrorMessage("Failed to remove member"); }
        break;
      }
      case "updateGroupName": {
        const newName = (msg.payload as { name: string })?.name;
        if (newName) {
          try {
            await apiClient.updateGroup(this._conversationId, newName);
            this._panel.title = `Chat: \u{1F465} ${newName}`;
          } catch { vscode.window.showErrorMessage("Failed to update group name"); }
        }
        break;
      }
      case "leaveGroup": {
        const confirmLeave = await vscode.window.showWarningMessage(
          "Leave this group? You won't receive messages anymore.", { modal: true }, "Leave"
        );
        if (confirmLeave === "Leave") {
          try {
            await apiClient.leaveGroup(this._conversationId);
            this._panel.dispose();
          } catch { vscode.window.showErrorMessage("Failed to leave group"); }
        }
        break;
      }
      case "groupInfo":
        try {
          const members = await apiClient.getGroupMembers(this._conversationId);
          this._panel.webview.postMessage({ type: "showGroupInfo", members });
        } catch { vscode.window.showErrorMessage("Failed to load group info"); }
        break;
      case "togglePin": {
        const pinned = (msg.payload as Record<string, boolean>).isPinned;
        try {
          if (pinned) { await apiClient.unpinConversation(this._conversationId); }
          else { await apiClient.pinConversation(this._conversationId); }
          // Refresh inbox so pinned state updates in conversation list
          const { chatPanelWebviewProvider: cp } = await import("./chat-panel");
          cp?.refresh();
        } catch (err) {
          const status = (err as { response?: { status?: number } })?.response?.status;
          const msg = status === 400 ? "Maximum 3 pinned conversations. Unpin one first." : "Failed to update pin";
          // Show in both VS Code notification AND inside webview
          vscode.window.showWarningMessage(msg);
          this._panel.webview.postMessage({ type: "pinReverted", isPinned: pinned });
          this._panel.webview.postMessage({ type: "showToast", text: msg });
        }
        break;
      }
      case "addPeople": {
        // Search and add people — reuse the createGroup pattern
        const friends = await apiClient.getFollowing(1, 100).catch(() => []);
        const picks = (friends as { login: string; name?: string }[]).map((f) => ({
          label: f.name || f.login,
          description: `@${f.login}`,
          login: f.login,
        }));
        const selected = await vscode.window.showQuickPick(picks, {
          placeHolder: "Select people to add",
          canPickMany: true,
          matchOnDescription: true,
        });
        if (selected && selected.length > 0) {
          if (this._isGroup) {
            // Already a group — add members directly
            for (const s of selected) {
              try { await apiClient.addGroupMember(this._conversationId, s.login); } catch { /* skip */ }
            }
            await this.loadData();
          } else {
            // DM → convert to group in-place: preserves message history
            const groupName = await vscode.window.showInputBox({
              prompt: "Name your group (optional)",
              placeHolder: "e.g. The Dream Team",
            });
            const newMembers = selected.map((s) => s.login);
            try {
              await apiClient.convertDmToGroup(this._conversationId, newMembers, groupName || undefined);
              // Reload to reflect group state (new title, members, etc.)
              await this.loadData();
              const { chatPanelWebviewProvider: cp3 } = await import("./chat-panel");
              cp3?.refresh();
            } catch { vscode.window.showErrorMessage("Failed to convert to group"); }
          }
        }
        break;
      }
      case "toggleMute": {
        const isMuted = (msg.payload as Record<string, boolean>).isMuted;
        try {
          if (isMuted) { await apiClient.unmuteConversation(this._conversationId); }
          else { await apiClient.muteConversation(this._conversationId); }
          this._panel.webview.postMessage({ type: "muteUpdated", isMuted: !isMuted });
          const { chatPanelWebviewProvider: cp2 } = await import("./chat-panel");
          cp2?.refresh();
        } catch { vscode.window.showErrorMessage("Failed to update mute"); }
        break;
      }
      case "searchUsersForGroup": {
        const groupSearchQuery = (msg.payload as Record<string, string>).query;
        try {
          const users = await apiClient.searchUsers(groupSearchQuery);
          this._panel.webview.postMessage({ type: "groupSearchResults", users });
        } catch {
          this._panel.webview.postMessage({ type: "groupSearchResults", users: [] });
        }
        break;
      }
      case "reply": {
        const rp = msg.payload as { content: string; replyToId: string; attachments?: { type: string; url: string; storage_path: string; filename?: string; mime_type?: string; size_bytes?: number }[] };
        if ((rp?.content || rp?.attachments?.length) && rp?.replyToId) {
          try {
            const sent = await apiClient.replyToMessage(this._conversationId, rp.content || "", rp.replyToId, rp.attachments);
            const sentId = (sent as unknown as Record<string, string>).id;
            if (sentId) { this._recentlySentIds.add(sentId); }
            this._panel.webview.postMessage({ type: "newMessage", payload: sent });
          } catch { vscode.window.showErrorMessage("Failed to send reply"); }
        }
        break;
      }
      case "editMessage": {
        const ep = msg.payload as { messageId: string; body: string };
        if (ep?.messageId && ep?.body) {
          try {
            await apiClient.editMessage(this._conversationId, ep.messageId, ep.body);
            this._panel.webview.postMessage({ type: "messageEdited", messageId: ep.messageId, body: ep.body });
          } catch { vscode.window.showErrorMessage("Failed to edit message"); }
        }
        break;
      }
      case "deleteMessage": {
        const dp = msg.payload as { messageId: string };
        if (dp?.messageId) {
          const confirm = await vscode.window.showWarningMessage("Delete this message?", { modal: true }, "Delete");
          if (confirm === "Delete") {
            try {
              await apiClient.deleteMessage(this._conversationId, dp.messageId);
              this._panel.webview.postMessage({ type: "messageRemoved", messageId: dp.messageId });
            } catch { vscode.window.showErrorMessage("Failed to delete message"); }
          }
        }
        break;
      }
      case "unsendMessage": {
        const up = msg.payload as { messageId: string };
        if (up?.messageId) {
          try {
            await apiClient.unsendMessage(this._conversationId, up.messageId);
            this._panel.webview.postMessage({ type: "messageRemoved", messageId: up.messageId });
          } catch { vscode.window.showErrorMessage("Failed to unsend message"); }
        }
        break;
      }
      case "pinMessage": {
        const pp = msg.payload as { messageId: string };
        if (pp?.messageId) {
          try {
            await apiClient.pinMessage(this._conversationId, pp.messageId);
            vscode.window.showInformationMessage("Message pinned");
          } catch { vscode.window.showErrorMessage("Failed to pin message"); }
        }
        break;
      }
      case "unpinMessage": {
        const upp = msg.payload as { messageId: string };
        if (upp?.messageId) {
          try {
            await apiClient.unpinMessage(this._conversationId, upp.messageId);
            vscode.window.showInformationMessage("Message unpinned");
          } catch { vscode.window.showErrorMessage("Failed to unpin message"); }
        }
        break;
      }
      case "removeReaction": {
        const rrp = msg.payload as { messageId: string; emoji: string };
        if (rrp?.messageId && rrp?.emoji) {
          try { await apiClient.removeReaction(rrp.emoji, rrp.messageId); }
          catch { vscode.window.showWarningMessage("Failed to remove reaction"); }
        }
        break;
      }
      case "upload": {
        const up = msg.payload as { id: number; data: string; filename: string; mimeType: string };
        if (up?.data) {
          const buffer = Buffer.from(up.data, "base64");
          const maxSize = 10 * 1024 * 1024; // 10MB
          if (buffer.length > maxSize) {
            const sizeMB = (buffer.length / 1024 / 1024).toFixed(1);
            this._panel.webview.postMessage({ type: "uploadFailed", id: up.id });
            vscode.window.showWarningMessage(`File too large (${sizeMB}MB, max 10MB): ${up.filename}`);
            break;
          }
          try {
            const result = await apiClient.uploadAttachment(this._conversationId, buffer, up.filename, up.mimeType);
            this._panel.webview.postMessage({ type: "uploadComplete", id: up.id, attachment: result });
          } catch (err: unknown) {
            const errMsg = err instanceof Error ? err.message : String(err);
            const status = (err as { response?: { status?: number } })?.response?.status;
            log(`Upload failed (status=${status}): ${errMsg}`, "error");
            this._panel.webview.postMessage({ type: "uploadFailed", id: up.id });
            vscode.window.showErrorMessage(`Failed to upload file${status ? ` (${status})` : ""}: ${errMsg.slice(0, 100)}`);
          }
        }
        break;
      }
      case "pickFile":
      case "pickPhoto": {
        const photoFilters: Record<string, string[]> = msg.type === "pickPhoto"
          ? { "Images & Videos": ["png", "jpg", "jpeg", "gif", "webp", "mp4", "mov", "avi"] }
          : { "Images": ["png", "jpg", "jpeg", "gif", "webp"], "All": ["*"] };
        const uris = await vscode.window.showOpenDialog({
          canSelectFiles: true, canSelectMany: false,
          filters: photoFilters,
        });
        if (uris && uris.length > 0) {
          await this.uploadFromUri(uris[0]);
        }
        break;
      }
      case "pickDocument": {
        const docUris = await vscode.window.showOpenDialog({
          canSelectFiles: true, canSelectMany: false,
        });
        if (docUris && docUris.length > 0) {
          await this.uploadFromUri(docUris[0]);
        }
        break;
      }
      case "insertCode": {
        // Try to grab selected code from the active editor
        const editor = vscode.window.activeTextEditor;
        const selection = editor?.selection;
        const selectedText = selection && !selection.isEmpty ? editor.document.getText(selection) : "";

        if (selectedText) {
          // Auto-detect language from the file
          const lang = editor!.document.languageId || "";
          const wrapped = "```" + lang + "\n" + selectedText + "\n```";
          this._panel.webview.postMessage({ type: "insertText", text: wrapped });
        } else {
          // No selection — grab from clipboard
          const clipboard = await vscode.env.clipboard.readText();
          if (clipboard.trim()) {
            const lang = await vscode.window.showQuickPick(
              ["js", "ts", "python", "go", "rust", "java", "c", "cpp", "bash", "json", "html", "css", "sql", "text"],
              { placeHolder: "Select language for clipboard content" }
            );
            if (lang) {
              const wrapped = "```" + lang + "\n" + clipboard.trim() + "\n```";
              this._panel.webview.postMessage({ type: "insertText", text: wrapped });
            }
          } else {
            vscode.window.showInformationMessage("Select code in the editor or copy code to clipboard first.");
          }
        }
        break;
      }
      case "ready":
        break;
      case "showWarning": {
        const warnMsg = (msg.payload as { message: string })?.message;
        if (warnMsg) { vscode.window.showWarningMessage(warnMsg); }
        break;
      }
    }
  }

  private _pickId = 1000; // IDs for extension-side file picks (avoid clash with webview IDs)

  private async uploadFromUri(fileUri: vscode.Uri): Promise<void> {
    const filename = fileUri.path.split("/").pop() || "file";
    const ext = filename.split(".").pop()?.toLowerCase() || "";
    const mimeMap: Record<string, string> = {
      png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
      mp4: "video/mp4", mov: "video/quicktime", avi: "video/x-msvideo",
      pdf: "application/pdf", zip: "application/zip", txt: "text/plain",
    };
    const mimeType = mimeMap[ext] || "application/octet-stream";
    const id = this._pickId++;

    // Tell webview to create a preview entry
    this._panel.webview.postMessage({ type: "addPickedFile", id, filename, mimeType });

    try {
      const fileData = await vscode.workspace.fs.readFile(fileUri);
      const buffer = Buffer.from(fileData);
      const maxSize = 10 * 1024 * 1024;
      if (buffer.length > maxSize) {
        const sizeMB = (buffer.length / 1024 / 1024).toFixed(1);
        this._panel.webview.postMessage({ type: "uploadFailed", id });
        vscode.window.showWarningMessage(`File too large (${sizeMB}MB, max 10MB): ${filename}`);
        return;
      }
      const result = await apiClient.uploadAttachment(this._conversationId, buffer, filename, mimeType);
      this._panel.webview.postMessage({ type: "uploadComplete", id, attachment: result });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const status = (err as { response?: { status?: number } })?.response?.status;
      log(`File upload failed (status=${status}): ${errMsg}`, "error");
      this._panel.webview.postMessage({ type: "uploadFailed", id });
      vscode.window.showErrorMessage(`Failed to upload file${status ? ` (${status})` : ""}: ${errMsg.slice(0, 100)}`);
    }
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const styleUri = getUri(webview, this._extensionUri, ["media", "webview", "chat.css"]);
    const codiconCss = getUri(webview, this._extensionUri, ["media", "webview", "codicon.css"]);
    const scriptUri = getUri(webview, this._extensionUri, ["media", "webview", "chat.js"]);
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} https: blob: data:;">
      <link href="${styleUri}" rel="stylesheet"><link href="${codiconCss}" rel="stylesheet"><title>Chat</title></head>
      <body><div class="chat-header" id="header"><span class="name">Loading...</span></div>
      <div class="messages" id="messages"></div><div class="typing-indicator" id="typing"></div>
      <div id="attachPreview" class="attach-preview" style="display:none"></div>
      <div class="chat-input">
        <div class="attach-wrapper">
          <button id="attachBtn" class="attach-btn" title="Attach file"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg></button>
          <div id="attachMenu" class="attach-menu">
            <button class="attach-menu-item" data-action="photo"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg><span>Photo or Video</span></button>
            <button class="attach-menu-item" data-action="document"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></svg><span>Document</span></button>
            <button class="attach-menu-item" data-action="code"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg><span>Code Snippet</span></button>
          </div>
        </div>
        <input id="messageInput" type="text" placeholder="Type a message..." /><button id="sendBtn">Send</button>
      </div>
      <script nonce="${nonce}" src="${scriptUri}"></script></body></html>`;
  }

  private dispose(): void {
    realtimeClient.leaveConversation(this._conversationId);
    ChatPanel.instances.delete(this._conversationId);
    this._panel.dispose();
    for (const d of this._disposables) { d.dispose(); }
  }
}

export const chatModule: ExtensionModule = {
  id: "chat",
  activate(_context) { log("Chat module activated"); },
};

export { ChatPanel };
