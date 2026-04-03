import * as vscode from "vscode";
import type { ExtensionModule, TreeNode } from "../types";
import { apiClient, getOtherUser } from "../api";
import { authManager } from "../auth";
import { realtimeClient } from "../realtime";
import { configManager } from "../config";
import { log } from "../utils";

interface FriendInfo {
  login: string;
  name: string | null;
  avatar_url: string | null;
  bio: string | null;
  mutual: boolean;
  is_gitstar_user: boolean;
}

interface FriendStatus {
  online: boolean;
  lastSeen: number;
}

class FriendsProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;
  private _friends: FriendInfo[] = [];
  private _presence = new Map<string, FriendStatus>();
  private _synced = false;
  public unreadCounts = new Map<string, number>();

  async fetchAndRefresh(): Promise<void> {
    if (!authManager.isSignedIn) {
      this._friends = [];
      this._onDidChange.fire();
      return;
    }
    try {
      // Gitstar API first (has mutual status, is_gitstar_user)
      let following = await apiClient.getFollowing(1, 100);
      log(`Gitstar following: ${following.length}`);

      // Fallback: fetch from GitHub API if Gitstar empty (sync may not be done yet)
      if (following.length === 0 && authManager.token) {
        log("Fetching following from GitHub API...");
        following = await this.fetchGitHubFollowing(authManager.token);
        log(`GitHub following: ${following.length}`);
      }

      this._friends = following;

      // Fetch unread counts from conversations
      if (authManager.isSignedIn) {
        try {
          const conversations = await apiClient.getConversations();
          this.unreadCounts.clear();
          for (const conv of conversations) {
            const other = getOtherUser(conv, authManager.login);
            if (other && conv.unread_count > 0) {
              this.unreadCounts.set(other.login, conv.unread_count);
            }
          }
        } catch { /* ignore */ }
      }

      // Fetch presence (last_seen) for all friends
      const logins = this._friends.map((f) => f.login);
      try {
        const presence = await apiClient.getPresence(logins);
        const ONLINE_THRESHOLD = configManager.current.presenceHeartbeat * 5;
        for (const [login, lastSeen] of Object.entries(presence)) {
          if (lastSeen) {
            const ts = new Date(lastSeen).getTime();
            const isOnline = (Date.now() - ts) < ONLINE_THRESHOLD;
            this._presence.set(login, { online: isOnline, lastSeen: ts });
          }
        }
      } catch {
        log("Failed to fetch presence", "warn");
      }

      this._onDidChange.fire();
    } catch (err) {
      log(`Failed to fetch friends: ${err}`, "error");
    }
  }

  getFriends(): FriendInfo[] {
    return this._friends;
  }

  updatePresence(user: string, online: boolean): void {
    this._presence.set(user, { online, lastSeen: Date.now() });
    this._onDidChange.fire();
  }

  clearUnread(login: string): void {
    this.unreadCounts.delete(login);
    this._onDidChange.fire();
  }

  refresh(): void {
    this._onDidChange.fire();
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    const isOnline = element.contextValue === "friendOnline";
    const label = typeof element.label === "string" ? element.label : "";
    // Highlight (bold) the entire name for online friends
    const treeLabel: vscode.TreeItemLabel = isOnline
      ? { label, highlights: [[0, label.length]] }
      : { label };
    const item = new vscode.TreeItem(treeLabel, vscode.TreeItemCollapsibleState.None);
    item.id = element.id;
    item.description = element.description;
    item.tooltip = element.tooltip;
    item.iconPath = element.iconPath;
    item.contextValue = element.contextValue;
    item.command = element.command;
    return item;
  }

  getChildren(): TreeNode[] {
    if (!authManager.isSignedIn) {
      return [{ id: "friends-signin", label: "Sign in to see friends", iconPath: new vscode.ThemeIcon("sign-in"), command: { command: "trending.signIn", title: "Sign In" } }];
    }
    if (this._friends.length === 0) {
      return [{ id: "friends-empty", label: "No friends yet — follow someone!", iconPath: new vscode.ThemeIcon("person-add") }];
    }

    // Sort: online first, then by last seen (most recent first), then alphabetical
    const sorted = [...this._friends].sort((a, b) => {
      const sa = this._presence.get(a.login);
      const sb = this._presence.get(b.login);
      const onlineA = sa?.online ? 1 : 0;
      const onlineB = sb?.online ? 1 : 0;
      if (onlineA !== onlineB) { return onlineB - onlineA; }
      // Both same online status — sort by last seen (most recent first)
      const lastA = sa?.lastSeen ?? 0;
      const lastB = sb?.lastSeen ?? 0;
      if (lastA !== lastB) { return lastB - lastA; }
      return (a.name || a.login).localeCompare(b.name || b.login);
    });

    return sorted.map((person) => {
      const status = this._presence.get(person.login);
      const isOnline = status?.online ?? false;
      let desc = `@${person.login}`;
      if (isOnline) {
        desc += "  ·  online";
      } else if (status?.lastSeen) {
        desc += `  ·  ${timeAgoShort(status.lastSeen)}`;
      }
      const unread = this.unreadCounts.get(person.login);
      const unreadSuffix = unread ? ` (${unread})` : "";
      desc += unreadSuffix;

      return {
        id: `friend:${person.login}`,
        label: person.name || person.login,
        description: desc,
        tooltip: `${person.name || person.login} (@${person.login})${isOnline ? "\nOnline now" : "\nOffline"}${person.bio ? `\n${person.bio}` : ""}`,
        iconPath: vscode.Uri.parse(`https://github.com/${person.login}.png?size=32`),
        contextValue: isOnline ? "friendOnline" : "friend",
        command: { command: "trending.messageUser", title: "Message", arguments: [person.login] },
      };
    });
  }

  private async fetchGitHubFollowing(token: string): Promise<FriendInfo[]> {
    const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" };

    // Fetch following and followers in parallel
    const [followingRes, followersRes] = await Promise.all([
      fetch("https://api.github.com/user/following?per_page=100", { headers }),
      fetch("https://api.github.com/user/followers?per_page=100", { headers }),
    ]);

    if (!followingRes.ok || !followersRes.ok) {
      log("GitHub API fetch failed", "warn");
      return [];
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const following = (await followingRes.json()) as any[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const followers = (await followersRes.json()) as any[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const followerSet = new Set(followers.map((u: any) => u.login));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return following.map((u: any) => ({
      login: u.login,
      name: u.login,
      avatar_url: u.avatar_url,
      bio: null,
      mutual: followerSet.has(u.login),
      is_gitstar_user: false,
    }));
  }

  dispose(): void { this._onDidChange.dispose(); }
}

function timeAgoShort(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) { return "just now"; }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) { return `${minutes}m ago`; }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) { return `${hours}h ago`; }
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export let friendsProvider: FriendsProvider;

export const friendsModule: ExtensionModule = {
  id: "friends",
  activate(context) {
    friendsProvider = new FriendsProvider();
    const treeView = vscode.window.createTreeView("trending.friends", { treeDataProvider: friendsProvider, showCollapseAll: false });
    friendsProvider.fetchAndRefresh();

    // Listen for realtime presence updates
    const presenceSub = realtimeClient.onPresence(({ user, online }) => {
      friendsProvider.updatePresence(user, online);
    });

    // Refresh friends list when auth changes
    const authSub = authManager.onDidChangeAuth((signedIn) => {
      if (signedIn) { friendsProvider.fetchAndRefresh(); }
      else { friendsProvider.fetchAndRefresh(); }
    });

    const interval = setInterval(() => friendsProvider.fetchAndRefresh(), configManager.current.trendingPollInterval);
    context.subscriptions.push(treeView, friendsProvider, presenceSub, authSub, { dispose: () => clearInterval(interval) });
    log("Friends tree view registered");
  },
};
