# Ryan

## Current
- **Branch:** develop
- **Working on:** WP10 Notifications — DONE. All BE + FE shipped. Settings UI for per-type opt-out (DND + mention/wave/follow/repo) wired to BE inappPrefs. Spec marked Done
- **Blockers:** None
- **Last updated:** 2026-04-15

## Decisions
- 2026-04-13: WP10 approach — native VS Code APIs (StatusBarItem + showInformationMessage) for cross-IDE compat (Cursor/Windsurf/Antigravity); inline Notifications section at top of Explore Chat tab; NO standalone webview bell panel
- 2026-04-14: WP10 UX overhaul — moved noti UI from inline-section + status-bar bell to a SINGLE source: native view title bar bell (next to new chat) → click opens a rich webview dropdown overlay with TODAY/YESTERDAY/EARLIER time grouping. Status bar bell removed entirely (was redundant). Title bar icon swaps between $(bell) and $(bell-dot) via gitchat.hasUnread context key. Auto mark-as-seen pattern: dropdown open clears unread badge but per-item dots stay until clicked (Linear pattern, via notificationStore.markAllSeen() local-only)
- 2026-04-14: WP10 UX v3 — switched from title-bar bell + popover to a 4th main tab "Noti" next to Chat/Friends/Discover. Rationale: mobile compatibility (title bar icons don't translate, tabs do). Removed title-bar menu entries, removed dropdown overlay HTML, kept all logic + rendering. New file pair notifications-pane.{css,js} replacing notifications-dropdown.*. Tab badge on "Noti" tab shows unread count. Auto mark-as-seen on tab open
- 2026-04-14: WP10 fixes from live prod testing — (a) filter notifications client-side to WP10's 5 types (mention/wave/follow/new_message/repo_activity), drop legacy types like event_like/post_reply/repo_starred that have no FE render and showed as 'nameless' rows. (b) Switch tab open from local markAllSeen to actual markAllRead — persists to BE so the badge stays at 0 across refreshes. Drop the seen-vs-read distinction; simpler model, matches user mental model
- 2026-04-14: WP10 repo_activity dual-schema render — handle both BE-4 shape (repoFullName/eventType/title) and legacy WP7 shape (repo_owner+repo_name/activity_type/activity_title). Humanize event types: 'pr_merged' → 'PR merged', 'commit_main' → 'commit to main', 'issue_opened' → 'issue opened'
- 2026-04-14: WP10 FE-7 Settings UI — per-type notification toggles in user menu Settings: Do Not Disturb, Mentions, Waves, New followers, Repo activity. Hydrate from BE inappPrefs on ready, persist via PUT /notifications/settings { inappPrefs: { [key]: value } }. apiClient signatures updated to expose inappPrefs in NotificationSettings. WP10 marked DONE in spec
- 2026-04-14: CI — added .github/workflows/notify-issues-telegram.yml to fire issue events into Telegram group https://t.me/c/3704701963/980 (chat_id -1003704701963, thread 980). Handles issues opened/closed/reopened/assigned/unassigned/labeled + issue_comment.created with random funny footers per event type. Reuses existing TELEGRAM_BOT_TOKEN; new secrets TELEGRAM_ISSUES_CHAT_ID + TELEGRAM_ISSUES_THREAD_ID. Skips Bot-authored events to avoid loops
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
- 2026-04-15: Dead code cleanup — removed gitchat.viewAllNotifications + gitchat.markAllNotificationsRead command handlers and the notificationViewAll webview message case. Self-referential cluster: handler existed but no webview JS ever sent the message and no package.json contribution registered the commands. Verified via full repo grep
