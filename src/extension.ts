import * as vscode from "vscode";
import type { ExtensionModule } from "./types";
import { log } from "./utils";

import { configModule } from "./config";
import { authModule } from "./auth";
import { apiClientModule } from "./api";
import { realtimeModule } from "./realtime";
import { commandsModule } from "./commands";
import { statusBarModule } from "./statusbar";
import { trendingReposModule } from "./tree-views/trending-repos";
import { trendingPeopleModule } from "./tree-views/trending-people";
import { feedModule } from "./tree-views/feed";
import { inboxModule } from "./tree-views/inbox";
import { notificationsModule } from "./tree-views/notifications";
import { repoDetailModule } from "./webviews/repo-detail";
import { profileModule } from "./webviews/profile";
import { chatModule } from "./webviews/chat";

const modules: ExtensionModule[] = [
  configModule,
  authModule,
  apiClientModule,
  realtimeModule,
  commandsModule,
  statusBarModule,
  trendingReposModule,
  trendingPeopleModule,
  feedModule,
  inboxModule,
  notificationsModule,
  repoDetailModule,
  profileModule,
  chatModule,
];

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  log("Activating extension...");
  for (const mod of modules) {
    try {
      await mod.activate(context);
      log(`Module "${mod.id}" activated`);
    } catch (err) {
      log(`Failed to activate module "${mod.id}": ${err}`, "error");
    }
  }
  log(`Extension activated with ${modules.length} modules`);
}

export async function deactivate(): Promise<void> {
  for (const mod of [...modules].reverse()) {
    try { await mod.deactivate?.(); }
    catch (err) { log(`Failed to deactivate module "${mod.id}": ${err}`, "error"); }
  }
}
