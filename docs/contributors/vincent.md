# Vincent

## Current
- **Branch:** develop
- **Working on:** Fix #12 — Copy Profile Badge guard + personalize (signed-out guard + personalized badge URL)
- **Blockers:** None
- **Last updated:** 2026-04-14

## Decisions
- 2026-04-13: WP12 Cleanup — giữ `repoDetailModule` ban đầu (vì có UI ref), sau đó user chốt xóa luôn. Gỡ toàn bộ trending/feed/repo-detail/search webviews, tree-views, media assets. Giữ `channel.ts` vì Channels tab vẫn live trong Explore UI.
- 2026-04-13: WP12 — KHÔNG đổi `trending.*` command prefix và extension ID `top-github-trending`. Để WP1 Branding lo — chỉ xóa dead code.
- 2026-04-13: WP12 — cần restore các HTML shell ẩn (`#explore-header`, `#search-home`, `#search-results`) vì `media/webview/explore.js` query unguarded; nếu không sẽ crash JS và chat không render.
- 2026-04-14: WP11 kiến trúc — **backend proxy** thay vì extension gọi GitHub trực tiếp. Extension gửi GitHub token qua `Authorization: Bearer` header (pattern có sẵn), BE proxy + cache server-side. Giảm round-trip cho UI consumer, tránh burn user rate limit cho cùng 1 data.
- 2026-04-14: WP11 cache 3 tầng — Redis hot (5 min) → Postgres persistent (24h via entity tables) → GitHub API. Floor 5 min/user/data-type chặn spam `force=true`.
- 2026-04-14: WP11 caps — Starred 500, Contributed 100 (GitHub search/commits tổng cap 1000 results).
- 2026-04-14: WP11 contributed repos định nghĩa — dùng `/search/commits?q=author:LOGIN` gom distinct repos. Đủ đơn giản, có thể upgrade sang GraphQL `contributionsCollection` sau nếu cần.
- 2026-04-14: WP11 friends — mutual follows compute bằng self-join trên `user_follows` (table có sẵn, `FollowingService.syncGitHubFollows` đã fill). Không tạo bảng cache riêng.
- 2026-04-14: WP11 profile — upsert vào `user_profiles` table có sẵn thay vì tạo bảng mới. Rich fields (bio, company, blog, twitter) lấy từ `/users/{login}`.
- 2026-04-14: WP11 extension cache persist ở `context.globalState` 24h, key theo user login để tránh cross-account leak. Clear trong `authManager.signOut()` trước khi fire event.
- 2026-04-14: WP11 — bỏ lời gọi `apiClient.refreshAllGithubData()` trong `githubDataCache.refreshAll()` vì race double-fetch (cả POST /refresh-all background và 4 force GET cùng chạy → mỗi data type fetch GitHub 2 lần). Chỉ giữ 4 force GET song song. Endpoint `POST /github/data/refresh-all` để lại cho WebSocket push / scheduled refresh sau.
- 2026-04-14: Fix #12 Copy Profile Badge — chọn Option C (personalize badge URL → `dev.gitchat.sh/@<login>`) kèm Option A (`menus.commandPalette` when `gitchat.isSignedIn`) + Option B (handler guard). Lý do: tên command là "Profile Badge" nhưng chuỗi cũ là marketplace URL generic, không liên quan profile user — copy ra README cũng vô nghĩa.
