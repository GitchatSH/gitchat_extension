import * as vscode from "vscode";
import type { Message, WebviewMessage } from "../types";
import { authManager } from "../auth";
import { log } from "../utils";

// ---------------------------------------------------------------------------
// ChatContext — everything a handler needs, without coupling to ChatPanel
// ---------------------------------------------------------------------------

export interface CursorState {
  cursor: string | undefined;
  previousCursor: string | undefined;
  nextCursor: string | undefined;
  hasMore: boolean;
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
}

export interface ChatContext {
  conversationId: string;
  postToWebview(msg: unknown): void;
  recentlySentIds: Set<string>;
  extensionUri: vscode.Uri;
  isGroup: boolean;

  /** If true, all outgoing message types get a `chat:` prefix (for sidebar). */
  prefixMessages: boolean;

  /** Cursor / pagination state — mutated by loadMore / loadNewer / jump handlers. */
  cursorState: CursorState;

  /** Panel-level callbacks that differ between editor panel and sidebar. */
  reloadConversation(): Promise<void>;
  disposePanel(): void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function post(ctx: ChatContext, msg: Record<string, unknown>): void {
  if (ctx.prefixMessages && typeof msg.type === "string") {
    msg = { ...msg, type: `chat:${msg.type}` };
  }
  ctx.postToWebview(msg);
}

function getEligibilityMessage(err: unknown): string {
  const errMsg = (err as { response?: { data?: { error?: { message?: string } } }; message?: string })
    ?.response?.data?.error?.message
    ?? (err as Error)?.message;
  return errMsg || "You are not eligible to join this conversation.";
}

export function extractPinnedMessages(pins: unknown[]): Record<string, unknown>[] {
  return (pins as Record<string, unknown>[]).map(m => {
    const nested = (m.message != null && typeof m.message === "object")
      ? m.message as Record<string, unknown> : null;
    return {
      id: (m.messageId as string) || (m.message_id as string) || (nested?.id as string) || (m.id as string),
      senderName: (m.senderLogin as string) || (m.sender_login as string) || (nested?.senderLogin as string) || (nested?.sender_login as string) || (m.sender as Record<string, string>)?.login || "",
      senderAvatar: (m.sender as Record<string, string>)?.avatar_url || (m.sender_avatar as string) || "",
      text: ((m.body as string) || (m.content as string) || (m.text as string) ||
        (typeof m.message === "string" ? m.message : "") ||
        (nested?.body as string) || (nested?.content as string) || (nested?.text as string) || "").slice(0, 100),
      content: (m.body as string) || (m.content as string) || (nested?.body as string) || (nested?.content as string) || "",
      body: (m.body as string) || (m.content as string) || (nested?.body as string) || (nested?.content as string) || "",
      sender: (m.senderLogin as string) || (m.sender_login as string) || (nested?.senderLogin as string) || (nested?.sender_login as string) || (m.sender as Record<string, string>)?.login || "",
      sender_login: (m.senderLogin as string) || (m.sender_login as string) || (nested?.senderLogin as string) || (nested?.sender_login as string) || (m.sender as Record<string, string>)?.login || "",
      sender_avatar: (nested?.sender_avatar as string) || (m.sender_avatar as string) || (m.sender as Record<string, string>)?.avatar_url || "",
      created_at: (m.createdAt as string) || (m.created_at as string) || (nested?.createdAt as string) || (nested?.created_at as string) || (m.pinned_at as string) || "",
      attachment_url: (m.attachment_url as string) || (nested?.attachment_url as string) || null,
      attachments: (((m.attachments as unknown[])?.length ? m.attachments : nested?.attachments) || []) as unknown[],
      reactions: (((m.reactions as unknown[])?.length ? m.reactions : nested?.reactions) || []) as unknown[],
      edited_at: (m.editedAt as string) || (m.edited_at as string) || (nested?.editedAt as string) || (nested?.edited_at as string) || null,
      type: (m.type as string) || (nested?.type as string) || "message",
    };
  });
}

// ---------------------------------------------------------------------------
// Main handler — returns true if the message type was recognized & handled
// ---------------------------------------------------------------------------

export async function handleChatMessage(
  msg: WebviewMessage,
  ctx: ChatContext,
): Promise<boolean> {
  // Lazy import to avoid circular deps at module load
  const { apiClient } = await import("../api");

  switch (msg.type) {
    // ── Send ───────────────────────────────────────────────────────────
    case "send": {
      const sp = msg.payload as {
        content?: string; _tempId?: string; suppressLinkPreview?: boolean;
        attachments?: { type: string; url: string; storage_path: string; filename?: string; mime_type?: string; size_bytes?: number }[];
      };
      if (sp?.content || sp?.attachments?.length) {
        try {
          const sent = await apiClient.sendMessage(ctx.conversationId, sp.content || "", sp.attachments);
          const sentId = (sent as unknown as Record<string, string>).id;
          if (sentId) { ctx.recentlySentIds.add(sentId); }
          const payload = sp.suppressLinkPreview ? { ...sent, suppress_link_preview: true } : sent;
          post(ctx, { type: "newMessage", payload });
          const { chatPanelWebviewProvider: cpSend } = await import("./chat-panel");
          cpSend.clearDraft(ctx.conversationId);
        } catch {
          post(ctx, { type: "messageFailed", tempId: sp._tempId, content: sp.content });
        }
      }
      return true;
    }

    // ── Mark read ─────────────────────────────────────────────────────
    case "markRead": {
      await apiClient.markConversationRead(ctx.conversationId).catch(() => {});
      import("./chat-panel").then(m => m.chatPanelWebviewProvider?.debouncedRefresh()).catch(() => {});
      import("./explore").then(m => m.exploreWebviewProvider?.debouncedRefreshChat()).catch(() => {});
      import("../statusbar").then(m => { m.decrementUnread(); m.fetchCounts(); }).catch(() => {});
      return true;
    }

    // ── Draft ─────────────────────────────────────────────────────────
    case "saveDraft": {
      const { conversationId, text } = msg.payload as { conversationId: string; text: string };
      const { chatPanelWebviewProvider: cp } = await import("./chat-panel");
      cp.setDraft(conversationId, text);
      return true;
    }

    // ── Link previews ─────────────────────────────────────────────────
    case "fetchLinkPreview": {
      const { url, messageId: lpMsgId } = msg.payload as { url: string; messageId: string };
      try {
        const data = await apiClient.getLinkPreview(url);
        post(ctx, { type: "linkPreviewResult", url, messageId: lpMsgId, data });
      } catch {
        post(ctx, { type: "linkPreviewResult", url, messageId: lpMsgId, data: null });
      }
      return true;
    }
    case "fetchInputLinkPreview": {
      const { url: ilpUrl } = msg.payload as { url: string };
      try {
        const data = await apiClient.getLinkPreview(ilpUrl);
        log(`[LinkPreview] input url=${ilpUrl} result=${JSON.stringify(data)}`);
        post(ctx, { type: "inputLinkPreviewResult", url: ilpUrl, data });
      } catch (err) {
        log(`[LinkPreview] input failed url=${ilpUrl}: ${err}`, "warn");
        post(ctx, { type: "inputLinkPreviewResult", url: ilpUrl, data: null });
      }
      return true;
    }

    // ── Reactions ─────────────────────────────────────────────────────
    case "react": {
      const { messageId, emoji } = msg.payload as { messageId: string; emoji: string };
      try {
        await apiClient.addReaction(emoji, messageId);
      } catch {
        vscode.window.showWarningMessage("Failed to add reaction");
      }
      return true;
    }
    case "removeReaction": {
      const rrp = msg.payload as { messageId: string; emoji: string };
      if (rrp?.messageId && rrp?.emoji) {
        try { await apiClient.removeReaction(rrp.emoji, rrp.messageId); }
        catch { vscode.window.showWarningMessage("Failed to remove reaction"); }
      }
      return true;
    }

    // ── Pagination ────────────────────────────────────────────────────
    case "loadMore": {
      const cs = ctx.cursorState;
      const cursorToUse = cs.previousCursor || cs.cursor;
      const hasMore = cs.previousCursor ? cs.hasMoreBefore : cs.hasMore;
      if (!ctx.conversationId || !hasMore) { return true; }
      try {
        const result = await apiClient.getMessages(ctx.conversationId, 1, cursorToUse, "before");
        cs.hasMore = result.hasMore;
        cs.hasMoreBefore = result.hasMore;
        if (result.cursor) {
          cs.cursor = result.cursor;
          cs.previousCursor = result.cursor;
        }
        post(ctx, { type: "olderMessages", messages: result.messages, hasMore: result.hasMore });
      } catch { log("Failed to load more messages", "error"); }
      return true;
    }
    case "loadNewer": {
      const cs = ctx.cursorState;
      if (!ctx.conversationId || !cs.hasMoreAfter || !cs.nextCursor) { return true; }
      try {
        const result = await apiClient.getMessages(ctx.conversationId, 1, cs.nextCursor, "after");
        cs.hasMoreAfter = result.hasMore;
        if (result.cursor) { cs.nextCursor = result.cursor; }
        post(ctx, {
          type: "newerMessages",
          messages: result.messages,
          hasMoreAfter: cs.hasMoreAfter,
        });
      } catch { /* ignore */ }
      return true;
    }

    // ── User search / mention ─────────────────────────────────────────
    case "searchUsers": {
      const query = (msg.payload as Record<string, string>)?.query;
      if (query) {
        try {
          const users = await apiClient.searchUsers(query);
          post(ctx, { type: "mentionSuggestions", users });
        } catch {
          post(ctx, { type: "mentionSuggestions", users: [] });
        }
      }
      return true;
    }
    case "searchUsersForGroup": {
      const groupSearchQuery = (msg.payload as Record<string, string>).query;
      try {
        const users = await apiClient.searchUsers(groupSearchQuery);
        post(ctx, { type: "groupSearchResults", users });
      } catch {
        post(ctx, { type: "groupSearchResults", users: [] });
      }
      return true;
    }
    case "fetchMutualFriendsFast": {
      let mutualFriends: { login: string; name: string; avatar_url: string }[] = [];
      try {
        const friendsData = await apiClient.getMyFriends(false);
        mutualFriends = friendsData.mutual
          .filter((f) => f.onGitchat)
          .map((f) => ({ login: f.login, name: f.name || f.login, avatar_url: f.avatarUrl || "" }));
      } catch (err) {
        log(`[Chat] fetchMutualFriendsFast failed: ${err}`, "warn");
      }
      post(ctx, { type: "mutualFriendsData", mutualFriends });
      return true;
    }

    // ── Profile ───────────────────────────────────────────────────────
    case "viewProfile": {
      const login = (msg.payload as Record<string, string>)?.login;
      if (login) { vscode.commands.executeCommand("gitchat.viewProfile", login); }
      return true;
    }

    // ── Group management ──────────────────────────────────────────────
    case "getMembers": {
      try {
        const members = await apiClient.getGroupMembers(ctx.conversationId);
        log(`[Chat] getGroupMembers returned ${members.length} members for ${ctx.conversationId}`);
        post(ctx, { type: "members", members, currentUser: authManager.login });
      } catch (err) {
        log(`[Chat] getGroupMembers failed: ${err}`, "error");
        vscode.window.showErrorMessage("Failed to load members");
      }
      return true;
    }
    case "addMember": {
      const addLogin = (msg.payload as Record<string, string>)?.login;
      if (addLogin) {
        try {
          await apiClient.addGroupMember(ctx.conversationId, addLogin);
          const members = await apiClient.getGroupMembers(ctx.conversationId);
          post(ctx, { type: "showGroupInfo", members });
        } catch { vscode.window.showErrorMessage("Failed to add member"); }
      } else {
        const following = await apiClient.getFollowing(1, 100);
        const picks = following.map((f: { login: string; name?: string }) => ({
          label: f.name || f.login, description: `@${f.login}`, login: f.login,
        }));
        const selected = await vscode.window.showQuickPick(picks, { placeHolder: "Add member to group", matchOnDescription: true });
        if (selected) {
          try {
            await apiClient.addGroupMember(ctx.conversationId, selected.login);
            vscode.window.showInformationMessage(`Added @${selected.login} to group`);
            const members = await apiClient.getGroupMembers(ctx.conversationId);
            post(ctx, { type: "members", members, currentUser: authManager.login });
          } catch { vscode.window.showErrorMessage(`Failed to add @${selected.login}`); }
        }
      }
      return true;
    }
    case "removeMember": {
      const memberLogin = (msg.payload as Record<string, string>)?.login;
      if (!memberLogin) { return true; }
      try {
        await apiClient.removeGroupMember(ctx.conversationId, memberLogin);
        const members = await apiClient.getGroupMembers(ctx.conversationId);
        post(ctx, { type: "showGroupInfo", members });
      } catch { vscode.window.showErrorMessage("Failed to remove member"); }
      return true;
    }
    case "updateGroupName": {
      const newName = (msg.payload as { name: string })?.name;
      if (newName) {
        try {
          await apiClient.updateGroup(ctx.conversationId, newName);
          // Note: panel title update is done by the caller if needed
        } catch { vscode.window.showErrorMessage("Failed to update group name"); }
      }
      return true;
    }
    case "leaveGroup": {
      // FE sidebar already shows confirm modal before sending this message
      try {
        await apiClient.leaveGroup(ctx.conversationId);
        ctx.disposePanel();
      } catch { vscode.window.showErrorMessage("Failed to leave group"); }
      return true;
    }
    case "deleteGroup": {
      // FE sidebar already shows confirm modal before sending this message
      try {
        log(`[deleteGroup] deleting conversation ${ctx.conversationId}`, "info");
        await apiClient.deleteGroup(ctx.conversationId);
        log(`[deleteGroup] success, disposing panel`, "info");
        post(ctx, { type: "showToast", text: "Group deleted" });
        ctx.disposePanel();
      } catch (err) {
        const errMsg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message || "Failed to delete group";
        log(`[deleteGroup] error: ${errMsg}`, "warn");
        post(ctx, { type: "showToast", text: errMsg });
      }
      return true;
    }
    case "groupInfo":
      try {
        const members = await apiClient.getGroupMembers(ctx.conversationId);
        post(ctx, { type: "showGroupInfo", members });
      } catch { vscode.window.showErrorMessage("Failed to load group info"); }
      return true;

    // ── Pin conversation ──────────────────────────────────────────────
    case "togglePin": {
      const pinned = (msg.payload as Record<string, boolean>).isPinned;
      try {
        if (pinned) { await apiClient.unpinConversation(ctx.conversationId); }
        else { await apiClient.pinConversation(ctx.conversationId); }
        const { chatPanelWebviewProvider: cp } = await import("./chat-panel");
        cp?.refresh();
      } catch (err) {
        const status = (err as { response?: { status?: number } })?.response?.status;
        const errMsg = status === 400 ? "Maximum 3 pinned conversations. Unpin one first." : "Failed to update pin";
        vscode.window.showWarningMessage(errMsg);
        post(ctx, { type: "pinReverted", isPinned: pinned });
        post(ctx, { type: "showToast", text: errMsg });
      }
      return true;
    }

    // ── Add people / convert DM to group ──────────────────────────────
    case "addPeople": {
      const friends = await apiClient.getFollowing(1, 100).catch(() => []);
      const picks = (friends as { login: string; name?: string }[]).map((f) => ({
        label: f.name || f.login,
        description: `@${f.login}`,
        login: f.login,
      }));
      const selected = await vscode.window.showQuickPick(picks, {
        placeHolder: "Select people to add",
        canPickMany: true,
        matchOnDescription: true,
      });
      if (selected && selected.length > 0) {
        if (ctx.isGroup) {
          for (const s of selected) {
            try { await apiClient.addGroupMember(ctx.conversationId, s.login); } catch { /* skip */ }
          }
          await ctx.reloadConversation();
        } else {
          const groupName = await vscode.window.showInputBox({
            prompt: "Name your group (optional)",
            placeHolder: "e.g. The Dream Team",
          });
          const newMembers = selected.map((s) => s.login);
          try {
            await apiClient.convertDmToGroup(ctx.conversationId, newMembers, groupName || undefined);
            await ctx.reloadConversation();
            const { chatPanelWebviewProvider: cp3 } = await import("./chat-panel");
            cp3?.refresh();
          } catch { vscode.window.showErrorMessage("Failed to convert to group"); }
        }
      }
      return true;
    }

    // ── Mute ──────────────────────────────────────────────────────────
    case "toggleMute": {
      const isMuted = (msg.payload as Record<string, boolean>).isMuted;
      try {
        if (isMuted) { await apiClient.unmuteConversation(ctx.conversationId); }
        else { await apiClient.muteConversation(ctx.conversationId); }
        post(ctx, { type: "muteUpdated", isMuted: !isMuted });
        const { chatPanelWebviewProvider: cp2 } = await import("./chat-panel");
        cp2?.refresh();
      } catch { vscode.window.showErrorMessage("Failed to update mute"); }
      return true;
    }

    // ── Reply ─────────────────────────────────────────────────────────
    case "reply": {
      const rp = msg.payload as {
        content: string; replyToId: string; _tempId?: string; suppressLinkPreview?: boolean;
        attachments?: { type: string; url: string; storage_path: string; filename?: string; mime_type?: string; size_bytes?: number }[];
      };
      if ((rp?.content || rp?.attachments?.length) && rp?.replyToId) {
        try {
          const sent = await apiClient.replyToMessage(ctx.conversationId, rp.content || "", rp.replyToId, rp.attachments);
          const sentId = (sent as unknown as Record<string, string>).id;
          if (sentId) { ctx.recentlySentIds.add(sentId); }
          const payload = rp.suppressLinkPreview ? { ...sent, suppress_link_preview: true } : sent;
          post(ctx, { type: "newMessage", payload });
        } catch {
          post(ctx, { type: "replyFailed", content: rp.content, replyToId: rp.replyToId, tempId: rp._tempId });
        }
      }
      return true;
    }

    // ── Edit / Delete / Unsend ────────────────────────────────────────
    case "editMessage": {
      const ep = msg.payload as { messageId: string; body: string };
      if (ep?.messageId && ep?.body) {
        try {
          await apiClient.editMessage(ctx.conversationId, ep.messageId, ep.body);
          post(ctx, { type: "messageEdited", messageId: ep.messageId, body: ep.body });
        } catch { vscode.window.showErrorMessage("Failed to edit message"); }
      }
      return true;
    }
    case "deleteMessage": {
      const dp = msg.payload as { messageId: string };
      if (dp?.messageId) {
        try {
          await apiClient.deleteMessage(ctx.conversationId, dp.messageId);
          post(ctx, { type: "messageDeleted", messageId: dp.messageId });
        } catch { vscode.window.showErrorMessage("Failed to delete message"); }
      }
      return true;
    }
    case "unsendMessage": {
      const up = msg.payload as { messageId: string };
      if (up?.messageId) {
        try {
          await apiClient.unsendMessage(ctx.conversationId, up.messageId);
          post(ctx, { type: "messageUnsent", messageId: up.messageId });
        } catch (err) {
          const e = err as { response?: { status?: number; data?: unknown }; status?: number; message?: string };
          const status = e?.response?.status ?? e?.status ?? "?";
          const body = JSON.stringify(e?.response?.data ?? e?.message ?? String(err));
          log(`[unsend] FAILED status=${status} body=${body}`);
          vscode.window.showErrorMessage(`Failed to unsend message (${status})`);
        }
      }
      return true;
    }

    // ── Forward ───────────────────────────────────────────────────────
    case "forwardMessage": {
      const fp = msg.payload as { messageId: string; text: string; fromSender?: string; targetConversationIds: string[] };
      if (fp?.messageId && fp?.targetConversationIds?.length) {
        try {
          for (const targetId of fp.targetConversationIds) {
            try {
              const fwdHeader = fp.fromSender ? `\u21aa Forwarded from @${fp.fromSender}\n` : "\u21aa Forwarded\n";
              await apiClient.sendMessage(targetId, fwdHeader + (fp.text || ""));
            } catch { /* skip failed targets */ }
          }
          post(ctx, { type: "forwardSuccess", count: fp.targetConversationIds.length });
        } catch {
          post(ctx, { type: "forwardError" });
        }
      }
      return true;
    }

    // ── Conversations list (for forward picker) ───────────────────────
    case "getConversations": {
      try {
        const convs = await apiClient.getConversations();
        post(ctx, { type: "conversationsLoaded", conversations: convs });
      } catch {
        post(ctx, { type: "conversationsLoaded", conversations: [] });
      }
      return true;
    }

    // ── Group avatar ──────────────────────────────────────────────────
    case "uploadGroupAvatar": {
      const avp = msg.payload as { base64: string; mimeType: string };
      if (avp?.base64) {
        try {
          const rawData = avp.base64.includes(",") ? avp.base64.split(",")[1] : avp.base64;
          const buffer = Buffer.from(rawData, "base64");
          const ext = avp.mimeType === "image/png" ? "png" : avp.mimeType === "image/gif" ? "gif" : "jpg";
          const result = await apiClient.uploadAttachment(ctx.conversationId, buffer, `avatar.${ext}`, avp.mimeType);
          const avatarUrl = (result as unknown as Record<string, string>).url;
          await apiClient.updateGroup(ctx.conversationId, undefined, avatarUrl);
          post(ctx, { type: "groupAvatarUpdated", avatarUrl });
        } catch {
          post(ctx, { type: "groupAvatarFailed" });
        }
      }
      return true;
    }

    // ── Pin / Unpin messages ──────────────────────────────────────────
    case "pinMessage": {
      const pp = msg.payload as { messageId: string };
      if (pp?.messageId) {
        try {
          await apiClient.pinMessage(ctx.conversationId, pp.messageId);
          const pinned = await apiClient.getPinnedMessages(ctx.conversationId).catch(() => []);
          const pinnedMessages = extractPinnedMessages(pinned);
          post(ctx, { type: "updatePinnedBanner", pinnedMessages });
        } catch { vscode.window.showErrorMessage("Failed to pin message"); }
      }
      return true;
    }
    case "unpinMessage": {
      const upp = msg.payload as { messageId: string };
      if (upp?.messageId) {
        try {
          await apiClient.unpinMessage(ctx.conversationId, upp.messageId);
          post(ctx, { type: "wsUnpinned", conversationId: ctx.conversationId, messageId: upp.messageId });
        } catch { vscode.window.showErrorMessage("Failed to unpin message"); }
      }
      return true;
    }
    case "unpinAllMessages": {
      try {
        await apiClient.unpinAllMessages(ctx.conversationId);
        post(ctx, { type: "updatePinnedBanner", pinnedMessages: [] });
      } catch {
        vscode.window.showErrorMessage("Failed to unpin all messages");
      }
      return true;
    }

    // ── Search messages ───────────────────────────────────────────────
    case "searchMessages": {
      const sp = msg.payload as { query: string; cursor?: string; user?: string };
      if (!sp?.query?.trim() && !sp?.user) { return true; }
      try {
        let messages: Message[] = [];
        let nextCursor: string | null = null;

        if (sp.query.trim()) {
          const result = await apiClient.searchMessages(ctx.conversationId, sp.query.trim(), {
            cursor: sp.cursor,
            user: sp.user,
          });
          messages = result.messages;
          nextCursor = result.nextCursor;
        } else if (sp.user) {
          const result = await apiClient.getMessages(ctx.conversationId, 3, sp.cursor);
          messages = result.messages.filter((m: Message) =>
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (m as any).sender_login === sp.user || m.sender === sp.user,
          );
          nextCursor = result.hasMore && result.cursor ? result.cursor : null;
        }

        post(ctx, {
          type: "searchResults",
          messages,
          nextCursor,
          query: sp.query,
        });
      } catch {
        post(ctx, {
          type: "searchError",
          query: sp.query,
          error: true,
        });
      }
      return true;
    }

    // ── Report ────────────────────────────────────────────────────────
    case "reportMessage": {
      const rmp = msg.payload as { messageId: string };
      if (!rmp?.messageId) { return true; }
      const reason = await vscode.window.showQuickPick(
        [
          { label: "$(warning) Spam", description: "Unsolicited or repeated messages", value: "spam" },
          { label: "$(report) Harassment", description: "Threatening or abusive content", value: "harassment" },
          { label: "$(circle-slash) Other", description: "Other violations", value: "other" },
        ],
        { placeHolder: "Why are you reporting this message?", title: "Report Message" },
      );
      if (!reason) { return true; }
      try {
        await apiClient.reportMessage(rmp.messageId, (reason as { value: string }).value);
        vscode.window.showInformationMessage("Message reported. Thank you for helping keep the community safe.");
      } catch { vscode.window.showErrorMessage("Failed to report message. Please try again."); }
      return true;
    }

    // ── File upload ───────────────────────────────────────────────────
    case "upload": {
      const up = msg.payload as { id: number; data: string; filename: string; mimeType: string };
      if (up?.data) {
        const buffer = Buffer.from(up.data, "base64");
        const maxSize = 10 * 1024 * 1024; // 10MB
        if (buffer.length > maxSize) {
          const sizeMB = (buffer.length / 1024 / 1024).toFixed(1);
          post(ctx, { type: "uploadFailed", id: up.id });
          vscode.window.showWarningMessage(`File too large (${sizeMB}MB, max 10MB): ${up.filename}`);
          return true;
        }
        try {
          const result = await apiClient.uploadAttachment(ctx.conversationId, buffer, up.filename, up.mimeType);
          post(ctx, { type: "uploadComplete", id: up.id, attachment: result });
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          const status = (err as { response?: { status?: number } })?.response?.status;
          log(`Upload failed (status=${status}): ${errMsg}`, "error");
          post(ctx, { type: "uploadFailed", id: up.id });
          vscode.window.showErrorMessage(`Failed to upload file${status ? ` (${status})` : ""}: ${errMsg.slice(0, 100)}`);
        }
      }
      return true;
    }

    // ── Invite links ──────────────────────────────────────────────────
    case "createInviteLink":
      try {
        const result = await apiClient.createInviteLink(ctx.conversationId);
        post(ctx, { type: "inviteLinkResult", payload: result });
      } catch (err: unknown) {
        const errMsg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message || (err as Error).message || "Unknown error";
        log(`[Invite] Create failed: ${errMsg}`, "error");
        vscode.window.showErrorMessage(`Failed to create invite link: ${errMsg}`);
      }
      return true;

    case "revokeInviteLink":
      try {
        await apiClient.revokeInviteLink(ctx.conversationId);
        const newLink = await apiClient.createInviteLink(ctx.conversationId);
        post(ctx, { type: "inviteLinkRevoked", payload: newLink });
      } catch { vscode.window.showErrorMessage("Failed to revoke invite link"); }
      return true;

    case "copyInviteLink": {
      const inviteUrl = (msg.payload as { url: string }).url;
      await vscode.env.clipboard.writeText(inviteUrl);
      vscode.window.showInformationMessage("Invite link copied!");
      return true;
    }

    // ── External URL ──────────────────────────────────────────────────
    case "openExternal": {
      const extUrl = (msg.payload as { url: string }).url;
      if (extUrl) { vscode.env.openExternal(vscode.Uri.parse(extUrl)); }
      return true;
    }

    // ── Jump to message / date ────────────────────────────────────────
    case "jumpToMessage": {
      const { messageId } = msg.payload as { messageId: string };
      if (messageId) {
        try {
          const result = await apiClient.getMessageContext(ctx.conversationId, messageId);
          const cs = ctx.cursorState;
          cs.previousCursor = result.previousCursor;
          cs.nextCursor = result.nextCursor;
          cs.hasMoreBefore = result.hasMoreBefore;
          cs.hasMoreAfter = result.hasMoreAfter;
          post(ctx, {
            type: "jumpToMessageResult",
            messages: result.messages,
            targetMessageId: messageId,
            hasMoreBefore: cs.hasMoreBefore,
            hasMoreAfter: cs.hasMoreAfter,
          });
        } catch {
          post(ctx, { type: "jumpToMessageFailed", messageId });
        }
      }
      return true;
    }
    case "jumpToDate": {
      const { date } = msg.payload as { date: string };
      if (!date) { return true; }
      try {
        const result = await apiClient.getMessagesAroundDate(ctx.conversationId, date);
        const cs = ctx.cursorState;
        cs.previousCursor = result.previousCursor;
        cs.nextCursor = result.nextCursor;
        cs.hasMoreBefore = result.hasMoreBefore;
        cs.hasMoreAfter = result.hasMoreAfter;
        post(ctx, {
          type: "jumpToDateResult",
          messages: result.messages,
          hasMoreBefore: result.hasMoreBefore,
          hasMoreAfter: result.hasMoreAfter,
        });
      } catch {
        post(ctx, { type: "jumpToDateFailed" });
      }
      return true;
    }

    case "joinCommunity":
    case "joinTeam": {
      const jp = msg.payload as { type: "community" | "team"; repoFullName: string };
      if (!jp?.repoFullName) { return true; }
      const convType = msg.type === "joinCommunity" ? "community" : "team";
      try {
        const { apiClient: joinApi } = await import("../api");
        const conv = await joinApi.joinConversation(convType, { repoFullName: jp.repoFullName });
        // Navigate inside the sidebar (not a separate panel)
        post(ctx, { type: "joinedConversation", conversationId: conv.id, convType, repoFullName: jp.repoFullName });
        import("./chat-panel").then(m => m.chatPanelWebviewProvider?.debouncedRefresh()).catch(() => {});
      } catch (err) {
        post(ctx, { type: "joinError", convType, repoFullName: jp.repoFullName, reason: getEligibilityMessage(err) });
        vscode.window.showWarningMessage(getEligibilityMessage(err));
      }
      return true;
    }

    default:
      return false;
  }
}
