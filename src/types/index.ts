import * as vscode from "vscode";

export interface ExtensionModule {
  readonly id: string;
  activate(context: vscode.ExtensionContext): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}

export interface TreeNode {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly tooltip?: string;
  readonly iconPath?: vscode.ThemeIcon | vscode.Uri | { light: vscode.Uri; dark: vscode.Uri };
  readonly collapsibleState?: vscode.TreeItemCollapsibleState;
  readonly contextValue?: string;
  readonly command?: vscode.Command;
  readonly children?: TreeNode[];
}

export interface WebviewMessage {
  readonly type: string;
  readonly payload?: unknown;
}

export interface ExtensionConfig {
  apiUrl: string;
  wsUrl: string;
  githubClientId: string;
  presenceHeartbeat: number;
  showMessageNotifications: boolean;
  messageSound: boolean;
  debugLogs: boolean;
}

export interface CommandDefinition {
  readonly id: string;
  readonly handler: (...args: unknown[]) => unknown;
}

export interface TrendingRepo {
  owner: string;
  name: string;
  description: string;
  stars: number;
  language: string;
  avatar_url: string;
  forks: number;
  score: number;
  topics: string[];
}

export interface UserRepo {
  owner: string;
  name: string;
  description: string;
  stars: number;
  language: string;
  private: boolean;
  forks: number;
  avatar_url: string;
}

export interface TrendingPerson {
  login: string;
  avatar_url: string;
  name: string;
  bio: string;
  star_power: number;
  followers: number;
}

export interface FeedEvent {
  id: string;
  type: "commit" | "pr" | "issue" | "release" | "star" | "fork";
  repo_slug: string;
  title: string;
  narration: string;
  author: string;
  author_avatar: string;
  created_at: string;
  url: string;
  liked: boolean;
  like_count: number;
}

export interface Conversation {
  id: string;
  type?: "direct" | "group";
  is_group?: boolean;
  group_name?: string;
  group_avatar_url?: string;
  participants: ConversationParticipant[];
  last_message: Message | null;
  last_message_preview?: string;
  last_message_at?: string;
  unread_count: number;
  pinned: boolean;
  pinned_at?: string;
  is_request: boolean;
  updated_at: string;
  // Telegram scroll system (optional — BE may not provide yet)
  is_muted?: boolean;
  last_read_message_id?: string;
  unread_mentions_count?: number;
  unread_reactions_count?: number;
}

export interface ConversationParticipant {
  login: string;
  avatar_url: string;
  name: string;
  online: boolean;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender: string;
  sender_avatar: string;
  content: string;
  created_at: string;
  edited_at: string | null;
  reactions: MessageReaction[];
  attachment_url: string | null;
}

export interface MessageReaction {
  emoji: string;
  count: number;
  reacted: boolean;
}

export type NotificationType =
  | "new_message"
  | "mention"
  | "follow"
  | "repo_activity"
  | "wave";

export interface Notification {
  id: string;
  type: NotificationType | string;
  recipient_login: string;
  actor_login: string;
  actor_avatar_url?: string | null;
  actor_name?: string | null;
  metadata?: {
    conversationId?: string;
    messageId?: string;
    preview?: string;
    repoFullName?: string;
    eventType?: "release" | "pr_merged" | "commit_main" | "issue_opened";
    url?: string;
    title?: string;
    commitCount?: number;
    waveId?: string;
    followers?: string[];
    likers?: string[];
    stargazers?: string[];
    count?: number;
  } | null;
  is_read: boolean;
  created_at: string;
}

export interface UserProfile {
  login: string;
  name: string;
  avatar_url: string;
  bio: string;
  company: string;
  location: string;
  blog: string;
  followers: number;
  following: number;
  public_repos: number;
  star_power: number;
  top_repos: RepoSummary[];
  created_at?: string; // GitHub account creation date, optional from BE
}

export interface RepoSummary {
  owner: string;
  name: string;
  description: string;
  stars: number;
  language: string;
}

export interface RepoDetail {
  owner: string;
  name: string;
  description: string;
  stars: number;
  forks: number;
  watchers: number;
  language: string;
  topics: string[];
  avatar_url: string;
  homepage: string;
  star_power: number;
  contributors: ContributorSummary[];
  readme_html: string;
}

export interface ContributorSummary {
  login: string;
  avatar_url: string;
  contributions: number;
  star_share: number;
}

export interface SearchResult {
  repos: TrendingRepo[];
  users: TrendingPerson[];
}

export interface FollowStatus {
  following: boolean;
  followed_by: boolean;
}

export interface ProfileCardData {
  // Identity (real via getUserProfile)
  login: string;
  name: string;
  avatar_url: string;
  pronouns?: string;
  bio?: string;
  created_at?: string; // GitHub account creation date (ISO 8601), optional

  // Stats (real)
  public_repos: number;
  followers: number;
  following: number;

  // Relationship (real, computed)
  follow_status: FollowStatus;

  // Presence
  on_gitchat: boolean;           // mock until BE ships
  online?: boolean;

  // Self-check — source of truth from host (matches authManager.login)
  is_self: boolean;

  // Mutual (real, computed via GitHub API intersections)
  mutual_friends?: { login: string; avatar_url: string }[];
  mutual_groups?: { id: string; name: string; type: "community" | "team" }[];

  // Top repos — up to 3, shown in all states when available
  top_repos?: { owner: string; name: string; stars: number; language?: string; description?: string }[];
}

export interface UnreadCounts {
  messages: number;
  notifications: number;
}

// ── Repo Channels ─────────────────────────────────────────

export interface RepoChannel {
  id: string;
  repoOwner: string;
  repoName: string;
  displayName: string | null;
  description: string | null;
  avatarUrl: string | null;
  subscriberCount: number;
  role: string;
}

export interface ChannelMember {
  id: string;
  userLogin: string;
  role: string;
  joinedAt: string;
  source: string | null;
}

export interface ChannelSocialPost {
  id: string;
  platform: string;
  platformPostId: string;
  authorHandle: string | null;
  authorName: string | null;
  authorAvatar: string | null;
  body: string | null;
  mediaUrls: string[];
  engagement: Record<string, unknown>;
  platformCreatedAt: string;
}

export interface ChannelGitchatPost {
  id: string;
  authorLogin: string;
  authorName: string | null;
  authorAvatar: string | null;
  body: string;
  imageUrls: string[];
  repoTags: string[];
  createdAt: string;
}

export interface ChannelGitHubEvent {
  id: string;
  type: string;
  actorLogin: string;
  actorAvatar: string | null;
  repoOwner: string;
  repoName: string;
  releaseTag: string | null;
  prTitle: string | null;
  issueTitle: string | null;
  narrationBody: string | null;
  eventCreatedAt: string;
}
