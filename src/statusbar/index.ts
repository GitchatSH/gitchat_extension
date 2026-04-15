import type { ExtensionModule } from "../types";
import { configManager } from "../config";
import { apiClient } from "../api";
import { authManager } from "../auth";
import { realtimeClient } from "../realtime";
import { log } from "../utils";
import { exploreWebviewProvider } from "../webviews/explore";

let unreadMessages = 0;

function updateBadges(): void {
  if (!authManager.isSignedIn) { return; }
  exploreWebviewProvider?.setBadge(unreadMessages);
}

/** Optimistic badge decrement — call after successfully marking a conversation read. */
export function decrementUnread(): void {
  if (unreadMessages > 0) {
    unreadMessages--;
    updateBadges();
  }
}

export async function fetchCounts(): Promise<void> {
  if (!authManager.isSignedIn) { return; }
  try {
    const msgCount = await apiClient.getUnreadMessageCount();
    unreadMessages = msgCount;
    updateBadges();
  } catch (err) {
    log(`[fetchCounts] failed: ${err}`, "warn");
  }
}

export const statusBarModule: ExtensionModule = {
  id: "statusBar",
  activate(context) {
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

    realtimeClient.onUnreadCount((counts) => {
      if (typeof counts.messages === "number") {
        unreadMessages = counts.messages;
        updateBadges();
      } else {
        fetchCounts();
      }
    });

    // Bump the badge for every incoming message. Toast surfacing is owned
    // entirely by the notifications module (listens to notification:new via
    // toastCoordinator). We used to show a direct showInformationMessage
    // here too, which double-fired against the notifications pipeline.
    realtimeClient.onNewMessage((msg) => {
      const msgRecord = msg as unknown as Record<string, unknown>;
      const sender = (msgRecord.sender_login as string | undefined) || (msgRecord.sender as string | undefined);
      if (sender === authManager.login) { return; }

      // Let BE-authoritative onUnreadCount/fetchCounts handle the badge count.
      fetchCounts();

      const content = ((msgRecord.body as string | undefined) || (msgRecord.content as string | undefined)) ?? "";
      const preview = content.length > 60 ? content.slice(0, 60) + "..." : content;
      const conversationId = msgRecord.conversation_id as string | undefined;
      const isChatOpen = conversationId ? ChatPanel.isOpen(conversationId) : false;

      const { chatPanelWebviewProvider: chatPanel } = await import("../webviews/chat-panel");
      const isMuted = conversationId ? chatPanel?.isConversationMuted(conversationId) : false;
      const isSidebarChatOpen = conversationId ? exploreWebviewProvider?.isConversationOpen(conversationId) : false;
      if (mentionsSelf(content, authManager.login ?? undefined)) { return; }

      if (!isChatOpen && !isSidebarChatOpen && !isMuted && sender && configManager.current.showMessageNotifications) {
        const action = await vscode.window.showInformationMessage(
          `${sender}: ${preview}`,
          "Open Chat",
          "Dismiss",
        );
        if (action === "Open Chat" && conversationId) {
          vscode.commands.executeCommand("gitchat.openChat", conversationId);
        }
      }

    });
  },
};
