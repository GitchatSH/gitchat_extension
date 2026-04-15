# cairo-cmd

## Current

- **Branch:** `cairo-cmd-fix-seen-avatars-31`
- **Task:** Fix #31/#32 — seen avatars hiển thị sai user (extension side, paired with BE patch merged on `gitchat-webapp/backend`)
- **Blockers:** None
- **Last updated:** 2026-04-15

## Decisions

- 2026-04-13: Chose Option A (centered minimal layout) for welcome screen — clean list layout fits sidebar best, avoids scroll, native VS Code feel
- 2026-04-13: Removed stats, founder quote, and permissions disclosure — spec scoped to logo + tagline + 3 value props + CTA only
- 2026-04-13: Using Codicons (comment-discussion, star, organization) instead of emoji — follows design rules
- 2026-04-13: Logo using star SVG placeholder — final GitChat logo asset to be swapped in when provided
- 2026-04-14: Replaced SVG star placeholder with actual GitChat logo (media/icon.png) — added border + increased size to 56px
- 2026-04-14: Enhanced onboarding UI — animated RGB glow border, staggered entrance choreography, breathing icon glows, shimmer effects, smooth dismiss animation
- 2026-04-15: Fix #31/#32 Seen avatars wrong users (`gitchat-webapp/backend` + `gitchat_extension`) — backend emit `conversation:read`/`reaction:updated` vào room `conversation:<id>` nhưng payload thiếu `conversationId`; extension subscribe nhiều conv rooms cùng lúc qua `_subscribedConversations` Set → events leak giữa các conversations. Client relay `explore.ts:1695` chỉ check `if (_activeChatConvId)` không check `data.conversationId === _activeChatConvId`. Fix 2-repo: (a) **BE** `messages.service.ts` thêm `conversationId` vào 3 emit payloads (CONVERSATION_READ line 1245, REACTION_UPDATED add 1745 + remove 1797) — additive vì `data: Record<string, any>`, backwards compatible với webapp frontend. (b) **Extension** 7 edits: `realtime/index.ts` types + parsers require `conversationId` hoặc drop event; `explore.ts` 2 filter conditions; `sidebar-chat.js` 3 hardening — (i) line 3661 bỏ `|| _state.otherReadAt` fallback leak giữa conv (root cause thứ 2 của #32 "DM offline recipient shows seen" — client-only bug BE không cover), (ii) line 3667 filter `readReceipts` init theo `groupMembers`/`otherLogin`, (iii) line 3835 drop fallback `|| _state.otherLogin` và validate `readLogin` thuộc conversation. Deploy order bắt buộc: BE trước — ship extension trước thì `data.conversationId === _activeChatConvId` luôn false → seen avatar tắt hẳn. Out of scope (follow-up issue): `sidebar-chat.js:3849-3862` mark all `.gs-sc-msg-out` thành seen không so timestamp → message gửi sau khi đọc bị mark sai.
