# Repo Insight — Design Spec

- **Status**: Draft
- **Date**: 2026-04-24
- **Author**: vincent (BE)
- **Target release**: v1 (staged, flag-gated)

## 1. Goal

When a user clicks a repo card inside the extension, open a dedicated **Repo Insight** panel aggregating install guide, YouTube videos, and X/Twitter buzz — instead of opening github.com externally. Trending/hot repos get extra affordances (badge, activity chart, shorter cache).

PO intent: surface rich social context around a repo without leaving VS Code.

## 2. Scope

### In scope (v1)
- New webview panel: Repo Insight (editor tab, single-page scroll).
- Entry points: **Trending tab** and **Repo Channel** header.
- Sections: Header, Install (README-parsed), Videos (YouTube), Buzz (X), Activity (hot only).
- Hotness tier detection (`cold | warm | hot | blazing`) computed server-side.
- 1 aggregate backend endpoint with Redis caching + per-upstream timeouts + partial-fail tolerance.
- Feature flag, default OFF; staged rollout.
- Telemetry events for tuning.

### Out of scope (deferred to v2+)
- Reddit / HackerNews integration.
- AI README summary.
- Starring / forking / commenting from panel.
- Side-by-side repo compare.
- Notifications when watched repos trend up.

## 3. Architecture

```
VS Code Extension                    Backend (NestJS)
─────────────────                    ─────────────────
explore.js (card click)
  │ doAction("viewRepo")
  ▼
explore.ts onMessage
  │ cmd "gitchat.openRepoInsight"
  ▼
RepoInsightPanel (webview)
  │ GET /repo/:owner/:repo/insight
  ├─────────────────────────────────► RepoInsightService
  │                                    │ Promise.allSettled (4s timeout each)
  │                                    ├── RepoService.getRepo + getStarPower
  │                                    ├── YoutubeApiClient.searchVideos
  │                                    └── XApiClient.searchTweets
  │                                    │
  │                                    ▼
  │                                   GitstarCacheService (Redis, TTL by tier)
  ◄──────────────────────────── 200 RepoInsightResponse
  │
  ▼
render sections
```

Client sends 1 request, backend fans out in parallel, returns partial data if an upstream fails.

## 4. Backend

### 4.1 Endpoint

```
GET /repo/:owner/:repo/insight
Auth: Bearer (user OAuth preferred, falls back to GitHub App token)
```

### 4.2 Response shape

```ts
type SectionStatus = "ok" | "empty" | "error";

interface RepoInsightResponse {
  repo: {
    owner: string;
    name: string;
    description: string | null;
    stars: number;
    forks: number;
    language: string | null;
    topics: string[];
    avatar_url: string;
    html_url: string;
    pushed_at: string;    // ISO
    default_branch: string;
  };
  hotness: {
    is_hot: boolean;
    tier: "cold" | "warm" | "hot" | "blazing";
    star_power_rank: number | null;   // percentile 0–100
    signals: {
      stars_per_day_7d: number;
      trending_rank_week: number | null;
    };
  };
  install: {
    status: SectionStatus;
    data?: {
      readme_html: string;             // server-sanitized
      install_blocks: { lang: string; code: string }[];
    };
  };
  videos: {
    status: SectionStatus;
    data?: {
      id: string; title: string; channel: string;
      thumbnail_url: string; published_at: string;
      view_count: number; url: string;
    }[];   // max 6
  };
  buzz: {
    status: SectionStatus;
    data?: {
      total_mentions_7d: number;
      top_posts: {
        id: string; author: string; author_avatar_url: string;
        text: string; posted_at: string; like_count: number; url: string;
      }[];  // max 8, sorted by engagement
    };
  };
  meta: {
    cached: boolean;
    cache_age_seconds: number;
    generated_at: string;
  };
}
```

### 4.3 Orchestration rules

- Fetch repo first. If 404, short-circuit with 404.
- Parallel fan-out with `Promise.allSettled`. Wrap each upstream call in a 4s `Promise.race` timeout.
- Any upstream failure → that section's `status = "error"`. Request stays **200**. Never propagate upstream failures to the whole payload.
- Cache key: `insight:{owner}/{repo}:v1`. TTL by tier:
  - `blazing` → 15 min
  - `hot` → 2 h
  - `warm` → 6 h
  - `cold` → 24 h
- Reuses existing `GitstarCacheService` + Redis layer.

### 4.4 Hotness tier logic

```
blazing : trending_rank_week ≤ 10  OR  stars_per_day_7d ≥ 500
hot     : trending_rank_week ≤ 50  OR  stars_per_day_7d ≥ 100
warm    : stars ≥ 1000             OR  pushed_at within 7d
cold    : otherwise
```

Thresholds configurable via env (`INSIGHT_BLAZING_RANK_MAX`, `INSIGHT_BLAZING_STARS_PER_DAY`, etc.), not hardcoded. Signals sourced from existing `entity_scores` table + `star_power` service + `repo` entity.

### 4.5 README install parser

- Load `repo.readme` (raw markdown). Truncate > 200 KB.
- Extract fenced code blocks that appear under headings matching `/^(install|installation|getting started|quick start|usage)/i`.
- Label each block by language hint from fence (`bash`, `shell`, `npm`, `pnpm`, `pip`, ...).
- Render full README to sanitized HTML server-side (`marked` + `sanitize-html`). Client webview CSP cannot run DOMPurify safely for arbitrary README.
- If no install blocks found → `status: "empty"`. Client shows "View README on GitHub" link rather than fake install command.

### 4.6 Files

**New**
- `src/modules/repo/services/repo-insight.service.ts`
- `src/modules/repo/services/readme-parser.service.ts`
- `src/modules/repo/dto/get-repo-insight.dto.ts`
- `src/modules/repo/__tests__/repo-insight.service.spec.ts`
- `src/config/insight.config.ts`

**Modified**
- `src/modules/repo/controllers/repo.controller.ts` — add `GET /:owner/:repo/insight`
- `src/modules/repo/repo.module.ts` — register service
- `.env.example` — add `INSIGHT_*` threshold vars

No changes to `github.service.ts`, `youtube-api-client.service.ts`, `x-api-client.service.ts` — reuse as-is.

## 5. Extension

### 5.1 Entry points

1. **Trending tab** — `media/webview/explore.js:582` already dispatches `doAction("viewRepo", {owner, repo})`. Currently unhandled. Add `case "viewRepo"` in `src/webviews/explore.ts:onMessage()`.
2. **Repo Channel** — add a secondary button "Open Insight" in the channel header, wired to the same command.

### 5.2 Command & panel

- New command `gitchat.openRepoInsight(owner, repo)` in `src/commands/index.ts`.
- `RepoInsightPanel.createOrShow(context, owner, repo)` — singleton per `${owner}/${repo}` (reopening the same repo focuses the existing panel). Opens in `vscode.ViewColumn.One`.
- Panel has an in-memory Map cache for the current session (avoid refetch on toggle). Backend Redis is the source of truth.

### 5.3 Panel message contract

```ts
// Extension → Webview
type Inbound =
  | { type: "setInsight"; payload: RepoInsightResponse }
  | { type: "setError"; payload: { code: "network"|"404"|"500"; message: string } };

// Webview → Extension
type Outbound =
  | { type: "ready" }
  | { type: "refresh" }
  | { type: "refreshSection"; payload: { section: "install"|"videos"|"buzz" } }
  | { type: "openUrl"; payload: { url: string } }
  | { type: "copyToClipboard"; payload: { text: string } };
```

### 5.4 UI sections (top → bottom)

1. **Header** — avatar, `owner/name`, description, chips (stars, forks, language), topic chips, buttons ("Open on GitHub", "Refresh"). If `is_hot`, show hot-tier banner.
2. **Install** — `.gs-code-block` list with per-block copy button. "See full README" toggle expands sanitized HTML.
3. **Videos** — 2-column grid of YouTube cards (thumbnail 16:9, title, channel · views · age). Max 6. Click → `openExternal`.
4. **Buzz** — "N mentions in last 7 days" + list of top 8 tweets (avatar, @handle · age, text preview, like count). Click → `openExternal`.
5. **Activity** (render only when tier ∈ {hot, blazing}) — mini stars sparkline (reuse existing star-power data) + stat chips.

All UI built from existing `shared.css` primitives (`.gs-btn`, `.gs-avatar`, `.gs-row-item`, `.gs-empty`). New reusable classes to add: `.gs-section`, `.gs-code-block`, `.gs-video-card`, `.gs-hot-badge`, `.gs-markdown`. **No emoji** — use codicons.

### 5.5 States

| State | Trigger | UX |
|---|---|---|
| loading | Before first response | Skeleton per section |
| loaded-full | 200, all sections ok | Full render |
| loaded-partial | 200, 1+ section `error` | Compact error row in failing section only; rest renders normally |
| empty-section | Section `status: "empty"` | Install → link "View full README on GitHub" (opens externally); Videos/Buzz → hide section entirely |
| not-found | API 404 | Full-panel empty state + "Open on GitHub" fallback |
| error | 5xx or network | Full-panel error banner + Retry |

Client-side request timeout: **15 s**. No auto-retry.

### 5.6 Files

**New**
- `src/webviews/repo-insight.ts`
- `media/webview/repo-insight.js`
- `media/webview/repo-insight.css`
- `src/test/repo-insight-panel.test.ts`

**Modified**
- `src/webviews/explore.ts` — handle `"viewRepo"` in `onMessage()`
- `src/commands/index.ts` — register `gitchat.openRepoInsight`
- `src/api/index.ts` — add `getRepoInsight(owner, repo)` method on `ApiClient`
- `src/types/index.ts` — `RepoInsightResponse` + message contract types
- `media/webview/shared.css` — new primitives listed in §5.4
- `package.json` — register command; add setting `trending.features.repoInsight` (default `false`)

## 6. Performance budget

| Metric | Target |
|---|---|
| First paint (HTML skeleton) | < 100 ms |
| p50 latency cold cache | < 2.5 s |
| p50 latency warm cache | < 150 ms |
| p95 latency cold cache | < 5 s |
| Payload size (gzipped) | < 120 KB |
| Per-upstream timeout | 4 s |

## 7. Rate-limit & quota defense

- **GitHub**: user OAuth token preferred (5000/h), App token fallback. Existing retry for 202/429 in `github.service.ts`.
- **YouTube**: 10k units/day; `search.list` = 100 units. Cache TTL for hot = 2 h ⇒ ~12 calls/day per hot repo ⇒ budget ~800 hot repos/day. If quota exhausted → `videos.status = "error"` only, don't fail panel.
- **X**: existing dual-provider fallback (TwitterAPI45 → TwttrAPI).

## 8. Telemetry

Reuse `src/telemetry/`. Events:

- `insight.panel.opened` — `{ owner, repo, tier, source: "trending"|"channel" }`
- `insight.api.latency` — `{ latency_ms, cached, tier, partial_fail_count }`
- `insight.section.error` — `{ section, reason }`
- `insight.link.clicked` — `{ type: "video"|"buzz_post"|"github_repo"|"copy_install" }`

Review after 2 weeks to tune thresholds and decide on v2 (Reddit/HN).

## 9. Testing

**Backend (Jest)**
- Unit: hotness tier boundaries, TTL mapping, README parser (fixtures for `vitejs/vite`, `facebook/react`, `python/cpython`), partial-fail response shape.
- Integration: happy path, 404, cache hit.
- Do **not** hit real GitHub / YouTube / X in CI.

**Extension (VS Code test runner)**
- Panel DOM renders 5 section headers with mock full response.
- Panel renders partial-error (videos `error`, others `ok`).
- Dedupe: opening same repo twice → 1 panel.
- Click card / link → asserts `vscode.env.openExternal` called with correct URL.

**Manual QA checklist (in PR)**
- 1 blazing repo (e.g., current top of Trending), 1 cold repo, 1 not-found repo, offline mode, light + dark theme.

## 10. Rollout

1. Merge with flag **OFF**. Core team self-tests for 1 release cycle.
2. Flip flag **ON** by default in the next release.
3. Review telemetry after 2 weeks. Decide on v2 scope (Reddit/HN, AI summary).

Flag-OFF fallback: `viewRepo` opens `github.com/{owner}/{repo}` externally (today's behavior).

## 11. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| YouTube quota exhausted mid-day | Videos section error | Monitor quota; reduce hot TTL to 4 h if needed; graceful degrade |
| README parser misses install block (markdown quirks) | Install empty | Fallback to full README HTML toggle; iterate parser based on telemetry |
| X API pricing / quota change | Buzz section fail | Extend cold TTL (24 h → 48 h); fallback to sparse data |
| Private repo via user OAuth | 404 for other viewers | v1 documents: panel works for public repos only |

## 12. Estimated effort

- **BE**: 2–3 days (endpoint + parser + tests + config)
- **FE (extension)**: 3–4 days (panel + handlers + styles + tests)
- **Total**: ~1 week with 1 BE + 1 FE in parallel

## 13. Open questions

- Thresholds in §4.4 are informed guesses. Tune via telemetry after launch.
- Exact placement of "Open Insight" button in Repo Channel header — deferred to implementation review.

## 14. GitHub issue draft

Suggested issue title: **feat(repo-insight): aggregated repo overview panel with install / videos / buzz / hotness**

Suggested labels: `feature`, `backend`, `frontend`, `needs-design-review`.

Split into child issues:
1. `[BE] GET /repo/:owner/:repo/insight aggregate endpoint`
2. `[BE] README install-block parser service`
3. `[BE] Hotness tier computation + TTL mapping`
4. `[FE] RepoInsightPanel webview + message contract`
5. `[FE] Handle "viewRepo" action + register command`
6. `[FE] Shared CSS primitives (code-block, section, video-card, hot-badge, markdown)`
7. `[FE] Repo Channel "Open Insight" entry point`
8. `[FE/BE] Telemetry events + feature flag`
