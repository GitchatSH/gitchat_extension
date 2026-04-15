import * as vscode from "vscode";
import type { Notification } from "../types";
import { log } from "../utils";
import { notificationStore } from "./notification-store";

// How long to wait after a toast resolves before starting a fresh burst.
// During this window, new messages accumulate into the pending buckets and
// will be shown as a single digest on the next toast cycle.
const BURST_IDLE_MS = 1500;

interface ConversationBucket {
  conversationId: string;
  latestActor: string;
  latestPreview: string;
  count: number;
  notifIds: string[];
}

class ToastCoordinator {
  private pending = new Map<string, ConversationBucket>();
  private urgentQueue: Array<{ notification: Notification; title: string; body: string }> = [];
  private activeToast: Promise<void> | null = null;

  async enqueue(notification: Notification, title: string, body: string): Promise<void> {
    const isChat = notification.type === "new_message";
    const conversationId = notification.metadata?.conversationId;

    if (isChat && conversationId) {
      this.bufferMessage(notification, conversationId);
    } else {
      this.urgentQueue.push({ notification, title, body });
    }

    this.scheduleDrain();
  }

  private bufferMessage(notification: Notification, conversationId: string): void {
    const actor = notification.actor_name || notification.actor_login || "Someone";
    const preview = (notification.metadata?.preview as string | undefined) ?? "";
    const existing = this.pending.get(conversationId);
    if (existing) {
      existing.count += 1;
      existing.latestActor = actor;
      existing.latestPreview = preview;
      existing.notifIds.push(notification.id);
    } else {
      this.pending.set(conversationId, {
        conversationId,
        latestActor: actor,
        latestPreview: preview,
        count: 1,
        notifIds: [notification.id],
      });
    }
  }

  private scheduleDrain(): void {
    if (this.activeToast) {
      return;
    }
    this.activeToast = this.drain().finally(() => {
      this.activeToast = null;
    });
  }

  private async drain(): Promise<void> {
    while (this.urgentQueue.length > 0 || this.pending.size > 0) {
      if (this.urgentQueue.length > 0) {
        const item = this.urgentQueue.shift()!;
        await this.showOne(item.notification, item.title, item.body);
        continue;
      }

      const buckets = Array.from(this.pending.values());
      this.pending.clear();
      await this.showChatDigest(buckets);

      // Brief settle window so bursts keep folding instead of flashing back-to-back
      await new Promise((r) => setTimeout(r, BURST_IDLE_MS));
    }
  }

  private async showOne(
    notification: Notification,
    title: string,
    body: string,
  ): Promise<void> {
    const conversationId = notification.metadata?.conversationId;
    const primary = conversationId ? "Open Chat" : "Open";
    log(`[Notifications] toast (urgent) ${notification.type} → ${title}`);
    const action = await vscode.window.showInformationMessage(
      body ? `${title}: ${body}` : title,
      primary,
      "Dismiss",
    );
    if (action === primary) {
      if (conversationId) {
        vscode.commands.executeCommand("gitchat.openChat", conversationId);
      } else if (notification.metadata?.url) {
        vscode.env.openExternal(vscode.Uri.parse(notification.metadata.url));
      } else {
        vscode.commands.executeCommand("gitchat.openNotifications");
      }
      await notificationStore.markRead([notification.id]);
    }
  }

  private async showChatDigest(buckets: ConversationBucket[]): Promise<void> {
    if (buckets.length === 0) {
      return;
    }
    const allIds = buckets.flatMap((b) => b.notifIds);
    const totalCount = buckets.reduce((acc, b) => acc + b.count, 0);

    if (buckets.length === 1) {
      const bucket = buckets[0];
      const countSuffix = bucket.count > 1 ? ` (+${bucket.count - 1})` : "";
      const title = `${bucket.latestActor}${countSuffix}`;
      const body = bucket.latestPreview;

      log(
        `[Notifications] toast (digest) convo=${bucket.conversationId} count=${bucket.count}`,
      );

      const action = await vscode.window.showInformationMessage(
        body ? `${title}: ${body}` : title,
        "Open Chat",
        "Dismiss",
      );
      if (action === "Open Chat") {
        vscode.commands.executeCommand("gitchat.openChat", bucket.conversationId);
        await notificationStore.markRead(allIds);
      }
      return;
    }

    // Multi-conversation digest: surface total count + latest sender, route
    // the click to the Noti tab since there is no single chat to open.
    const latest = buckets.reduce((a, b) =>
      b.notifIds.length > a.notifIds.length ? b : a,
    );
    const title = `${totalCount} new messages in ${buckets.length} chats`;
    const body = `latest: ${latest.latestActor}${latest.latestPreview ? ` — ${latest.latestPreview}` : ""}`;

    log(
      `[Notifications] toast (multi-digest) convos=${buckets.length} total=${totalCount}`,
    );

    const action = await vscode.window.showInformationMessage(
      `${title}: ${body}`,
      "Open Inbox",
      "Mark All Read",
      "Dismiss",
    );
    if (action === "Open Inbox") {
      vscode.commands.executeCommand("gitchat.openNotifications");
    } else if (action === "Mark All Read") {
      await notificationStore.markRead(allIds);
    }
  }
}

export const toastCoordinator = new ToastCoordinator();
