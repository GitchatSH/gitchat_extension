# norway is here

## Current

- **Branch:** develop
- **Task:** QA existing tasks; update CLAUDE.md to standardize rules/workflow; opening new issues; reporting team status to Akemi; published v1.0.4 to Open VSX
- **Blockers:** None
- **Last updated:** 2026-04-15

## Decisions

- 2026-04-13: Rebranded package.json from GitstarAI/top-github-trending to Gitchat/gitchat for separate GitChat extension publishing
- 2026-04-14: Implemented WP5 chat system — extended to 4 conversation types (dm, group, community, team); community/team chats are repo-scoped and joined via joinConversation() API; repo_activity messages render as styled cards in community/team feeds
- 2026-04-14: Fixed joinConversation() to call correct backend endpoint POST /messages/conversations (was /messages/conversations/join); added lookupRepoRoom() for GET /messages/conversations/repo-room
- 2026-04-14: Added Community (globe) and Team (organization) join buttons to trending repo cards in explore panel; clicking sends chat:joinCommunity/chat:joinTeam to backend and navigates to conversation on success
- 2026-04-14: Merged develop into wp5 branch; kept globe/organization icons and repo_activity card with design tokens; took develop's unified joinConversation signature and WP11 types
- 2026-04-14: joinCommunity/joinTeam now navigates in sidebar (pushChatView) instead of opening a separate panel
- 2026-04-14: Added Telegram-style seen avatars — avatar circles next to ✓✓ on last-read outgoing messages; seenMap for group multi-reader tracking; ReadReceipt type + API parsing for future backend support
- 2026-04-14: Click group chat header (name/members count) now opens group info panel directly — no need to go through settings menu first (Telegram-style UX)
- 2026-04-15: QA pass on all existing features — verifying chat, notifications, profile, discover, and friends tabs for regressions after WP4/WP5/WP10 merges
- 2026-04-15: Updating CLAUDE.md to enforce standardized workflow rules for the entire team (commit conventions, PR process, session start/end protocol)
- 2026-04-15: Opening new GitHub issues for bugs and improvements found during QA
- 2026-04-15: Set up automated launchd jobs — develop branch monitor (every 10 min with Telegram alerts) and beta auto-publish pipeline (every 2 hours to Open VSX under norwayishere publisher)
- 2026-04-15: Preparing team status report for Akemi — summarizing each member's progress, blockers, and pending PRs
- 2026-04-15: Fine-tuning overall chat UX to match Telegram-style patterns — smooth interactions, familiar navigation, and polished micro-interactions
