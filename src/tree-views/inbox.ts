import * as vscode from "vscode";
import type { Conversation, ExtensionModule, TreeNode } from "../types";
import { apiClient } from "../api";
import { authManager } from "../auth";
import { realtimeClient } from "../realtime";
import { log, timeAgo } from "../utils";

class InboxProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;
  private _conversations: Conversation[] = [];

  async fetchAndRefresh(): Promise<void> {
    if (!authManager.isSignedIn) { this._conversations = []; this._onDidChange.fire(); return; }
    try {
      this._conversations = await apiClient.getConversations();
      this._onDidChange.fire();
    } catch (err) {
      log(`Failed to fetch conversations: ${err}`, "error");
    }
  }

  getConversation(nodeId: string): Conversation | undefined {
    const id = nodeId.replace("conv:", "").replace("request:", "");
    return this._conversations.find((c) => c.id === id);
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    const item = new vscode.TreeItem(element.label, element.collapsibleState ?? vscode.TreeItemCollapsibleState.None);
    item.id = element.id; item.description = element.description; item.tooltip = element.tooltip;
    item.iconPath = element.iconPath; item.contextValue = element.contextValue; item.command = element.command;
    return item;
  }

  getChildren(element?: TreeNode): TreeNode[] {
    if (!authManager.isSignedIn) {
      return [{ id: "sign-in", label: "Sign in to see messages", iconPath: new vscode.ThemeIcon("sign-in"), command: { command: "trending.signIn", title: "Sign In" } }];
    }
    if (element) {
      const isRequests = element.id === "group:requests";
      return this._conversations
        .filter((c) => c.is_request === isRequests)
        .filter((c) => isRequests || !c.pinned)
        .map((c) => this.conversationToNode(c));
    }
    const pinned = this._conversations.filter((c) => c.pinned && !c.is_request);
    const requests = this._conversations.filter((c) => c.is_request);
    const nodes: TreeNode[] = [];
    for (const c of pinned) { nodes.push(this.conversationToNode(c)); }
    const normalCount = this._conversations.filter((c) => !c.is_request && !c.pinned).length;
    if (normalCount > 0 || pinned.length === 0) {
      nodes.push({ id: "group:conversations", label: "Conversations", iconPath: new vscode.ThemeIcon("comment-discussion"), collapsibleState: vscode.TreeItemCollapsibleState.Expanded });
    }
    if (requests.length > 0) {
      nodes.push({ id: "group:requests", label: `Message Requests (${requests.length})`, iconPath: new vscode.ThemeIcon("mail"), collapsibleState: vscode.TreeItemCollapsibleState.Collapsed });
    }
    return nodes;
  }

  private conversationToNode(conv: Conversation): TreeNode {
    const other = conv.participants[0];
    const unread = conv.unread_count > 0 ? ` (${conv.unread_count})` : "";
    const preview = conv.last_message?.content.slice(0, 40) || "";
    const pin = conv.pinned ? "$(pin) " : "";
    const online = other?.online ? "$(circle-filled) " : "";
    return {
      id: conv.is_request ? `request:${conv.id}` : `conv:${conv.id}`,
      label: `${pin}${online}${other?.name || other?.login || "Unknown"}${unread}`,
      description: preview ? `${preview} · ${timeAgo(conv.updated_at)}` : timeAgo(conv.updated_at),
      tooltip: `Chat with ${other?.login || "Unknown"}`,
      iconPath: new vscode.ThemeIcon(conv.unread_count > 0 ? "mail-read" : "comment"),
      contextValue: "conversation",
      command: { command: "trending.openChat", title: "Open Chat", arguments: [conv.id] },
    };
  }

  dispose(): void { this._onDidChange.dispose(); }
}

export let inboxProvider: InboxProvider;

export const inboxModule: ExtensionModule = {
  id: "inbox",
  activate(context) {
    inboxProvider = new InboxProvider();
    const treeView = vscode.window.createTreeView("trending.inbox", { treeDataProvider: inboxProvider, showCollapseAll: false });
    if (authManager.isSignedIn) { inboxProvider.fetchAndRefresh(); }
    authManager.onDidChangeAuth(() => { inboxProvider.fetchAndRefresh(); });
    realtimeClient.onNewMessage(() => { inboxProvider.fetchAndRefresh(); });
    context.subscriptions.push(treeView, inboxProvider);
    log("Inbox tree view registered");
  },
};
