import axios, { AxiosInstance } from "axios";
import type {
  Conversation,
  ConversationParticipant,
  ExtensionModule,
  FeedEvent,
  FollowStatus,
  Message,
  Notification,
  RepoDetail,
  SearchResult,
  TrendingPerson,
  TrendingRepo,
  UserProfile,
  UserRepo,
} from "../types";
import { configManager } from "../config";
import { authManager } from "../auth";
import { log } from "../utils";

class ApiClient {
  private _http!: AxiosInstance;

  init(): void {
    this._http = axios.create({
      baseURL: configManager.current.apiUrl,
      timeout: 15000,
    });

    this._http.interceptors.request.use((config) => {
      // GitHubAuthGuard validates tokens against api.github.com/user directly,
      // so we must use the GitHub access token, not the Gitstar JWT.
      const token = authManager.token;
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    });

    this._http.interceptors.response.use(
      (res) => res,
      (err) => {
        if (err.response?.status === 401) {
          const url = err.config?.url ?? "";
          log(`401 on ${url}`, "warn");
        }
        throw err;
      }
    );

    configManager.onDidChange(() => {
      this._http.defaults.baseURL = configManager.current.apiUrl;
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private extractArray(data: any, ...keys: string[]): any[] {
    // Backend wraps responses: { data: { users: [...] }, statusCode, message }
    // Try unwrapped first, then try inside .data wrapper
    const sources = [data, data?.data];
    for (const src of sources) {
      for (const key of keys) {
        if (src?.[key] && Array.isArray(src[key])) { return src[key]; }
      }
    }
    if (data?.data && Array.isArray(data.data)) { return data.data; }
    if (Array.isArray(data)) { return data; }
    return [];
  }

  async getTrendingRepos(timeRange = "weekly"): Promise<TrendingRepo[]> {
    const { data } = await this._http.get("/trending/repos", { params: { time_range: timeRange } });
    return this.extractArray(data, "repos");
  }

  async getTrendingPeople(timeRange = "weekly"): Promise<TrendingPerson[]> {
    const { data } = await this._http.get("/trending/people", { params: { time_range: timeRange } });
    return this.extractArray(data, "people", "users");
  }

  async getHomeFeed(page = 1): Promise<FeedEvent[]> {
    const { data } = await this._http.post("/home-feed", { page });
    return this.extractArray(data, "events", "feed");
  }

  async getUserRepos(): Promise<UserRepo[]> {
    // Fetch from GitHub API directly for complete list including private repos
    const token = authManager.token;
    if (!token) { return []; }
    const res = await fetch("https://api.github.com/user/repos?per_page=100&sort=updated&affiliation=owner", {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    });
    if (!res.ok) { return []; }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const repos = (await res.json()) as any[];
    return repos.map((r) => ({
      name: r.name,
      owner: r.owner?.login ?? "",
      description: r.description ?? "",
      stars: r.stargazers_count ?? 0,
      forks: r.forks_count ?? 0,
      language: r.language ?? "",
      private: r.private ?? false,
      html_url: r.html_url ?? "",
      avatar_url: r.owner?.avatar_url ?? `https://github.com/${r.owner?.login ?? ""}.png`,
    }));
  }

  async getStarredRepos(): Promise<UserRepo[]> {
    const token = authManager.token;
    if (!token) { return []; }
    const res = await fetch("https://api.github.com/user/starred?per_page=100&sort=updated", {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    });
    if (!res.ok) { return []; }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const repos = (await res.json()) as any[];
    return repos.map((r) => ({
      name: r.name,
      owner: r.owner?.login ?? "",
      description: r.description ?? "",
      stars: r.stargazers_count ?? 0,
      forks: r.forks_count ?? 0,
      language: r.language ?? "",
      private: r.private ?? false,
      html_url: r.html_url ?? "",
      avatar_url: r.owner?.avatar_url ?? `https://github.com/${r.owner?.login ?? ""}.png`,
    }));
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getFollowing(page = 1, perPage = 50): Promise<any[]> {
    const { data } = await this._http.get("/following", { params: { page, per_page: perPage } });
    return this.extractArray(data, "users", "following");
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getFollowers(page = 1, perPage = 50): Promise<any[]> {
    const { data } = await this._http.get("/followers", { params: { page, per_page: perPage } });
    return this.extractArray(data, "users", "followers");
  }

  async syncGitHubFollows(): Promise<{ imported_following: number; imported_followers: number; mutual: number }> {
    const { data } = await this._http.post("/following/sync");
    return data?.data || data;
  }

  async getPresence(logins: string[]): Promise<Record<string, string | null>> {
    if (logins.length === 0) { return {}; }
    const { data } = await this._http.get("/presence", { params: { logins: logins.join(",") } });
    return data.presence ?? data.data?.presence ?? {};
  }

  async sendHeartbeat(): Promise<void> {
    await this._http.patch("/presence");
  }

  async followUser(username: string): Promise<void> {
    await this._http.put(`/follow/${username}`);
  }

  async unfollowUser(username: string): Promise<void> {
    await this._http.delete(`/follow/${username}`);
  }

  async getFollowStatus(username: string): Promise<FollowStatus> {
    const { data } = await this._http.get(`/follow/${username}`);
    return data;
  }

  async batchFollowStatus(logins: string[]): Promise<Record<string, FollowStatus>> {
    try {
      const res = await this._http.post("/follow/batch-status", { logins });
      return res.data || {};
    } catch {
      return {};
    }
  }

  async starRepo(owner: string, repo: string): Promise<void> {
    await this._http.put(`/star/${owner}/${repo}`);
  }

  async unstarRepo(owner: string, repo: string): Promise<void> {
    await this._http.delete(`/star/${owner}/${repo}`);
  }

  async batchCheckStarred(repos: string[]): Promise<Record<string, boolean>> {
    try {
      const res = await this._http.get("/star/batch", {
        params: { repos: repos.join(",") },
      });
      return res.data || {};
    } catch {
      return {};
    }
  }

  async toggleLike(owner: string, repo: string, eventId: string): Promise<void> {
    await this._http.post(`/likes/${owner}/${repo}`, { event_id: eventId });
  }

  async getConversations(): Promise<Conversation[]> {
    const { data } = await this._http.get("/messages/conversations");
    return this.extractArray(data, "conversations");
  }

  async getMessages(conversationId: string, pages = 1, startCursor?: string): Promise<{ messages: Message[]; hasMore: boolean; cursor?: string; otherReadAt?: string }> {
    let allMessages: Message[] = [];
    let cursor: string | undefined = startCursor;
    let hasMore = false;
    let otherReadAt: string | undefined;

    for (let p = 0; p < pages; p++) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const params: any = { limit: 50 };
      if (cursor) { params.cursor = cursor; }
      const res = await this._http.get(`/messages/conversations/${conversationId}`, { params });
      const response = res.data?.data ?? res.data;
      const data = this.extractArray(response, "messages");
      allMessages = [...allMessages, ...data];
      cursor = response?.cursor || response?.next_cursor;
      if (!otherReadAt) { otherReadAt = response?.otherReadAt || response?.other_read_at; }
      hasMore = data.length >= 50;
      if (!hasMore) { break; }
    }

    return { messages: allMessages.reverse(), hasMore, cursor, otherReadAt };
  }

  async sendMessage(conversationId: string, content: string): Promise<Message> {
    const { data } = await this._http.post(`/messages/conversations/${conversationId}`, { body: content });
    return data.data ?? data;
  }

  async createConversation(username: string): Promise<Conversation> {
    const { data } = await this._http.post("/messages/conversations", { recipient_login: username });
    return data.data ?? data;
  }

  async createGroupConversation(recipientLogins: string[], groupName?: string): Promise<Conversation> {
    const { data } = await this._http.post("/messages/conversations", {
      recipient_logins: recipientLogins,
      group_name: groupName,
    });
    return data?.data ?? data;
  }

  async getGroupMembers(conversationId: string): Promise<{ login: string; name: string | null; avatar_url: string | null }[]> {
    const { data } = await this._http.get(`/messages/conversations/${conversationId}/members`);
    return data?.data ?? data ?? [];
  }

  async addGroupMember(conversationId: string, login: string): Promise<void> {
    await this._http.post(`/messages/conversations/${conversationId}/members`, { login });
  }

  async leaveGroup(conversationId: string): Promise<void> {
    await this._http.post(`/messages/conversations/${conversationId}/leave`);
  }

  async removeGroupMember(conversationId: string, memberLogin: string): Promise<void> {
    await this._http.delete(`/messages/conversations/${conversationId}/members/${memberLogin}`);
  }

  async updateGroup(conversationId: string, groupName?: string, groupAvatarUrl?: string): Promise<void> {
    await this._http.patch(`/messages/conversations/${conversationId}/group`, {
      group_name: groupName,
      group_avatar_url: groupAvatarUrl,
    });
  }

  async muteConversation(conversationId: string): Promise<void> {
    await this._http.post(`/messages/conversations/${conversationId}/mute`);
  }

  async unmuteConversation(conversationId: string): Promise<void> {
    await this._http.delete(`/messages/conversations/${conversationId}/mute`);
  }

  async markConversationRead(conversationId: string): Promise<void> {
    await this._http.patch(`/messages/conversations/${conversationId}/read`);
  }

  async pinConversation(conversationId: string): Promise<void> {
    await this._http.post(`/messages/conversations/${conversationId}/pin`);
  }

  async unpinConversation(conversationId: string): Promise<void> {
    await this._http.delete(`/messages/conversations/${conversationId}/pin`);
  }

  async deleteConversation(conversationId: string): Promise<void> {
    await this._http.post(`/messages/conversations/${conversationId}/delete`);
  }

  async getUnreadMessageCount(): Promise<number> {
    const { data } = await this._http.get("/messages/unread-count");
    return data.count ?? data.unread_count ?? 0;
  }

  async addReaction(emoji: string, messageId: string): Promise<void> {
    await this._http.post("/messages/reactions", { emoji, message_id: messageId });
  }

  async removeReaction(emoji: string, messageId: string): Promise<void> {
    await this._http.delete("/messages/reactions", { data: { emoji, message_id: messageId } });
  }

  async editMessage(conversationId: string, messageId: string, body: string): Promise<void> {
    await this._http.patch(`/messages/conversations/${conversationId}/messages/${messageId}`, { body });
  }

  async deleteMessage(conversationId: string, messageId: string): Promise<void> {
    await this._http.delete(`/messages/conversations/${conversationId}/messages/${messageId}`);
  }

  async unsendMessage(conversationId: string, messageId: string): Promise<void> {
    await this._http.post(`/messages/conversations/${conversationId}/messages/${messageId}/unsend`);
  }

  async replyToMessage(conversationId: string, content: string, replyToId: string): Promise<Message> {
    const { data } = await this._http.post(`/messages/conversations/${conversationId}`, { body: content, reply_to_id: replyToId });
    return data.data ?? data;
  }

  async pinMessage(conversationId: string, messageId: string): Promise<void> {
    await this._http.post(`/messages/conversations/${conversationId}/messages/${messageId}/pin`);
  }

  async unpinMessage(conversationId: string, messageId: string): Promise<void> {
    await this._http.delete(`/messages/conversations/${conversationId}/messages/${messageId}/pin`);
  }

  async getPinnedMessages(conversationId: string): Promise<Message[]> {
    const { data } = await this._http.get(`/messages/conversations/${conversationId}/pinned-messages`);
    return this.extractArray(data, "messages", "pinned_messages");
  }

  async getLinkPreview(url: string): Promise<{ title?: string; description?: string; image?: string; url: string }> {
    const { data } = await this._http.get("/messages/link-preview", { params: { url } });
    return data.data ?? data;
  }

  async getNotifications(page = 1): Promise<Notification[]> {
    const { data } = await this._http.get("/notifications", { params: { page } });
    return this.extractArray(data, "notifications");
  }

  async markNotificationsRead(ids: string[]): Promise<void> {
    await this._http.patch("/notifications/read", { ids });
  }

  async getUnreadNotificationCount(): Promise<number> {
    const { data } = await this._http.get("/notifications/unread-count");
    return data.count ?? data.unread_count ?? 0;
  }

  async getMyProfile(): Promise<UserProfile> {
    const { data } = await this._http.get("/user/profile");
    return data;
  }

  async getUserProfile(username: string): Promise<UserProfile> {
    const { data } = await this._http.get(`/user/${username}`);
    return data;
  }

  async getRepoDetail(owner: string, repo: string): Promise<RepoDetail> {
    const { data } = await this._http.get(`/repo/${owner}/${repo}`);
    const response = data.data ?? data;
    // API returns { repo: {...}, stats: {...}, contributors: [...] }
    const repoData = response.repo ?? response;
    return {
      ...repoData,
      owner: repoData.owner ?? owner,
      name: repoData.name ?? repo,
      stars: repoData.stargazers_count ?? repoData.stars ?? 0,
      forks: repoData.forks_count ?? repoData.forks ?? 0,
      watchers: repoData.watchers_count ?? repoData.watchers ?? 0,
      avatar_url: repoData.owner?.avatar_url ?? `https://github.com/${owner}.png`,
      contributors: response.contributors ?? [],
      readme_html: response.readme ?? "",
    };
  }

  async search(query: string): Promise<SearchResult> {
    const { data } = await this._http.get("/search", { params: { q: query } });
    return data;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getFollowingSuggestions(): Promise<any[]> {
    const { data } = await this._http.get("/following/suggestions");
    return this.extractArray(data, "users", "suggestions");
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getUserPreview(username: string): Promise<any> {
    const res = await this._http.get(`/user/${username}/preview`);
    return res.data;
  }

  async searchUsers(query: string): Promise<{ login: string; name: string | null; avatar_url: string | null }[]> {
    if (!query || query.length < 1) { return []; }
    const { data } = await this._http.get("/search/users", { params: { q: query } });
    const items = data?.data ?? data;
    return Array.isArray(items) ? items.slice(0, 10) : [];
  }
}

export const apiClient = new ApiClient();

export function getOtherUser(conv: Conversation, myLogin: string | null): ConversationParticipant | null {
  if ((conv as Conversation & { other_user?: ConversationParticipant }).other_user) {
    return (conv as Conversation & { other_user?: ConversationParticipant }).other_user ?? null;
  }
  if (conv.participants?.length) {
    return conv.participants.find((p) => p.login !== myLogin) ?? conv.participants[0];
  }
  return null;
}

export const apiClientModule: ExtensionModule = {
  id: "apiClient",
  activate(_context) {
    apiClient.init();
    log("API client initialized");
  },
};
