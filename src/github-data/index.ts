import * as vscode from "vscode";
import type {
  ExtensionModule,
  StarredRepo,
  ContributedRepo,
  FriendUser,
  FriendsPayload,
  RichProfile,
} from "../types";
import { apiClient } from "../api";
import { authManager } from "../auth";
import { log } from "../utils";

// 24 hours — spec TTL
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

type DataType = "starred" | "contributed" | "friends" | "profile";

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;   // epoch ms
  ttlMs: number;
  userLogin: string;   // which account owns this cache (prevent cross-account leak)
}

interface ChangeEvent {
  type: DataType;
}

const KEY = {
  starred: "gitchat.cache.starred",
  contributed: "gitchat.cache.contributed",
  friends: "gitchat.cache.friends",
  profile: "gitchat.cache.profile",
} as const;

/**
 * WP11: persistent 24h cache for GitHub data sourced from the backend.
 *
 * Layering (client side):
 *   1. In-memory (this class state) — hot reads within the same session
 *   2. context.globalState — survives window reload, keyed per user login
 *   3. Backend `/github/data/*` — which itself has Redis/Postgres caching
 *
 * On sign-out, `clearForUser(login)` must be called to avoid leaking data to
 * the next account that signs into the same workspace.
 */
class GithubDataCache {
  private _context: vscode.ExtensionContext | undefined;
  private _memory = new Map<DataType, CacheEntry<unknown>>();
  private readonly _emitter = new vscode.EventEmitter<ChangeEvent>();
  readonly onDidChange: vscode.Event<ChangeEvent> = this._emitter.event;

  setContext(ctx: vscode.ExtensionContext): void {
    this._context = ctx;
    // Hydrate memory layer from globalState so the first reads after reload are free.
    for (const type of ["starred", "contributed", "friends", "profile"] as DataType[]) {
      const entry = this._readEntry(type);
      if (entry) {this._memory.set(type, entry);}
    }
  }

  // ─── Public read APIs ───────────────────────────────────────────

  async getStarred(opts: { force?: boolean } = {}): Promise<StarredRepo[]> {
    return this._get<StarredRepo[]>("starred", opts, async () => {
      const res = await apiClient.getMyStarredRepos(opts.force);
      return res.repos;
    });
  }

  async getContributed(opts: { force?: boolean } = {}): Promise<ContributedRepo[]> {
    return this._get<ContributedRepo[]>("contributed", opts, async () => {
      const res = await apiClient.getMyContributedRepos(opts.force);
      return res.repos;
    });
  }

  async getFriends(opts: { force?: boolean } = {}): Promise<FriendsPayload> {
    return this._get<FriendsPayload>("friends", opts, async () => {
      const res = await apiClient.getMyFriends(opts.force);
      return { mutual: res.mutual, notOnGitchat: res.notOnGitchat };
    });
  }

  async getProfile(opts: { force?: boolean } = {}): Promise<RichProfile> {
    return this._get<RichProfile>("profile", opts, async () => {
      const res = await apiClient.getMyRichProfile(opts.force);
      return res.profile;
    });
  }

  /**
   * Back-compat helper for callers that used to fetch following directly from
   * GitHub (fetchGitHubFollowing pattern in explore.ts / chat-panel.ts). Returns
   * the mutual list in the shape those callers expect.
   */
  async getFollowing(): Promise<{ login: string; name: string; avatar_url: string }[]> {
    try {
      const payload = await this.getFriends();
      return [...payload.mutual, ...payload.notOnGitchat].map((f) => ({
        login: f.login,
        name: f.name ?? f.login,
        avatar_url: f.avatarUrl ?? `https://github.com/${f.login}.png`,
      }));
    } catch (err) {
      log(`[GithubData] getFollowing fallback failed: ${err}`, "warn");
      return [];
    }
  }

  async refreshAll(): Promise<void> {
    if (!authManager.isSignedIn) {return;}
    log("[GithubData] refreshAll triggered");
    try {
      await apiClient.refreshAllGithubData();
    } catch (err) {
      log(`[GithubData] refreshAll backend kick-off failed: ${err}`, "warn");
    }
    // Force re-fetch each data type into local cache (non-blocking each).
    await Promise.allSettled([
      this.getStarred({ force: true }),
      this.getContributed({ force: true }),
      this.getFriends({ force: true }),
      this.getProfile({ force: true }),
    ]);
  }

  async clearForUser(login: string): Promise<void> {
    if (!this._context) {return;}
    const lc = login.toLowerCase();
    for (const type of ["starred", "contributed", "friends", "profile"] as DataType[]) {
      const entry = this._readEntry(type);
      if (entry && entry.userLogin.toLowerCase() === lc) {
        await this._context.globalState.update(KEY[type], undefined);
        this._memory.delete(type);
      }
    }
  }

  // ─── Internals ───────────────────────────────────────────────────

  private async _get<T>(
    type: DataType,
    opts: { force?: boolean },
    fetcher: () => Promise<T>,
  ): Promise<T> {
    const currentLogin = authManager.login ?? "";
    if (!currentLogin) {throw new Error("Not signed in");}

    if (!opts.force) {
      const cached = this._memory.get(type) as CacheEntry<T> | undefined;
      if (cached && cached.userLogin === currentLogin && this._isFresh(cached)) {
        return cached.data;
      }
    }

    try {
      const data = await fetcher();
      const entry: CacheEntry<T> = {
        data,
        fetchedAt: Date.now(),
        ttlMs: CACHE_TTL_MS,
        userLogin: currentLogin,
      };
      this._memory.set(type, entry);
      if (this._context) {
        await this._context.globalState.update(KEY[type], entry);
      }
      this._emitter.fire({ type });
      return data;
    } catch (err) {
      // On failure, return whatever we have (even if expired) rather than throw.
      const stale = this._readEntry(type) as CacheEntry<T> | undefined;
      if (stale && stale.userLogin === currentLogin) {
        log(`[GithubData] ${type} fetch failed, returning stale cache: ${err}`, "warn");
        return stale.data;
      }
      throw err;
    }
  }

  private _readEntry<T>(type: DataType): CacheEntry<T> | undefined {
    if (!this._context) {return undefined;}
    const entry = this._context.globalState.get<CacheEntry<T>>(KEY[type]);
    return entry && typeof entry === "object" && "data" in entry ? entry : undefined;
  }

  private _isFresh<T>(entry: CacheEntry<T>): boolean {
    return Date.now() - entry.fetchedAt < entry.ttlMs;
  }
}

export const githubDataCache = new GithubDataCache();

export const githubDataModule: ExtensionModule = {
  id: "githubData",
  activate(context) {
    githubDataCache.setContext(context);
    log("[GithubData] cache initialized");
  },
};

// Re-export for consumers
export type { StarredRepo, ContributedRepo, FriendUser, FriendsPayload, RichProfile };
