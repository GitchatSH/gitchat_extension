import * as vscode from "vscode";
import type { ExtensionModule } from "../types";
import { configManager } from "../config";
import { apiClient } from "../api";
import { authManager } from "../auth";
import { realtimeClient } from "../realtime";
import { log } from "../utils";
import { ChatPanel } from "../webviews/chat";
import { exploreWebviewProvider } from "../webviews/explore";
import { chatPanelWebviewProvider } from "../webviews/chat-panel";
import { notificationStore } from "../notifications/notification-store";

let bellItem: vscode.StatusBarItem;

let unreadMessages = 0;
let lastIncrementAt = 0; // timestamp to debounce poll after local increment

function totalUnread(): number {
  return Math.min(99, unreadMessages + notificationStore.unreadCount);
}

function updateBadges(): void {
  if (!authManager.isSignedIn) {
    bellItem.hide();
    return;
  }

  const total = totalUnread();
  bellItem.text = total > 0 ? `$(bell-dot) ${total}` : `$(bell)`;
  bellItem.tooltip = total > 0
    ? `${unreadMessages} unread message${unreadMessages !== 1 ? "s" : ""} · ${notificationStore.unreadCount} notification${notificationStore.unreadCount !== 1 ? "s" : ""}`
    : "GitChat — no new activity";
  bellItem.show();

  log(`[Badge] messages=${unreadMessages} notifications=${notificationStore.unreadCount} total=${total}`);

  // Views still want the message-only count for conversation list badges
  exploreWebviewProvider?.setBadge(unreadMessages);
  chatPanelWebviewProvider?.setBadge(unreadMessages);
}

export async function fetchCounts(force = false): Promise<void> {
  if (!authManager.isSignedIn) { return; }
  if (!force && Date.now() - lastIncrementAt < 5000) { return; }
  try {
    const [msgCount, notifCount] = await Promise.all([
      apiClient.getUnreadMessageCount(),
      apiClient.getUnreadNotificationCount().catch(() => 0),
    ]);
    unreadMessages = msgCount;
    // Push the notification count into the store so other surfaces see it too
    if (notifCount !== notificationStore.unreadCount) {
      notificationStore.refresh().catch(() => { /* best-effort */ });
    }
    log(`[fetchCounts] messages=${msgCount} notifications=${notifCount}`);
    updateBadges();
  } catch (err) {
    log(`[fetchCounts] failed: ${err}`, "warn");
  }
}

function mentionsSelf(content: string | undefined, login: string | undefined): boolean {
  if (!content || !login) { return false; }
  const re = new RegExp(`@${login}(?![a-zA-Z0-9_-])`, "i");
  return re.test(content);
}

export const statusBarModule: ExtensionModule = {
  id: "statusBar",
  activate(context) {
    bellItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    bellItem.command = "trending.openInbox";
    updateBadges();
    if (authManager.isSignedIn) { fetchCounts(); }

    authManager.onDidChangeAuth((signedIn) => {
      if (signedIn) { fetchCounts(); }
      else { unreadMessages = 0; updateBadges(); }
    });

    let pollTimer = setInterval(() => { fetchCounts(); }, 30_000);
    configManager.onDidChangeFocus((focused) => {
      clearInterval(pollTimer);
      if (focused) {
        fetchCounts();
        pollTimer = setInterval(() => { fetchCounts(); }, 30_000);
      } else {
        pollTimer = setInterval(() => { fetchCounts(); }, 60_000);
      }
    });
    context.subscriptions.push({ dispose: () => clearInterval(pollTimer) });

    // Keep badge in sync with the notification store
    context.subscriptions.push(notificationStore.onDidChange(() => updateBadges()));

    realtimeClient.onUnreadCount((counts) => {
      if (typeof counts.messages === "number" && counts.messages > 0) {
        unreadMessages = counts.messages;
        updateBadges();
      } else {
        fetchCounts();
      }
    });

    realtimeClient.onNewMessage(async (msg) => {
      const msgRecord = msg as unknown as Record<string, unknown>;
      const sender = (msgRecord.sender_login as string | undefined) || (msgRecord.sender as string | undefined);
      if (sender === authManager.login) { return; }

      unreadMessages++;
      lastIncrementAt = Date.now();
      updateBadges();

      const content = ((msgRecord.body as string | undefined) || (msgRecord.content as string | undefined)) ?? "";
      const preview = content.length > 60 ? content.slice(0, 60) + "..." : content;
      const conversationId = msgRecord.conversation_id as string | undefined;
      const isChatOpen = conversationId ? ChatPanel.isOpen(conversationId) : false;

      // Skip toast: muted, chat open, or message mentions us (notifications
      // module will show a proper mention toast via notification:new)
      const { chatPanelWebviewProvider: chatPanel } = await import("../webviews/chat-panel");
      const isMuted = conversationId ? chatPanel?.isConversationMuted(conversationId) : false;
      if (mentionsSelf(content, authManager.login ?? undefined)) { return; }

      if (!isChatOpen && !isMuted && sender && configManager.current.showMessageNotifications) {
        const action = await vscode.window.showInformationMessage(
          `${sender}: ${preview}`,
          "Open Chat",
          "Dismiss",
        );
        if (action === "Open Chat" && conversationId) {
          vscode.commands.executeCommand("trending.openChat", conversationId);
        }
      }
    });

    context.subscriptions.push(bellItem);
    log("Status bar registered");
  },
};
