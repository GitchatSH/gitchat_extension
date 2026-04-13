import * as vscode from "vscode";
import type { ExtensionModule, RepoChannel, WebviewMessage } from "../types";
import { apiClient } from "../api";
import { getNonce, getUri, log } from "../utils";

class ChannelPanel {
  private static instances = new Map<string, ChannelPanel>();
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];
  private _channelId: string;
  private _channel: RepoChannel | undefined;
  private _cursors: Record<string, string | undefined> = {};
  private _discCategoryId: string | undefined;
  private _lastDiscussionItems: any[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any

  private constructor(panel: vscode.WebviewPanel, private readonly _extensionUri: vscode.Uri, channelId: string) {
    this._panel = panel;
    this._channelId = channelId;
    this._panel.webview.html = this.getHtml(this._panel.webview);
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._panel.webview.onDidReceiveMessage((msg: WebviewMessage) => this.onMessage(msg), null, this._disposables);
  }

  static async show(extensionUri: vscode.Uri, channelId: string, channel?: RepoChannel): Promise<void> {
    const existing = ChannelPanel.instances.get(channelId);
    if (existing) { existing._panel.reveal(); return; }
    const title = channel ? `${channel.repoOwner}/${channel.repoName}` : "Channel";
    const panel = vscode.window.createWebviewPanel("gitchat.channel", title, vscode.ViewColumn.One, {
      enableScripts: true, retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, "media")],
    });
    const instance = new ChannelPanel(panel, extensionUri, channelId);
    if (channel) { instance._channel = channel; }
    ChannelPanel.instances.set(channelId, instance);
    await instance.loadInitialData();
  }

  private async loadInitialData(): Promise<void> {
    try {
      const ch = this._channel ?? await apiClient.getChannel(this._channelId);
      this._channel = ch;
      this._panel.title = `${ch.repoOwner}/${ch.repoName}`;
      this._panel.webview.postMessage({ type: "channelInfo", payload: ch });
      await this.fetchFeed("x");
    } catch (err) { log(`Failed to load channel: ${err}`, "error"); }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mapSocial(r: any) {
    return {
      id: r.sp_id ?? r.id,
      platform: r.sp_platform ?? r.platform,
      authorHandle: r.sp_author_handle ?? r.authorHandle,
      authorName: r.sp_author_name ?? r.authorName,
      authorAvatar: r.sp_author_avatar ?? r.authorAvatar,
      body: r.sp_body ?? r.body,
      mediaUrls: r.sp_media_urls ?? r.mediaUrls ?? [],
      engagement: r.sp_engagement ?? r.engagement ?? {},
      platformData: r.sp_platform_data ?? r.platformData ?? {},
      platformCreatedAt: r.sp_platform_created_at ?? r.platformCreatedAt,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mapGitchat(r: any) {
    return {
      id: r.gp_id ?? r.id,
      authorLogin: r.gp_author_login ?? r.author_login ?? r.authorLogin,
      authorName: r.gp_author_name ?? r.author_name ?? r.authorName,
      authorAvatar: r.gp_author_avatar ?? r.author_avatar ?? r.authorAvatar,
      body: r.gp_body ?? r.body,
      imageUrls: r.gp_image_urls ?? r.image_urls ?? r.imageUrls ?? [],
      repoTags: r.gp_repo_tags ?? r.repo_tags ?? r.repoTags ?? [],
      createdAt: r.gp_created_at ?? r.created_at ?? r.createdAt,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mapGitHub(r: any) {
    return {
      id: r.fe_id ?? r.id,
      type: r.fe_type ?? r.type,
      actorLogin: r.fe_actor_login ?? r.actor_login ?? r.actorLogin,
      actorAvatar: r.fe_actor_avatar ?? r.actor_avatar ?? r.actorAvatar,
      repoOwner: r.fe_repo_owner ?? r.repo_owner ?? r.repoOwner,
      repoName: r.fe_repo_name ?? r.repo_name ?? r.repoName,
      releaseTag: r.fe_release_tag ?? r.release_tag ?? r.releaseTag,
      prTitle: r.fe_pr_title ?? r.pr_title ?? r.prTitle,
      issueTitle: r.fe_issue_title ?? r.issue_title ?? r.issueTitle,
      narrationBody: r.fe_narration_body ?? r.narration_body ?? r.narrationBody,
      eventCreatedAt: r.fe_event_created_at ?? r.event_created_at ?? r.eventCreatedAt,
    };
  }

  private async fetchFeed(source: string, cursor?: string): Promise<void> {
    try {
      let payload: Record<string, unknown> = { source };
      switch (source) {
        case "x": {
          const r = await apiClient.getChannelFeedX(this._channelId, cursor);
          this._cursors[source] = r.nextCursor ?? undefined;
          payload = { source, items: (r.posts || []).map(p => this.mapSocial(p)), nextCursor: r.nextCursor };
          break;
        }
        case "youtube": {
          const r = await apiClient.getChannelFeedYouTube(this._channelId, cursor);
          this._cursors[source] = r.nextCursor ?? undefined;
          payload = { source, items: (r.posts || []).map(p => this.mapSocial(p)), nextCursor: r.nextCursor };
          break;
        }
        case "gitchat": {
          const r = await apiClient.getChannelFeedGitchat(this._channelId, cursor);
          this._cursors[source] = r.nextCursor ?? undefined;
          payload = { source, items: (r.posts || []).map(p => this.mapGitchat(p)), nextCursor: r.nextCursor };
          break;
        }
        case "discussion": {
          const ch = this._channel;
          if (!ch?.repoOwner || !ch?.repoName) {
            payload = { source, items: [], nextCursor: null, emptyMessage: "Channel not loaded yet" };
            break;
          }
          let r;
          try {
            const discParams: Record<string, string | number> = { first: 20 };
            if (cursor) { discParams.after = cursor; }
            if (this._discCategoryId) { discParams.categoryId = this._discCategoryId; }
            const { data: discResp } = await apiClient.http.get(`/discussions/${ch.repoOwner}/${ch.repoName}`, { params: discParams });
            r = discResp.data ?? discResp;
          } catch {
            payload = { source, items: [], nextCursor: null, emptyMessage: "This repo doesn't have GitHub Discussions enabled" };
            break;
          }
          const discussions = r.discussions ?? r.nodes ?? [];
          const pageInfo = r.pageInfo ?? {};
          this._cursors[source] = pageInfo.endCursor ?? undefined;
          payload = {
            source,
            items: discussions.map((d: any) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
              id: d.id,
              number: d.number,
              title: d.title,
              body: d.body,
              authorLogin: d.author?.login,
              authorAvatar: d.author?.avatarUrl,
              category: d.category?.name,
              categoryId: d.category?.id,
              categoryEmoji: d.category?.emoji,
              commentCount: d.comments?.totalCount ?? 0,
              reactionCount: d.reactions?.totalCount ?? 0,
              upvoteCount: d.upvoteCount ?? 0,
              isAnswered: d.isAnswered,
              createdAt: d.createdAt,
              url: d.url,
            })),
            nextCursor: pageInfo.hasNextPage ? pageInfo.endCursor : null,
          };
          // Store for category extraction
          this._lastDiscussionItems = (this._lastDiscussionItems ?? []).concat(payload.items as any[]); // eslint-disable-line @typescript-eslint/no-explicit-any
          break;
        }
      }
      this._panel.webview.postMessage({ type: "feedData", payload });
    } catch (err) {
      log(`Failed to fetch feed (${source}): ${err}`, "error");
      this._panel.webview.postMessage({ type: "feedData", payload: { source, items: [], nextCursor: null, error: true } });
    }
  }

  private async onMessage(msg: WebviewMessage): Promise<void> {
    switch (msg.type) {
      case "fetchFeed": {
        const { source, cursor, categoryId } = msg.payload as { source: string; cursor?: string; categoryId?: string };
        if (source === "discussion" && categoryId !== undefined) {
          this._discCategoryId = categoryId || undefined;
        }
        await this.fetchFeed(source, cursor);
        break;
      }
      case "fetchDiscussionCategories": {
        // Extract unique categories from already-loaded discussion data
        const discItems = this._lastDiscussionItems ?? [];
        const catMap = new Map<string, { id: string; name: string; emoji: string }>();
        for (const d of discItems) {
          if (d.categoryId && d.category) {
            catMap.set(d.categoryId, { id: d.categoryId, name: d.category, emoji: d.categoryEmoji ?? "" });
          }
        }
        this._panel.webview.postMessage({ type: "discussionCategories", categories: Array.from(catMap.values()) });
        break;
      }
      case "subscribe": {
        try {
          await apiClient.subscribeChannel(this._channelId);
          this._panel.webview.postMessage({ type: "subscribeResult", subscribed: true });
        } catch { vscode.window.showErrorMessage("Failed to subscribe to channel"); }
        break;
      }
      case "unsubscribe": {
        try {
          await apiClient.unsubscribeChannel(this._channelId);
          this._panel.webview.postMessage({ type: "subscribeResult", subscribed: false });
        } catch { vscode.window.showErrorMessage("Failed to unsubscribe from channel"); }
        break;
      }
      case "adminPost": {
        const { body, repoTags } = msg.payload as { body: string; repoTags?: string[] };
        if (!body?.trim()) { break; }
        try {
          const post = await apiClient.createPost({ body, repoTags: repoTags ?? [this._channel ? `${this._channel.repoOwner}/${this._channel.repoName}` : ""] });
          this._panel.webview.postMessage({ type: "postCreated", payload: post });
        } catch { vscode.window.showErrorMessage("Failed to create post"); }
        break;
      }
      case "fetchYouTubeComments": {
        const { videoId } = msg.payload as { videoId: string };
        try {
          const { data } = await apiClient.http.get(`/social/youtube/thread/${videoId}`);
          const d = data.data ?? data;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const comments = (d.replies ?? d.comments ?? []).map((c: any) => this.mapSocial(c));
          this._panel.webview.postMessage({ type: "youtubeComments", videoId, comments });
        } catch {
          this._panel.webview.postMessage({ type: "youtubeComments", videoId, comments: [] });
        }
        break;
      }
      case "openExternal": {
        const url = (msg.payload as { url: string }).url;
        if (url) { vscode.env.openExternal(vscode.Uri.parse(url)); }
        break;
      }
      case "ready":
        break;
    }
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const sharedCss = getUri(webview, this._extensionUri, ["media", "webview", "shared.css"]);
    const codiconCss = getUri(webview, this._extensionUri, ["media", "webview", "codicon.css"]);
    const bust = Date.now();
    const channelCss = getUri(webview, this._extensionUri, ["media", "webview", "channel3.css"]);
    const sharedJs = getUri(webview, this._extensionUri, ["media", "webview", "shared.js"]);
    const channelJs = getUri(webview, this._extensionUri, ["media", "webview", "channel3.js"]);
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} https: blob: data:; frame-src 'none';">
      <link href="${sharedCss}?v=${bust}" rel="stylesheet"><link href="${codiconCss}" rel="stylesheet"><link href="${channelCss}?v=${bust}" rel="stylesheet">
      <title>Channel</title></head>
      <body>
        <div class="channel-container">
          <div class="channel-header" id="channel-header">
            <span class="codicon codicon-megaphone channel-header-icon"></span>
            <span class="channel-header-name" id="channel-name">Loading...</span>
            <button class="channel-subscribe-btn" id="subscribe-btn" data-subscribed="false">Subscribe</button>
          </div>
          <div class="channel-filter-bar" id="channel-tabs">
            <button class="channel-filter-btn channel-filter-active" data-source="x">X</button>
            <button class="channel-filter-btn" data-source="youtube">YouTube</button>
            <button class="channel-filter-btn" data-source="gitchat">Gitchat</button>
            <button class="channel-filter-btn" data-source="discussion">Discussion</button>
          </div>
          <div class="channel-disc-filters" id="disc-filters" style="display:none">
            <select class="channel-disc-category-select" id="disc-category-select">
              <option value="">All categories</option>
            </select>
          </div>
          <div class="channel-feed" id="channel-feed">
            <div class="channel-loading" id="channel-loading">
              <span class="codicon codicon-loading channel-spinner"></span>
              <span>Loading feed...</span>
            </div>
            <div class="channel-empty" id="channel-empty" style="display:none">
              <span class="codicon codicon-inbox"></span>
              <span>No posts yet</span>
            </div>
            <div id="feed-items"></div>
            <div class="channel-load-more" id="load-more-wrap" style="display:none">
              <button class="channel-load-more-btn" id="load-more-btn">Load more</button>
            </div>
          </div>
          <div class="channel-admin-post" id="admin-post" style="display:none">
            <textarea id="admin-post-input" placeholder="Write a post..." rows="2"></textarea>
            <button class="channel-post-btn" id="admin-post-submit">Post</button>
          </div>
        </div>
        <script nonce="${nonce}" src="${sharedJs}?v=${bust}"></script>
        <script nonce="${nonce}" src="${channelJs}?v=${bust}"></script>
      </body></html>`;
  }

  private dispose(): void {
    ChannelPanel.instances.delete(this._channelId);
    this._panel.dispose();
    for (const d of this._disposables) { d.dispose(); }
  }
}

export const channelModule: ExtensionModule = {
  id: "channel",
  activate(_context) { log("Channel module activated"); },
};

export { ChannelPanel };
