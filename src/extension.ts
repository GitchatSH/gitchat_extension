import * as vscode from "vscode";
import type { ExtensionModule } from "./types";
import { log } from "./utils";

import { configModule } from "./config";
import { authModule } from "./auth";
import { apiClientModule } from "./api";
import { realtimeModule } from "./realtime";
import { commandsModule } from "./commands";
import { statusBarModule } from "./statusbar";
import { myReposModule } from "./tree-views/my-repos";
import { trendingReposModule } from "./tree-views/trending-repos";
import { trendingPeopleModule } from "./tree-views/trending-people";
import { whoToFollowWebviewModule } from "./webviews/who-to-follow";
import { chatPanelWebviewModule } from "./webviews/chat-panel";
import { feedWebviewModule } from "./webviews/feed";
import { notificationsWebviewModule } from "./webviews/notifications";
import { repoDetailModule } from "./webviews/repo-detail";
import { profileModule } from "./webviews/profile";
import { chatModule } from "./webviews/chat";
import { telemetryModule } from "./telemetry";

const modules: ExtensionModule[] = [
  configModule,
  authModule,
  apiClientModule,
  realtimeModule,
  commandsModule,
  statusBarModule,
  trendingReposModule,
  trendingPeopleModule,
  whoToFollowWebviewModule,
  myReposModule,
  chatPanelWebviewModule,
  feedWebviewModule,
  notificationsWebviewModule,
  repoDetailModule,
  profileModule,
  chatModule,
];

// Modules that must activate in order (config → auth → api → realtime → commands)
const essentialModules: ExtensionModule[] = [
  configModule, authModule, apiClientModule, realtimeModule, commandsModule,
];
// Modules that can activate in parallel (UI providers, tree views)
const parallelModules: ExtensionModule[] = [
  telemetryModule,
  statusBarModule, trendingReposModule, trendingPeopleModule,
  whoToFollowWebviewModule, myReposModule, chatPanelWebviewModule,
  feedWebviewModule, notificationsWebviewModule, repoDetailModule,
  profileModule, chatModule,
];

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  log("Activating extension...");
  // Essential modules must be sequential
  for (const mod of essentialModules) {
    try {
      await mod.activate(context);
      log(`Module "${mod.id}" activated`);
    } catch (err) {
      log(`Failed to activate module "${mod.id}": ${err}`, "error");
    }
  }
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
