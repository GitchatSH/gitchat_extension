import * as vscode from "vscode";
import { io, Socket } from "socket.io-client";
import type { ExtensionModule, Message, Notification } from "../types";
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
  PRESENCE_SNAPSHOT: "presence:snapshot",
  REACTION_UPDATED: "reaction:updated",
  MEMBER_ADDED: "member:added",
  MEMBER_LEFT: "member:left",
  GROUP_UPDATED: "group:updated",
  GROUP_DISBANDED: "group:disbanded",
  MESSAGE_PINNED: "message:pinned",
  MESSAGE_UNPINNED: "message:unpinned",
  MESSAGES_UNPINNED_ALL: "messages:unpinned_all",
  MENTION_NEW: "mention:new",
  REACTION_NEW: "reaction:new",
  NOTIFICATION_NEW: "notification:new",
} as const;

const WS_SUBSCRIBE = {
  SUBSCRIBE_CONVERSATION: "subscribe:conversation",
  UNSUBSCRIBE_CONVERSATION: "unsubscribe:conversation",
  SUBSCRIBE_USER: "subscribe:user",
  WATCH_PRESENCE: "watch:presence",
  UNWATCH_PRESENCE: "unwatch:presence",
  PRESENCE_HEARTBEAT: "presence:heartbeat",
} as const;

// Backend presence TTL is 90s and sweeper marks offline if no heartbeat
// arrives within ~75–90s. We must emit a heartbeat well inside that window.
// Hard-coded 30s here on purpose — do NOT pull from `presenceHeartbeat` config
// because legacy default was 60s which is borderline and easy to miss.
const PRESENCE_HEARTBEAT_INTERVAL_MS = 30_000;

class RealtimeClient {
  private _socket: Socket | null = null;
  private _heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private _subscribedConversations = new Set<string>();

  private readonly _onNewMessage = new vscode.EventEmitter<Message>();
  readonly onNewMessage = this._onNewMessage.event;

  private readonly _onTyping = new vscode.EventEmitter<{ conversationId: string; user: string }>();
  readonly onTyping = this._onTyping.event;

  private readonly _onNotificationNew = new vscode.EventEmitter<Notification>();
  readonly onNotificationNew = this._onNotificationNew.event;

  private readonly _onPresence = new vscode.EventEmitter<{ user: string; online: boolean; lastSeenAt: string | null }>();
  readonly onPresence = this._onPresence.event;

  private readonly _onUnreadCount = new vscode.EventEmitter<{ messages: number; notifications: number }>();
  readonly onUnreadCount = this._onUnreadCount.event;

  private readonly _onConversationUpdated = new vscode.EventEmitter<void>();
  readonly onConversationUpdated = this._onConversationUpdated.event;

  private readonly _onGroupDisbanded = new vscode.EventEmitter<string>();
  readonly onGroupDisbanded = this._onGroupDisbanded.event;

  private readonly _onConversationRead = new vscode.EventEmitter<{ conversationId: string; login: string; readAt: string }>();
  readonly onConversationRead = this._onConversationRead.event;

  private readonly _onReactionUpdated = new vscode.EventEmitter<{ conversationId: string; messageId: string; reactions: { emoji: string; user_login: string }[] }>();
  readonly onReactionUpdated = this._onReactionUpdated.event;

  private readonly _onMessagePinned = new vscode.EventEmitter<{ conversationId: string; pinnedBy: string; message: Record<string, unknown> }>();
  readonly onMessagePinned = this._onMessagePinned.event;

  private readonly _onMessageUnpinned = new vscode.EventEmitter<{ conversationId: string; messageId: string; unpinnedBy: string }>();
  readonly onMessageUnpinned = this._onMessageUnpinned.event;

  private readonly _onMessagesUnpinnedAll = new vscode.EventEmitter<{ conversationId: string; unpinnedBy: string; unpinnedCount: number }>();
  readonly onMessagesUnpinnedAll = this._onMessagesUnpinnedAll.event;

  private readonly _onMentionNew = new vscode.EventEmitter<{ conversationId: string; messageId: string }>();
  readonly onMentionNew = this._onMentionNew.event;

  private readonly _onReactionNew = new vscode.EventEmitter<{ conversationId: string; messageId: string }>();
  readonly onReactionNew = this._onReactionNew.event;

  private readonly _onMemberAdded = new vscode.EventEmitter<{ conversationId: string; login: string; addedBy?: string }>();
  readonly onMemberAdded = this._onMemberAdded.event;

  private readonly _onMemberLeft = new vscode.EventEmitter<{ conversationId: string; login: string }>();
  readonly onMemberLeft = this._onMemberLeft.event;

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
    });

    this._socket.on("disconnect", (reason) => {
      log(`Socket.IO disconnected: ${reason}`, "warn");
    });

    this._socket.on("connect_error", (err) => {
      log(`Socket.IO connect_error: ${err.message}`, "error");
    });

    // Debug: log ALL incoming events (only when debug enabled)
    if (configManager.current.debugLogs) {
      this._socket.onAny((eventName: string, ...args: unknown[]) => {
        log(`[WS] event: ${eventName} ${JSON.stringify(args).slice(0, 200)}`);
      });
    }

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

    this._socket.on(WS_EVENTS.CONVERSATION_READ, (payload: { data?: { conversationId: string; login: string; readAt: string } }) => {
      const data = (payload.data ?? payload) as { conversationId: string; login: string; readAt: string };
      if (data.conversationId && data.login && data.login !== authManager.login) {
        this._onConversationRead.fire(data);
      }
      this._onConversationUpdated.fire();
    });

    this._socket.on(WS_EVENTS.UNREAD_UPDATED, (payload: { data?: { messages?: number; notifications?: number } }) => {
      const data = payload.data ?? payload;
      this._onUnreadCount.fire({ messages: (data as Record<string, number>).messages ?? 0, notifications: (data as Record<string, number>).notifications ?? 0 });
    });

    // ─── Group events ───
    this._socket.on(WS_EVENTS.MEMBER_ADDED, (payload: { data?: { conversationId: string; login: string; addedBy?: string } }) => {
      const data = (payload?.data ?? payload) as { conversationId?: string; login?: string; addedBy?: string };
      if (data?.conversationId && data?.login) {
        this._onMemberAdded.fire({ conversationId: data.conversationId, login: data.login, addedBy: data.addedBy });
      }
      this._onConversationUpdated.fire();
    });

    this._socket.on(WS_EVENTS.MEMBER_LEFT, (payload: { data?: { conversationId: string; login: string } }) => {
      const data = (payload?.data ?? payload) as { conversationId?: string; login?: string };
      if (data?.conversationId && data?.login) {
        this._onMemberLeft.fire({ conversationId: data.conversationId, login: data.login });
      }
      this._onConversationUpdated.fire();
    });

    this._socket.on(WS_EVENTS.GROUP_UPDATED, () => {
      this._onConversationUpdated.fire();
    });

    this._socket.on(WS_EVENTS.GROUP_DISBANDED, (payload: { data?: { conversationId?: string } }) => {
      this._onConversationUpdated.fire();
      const convId = payload?.data?.conversationId;
      if (convId) { this._onGroupDisbanded.fire(convId); }
    });

    // ─── Reaction events ───
    this._socket.on(WS_EVENTS.REACTION_UPDATED, (payload: { data?: { conversationId: string; messageId: string; reactions: { emoji: string; user_login: string }[] } }) => {
      const data = payload.data ?? payload;
      const d = data as { conversationId: string; messageId: string; reactions: { emoji: string; user_login: string }[] };
      if (d.conversationId && d.messageId) {
        this._onReactionUpdated.fire(d);
      }
    });

    // ─── Pin events ───
    this._socket.on(WS_EVENTS.MESSAGE_PINNED, (payload: { data?: { conversationId: string; messageId: string; pinnedBy: string; pinnedAt: string; message: Record<string, unknown> } }) => {
      const data = (payload.data ?? payload) as { conversationId: string; messageId: string; pinnedBy: string; pinnedAt: string; message: Record<string, unknown> };
      if (data.conversationId) {
        this._onMessagePinned.fire({ conversationId: data.conversationId, pinnedBy: data.pinnedBy, message: data.message });
      }
    });

    this._socket.on(WS_EVENTS.MESSAGE_UNPINNED, (payload: { data?: { conversationId: string; messageId: string; unpinnedBy: string } }) => {
      const data = (payload.data ?? payload) as { conversationId: string; messageId: string; unpinnedBy: string };
      if (data.conversationId) {
        this._onMessageUnpinned.fire({ conversationId: data.conversationId, messageId: data.messageId, unpinnedBy: data.unpinnedBy });
      }
    });

    this._socket.on(WS_EVENTS.MESSAGES_UNPINNED_ALL, (payload: { data?: { conversationId: string; unpinnedBy: string; unpinnedCount: number } }) => {
      const data = (payload.data ?? payload) as { conversationId: string; unpinnedBy: string; unpinnedCount: number };
      if (data.conversationId) {
        this._onMessagesUnpinnedAll.fire({ conversationId: data.conversationId, unpinnedBy: data.unpinnedBy, unpinnedCount: data.unpinnedCount });
      }
    });

    // ─── Notification events ───
    this._socket.on(WS_EVENTS.NOTIFICATION_NEW, (payload: { data?: Notification }) => {
      const data = (payload.data ?? payload) as Notification;
      if (data?.id) {
        this._onNotificationNew.fire(data);
      }
    });

    // ─── Mention/Reaction events (P2 — realtime badge updates) ───
    this._socket.on(WS_EVENTS.MENTION_NEW, (payload: { data?: { conversationId: string; messageId: string } }) => {
      const data = (payload.data ?? payload) as { conversationId: string; messageId: string };
      if (data.conversationId && data.messageId) {
        this._onMentionNew.fire(data);
      }
    });

    this._socket.on(WS_EVENTS.REACTION_NEW, (payload: { data?: { conversationId: string; messageId: string } }) => {
      const data = (payload.data ?? payload) as { conversationId: string; messageId: string };
      if (data.conversationId && data.messageId) {
        this._onReactionNew.fire(data);
      }
    });

    // ─── Presence events ───
    // `presence:updated` fires on actual transitions (0->1 online, 1->0 offline).
    // `presence:snapshot` fires once per `watch:presence` request to give the
    // client the current state. Both share the same payload shape and are
    // routed through the same emitter — consumers just see a unified stream.
    const handlePresence = (payload: { data?: { login: string; status: string; lastSeenAt?: string | null } }) => {
      const data = (payload.data ?? payload) as { login: string; status: string; lastSeenAt?: string | null };
      this._onPresence.fire({
        user: data.login,
        online: data.status === "online",
        lastSeenAt: data.lastSeenAt ?? null,
      });
    };
    this._socket.on(WS_EVENTS.PRESENCE_UPDATED, handlePresence);
    this._socket.on(WS_EVENTS.PRESENCE_SNAPSHOT, handlePresence);

    // ─── Typing events (match backend typing:start / typing:stop) ───
    this._socket.on("typing:start", (data: { login: string; conversationId?: string }) => {
      this._onTyping.fire({ conversationId: data.conversationId || "", user: data.login });
    });

    this.startHeartbeat();
  }

  startHeartbeat(): void {
    this.stopHeartbeat();
    // Emit `presence:heartbeat` (NOT `ping`) — backend's `presence:heartbeat`
    // handler runs the refreshHeartbeat Lua script which extends the user's
    // online TTL + heartbeat ZSET score. `ping` only round-trips for keepalive
    // and does NOT touch presence state, so emitting it here would leave the
    // user marked online for ~90s after connect and then silently flip offline.
    this._heartbeatTimer = setInterval(() => {
      this._socket?.emit(WS_SUBSCRIBE.PRESENCE_HEARTBEAT);
    }, PRESENCE_HEARTBEAT_INTERVAL_MS);
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
    this._socket?.emit("typing:start", { conversationId });
  }

  joinConversation(conversationId: string): void {
    this._subscribedConversations.add(conversationId);
    this._socket?.emit(WS_SUBSCRIBE.SUBSCRIBE_CONVERSATION, { conversationId });
  }

  leaveConversation(conversationId: string): void {
    this._subscribedConversations.delete(conversationId);
    this._socket?.emit(WS_SUBSCRIBE.UNSUBSCRIBE_CONVERSATION, { conversationId });
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
    this._onNotificationNew.dispose();
    this._onPresence.dispose();
    this._onUnreadCount.dispose();
    this._onConversationUpdated.dispose();
    this._onGroupDisbanded.dispose();
    this._onConversationRead.dispose();
    this._onReactionUpdated.dispose();
    this._onMessagePinned.dispose();
    this._onMessageUnpinned.dispose();
    this._onMessagesUnpinnedAll.dispose();
    this._onMentionNew.dispose();
    this._onReactionNew.dispose();
    this._onMemberAdded.dispose();
    this._onMemberLeft.dispose();
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
