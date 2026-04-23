import * as vscode from "vscode";
import type { Notification } from "../types";
import { log } from "../utils";
import { notificationStore } from "./notification-store";
import {
  addMessageToBuckets,
  formatMultiBucketDigest,
  formatSingleBucketDigest,
  type ConversationBucket,
} from "./toast-digest";
import type { ToastAction, ToastRenderer, ToastSpec } from "./toast-renderer";
import { selectRenderer } from "./toast-renderer";

// How long to wait after a toast resolves before starting a fresh burst.
// During this window, new messages accumulate into the pending buckets and
// will be shown as a single digest on the next toast cycle.
const BURST_IDLE_MS = 1500;

// Hard cap on how long a single drain iteration will block waiting on a
// toast to "finish". Slightly longer than the webview's 4s auto-dismiss so
// explicit user clicks/auto-dismiss acks still advance the drain naturally;
// anything past this is assumed dismissed and the next burst proceeds. User
// actions that arrive LATER than this still get applied (applyAction is
// decoupled) — only drain advancement is time-boxed.
const MAX_RENDER_WAIT_MS = 4500;

// If the active drain stays "busy" longer than this, something is wedged
// (renderer gone, ack dropped, promise leaked). Force-reset so the next burst
// always gets a fresh drain loop. Must exceed MAX_RENDER_WAIT_MS +
// BURST_IDLE_MS so healthy flows never trip it.
const DRAIN_WATCHDOG_MS = 20_000;

class ToastCoordinator {
  private pending = new Map<string, ConversationBucket>();
  private urgentQueue: { notification: Notification; title: string; body: string }[] = [];
  private activeToast: Promise<void> | null = null;
  private activeDrainStartedAt: number | null = null;

  private webviewRenderer: ToastRenderer | null = null;
  private nativeRenderer: ToastRenderer | null = null;
  private getRouteCtx: (() => { viewVisible: boolean; windowFocused: boolean | undefined }) | null = null;

  setRenderers(
    webview: ToastRenderer,
    native: ToastRenderer,
    getRouteCtx: () => { viewVisible: boolean; windowFocused: boolean | undefined },
  ): void {
    this.webviewRenderer = webview;
    this.nativeRenderer = native;
    this.getRouteCtx = getRouteCtx;
  }

  /** Returns the webview renderer if wired. Callers (e.g. explore provider) pull
   *  this at webview-mount time to avoid activation-order races with notifications. */
  getWebviewRenderer(): ToastRenderer | null {
    return this.webviewRenderer;
  }

  clearConversation(conversationId: string): void {
    const had = this.pending.delete(conversationId);
    if (had) {
      log(`[Notifications] toast buffer cleared for convo=${conversationId} (user opened chat)`);
    }
  }

  async enqueue(notification: Notification, title: string, body: string): Promise<void> {
    const isChat = notification.type === "new_message";
    const conversationId = notification.metadata?.conversationId;

    log(
      `[ToastCoordinator] enqueue type=${notification.type} convo=${conversationId ?? "-"} ` +
        `pending=${this.pending.size} urgent=${this.urgentQueue.length} active=${!!this.activeToast}`,
    );

    if (isChat && conversationId) {
      addMessageToBuckets(this.pending, notification, conversationId);
    } else {
      this.urgentQueue.push({ notification, title, body });
    }

    this.scheduleDrain();
  }

  private scheduleDrain(): void {
    if (this.activeToast) {
      const elapsed = this.activeDrainStartedAt === null ? 0 : Date.now() - this.activeDrainStartedAt;
      if (elapsed > DRAIN_WATCHDOG_MS) {
        log(
          `[ToastCoordinator] drain watchdog tripped after ${elapsed}ms — forcing fresh drain`,
          "warn",
        );
        this.activeToast = null;
        this.activeDrainStartedAt = null;
      } else {
        return;
      }
    }
    this.activeDrainStartedAt = Date.now();
    this.activeToast = this.drain().finally(() => {
      this.activeToast = null;
      this.activeDrainStartedAt = null;
    });
  }

  private async drain(): Promise<void> {
    log(`[ToastCoordinator] drain start urgent=${this.urgentQueue.length} pending=${this.pending.size}`);
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
    log(`[ToastCoordinator] drain exit`);
  }

  private async showOne(
    notification: Notification,
    title: string,
    body: string,
  ): Promise<void> {
    const conversationId = notification.metadata?.conversationId;
    const primary: ToastAction = conversationId
      ? { kind: "openChat", conversationId }
      : notification.metadata?.url
        ? { kind: "openUrl", url: notification.metadata.url }
        : { kind: "openInbox" };

    const spec: ToastSpec = {
      id: `single:${notification.id}`,
      kind: "single",
      conversationId,
      actorLogin: notification.actor_login,
      actorName: notification.actor_name ?? undefined,
      avatarUrl: notification.actor_avatar_url
        ?? (notification.actor_login ? `https://github.com/${encodeURIComponent(notification.actor_login)}.png?size=80` : undefined),
      title,
      body,
      primary,
      notifIds: [notification.id],
    };

    await this.dispatchWithAdvance(spec);
  }

  private async showChatDigest(buckets: ConversationBucket[]): Promise<void> {
    if (buckets.length === 0) {
      return;
    }
    const allIds = buckets.flatMap((b) => b.notifIds);

    if (buckets.length === 1) {
      const bucket = buckets[0];
      const { title, body } = formatSingleBucketDigest(bucket);
      const spec: ToastSpec = {
        id: `digest:${bucket.conversationId}`,
        kind: "digest",
        conversationId: bucket.conversationId,
        actorLogin: bucket.latestActorLogin,
        actorName: bucket.latestActor,
        actorLogin: bucket.latestActorLogin,
        avatarUrl: bucket.latestActorLogin
          ? `https://github.com/${encodeURIComponent(bucket.latestActorLogin)}.png?size=80`
          : undefined,
        title,
        body,
        primary: { kind: "openChat", conversationId: bucket.conversationId },
        notifIds: allIds,
      };
      await this.dispatchWithAdvance(spec);
      return;
    }

    const { title, body } = formatMultiBucketDigest(buckets);
    const spec: ToastSpec = {
      id: `multi-digest:${Date.now()}`,
      kind: "multi-digest",
      title,
      body,
      primary: { kind: "openInbox" },
      secondary: { kind: "markRead" },
      notifIds: allIds,
    };
    await this.dispatchWithAdvance(spec);
  }

  /**
   * Fire a toast spec and return once the drain is safe to continue.
   *
   * Drain advancement is time-boxed by MAX_RENDER_WAIT_MS — the render
   * promise doesn't need to resolve for us to move on to the next burst.
   * Apply-action still runs when/if the user reacts (open chat, mark read
   * etc.) via a decoupled .then(), so late clicks on a still-visible toast
   * keep working after drain has advanced.
   */
  private async dispatchWithAdvance(spec: ToastSpec): Promise<void> {
    const renderPromise = this.route(spec);
    // Apply action out-of-band. Swallow errors so a broken renderer can't
    // poison the drain.
    renderPromise
      .then((action) => this.applyAction(action, spec))
      .catch((err) => log(`[ToastCoordinator] applyAction failed for ${spec.id}: ${err}`, "warn"));

    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) { return; }
        settled = true;
        resolve();
      };
      const timer = setTimeout(() => {
        log(`[ToastCoordinator] drain advance timeout for ${spec.id} — moving on`);
        finish();
      }, MAX_RENDER_WAIT_MS);
      renderPromise
        .then(() => {
          clearTimeout(timer);
          finish();
        })
        .catch(() => {
          clearTimeout(timer);
          finish();
        });
    });
  }

  private async route(spec: ToastSpec): Promise<ToastAction> {
    if (!this.webviewRenderer || !this.nativeRenderer || !this.getRouteCtx) {
      log(`[Toast] renderers not wired — dropping spec ${spec.id}`, "warn");
      return { kind: "dismiss" };
    }
    const ctx = this.getRouteCtx();
    const decision = selectRenderer({ viewVisible: ctx.viewVisible, windowFocused: ctx.windowFocused });
    // Webview renderer drops to native if not ready
    const webviewReady = (this.webviewRenderer as unknown as { isReady(): boolean }).isReady();
    const fellBack = decision === "webview" && !webviewReady;
    const actual = fellBack ? "native" : decision;
    log(`[ToastCoordinator] route kind=${spec.kind} id=${spec.id} n=${spec.notifIds.length} → ${actual}${fellBack ? " (fallback)" : ""}`);
    const renderer = actual === "webview" ? this.webviewRenderer : this.nativeRenderer;
    return renderer.show(spec);
  }

  private async applyAction(action: ToastAction, spec: ToastSpec): Promise<void> {
    log(`[ToastCoordinator] applyAction kind=${action.kind} id=${spec.id}`);
    switch (action.kind) {
      case "openChat":
        vscode.commands.executeCommand("gitchat.openChat", action.conversationId);
        await notificationStore.markRead(spec.notifIds);
        return;
      case "openInbox":
        vscode.commands.executeCommand("gitchat.openNotifications");
        return;
      case "openUrl":
        vscode.env.openExternal(vscode.Uri.parse(action.url));
        await notificationStore.markRead(spec.notifIds);
        return;
      case "markRead":
        await notificationStore.markRead(spec.notifIds);
        return;
      case "dismiss":
        return;
    }
  }
}

export const toastCoordinator = new ToastCoordinator();
