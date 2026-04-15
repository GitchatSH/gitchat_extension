import * as vscode from "vscode";
import type { Notification } from "../types";
import { log } from "../utils";
import { notificationStore } from "./notification-store";

const TOAST_COOLDOWN_MS = 8000;

export interface ShowToastRequest {
  notification: Notification;
  title: string;
  body: string;
}

class ToastCoordinator {
  private toastInFlight = false;
  private lastToastAt = 0;

  async show(request: ShowToastRequest): Promise<void> {
    if (this.shouldThrottle()) {
      log(
        `[Notifications] toast throttled (in-flight=${this.toastInFlight}, cooldown=${Date.now() - this.lastToastAt}ms)`,
      );
      return;
    }
    this.toastInFlight = true;
    this.lastToastAt = Date.now();

    const { notification, title, body } = request;
    const conversationId = notification.metadata?.conversationId;
    const primary = conversationId ? "Open Chat" : "Open";

    try {
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
    } finally {
      this.toastInFlight = false;
      this.lastToastAt = Date.now();
    }
  }

  private shouldThrottle(): boolean {
    if (this.toastInFlight) {
      return true;
    }
    if (Date.now() - this.lastToastAt < TOAST_COOLDOWN_MS) {
      return true;
    }
    return false;
  }
}

export const toastCoordinator = new ToastCoordinator();
