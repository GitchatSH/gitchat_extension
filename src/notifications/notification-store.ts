import * as vscode from "vscode";
import type { Notification } from "../types";
import { apiClient } from "../api";
import { authManager } from "../auth";
import { log } from "../utils";

/**
 * In-memory cache of the user's notification list.
 *
 * The backend is the source of truth — this store exists so UI surfaces
 * (Explore Chat tab inline section, status bar badge) can share one list
 * without each making its own API call.
 */
class NotificationStore {
  private _items: Notification[] = [];
  private _unreadCount = 0;
  private _nextCursor: string | null = null;

  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  get items(): readonly Notification[] { return this._items; }
  get unreadCount(): number { return this._unreadCount; }
  get nextCursor(): string | null { return this._nextCursor; }

  async refresh(): Promise<void> {
    if (!authManager.isSignedIn) {
      this._items = [];
      this._unreadCount = 0;
      this._nextCursor = null;
      this._onDidChange.fire();
      return;
    }
    try {
      const result = await apiClient.getNotifications();
      this._items = result.data;
      this._unreadCount = result.unreadCount;
      this._nextCursor = result.nextCursor;
      this._onDidChange.fire();
      log(`[NotificationStore] refreshed ${this._items.length} items, ${this._unreadCount} unread`);
    } catch (err) {
      log(`[NotificationStore] refresh failed: ${err}`, "warn");
    }
  }

  prepend(notification: Notification): void {
    // Dedupe by id — if server re-emits (e.g. grouping update) replace in place
    const existingIndex = this._items.findIndex((n) => n.id === notification.id);
    if (existingIndex >= 0) {
      this._items[existingIndex] = notification;
    } else {
      this._items.unshift(notification);
      if (!notification.is_read) {
        this._unreadCount = Math.min(99, this._unreadCount + 1);
      }
    }
    this._onDidChange.fire();
  }

  async markAllRead(): Promise<void> {
    if (!authManager.isSignedIn || this._unreadCount === 0) { return; }
    try {
      await apiClient.markNotificationsRead();
      this._items = this._items.map((n) => ({ ...n, is_read: true }));
      this._unreadCount = 0;
      this._onDidChange.fire();
    } catch (err) {
      log(`[NotificationStore] markAllRead failed: ${err}`, "warn");
    }
  }

  async markRead(ids: string[]): Promise<void> {
    if (!authManager.isSignedIn || ids.length === 0) { return; }
    try {
      await apiClient.markNotificationsRead(ids);
      const idSet = new Set(ids);
      this._items = this._items.map((n) => (idSet.has(n.id) && !n.is_read ? { ...n, is_read: true } : n));
      this._unreadCount = this._items.filter((n) => !n.is_read).length;
      this._onDidChange.fire();
    } catch (err) {
      log(`[NotificationStore] markRead failed: ${err}`, "warn");
    }
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}

export const notificationStore = new NotificationStore();
