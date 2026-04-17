import type * as vscode from "vscode";
import type { Message } from "../types";
import { log } from "../utils";

/**
 * Persistent per-conversation message cache for stale-while-revalidate UX.
 *
 * Goals (issue #51):
 * - Skip the skeleton loading on subsequent opens of the same group chat,
 *   even across VS Code reloads.
 * - Render cached messages immediately, then merge in fresh messages
 *   arriving from the API in the background.
 *
 * Storage: `globalState`, keyed per signed-in user to avoid cross-account
 * leak. LRU-capped so the cache doesn't grow unbounded.
 */

export interface CachedGroupMember {
  login: string;
  name: string | null;
  avatar_url: string | null;
}

export interface MessageCacheEntry {
  messages: Message[];
  hasMore: boolean;
  fetchedAt: number;
  lastMessageId: string | null;
  groupMembers?: CachedGroupMember[];
}

interface IndexEntry {
  id: string;
  touchedAt: number;
}

const MAX_MESSAGES_PER_CONV = 30;
const MAX_CONVERSATIONS = 20;
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const KEY_PREFIX = "gitchat.msgCache.v1";

function entryKey(login: string, convId: string): string {
  return `${KEY_PREFIX}.${login}.${convId}`;
}

function indexKey(login: string): string {
  return `${KEY_PREFIX}.${login}.__index__`;
}

class MessageCacheService {
  private _context?: vscode.ExtensionContext;
  private _getLogin?: () => string | null | undefined;

  init(context: vscode.ExtensionContext, getLogin: () => string | null | undefined): void {
    this._context = context;
    this._getLogin = getLogin;
  }

  /** Read a cached entry. Returns undefined on miss or stale TTL. */
  get(convId: string): MessageCacheEntry | undefined {
    const login = this._getLogin?.();
    if (!login || !this._context) { return undefined; }
    const entry = this._context.globalState.get<MessageCacheEntry>(entryKey(login, convId));
    if (!entry) { return undefined; }
    if (Date.now() - entry.fetchedAt > TTL_MS) {
      // Stale — drop silently.
      void this._context.globalState.update(entryKey(login, convId), undefined);
      this._removeFromIndex(login, convId);
      return undefined;
    }
    // LRU touch.
    this._touchIndex(login, convId);
    return entry;
  }

  /**
   * Write latest-N messages for a conversation. Replaces any previous entry.
   * Evicts LRU conversations when exceeding MAX_CONVERSATIONS.
   */
  set(convId: string, messages: Message[], hasMore: boolean, groupMembers?: CachedGroupMember[]): void {
    const login = this._getLogin?.();
    if (!login || !this._context) { return; }
    const trimmed = messages.slice(-MAX_MESSAGES_PER_CONV);
    const last = trimmed.length > 0 ? trimmed[trimmed.length - 1] : null;
    const entry: MessageCacheEntry = {
      messages: trimmed,
      hasMore,
      fetchedAt: Date.now(),
      lastMessageId: last?.id ?? null,
      groupMembers,
    };
    void this._context.globalState.update(entryKey(login, convId), entry);
    this._touchIndex(login, convId);
    this._evictIfNeeded(login);
  }

  /** Update just the groupMembers on an existing cache entry. */
  setGroupMembers(convId: string, groupMembers: CachedGroupMember[]): void {
    const login = this._getLogin?.();
    if (!login || !this._context) { return; }
    const entry = this._context.globalState.get<MessageCacheEntry>(entryKey(login, convId));
    if (!entry) { return; }
    const next: MessageCacheEntry = { ...entry, groupMembers };
    void this._context.globalState.update(entryKey(login, convId), next);
  }

  /**
   * Append a realtime message to an existing cache entry. No-op if this
   * conversation has never been cached (the user hasn't opened it yet —
   * no reason to warm on realtime).
   */
  appendRealtime(convId: string, message: Message): void {
    const login = this._getLogin?.();
    if (!login || !this._context) { return; }
    const entry = this._context.globalState.get<MessageCacheEntry>(entryKey(login, convId));
    if (!entry) { return; }
    // Dedup by id — realtime can race with fetches.
    if (entry.messages.some((m) => m.id === message.id)) { return; }
    const merged = [...entry.messages, message].slice(-MAX_MESSAGES_PER_CONV);
    const next: MessageCacheEntry = {
      messages: merged,
      hasMore: entry.hasMore,
      fetchedAt: entry.fetchedAt, // keep original fetch time; TTL is about
      //                             staleness of the initial page, not every
      //                             subsequent delta.
      lastMessageId: message.id,
    };
    void this._context.globalState.update(entryKey(login, convId), next);
    this._touchIndex(login, convId);
  }

  /** Clear every cached conversation for a given user (on signOut). */
  async clearUser(login: string): Promise<void> {
    if (!this._context || !login) { return; }
    const index = this._context.globalState.get<IndexEntry[]>(indexKey(login), []);
    for (const { id } of index) {
      await this._context.globalState.update(entryKey(login, id), undefined);
    }
    await this._context.globalState.update(indexKey(login), undefined);
    log(`[MessageCache] cleared ${index.length} entries for @${login}`);
  }

  /** Developer utility — clear cache for the currently signed-in user. */
  async clearCurrent(): Promise<number> {
    const login = this._getLogin?.();
    if (!login || !this._context) { return 0; }
    const index = this._context.globalState.get<IndexEntry[]>(indexKey(login), []);
    const count = index.length;
    await this.clearUser(login);
    return count;
  }

  // ────────── internals ──────────

  private _touchIndex(login: string, convId: string): void {
    if (!this._context) { return; }
    const index = this._context.globalState.get<IndexEntry[]>(indexKey(login), []);
    const filtered = index.filter((e) => e.id !== convId);
    filtered.push({ id: convId, touchedAt: Date.now() });
    void this._context.globalState.update(indexKey(login), filtered);
  }

  private _removeFromIndex(login: string, convId: string): void {
    if (!this._context) { return; }
    const index = this._context.globalState.get<IndexEntry[]>(indexKey(login), []);
    const filtered = index.filter((e) => e.id !== convId);
    void this._context.globalState.update(indexKey(login), filtered);
  }

  private _evictIfNeeded(login: string): void {
    if (!this._context) { return; }
    const index = this._context.globalState.get<IndexEntry[]>(indexKey(login), []);
    if (index.length <= MAX_CONVERSATIONS) { return; }
    // Oldest-first — evict until within cap.
    const sorted = [...index].sort((a, b) => a.touchedAt - b.touchedAt);
    const toEvict = sorted.slice(0, index.length - MAX_CONVERSATIONS);
    for (const { id } of toEvict) {
      void this._context.globalState.update(entryKey(login, id), undefined);
    }
    const keep = index.filter((e) => !toEvict.some((x) => x.id === e.id));
    void this._context.globalState.update(indexKey(login), keep);
    log(`[MessageCache] evicted ${toEvict.length} LRU entries for @${login}`);
  }
}

export const messageCache = new MessageCacheService();
