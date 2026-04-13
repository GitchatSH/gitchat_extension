// Thin GitHub REST wrapper for Profile Card (permanent production code).
// Follows the existing apiClient patterns in src/api/index.ts.

import { authManager } from "../auth";
import { log } from "../utils";

export interface GitHubUserSummary {
  login: string;
  avatar_url: string;
}

export interface GitHubRepoSummary {
  owner: string;
  name: string;
}

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const _followersCache = new Map<string, CacheEntry<GitHubUserSummary[]>>();
const _starredCache = new Map<string, CacheEntry<GitHubRepoSummary[]>>();

function isFresh<T>(entry: CacheEntry<T> | undefined): entry is CacheEntry<T> {
  return entry !== undefined && Date.now() - entry.fetchedAt < CACHE_TTL_MS;
}

async function ghFetch(path: string): Promise<unknown> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (authManager.token) {
    headers.Authorization = `Bearer ${authManager.token}`;
  }
  const res = await fetch(`https://api.github.com${path}`, { headers });
  if (!res.ok) {
    throw new Error(`GitHub API ${path} → HTTP ${res.status}`);
  }
  return res.json();
}

export async function getUserFollowers(login: string): Promise<GitHubUserSummary[]> {
  const cached = _followersCache.get(login);
  if (isFresh(cached)) { return cached.data; }
  try {
    const raw = (await ghFetch(`/users/${encodeURIComponent(login)}/followers?per_page=100`)) as { login: string; avatar_url: string }[];
    const data = raw.map((u) => ({ login: u.login, avatar_url: u.avatar_url }));
    _followersCache.set(login, { data, fetchedAt: Date.now() });
    return data;
  } catch (err) {
    log(`[github] getUserFollowers(${login}) failed: ${err}`, "warn");
    return [];
  }
}

export async function getUserStarred(login: string): Promise<GitHubRepoSummary[]> {
  const cached = _starredCache.get(login);
  if (isFresh(cached)) { return cached.data; }
  try {
    const raw = (await ghFetch(`/users/${encodeURIComponent(login)}/starred?per_page=100`)) as { owner: { login: string }; name: string }[];
    const data = raw.map((r) => ({ owner: r.owner.login, name: r.name }));
    _starredCache.set(login, { data, fetchedAt: Date.now() });
    return data;
  } catch (err) {
    log(`[github] getUserStarred(${login}) failed: ${err}`, "warn");
    return [];
  }
}
