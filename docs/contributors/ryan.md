# Ryan

## Current
- **Branch:** develop
- **Working on:** WP10 Notifications — Sprint 1+2 complete (cleanup zombie, align types, wire notification:new). Next: Sprint 3-6 (notification-center module + UI + statusbar merge)
- **Blockers:** None — BE-1 + BE-2 shipped in gitchat-webapp@6599dd8
- **Last updated:** 2026-04-13

## Decisions
- 2026-04-13: WP10 approach — native VS Code APIs (StatusBarItem + showInformationMessage) for cross-IDE compat (Cursor/Windsurf/Antigravity); inline Notifications section at top of Explore Chat tab; NO standalone webview bell panel
- 2026-04-13: Delete zombie notification surfaces (webviews/notifications.ts + media assets) — never registered in package.json contributes.views; WP12 cleanup already removed tree-view and commands
- 2026-04-13: Unified unread badge on status bar — messages_unread + notifications_unread in one item, click → trending.openInbox
- 2026-04-13: Repo activity renders inline in WP7 community/team chat only, NOT as separate notification row (dedup with WP10)
- 2026-04-13: Mention persistence — BE persists notification row on @mention in messages (BE-2, previously WS-only), enabling reload-safe mention history
- 2026-04-13: CI — added Telegram push notify workflow to both gitchat_extension and gitchat-webapp, unified format via actions/github-script
