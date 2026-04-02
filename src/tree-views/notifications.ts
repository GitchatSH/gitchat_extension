import * as vscode from "vscode";
import type { ExtensionModule, Notification, TreeNode } from "../types";
import { apiClient } from "../api";
import { authManager } from "../auth";
import { realtimeClient } from "../realtime";
import { log, timeAgo } from "../utils";

const NOTIF_ICONS: Record<string, string> = {
  follow: "person-add", star: "star", mention: "mention",
  message: "mail", like: "heart", comment: "comment",
};

class NotificationsProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;
  private _notifications: Notification[] = [];

  async fetchAndRefresh(): Promise<void> {
    if (!authManager.isSignedIn) { this._notifications = []; this._onDidChange.fire(); return; }
    try {
      this._notifications = await apiClient.getNotifications();
      this._onDidChange.fire();
    } catch (err) {
      log(`Failed to fetch notifications: ${err}`, "error");
    }
  }

  async markAllRead(): Promise<void> {
    const unreadIds = this._notifications.filter((n) => !n.read).map((n) => n.id);
    if (unreadIds.length === 0) { return; }
    try {
      await apiClient.markNotificationsRead(unreadIds);
      this._notifications.forEach((n) => (n.read = true));
      this._onDidChange.fire();
    } catch (err) {
      log(`Failed to mark notifications read: ${err}`, "error");
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
      return [{ id: "sign-in", label: "Sign in to see notifications", iconPath: new vscode.ThemeIcon("sign-in"), command: { command: "trending.signIn", title: "Sign In" } }];
    }
    if (this._notifications.length === 0) {
      return [{ id: "empty", label: "No notifications", iconPath: new vscode.ThemeIcon("bell-slash") }];
    }
    return this._notifications.map((notif) => ({
      id: `notif:${notif.id}`,
      label: notif.read ? notif.message : `$(circle-filled) ${notif.message}`,
      description: timeAgo(notif.created_at),
      tooltip: `${notif.actor}: ${notif.message}`,
      iconPath: new vscode.ThemeIcon(NOTIF_ICONS[notif.type] || "bell"),
      contextValue: "notification",
    }));
  }

  dispose(): void { this._onDidChange.dispose(); }
}

export let notificationsProvider: NotificationsProvider;

export const notificationsModule: ExtensionModule = {
  id: "notifications",
  activate(context) {
    notificationsProvider = new NotificationsProvider();
    const treeView = vscode.window.createTreeView("trending.notifications", { treeDataProvider: notificationsProvider, showCollapseAll: false });
    if (authManager.isSignedIn) { notificationsProvider.fetchAndRefresh(); }
    authManager.onDidChangeAuth(() => { notificationsProvider.fetchAndRefresh(); });
    realtimeClient.onNotification(() => { notificationsProvider.fetchAndRefresh(); });
    context.subscriptions.push(treeView, notificationsProvider);
    log("Notifications tree view registered");
  },
};
