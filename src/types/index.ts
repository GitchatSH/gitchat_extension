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
  trendingPollInterval: number;
  feedPollInterval: number;
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

export interface Notification {
  id: string;
  type: "follow" | "star" | "mention" | "message" | "like" | "comment";
  actor: string;
  actor_avatar: string;
  message: string;
  read: boolean;
  created_at: string;
  target_url: string;
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

export interface UnreadCounts {
  messages: number;
  notifications: number;
}
