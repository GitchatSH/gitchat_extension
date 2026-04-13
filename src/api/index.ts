import axios, { AxiosInstance } from "axios";
import type {
  Conversation,
  ConversationParticipant,
  ExtensionModule,
  Message,
  Notification,
  UserProfile,
} from "../types";
import type { RepoChannel, ChannelSocialPost, ChannelGitstarPost } from "../types";
import { configManager } from "../config";
import { authManager } from "../auth";
import { log } from "../utils";

// Simple TTL cache for hot API endpoints
class TtlCache<T> {
  private _data: T | undefined;
  private _expiry = 0;
  constructor(private _ttlMs: number) {}
  get(): T | undefined { return Date.now() < this._expiry ? this._data : undefined; }
  set(data: T): void { this._data = data; this._expiry = Date.now() + this._ttlMs; }
  invalidate(): void { this._expiry = 0; }
}

class ApiClient {
  private _http!: AxiosInstance;
  get http(): AxiosInstance { return this._http; }
  private _followingCache = new TtlCache<unknown[]>(60_000);      // 60s
  private _conversationsCache = new TtlCache<unknown[]>(10_000);   // 10s
  private _presenceCache = new TtlCache<Record<string, string | null>>(30_000); // 30s

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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getFollowing(page = 1, perPage = 50): Promise<any[]> {
    if (page === 1) { const cached = this._followingCache.get(); if (cached) { return cached; } }
    const { data } = await this._http.get("/following", { params: { page, per_page: perPage } });
    const result = this.extractArray(data, "users", "following");
    if (page === 1) { this._followingCache.set(result); }
    return result;
  }

  async syncGitHubFollows(): Promise<{ imported_following: number; imported_followers: number; mutual: number }> {
    const { data } = await this._http.post("/following/sync");
    return data?.data || data;
  }

  async getPresence(logins: string[]): Promise<Record<string, string | null>> {
    if (logins.length === 0) { return {}; }
    const cached = this._presenceCache.get();
    if (cached) { return cached; }
    const { data } = await this._http.get("/presence", { params: { logins: logins.join(",") } });
    const result = data.presence ?? data.data?.presence ?? {};
    this._presenceCache.set(result);
    return result;
  }

  async sendHeartbeat(): Promise<void> {
    await this._http.patch("/presence");
  }

  async followUser(username: string): Promise<void> {
    log(`[API] PUT /follow/${username}`);
    const res = await this._http.put(`/follow/${username}`, {}, { timeout: 10000 });
    log(`[API] follow response: ${res.status}`);
  }

  async unfollowUser(username: string): Promise<void> {
    log(`[API] DELETE /follow/${username}`);
    await this._http.delete(`/follow/${username}`, { timeout: 10000 });
  }

  async getConversations(): Promise<Conversation[]> {
    const cached = this._conversationsCache.get() as Conversation[] | undefined;
    if (cached) { return cached; }
    const { data } = await this._http.get("/messages/conversations");
    const result = this.extractArray(data, "conversations") as Conversation[];
    this._conversationsCache.set(result);
    return result;
  }

  invalidateConversationsCache(): void { this._conversationsCache.invalidate(); }

  async getMessages(conversationId: string, pages = 1, startCursor?: string, direction: 'before' | 'after' = 'before'): Promise<{ messages: Message[]; hasMore: boolean; cursor?: string; otherReadAt?: string }> {
    let allMessages: Message[] = [];
    let cursor: string | undefined = startCursor;
    let hasMore = false;
    let otherReadAt: string | undefined;

    for (let p = 0; p < pages; p++) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const params: any = { limit: 50 };
      if (cursor) { params.cursor = cursor; }
      if (direction !== 'before') { params.direction = direction; }
      const res = await this._http.get(`/messages/conversations/${conversationId}`, { params });
      const response = res.data?.data ?? res.data;
      const data = this.extractArray(response, "messages");
      allMessages = [...allMessages, ...data];
      cursor = response?.cursor || response?.next_cursor || response?.nextCursor;
      if (!otherReadAt) { otherReadAt = response?.otherReadAt || response?.other_read_at; }
      hasMore = data.length >= 50;
      if (!hasMore) { break; }
    }

    return { messages: allMessages.reverse(), hasMore, cursor, otherReadAt };
  }

  async getMessageContext(conversationId: string, messageId: string): Promise<{
    messages: Message[];
    hasMore: boolean;
    hasMoreBefore: boolean;
    hasMoreAfter: boolean;
    previousCursor?: string;
    nextCursor?: string;
  }> {
    const { data } = await this._http.get(`/messages/conversations/${conversationId}/messages/${messageId}/context`);
    const inner = data?.data ?? data;
    const messages: Message[] = this.extractArray(inner, "messages");
    return {
      messages,
      hasMore: !!(inner?.hasMoreBefore ?? inner?.has_more_before ?? inner?.hasMore),
      hasMoreBefore: !!(inner?.hasMoreBefore ?? inner?.has_more_before ?? inner?.hasMore),
      hasMoreAfter: !!(inner?.hasMoreAfter ?? inner?.has_more_after),
      previousCursor: inner?.previousCursor ?? inner?.previous_cursor,
      nextCursor: inner?.nextCursor ?? inner?.next_cursor,
    };
  }

  async sendMessage(conversationId: string, content: string, attachments?: { type: string; url: string; storage_path: string; filename?: string; mime_type?: string; size_bytes?: number }[]): Promise<Message> {
    const payload: Record<string, unknown> = { body: content };
    if (attachments?.length) { payload.attachments = attachments; }
    const { data } = await this._http.post(`/messages/conversations/${conversationId}`, payload, { timeout: 8000 });
    return data.data ?? data;
  }

  async uploadAttachment(conversationId: string, fileBuffer: Buffer, filename: string, mimeType: string): Promise<{ url: string; storage_path: string; filename: string; mime_type: string; size_bytes: number }> {
    const FormData = (await import("form-data")).default;
    const form = new FormData();
    form.append("file", fileBuffer, { filename, contentType: mimeType });
    form.append("conversation_id", conversationId);
    const { data } = await this._http.post("/messages/upload", form, {
      headers: form.getHeaders(),
      timeout: 60000,
    });
    return data.data ?? data;
  }

  async createConversation(username: string): Promise<Conversation> {
    const { data } = await this._http.post("/messages/conversations", { recipient_login: username });
    return data.data ?? data;
  }

  async convertDmToGroup(conversationId: string, memberLogins: string[], groupName?: string): Promise<void> {
    await this._http.post(`/messages/conversations/${conversationId}/convert-to-group`, {
      member_logins: memberLogins,
      group_name: groupName,
    });
    this._conversationsCache.invalidate();
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

  async deleteGroup(conversationId: string): Promise<void> {
    await this._http.delete(`/messages/conversations/${conversationId}/group`);
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
    const inner = data?.data ?? data;
    return inner?.count ?? inner?.unread_count ?? 0;
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

  async unsendMessage(_conversationId: string, messageId: string): Promise<void> {
    await this._http.post(`/messages/${messageId}/unsend`);
  }

  async replyToMessage(conversationId: string, content: string, replyToId: string, attachments?: { type: string; url: string; storage_path: string; filename?: string; mime_type?: string; size_bytes?: number }[]): Promise<Message> {
    const payload: Record<string, unknown> = { body: content, reply_to_id: replyToId };
    if (attachments?.length) { payload.attachments = attachments; }
    const { data } = await this._http.post(`/messages/conversations/${conversationId}`, payload, { timeout: 8000 });
    return data.data ?? data;
  }

  async pinMessage(conversationId: string, messageId: string): Promise<void> {
    await this._http.post(`/messages/conversations/${conversationId}/messages/${messageId}/pin`);
  }

  async unpinMessage(conversationId: string, messageId: string): Promise<void> {
    await this._http.delete(`/messages/conversations/${conversationId}/messages/${messageId}/pin`);
  }

  async unpinAllMessages(conversationId: string): Promise<{ unpinnedCount: number }> {
    const { data } = await this._http.delete(`/messages/conversations/${conversationId}/pinned-messages`);
    return data;
  }

  async getPinnedMessages(conversationId: string): Promise<Message[]> {
    const { data } = await this._http.get(`/messages/conversations/${conversationId}/pinned-messages`);
    return this.extractArray(data, "messages", "pinned_messages");
  }

  async getUnreadMentions(conversationId: string): Promise<string[]> {
    const { data } = await this._http.get(`/messages/conversations/${conversationId}/unread-mentions`);
    const d = data?.data ?? data;
    return d?.message_ids ?? [];
  }

  async getUnreadReactions(conversationId: string): Promise<string[]> {
    const { data } = await this._http.get(`/messages/conversations/${conversationId}/unread-reactions`);
    const d = data?.data ?? data;
    return d?.message_ids ?? [];
  }

  async searchMessages(
    conversationId: string,
    query: string,
    options?: { cursor?: string; limit?: number; user?: string }
  ): Promise<{ messages: Message[]; nextCursor: string | null }> {
    const params: Record<string, string | number> = { q: query };
    if (options?.cursor) { params.cursor = options.cursor; }
    if (options?.limit) { params.limit = options.limit; }
    if (options?.user) { params.user = options.user; }
    const { data } = await this._http.get(`/messages/conversations/${conversationId}/search`, { params });
    const d = data.data ?? data;
    return { messages: d.messages ?? [], nextCursor: d.nextCursor ?? null };
  }

  async getMessagesAroundDate(conversationId: string, date: string): Promise<{
    messages: Message[];
    hasMoreBefore: boolean;
    hasMoreAfter: boolean;
    previousCursor?: string;
    nextCursor?: string;
  }> {
    const { data } = await this._http.get(
      `/messages/conversations/${conversationId}/messages`,
      { params: { around_date: date } }
    );
    const d = data.data ?? data;
    return {
      messages: d.messages ?? [],
      hasMoreBefore: d.hasMoreBefore ?? d.has_more_before ?? false,
      hasMoreAfter: d.hasMoreAfter ?? d.has_more_after ?? false,
      previousCursor: d.previousCursor ?? d.previous_cursor,
      nextCursor: d.nextCursor ?? d.next_cursor,
    };
  }

  async globalSearchMessages(query: string, cursor?: string, limit?: number): Promise<{ messages: Message[]; nextCursor: string | null }> {
    const params: Record<string, string | number> = { q: query };
    if (cursor) { params.cursor = cursor; }
    if (limit) { params.limit = limit; }
    const { data } = await this._http.get(`/messages/search`, { params });
    const d = data.data ?? data;
    return { messages: d.messages ?? [], nextCursor: d.nextCursor ?? null };
  }

  async reportMessage(messageId: string, reason: string, detail?: string): Promise<void> {
    const body: Record<string, string> = { reason };
    if (detail) { body.detail = detail; }
    await this._http.post(`/messages/${messageId}/report`, body);
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

  async getMyProfile(): Promise<UserProfile> {
    const { data } = await this._http.get("/user/profile");
    return data;
  }

  async getUserProfile(username: string): Promise<UserProfile> {
    const { data } = await this._http.get(`/user/${username}`);
    log(`[getUserProfile] raw response keys: ${JSON.stringify(Object.keys(data))} | data.data keys: ${data.data ? JSON.stringify(Object.keys(data.data)) : "none"} | sample: ${JSON.stringify(data).slice(0, 500)}`);
    return data.data ?? data;
  }

  async searchUsers(query: string): Promise<{ login: string; name: string | null; avatar_url: string | null }[]> {
    if (!query || query.length < 1) { return []; }
    const { data } = await this._http.get("/search/users", { params: { q: query } });
    const items = data?.data ?? data;
    return Array.isArray(items) ? items.slice(0, 10) : [];
  }

  async createInviteLink(conversationId: string): Promise<{ code: string; url: string }> {
    const { data } = await this._http.post(`/messages/conversations/${conversationId}/invite`);
    return data?.data ?? data;
  }

  async getInvitePreview(code: string): Promise<{ group_name: string | null; group_avatar_url: string | null; member_count: number; conversation_id: string }> {
    const { data } = await this._http.get(`/messages/conversations/join/${code}`);
    return data?.data ?? data;
  }

  async joinByInvite(code: string): Promise<Record<string, unknown>> {
    const { data } = await this._http.post(`/messages/conversations/join/${code}`);
    return data?.data ?? data;
  }

  async revokeInviteLink(conversationId: string): Promise<void> {
    await this._http.delete(`/messages/conversations/${conversationId}/invite`);
  }

  // ── Repo Channels ─────────────────────────────────────────

  async getMyChannels(cursor?: string, limit?: number): Promise<{ channels: RepoChannel[]; nextCursor: string | null }> {
    const params: Record<string, string | number> = {};
    if (cursor) { params.cursor = cursor; }
    if (limit) { params.limit = limit; }
    const { data } = await this._http.get("/channels", { params });
    const d = data.data ?? data;
    return { channels: d.channels ?? [], nextCursor: d.nextCursor ?? null };
  }

  async getChannelByRepo(owner: string, name: string): Promise<RepoChannel | null> {
    const { data } = await this._http.get(`/channels/repo/${owner}/${name}`);
    const d = data.data ?? data;
    return d && d.id ? d : null;
  }

  async getChannel(channelId: string): Promise<RepoChannel> {
    const { data } = await this._http.get(`/channels/${channelId}`);
    return data.data ?? data;
  }

  async subscribeChannel(channelId: string): Promise<void> {
    await this._http.post(`/channels/${channelId}/subscribe`);
  }

  async unsubscribeChannel(channelId: string): Promise<void> {
    await this._http.delete(`/channels/${channelId}/subscribe`);
  }

  async getChannelFeedX(channelId: string, cursor?: string, limit?: number): Promise<{ posts: ChannelSocialPost[]; nextCursor: string | null }> {
    const params: Record<string, string | number> = {};
    if (cursor) { params.cursor = cursor; }
    if (limit) { params.limit = limit; }
    const { data } = await this._http.get(`/channels/${channelId}/feed/x`, { params });
    const d = data.data ?? data;
    return { posts: d.posts ?? [], nextCursor: d.nextCursor ?? null };
  }

  async getChannelFeedYouTube(channelId: string, cursor?: string, limit?: number): Promise<{ posts: ChannelSocialPost[]; nextCursor: string | null }> {
    const params: Record<string, string | number> = {};
    if (cursor) { params.cursor = cursor; }
    if (limit) { params.limit = limit; }
    const { data } = await this._http.get(`/channels/${channelId}/feed/youtube`, { params });
    const d = data.data ?? data;
    return { posts: d.posts ?? [], nextCursor: d.nextCursor ?? null };
  }

  async getChannelFeedGitstar(channelId: string, cursor?: string, limit?: number): Promise<{ posts: ChannelGitstarPost[]; nextCursor: string | null }> {
    const params: Record<string, string | number> = {};
    if (cursor) { params.cursor = cursor; }
    if (limit) { params.limit = limit; }
    const { data } = await this._http.get(`/channels/${channelId}/feed/gitstar`, { params });
    const d = data.data ?? data;
    return { posts: d.posts ?? [], nextCursor: d.nextCursor ?? null };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async createPost(params: { body: string; imageUrls?: string[]; repoTags?: string[] }): Promise<any> {
    const { data } = await this._http.post("/posts", {
      body: params.body,
      image_urls: params.imageUrls || [],
      repo_tags: params.repoTags || [],
      visibility: "public",
    });
    return data.data ?? data;
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
