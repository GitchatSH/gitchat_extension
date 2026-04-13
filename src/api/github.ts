// Thin GitHub REST wrapper for Profile Card (permanent production code).
// Follows the existing apiClient patterns in src/api/index.ts.

export interface GitHubUserSummary {
  login: string;
  avatar_url: string;
}

export interface GitHubRepoSummary {
  owner: string;
  name: string;
}

export async function getUserFollowers(login: string): Promise<GitHubUserSummary[]> {
  // Real implementation lands in Task 2
  void login;
  return [];
}

export async function getUserStarred(login: string): Promise<GitHubRepoSummary[]> {
  // Real implementation lands in Task 2
  void login;
  return [];
}
