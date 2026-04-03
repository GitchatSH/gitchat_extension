import * as vscode from "vscode";
import type { ExtensionModule } from "../types";
import { configManager } from "../config";
import { apiClient } from "../api";
import { authManager } from "../auth";
import { realtimeClient } from "../realtime";
import { log } from "../utils";
import { ChatPanel } from "../webviews/chat";

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

  messageItem.text = unreadMessages > 0 ? `$(mail) ${unreadMessages}` : "$(mail)";
  messageItem.tooltip = `${unreadMessages} unread message${unreadMessages !== 1 ? "s" : ""}`;
  messageItem.show();

  notificationItem.text = unreadNotifications > 0 ? `$(bell) ${unreadNotifications}` : "$(bell)";
  notificationItem.tooltip = `${unreadNotifications} unread notification${unreadNotifications !== 1 ? "s" : ""}`;
  notificationItem.show();
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
    updateBadges();
  } catch {
    // Silently fail
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

    realtimeClient.onUnreadCount((counts) => {
      unreadMessages = counts.messages;
      unreadNotifications = counts.notifications;
      updateBadges();
    });
    realtimeClient.onNewMessage(async (msg) => {
      unreadMessages++;
      updateBadges();

      const msgRecord = msg as unknown as Record<string, unknown>;
      const sender = (msgRecord.sender_login as string | undefined) || (msgRecord.sender as string | undefined);
      const content = ((msgRecord.body as string | undefined) || (msgRecord.content as string | undefined)) ?? "";
      const preview = content.length > 60 ? content.slice(0, 60) + "..." : content;

      const conversationId = msgRecord.conversation_id as string | undefined;
      const isChatOpen = conversationId ? ChatPanel.isOpen(conversationId) : false;

      if (!isChatOpen && sender && configManager.current.showMessageNotifications) {
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
