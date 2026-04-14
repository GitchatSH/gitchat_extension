# Ryan

## Current
- **Branch:** develop
- **Working on:** WP10 Notifications — UX overhaul: bell moved from status bar to native title bar (next to new chat), click opens rich dropdown overlay with time grouping (Today/Yesterday/Earlier), auto mark-as-seen on open, empty state. BE also ported to gitstar-internal (5 commits)
- **Blockers:** None — WP10 v2 ready
- **Last updated:** 2026-04-14

## Decisions
- 2026-04-13: WP10 approach — native VS Code APIs (StatusBarItem + showInformationMessage) for cross-IDE compat (Cursor/Windsurf/Antigravity); inline Notifications section at top of Explore Chat tab; NO standalone webview bell panel
- 2026-04-14: WP10 UX overhaul — moved noti UI from inline-section + status-bar bell to a SINGLE source: native view title bar bell (next to new chat) → click opens a rich webview dropdown overlay with TODAY/YESTERDAY/EARLIER time grouping. Status bar bell removed entirely (was redundant). Title bar icon swaps between $(bell) and $(bell-dot) via gitchat.hasUnread context key. Auto mark-as-seen pattern: dropdown open clears unread badge but per-item dots stay until clicked (Linear pattern, via notificationStore.markAllSeen() local-only)
- 2026-04-13: Delete zombie notification surfaces (webviews/notifications.ts + media assets) — never registered in package.json contributes.views; WP12 cleanup already removed tree-view and commands
- 2026-04-13: Unified unread badge on status bar — messages_unread + notifications_unread in one item, click → trending.openInbox
- 2026-04-13: Repo activity renders inline in WP7 community/team chat only, NOT as separate notification row (dedup with WP10)
- 2026-04-13: Mention persistence — BE persists notification row on @mention in messages (BE-2, previously WS-only), enabling reload-safe mention history
- 2026-04-13: CI — added Telegram push notify workflow to both gitchat_extension and gitchat-webapp, unified format via actions/github-script
- 2026-04-13: FE-5 inline noti list — isolated in notifications-section.js/.css loaded alongside explore.js (not embedded inside it) to survive WP4 Tab Layout rewrite by Hiru/Slug. Own window.message listener for 'setNotifications', own DOM subtree (#notif-section)
- 2026-04-13: WP10 BE all in gitchat-webapp@9264892: Wave module (waves table + routes), repo_activity fanout from GitHub webhooks (release/pr_merged/commit_main/issue_opened with 10min rate-limit), inapp_noti_prefs column + filter in createNotification
- 2026-04-14: Custom command gitchat.openNotifications — bell click in status bar opens sidebar + scrolls to noti section. Built-in workbench commands unreliable on Antigravity fork
- 2026-04-14: Toast throttle — max 1 active toast + 8s cooldown to prevent spam when many noti arrive at once
- 2026-04-14: viewAllNotifications QuickPick command — overflow when section has >5 items, supports search across actor/preview
- 2026-04-14: Bug fix in api.getNotifications() — BE TransformInterceptor returns flat shape when service response already has 'data' key, FE was double-unwrapping. Fixed by reading data.data directly without fallback chain
- 2026-04-14: UI redesign of notifications section — avatar 32px with type badge overlay (mention/wave/follow/repo/message colors), bold actor name, preview line, time ago, unread dot, uppercase header with pill, View all + Mark all read footer buttons. Uses --gs-* tokens to blend with conversation list
