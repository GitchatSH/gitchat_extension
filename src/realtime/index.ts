import * as vscode from "vscode";
import { io, Socket } from "socket.io-client";
import type { ExtensionModule, Message } from "../types";
import { configManager } from "../config";
import { authManager } from "../auth";
import { log } from "../utils";

class RealtimeClient {
  private _socket: Socket | null = null;
  private _heartbeatTimer: ReturnType<typeof setInterval> | null = null;

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

  connect(): void {
    if (this._socket?.connected) {
      return;
    }

    const token = authManager.token;
    if (!token) {
      return;
    }

    const baseUrl = configManager.current.apiUrl.replace("/api/v1", "");
    this._socket = io(baseUrl, {
      auth: { token },
      transports: ["websocket"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
    });

    this._socket.on("connect", () => {
      log("Socket.IO connected");
    });

    this._socket.on("disconnect", (reason) => {
      log(`Socket.IO disconnected: ${reason}`, "warn");
    });

    this._socket.on("new_message", (msg: Message) => {
      this._onNewMessage.fire(msg);
    });

    this._socket.on("typing", (data: { conversationId: string; user: string }) => {
      this._onTyping.fire(data);
    });

    this._socket.on("notification", (data: { count: number }) => {
      this._onNotification.fire(data);
    });

    this._socket.on("presence", (data: { user: string; online: boolean }) => {
      this._onPresence.fire(data);
    });

    this._socket.on("unread_count", (data: { messages: number; notifications: number }) => {
      this._onUnreadCount.fire(data);
    });

    this._heartbeatTimer = setInterval(() => {
      this._socket?.emit("heartbeat");
    }, configManager.current.presenceHeartbeat);
  }

  disconnect(): void {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
    this._socket?.disconnect();
    this._socket = null;
    log("Socket.IO disconnected (manual)");
  }

  emitTyping(conversationId: string): void {
    this._socket?.emit("typing", { conversationId });
  }

  joinConversation(conversationId: string): void {
    this._socket?.emit("join_conversation", { conversationId });
  }

  leaveConversation(conversationId: string): void {
    this._socket?.emit("leave_conversation", { conversationId });
  }

  dispose(): void {
    this.disconnect();
    this._onNewMessage.dispose();
    this._onTyping.dispose();
    this._onNotification.dispose();
    this._onPresence.dispose();
    this._onUnreadCount.dispose();
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

    context.subscriptions.push(realtimeClient);
    log("Realtime module activated");
  },
  deactivate() {
    realtimeClient.disconnect();
  },
};
