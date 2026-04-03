import * as vscode from "vscode";
import type { ExtensionModule, Message, WebviewMessage } from "../types";
import { apiClient } from "../api";
import { authManager } from "../auth";
import { realtimeClient } from "../realtime";
import { configManager } from "../config";
import { getNonce, getUri, log } from "../utils";

class ChatPanel {
  private static instances = new Map<string, ChatPanel>();
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];
  private _conversationId: string;
  private _recipientLogin: string | undefined;
  private _cursor: string | undefined;
  private _hasMore = true;

  private constructor(panel: vscode.WebviewPanel, private readonly _extensionUri: vscode.Uri, conversationId: string, recipientLogin?: string) {
    this._panel = panel;
    this._conversationId = conversationId;
    this._recipientLogin = recipientLogin;
    this._panel.webview.html = this.getHtml(this._panel.webview);
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._panel.webview.onDidReceiveMessage((msg: WebviewMessage) => this.onMessage(msg), null, this._disposables);

    const msgSub = realtimeClient.onNewMessage((message: Message) => {
      if (message.conversation_id === this._conversationId) {
        // Skip if this is our own message (already appended via send response)
        const sender = (message as unknown as Record<string, string>).sender_login ?? (message as unknown as Record<string, string>).sender;
        if (sender === authManager.login) { return; }
        this._panel.webview.postMessage({ type: "newMessage", payload: message });
        apiClient.markConversationRead(this._conversationId).catch(() => {});
      }
    });
    const typingSub = realtimeClient.onTyping((data) => {
      if (data.conversationId === this._conversationId) {
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
          const conversations = await apiClient.getConversations();
          conv = conversations.find((c) => c.id === this._conversationId) as Record<string, unknown> | undefined;
          recipientLogin = (conv?.participants as { login: string }[] | undefined)?.find((p) => p.login !== currentUser)?.login;
        } catch { /* ignore */ }
      }

      const isGroup = conv?.type === "group" || conv?.is_group === true || ((conv?.participants as unknown[] | undefined)?.length ?? 0) > 2;
      const groupTitle = isGroup ? ((conv?.group_name as string) || "Group Chat") : undefined;

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

      // Fetch friends + presence for smart @mention
      let friends: { login: string; name?: string; avatar_url?: string; online?: boolean; lastSeen?: number }[] = [];
      try {
        const following = await apiClient.getFollowing(1, 100);
        const logins = following.map((f: { login: string }) => f.login).slice(0, 50);
        let presence: Record<string, string | null> = {};
        if (logins.length) {
          try { presence = await apiClient.getPresence(logins); } catch { /* ignore */ }
        }
        const { presenceHeartbeat } = configManager.current;
        friends = following.map((f: { login: string; name?: string; avatar_url?: string }) => {
          const lastSeenStr = presence[f.login];
          const lastSeen = lastSeenStr ? new Date(lastSeenStr).getTime() : 0;
          const online = lastSeen > 0 && (Date.now() - lastSeen < presenceHeartbeat * 5);
          return { login: f.login, name: f.name || f.login, avatar_url: f.avatar_url || "", online, lastSeen };
        });
      } catch { /* ignore */ }

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
        },
      });
      await apiClient.markConversationRead(this._conversationId).catch(() => {});
    } catch (err) { log(`Failed to load chat: ${err}`, "error"); }
  }

  private async onMessage(msg: WebviewMessage): Promise<void> {
    const payload = msg.payload as { content?: string; messageId?: string; emoji?: string } | undefined;
    switch (msg.type) {
      case "send":
        if (payload?.content) {
          try { const sent = await apiClient.sendMessage(this._conversationId, payload.content);
            this._panel.webview.postMessage({ type: "newMessage", payload: sent });
          } catch { vscode.window.showErrorMessage("Failed to send message"); }
        }
        break;
      case "typing": realtimeClient.emitTyping(this._conversationId); break;
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
        break;
      }
      case "removeMember": {
        const memberLogin = (msg.payload as Record<string, string>)?.login;
        if (!memberLogin) { break; }
        const confirm = await vscode.window.showWarningMessage(`Remove @${memberLogin} from group?`, { modal: true }, "Remove");
        if (confirm === "Remove") {
          try {
            await apiClient.removeGroupMember(this._conversationId, memberLogin);
            vscode.window.showInformationMessage(`Removed @${memberLogin}`);
            const members = await apiClient.getGroupMembers(this._conversationId);
            this._panel.webview.postMessage({ type: "members", members, currentUser: authManager.login });
          } catch { vscode.window.showErrorMessage(`Failed to remove @${memberLogin}`); }
        }
        break;
      }
      case "leaveGroup": {
        const confirmLeave = await vscode.window.showWarningMessage("Leave this group?", { modal: true }, "Leave");
        if (confirmLeave === "Leave") {
          try {
            await apiClient.leaveGroup(this._conversationId);
            this._panel.dispose();
          } catch { vscode.window.showErrorMessage("Failed to leave group"); }
        }
        break;
      }
      case "reply": {
        const rp = msg.payload as { content: string; replyToId: string };
        if (rp?.content && rp?.replyToId) {
          try {
            const sent = await apiClient.replyToMessage(this._conversationId, rp.content, rp.replyToId);
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
      case "ready":
        break;
    }
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const styleUri = getUri(webview, this._extensionUri, ["media", "webview", "chat.css"]);
    const scriptUri = getUri(webview, this._extensionUri, ["media", "webview", "chat.js"]);
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} https:;">
      <link href="${styleUri}" rel="stylesheet"><title>Chat</title></head>
      <body><div class="chat-header" id="header"><span class="name">Loading...</span></div>
      <div class="members-dropdown" id="membersDropdown" style="display:none">
        <div class="members-list" id="membersList"></div>
        <div class="members-actions">
          <button class="members-action-btn" id="addMemberBtn">+ Add Member</button>
          <button class="members-action-btn leave-btn" id="leaveBtn">Leave Group</button>
        </div>
      </div>
      <div class="messages" id="messages"></div><div class="typing-indicator" id="typing"></div>
      <div class="chat-input"><input id="messageInput" type="text" placeholder="Type a message..." /><button id="sendBtn">Send</button></div>
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
