# Plan: Beautify GitChat Extension README

## Context

README hiện tại outdated (UI đổi, brand Gitstar → GitChat). Cần README mới hoàn toàn: visual sáng tạo, assets mới, content phù hợp định vị mới.

**Định vị:** "The missing chat layer for GitHub"
**Tone:** Mix casual + bold (Raycast/Linear style — dev-friendly nhưng có energy)
**Repo:** `GitchatSH/gitchat_extension` (branch `develop`)

---

## Creative Tools

| Tool | Mục đích |
|------|----------|
| [`capsule-render`](https://github.com/kyechan99/capsule-render) | SVG banner header/footer animated |
| [`readme-typing-svg`](https://github.com/DenverCoder1/readme-typing-svg) | Tagline typing animation |
| [`shields.io`](https://shields.io) | Badges `for-the-badge` + logos |

---

## NEW README Structure & Content

### 1. Capsule-Render Header
Waving gradient banner (purple → dark), text "GitChat", desc "The missing chat layer for GitHub"

### 2. Typing SVG Tagline
4 dòng rotate:
- `DM any developer you follow on GitHub`
- `Join your repo's stargazer community`
- `Coordinate with contributors in real-time`
- `All inside your IDE. Zero context-switching.`

### 3. Badges
**Primary (for-the-badge):**
- VS Code Marketplace (blue, logo vscode)
- Open VSX Registry (purple, logo eclipse)
- MIT License (green)

**Secondary (flat-square):**
- Installs count (auto)
- Rating (auto)
- gitchat.sh website

### 4. One-liner pitch
> **GitHub gave developers code. GitChat gives them conversation.**
> DM followers, group chat with friends, join repo communities — without leaving your editor.

### 5. Hero Demo (NEW ASSET)
`assets/hero-demo.gif` — animated GIF showing full flow, centered, width=700

### 6. Quick Install
```
ext install Gitchat.gitchat
```
> Works with VS Code, Cursor, Windsurf, Antigravity, and all compatible IDEs.
> Install from [Marketplace](link) or [Open VSX](link).

### 7. Features Grid (NEW ASSETS)
HTML `<table>` 2x2:

| Cell | Feature | Caption |
|------|---------|---------|
| TL | **DM & Group Chat** | Message any dev you follow. Create groups with mutual friends. Reactions, typing indicators, read receipts — the works. |
| TR | **Friends & Presence** | Your GitHub mutual follows = your friends list. See who's coding right now. |
| BL | **Developer Profiles** | GitHub stats, top repos, bio — all in one card. Follow or DM from the profile. |
| BR | **Explore & Discover** | Find developers, communities, and teams. Your GitHub network, visualized. |

Assets needed: `assets/feature-chat.png`, `assets/feature-friends.png`, `assets/feature-profile.png`, `assets/feature-explore.png`

### 8. Why GitChat — Comparison
Bold header: **"Why not just use Slack / Discord / Teams?"**

| | GitChat | External Chat | Live Share |
|---|:---:|:---:|:---:|
| Lives inside your IDE | **Yes** | No — alt-tab | Partial |
| Uses your GitHub identity | **Yes** | New account | Yes |
| Friends = GitHub follows | **Yes** | Manual | No |
| Repo community channels | **Coming soon** | No | No |
| Works on Cursor, Windsurf... | **Yes** | N/A | VS Code only |

### 9. Roadmap
**"We ship fast. Here's what's live and what's next."**

| Status | Feature | One-liner |
|:---:|---|---|
| **Live** | DM & Group Chat | Message anyone. Create groups. |
| **Live** | Friends & Presence | See who's online. Chat instantly. |
| **Live** | Developer Profiles | GitHub stats at a glance. |
| **Soon** | Community Channels | Star a repo → join its community |
| **Soon** | Team Channels | Contribute → join the team chat |
| **Soon** | Wave / Say Hi | Ping someone online with one tap |

### 10. Getting Started
**"From install to first message: 30 seconds."**
1. `ext install Gitchat.gitchat`
2. Click **GitChat** in your activity bar
3. Sign in with GitHub — no new account
4. Start chatting. That's it.

### 11. Commands

| Command | Shortcut | What it does |
|---|---|---|
| `GitChat: Sign In` | | Authenticate with GitHub |
| `GitChat: New Message` | | Start a conversation |
| `GitChat: Create Group` | | Group chat with friends |
| `Toggle Sidebar` | `Cmd+Shift+G G` | Show/hide GitChat |

### 12. FAQ (Collapsible `<details>`)
- What is GitChat?
- How is it different from Copilot Chat / Live Share?
- Does it work with Cursor / Windsurf?
- Do I need a new account?
- Is it free?

### 13. Footer (Capsule-Render waving footer)
Centered links: **gitchat.sh** · **Report Bug** · **Privacy** · **MIT License**
Sub: "Built for developers who'd rather chat where they code."

---

## Assets cần chuẩn bị

### P0 — Bắt buộc
| # | File | Spec | Mô tả |
|---|------|------|--------|
| 1 | `assets/hero-demo.gif` | 700px wide, < 5MB | GIF demo: mở GitChat → send DM → xem profile |
| 2 | `assets/feature-chat.png` | 400px wide, dark theme | DM hoặc group chat UI mới |
| 3 | `assets/feature-friends.png` | 400px wide, dark theme | Friends list + online indicators |
| 4 | `assets/feature-profile.png` | 400px wide, dark theme | Developer profile card |

### P1 — Nice to have
| # | File | Mô tả |
|---|------|--------|
| 5 | `assets/feature-explore.png` | Discover/Explore tab |

### Tips chụp screenshot
- **Dark theme** IDE (phổ biến, pro look)
- Crop vừa panel GitChat + chút IDE context
- **2x resolution** (retina), set `width` trong markdown
- PNG cho screenshots, GIF cho demo

---

## Phân công

| Task | Ai | Khi nào |
|------|----|---------|
| Chụp/quay assets mới | **Teammate** | Bắt đầu ngay |
| Viết README.md (placeholder ảnh) | **Claude** | Song song |
| Thay placeholder bằng ảnh thật | **Claude** | Khi có assets |
| Review + push | **Cả hai** | Cuối |

---

## Verification
- Preview trên GitHub (push branch)
- Capsule-render & typing-svg URLs load đúng
- Badges hiển thị data marketplace
- Render OK trên cả VS Code Marketplace và Open-VSX
- `<details>` FAQ hoạt động
