import * as vscode from "vscode";
import type { ExtensionModule } from "../types";
import { configManager } from "../config";
import { apiClient } from "../api";
import { authManager } from "../auth";
import { realtimeClient } from "../realtime";
import { log } from "../utils";
import { ChatPanel } from "../webviews/chat";
import { chatPanelWebviewProvider } from "../webviews/chat-panel";
let messageItem: vscode.StatusBarItem;
let mainItem: vscode.StatusBarItem;

let unreadMessages = 0;
let lastIncrementAt = 0; // timestamp to debounce poll after local increment

function updateBadges(): void {
  mainItem.text = "$(flame) Trending";
  mainItem.tooltip = "Top GitHub Trending Repo & People";
  mainItem.show();

  if (!authManager.isSignedIn) {
    messageItem.hide();
    return;
  }

  const msgText = unreadMessages > 0 ? `$(mail) ${unreadMessages}` : "$(mail)";
  messageItem.text = msgText;
  messageItem.tooltip = `${unreadMessages} unread message${unreadMessages !== 1 ? "s" : ""}`;
  messageItem.show();

  log(`[Badge] messages=${unreadMessages} statusBar="${msgText}"`);

  chatPanelWebviewProvider?.setBadge(unreadMessages);
}

export async function fetchCounts(force = false): Promise<void> {
  if (!authManager.isSignedIn) { return; }
  // Skip if we just incremented locally (avoid overwriting with stale server count)
  if (!force && Date.now() - lastIncrementAt < 5000) { return; }
  try {
    const msgCount = await apiClient.getUnreadMessageCount();
    unreadMessages = msgCount;
    log(`[fetchCounts] API returned messages=${msgCount}`);
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
    updateBadges();
    if (authManager.isSignedIn) { fetchCounts(); }

    authManager.onDidChangeAuth((signedIn) => {
      if (signedIn) { fetchCounts(); }
      else { unreadMessages = 0; updateBadges(); }
    });

    // Periodic poll as fallback (WS may drop or miss events)
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

    realtimeClient.onUnreadCount((counts) => {
      // If WS payload has actual counts, use them; otherwise poll API
      if (typeof counts.messages === "number" && counts.messages > 0) {
        unreadMessages = counts.messages;
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
      lastIncrementAt = Date.now();
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
    context.subscriptions.push(mainItem, messageItem);
    log("Status bar registered");
  },
};
