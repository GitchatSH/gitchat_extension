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
      const result = await apiClient.getNotifications();
      this._notifications = Array.isArray(result) ? result : [];
      this._onDidChange.fire();
    } catch (err) {
      log(`Failed to fetch notifications: ${err}`, "error");
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private formatNotifMessage(type: string, actor: string, metadata?: any): string {
    const repo = metadata?.repo_slug ?? metadata?.repo ?? "";
    switch (type) {
      case "follow": return `${actor} followed you`;
      case "star": return `${actor} starred ${repo || "your repo"}`;
      case "mention": return `${actor} mentioned you`;
      case "message": return `${actor} sent you a message`;
      case "like": return `${actor} liked your post`;
      case "comment": return `${actor} commented`;
      default: return `${actor} — ${type}`;
    }
  }

  async markAllRead(): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const unreadIds = this._notifications.filter((n) => !(n as any).is_read && !n.read).map((n) => n.id);
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
    return this._notifications.map((notif) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = notif as any;
      const actor = raw.actor_login ?? raw.actor_name ?? notif.actor ?? "someone";
      const isRead = raw.is_read ?? notif.read ?? false;
      const msg = notif.message ?? this.formatNotifMessage(notif.type, actor, raw.metadata);
      return {
        id: `notif:${notif.id}`,
        label: isRead ? msg : `● ${msg}`,
        description: timeAgo(notif.created_at),
        tooltip: `${actor}: ${msg}`,
        iconPath: new vscode.ThemeIcon(NOTIF_ICONS[notif.type] || "bell"),
        contextValue: "notification",
      };
    });
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
