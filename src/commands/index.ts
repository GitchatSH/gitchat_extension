import * as vscode from "vscode";
import type { CommandDefinition, ExtensionModule } from "../types";
import { authManager } from "../auth";
import { apiClient } from "../api";
import { log } from "../utils";
import { exploreWebviewProvider } from "../webviews/explore";
import { ProfilePanel } from "../webviews/profile";

import { ChannelPanel } from "../webviews/channel";

let extensionUri: vscode.Uri;

const commands: CommandDefinition[] = [
  { id: "gitchat.signIn", handler: () => authManager.signIn() },
  { id: "gitchat.signOut", handler: () => authManager.signOut() },
  {
    id: "gitchat.openOnGithub",
    handler: (...args: unknown[]) => {
      const url = args[0] as string | undefined;
      if (url && typeof url === "string") { vscode.env.openExternal(vscode.Uri.parse(url)); }
    },
  },
  {
    id: "gitchat.viewMyProfile",
    handler: async () => {
      try { const profile = await apiClient.getMyProfile(); await ProfilePanel.show(extensionUri, profile.login); }
      catch { vscode.window.showErrorMessage("Sign in first to view your profile"); }
    },
  },
  {
    id: "gitchat.messageUser",
    handler: async (...args: unknown[]) => {
      let username: string | undefined;
      const arg0 = args[0];
      if (typeof arg0 === "string") {
        username = arg0;
      } else if (arg0 && typeof arg0 === "object") {
        const item = arg0 as Record<string, unknown>;
        username = item.login as string | undefined;
      }
      if (!username) {
        username = await vscode.window.showInputBox({ prompt: "Enter GitHub username to message", placeHolder: "@username" });
      }
      if (!username) { return; }
      username = String(username).replace("@", "");
      try {
        const conv = await apiClient.createConversation(username);
        log(`Created conversation ${conv.id} with ${username}`);
        await exploreWebviewProvider?.navigateToChat(conv.id, username);
      } catch (err: unknown) {
        const axiosErr = err as { response?: { status?: number; data?: { error?: { message?: string } } }; message?: string };
        const status = axiosErr.response?.status;
        const beMsg = axiosErr.response?.data?.error?.message;
        const detail = axiosErr.response?.data ? JSON.stringify(axiosErr.response.data).slice(0, 300) : axiosErr.message;
        log(`Failed to create conversation with ${username}: ${status} ${detail}`, "error");

        if (status === 403 && username) {
          const action = await vscode.window.showWarningMessage(
            beMsg || `You need to follow @${username} on GitHub to start a conversation.`,
            "Follow & Chat"
          );
          if (action === "Follow & Chat") {
            try {
              await apiClient.followUser(username);
              const conv = await apiClient.createConversation(username);
              log(`Followed ${username} and created conversation ${conv.id}`);
              await exploreWebviewProvider?.navigateToChat(conv.id, username);
            } catch (followErr: unknown) {
              const fErr = followErr as { message?: string };
              vscode.window.showErrorMessage(`Failed to follow @${username}: ${fErr.message || "unknown error"}`);
            }
          }
        } else {
          vscode.window.showErrorMessage(beMsg || `Failed to start conversation with @${username}: ${status || "unknown error"}`);
        }
      }
    },
  },
  {
    id: "gitchat.openChat",
    handler: async (...args: unknown[]) => {
      const conversationId = args[0] as string | undefined;
      if (conversationId) { await exploreWebviewProvider?.navigateToChat(conversationId); }
    },
  },
  {
    id: "gitchat.userMenu",
    handler: async () => {
      exploreWebviewProvider?.view?.webview.postMessage({ type: "toggleUserMenu" });
    },
  },
  {
    id: "gitchat.newChat",
    handler: () => {
      exploreWebviewProvider?.view?.webview.postMessage({ type: "showNewChatMenu" });
    },
  },
  {
    id: "gitchat.createGroup",
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
        await exploreWebviewProvider?.navigateToChat(conv.id);
      } catch (err) {
        log(`Failed to create group: ${err}`, "error");
        vscode.window.showErrorMessage("Failed to create group");
      }
    },
  },
  {
    id: "gitchat.copyInviteLink",
    handler: async () => {
      const text = "Hey! I've been using GitChat to chat with devs right in VS Code. No alt-tab. Try it: https://marketplace.visualstudio.com/items?itemName=Gitchat.gitchat";
      await vscode.env.clipboard.writeText(text);
      vscode.window.showInformationMessage("Invite link copied to clipboard!");
    },
  },
  {
    id: "gitchat.copyProfileBadge",
    handler: async () => {
      const login = authManager.login;
      const badge = `[![Chat on GitChat](https://img.shields.io/badge/Chat%20on-GitChat-blue?logo=github)](https://marketplace.visualstudio.com/items?itemName=Gitchat.gitchat)`;
      await vscode.env.clipboard.writeText(badge);
      vscode.window.showInformationMessage(
        login
          ? "Badge markdown copied! Paste it in your GitHub README to let people find you on Gitchat."
          : "Badge markdown copied! Sign in to personalize it."
      );
    },
  },
  {
    id: "gitchat.joinGroupByLink",
    handler: async () => {
      const input = await vscode.window.showInputBox({ prompt: "Paste invite link or code", placeHolder: "https://gitchat.sh/join/... or code" });
      if (!input) { return; }
      let code = input.trim();
      code = code.replace(/^https?:\/\/[^/]+\/join\//i, "").trim();
      if (code.length < 6) {
        vscode.window.showErrorMessage("Invalid invite code");
        return;
      }
      try {
        const result = await apiClient.joinByInvite(code);
        const conversationId = (result as Record<string, unknown>).id as string
          || (result as Record<string, unknown>).conversation_id as string;
        if (conversationId) {
          await exploreWebviewProvider?.navigateToChat(conversationId);
        }
        vscode.window.showInformationMessage("Joined group successfully!");
      } catch (err: unknown) {
        const msg = (err as { response?: { data?: { message?: { message?: string } | string } } })?.response?.data?.message;
        const errText = typeof msg === 'object' ? msg?.message : msg;
        if (errText?.toLowerCase().includes('already a member')) {
          // Already a member — try to open the chat via preview
          try {
            const preview = await apiClient.getInvitePreview(code);
            if (preview.conversation_id) {
              await exploreWebviewProvider?.navigateToChat(preview.conversation_id);
            }
          } catch { /* ignore */ }
        } else {
          vscode.window.showErrorMessage(errText || "Failed to join group");
        }
      }
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
    context.subscriptions.push(
      vscode.commands.registerCommand("gitchat.openChannel", (channelId: string, repoOwner?: string, repoName?: string) => {
        const channel = repoOwner && repoName ? { id: channelId, repoOwner, repoName, displayName: null, description: null, avatarUrl: null, subscriberCount: 0, role: "member" } as import("../types/index").RepoChannel : undefined;
        ChannelPanel.show(context.extensionUri, channelId, channel);
      }),
    );
    log(`Registered ${commands.length} commands`);
  },
};
