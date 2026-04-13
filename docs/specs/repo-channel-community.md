# Spec: Repo Channel (Community Tab)

**Date:** 2026-04-08  
**Branch:** feat/repo-team-chat  
**Status:** Ready to implement  

---

## Overview

A "Repo Channel" is the public community discussion space for a GitHub repo — surfaced inside the VS Code extension on the repo detail panel. It maps to the existing `gitchat-posts` system in gitchat-internal (posts with `repo_tags`).

When a user **watches** a repo channel, they receive in-extension notifications whenever a new community post is created for that repo.

This is distinct from **Repo Room** (private group chat with top contributors). The two live side by side:

| | Repo Room | Repo Channel |
|--|--|--|
| Type | Private group chat | Public discussion board |
| Access | Top contributors only (create) | Anyone (read + post) |
| Real-time | Yes (WebSocket) | No (poll / notification) |
| Backend | `message_conversations` (group) | `gitchat_posts` (repo_tags) |

---

## User Flow

### Viewing the channel

1. User opens repo detail panel (any repo from Trending)
2. A **"Community"** tab or section appears below the action buttons
3. Shows latest N posts tagged with this repo (`repo_tags` contains `owner/name`)
4. Each post shows: author avatar, content preview, like count, timestamp
5. Click post → opens full post on `dev.gitchat.sh/community/{id}`

### Watching the channel

1. User clicks **"Watch"** button (toggle)
2. Extension saves watch state locally + calls `POST /user/watch-repo` on backend
3. When a new post is created for this repo → user gets a VS Code notification:
   > `@username posted in owner/repo community: "post preview..."`
4. Clicking notification opens repo detail panel scrolled to that post

### Posting to the channel

1. User clicks **"Post to Community"**
2. Input box appears (textarea, max 500 chars)
3. On submit → `POST /community/posts` with `repo_tags: ["owner/name"]`
4. New post appears at top of feed

---

## Backend Changes (gitchat-internal)

### 1. Watch repo endpoint

```
POST /user/watch-repo
Body: { repo_slug: "owner/name" }
Auth: required

DELETE /user/watch-repo
Body: { repo_slug: "owner/name" }
Auth: required

GET /user/watched-repos
Auth: required
Response: { repos: string[] }  // list of slugs
```

**DB:** New table `user_watched_repos`
```sql
CREATE TABLE user_watched_repos (
  id UUID PRIMARY KEY,
  user_login VARCHAR NOT NULL,
  repo_slug VARCHAR NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_login, repo_slug)
);
```

### 2. Notification on new post

When a post is created with `repo_tags` → look up all watchers of those repos → create an in-app notification for each watcher.

Existing notification system in `src/modules/notifications/` can be extended with a new type:

```typescript
type: "repo_post"
actor: post.author
message: `posted in ${repoSlug}`
target_url: `/community/${post.id}`
```

### 3. Get posts by repo (already partially exists)

Check if `GET /community/posts?repo=owner/name` is already supported via `repo_tags` filter. If not, add query param support to `gitchat-posts.controller.ts`.

---

## Extension Changes (top-github-trending)

### Files to modify

**`src/api/index.ts`**
```typescript
// Get community posts for a repo
getPosts(repoSlug: string, cursor?: string): Promise<{ posts: Post[]; nextCursor: string | null }>
  → GET /community/posts?repo={repoSlug}&cursor={cursor}&limit=10

// Watch / unwatch
watchRepo(repoSlug: string): Promise<void>
  → POST /user/watch-repo  { repo_slug }

unwatchRepo(repoSlug: string): Promise<void>  
  → DELETE /user/watch-repo  { repo_slug }

// Create post
createPost(content: string, repoSlug: string): Promise<void>
  → POST /community/posts  { content, repo_tags: [repoSlug] }
```

**`src/webviews/repo-detail.ts`**
- Handle messages: `watchRepo`, `unwatchRepo`, `createPost`, `loadMorePosts`
- On `ready`: also fetch latest posts for this repo → `postMessage({ type: "setPosts", posts })`
- Poll for new posts every 2 min while panel is visible (or rely on notification)

**`media/webview/repo-detail.js`**
- Add community section below contributors card:
  ```
  ┌─────────────────────────────────┐
  │ Community          [Watch] [Post]│
  ├─────────────────────────────────┤
  │ @user · 2h ago                  │
  │ "Just merged the new parser..." │
  │ ♥ 12                            │
  ├─────────────────────────────────┤
  │ @other · 1d ago                 │
  │ "Anyone tried this on Windows?" │
  │ ♥ 3                             │
  └─────────────────────────────────┘
  ```
- Watch button toggles state, persists via `vscode.postMessage`
- Post button opens inline textarea → submit → optimistic prepend to list

**`media/webview/repo-detail.css`**
- `.rd-community-section`, `.rd-post-item`, `.rd-post-author`, `.rd-post-body`, `.rd-post-meta`
- Watch button variant (`.rd-btn-watch`, `.rd-btn-watch-active`)

### Notification flow

In `src/extension.ts` or statusbar polling:
- When new notification of type `repo_post` arrives → `vscode.window.showInformationMessage(...)`
- On click → `RepoDetailPanel.show(extensionUri, owner, repo)` + scroll to post

---

## Out of Scope (for this spec)

- Real-time post streaming (WebSocket) — polling is sufficient for v1
- Comment threading inside extension — link out to web
- Emoji reactions inside extension — link out to web
- Channel moderation / pinned posts

---

## Open Questions

1. Does `GET /community/posts?repo=owner/name` already work via `repo_tags` filter? Check `gitchat-posts.controller.ts` before building.
2. Does the notification system support push to extension, or only web? Check `src/modules/notifications/` — if WebSocket event is emitted, `realtimeClient` in the extension can pick it up.
3. Rate limit for watch — can a user watch unlimited repos?
