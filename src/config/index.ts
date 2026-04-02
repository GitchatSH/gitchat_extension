import * as vscode from "vscode";
import type { ExtensionConfig, ExtensionModule } from "../types";
import { log } from "../utils";

class ConfigManager {
  private _config!: ExtensionConfig;
  private readonly _onDidChange = new vscode.EventEmitter<ExtensionConfig>();
  readonly onDidChange = this._onDidChange.event;

  constructor() {
    this.reload();
  }

  get current(): ExtensionConfig {
    return this._config;
  }

  reload(): void {
    const ws = vscode.workspace.getConfiguration("trending");
    this._config = {
      apiUrl: ws.get<string>("apiUrl", "https://api.gitstar.ai/api/v1"),
      trendingPollInterval: ws.get<number>("trendingPollInterval", 300000),
      feedPollInterval: ws.get<number>("feedPollInterval", 120000),
      presenceHeartbeat: ws.get<number>("presenceHeartbeat", 60000),
    };
    this._onDidChange.fire(this._config);
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}

export const configManager = new ConfigManager();

export const configModule: ExtensionModule = {
  id: "config",
  activate(context) {
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("trending")) {
          configManager.reload();
          log("Configuration reloaded");
        }
      }),
      configManager
    );
  },
};
