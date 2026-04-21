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
    id: "gitchat.openNotifications",
    handler: async () => {
      await vscode.commands.executeCommand("workbench.view.extension.gitchatSidebar");
      exploreWebviewProvider?.view?.webview.postMessage({ type: "openNotificationsTab" });
    },
  },
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
      if (!authManager.isSignedIn) {
        const action = await vscode.window.showInformationMessage(
          "Sign in to view your GitChat profile.",
          "Sign In"
        );
        if (action === "Sign In") {
          await vscode.commands.executeCommand("gitchat.signIn");
        }
        return;
      }
      try {
        const profile = await apiClient.getMyProfile();
        await ProfilePanel.show(extensionUri, profile.login);
      } catch (err) {
        log(`Failed to open my profile: ${err}`, "error");
        vscode.window.showErrorMessage("Failed to open your profile. Please try again.");
      }
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

      // #112 — Lazy create: navigate to a draft chat. The backend row is
      // minted only on the first sent message (see chat:send handler).
      await exploreWebviewProvider?.navigateToDraftChat(username);
    },
  },
  {
    id: "gitchat.openChat",
    handler: async (...args: unknown[]) => {
      const conversationId = args[0] as string | undefined;
      if (conversationId) {
        const { toastCoordinator } = await import("../notifications/toast-coordinator");
        toastCoordinator.clearConversation(conversationId);
        await exploreWebviewProvider?.navigateToChat(conversationId);
      }
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
      // Use mutual friends — BE requires mutual follow + active account for group members
      let items: { label: string; description: string; login: string }[] = [];
      try {
        const friendsData = await api.getMyFriends();
        items = friendsData.mutual
          .filter((f) => f.onGitchat)
          .map((f) => ({ label: f.name || f.login, description: `@${f.login}`, login: f.login }));
      } catch {
        // Fallback to following if mutual endpoint fails
        const following = await api.getFollowing(1, 100);
        items = following.map((f: { login: string; name?: string }) => ({
          label: f.name || f.login, description: `@${f.login}`, login: f.login,
        }));
      }

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
      } catch (err: unknown) {
        const axiosErr = err as { response?: { data?: { error?: { message?: string } } }; message?: string };
        const beMsg = axiosErr.response?.data?.error?.message;
        log(`Failed to create group: ${err}`, "error");
        vscode.window.showErrorMessage(beMsg || "Failed to create group");
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
      if (!authManager.isSignedIn || !authManager.login) {
        vscode.window.showInformationMessage("Sign in to GitChat first to copy your profile badge.");
        return;
      }
      const login = authManager.login;
      const badge = `[![Chat on GitChat](https://img.shields.io/badge/Chat%20on-GitChat-blue?logo=github)](${process.env.GITCHAT_WEBAPP_URL}/@${login})`;
      await vscode.env.clipboard.writeText(badge);
      vscode.window.showInformationMessage("Profile badge copied! Paste it in your GitHub README so people can chat with you on GitChat.");
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
  {
    id: "gitchat.resetOnboarding",
    handler: async () => {
      const login = authManager.login;
      if (!login) {
        vscode.window.showWarningMessage("Sign in first to reset onboarding.");
        return;
      }
      const context = exploreWebviewProvider?.getContext();
      if (context) {
        await context.globalState.update(`gitchat.hasCompletedOnboarding.${login}`, undefined);
        vscode.window.showInformationMessage(`Onboarding reset for @${login}. Sign out and back in, or reload the window to test.`);
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
