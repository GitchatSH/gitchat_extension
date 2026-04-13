# Ryan

## Current
- **Branch:** develop
- **Working on:** WP10 Notifications — BE complete (BE-1..BE-5 in gitchat-webapp@9264892). FE Sprints 1-6 complete (cleanup, types, module, realtime, statusbar merge, inline list UI). Remaining: FE-7 config flags, FE-8 smoke test
- **Blockers:** None — self-sufficient via isolated notifications-section.js/css (coexists cleanly with explore.js until WP4 restructure)
- **Last updated:** 2026-04-13

## Decisions
- 2026-04-13: WP10 approach — native VS Code APIs (StatusBarItem + showInformationMessage) for cross-IDE compat (Cursor/Windsurf/Antigravity); inline Notifications section at top of Explore Chat tab; NO standalone webview bell panel
- 2026-04-13: Delete zombie notification surfaces (webviews/notifications.ts + media assets) — never registered in package.json contributes.views; WP12 cleanup already removed tree-view and commands
- 2026-04-13: Unified unread badge on status bar — messages_unread + notifications_unread in one item, click → trending.openInbox
- 2026-04-13: Repo activity renders inline in WP7 community/team chat only, NOT as separate notification row (dedup with WP10)
- 2026-04-13: Mention persistence — BE persists notification row on @mention in messages (BE-2, previously WS-only), enabling reload-safe mention history
- 2026-04-13: CI — added Telegram push notify workflow to both gitchat_extension and gitchat-webapp, unified format via actions/github-script
- 2026-04-13: FE-5 inline noti list — isolated in notifications-section.js/.css loaded alongside explore.js (not embedded inside it) to survive WP4 Tab Layout rewrite by Hiru/Slug. Own window.message listener for 'setNotifications', own DOM subtree (#notif-section)
- 2026-04-13: WP10 BE all in gitchat-webapp@9264892: Wave module (waves table + routes), repo_activity fanout from GitHub webhooks (release/pr_merged/commit_main/issue_opened with 10min rate-limit), inapp_noti_prefs column + filter in createNotification
