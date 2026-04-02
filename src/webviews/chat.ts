import * as vscode from "vscode";
import type { ExtensionModule, Message, WebviewMessage } from "../types";
import { apiClient } from "../api";
import { realtimeClient } from "../realtime";
import { getNonce, getUri, log } from "../utils";

class ChatPanel {
  private static instances = new Map<string, ChatPanel>();
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];
  private _conversationId: string;

  private constructor(panel: vscode.WebviewPanel, private readonly _extensionUri: vscode.Uri, conversationId: string) {
    this._panel = panel;
    this._conversationId = conversationId;
    this._panel.webview.html = this.getHtml(this._panel.webview);
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._panel.webview.onDidReceiveMessage((msg: WebviewMessage) => this.onMessage(msg), null, this._disposables);

    const msgSub = realtimeClient.onNewMessage((message: Message) => {
      if (message.conversation_id === this._conversationId) {
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

  static async show(extensionUri: vscode.Uri, conversationId: string): Promise<void> {
    const existing = ChatPanel.instances.get(conversationId);
    if (existing) { existing._panel.reveal(); return; }
    const panel = vscode.window.createWebviewPanel("trending.chat", "Chat", vscode.ViewColumn.One, {
      enableScripts: true, retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, "media")],
    });
    const instance = new ChatPanel(panel, extensionUri, conversationId);
    ChatPanel.instances.set(conversationId, instance);
    realtimeClient.joinConversation(conversationId);
    await instance.loadData();
  }

  private async loadData(): Promise<void> {
    try {
      const [messages, conversations] = await Promise.all([
        apiClient.getMessages(this._conversationId),
        apiClient.getConversations(),
      ]);
      const conversation = conversations.find((c) => c.id === this._conversationId);
      const profile = await apiClient.getMyProfile();
      const participant = conversation?.participants[0];
      this._panel.title = `Chat: @${participant?.login || "Unknown"}`;
      this._panel.webview.postMessage({
        type: "init",
        payload: {
          currentUser: profile.login,
          participant: participant || { login: "Unknown", name: "Unknown", online: false },
          messages,
        },
      });
      await apiClient.markConversationRead(this._conversationId);
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
      case "react":
        if (payload?.emoji && payload?.messageId) {
          try { await apiClient.addReaction(payload.emoji, payload.messageId); } catch { /* ignore reaction failures */ }
        }
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
