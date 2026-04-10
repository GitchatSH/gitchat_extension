import * as vscode from "vscode";
import type { ExtensionModule, Message, WebviewMessage } from "../types";
import { apiClient } from "../api";
// chat webview
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
  private _previousCursor: string | undefined;
  private _nextCursor: string | undefined;
  private _hasMoreBefore = true;
  private _hasMoreAfter = false;
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
        // Mark-as-read is now handled by webview scroll listener (markRead message)
      }
    });
    const typingSub = realtimeClient.onTyping((data) => {
      // Only show typing for this conversation
      if (data.user !== authManager.login && (!data.conversationId || data.conversationId === this._conversationId)) {
        this._panel.webview.postMessage({ type: "typing", payload: { user: data.user } });
      }
    });
    const presenceSub = realtimeClient.onPresence((data) => {
      if (!this._recipientLogin || data.user === this._recipientLogin) {
        this._panel.webview.postMessage({ type: "presence", payload: data });
      }
    });
    const reactionSub = realtimeClient.onReactionUpdated((data) => {
      this._panel.webview.postMessage({ type: "reactionUpdated", payload: data });
    });
    const readSub = realtimeClient.onConversationRead((data) => {
      this._panel.webview.postMessage({ type: "conversationRead", payload: data });
    });
    const pinnedSub = realtimeClient.onMessagePinned((data) => {
      if (data.conversationId === this._conversationId) {
        this._panel.webview.postMessage({ type: "wsPinned", conversationId: data.conversationId, pinnedBy: data.pinnedBy, message: data.message });
      }
    });
    const unpinnedSub = realtimeClient.onMessageUnpinned((data) => {
      if (data.conversationId === this._conversationId) {
        this._panel.webview.postMessage({ type: "wsUnpinned", conversationId: data.conversationId, messageId: data.messageId, unpinnedBy: data.unpinnedBy });
      }
    });
    const unpinnedAllSub = realtimeClient.onMessagesUnpinnedAll((data) => {
      if (data.conversationId === this._conversationId) {
        this._panel.webview.postMessage({ type: "wsUnpinnedAll", conversationId: data.conversationId, unpinnedBy: data.unpinnedBy, unpinnedCount: data.unpinnedCount });
      }
    });
    const viewStateSub = this._panel.onDidChangeViewState(() => {
      // When panel becomes visible again, reload to catch up on missed events
      if (this._panel.visible) {
        this.loadData();
      }
    });
    this._disposables.push(msgSub, typingSub, presenceSub, reactionSub, readSub, pinnedSub, unpinnedSub, unpinnedAllSub, viewStateSub);
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

  private extractPinnedMessages(pins: unknown[]): Record<string, unknown>[] {
    return (pins as Record<string, unknown>[]).map(m => {
      const nested = (m.message != null && typeof m.message === 'object')
        ? m.message as Record<string, unknown> : null;
      return {
        id: (m.messageId as string) || (m.message_id as string) || (nested?.id as string) || (m.id as string),
        senderName: (m.senderLogin as string) || (m.sender_login as string) || (nested?.senderLogin as string) || (nested?.sender_login as string) || (m.sender as Record<string, string>)?.login || "",
        senderAvatar: (m.sender as Record<string, string>)?.avatar_url || (m.sender_avatar as string) || "",
        text: ((m.body as string) || (m.content as string) || (m.text as string) ||
          (typeof m.message === 'string' ? m.message : '') ||
          (nested?.body as string) || (nested?.content as string) || (nested?.text as string) || "").slice(0, 100),
        // Full message fields for pinned view — renderMessage() reads sender_login, sender, body
        content: (m.body as string) || (m.content as string) || (nested?.body as string) || (nested?.content as string) || "",
        body: (m.body as string) || (m.content as string) || (nested?.body as string) || (nested?.content as string) || "",
        sender: (m.senderLogin as string) || (m.sender_login as string) || (nested?.senderLogin as string) || (nested?.sender_login as string) || (m.sender as Record<string, string>)?.login || "",
        sender_login: (m.senderLogin as string) || (m.sender_login as string) || (nested?.senderLogin as string) || (nested?.sender_login as string) || (m.sender as Record<string, string>)?.login || "",
        sender_avatar: (nested?.sender_avatar as string) || (m.sender_avatar as string) || (m.sender as Record<string, string>)?.avatar_url || "",
        created_at: (m.createdAt as string) || (m.created_at as string) || (nested?.createdAt as string) || (nested?.created_at as string) || (m.pinned_at as string) || "",
        attachment_url: (m.attachment_url as string) || (nested?.attachment_url as string) || null,
        attachments: (m.attachments as unknown[]) || (nested?.attachments as unknown[]) || [],
        reactions: (m.reactions as unknown[]) || (nested?.reactions as unknown[]) || [],
        edited_at: (m.editedAt as string) || (m.edited_at as string) || (nested?.editedAt as string) || (nested?.edited_at as string) || null,
        type: (m.type as string) || (nested?.type as string) || "message",
      };
    });
  }

  private async loadData(): Promise<void> {
    try {
      const result = await apiClient.getMessages(this._conversationId, 1);
      this._hasMore = result.hasMore;
      this._cursor = result.cursor;
      const messages = result.messages;
      log(`Chat loaded: convId=${this._conversationId}, messages=${messages.length}, hasMore=${result.hasMore}, sample=${JSON.stringify(messages[0] ?? {})}`);
      const currentUser = authManager.login ?? "me";

      // Always fetch conversation data for group detection + recipient
      let recipientLogin = this._recipientLogin;
      let conv: Record<string, unknown> | undefined;
      try {
        const conversations = await apiClient.getConversations();
        conv = conversations.find((c) => c.id === this._conversationId) as Record<string, unknown> | undefined;
        if (!recipientLogin) {
          const otherUser = conv?.other_user as { login: string } | undefined;
          recipientLogin = otherUser?.login
            || (conv?.participants as { login: string }[] | undefined)?.find((p) => p.login !== currentUser)?.login;
        }
      } catch { /* ignore */ }

      // Detect group: check conv data or try fetching members as fallback
      let isGroup = conv?.type === "group" || conv?.is_group === true || ((conv?.participants as unknown[] | undefined)?.length ?? 0) > 2;
      let groupTitle = isGroup ? ((conv?.group_name as string) || "Group Chat") : undefined;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let groupMembers: any[] = [];
      if (!isGroup && !conv) {
        // Conv not in list yet (just created) — try fetching members to detect group
        try {
          groupMembers = await apiClient.getGroupMembers(this._conversationId);
          if (groupMembers.length > 2) {
            isGroup = true;
            groupTitle = "Group Chat";
          }
        } catch { /* not a group or doesn't exist */ }
      }
      this._isGroup = isGroup;
      const isPinned = !!(conv?.pinned_at || conv?.pinned);

      recipientLogin = recipientLogin || "Unknown";
      this._panel.title = isGroup ? `Chat: \u{1F465} ${groupTitle}` : `Chat: @${recipientLogin}`;

      // Fetch group members for @mention in groups (reuse if already fetched above)
      if (isGroup && groupMembers.length === 0) {
        try {
          groupMembers = await apiClient.getGroupMembers(this._conversationId);
        } catch { /* ignore */ }
      }

      // Friends for @mention — lazy loaded on first @ keystroke (avoid 2 API calls on open)
      const friends: { login: string; name?: string; avatar_url?: string; online?: boolean; lastSeen?: number }[] = [];

      // Fetch pinned messages for banner
      let pinnedMessages: Record<string, unknown>[] = [];
      try {
        const pins = await apiClient.getPinnedMessages(this._conversationId);
        pinnedMessages = this.extractPinnedMessages(pins);
      } catch { /* ignore */ }

      this._panel.webview.postMessage({
        type: "init",
        payload: {
          currentUser,
          participant: isGroup
            ? { login: groupTitle, name: groupTitle, online: false, avatar_url: (conv as Record<string, unknown>)?.["avatar_url"] as string || "" }
            : { login: recipientLogin, name: recipientLogin, online: false, avatar_url: `https://github.com/${recipientLogin}.png?size=64` },
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
          pinnedMessages,
          conversationId: this._conversationId,
          unreadCount: (conv as Record<string, number>)?.unread_count ?? 0,
        },
      });
      // Send existing draft to chat input if any
      const { chatPanelWebviewProvider: cp } = await import("./chat-panel");
      const draft = cp.getDraft(this._conversationId);
      if (draft) {
        this._panel.webview.postMessage({ type: "setDraft", text: draft });
      }
    } catch (err) { log(`Failed to load chat: ${err}`, "error"); }
  }

  private async onMessage(msg: WebviewMessage): Promise<void> {
    switch (msg.type) {
      case "send": {
        const sp = msg.payload as { content?: string; _tempId?: string; suppressLinkPreview?: boolean; attachments?: { type: string; url: string; storage_path: string; filename?: string; mime_type?: string; size_bytes?: number }[] };
        if (sp?.content || sp?.attachments?.length) {
          try {
            const sent = await apiClient.sendMessage(this._conversationId, sp.content || "", sp.attachments);
            const sentId = (sent as unknown as Record<string, string>).id;
            if (sentId) { this._recentlySentIds.add(sentId); }
            const payload = sp.suppressLinkPreview ? { ...sent, suppress_link_preview: true } : sent;
            this._panel.webview.postMessage({ type: "newMessage", payload });
            const { chatPanelWebviewProvider: cpSend } = await import("./chat-panel");
            cpSend.clearDraft(this._conversationId);
          } catch {
            this._panel.webview.postMessage({ type: "messageFailed", tempId: sp._tempId, content: sp.content });
          }
        }
        break;
      }
      case "typing": realtimeClient.emitTyping(this._conversationId); break;
      case "reloadConversation": this.loadData(); break;
      case "markRead": {
        await apiClient.markConversationRead(this._conversationId).catch(() => {});
        import("./chat-panel").then(m => m.chatPanelWebviewProvider?.debouncedRefresh()).catch(() => {});
        import("../statusbar").then(m => m.fetchCounts()).catch(() => {});
        break;
      }
      case "saveDraft": {
        const { conversationId, text } = msg.payload as { conversationId: string; text: string };
        const { chatPanelWebviewProvider: cp } = await import("./chat-panel");
        cp.setDraft(conversationId, text);
        break;
      }
      case "fetchLinkPreview": {
        const { url, messageId: lpMsgId } = msg.payload as { url: string; messageId: string };
        try {
          const data = await apiClient.getLinkPreview(url);
          this._panel.webview.postMessage({ type: "linkPreviewResult", url, messageId: lpMsgId, data });
        } catch {
          this._panel.webview.postMessage({ type: "linkPreviewResult", url, messageId: lpMsgId, data: null });
        }
        break;
      }
      case "fetchInputLinkPreview": {
        const { url: ilpUrl } = msg.payload as { url: string };
        try {
          const data = await apiClient.getLinkPreview(ilpUrl);
          this._panel.webview.postMessage({ type: "inputLinkPreviewResult", url: ilpUrl, data });
        } catch {
          this._panel.webview.postMessage({ type: "inputLinkPreviewResult", url: ilpUrl, data: null });
        }
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
        // Use _previousCursor when available (viewing context), fallback to _cursor
        const cursorToUse = this._previousCursor || this._cursor;
        const hasMore = this._previousCursor ? this._hasMoreBefore : this._hasMore;
        if (!this._conversationId || !hasMore) { break; }
        try {
          const result = await apiClient.getMessages(this._conversationId, 1, cursorToUse, 'before');
          this._hasMore = result.hasMore;
          this._hasMoreBefore = result.hasMore;
          if (result.cursor) {
            this._cursor = result.cursor;
            this._previousCursor = result.cursor;
          }
          this._panel.webview.postMessage({ type: "olderMessages", messages: result.messages, hasMore: result.hasMore });
        } catch { log("Failed to load more messages", "error"); }
        break;
      }
      case "loadNewer": {
        if (!this._conversationId || !this._hasMoreAfter || !this._nextCursor) { break; }
        try {
          const result = await apiClient.getMessages(this._conversationId, 1, this._nextCursor, 'after');
          this._hasMoreAfter = result.hasMore;
          if (result.cursor) { this._nextCursor = result.cursor; }
          this._panel.webview.postMessage({
            type: "newerMessages",
            messages: result.messages,
            hasMoreAfter: this._hasMoreAfter,
          });
        } catch { /* ignore */ }
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
      case "deleteGroup": {
        const confirmDelete = await vscode.window.showWarningMessage(
          "Delete this group? All members will lose access. This cannot be undone.",
          { modal: true },
          "Delete"
        );
        if (confirmDelete === "Delete") {
          try {
            await apiClient.deleteGroup(this._conversationId);
            this._panel.dispose();
          } catch {
            vscode.window.showErrorMessage("Failed to delete group");
          }
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
        const rp = msg.payload as { content: string; replyToId: string; _tempId?: string; suppressLinkPreview?: boolean; attachments?: { type: string; url: string; storage_path: string; filename?: string; mime_type?: string; size_bytes?: number }[] };
        if ((rp?.content || rp?.attachments?.length) && rp?.replyToId) {
          try {
            const sent = await apiClient.replyToMessage(this._conversationId, rp.content || "", rp.replyToId, rp.attachments);
            const sentId = (sent as unknown as Record<string, string>).id;
            if (sentId) { this._recentlySentIds.add(sentId); }
            const payload = rp.suppressLinkPreview ? { ...sent, suppress_link_preview: true } : sent;
            this._panel.webview.postMessage({ type: "newMessage", payload });
          } catch {
            this._panel.webview.postMessage({ type: "replyFailed", content: rp.content, replyToId: rp.replyToId, tempId: rp._tempId });
          }
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
          try {
            await apiClient.deleteMessage(this._conversationId, dp.messageId);
            this._panel.webview.postMessage({ type: "messageDeleted", messageId: dp.messageId });
          } catch { vscode.window.showErrorMessage("Failed to delete message"); }
        }
        break;
      }
      case "unsendMessage": {
        const up = msg.payload as { messageId: string };
        if (up?.messageId) {
          try {
            await apiClient.unsendMessage(this._conversationId, up.messageId);
            this._panel.webview.postMessage({ type: "messageUnsent", messageId: up.messageId });
          } catch (err) {
            const e = err as { response?: { status?: number; data?: unknown }; status?: number; message?: string };
            const status = e?.response?.status ?? e?.status ?? '?';
            const body = JSON.stringify(e?.response?.data ?? e?.message ?? String(err));
            log(`[unsend] FAILED status=${status} body=${body}`);
            vscode.window.showErrorMessage(`Failed to unsend message (${status})`);
          }
        }
        break;
      }
      case "forwardMessage": {
        const fp = msg.payload as { messageId: string; text: string; fromSender?: string; targetConversationIds: string[] };
        if (fp?.messageId && fp?.targetConversationIds?.length) {
          try {
            for (const targetId of fp.targetConversationIds) {
              try {
                const fwdHeader = fp.fromSender ? `\u21aa Forwarded from @${fp.fromSender}\n` : "\u21aa Forwarded\n";
              await apiClient.sendMessage(targetId, fwdHeader + (fp.text || ""));
              } catch { /* skip failed targets */ }
            }
            this._panel.webview.postMessage({ type: "forwardSuccess", count: fp.targetConversationIds.length });
          } catch {
            this._panel.webview.postMessage({ type: "forwardError" });
          }
        }
        break;
      }
      case "getConversations": {
        try {
          const convs = await apiClient.getConversations();
          this._panel.webview.postMessage({ type: "conversationsLoaded", conversations: convs });
        } catch {
          this._panel.webview.postMessage({ type: "conversationsLoaded", conversations: [] });
        }
        break;
      }
      case "uploadGroupAvatar": {
        const avp = msg.payload as { base64: string; mimeType: string };
        if (avp?.base64) {
          try {
            const rawData = avp.base64.includes(",") ? avp.base64.split(",")[1] : avp.base64;
            const buffer = Buffer.from(rawData, "base64");
            const ext = avp.mimeType === "image/png" ? "png" : avp.mimeType === "image/gif" ? "gif" : "jpg";
            const result = await apiClient.uploadAttachment(this._conversationId, buffer, `avatar.${ext}`, avp.mimeType);
            const avatarUrl = (result as unknown as Record<string, string>).url;
            await apiClient.updateGroup(this._conversationId, undefined, avatarUrl);
            this._panel.webview.postMessage({ type: "groupAvatarUpdated", avatarUrl });
          } catch {
            this._panel.webview.postMessage({ type: "groupAvatarFailed" });
          }
        }
        break;
      }
      case "pinMessage": {
        const pp = msg.payload as { messageId: string };
        if (pp?.messageId) {
          try {
            await apiClient.pinMessage(this._conversationId, pp.messageId);
            const pinned = await apiClient.getPinnedMessages(this._conversationId).catch(() => []);
            const pinnedMessages = this.extractPinnedMessages(pinned);
            this._panel.webview.postMessage({ type: "updatePinnedBanner", pinnedMessages });
          } catch { vscode.window.showErrorMessage("Failed to pin message"); }
        }
        break;
      }
      case "unpinMessage": {
        const upp = msg.payload as { messageId: string };
        if (upp?.messageId) {
          try {
            await apiClient.unpinMessage(this._conversationId, upp.messageId);
            // Optimistic: remove from local list — BE won't send WS echo to self
            this._panel.webview.postMessage({ type: "wsUnpinned", conversationId: this._conversationId, messageId: upp.messageId });
          } catch { vscode.window.showErrorMessage("Failed to unpin message"); }
        }
        break;
      }
      case "unpinAllMessages": {
        try {
          await apiClient.unpinAllMessages(this._conversationId);
          // Optimistic update — WS event will also arrive
          this._panel.webview.postMessage({ type: "updatePinnedBanner", pinnedMessages: [] });
        } catch {
          vscode.window.showErrorMessage("Failed to unpin all messages");
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
      case "searchMessages": {
        const sp = msg.payload as { query: string; cursor?: string };
        if (!sp?.query?.trim()) { break; }
        try {
          const result = await apiClient.searchMessages(this._conversationId, sp.query.trim(), sp.cursor);
          this._panel.webview.postMessage({ type: "searchResults", messages: result.messages, nextCursor: result.nextCursor, query: sp.query });
        } catch { this._panel.webview.postMessage({ type: "searchResults", messages: [], nextCursor: null, query: sp.query }); }
        break;
      }
      case "reportMessage": {
        const rp = msg.payload as { messageId: string };
        if (!rp?.messageId) { break; }
        const reason = await vscode.window.showQuickPick(
          [
            { label: "$(warning) Spam", description: "Unsolicited or repeated messages", value: "spam" },
            { label: "$(report) Harassment", description: "Threatening or abusive content", value: "harassment" },
            { label: "$(circle-slash) Other", description: "Other violations", value: "other" },
          ],
          { placeHolder: "Why are you reporting this message?", title: "Report Message" }
        );
        if (!reason) { break; }
        try {
          await apiClient.reportMessage(rp.messageId, (reason as { value: string }).value);
          vscode.window.showInformationMessage("Message reported. Thank you for helping keep the community safe.");
        } catch { vscode.window.showErrorMessage("Failed to report message. Please try again."); }
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
          canSelectFiles: true, canSelectMany: true,
          filters: photoFilters,
        });
        if (uris && uris.length > 0) {
          for (const uri of uris.slice(0, 10)) { await this.uploadFromUri(uri); }
        }
        break;
      }
      case "pickDocument": {
        const docUris = await vscode.window.showOpenDialog({
          canSelectFiles: true, canSelectMany: true,
        });
        if (docUris && docUris.length > 0) {
          for (const uri of docUris.slice(0, 10)) { await this.uploadFromUri(uri); }
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
      case "createInviteLink":
        try {
          const result = await apiClient.createInviteLink(this._conversationId);
          this._panel.webview.postMessage({ type: "inviteLinkResult", payload: result });
        } catch (err: unknown) {
          const errMsg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message || (err as Error).message || "Unknown error";
          log(`[Invite] Create failed: ${errMsg}`, "error");
          vscode.window.showErrorMessage(`Failed to create invite link: ${errMsg}`);
        }
        break;

      case "revokeInviteLink":
        try {
          await apiClient.revokeInviteLink(this._conversationId);
          const newLink = await apiClient.createInviteLink(this._conversationId);
          this._panel.webview.postMessage({ type: "inviteLinkRevoked", payload: newLink });
        } catch { vscode.window.showErrorMessage("Failed to revoke invite link"); }
        break;

      case "copyInviteLink": {
        const inviteUrl = (msg.payload as { url: string }).url;
        await vscode.env.clipboard.writeText(inviteUrl);
        vscode.window.showInformationMessage("Invite link copied!");
        break;
      }
      case "openExternal": {
        const extUrl = (msg.payload as { url: string }).url;
        if (extUrl) { vscode.env.openExternal(vscode.Uri.parse(extUrl)); }
        break;
      }
      case "ready":
        break;
      case "showWarning": {
        const warnMsg = (msg.payload as { message: string })?.message;
        if (warnMsg) { vscode.window.showWarningMessage(warnMsg); }
        break;
      }
      case "showInfoMessage": {
        const infoText = (msg as { text?: string }).text;
        if (infoText) { vscode.window.showInformationMessage(infoText); }
        break;
      }
      case "jumpToMessage": {
        const { messageId } = msg.payload as { messageId: string };
        console.log("[PIN-DEBUG] jumpToMessage handler, messageId:", messageId, "convId:", this._conversationId);
        if (messageId) {
          try {
            const result = await apiClient.getMessageContext(this._conversationId, messageId);
            console.log("[PIN-DEBUG] getMessageContext result:", result.messages?.length, "messages, hasMoreBefore:", result.hasMoreBefore, "hasMoreAfter:", result.hasMoreAfter);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            if (result.messages?.length) { console.log("[PIN-DEBUG] First:", (result.messages[0] as any).id, "Last:", (result.messages[result.messages.length - 1] as any).id); }
            // Save both cursors for bidirectional scroll
            this._previousCursor = result.previousCursor;
            this._nextCursor = result.nextCursor;
            this._hasMoreBefore = result.hasMoreBefore;
            this._hasMoreAfter = result.hasMoreAfter;
            this._panel.webview.postMessage({
              type: "jumpToMessageResult",
              messages: result.messages,
              targetMessageId: messageId,
              hasMoreBefore: this._hasMoreBefore,
              hasMoreAfter: this._hasMoreAfter,
            });
          } catch (err) {
            console.log("[PIN-DEBUG] getMessageContext FAILED:", err);
            // 404 or other error — message deleted
            this._panel.webview.postMessage({ type: "jumpToMessageFailed", messageId });
          }
        }
        break;
      }
    }
  }

  private async jumpToMessage(messageId: string): Promise<void> {
    try {
      const result = await apiClient.getMessageContext(this._conversationId, messageId);
      this._previousCursor = result.previousCursor;
      this._nextCursor = result.nextCursor;
      this._hasMoreBefore = result.hasMoreBefore;
      this._hasMoreAfter = result.hasMoreAfter;
      this._panel.webview.postMessage({
        type: "jumpToMessageResult",
        messages: result.messages,
        targetMessageId: messageId,
        hasMoreBefore: this._hasMoreBefore,
        hasMoreAfter: this._hasMoreAfter,
      });
    } catch { /* silent */ }
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

    try {
      const fileData = await vscode.workspace.fs.readFile(fileUri);
      const buffer = Buffer.from(fileData);
      const maxSize = 10 * 1024 * 1024;
      if (buffer.length > maxSize) {
        const sizeMB = (buffer.length / 1024 / 1024).toFixed(1);
        vscode.window.showWarningMessage(`File too large (${sizeMB}MB, max 10MB): ${filename}`);
        return;
      }

      // Generate base64 data URI for image preview in webview
      const isImage = mimeType.startsWith("image/");
      let dataUri: string | undefined;
      if (isImage) {
        dataUri = `data:${mimeType};base64,${buffer.toString("base64")}`;
      }

      // Tell webview to show preview (with thumbnail for images)
      this._panel.webview.postMessage({ type: "addPickedFile", id, filename, mimeType, dataUri });

      // Upload in background
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
    const sharedCss = getUri(webview, this._extensionUri, ["media", "webview", "shared.css"]);
    const scriptUri = getUri(webview, this._extensionUri, ["media", "webview", "chat.js"]);
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} https: blob: data:;">
      <link href="${styleUri}" rel="stylesheet"><link href="${codiconCss}" rel="stylesheet"><link href="${sharedCss}" rel="stylesheet"><title>Chat</title></head>
      <body><div class="chat-header" id="header"><span class="name">Loading...</span></div>
      <div class="messages" id="messages"></div><div class="typing-indicator" id="typing"></div>
      <div id="attachPreview" class="attach-preview" style="display:none"></div>
      <div class="chat-input">
        <div class="attach-wrapper">
          <button id="attachBtn" class="attach-btn" title="Attach file"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg></button>
          <div id="attachMenu" class="attach-menu">
            <button class="gs-btn gs-btn-lg gs-btn-ghost attach-menu-item" data-action="photo"><i class="codicon codicon-device-camera"></i><span>Photo or Video</span></button>
            <button class="gs-btn gs-btn-lg gs-btn-ghost attach-menu-item" data-action="document"><i class="codicon codicon-file"></i><span>Document</span></button>
            <button class="gs-btn gs-btn-lg gs-btn-ghost attach-menu-item" data-action="code"><i class="codicon codicon-code"></i><span>Code Snippet</span></button>
          </div>
        </div>
        <textarea id="messageInput" rows="1" placeholder="Type a message..."></textarea><button id="emojiBtn" class="emoji-input-btn" title="Emoji"><i class="codicon codicon-smiley"></i></button><button id="sendBtn">Send</button>
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
