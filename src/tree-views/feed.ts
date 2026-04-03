import * as vscode from "vscode";
import type { ExtensionModule, FeedEvent, TreeNode } from "../types";
import { apiClient } from "../api";
import { authManager } from "../auth";
import { configManager } from "../config";
import { log, timeAgo } from "../utils";

const EVENT_ICONS: Record<string, string> = {
  commit: "git-commit", pr: "git-pull-request", issue: "issues",
  release: "package", star: "star", fork: "repo-forked",
};

class FeedProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;
  private _events: FeedEvent[] = [];

  async fetchAndRefresh(): Promise<void> {
    if (!authManager.isSignedIn) { this._events = []; this._onDidChange.fire(); return; }
    try {
      const result = await apiClient.getHomeFeed();
      this._events = Array.isArray(result) ? result : [];
      this._onDidChange.fire();
    } catch (err) {
      log(`Failed to fetch feed: ${err}`, "error");
    }
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
    item.id = element.id; item.description = element.description; item.tooltip = element.tooltip;
    item.iconPath = element.iconPath; item.contextValue = element.contextValue; item.command = element.command;
    return item;
  }

  getChildren(): TreeNode[] {
    if (!authManager.isSignedIn) {
      return [{ id: "sign-in", label: "Sign in to see your feed", iconPath: new vscode.ThemeIcon("sign-in"), command: { command: "trending.signIn", title: "Sign In" } }];
    }
    if (this._events.length === 0) {
      return [{ id: "empty", label: "No feed events yet", iconPath: new vscode.ThemeIcon("info") }];
    }
    return this._events.map((event) => ({
      id: `event:${event.id}`,
      label: event.title,
      description: `${event.repo_slug} · ${timeAgo(event.created_at)}`,
      tooltip: event.narration || event.title,
      iconPath: new vscode.ThemeIcon(EVENT_ICONS[event.type] || "pulse"),
      contextValue: "feedEvent",
      command: { command: "trending.openOnGithub", title: "Open on GitHub", arguments: [event.url] },
    }));
  }

  getEvent(nodeId: string): FeedEvent | undefined {
    const eventId = nodeId.replace("event:", "");
    return this._events.find((e) => e.id === eventId);
  }

  dispose(): void { this._onDidChange.dispose(); }
}

export let feedProvider: FeedProvider;

export const feedModule: ExtensionModule = {
  id: "feed",
  activate(context) {
    feedProvider = new FeedProvider();
    const treeView = vscode.window.createTreeView("trending.feed", { treeDataProvider: feedProvider, showCollapseAll: false });
    if (authManager.isSignedIn) { feedProvider.fetchAndRefresh(); }
    authManager.onDidChangeAuth(() => { feedProvider.fetchAndRefresh(); });
    const interval = setInterval(() => feedProvider.fetchAndRefresh(), configManager.current.feedPollInterval);
    context.subscriptions.push(treeView, feedProvider, { dispose: () => clearInterval(interval) });
    log("Feed tree view registered");
  },
};
