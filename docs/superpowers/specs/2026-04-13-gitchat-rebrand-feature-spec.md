# GitChat — Rebrand & Feature Restructure Spec

> **Date:** 2026-04-13
> **Author:** PO (Akemi0x)
> **Type:** Feature spec for task assignment
> **Status:** Draft

## 1. Vision

GitChat = chat layer cho GitHub. Giải quyết 3 gaps GitHub thiếu:
- Follower ↔ Follower không chat được với nhau
- Stargazers cùng 1 repo không có kênh community
- Contributors cùng 1 repo không có kênh trao đổi

## 2. Priority & Assignment

| Priority | Work Package | Assignees | Lý do | Progress |
|----------|-------------|-----------|-------|----------|
| P0 | WP12: Cleanup | Vincent | Xóa code cũ trước, giảm complexity cho team | ✅ Done |
| P0 | WP1: Branding | Tiger, Sarah | Nền tảng identity, cần sớm | ✅ Done |
| P1 | WP2: Welcome | Cairo | Cửa vào đầu tiên của user | — |
| P1 | WP4: Tab Layout | Hiru, Slug | Khung UI chính, mọi WP khác build trên này | — |
| P1 | WP5: Chat System | Ethan | Core value — 4 loại chat | — |
| P2 | WP11: GitHub Data | Vincent | Dependency cho Friends, Discover, Community/Team | — |
| P2 | WP6: Profile Card | Hiru, Slug | Cần cho mọi interaction với user khác | — |
| P2 | WP7: Repo Activity | Ethan | Giá trị đặc biệt của Community/Team | — |
| P2 | WP3: Onboarding | Vincent | First-time UX | — |
| P3 | WP10: Notifications | Ryan | Refine, không block core flow | 🚧 In Progress |
| P3 | WP8: Wave | Hiru, Slug | Nice-to-have, social feature | — |
| P3 | WP9: Founder Agent | Sarah | Phức tạp nhất, cần LLM + Telegram integration | — |

### Dependencies

```
WP12 (Cleanup) ──→ WP4 (Tab Layout) ──→ WP5 (Chat System)
                                     ──→ WP3 (Onboarding)
WP1 (Branding) ──→ WP2 (Welcome)
WP11 (GitHub Data) ──→ WP4.Friends
                   ──→ WP4.Discover
                   ──→ WP5C (Community)
                   ──→ WP5D (Team)
WP5 (Chat) ──→ WP7 (Repo Activity)
           ──→ WP8 (Wave)
           ──→ WP9 (Founder Agent)
WP6 (Profile Card) — independent, chỉ cần basic UI framework
WP10 (Notifications) — refactor existing, anytime after WP5
```

---

## 3. Features bị cắt

Loại bỏ hoàn toàn khỏi extension:
- Trending Repos
- Trending People
- Activity Feed
- Search repos/people
- Repo Detail panel
- My Repositories
- Who to Follow
- Star/Unstar repo

---

## Work Package 1: Branding & Marketplace Metadata

**Assignees:** Tiger, Sarah

**Scope:** Cập nhật toàn bộ identity trên VS Code Marketplace.

| Field | Hiện tại | Đổi thành |
|-------|----------|-----------|
| Name | Top GitHub Trending Repo & People | GitChat |
| Description | Discover trending GitHub repos... | (Viết mới — focus chat/connect) |
| Publisher | GitchatAI | Cập nhật nếu cần |
| Extension ID | top-github-trending | Đổi mới (lưu ý: mất user hiện tại) |
| Icon/Logo | Logo cũ Gitchat | Thiết kế mới cho GitChat |

**Deliverables:**
- [x] Cập nhật `package.json`: name, displayName, description, icon
- [x] Thiết kế logo mới
- [x] Cập nhật README marketplace
- [x] Review tất cả string references "Gitstar" → "GitChat" trong codebase

**WP1 DONE (2026-04-13) — Changes:**
- `package.json`: name→gitchat, displayName→GitChat, publisher→Gitchat, version→1.0.1, homepage→gitchat.sh, keywords→chat-focused
- `package.json` + `src/` (15 files): command IDs `trending.*`→`gitchat.*`, view IDs `trendingSidebar`→`gitchatSidebar`, context key `trending.isSignedIn`→`gitchat.isSignedIn`, config keys `trending.apiUrl`→`gitchat.apiUrl`, category labels→`"GitChat"`
- `README.md`: full restructure — chat-first, comparison table, live vs "What's Next", FAQ, ext install Gitchat.gitchat
- `LICENSE`: copyright GitstarAI→GitChat
- Invite link + badge URL → Gitchat.gitchat Marketplace listing
- **Not changed (dev team):** backend URLs `api-dev.gitstar.ai` (server not migrated), trending CSS/JS in media/ (WP12 cleanup)

---

## Work Package 2: Welcome Screen

**Scope:** Redesign màn welcome cho user chưa sign in.

**Layout (single screen, sidebar ~300px):**
1. Logo GitChat
2. Tagline (1 dòng)
3. 3 value props với icon:
   - Chat với người bạn follow trên GitHub
   - Join community stargazers của repo bạn yêu thích
   - Kết nối với contributors cùng repo
4. Nút "Continue with GitHub"

**Deliverables:**
- [ ] Redesign `src/webviews/welcome.ts`
- [ ] Cập nhật CSS `media/webview/` tương ứng
- [ ] Đảm bảo responsive trong sidebar width

---

## Work Package 3: Onboarding (First-time User)

**Scope:** Sau sign-in lần đầu, user thấy Discover tab với guide overlay.

**Flow:**
1. User sign in thành công
2. Tự động mở Discover tab
3. Hiển thị guide overlay: welcome message + giải thích từng mục (People / Communities / Teams)
4. User tương tác (join group, DM ai đó) → guide biến mất
5. Lần sau mở app → vào Chat tab (inbox), không hiện guide nữa

**State:** Lưu flag `hasCompletedOnboarding` vào extension storage.

**Deliverables:**
- [ ] Implement onboarding state management
- [ ] Guide overlay UI trên Discover tab
- [ ] Auto-redirect logic (first-time → Discover, returning → Chat)

---

## Work Package 4: Tab Layout — Chat | Friends | Discover

**Scope:** Restructure UI chính thành 3 tabs thay vì Chat | Feed | Trending.

### Tab 1: Chat (Inbox)
- Danh sách tất cả conversations: DM, Group, Community, Team
- Sort by last message time
- Unread badge per conversation
- Bấm vào → mở chat view

### Tab 2: Friends
- Danh sách mutual follow (2 người follow nhau = friends)
- 3 trạng thái hiển thị:
  - **Online** — đang active trên GitChat (indicator xanh)
  - **Offline** — có account GitChat nhưng không online
  - **Not on GitChat** — mutual follow trên GitHub, chưa đăng ký GitChat → hiện nút Invite
- Bấm vào friend → mở Profile Card
- Nút DM nhanh per friend

### Tab 3: Discover
4 sections:
1. **People** — người mình đang follow trên GitHub → bấm để DM
2. **Communities** — repos mình đã star → bấm để join stargazer community group
3. **Teams** — repos mình contribute → bấm để join contributor team group
4. **Online Now** — tất cả accounts đang online trên GitChat → bấm để xem profile, gửi wave

**Deliverables:**
- [ ] Refactor `src/webviews/explore.ts` — thay 3 tabs cũ bằng 3 tabs mới
- [ ] Cập nhật tab navigation + state management
- [ ] Xóa code liên quan Feed tab, Trending tab
- [ ] Implement Friends tab UI
- [ ] Implement Discover tab UI (4 sections)

---

## Work Package 5: Chat System — 4 Loại Chat

### 5A: DM (Direct Message)
- **Điều kiện:** Mình follow người đó → nhắn được. Người kia nhận message → reply tự do (không cần follow lại)
- **Features:** Text, typing indicator, online presence, read receipts

### 5B: Group Chat (User-created)
- **Điều kiện tạo group:**
  1. Mỗi member phải mutual follow với người tạo group (members không cần follow lẫn nhau)
  2. Tất cả members phải active trên GitChat (đã sign in ít nhất 1 lần)
- **Features:** Tên group, member list, tất cả chat features của DM

### 5C: Community (Stargazer Group)
- **Điều kiện:** Chỉ stargazers của repo mới thấy + join được
- **Tự động tạo:** Mỗi repo có 1 community group
- **Đặc biệt:** Nhận repo activity notifications trong chat (xem WP7)
- **Features:** Tất cả chat features + repo activity feed inline

### 5D: Team (Contributor Group)
- **Điều kiện:** Chỉ contributors của repo mới thấy + join được
- **Tự động tạo:** Mỗi repo có 1 team group
- **Đặc biệt:** Nhận repo activity notifications trong chat (xem WP7)
- **Features:** Tất cả chat features + repo activity feed inline

**Deliverables:**
- [ ] Refactor chat system — phân biệt 4 loại conversation type
- [ ] DM eligibility check (follow status)
- [ ] Group creation flow + validation (mutual follow + active check)
- [ ] Community/Team group auto-creation per repo
- [ ] Community join gate (stargazer check via GitHub API)
- [ ] Team join gate (contributor check via GitHub API)

---

## Work Package 6: Profile Card

**Scope:** Popup/panel khi bấm vào bất kỳ account nào.

**Nội dung:**
1. **Basic info** — avatar, display name, GitHub username, bio
2. **GitHub stats** — public repos, followers, following
3. **Mutual groups** — Community/Team groups cả 2 cùng ở
4. **Mutual friends** — bạn chung (mutual follow cả 2)
5. **Top repos** — repos nổi bật người đó contribute/own
6. **Relationship status** — đang follow nhau chưa, nút follow/unfollow
7. **Actions** — DM (nếu đủ điều kiện), View on GitHub

**Deliverables:**
- [ ] Profile card component (webview)
- [ ] API calls: GitHub user info, mutual groups, mutual friends
- [ ] Follow/unfollow action
- [ ] DM action (conditional)

---

## Work Package 7: Repo Activity Notifications (In-Chat)

**Scope:** Community và Team groups nhận thông báo hoạt động repo inline trong chat.

**Activity types (chỉ trên main/default branch):**
1. **New release** — tag mới được publish
2. **PR merged** — pull request merged vào main
3. **Commit to main** — direct push (không qua PR)
4. **Issue opened** — issue mới được tạo

**Hiển thị:** Message đặc biệt trong chat (khác style với user message), có link tới GitHub.

**Deliverables:**
- [ ] Repo activity message type (UI component)
- [ ] WebSocket/polling cho repo events (GitHub API hoặc webhook)
- [ ] Filter logic: chỉ main branch, chỉ 4 event types
- [ ] Render inline trong Community/Team chat

---

## Work Package 8: Wave / Say Hi

**Scope:** Feature cho Discover → Online Now. Giảm friction kết nối người lạ.

**Flow:**
1. User thấy ai đó online trong Discover
2. Bấm "Wave" / "Say Hi" → gửi 1 lần duy nhất tới người đó
3. Người nhận thấy notification "X waved at you"
4. Nếu người nhận respond → mở DM conversation giữa 2 người
5. Không respond → không có gì xảy ra, không gửi wave lần 2

**Deliverables:**
- [ ] Wave action button trong Discover → Online Now
- [ ] Wave notification type
- [ ] Wave → DM conversion logic
- [ ] Rate limit: 1 wave per user pair

---

## Work Package 9: Founder Agent

**Scope:** AI-powered account của founder, hỗ trợ onboard + giữ chân user.

### Behavior
- **Auto DM:** Mọi user mới tự động có 1 DM conversation với founder
- **Auto join groups:** Founder join mọi Community/Team group khi user đầu tiên join, với tag "GitChat Support"
- **Chat:** Trò chuyện, hỗ trợ onboard, giới thiệu features

### AI + Human-in-the-loop
- **AI:** LLM xử lý chat (auto-reply)
- **Telegram bridge:** Tất cả messages của founder agent đẩy vào 1 group Telegram
  - Team members thấy mọi conversation
  - Team members nhắn từ Telegram → hiện dưới tên founder trong GitChat (user không phân biệt AI/human)
- **Mục đích ops:** Monitor số lượng user, group nào active, user cần help gì

### Exempt Rules
- Founder account không cần star/contribute repo để join Community/Team
- Hiển thị với tag "GitChat Support" trong member list

**Deliverables:**
- [ ] Founder account setup + special role
- [ ] Auto-DM on new user registration
- [ ] Auto-join Community/Team groups (bypass rules, tagged)
- [ ] LLM integration cho auto-reply
- [ ] Telegram bot bridge (2-way sync)
- [ ] "GitChat Support" tag UI trong member list

---

## Work Package 10: Notifications

**Scope:** Notification system gọn theo core features.

**Notification types:**
| Type | Trigger |
|------|---------|
| New message | DM / Group / Community / Team |
| Mention | @tag trong bất kỳ chat nào |
| New follower | Ai đó follow mình trên GitHub |
| Repo activity | Release, PR merged, commit to main, issue opened |
| Wave | Ai đó gửi wave cho mình |

**Deliverables:**
- [ ] Refactor notification system — cắt like, feed activity
- [ ] Thêm wave notification type
- [ ] Đảm bảo repo activity noti đúng scope (chỉ groups đã join)

---

## Work Package 11: GitHub Data & Caching

**Scope:** Fetch và cache data từ GitHub API.

**Data cần fetch:**
- Mutual follows (followers ∩ following) → Friends list + "Not on GitChat"
- Starred repos → Discover Communities
- Contributed repos → Discover Teams
- User profile data → Profile Card

**Strategy:**
- Fetch 1 lần khi sign in
- Cache 24h
- Refresh on-demand khi user pull-to-refresh

**Lưu ý:** GitHub API rate limit 5000 req/hr. User có nhiều following cần paginate.

**Deliverables:**
- [ ] GitHub API service (fetch followers, following, starred, contributions)
- [ ] Cache layer (24h TTL)
- [ ] Pagination handling
- [ ] Rate limit awareness

---

## Work Package 12: Cleanup — Xóa Features Cũ

**Scope:** Xóa toàn bộ code liên quan features bị cắt.

**Xóa:**
- Trending repos/people (webview, tree-view, API, CSS, JS)
- Activity Feed (webview, tree-view, API, CSS, JS)
- Search repos/people
- Repo Detail panel
- My Repositories
- Who to Follow
- Star/Unstar repo actions
- Feature flags: `SHOW_FEED_TAB`, `SHOW_TRENDING_TAB`

**Giữ:** Chat, auth, realtime, notifications, statusbar, telemetry, config (update config options)

**Deliverables:**
- [ ] Remove dead webview providers + media assets
- [ ] Remove dead tree-view providers
- [ ] Remove dead commands + keybindings
- [ ] Remove dead API methods
- [ ] Clean up `package.json` contributes (commands, views, config)
- [ ] Verify extension still compiles + runs

