// enrichProfile() composes real API data with the isolated mock layer.
// Real sources: apiClient.getUserProfile (parent caller), src/api/github.ts
// Mock sources: src/webviews/profile-card-mocks.ts

import type { UserProfile, ProfileCardData, FollowStatus } from "../types";
import { getUserFollowers, getUserStarred } from "../api/github";
import { mockOnGitchat } from "./profile-card-mocks";

export interface EnrichContext {
  myFollowing: { login: string; avatar_url?: string }[];
  myStarred?: { owner: string; name: string }[];
}

function pickTopRepos(raw: UserProfile): ProfileCardData["top_repos"] {
  if (!raw.top_repos || raw.top_repos.length === 0) { return undefined; }
  return raw.top_repos.slice(0, 3).map((r) => ({
    owner: r.owner,
    name: r.name,
    stars: r.stars,
    language: r.language,
    description: r.description,
  }));
}

export async function enrichProfile(
  raw: UserProfile,
  currentUserLogin: string,
  ctx: EnrichContext
): Promise<ProfileCardData> {
  // Self case — skip expensive GitHub calls
  if (raw.login === currentUserLogin) {
    return {
      login: raw.login,
      name: raw.name,
      avatar_url: raw.avatar_url,
      bio: raw.bio,
      public_repos: raw.public_repos,
      followers: raw.followers,
      following: raw.following,
      follow_status: { following: true, followed_by: true },
      on_gitchat: true,
      is_self: true,
      mutual_friends: [],
      mutual_groups: [],
      top_repos: pickTopRepos(raw),
      created_at: raw.created_at,
    };
  }

  const [targetFollowers, targetStarred] = await Promise.all([
    getUserFollowers(raw.login),
    getUserStarred(raw.login),
  ]);

  const myFriendsLogins = new Set(ctx.myFollowing.map((f) => f.login));
  const myStarredKeys = new Set(
    (ctx.myStarred ?? []).map((r) => `${r.owner}/${r.name}`)
  );

  const follow_status: FollowStatus = {
    following: myFriendsLogins.has(raw.login),
    followed_by: targetFollowers.some((f) => f.login === currentUserLogin),
  };

  const mutual_friends = targetFollowers
    .filter((f) => myFriendsLogins.has(f.login))
    .map((f) => ({ login: f.login, avatar_url: f.avatar_url }))
    .slice(0, 8);

  const mutual_groups = targetStarred
    .filter((r) => myStarredKeys.has(`${r.owner}/${r.name}`))
    .slice(0, 6)
    .map((r) => ({
      id: `community:${r.owner}/${r.name}`,
      name: `${r.owner}/${r.name}`,
      type: "community" as const,
    }));

  return {
    login: raw.login,
    name: raw.name,
    avatar_url: raw.avatar_url,
    bio: raw.bio,
    public_repos: raw.public_repos,
    followers: raw.followers,
    following: raw.following,
    follow_status,
    on_gitchat: mockOnGitchat(raw.login),
    is_self: false,
    mutual_friends,
    mutual_groups,
    top_repos: pickTopRepos(raw),
  };
}
