import * as vscode from "vscode";
import type { ExtensionModule } from "./types";
import { log } from "./utils";

import { configModule } from "./config";
import { authModule, authManager } from "./auth";
import { apiClientModule } from "./api";
import { messageCache } from "./services/message-cache";
import { realtimeModule } from "./realtime";
import { commandsModule } from "./commands";
import { statusBarModule } from "./statusbar";
import { chatPanelWebviewModule } from "./webviews/chat-panel";
import { exploreWebviewModule } from "./webviews/explore";
import { notificationsModule } from "./notifications";
import { profileModule } from "./webviews/profile";
import { telemetryModule } from "./telemetry";
import { welcomeModule } from "./webviews/welcome";
import { githubDataModule } from "./github-data";

const modules: ExtensionModule[] = [
  configModule,
  authModule,
  apiClientModule,
  realtimeModule,
  commandsModule,
  statusBarModule,
  exploreWebviewModule,
  chatPanelWebviewModule,
  notificationsModule,
  profileModule,
  welcomeModule,
  githubDataModule,
];

// Modules that must activate in order (config → auth → api → realtime → commands)
const essentialModules: ExtensionModule[] = [
  configModule, authModule, apiClientModule, realtimeModule, commandsModule,
];
// Modules that can activate in parallel (UI providers, tree views)
const parallelModules: ExtensionModule[] = [
  welcomeModule,
  telemetryModule,
  statusBarModule, exploreWebviewModule, chatPanelWebviewModule,
  notificationsModule,
  profileModule,
  githubDataModule,
];

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  log("Activating extension...");

  // Dispose any restored tabs from the retired editor-area ChatPanel surface.
  // Before commit 71c7983 the extension opened chats in the editor area via
  // `createWebviewPanel("gitchat.chat", ...)`. After the sidebar became the
  // only chat surface, tabs persisted across VS Code restarts via hot-exit
  // would otherwise render a stale HTML shell with a dead message channel.
  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer("gitchat.chat", {
      async deserializeWebviewPanel(panel: vscode.WebviewPanel, state: unknown): Promise<void> {
        panel.dispose();
        const convId = (state as { conversationId?: string } | null | undefined)?.conversationId;
        if (convId) {
          await vscode.commands.executeCommand("gitchat.openChat", convId);
        }
      },
    }),
  );

  // Essential modules must be sequential
  for (const mod of essentialModules) {
    try {
      await mod.activate(context);
      log(`Module "${mod.id}" activated`);
    } catch (err) {
      log(`Failed to activate module "${mod.id}": ${err}`, "error");
    }
  }
  // Message cache needs context + a login getter before any webview tries
  // to read it. Essential modules (auth) are already up at this point.
  messageCache.init(context, () => authManager.login);

  // UI modules can activate in parallel
  await Promise.allSettled(parallelModules.map(async (mod) => {
    try {
      await mod.activate(context);
      log(`Module "${mod.id}" activated`);
    } catch (err) {
      log(`Failed to activate module "${mod.id}": ${err}`, "error");
    }
  }));
  log(`Extension activated with ${modules.length} modules`);
}

export async function deactivate(): Promise<void> {
  for (const mod of [...modules].reverse()) {
    try { await mod.deactivate?.(); }
    catch (err) { log(`Failed to deactivate module "${mod.id}": ${err}`, "error"); }
  }
}
