import * as vscode from "vscode";
import type { ExtensionModule, TreeNode, TrendingPerson } from "../types";
import { apiClient } from "../api";
import { authManager } from "../auth";
import { configManager } from "../config";
import { log } from "../utils";
import { onDidChangeFollow } from "../events/follow";

class TrendingPeopleProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;
  private _people: TrendingPerson[] = [];
  private followMap: Record<string, boolean> = {};

  async fetchAndRefresh(): Promise<void> {
    try {
      this._people = await apiClient.getTrendingPeople();
      if (authManager.isSignedIn && this._people.length) {
        const logins = this._people.map((p) => p.login);
        const statuses = await apiClient.batchFollowStatus(logins);
        this.followMap = {};
        for (const [login, status] of Object.entries(statuses)) {
          this.followMap[login] = (status as { following: boolean }).following;
        }
      }
      this._onDidChange.fire();
    } catch (err) {
      log(`Failed to fetch trending people: ${err}`, "error");
    }
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
    item.id = element.id; item.description = element.description; item.tooltip = element.tooltip;
    item.iconPath = element.iconPath; item.contextValue = element.contextValue; item.command = element.command;
    return item;
  }

  getChildren(): TreeNode[] {
    if (this._people.length === 0) {
      return [{ id: "loading", label: "Loading trending people...", iconPath: new vscode.ThemeIcon("loading~spin") }];
    }
    return this._people.map((person, i) => {
      const following = this.followMap[person.login] ?? false;
      return {
        id: `person:${person.login}`,
        label: `${i + 1}. ${person.name || person.login}`,
        description: `⭐ ${Math.round((person.star_power || person.followers || 0) * 10) / 10} star power`,
        tooltip: person.bio || person.login,
        iconPath: new vscode.ThemeIcon("person"),
        contextValue: following ? "trendingPerson:following" : "trendingPerson:notFollowing",
        command: { command: "trending.viewProfile", title: "View Profile", arguments: [person.login] },
      };
    });
  }

  /** Update follow state for a single user without refetching everything */
  setFollowState(username: string, following: boolean): void {
    this.followMap[username] = following;
    this._onDidChange.fire();
  }

  dispose(): void { this._onDidChange.dispose(); }
}

export let trendingPeopleProvider: TrendingPeopleProvider;

export const trendingPeopleModule: ExtensionModule = {
  id: "trendingPeople",
  activate(context) {
    trendingPeopleProvider = new TrendingPeopleProvider();
    const treeView = vscode.window.createTreeView("trending.trendingPeople", { treeDataProvider: trendingPeopleProvider, showCollapseAll: false });
    trendingPeopleProvider.fetchAndRefresh();

    let interval = setInterval(() => trendingPeopleProvider.fetchAndRefresh(), configManager.current.trendingPollInterval);

    configManager.onDidChangeFocus((focused) => {
      clearInterval(interval);
      if (focused) {
        trendingPeopleProvider.fetchAndRefresh();
        interval = setInterval(() => trendingPeopleProvider.fetchAndRefresh(), configManager.current.trendingPollInterval);
      } else {
        interval = setInterval(() => trendingPeopleProvider.fetchAndRefresh(), configManager.current.trendingPollInterval * 3);
      }
    });

    // Sync follow state changes from other components
    const followSub = onDidChangeFollow((e) => {
      trendingPeopleProvider.setFollowState(e.username, e.following);
    });

    context.subscriptions.push(treeView, trendingPeopleProvider, followSub, { dispose: () => clearInterval(interval) });
    log("Trending people tree view registered");
  },
};
