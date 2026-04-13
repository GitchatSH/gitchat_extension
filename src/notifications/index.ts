import * as vscode from "vscode";
import type { ExtensionModule, Notification } from "../types";
import { authManager } from "../auth";
import { realtimeClient } from "../realtime";
import { configManager } from "../config";
import { log } from "../utils";
import { decideToast, describeNotification } from "./toast-rules";
import { notificationStore } from "./notification-store";

export { notificationStore };

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

  const { title, body } = describeNotification(notification);
  const conversationId = notification.metadata?.conversationId;
  const primary = conversationId ? "Open Chat" : "Open";
  const action = await vscode.window.showInformationMessage(
    body ? `${title}: ${body}` : title,
    primary,
    "Dismiss",
  );
  if (action === primary) {
    if (conversationId) {
      vscode.commands.executeCommand("trending.openChat", conversationId);
    } else if (notification.metadata?.url) {
      vscode.env.openExternal(vscode.Uri.parse(notification.metadata.url));
    } else {
      vscode.commands.executeCommand("trending.openInbox");
    }
    await notificationStore.markRead([notification.id]);
  }
}

export const notificationsModule: ExtensionModule = {
  id: "notifications",
  activate(context) {
    if (authManager.isSignedIn) {
      notificationStore.refresh();
    }

    context.subscriptions.push(
      authManager.onDidChangeAuth((signedIn) => {
        if (signedIn) { notificationStore.refresh(); }
        else { notificationStore.refresh(); }
      }),
      realtimeClient.onNotificationNew((n) => {
        handleIncoming(n).catch((err) => log(`[Notifications] handleIncoming failed: ${err}`, "warn"));
      }),
      notificationStore,
    );

    log("Notifications module activated");
  },
};
