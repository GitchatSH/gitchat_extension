import * as vscode from "vscode";
import type { ExtensionModule, Notification } from "../types";
import { authManager } from "../auth";
import { realtimeClient } from "../realtime";
import { configManager } from "../config";
import { log } from "../utils";
import { decideToast, describeNotification } from "./toast-rules";
import { notificationStore } from "./notification-store";
import { toastCoordinator } from "./toast-coordinator";
import { NativeRenderer } from "./renderers/native-renderer";
import { WebviewRenderer } from "./renderers/webview-renderer";

export { notificationStore };

function _makeDebugNotification(): Notification {
  const samples = [
    { login: "octocat", name: "The Octocat", preview: "Mảnh ghép cuối cùng của thế hệ này là Sulli" },
    { login: "torvalds", name: "Linus Torvalds", preview: "Đây rồi" },
    { login: "gaearon", name: "Dan Abramov", preview: "a nhận được chưa?" },
    { login: "sindresorhus", name: "Sindre Sorhus", preview: "Phần mobile chắc còn nhiều vấn đề" },
  ];
  const pick = samples[Math.floor(Math.random() * samples.length)];
  return {
    id: `debug:${Date.now()}`,
    type: "new_message",
    recipient_login: authManager.login ?? "debug-user",
    actor_login: pick.login,
    actor_name: pick.name,
    actor_avatar_url: null,
    metadata: {
      conversationId: `debug-conv:${Date.now()}`,
      preview: pick.preview,
    },
    is_read: false,
    created_at: new Date().toISOString(),
  };
}

async function handleIncoming(notification: Notification): Promise<void> {
  if (!authManager.isSignedIn) { return; }

  // Drop events that aren't addressed to the current user. This can happen
  // when the socket is joined to a room that fans out events for another
  // user (e.g. presence rooms during the fix for #120). Defense in depth —
  // the server-side fix owns correctness; this guards against regressions.
  if (notification.recipient_login !== authManager.login) { return; }

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

      const { exploreWebviewProvider } = await import("../webviews/explore");
      isChatOpen = exploreWebviewProvider?.isShowingChat(conversationId) ?? false;
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
    // Build renderer pair + route-context provider; inject into coordinator.
    const native = new NativeRenderer();
    // Lazy-load explore provider reference — it activates in a different module
    // and may not be ready at this exact moment, so defer via getter.
    // The explore provider pulls this renderer back at resolveWebviewView time
    // via toastCoordinator.getWebviewRenderer() — that's what wires the
    // handleAction/setReady callback path regardless of activation order.
    let webview: WebviewRenderer | null = null;
    const getWebviewRenderer = (): WebviewRenderer => {
      if (!webview) {
        // Poster indirection: explore provider exposes .view.webview only after activation
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { exploreWebviewProvider } = require("../webviews/explore") as typeof import("../webviews/explore");
        webview = new WebviewRenderer({
          postMessage: (msg) => {
            const w = exploreWebviewProvider?.view?.webview;
            if (!w) { return false; }
            return w.postMessage(msg);
          },
        });
      }
      return webview;
    };

    toastCoordinator.setRenderers(
      getWebviewRenderer(),
      native,
      () => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { exploreWebviewProvider } = require("../webviews/explore") as typeof import("../webviews/explore");
        return {
          viewVisible: exploreWebviewProvider?.view?.visible ?? false,
          windowFocused: vscode.window.state.focused,
        };
      },
    );

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
      // Dev helper: fire a sample webview toast so styling can iterate without
      // needing a second signed-in account sending real messages. Each press
      // enqueues one toast through the full coordinator pipeline.
      vscode.commands.registerCommand("gitchat.debugShowToast", async () => {
        const fake = _makeDebugNotification();
        const { title, body } = describeNotification(fake);
        await toastCoordinator.enqueue(fake, title, body);
      }),
      // Force native toast regardless of sidebar visible / window focused state —
      // for quickly previewing the system-toast fallback look + buttons.
      vscode.commands.registerCommand("gitchat.debugShowToastNative", async () => {
        const fake = _makeDebugNotification();
        const { title, body } = describeNotification(fake);
        const message = body ? `${title}: ${body}` : title;
        const picked = await vscode.window.showInformationMessage(message, "Open Chat", "Dismiss");
        log(`[Notifications] debug native toast picked: ${picked ?? "dismissed"}`);
      }),
    );

    log("Notifications module activated");
  },
};
