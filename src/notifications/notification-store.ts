import * as vscode from "vscode";
import type { Notification } from "../types";
import { apiClient } from "../api";
import { authManager } from "../auth";
import { log } from "../utils";

/**
 * Notification types this client renders. Anything else returned by the BE
 * (legacy: event_like, post_like, event_comment, post_reply, event_quote,
 * repo_starred, achievement_unlocked, …) is filtered out client-side so the
 * Noti tab only ever shows the 5 categories WP10 cares about.
 */
const SUPPORTED_TYPES = new Set([
  "mention",
  "wave",
  "follow",
  "new_message",
  "repo_activity",
]);

function isSupported(n: Notification): boolean {
  return SUPPORTED_TYPES.has(n.type);
}

/**
 * In-memory cache of the user's notification list.
 *
 * The backend is the source of truth — this store exists so UI surfaces
 * (Notification tab pane, tab badge) can share one list without each
 * making its own API call.
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
      // Drop unsupported types client-side; recompute unreadCount from filtered set.
      this._items = result.data.filter(isSupported);
      this._unreadCount = this._items.filter((n) => !n.is_read).length;
      this._nextCursor = result.nextCursor;
      this._onDidChange.fire();
      log(`[NotificationStore] refreshed ${this._items.length}/${result.data.length} items (after filter), ${this._unreadCount} unread`);
    } catch (err) {
      log(`[NotificationStore] refresh failed: ${err}`, "warn");
    }
  }

  prepend(notification: Notification): void {
    if (!isSupported(notification)) { return; }
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

  /**
   * Mark all currently visible items as "seen" — clears the unread badge but
   * keeps each item's `is_read` flag untouched, so unread dots remain in the
   * UI until the user actually clicks an item. Linear / Slack pattern.
   *
   * Local-only: nothing is sent to the backend. The next refresh from the
   * server will rehydrate the real unreadCount.
   */
  markAllSeen(): void {
    if (this._unreadCount === 0) { return; }
    this._unreadCount = 0;
    this._onDidChange.fire();
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
