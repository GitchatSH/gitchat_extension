import * as vscode from "vscode";
import type { ExtensionModule, Notification } from "../types";
import { authManager } from "../auth";
import { realtimeClient } from "../realtime";
import { configManager } from "../config";
import { log } from "../utils";
import { decideToast, describeNotification } from "./toast-rules";
import { notificationStore } from "./notification-store";
import { toastCoordinator } from "./toast-coordinator";

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

      // Two chat surfaces can count as "open":
      //   1. The sidebar explore view (default surface — chat embedded in
      //      the Chat tab). Tracked via exploreWebviewProvider._activeChatConvId.
      //   2. The standalone ChatPanel webview (minority case, opens in the
      //      editor area). Tracked via ChatPanel.instances.
      const { exploreWebviewProvider } = await import("../webviews/explore");
      if (exploreWebviewProvider?.isShowingChat(conversationId)) {
        isChatOpen = true;
      }
      if (!isChatOpen) {
        const { ChatPanel } = await import("../webviews/chat");
        isChatOpen = ChatPanel.isOpen(conversationId);
      }
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
  await toastCoordinator.enqueue(notification, title, body);
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
