import * as vscode from "vscode";
import type { ExtensionModule, Message, WebviewMessage } from "../types";
import { apiClient } from "../api";
// chat webview
import { authManager } from "../auth";
import { realtimeClient } from "../realtime";
import { getNonce, getUri, log } from "../utils";
import { handleChatMessage, type ChatContext } from "./chat-handlers";


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
        // Mark-as-read is handled by webview scroll listener (markRead message)
        // But still refresh sidebar + statusbar to update badge/preview for new messages
        import("./chat-panel").then(m => m.chatPanelWebviewProvider?.debouncedRefresh()).catch(() => {});
        import("../statusbar").then(m => m.fetchCounts()).catch(() => {});
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
    const mentionNewSub = realtimeClient.onMentionNew((data) => {
      if (data.conversationId === this._conversationId) {
        this._panel.webview.postMessage({ type: "mentionNew", messageId: data.messageId });
      }
    });
    const reactionNewSub = realtimeClient.onReactionNew((data) => {
      if (data.conversationId === this._conversationId) {
        this._panel.webview.postMessage({ type: "reactionNew", messageId: data.messageId });
      }
    });
    const viewStateSub = this._panel.onDidChangeViewState(() => {
      // When panel becomes visible again, reload to catch up on missed events
      if (this._panel.visible) {
        this.loadData();
      }
    });
    this._disposables.push(msgSub, typingSub, presenceSub, reactionSub, readSub, pinnedSub, unpinnedSub, unpinnedAllSub, mentionNewSub, reactionNewSub, viewStateSub);
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

      // Fetch unread mention/reaction message IDs for scroll buttons
      let mentionIds: string[] = [];
      let reactionIds: string[] = [];
      const unreadMentionsCount = (conv as Record<string, number>)?.["unread_mentions_count"] ?? 0;
      const unreadReactionsCount = (conv as Record<string, number>)?.["unread_reactions_count"] ?? 0;
      log(`[SCROLL] mentions=${unreadMentionsCount} reactions=${unreadReactionsCount} lastRead=${(conv as Record<string, unknown>)?.["last_read_message_id"] ?? "N/A"}`);
      if (unreadMentionsCount > 0) {
        try { mentionIds = await apiClient.getUnreadMentions(this._conversationId); } catch { /* endpoint may not exist yet */ }
      }
      if (unreadReactionsCount > 0) {
        try { reactionIds = await apiClient.getUnreadReactions(this._conversationId); } catch { /* endpoint may not exist yet */ }
      }

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
          lastReadMessageId: (conv as Record<string, unknown>)?.["last_read_message_id"] as string | undefined,
          unreadMentionsCount,
          unreadReactionsCount,
          mentionIds,
          reactionIds,
        },
      });
      // Send existing draft to chat input if any
      const { chatPanelWebviewProvider: cp } = await import("./chat-panel");
      const draft = cp.getDraft(this._conversationId);
      if (draft) {
        this._panel.webview.postMessage({ type: "setDraft", text: draft });
      }
      // Refresh sidebar + statusbar on conversation open (without marking as read)
      cp.debouncedRefresh();
      import("../statusbar").then(m => m.fetchCounts()).catch(() => {});
    } catch (err) { log(`Failed to load chat: ${err}`, "error"); }
  }

  private async onMessage(msg: WebviewMessage): Promise<void> {
    // Build shared context for extracted handlers
    const ctx: ChatContext = {
      conversationId: this._conversationId,
      postToWebview: (m) => this._panel.webview.postMessage(m),
      recentlySentIds: this._recentlySentIds,
      extensionUri: this._extensionUri,
      isGroup: this._isGroup,
      prefixMessages: false, // Editor panel sends raw type names (no prefix)
      cursorState: {
        cursor: this._cursor,
        previousCursor: this._previousCursor,
        nextCursor: this._nextCursor,
        hasMore: this._hasMore,
        hasMoreBefore: this._hasMoreBefore,
        hasMoreAfter: this._hasMoreAfter,
      },
      reloadConversation: () => this.loadData(),
      disposePanel: () => this._panel.dispose(),
    };

    // Try shared handlers first
    if (await handleChatMessage(msg, ctx)) {
      // Sync cursor state back from shared context
      this._cursor = ctx.cursorState.cursor;
      this._previousCursor = ctx.cursorState.previousCursor;
      this._nextCursor = ctx.cursorState.nextCursor;
      this._hasMore = ctx.cursorState.hasMore;
      this._hasMoreBefore = ctx.cursorState.hasMoreBefore;
      this._hasMoreAfter = ctx.cursorState.hasMoreAfter;

      // Handle panel title update for updateGroupName
      if (msg.type === "updateGroupName") {
        const newName = (msg.payload as { name: string })?.name;
        if (newName) { this._panel.title = `Chat: \u{1F465} ${newName}`; }
      }
      return;
    }

    // Panel-specific cases (not shared)
    switch (msg.type) {
      case "typing": realtimeClient.emitTyping(this._conversationId); break;
      case "reloadConversation": this.loadData(); break;
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
        const editor = vscode.window.activeTextEditor;
        const selection = editor?.selection;
        const selectedText = selection && !selection.isEmpty ? editor.document.getText(selection) : "";

        if (selectedText) {
          const lang = editor!.document.languageId || "";
          const wrapped = "```" + lang + "\n" + selectedText + "\n```";
          this._panel.webview.postMessage({ type: "insertText", text: wrapped });
        } else {
          const clipboard = await vscode.env.clipboard.readText();
          if (clipboard.trim()) {
            const lang = await vscode.window.showQuickPick(
              ["js", "ts", "python", "go", "rust", "java", "c", "cpp", "bash", "json", "html", "css", "sql", "text"],
              { placeHolder: "Select language for clipboard content" },
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
      <div class="messages-area" id="messages-area"><div class="messages" id="messages"></div></div><div class="typing-indicator" id="typing"></div>
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
