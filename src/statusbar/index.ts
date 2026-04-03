import * as vscode from "vscode";
import type { ExtensionModule } from "../types";
import { configManager } from "../config";
import { apiClient } from "../api";
import { authManager } from "../auth";
import { realtimeClient } from "../realtime";
import { log } from "../utils";
import { ChatPanel } from "../webviews/chat";
import { chatPanelWebviewProvider } from "../webviews/chat-panel";
import { notificationsWebviewProvider } from "../webviews/notifications";

let messageItem: vscode.StatusBarItem;
let notificationItem: vscode.StatusBarItem;
let mainItem: vscode.StatusBarItem;

let unreadMessages = 0;
let unreadNotifications = 0;

function updateBadges(): void {
  mainItem.text = "$(flame) Trending";
  mainItem.tooltip = "Top GitHub Trending Repo & People";
  mainItem.show();

  if (!authManager.isSignedIn) {
    messageItem.hide();
    notificationItem.hide();
    return;
  }

  const msgText = unreadMessages > 0 ? `$(mail) ${unreadMessages}` : "$(mail)";
  messageItem.text = msgText;
  messageItem.tooltip = `${unreadMessages} unread message${unreadMessages !== 1 ? "s" : ""}`;
  messageItem.show();

  const notifText = unreadNotifications > 0 ? `$(bell) ${unreadNotifications}` : "$(bell)";
  notificationItem.text = notifText;
  notificationItem.tooltip = `${unreadNotifications} unread notification${unreadNotifications !== 1 ? "s" : ""}`;
  notificationItem.show();

  log(`[Badge] messages=${unreadMessages} notifications=${unreadNotifications} statusBar="${msgText}" "${notifText}"`);

  // Update sidebar activity bar badges
  chatPanelWebviewProvider?.setBadge(unreadMessages);
  notificationsWebviewProvider?.setBadge(unreadNotifications);
}

async function fetchCounts(): Promise<void> {
  if (!authManager.isSignedIn) { return; }
  try {
    const [msgCount, notifCount] = await Promise.all([
      apiClient.getUnreadMessageCount(),
      apiClient.getUnreadNotificationCount(),
    ]);
    unreadMessages = msgCount;
    unreadNotifications = notifCount;
    log(`[fetchCounts] API returned messages=${msgCount} notifications=${notifCount}`);
    updateBadges();
  } catch (err) {
    log(`[fetchCounts] failed: ${err}`, "warn");
  }
}

export const statusBarModule: ExtensionModule = {
  id: "statusBar",
  activate(context) {
    mainItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    mainItem.command = "workbench.view.extension.trendingSidebar";
    messageItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
    messageItem.command = "trending.openInbox";
    notificationItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
    notificationItem.command = "trending.openNotifications";

    updateBadges();
    if (authManager.isSignedIn) { fetchCounts(); }

    authManager.onDidChangeAuth((signedIn) => {
      if (signedIn) { fetchCounts(); }
      else { unreadMessages = 0; unreadNotifications = 0; updateBadges(); }
    });

    // Periodic poll every 30s as fallback (WS may drop or miss events)
    const pollTimer = setInterval(() => { fetchCounts(); }, 30_000);
    context.subscriptions.push({ dispose: () => clearInterval(pollTimer) });

    realtimeClient.onUnreadCount((counts) => {
      // If WS payload has actual counts, use them; otherwise poll API
      if (typeof counts.messages === "number" && counts.messages > 0 || typeof counts.notifications === "number" && counts.notifications > 0) {
        unreadMessages = counts.messages;
        unreadNotifications = counts.notifications;
        updateBadges();
      } else {
        // Server sent event without counts (just login) — fetch from API
        fetchCounts();
      }
    });
    realtimeClient.onNewMessage(async (msg) => {
      const msgRecord = msg as unknown as Record<string, unknown>;
      const sender = (msgRecord.sender_login as string | undefined) || (msgRecord.sender as string | undefined);

      // Skip own messages
      if (sender === authManager.login) { return; }

      unreadMessages++;
      updateBadges();

      const content = ((msgRecord.body as string | undefined) || (msgRecord.content as string | undefined)) ?? "";
      const preview = content.length > 60 ? content.slice(0, 60) + "..." : content;

      const conversationId = msgRecord.conversation_id as string | undefined;
      const isChatOpen = conversationId ? ChatPanel.isOpen(conversationId) : false;

      // Skip notification for muted conversations
      const { chatPanelWebviewProvider: chatPanel } = await import("../webviews/chat-panel");
      const isMuted = conversationId ? chatPanel?.isConversationMuted(conversationId) : false;

      if (!isChatOpen && !isMuted && sender && configManager.current.showMessageNotifications) {
        const action = await vscode.window.showInformationMessage(
          `${sender}: ${preview}`,
          "Open Chat",
          "Dismiss"
        );
        if (action === "Open Chat" && conversationId) {
          vscode.commands.executeCommand("trending.openChat", conversationId);
        }
      }
    });
    realtimeClient.onNotification((data) => { unreadNotifications = data.count; updateBadges(); });

    context.subscriptions.push(mainItem, messageItem, notificationItem);
    log("Status bar registered");
  },
};
