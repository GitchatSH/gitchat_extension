import * as vscode from "vscode";
import type { ExtensionModule, Notification } from "../types";
import { authManager } from "../auth";
import { realtimeClient } from "../realtime";
import { configManager } from "../config";
import { log } from "../utils";
import { decideToast, describeNotification } from "./toast-rules";
import { notificationStore } from "./notification-store";

export { notificationStore };

// Toast throttle state — at most one toast at a time, cooldown between toasts
const TOAST_COOLDOWN_MS = 8000;
let toastInFlight = false;
let lastToastAt = 0;

function shouldThrottleToast(): boolean {
  if (toastInFlight) { return true; }
  if (Date.now() - lastToastAt < TOAST_COOLDOWN_MS) { return true; }
  return false;
}

async function handleIncoming(notification: Notification): Promise<void> {
  if (!authManager.isSignedIn) { return; }

  // Ignore own-actor notifications server-side should filter, but double-check
  if (notification.actor_login === authManager.login) { return; }

  notificationStore.prepend(notification);

  // Load chat panel lazily so we can check muted + open state without creating
  // a circular module dep at module-load time
  let isMuted = false;
  let isChatOpen = false;
  let conversationKind: "dm" | "group" | "community" | "team" | undefined;
  try {
    const conversationId = notification.metadata?.conversationId;
    if (conversationId) {
      const { chatPanelWebviewProvider } = await import("../webviews/chat-panel");
      isMuted = chatPanelWebviewProvider?.isConversationMuted(conversationId) ?? false;
      const { ChatPanel } = await import("../webviews/chat");
      isChatOpen = ChatPanel.isOpen(conversationId);
    }
  } catch { /* best-effort */ }

  const cfg = configManager.current;
  const decision = decideToast({
    type: notification.type,
    conversationId: notification.metadata?.conversationId,
    actorLogin: notification.actor_login,
    isChatOpen,
    isMuted,
    doNotDisturb: false,
    isOwnActor: notification.actor_login === authManager.login,
    conversationKind,
    configs: {
      showMessageNotifications: cfg.showMessageNotifications,
      showMentionNotifications: true,
      showWaveNotifications: true,
    },
  });

  log(`[Notifications] incoming ${notification.type} → toast=${decision.show} (${decision.reason})`);

  if (!decision.show) { return; }

  // Toast throttle: max 1 active, 8s cooldown — silent badge-only update otherwise
  if (shouldThrottleToast()) {
    log(`[Notifications] toast throttled (in-flight=${toastInFlight}, cooldown=${Date.now() - lastToastAt}ms)`);
    return;
  }
  toastInFlight = true;
  lastToastAt = Date.now();

  const { title, body } = describeNotification(notification);
  const conversationId = notification.metadata?.conversationId;
  const primary = conversationId ? "Open Chat" : "Open";
  try {
    const action = await vscode.window.showInformationMessage(
      body ? `${title}: ${body}` : title,
      primary,
      "Dismiss",
    );
    if (action === primary) {
      if (conversationId) {
        vscode.commands.executeCommand("gitchat.openChat", conversationId);
      } else if (notification.metadata?.url) {
        vscode.env.openExternal(vscode.Uri.parse(notification.metadata.url));
      } else {
        vscode.commands.executeCommand("gitchat.openNotifications");
      }
      await notificationStore.markRead([notification.id]);
    }
  } finally {
    toastInFlight = false;
    lastToastAt = Date.now();
  }
}

function syncUnreadContext(): void {
  vscode.commands.executeCommand("setContext", "gitchat.hasUnread", notificationStore.unreadCount > 0);
}

export const notificationsModule: ExtensionModule = {
  id: "notifications",
  activate(context) {
    if (authManager.isSignedIn) {
      notificationStore.refresh().then(() => syncUnreadContext());
    }

    context.subscriptions.push(
      authManager.onDidChangeAuth((signedIn) => {
        if (signedIn) { notificationStore.refresh().then(() => syncUnreadContext()); }
        else { notificationStore.refresh().then(() => syncUnreadContext()); }
      }),
      realtimeClient.onNotificationNew((n) => {
        handleIncoming(n).catch((err) => log(`[Notifications] handleIncoming failed: ${err}`, "warn"));
      }),
      notificationStore.onDidChange(() => syncUnreadContext()),
      notificationStore,
    );

    log("Notifications module activated");
  },
};
