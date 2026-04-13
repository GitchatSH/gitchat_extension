# Marketplace Growth & Polish — Design Spec

**Date:** 2026-04-04
**Extension:** Top GitHub Trending Repo & People (v1.3.2) by GitchatAI
**Goal:** Increase marketplace installs through optimization, polish, and growth features

---

## Phase A: Marketplace Optimization

### A1. package.json metadata improvements

**Category:** Change `"Other"` → `"Social"` for better discoverability.

**Keywords:** Add `"cursor"`, `"windsurf"`, `"networking"`, `"messaging"`, `"community"` to existing list. VS Code marketplace caps at 42 combined keyword+tag characters, but the actual limit is per-keyword (max 50 chars each, up to ~10 keywords). Current list has 8, adding 5 more is fine.

**Privacy URL:** Add `"pricing"` field is not needed (free extension), but add a link to the privacy policy in the `"repository"` section and via the `"qna"` field pointing to GitHub issues. Also add `"homepage"` pointing to gitchat.sh.

### A2. README overhaul

Replace current text-only README with a structured, visual-first layout:

1. **Hero section** — One-liner tagline + shields.io badges (version, installs, rating, license)
2. **Visual demo section** — Placeholder image references for GIF/screenshots (user will record these)
3. **Feature highlights** — Reorganized with icons, grouped by: Discovery, Social, Messaging
4. **Multi-IDE support** — Prominent section listing VS Code, Cursor, Windsurf, Antigravity, Void
5. **Getting started** — 4-step quickstart (same as current but cleaner)
6. **Commands & keybindings** — Combined table
7. **Links** — Privacy policy, GitHub issues, website

### A3. CHANGELOG.md

Create a CHANGELOG following [Keep a Changelog](https://keepachangelog.com/) format. Backfill from git history, grouped by version tags (1.3.2, 1.2.0, 1.1.4, 1.1.3, 1.1.2, 0.1.1).

---

## Phase B: Product Polish

### B1. Smart polling — reduce resource usage when IDE unfocused

Use `vscode.window.onDidChangeWindowState` to detect focus.

When window loses focus:
- Trending poll: 5 min → 15 min
- Feed poll: 2 min → 10 min
- Status bar poll: 30s → 60s
- Heartbeat: pause entirely (user is away)

When window regains focus:
- Immediately fetch fresh data (one-shot)
- Resume normal intervals

**Implementation:** Each module that polls needs to check a shared `isFocused` flag from a central place. The config module already exists — add a `windowFocused` observable there. Each polling module adjusts its own interval.

**Files affected:**
- `src/config/index.ts` — add focus state tracking
- `src/statusbar/index.ts` — adjust 30s poll
- `src/tree-views/trending-repos.ts` — adjust trending poll
- `src/tree-views/trending-people.ts` — adjust trending poll
- `src/webviews/feed.ts` — adjust feed poll
- `src/realtime/index.ts` — pause/resume heartbeat

### B2. Activation events optimization

Current: `activationEvents: []` (empty array = activate on startup in recent VS Code versions).

Change to explicit activation on sidebar open or command execution:
```json
"activationEvents": [
  "onView:trending.trendingRepos",
  "onView:trending.trendingPeople",
  "onView:trending.feed",
  "onView:trending.chatPanel",
  "onView:trending.whoToFollow",
  "onView:trending.myRepos",
  "onView:trending.notifications",
  "onCommand:trending.signIn",
  "onCommand:trending.search",
  "onCommand:trending.browseTrendingRepos",
  "onCommand:trending.browseTrendingPeople",
  "onCommand:trending.openFeed",
  "onCommand:trending.openInbox",
  "onCommand:trending.openNotifications",
  "onCommand:trending.messageUser",
  "onCommand:trending.createGroup"
]
```

This means extension only loads when user actually clicks the sidebar or runs a command. Zero startup cost otherwise.

---

## Phase C: Growth Features

### C1. Post-signin onboarding

After successful sign-in + GitHub sync:
1. Auto-reveal the "Who to Follow" panel (currently collapsed by default)
2. Show an information message: "Welcome to Gitchat! Check out trending repos and devs to follow."

**Files affected:** `src/auth/index.ts` — after `_syncToGitchat()` completes, reveal Who to Follow view and show welcome message.

### C2. Invite link command

New command `trending.copyInviteLink` that copies a pre-formatted invite message:

```
"Hey! I've been using Gitchat to discover trending repos and chat with devs right in VS Code. Try it: https://marketplace.visualstudio.com/items?itemName=GitchatAI.top-github-trending"
```

Register in package.json commands, add to command palette.

**Files affected:** `src/commands/index.ts`, `package.json`

### C3. Profile badge command

New command `trending.copyProfileBadge` that copies markdown for a README badge:

```markdown
[![Chat on Gitchat](https://img.shields.io/badge/Chat%20on-Gitchat-blue?logo=github)](https://marketplace.visualstudio.com/items?itemName=GitchatAI.top-github-trending)
```

**Files affected:** `src/commands/index.ts`, `package.json`

---

## Out of scope

- Production API URL migration (staying on dev for now)
- GIF/screenshot recording (user will do manually)
- Marketing posts on Reddit/Twitter/Dev.to (user will do manually)
- Privacy policy creation (already exists on gitchat.sh)

---

## User actions required

After implementation:
1. Record GIF demo of: sign in → browse trending → follow dev → open chat
2. Take screenshots of: Explore sidebar, Chat panel, Feed, Profile view
3. Replace placeholder image references in README with actual assets
4. Write and publish marketing posts
5. Deploy production API when ready
