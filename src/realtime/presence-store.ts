import * as vscode from "vscode";

export interface PresenceEntry {
  online: boolean;
  lastSeenAt: string | null;
}

export interface PresenceStoreOptions {
  maxEntries?: number;
}

/**
 * Single source of truth for presence state across the extension.
 * Writes from RealtimeClient (presence:*, discover:online-now:*, defensive
 * nudge), reads from every webview. LRU-capped (default 1000 entries);
 * evicted entries fire onEvict so the caller can emit unwatch:presence.
 * Writes refresh LRU position; reads do not. A `set()` call with an unchanged value still moves the entry to MRU.
 */
export class PresenceStore {
  private readonly _maxEntries: number;
  // Map preserves insertion order → used as LRU queue
  private readonly _map = new Map<string, PresenceEntry>();
  private readonly _changeEmitter = new vscode.EventEmitter<{ login: string; entry: PresenceEntry }>();
  private readonly _evictEmitter = new vscode.EventEmitter<string>();

  readonly onChange = this._changeEmitter.event;
  readonly onEvict = this._evictEmitter.event;

  constructor(opts: PresenceStoreOptions = {}) {
    this._maxEntries = opts.maxEntries ?? 1000;
  }

  get(login: string): PresenceEntry | undefined {
    return this._map.get(login);
  }

  set(login: string, entry: PresenceEntry): void {
    const prev = this._map.get(login);
    if (prev && prev.online === entry.online && prev.lastSeenAt === entry.lastSeenAt) {
      // Refresh LRU position even on no-change write
      this._map.delete(login);
      this._map.set(login, prev);
      return;
    }
    if (this._map.has(login)) {
      this._map.delete(login);
    } else if (this._map.size >= this._maxEntries) {
      const oldest = this._map.keys().next().value as string | undefined;
      if (oldest) {
        this._map.delete(oldest);
        this._evictEmitter.fire(oldest);
      }
    }
    this._map.set(login, entry);
    this._changeEmitter.fire({ login, entry });
  }

  bulkSet(entries: Record<string, PresenceEntry>): void {
    for (const [login, entry] of Object.entries(entries)) {
      this.set(login, entry);
    }
  }

  snapshot(): Record<string, PresenceEntry> {
    return Object.fromEntries(this._map);
  }

  dispose(): void {
    this._changeEmitter.dispose();
    this._evictEmitter.dispose();
  }
}

export const presenceStore = new PresenceStore();
