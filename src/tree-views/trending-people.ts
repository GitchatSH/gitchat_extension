import * as vscode from "vscode";
import type { ExtensionModule, TreeNode, TrendingPerson } from "../types";
import { apiClient } from "../api";
import { configManager } from "../config";
import { formatCount, log } from "../utils";

class TrendingPeopleProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;
  private _people: TrendingPerson[] = [];

  async fetchAndRefresh(): Promise<void> {
    try {
      this._people = await apiClient.getTrendingPeople();
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
    return this._people.map((person, i) => ({
      id: `person:${person.login}`,
      label: `${i + 1}. ${person.name || person.login}`,
      description: person.star_power > 0 ? `⭐ ${formatCount(person.star_power)}` : `${formatCount(person.followers)} followers`,
      tooltip: person.bio || person.login,
      iconPath: new vscode.ThemeIcon("person"),
      contextValue: "trendingPerson",
      command: { command: "trending.viewProfile", title: "View Profile", arguments: [person.login] },
    }));
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
    const interval = setInterval(() => trendingPeopleProvider.fetchAndRefresh(), configManager.current.trendingPollInterval);
    context.subscriptions.push(treeView, trendingPeopleProvider, { dispose: () => clearInterval(interval) });
    log("Trending people tree view registered");
  },
};
