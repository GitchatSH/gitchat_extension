# norway is here

## Current

- **Branch:** feat/wp5-chat-4-types
- **Task:** WP5 — implement 4-type chat system (dm, group, community, team) with repo activity cards
- **Blockers:** None
- **Last updated:** 2026-04-14

## Decisions

- 2026-04-13: Rebranded package.json from GitstarAI/top-github-trending to Gitchat/gitchat for separate GitChat extension publishing
- 2026-04-14: Implemented WP5 chat system — extended to 4 conversation types (dm, group, community, team); community/team chats are repo-scoped and joined via joinConversation() API; repo_activity messages render as styled cards in community/team feeds
- 2026-04-14: Fixed joinConversation() to call correct backend endpoint POST /messages/conversations (was /messages/conversations/join); added lookupRepoRoom() for GET /messages/conversations/repo-room
