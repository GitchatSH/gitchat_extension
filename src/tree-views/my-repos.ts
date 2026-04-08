import * as vscode from "vscode";
import type { ExtensionModule, TreeNode, UserRepo } from "../types";
import { apiClient } from "../api";
import { authManager } from "../auth";
import { configManager } from "../config";
import { formatCount, log } from "../utils";

type GroupId = "group:public" | "group:private" | "group:starred";

class MyReposProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;
  private _repos: UserRepo[] = [];
  private _starred: UserRepo[] = [];

  async fetchAndRefresh(): Promise<void> {
    if (!authManager.isSignedIn) {
      this._repos = [];
      this._starred = [];
      this._onDidChange.fire();
      return;
    }
    try {
      const [repos, starred] = await Promise.all([
        apiClient.getUserRepos().catch(() => [] as UserRepo[]),
        apiClient.getStarredRepos().catch(() => [] as UserRepo[]),
      ]);
      this._repos = repos;
      this._starred = starred;
      this._onDidChange.fire();
    } catch (err) {
      log(`Failed to fetch my repos: ${err}`, "error");
    }
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    const item = new vscode.TreeItem(element.label, element.collapsibleState ?? vscode.TreeItemCollapsibleState.None);
    item.id = element.id;
    item.description = element.description;
    item.tooltip = element.tooltip;
    item.iconPath = element.iconPath;
    item.contextValue = element.contextValue;
    item.command = element.command;
    return item;
  }

  getChildren(element?: TreeNode): TreeNode[] {
    if (!authManager.isSignedIn) {
      return [{ id: "myrepos-signin", label: "Sign in to see your repos", iconPath: new vscode.ThemeIcon("sign-in"), command: { command: "trending.signIn", title: "Sign In" } }];
    }
    if (this._repos.length === 0 && this._starred.length === 0) {
      return [{ id: "myrepos-loading", label: "Loading repos...", iconPath: new vscode.ThemeIcon("loading~spin") }];
    }

    if (!element) {
      const publicRepos = this._repos.filter((r) => !r.private);
      const privateRepos = this._repos.filter((r) => r.private);
      const nodes: TreeNode[] = [];

      nodes.push({
        id: "group:public",
        label: `Public (${publicRepos.length})`,
        iconPath: new vscode.ThemeIcon("repo"),
        collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
      });
      nodes.push({
        id: "group:private",
        label: `Private (${privateRepos.length})`,
        iconPath: new vscode.ThemeIcon("lock"),
        collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
      });
      nodes.push({
        id: "group:starred",
        label: `Starred (${this._starred.length})`,
        iconPath: new vscode.ThemeIcon("star-full"),
        collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
      });
      return nodes;
    }

    const groupId = element.id as GroupId;
    let repos: UserRepo[];
    if (groupId === "group:public") {
      repos = this._repos.filter((r) => !r.private);
    } else if (groupId === "group:private") {
      repos = this._repos.filter((r) => r.private);
    } else {
      repos = this._starred;
    }

    if (repos.length === 0) {
      const emptyMsg = groupId === "group:starred" ? "No starred repos yet" : "No repos";
      return [{ id: `${groupId}:empty`, label: emptyMsg, iconPath: new vscode.ThemeIcon("info") }];
    }

    return repos.map((repo) => ({
      id: `${groupId === "group:starred" ? "starred" : "myrepo"}:${repo.owner}/${repo.name}`,
      label: repo.name,
      description: `${formatCount(repo.stars)} ⭐${repo.language ? `  ·  ${repo.language}` : ""}`,
      tooltip: `${repo.owner}/${repo.name}${repo.description ? `\n${repo.description}` : ""}`,
      iconPath: new vscode.ThemeIcon(repo.private ? "lock" : "repo"),
      contextValue: "myRepo",
      command: { command: "trending.viewRepoDetail", title: "View Repo Detail", arguments: [repo.owner, repo.name] },
    }));
  }

  dispose(): void { this._onDidChange.dispose(); }
}

export let myReposProvider: MyReposProvider;

export const myReposModule: ExtensionModule = {
  id: "myRepos",
  activate(context) {
    myReposProvider = new MyReposProvider();
    const treeView = vscode.window.createTreeView("trending.myRepos", { treeDataProvider: myReposProvider, showCollapseAll: true });
    if (authManager.isSignedIn) { myReposProvider.fetchAndRefresh(); }

    const authSub = authManager.onDidChangeAuth((signedIn) => {
      if (signedIn) { myReposProvider.fetchAndRefresh(); }
      else { myReposProvider.fetchAndRefresh(); }
    });

    const interval = setInterval(() => {
      if (authManager.isSignedIn) { myReposProvider.fetchAndRefresh(); }
    }, configManager.current.trendingPollInterval);

    context.subscriptions.push(treeView, myReposProvider, authSub, { dispose: () => clearInterval(interval) });
    log("My Repos tree view registered");
  },
};
