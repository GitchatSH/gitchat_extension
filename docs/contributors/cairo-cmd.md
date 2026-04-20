# cairo-cmd

## Current

- **Role:** FE
- **Branch:** `cairo-cmd-fix-87-discover-loading`
- **Task:** Fix #87 — Discover tab flashes empty state "Contribute to repos..." / "Star repos..." on cold cache before fresh data arrives (extension FE-only)
- **Blockers:** None
<<<<<<< HEAD
- **Last updated:** 2026-04-16
=======
- **Last updated:** 2026-04-20
>>>>>>> f9b0645 (chore/update_cairo_plan)

## Decisions

- 2026-04-13: Chose Option A (centered minimal layout) for welcome screen — clean list layout fits sidebar best, avoids scroll, native VS Code feel
- 2026-04-13: Removed stats, founder quote, and permissions disclosure — spec scoped to logo + tagline + 3 value props + CTA only
- 2026-04-13: Using Codicons (comment-discussion, star, organization) instead of emoji — follows design rules
- 2026-04-13: Logo using star SVG placeholder — final GitChat logo asset to be swapped in when provided
- 2026-04-14: Replaced SVG star placeholder with actual GitChat logo (media/icon.png) — added border + increased size to 56px
- 2026-04-14: Enhanced onboarding UI — animated RGB glow border, staggered entrance choreography, breathing icon glows, shimmer effects, smooth dismiss animation
- 2026-04-17: Developed feature to show full seen-by list (all users who have read the message, instead of just avatar stack) + fixed related seen receipts issues
- 2026-04-20: Continued fixing issues arising from the full seen-by list feature
- 2026-04-15: Fix #31/#32 Seen avatars wrong users (`gitchat-webapp/backend` + `gitchat_extension`) — backend emit `conversation:read`/`reaction:updated` vào room `conversation:<id>` nhưng payload thiếu `conversationId`; extension subscribe nhiều conv rooms cùng lúc qua `_subscribedConversations` Set → events leak giữa các conversations. Client relay `explore.ts:1695` chỉ check `if (_activeChatConvId)` không check `data.conversationId === _activeChatConvId`. Fix 2-repo: (a) **BE** `messages.service.ts` thêm `conversationId` vào 3 emit payloads (CONVERSATION_READ line 1245, REACTION_UPDATED add 1745 + remove 1797) — additive vì `data: Record<string, any>`, backwards compatible với webapp frontend. (b) **Extension** 7 edits: `realtime/index.ts` types + parsers require `conversationId` hoặc drop event; `explore.ts` 2 filter conditions; `sidebar-chat.js` 3 hardening — (i) line 3661 bỏ `|| _state.otherReadAt` fallback leak giữa conv (root cause thứ 2 của #32 "DM offline recipient shows seen" — client-only bug BE không cover), (ii) line 3667 filter `readReceipts` init theo `groupMembers`/`otherLogin`, (iii) line 3835 drop fallback `|| _state.otherLogin` và validate `readLogin` thuộc conversation. Deploy order bắt buộc: BE trước — ship extension trước thì `data.conversationId === _activeChatConvId` luôn false → seen avatar tắt hẳn. Out of scope (follow-up issue): `sidebar-chat.js:3849-3862` mark all `.gs-sc-msg-out` thành seen không so timestamp → message gửi sau khi đọc bị mark sai.
- 2026-04-16: Fix #87 Discover tab empty-state flash (`gitchat_extension` FE-only) — root cause: `src/webviews/explore.ts:352-366, :388-402` đã gửi sẵn `stale: boolean` trên mỗi `setStarredReposData` / `setContributedReposData` payload nhưng `media/webview/explore.js` handler drop field đó, render logic chỉ có 3 nhánh (error / length===0 / has-items) → không phân biệt được "đang fetch" với "thực sự 0 repo" → cold cache luôn flash "Contribute to repos to join their teams" (và "Star repos..." cho Communities) trước khi fresh data về. Fix 5 edit trong 1 file `explore.js`: (1) thêm `starredReposLoading = true`, `contributedReposLoading = true` state vars (init true); (2) reset 2 flag về true trước mỗi `fetchStarredRepos`/`fetchContributedRepos` dispatch khi user vào Discover tab (fix re-entry case); (3) handler derive `loading = stale && !error` — stale=true giữ loading, fresh hoặc error tắt loading; (4) Teams render thêm nhánh loading (error > loading > empty > all-joined); (5) Communities render pattern giống hệt. Reused `.gs-empty gs-text-sm` + `codicon-loading codicon-modifier-spin` (đã có sẵn ở People search line 1050) — 0 component mới, 0 CSS mới. Rejected issue's Option B (BE chờ fresh mới trả) vì sẽ mất benefit của stale-while-revalidate cho user cache warm. Rejected thêm BE field `isLoading` — không cần vì `stale` đã đủ tín hiệu. Edge case: nếu stale payload có items, vẫn render items ngay thay vì hide sau spinner (better perceived perf — loading chỉ show khi `loading && length===0`). Verification manual trong Extension Development Host (no webview JS test harness trong repo).
