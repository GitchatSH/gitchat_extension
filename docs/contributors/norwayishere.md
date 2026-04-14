# norway is here

## Current

- **Branch:** norwayishere-seen-avatars
- **Task:** Telegram-style seen avatars for read receipts (Phase 1 DM + Phase 2 Group)
- **Blockers:** Phase 2 group avatars need backend to return `readReceipts` array in getMessages response
- **Last updated:** 2026-04-14

## Decisions

- 2026-04-13: Rebranded package.json from GitstarAI/top-github-trending to Gitchat/gitchat for separate GitChat extension publishing
- 2026-04-14: Implemented WP5 chat system — extended to 4 conversation types (dm, group, community, team); community/team chats are repo-scoped and joined via joinConversation() API; repo_activity messages render as styled cards in community/team feeds
- 2026-04-14: Fixed joinConversation() to call correct backend endpoint POST /messages/conversations (was /messages/conversations/join); added lookupRepoRoom() for GET /messages/conversations/repo-room
- 2026-04-14: Added Community (globe) and Team (organization) join buttons to trending repo cards in explore panel; clicking sends chat:joinCommunity/chat:joinTeam to backend and navigates to conversation on success
- 2026-04-14: Merged develop into wp5 branch; kept globe/organization icons and repo_activity card with design tokens; took develop's unified joinConversation signature and WP11 types
- 2026-04-14: joinCommunity/joinTeam now navigates in sidebar (pushChatView) instead of opening a separate panel
- 2026-04-14: Added Telegram-style seen avatars — avatar circles next to ✓✓ on last-read outgoing messages; seenMap for group multi-reader tracking; ReadReceipt type + API parsing for future backend support
