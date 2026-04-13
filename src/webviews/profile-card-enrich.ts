// enrichProfile() composes real API data with the isolated mock layer.
// Real sources: apiClient.getUserProfile (parent call), src/api/github.ts
// Mock sources:  src/webviews/profile-card-mocks.ts

import type { UserProfile, ProfileCardData } from "../types";

export async function enrichProfile(
  raw: UserProfile,
  currentUserLogin: string
): Promise<ProfileCardData> {
  void currentUserLogin;
  // Real composition lands in Task 4.
  return {
    login: raw.login,
    name: raw.name,
    avatar_url: raw.avatar_url,
    bio: raw.bio,
    public_repos: raw.public_repos,
    followers: raw.followers,
    following: raw.following,
    follow_status: { following: false, followed_by: false },
    on_gitchat: true,
  };
}
