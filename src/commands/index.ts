import * as vscode from "vscode";
import type { CommandDefinition, ExtensionModule } from "../types";
import { authManager } from "../auth";
import { apiClient } from "../api";
import { log } from "../utils";
import { myReposProvider } from "../tree-views/my-repos";
import { trendingReposProvider } from "../tree-views/trending-repos";
import { trendingPeopleProvider } from "../tree-views/trending-people";
import { chatPanelWebviewProvider } from "../webviews/chat-panel";
import { feedWebviewProvider } from "../webviews/feed";
import { notificationsWebviewProvider } from "../webviews/notifications";
import { RepoDetailPanel } from "../webviews/repo-detail";
import { ProfilePanel } from "../webviews/profile";
import { ChatPanel } from "../webviews/chat";

let extensionUri: vscode.Uri;

const commands: CommandDefinition[] = [
  { id: "trending.signIn", handler: () => authManager.signIn() },
  { id: "trending.signOut", handler: () => authManager.signOut() },
  { id: "trending.browseTrendingRepos", handler: () => vscode.commands.executeCommand("trending.trendingRepos.focus") },
  { id: "trending.browseTrendingPeople", handler: () => vscode.commands.executeCommand("trending.trendingPeople.focus") },
  { id: "trending.openFeed", handler: () => vscode.commands.executeCommand("trending.feed.focus") },
  { id: "trending.openInbox", handler: () => vscode.commands.executeCommand("trending.inbox.focus") },
  { id: "trending.openNotifications", handler: () => vscode.commands.executeCommand("trending.notifications.focus") },
  { id: "trending.friends.refresh", handler: () => chatPanelWebviewProvider?.refresh() },
  { id: "trending.myRepos.refresh", handler: () => myReposProvider?.fetchAndRefresh() },
  { id: "trending.trendingRepos.refresh", handler: () => trendingReposProvider?.fetchAndRefresh() },
  { id: "trending.trendingPeople.refresh", handler: () => trendingPeopleProvider?.fetchAndRefresh() },
  { id: "trending.feed.refresh", handler: () => feedWebviewProvider?.refresh() },
  { id: "trending.inbox.refresh", handler: () => chatPanelWebviewProvider?.refresh() },
  { id: "trending.notifications.refresh", handler: () => notificationsWebviewProvider?.refresh() },
  {
    id: "trending.notifications.markAllRead",
    handler: async () => {
      try { await apiClient.markNotificationsRead([]); notificationsWebviewProvider?.refresh(); }
      catch { vscode.window.showErrorMessage("Failed to mark notifications as read"); }
    },
  },
  {
    id: "trending.starRepo",
    handler: async (...args: unknown[]) => {
      const node = args[0] as { id?: string } | undefined;
      if (!node?.id) { return; }
      const slug = node.id.replace("repo:", "");
      const [owner, repo] = slug.split("/");
      if (!owner || !repo) { return; }
      try { await apiClient.starRepo(owner, repo); vscode.window.showInformationMessage(`Starred ${slug}`); }
      catch { vscode.window.showErrorMessage(`Failed to star ${slug}`); }
    },
  },
  {
    id: "trending.unstarRepo",
    handler: async (...args: unknown[]) => {
      const node = args[0] as { id?: string } | undefined;
      if (!node?.id) { return; }
      const slug = node.id.replace("repo:", "");
      const [owner, repo] = slug.split("/");
      if (!owner || !repo) { return; }
      try { await apiClient.unstarRepo(owner, repo); vscode.window.showInformationMessage(`Unstarred ${slug}`); }
      catch { vscode.window.showErrorMessage(`Failed to unstar ${slug}`); }
    },
  },
  {
    id: "trending.followUser",
    handler: async (...args: unknown[]) => {
      const node = args[0] as { id?: string } | undefined;
      if (!node?.id) { return; }
      const username = node.id.replace("person:", "");
      try { await apiClient.followUser(username); vscode.window.showInformationMessage(`Following @${username}`); }
      catch { vscode.window.showErrorMessage(`Failed to follow @${username}`); }
    },
  },
  {
    id: "trending.unfollowUser",
    handler: async (...args: unknown[]) => {
      const node = args[0] as { id?: string } | undefined;
      if (!node?.id) { return; }
      const username = node.id.replace("person:", "");
      try { await apiClient.unfollowUser(username); vscode.window.showInformationMessage(`Unfollowed @${username}`); }
      catch { vscode.window.showErrorMessage(`Failed to unfollow @${username}`); }
    },
  },
  {
    id: "trending.likeEvent",
    handler: async (...args: unknown[]) => {
      const node = args[0] as { repoSlug?: string; eventId?: string } | undefined;
      if (!node?.repoSlug || !node?.eventId) { return; }
      const [owner, repo] = node.repoSlug.split("/");
      if (!owner || !repo) { return; }
      try { await apiClient.toggleLike(owner, repo, node.eventId); }
      catch { vscode.window.showErrorMessage("Failed to like event"); }
    },
  },
  {
    id: "trending.openOnGithub",
    handler: (...args: unknown[]) => {
      const url = args[0] as string | undefined;
      if (url && typeof url === "string") { vscode.env.openExternal(vscode.Uri.parse(url)); }
    },
  },
  {
    id: "trending.viewRepoDetail",
    handler: async (...args: unknown[]) => {
      const owner = args[0] as string;
      const repo = args[1] as string;
      if (owner && repo) { await RepoDetailPanel.show(extensionUri, owner, repo); }
    },
  },
  {
    id: "trending.viewProfile",
    handler: async (...args: unknown[]) => {
      const username = args[0] as string | undefined;
      if (username) { await ProfilePanel.show(extensionUri, username); }
    },
  },
  {
    id: "trending.viewMyProfile",
    handler: async () => {
      try { const profile = await apiClient.getMyProfile(); await ProfilePanel.show(extensionUri, profile.login); }
      catch { vscode.window.showErrorMessage("Sign in first to view your profile"); }
    },
  },
  {
    id: "trending.messageUser",
    handler: async (...args: unknown[]) => {
      let username = args[0] as string | undefined;
      if (!username) {
        username = await vscode.window.showInputBox({ prompt: "Enter GitHub username to message", placeHolder: "@username" });
      }
      if (!username) { return; }
      username = username.replace("@", "");
      try {
        const conv = await apiClient.createConversation(username);
        log(`Created conversation ${conv.id} with ${username}`);
        await ChatPanel.show(extensionUri, conv.id, username);
      } catch (err: unknown) {
        const axiosErr = err as { response?: { status?: number; data?: unknown }; message?: string };
        const detail = axiosErr.response?.data ? JSON.stringify(axiosErr.response.data).slice(0, 300) : axiosErr.message;
        log(`Failed to create conversation with ${username}: ${axiosErr.response?.status} ${detail}`, "error");
        vscode.window.showErrorMessage(`Failed to start conversation with @${username}: ${axiosErr.response?.status || "unknown error"}`);
      }
    },
  },
  {
    id: "trending.openChat",
    handler: async (...args: unknown[]) => {
      const conversationId = args[0] as string | undefined;
      if (conversationId) { await ChatPanel.show(extensionUri, conversationId); }
    },
  },
  {
    id: "trending.friends.search",
    handler: async () => {
      if (!authManager.isSignedIn) {
        vscode.window.showWarningMessage("Sign in first to message friends");
        return;
      }
      let friends: { login: string; name?: string | null }[] = [];
      try { friends = await apiClient.getFollowing(1, 100); } catch { /* ignore */ }
      if (friends.length === 0) {
        const username = await vscode.window.showInputBox({ prompt: "Enter GitHub username to message", placeHolder: "@username" });
        if (!username) { return; }
        vscode.commands.executeCommand("trending.messageUser", username.replace("@", ""));
        return;
      }
      const picks = friends.map((f) => ({
        label: `$(comment-discussion) ${f.name || f.login}`,
        description: `@${f.login}`,
        login: f.login,
      }));
      const selected = await vscode.window.showQuickPick(picks, { placeHolder: "Search friends to chat...", matchOnDescription: true });
      if (selected) {
        vscode.commands.executeCommand("trending.messageUser", selected.login);
      }
    },
  },
  {
    id: "trending.search",
    handler: async () => {
      const query = await vscode.window.showInputBox({ prompt: "Search repos & people", placeHolder: "e.g. react, vercel, @sindresorhus" });
      if (!query) { return; }
      try {
        const results = await apiClient.search(query);
        const picks = [
          ...results.repos.map((r) => ({ label: `$(repo) ${r.owner}/${r.name}`, description: `${r.stars} ⭐`, detail: r.description, action: () => RepoDetailPanel.show(extensionUri, r.owner, r.name) })),
          ...results.users.map((u) => ({ label: `$(person) ${u.name || u.login}`, description: `@${u.login}`, detail: u.bio, action: () => ProfilePanel.show(extensionUri, u.login) })),
        ];
        const selected = await vscode.window.showQuickPick(picks, { placeHolder: `${picks.length} results for "${query}"` });
        if (selected) { (selected as typeof picks[0]).action(); }
      } catch { vscode.window.showErrorMessage("Search failed"); }
    },
  },
  {
    id: "trending.inbox.pinConversation",
    handler: async (...args: unknown[]) => {
      const conversationId = args[0] as string | undefined;
      if (!conversationId) { return; }
      try { await apiClient.pinConversation(conversationId); chatPanelWebviewProvider?.refresh(); }
      catch { vscode.window.showErrorMessage("Failed to pin conversation"); }
    },
  },
  {
    id: "trending.inbox.unpinConversation",
    handler: async (...args: unknown[]) => {
      const conversationId = args[0] as string | undefined;
      if (!conversationId) { return; }
      try { await apiClient.unpinConversation(conversationId); chatPanelWebviewProvider?.refresh(); }
      catch { vscode.window.showErrorMessage("Failed to unpin conversation"); }
    },
  },
  {
    id: "trending.inbox.markRead",
    handler: async (...args: unknown[]) => {
      const conversationId = args[0] as string | undefined;
      if (!conversationId) { return; }
      try { await apiClient.markConversationRead(conversationId); chatPanelWebviewProvider?.refresh(); }
      catch { vscode.window.showErrorMessage("Failed to mark as read"); }
    },
  },
  {
    id: "trending.createGroup",
    handler: async () => {
      const groupName = await vscode.window.showInputBox({ prompt: "Group name (optional)", placeHolder: "My group" });

      const { apiClient: api } = await import("../api");
      const following = await api.getFollowing(1, 100);
      const items = following.map((f: { login: string; name?: string }) => ({
        label: f.name || f.login,
        description: `@${f.login}`,
        login: f.login,
      }));

      const selected = await vscode.window.showQuickPick(items, {
        canPickMany: true,
        placeHolder: "Select members (min 2)",
        title: "Create Group Chat",
      });

      if (!selected || selected.length < 2) {
        vscode.window.showWarningMessage("Need at least 2 members for a group");
        return;
      }

      try {
        const logins = selected.map((s: { login: string }) => s.login);
        const conv = await api.createGroupConversation(logins, groupName || undefined);
        log(`Created group "${groupName}" with ${logins.length} members`);
        await ChatPanel.show(extensionUri, conv.id);
      } catch (err) {
        log(`Failed to create group: ${err}`, "error");
        vscode.window.showErrorMessage("Failed to create group");
      }
    },
  },
  {
    id: "trending.inbox.deleteConversation",
    handler: async (...args: unknown[]) => {
      const conversationId = args[0] as string | undefined;
      if (!conversationId) { return; }
      const confirm = await vscode.window.showWarningMessage("Delete this conversation?", { modal: true }, "Delete");
      if (confirm !== "Delete") { return; }
      try { await apiClient.deleteConversation(conversationId); chatPanelWebviewProvider?.refresh(); }
      catch { vscode.window.showErrorMessage("Failed to delete conversation"); }
    },
  },
];

export const commandsModule: ExtensionModule = {
  id: "commands",
  activate(context) {
    extensionUri = context.extensionUri;
    for (const cmd of commands) {
      context.subscriptions.push(vscode.commands.registerCommand(cmd.id, cmd.handler));
    }
    log(`Registered ${commands.length} commands`);
  },
};
