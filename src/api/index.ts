import * as vscode from "vscode";
import axios, { AxiosInstance } from "axios";
import type {
  Conversation,
  ExtensionModule,
  FeedEvent,
  FollowStatus,
  Message,
  Notification,
  RepoDetail,
  SearchResult,
  TrendingPerson,
  TrendingRepo,
  UnreadCounts,
  UserProfile,
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
      const token = authManager.token;
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    });

    this._http.interceptors.response.use(
      (res) => res,
      (err) => {
        if (err.response?.status === 401 && authManager.isSignedIn) {
          log("JWT expired, signing out", "warn");
          authManager.signOut();
        }
        throw err;
      }
    );

    configManager.onDidChange(() => {
      this._http.defaults.baseURL = configManager.current.apiUrl;
    });
  }

  async getTrendingRepos(timeRange = "weekly"): Promise<TrendingRepo[]> {
    const { data } = await this._http.get("/trending/repos", { params: { time_range: timeRange } });
    return data.data ?? data;
  }

  async getTrendingPeople(timeRange = "weekly"): Promise<TrendingPerson[]> {
    const { data } = await this._http.get("/trending/people", { params: { time_range: timeRange } });
    return data.data ?? data;
  }

  async getHomeFeed(page = 1): Promise<FeedEvent[]> {
    const { data } = await this._http.post("/home-feed", { page });
    return data.data ?? data;
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

  async starRepo(owner: string, repo: string): Promise<void> {
    await this._http.put(`/star/${owner}/${repo}`);
  }

  async unstarRepo(owner: string, repo: string): Promise<void> {
    await this._http.delete(`/star/${owner}/${repo}`);
  }

  async toggleLike(owner: string, repo: string, eventId: string): Promise<void> {
    await this._http.post(`/likes/${owner}/${repo}`, { event_id: eventId });
  }

  async getConversations(): Promise<Conversation[]> {
    const { data } = await this._http.get("/messages/conversations");
    return data.data ?? data;
  }

  async getMessages(conversationId: string, page = 1): Promise<Message[]> {
    const { data } = await this._http.get(`/messages/conversations/${conversationId}`, { params: { page } });
    return data.data ?? data;
  }

  async sendMessage(conversationId: string, content: string): Promise<Message> {
    const { data } = await this._http.post(`/messages/conversations/${conversationId}`, { content });
    return data.data ?? data;
  }

  async createConversation(username: string): Promise<Conversation> {
    const { data } = await this._http.post("/messages/conversations", { username });
    return data.data ?? data;
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

  async getNotifications(page = 1): Promise<Notification[]> {
    const { data } = await this._http.get("/notifications", { params: { page } });
    return data.data ?? data;
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
    return data;
  }

  async search(query: string): Promise<SearchResult> {
    const { data } = await this._http.get("/search", { params: { q: query } });
    return data;
  }

  async sendHeartbeat(): Promise<void> {
    await this._http.patch("/presence");
  }
}

export const apiClient = new ApiClient();

export const apiClientModule: ExtensionModule = {
  id: "apiClient",
  activate(_context) {
    apiClient.init();
    log("API client initialized");
  },
};
