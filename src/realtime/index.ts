import * as vscode from "vscode";
import { io, Socket } from "socket.io-client";
import type { ExtensionModule, Message } from "../types";
import { configManager } from "../config";
import { authManager } from "../auth";
import { log } from "../utils";

// Must match backend WS_EVENT_NAMES / WS_SUBSCRIBE_MESSAGES
const WS_EVENTS = {
  MESSAGE_SENT: "message:sent",
  MESSAGE_EDITED: "message:edited",
  MESSAGE_DELETED: "message:deleted",
  CONVERSATION_UPDATED: "conversation:updated",
  CONVERSATION_READ: "conversation:read",
  UNREAD_UPDATED: "unread:updated",
  PRESENCE_UPDATED: "presence:updated",
  MEMBER_ADDED: "member:added",
  MEMBER_LEFT: "member:left",
  GROUP_UPDATED: "group:updated",
} as const;

const WS_SUBSCRIBE = {
  SUBSCRIBE_CONVERSATION: "subscribe:conversation",
  UNSUBSCRIBE_CONVERSATION: "unsubscribe:conversation",
  SUBSCRIBE_USER: "subscribe:user",
  WATCH_PRESENCE: "watch:presence",
} as const;

class RealtimeClient {
  private _socket: Socket | null = null;
  private _heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private _subscribedConversations = new Set<string>();

  private readonly _onNewMessage = new vscode.EventEmitter<Message>();
  readonly onNewMessage = this._onNewMessage.event;

  private readonly _onTyping = new vscode.EventEmitter<{ conversationId: string; user: string }>();
  readonly onTyping = this._onTyping.event;

  private readonly _onNotification = new vscode.EventEmitter<{ count: number }>();
  readonly onNotification = this._onNotification.event;

  private readonly _onPresence = new vscode.EventEmitter<{ user: string; online: boolean }>();
  readonly onPresence = this._onPresence.event;

  private readonly _onUnreadCount = new vscode.EventEmitter<{ messages: number; notifications: number }>();
  readonly onUnreadCount = this._onUnreadCount.event;

  private readonly _onConversationUpdated = new vscode.EventEmitter<void>();
  readonly onConversationUpdated = this._onConversationUpdated.event;

  connect(): void {
    if (this._socket?.connected) {
      return;
    }

    if (!authManager.login) {
      return;
    }

    const wsUrl = configManager.current.wsUrl;
    log(`[WS] Connecting to: ${wsUrl}`);
    this._socket = io(wsUrl, {
      transports: ["websocket"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
    });

    this._socket.on("connect", () => {
      log(`Socket.IO connected (id=${this._socket?.id})`);
      // Subscribe to own user room — same as web frontend does
      this._socket?.emit(WS_SUBSCRIBE.SUBSCRIBE_USER, { login: authManager.login });
      log(`Subscribed to user room: ${authManager.login}`);
      // Re-subscribe to any previously tracked conversations
      for (const convId of this._subscribedConversations) {
        this._socket?.emit(WS_SUBSCRIBE.SUBSCRIBE_CONVERSATION, { conversationId: convId });
      }
      // Auto-fetch and subscribe to all conversations
      this._autoSubscribeConversations();
    });

    this._socket.on("disconnect", (reason) => {
      log(`Socket.IO disconnected: ${reason}`, "warn");
    });

    this._socket.on("connect_error", (err) => {
      log(`Socket.IO connect_error: ${err.message}`, "error");
    });

    // Debug: log ALL incoming events
    this._socket.onAny((eventName: string, ...args: unknown[]) => {
      log(`[WS] event: ${eventName} ${JSON.stringify(args).slice(0, 200)}`);
    });

    // ─── Message events (emitted to conversation rooms) ───
    this._socket.on(WS_EVENTS.MESSAGE_SENT, (payload: { data: Message }) => {
      const msg = payload.data ?? payload;
      this._onNewMessage.fire(msg as Message);
    });

    this._socket.on(WS_EVENTS.MESSAGE_EDITED, () => {
      this._onConversationUpdated.fire();
    });

    this._socket.on(WS_EVENTS.MESSAGE_DELETED, () => {
      this._onConversationUpdated.fire();
    });

    // ─── Conversation events ───
    this._socket.on(WS_EVENTS.CONVERSATION_UPDATED, () => {
      this._onConversationUpdated.fire();
    });

    this._socket.on(WS_EVENTS.CONVERSATION_READ, () => {
      this._onConversationUpdated.fire();
    });

    this._socket.on(WS_EVENTS.UNREAD_UPDATED, (payload: { data?: { messages?: number; notifications?: number } }) => {
      const data = payload.data ?? payload;
      this._onUnreadCount.fire({ messages: (data as Record<string, number>).messages ?? 0, notifications: (data as Record<string, number>).notifications ?? 0 });
    });

    // ─── Group events ───
    this._socket.on(WS_EVENTS.MEMBER_ADDED, () => {
      this._onConversationUpdated.fire();
    });

    this._socket.on(WS_EVENTS.MEMBER_LEFT, () => {
      this._onConversationUpdated.fire();
    });

    this._socket.on(WS_EVENTS.GROUP_UPDATED, () => {
      this._onConversationUpdated.fire();
    });

    // ─── Presence events ───
    this._socket.on(WS_EVENTS.PRESENCE_UPDATED, (payload: { data?: { login: string; status: string } }) => {
      const data = payload.data ?? payload;
      const d = data as { login: string; status: string };
      this._onPresence.fire({ user: d.login, online: d.status === "online" });
    });

    // ─── Typing (plain event, no namespace) ───
    this._socket.on("typing", (data: { conversationId: string; login: string }) => {
      this._onTyping.fire({ conversationId: data.conversationId, user: data.login });
    });

    this.startHeartbeat();
  }

  startHeartbeat(): void {
    this.stopHeartbeat();
    this._heartbeatTimer = setInterval(() => {
      this._socket?.emit("ping");
    }, configManager.current.presenceHeartbeat);
  }

  stopHeartbeat(): void {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }

  disconnect(): void {
    this.stopHeartbeat();
    this._subscribedConversations.clear();
    this._socket?.disconnect();
    this._socket = null;
    log("Socket.IO disconnected (manual)");
  }

  emitTyping(conversationId: string): void {
    this._socket?.emit("typing", { conversationId, login: authManager.login });
  }

  joinConversation(conversationId: string): void {
    this._subscribedConversations.add(conversationId);
    this._socket?.emit(WS_SUBSCRIBE.SUBSCRIBE_CONVERSATION, { conversationId });
  }

  leaveConversation(conversationId: string): void {
    this._subscribedConversations.delete(conversationId);
    this._socket?.emit(WS_SUBSCRIBE.UNSUBSCRIBE_CONVERSATION, { conversationId });
  }

  private async _autoSubscribeConversations(): Promise<void> {
    try {
      const { apiClient } = await import("../api");
      const conversations = await apiClient.getConversations();
      const ids = conversations.map(c => c.id);
      for (const id of ids) {
        if (!this._subscribedConversations.has(id)) {
          this._subscribedConversations.add(id);
          this._socket?.emit(WS_SUBSCRIBE.SUBSCRIBE_CONVERSATION, { conversationId: id });
        }
      }
      log(`[WS] Auto-subscribed to ${ids.length} conversations`);
    } catch (err) {
      log(`[WS] Auto-subscribe failed: ${err}`, "warn");
    }
  }

  /** Subscribe to all existing conversations so we get real-time messages */
  subscribeToConversations(conversationIds: string[]): void {
    for (const id of conversationIds) {
      if (!this._subscribedConversations.has(id)) {
        this.joinConversation(id);
      }
    }
  }

  dispose(): void {
    this.disconnect();
    this._onNewMessage.dispose();
    this._onTyping.dispose();
    this._onNotification.dispose();
    this._onPresence.dispose();
    this._onUnreadCount.dispose();
    this._onConversationUpdated.dispose();
  }
}

export const realtimeClient = new RealtimeClient();

export const realtimeModule: ExtensionModule = {
  id: "realtime",
  activate(context) {
    if (authManager.isSignedIn) {
      realtimeClient.connect();
    }

    authManager.onDidChangeAuth((signedIn) => {
      if (signedIn) {
        realtimeClient.connect();
      } else {
        realtimeClient.disconnect();
      }
    });

    configManager.onDidChangeFocus((focused) => {
      if (focused) {
        realtimeClient.startHeartbeat();
      } else {
        realtimeClient.stopHeartbeat();
      }
    });

    context.subscriptions.push(realtimeClient);
    log("Realtime module activated");
  },
  deactivate() {
    realtimeClient.disconnect();
  },
};
