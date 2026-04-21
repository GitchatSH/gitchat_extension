import * as vscode from "vscode";
import type { ExtensionConfig, ExtensionModule } from "../types";
import { log } from "../utils";

class ConfigManager {
  private _config!: ExtensionConfig;
  private readonly _onDidChange = new vscode.EventEmitter<ExtensionConfig>();
  readonly onDidChange = this._onDidChange.event;

  private _windowFocused = true;
  private readonly _onDidChangeFocus = new vscode.EventEmitter<boolean>();
  readonly onDidChangeFocus = this._onDidChangeFocus.event;

  get windowFocused(): boolean {
    return this._windowFocused;
  }

  setWindowFocused(focused: boolean): void {
    if (this._windowFocused !== focused) {
      this._windowFocused = focused;
      this._onDidChangeFocus.fire(focused);
      log(`Window focus: ${focused}`);
    }
  }

  constructor() {
    this.reload();
  }

  get current(): ExtensionConfig {
    return this._config;
  }

  reload(): void {
    const ws = vscode.workspace.getConfiguration("gitchat");
    const trending = vscode.workspace.getConfiguration("trending");
    this._config = {
      apiUrl: process.env.GITCHAT_API_URL as string,
      wsUrl: process.env.GITCHAT_WS_URL as string,
      githubClientId: ws.get<string>("githubClientId", process.env.GITCHAT_GITHUB_CLIENT_ID as string),
      presenceHeartbeat: ws.get<number>("presenceHeartbeat", 60000),
      showMessageNotifications: ws.get<boolean>("showMessageNotifications", true),
      messageSound: ws.get<boolean>("messageSound", false),
      debugLogs: ws.get<boolean>("debugLogs", false),
      wsDiscoverOnlineNow: trending.get<boolean>("wsDiscoverOnlineNow", false),
    };
    this._onDidChange.fire(this._config);
  }

  dispose(): void {
    this._onDidChange.dispose();
    this._onDidChangeFocus.dispose();
  }
}

export const configManager = new ConfigManager();

export const configModule: ExtensionModule = {
  id: "config",
  activate(context) {
    context.subscriptions.push(
      vscode.window.onDidChangeWindowState((state) => {
        configManager.setWindowFocused(state.focused);
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("gitchat") || e.affectsConfiguration("trending")) {
          configManager.reload();
          log("Configuration reloaded");
        }
      }),
      configManager
    );
  },
};
