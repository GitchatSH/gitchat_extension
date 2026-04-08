# Decisions Log

Key technical and design decisions with rationale.

## 2026-04-05

### Decision: Use tabbed navigation for Explore sidebar

**Context:** The Explore sidebar currently stacks 5 sections (For You, Trending Repos, Trending People, Who to Follow, My Repos) in a single scrollable view, making it too dense.

**Options considered:**
1. Split into multiple Activity Bar containers (Discover + Social + Chat) — rejected because VS Code API cannot programmatically place views in the secondary sidebar; only 1 sidebar visible at a time
2. Tabbed navigation within a single webview — **chosen**
3. Reduce density by showing fewer items — not sufficient

**Decision:** Convert Explore sidebar into a single webview with 3 tabs:
- **Feed** — personalized activity stream (For You cards + filter chips)
- **Trending** — global rankings (Repos + People)
- **Social** — personal network (Who to Follow + Following + My Repos + Starred Repos)

**Rationale:**
- Pattern already proven in codebase (`chat-panel.js` uses tabs for Friends/Inbox)
- No additional Activity Bar icons needed
- Each tab has a clear, focused concern
- Requires converting TreeViews to webview rendering (trade-off: lose native feel, gain UX control)

### Decision: Design system must use `--gs-*` token layer

**Context:** `shared.css` defines a `--gs-*` token layer mapping from `--vscode-*`, but only ~50% of view CSS files actually use it.

**Decision:** All view CSS must use `--gs-*` tokens exclusively. Direct `--vscode-*` usage in view CSS is prohibited.

**Rationale:** The abstraction layer enables consistent theming, easier refactoring, and a single source of truth for design values.
