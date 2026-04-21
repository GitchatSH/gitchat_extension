# norway is here

## Current

- **Role:** PO
- **Branch:** main
- **Task:** Fixed publisher to Gitchat in package.json; v1.1.4 live on Open VSX.
- **Blockers:** None
- **Last updated:** 2026-04-21

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
- 2026-04-16: Issue triage — set priority: high/medium/low labels on all 18 open issues; reassigned issues to correct owners (84→cairo, 89→norway, 46→vincent)
- 2026-04-16: Fixed chat list timestamp bug (issue #89) — swapped updated_at || last_message_at to last_message_at || updated_at in explore.js so read-receipt events no longer show fake recent timestamps
- 2026-04-16: Released v1.1.0 to OpenVSX and VS Code Marketplace (fixed publisher from Gitchat → GitchatSH); created main branch synced from develop; added main branch protection rule to CLAUDE.md; labeled all 12 open issues as phase 2
- 2026-04-16: Bumped version to 1.1.1 in package.json; created PR develop → main for release
- 2026-04-16: Published v1.1.1 to OpenVSX + VS Code Marketplace; fixed publisher Gitchat → GitchatSH in package.json; added .claude/ and .openacp/ to .vscodeignore to prevent secret leaks in packaged vsix
- 2026-04-20: Open-source prep — moved GITCHAT_API_URL/WS_URL to .env + esbuild define, removed gitchat.apiUrl/wsUrl VS Code settings, updated LICENSE copyright to GitchatSH
- 2026-04-17: Updated CLAUDE.md with team workflow rules (role-based session briefing, announcement system, BE file claim rules, daily plan prompt, push-triggered contributor doc updates). Added ROLE-RULES.md and announcement.md. Updated pre-commit hook to allow PO to edit all contributor docs. Proposed group creation UX change: relax mutual follow gate to one-way follow + email invite for non-GitChat users.

