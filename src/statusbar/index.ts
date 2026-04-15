import type { ExtensionModule } from "../types";
import { configManager } from "../config";
import { apiClient } from "../api";
import { authManager } from "../auth";
import { realtimeClient } from "../realtime";
import { log } from "../utils";
import { exploreWebviewProvider } from "../webviews/explore";
import { chatPanelWebviewProvider } from "../webviews/chat-panel";

let unreadMessages = 0;
let lastIncrementAt = 0;

function updateBadges(): void {
  if (!authManager.isSignedIn) { return; }
  // Push the message-only count to webviews so conversation list badges stay accurate.
  // Notification surfacing now lives in the title-bar bell + dropdown (not the status bar).
  exploreWebviewProvider?.setBadge(unreadMessages);
  chatPanelWebviewProvider?.setBadge(unreadMessages);
}

export async function fetchCounts(force = false): Promise<void> {
  if (!authManager.isSignedIn) { return; }
  if (!force && Date.now() - lastIncrementAt < 5000) { return; }
  try {
    const msgCount = await apiClient.getUnreadMessageCount();
    unreadMessages = msgCount;
    log(`[fetchCounts] messages=${msgCount}`);
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
      if (typeof counts.messages === "number" && counts.messages > 0) {
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

      unreadMessages++;
      lastIncrementAt = Date.now();
      updateBadges();
    });

    log("Status bar module registered (no UI items — bell now lives in title bar)");
  },
};
