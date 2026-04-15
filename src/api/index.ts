import axios, { AxiosInstance } from "axios";
import type {
  Conversation,
  ConversationParticipant,
  ExtensionModule,
  Message,
  Notification,
  ReadReceipt,
  UserProfile,
} from "../types";
import type { RepoChannel, ChannelSocialPost, ChannelGitchatPost } from "../types";
import type {
  StarredRepo,
  ContributedRepo,
  FriendUser,
  RichProfile,
  WaveResponse,
  WaveRespondResponse,
} from "../types";
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
      // so we must use the GitHub access token, not the Gitchat JWT.
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
    // 20s timeout — BE proxies through GitHub's PUT /user/following/:username
    // which can be slow on stale tokens. 10s was hitting ECONNABORTED before
    // BE could finish the upstream call.
    const res = await this._http.put(`/follow/${username}`, {}, { timeout: 20000 });
    log(`[API] follow response: ${res.status}`);
  }

  async unfollowUser(username: string): Promise<void> {
    log(`[API] DELETE /follow/${username}`);
    await this._http.delete(`/follow/${username}`, { timeout: 20000 });
  }

  // ── WP8 Wave ──────────────────────────────────────────────
  // Wave = low-friction ping for non-mutual online strangers in Discover →
  // Online Now. Sending creates only a notification (no message, no DM).
  // Recipient responds by tapping the wave notification → /waves/:id/respond
  // atomically creates the DM. See docs/sync/be-requirements-wave.md.

  async wave(targetLogin: string): Promise<WaveResponse> {
    log(`[API] POST /waves target=${targetLogin}`);
    const { data } = await this._http.post("/waves", { target_login: targetLogin }, { timeout: 10000 });
    const d = data?.data ?? data;
    return { success: !!(d?.success ?? true), wave_id: d?.wave_id ?? d?.id ?? "" };
  }

  async waveRespond(waveId: string): Promise<WaveRespondResponse> {
    log(`[API] POST /waves/${waveId}/respond`);
    const { data } = await this._http.post(`/waves/${waveId}/respond`, {}, { timeout: 10000 });
    const d = data?.data ?? data;
    return { conversation_id: d?.conversation_id ?? d?.id ?? "" };
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

  async getMessages(conversationId: string, pages = 1, startCursor?: string, direction: 'before' | 'after' = 'before'): Promise<{ messages: Message[]; hasMore: boolean; cursor?: string; otherReadAt?: string; readReceipts?: ReadReceipt[] }> {
    let allMessages: Message[] = [];
    let cursor: string | undefined = startCursor;
    let hasMore = false;
    let otherReadAt: string | undefined;
    let readReceipts: ReadReceipt[] | undefined;

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
      if (!readReceipts) {
        const receipts = response?.readReceipts || response?.read_receipts;
        if (Array.isArray(receipts)) { readReceipts = receipts; }
      }
      hasMore = data.length >= 50;
      if (!hasMore) { break; }
    }

    return { messages: allMessages.reverse(), hasMore, cursor, otherReadAt, readReceipts };
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

  async joinConversation(
    type: "dm" | "group" | "community" | "team",
    params: {
      targetLogin?: string;
      repoFullName?: string;
      groupName?: string;
      members?: string[];
    }
  ): Promise<Conversation> {
    const body: Record<string, unknown> = { type };
    if (params.targetLogin) { body.recipient_login = params.targetLogin; }
    if (params.repoFullName) { body.repo_full_name = params.repoFullName; }
    if (params.groupName) { body.group_name = params.groupName; }
    if (params.members?.length) { body.recipient_logins = params.members; }
    try {
      const { data } = await this._http.post("/messages/conversations", body);
      this._conversationsCache.invalidate();
      return data?.data ?? data;
    } catch (err) {
      const errMsg = (err as { response?: { data?: { error?: { message?: string } } } })
        ?.response?.data?.error?.message;
      if (errMsg) { throw new Error(errMsg); }
      throw err;
    }
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
    const body: Record<string, string> = {};
    if (groupName !== undefined) { body.group_name = groupName; }
    if (groupAvatarUrl !== undefined) { body.group_avatar_url = groupAvatarUrl; }
    await this._http.patch(`/messages/conversations/${conversationId}/group`, body);
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

  /**
   * Look up an existing community or team conversation for a given repo.
   * Returns the conversation and whether the current user is already a member, or null if not found.
   */
  async lookupRepoRoom(repoFullName: string): Promise<{ conversation: Conversation | null; is_member: boolean }> {
    const { data } = await this._http.get("/messages/conversations/repo-room", {
      params: { repo: repoFullName },
    });
    const d = data?.data ?? data;
    return { conversation: d?.conversation ?? null, is_member: d?.is_member ?? false };
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

  async getNotifications(
    cursor?: string,
    limit = 20,
  ): Promise<{ data: Notification[]; nextCursor: string | null; unreadCount: number }> {
    const params: Record<string, string | number> = { limit };
    if (cursor) { params.cursor = cursor; }
    const { data } = await this._http.get("/notifications", { params });
    // BE TransformInterceptor returns the service response as-is when it
    // already has a `data` field, so axios `data` is the flat
    // {data, nextCursor, unreadCount} shape — no nesting.
    return {
      data: Array.isArray(data?.data) ? data.data : [],
      nextCursor: data?.nextCursor ?? null,
      unreadCount: data?.unreadCount ?? 0,
    };
  }

  async markNotificationsRead(ids?: string[]): Promise<void> {
    await this._http.patch("/notifications/read", { ids: ids ?? [] });
  }

  async getUnreadNotificationCount(): Promise<number> {
    const { data } = await this._http.get("/notifications/unread-count");
    const inner = data?.data ?? data;
    return inner?.count ?? inner?.unread_count ?? 0;
  }

  async getNotificationSettings(): Promise<{
    filters: Record<string, unknown> | null;
    emailPrefs: Record<string, unknown> | null;
    inappPrefs: Record<string, unknown> | null;
    email: string | null;
  }> {
    const { data } = await this._http.get("/notifications/settings");
    const inner = data?.data ?? data;
    return {
      filters: inner?.filters ?? null,
      emailPrefs: inner?.emailPrefs ?? null,
      inappPrefs: inner?.inappPrefs ?? null,
      email: inner?.email ?? null,
    };
  }

  async updateNotificationSettings(payload: {
    filters?: Record<string, unknown>;
    emailPrefs?: Record<string, unknown>;
    inappPrefs?: Record<string, unknown>;
  }): Promise<void> {
    await this._http.put("/notifications/settings", payload);
  }

  async getMyProfile(): Promise<UserProfile> {
    const { data } = await this._http.get("/user/profile");
    return data.data ?? data;
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

  async getChannelFeedGitchat(channelId: string, cursor?: string, limit?: number): Promise<{ posts: ChannelGitchatPost[]; nextCursor: string | null }> {
    const params: Record<string, string | number> = {};
    if (cursor) { params.cursor = cursor; }
    if (limit) { params.limit = limit; }
    const { data } = await this._http.get(`/channels/${channelId}/feed/gitchat`, { params });
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

  // ── WP11: GitHub Data & Caching ─────────────────────────────────

  private _githubDataParams(force?: boolean): Record<string, string> {
    return force ? { force: "true" } : {};
  }

  async getMyStarredRepos(force?: boolean): Promise<{ repos: StarredRepo[]; fetchedAt: string; stale: boolean }> {
    const { data } = await this._http.get("/github/data/starred", { params: this._githubDataParams(force) });
    const d = data.data ?? data;
    return { repos: d.repos ?? [], fetchedAt: d.fetchedAt, stale: !!d.stale };
  }

  async getMyContributedRepos(force?: boolean): Promise<{ repos: ContributedRepo[]; fetchedAt: string; stale: boolean }> {
    const { data } = await this._http.get("/github/data/contributed", { params: this._githubDataParams(force) });
    const d = data.data ?? data;
    return { repos: d.repos ?? [], fetchedAt: d.fetchedAt, stale: !!d.stale };
  }

  async getMyFriends(force?: boolean): Promise<{ mutual: FriendUser[]; notOnGitchat: FriendUser[]; fetchedAt: string; stale: boolean }> {
    const { data } = await this._http.get("/github/data/friends", { params: this._githubDataParams(force) });
    const d = data.data ?? data;
    return {
      mutual: d.mutual ?? [],
      notOnGitchat: d.notOnGitchat ?? [],
      fetchedAt: d.fetchedAt,
      stale: !!d.stale,
    };
  }

  async getMyRichProfile(force?: boolean): Promise<{ profile: RichProfile; fetchedAt: string; stale: boolean }> {
    const { data } = await this._http.get("/github/data/profile/me", { params: this._githubDataParams(force) });
    const d = data.data ?? data;
    return { profile: d.profile, fetchedAt: d.fetchedAt, stale: !!d.stale };
  }

  async refreshAllGithubData(): Promise<{ started: string[] }> {
    const { data } = await this._http.post("/github/data/refresh-all");
    const d = data.data ?? data;
    return { started: d.started ?? [] };
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
