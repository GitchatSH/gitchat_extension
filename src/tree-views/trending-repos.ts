import * as vscode from "vscode";
import type { ExtensionModule, TreeNode, TrendingRepo } from "../types";
import { apiClient } from "../api";
import { authManager } from "../auth";
import { configManager } from "../config";
import { formatCount, log } from "../utils";

class TrendingReposProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;
  private _repos: TrendingRepo[] = [];
  private starredMap: Record<string, boolean> = {};

  async fetchAndRefresh(): Promise<void> {
    try {
      this._repos = await apiClient.getTrendingRepos();
      if (authManager.isSignedIn && this._repos.length) {
        const slugs = this._repos.map((r) => `${r.owner}/${r.name}`);
        this.starredMap = await apiClient.batchCheckStarred(slugs);
      }
      this._onDidChange.fire();
    } catch (err) {
      log(`Failed to fetch trending repos: ${err}`, "error");
    }
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
    item.id = element.id;
    item.description = element.description;
    item.tooltip = element.tooltip;
    item.iconPath = element.iconPath;
    item.contextValue = element.contextValue;
    item.command = element.command;
    return item;
  }

  getChildren(): TreeNode[] {
    if (this._repos.length === 0) {
      return [{ id: "loading", label: "Loading trending repos...", iconPath: new vscode.ThemeIcon("loading~spin") }];
    }
    return this._repos.map((repo, i) => {
      const slug = `${repo.owner}/${repo.name}`;
      const starred = this.starredMap[slug] ?? false;
      return {
        id: `repo:${slug}`,
        label: `${i + 1}. ${slug}`,
        description: `${formatCount(repo.stars)} ⭐`,
        tooltip: repo.description || slug,
        iconPath: new vscode.ThemeIcon("repo"),
        contextValue: starred ? "trendingRepo:starred" : "trendingRepo:unstarred",
        command: { command: "trending.viewRepoDetail", title: "View Repo Detail", arguments: [repo.owner, repo.name] },
      };
    });
  }

  dispose(): void { this._onDidChange.dispose(); }
}

export let trendingReposProvider: TrendingReposProvider;

export const trendingReposModule: ExtensionModule = {
  id: "trendingRepos",
  activate(context) {
    trendingReposProvider = new TrendingReposProvider();
    const treeView = vscode.window.createTreeView("trending.trendingRepos", { treeDataProvider: trendingReposProvider, showCollapseAll: false });
    trendingReposProvider.fetchAndRefresh();
    const interval = setInterval(() => trendingReposProvider.fetchAndRefresh(), configManager.current.trendingPollInterval);
    context.subscriptions.push(treeView, trendingReposProvider, { dispose: () => clearInterval(interval) });
    log("Trending repos tree view registered");
  },
};
