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
    const panel = vscode.window.createWebviewPanel("trending.channel", title, vscode.ViewColumn.One, {
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

  private async fetchFeed(source: string, cursor?: string): Promise<void> {
    try {
      let payload: Record<string, unknown> = { source };
      switch (source) {
        case "x": {
          const r = await apiClient.getChannelFeedX(this._channelId, cursor);
          this._cursors[source] = r.nextCursor ?? undefined;
          payload = { source, items: r.posts, nextCursor: r.nextCursor };
          break;
        }
        case "youtube": {
          const r = await apiClient.getChannelFeedYouTube(this._channelId, cursor);
          this._cursors[source] = r.nextCursor ?? undefined;
          payload = { source, items: r.posts, nextCursor: r.nextCursor };
          break;
        }
        case "gitstar": {
          const r = await apiClient.getChannelFeedGitstar(this._channelId, cursor);
          this._cursors[source] = r.nextCursor ?? undefined;
          payload = { source, items: r.posts, nextCursor: r.nextCursor };
          break;
        }
        case "github": {
          const r = await apiClient.getChannelFeedGitHub(this._channelId, cursor);
          this._cursors[source] = r.nextCursor ?? undefined;
          payload = { source, items: r.events, nextCursor: r.nextCursor };
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
        const { source, cursor } = msg.payload as { source: string; cursor?: string };
        await this.fetchFeed(source, cursor);
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
    const channelCss = getUri(webview, this._extensionUri, ["media", "webview", "channel.css"]);
    const sharedJs = getUri(webview, this._extensionUri, ["media", "webview", "shared.js"]);
    const channelJs = getUri(webview, this._extensionUri, ["media", "webview", "channel.js"]);
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} https: blob: data:;">
      <link href="${sharedCss}" rel="stylesheet"><link href="${codiconCss}" rel="stylesheet"><link href="${channelCss}" rel="stylesheet">
      <title>Channel</title></head>
      <body>
        <div class="channel-container">
          <div class="channel-header" id="channel-header">
            <span class="codicon codicon-megaphone channel-header-icon"></span>
            <span class="channel-header-name" id="channel-name">Loading...</span>
            <button class="channel-subscribe-btn" id="subscribe-btn" data-subscribed="false">Subscribe</button>
          </div>
          <div class="channel-tabs" id="channel-tabs">
            <button class="channel-tab channel-tab-active" data-source="x">X</button>
            <button class="channel-tab" data-source="youtube">YouTube</button>
            <button class="channel-tab" data-source="gitstar">Gitstar</button>
            <button class="channel-tab" data-source="github">GitHub</button>
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
        <script nonce="${nonce}" src="${sharedJs}"></script>
        <script nonce="${nonce}" src="${channelJs}"></script>
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
