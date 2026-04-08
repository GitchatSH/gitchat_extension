# CLAUDE.md — Top GitHub Trending Repo & People

## Project Overview

VS Code extension by GitstarAI — discover trending GitHub repos/developers, social feed, chat, and networking inside the editor.

- **Type:** VS Code Extension (not a web app, not Next.js)
- **Publisher:** GitstarAI | **ID:** `top-github-trending`
- **Engine:** VS Code `^1.100.0`
- **Entry:** `src/extension.ts` → bundled to `dist/extension.js` via esbuild

## Tech Stack

- **Language:** TypeScript (strict mode, ES2024, CommonJS modules)
- **Bundler:** esbuild (`esbuild.js`)
- **Linter:** ESLint (`eslint.config.mjs`)
- **Webviews:** HTML/CSS/JS in `media/webview/` — rendered inside VS Code webview panels
- **Icons:** VS Code Codicons (`codicon.css/ttf`)

## Project Structure

```
src/
  extension.ts          # Extension entry point
  api/                  # Backend API calls
  auth/                 # GitHub auth
  commands/             # VS Code command handlers
  config/               # Extension configuration
  events/               # Event system
  realtime/             # Real-time/WebSocket
  statusbar/            # Status bar items
  telemetry/            # Usage tracking
  test/                 # Tests
  tree-views/           # VS Code TreeView providers
  types/                # TypeScript type definitions
  utils/                # Shared utilities
  webviews/             # WebviewViewProvider implementations
media/webview/          # Webview HTML/CSS/JS assets
  shared.css            # Design tokens (--gs-* variables)
  explore.css/js        # Unified Explore panel (main UI)
docs/design/            # Design documentation
```

## Commands

- `npm run compile` — type-check + lint + build
- `npm run watch` — dev mode (esbuild + tsc watch in parallel)
- `npm run package` — production build
- `npm run check-types` — TypeScript check only
- `npm run lint` — ESLint only
- `npm run lint:fix` — ESLint auto-fix

## Key Architecture

- **Unified Explore panel** (`src/webviews/explore.ts`) — main UI with 3 tabs: Chat | Feed | Trending
- Webview providers in `src/webviews/` generate HTML that loads CSS/JS from `media/webview/`
- All VS Code API interactions through `vscode` module (do NOT import from `@vscode/*` packages)
- Commands registered in `src/commands/index.ts`, prefixed `trending.*`
- Views declared in `package.json` under `contributes.views`

## Design & UI/UX

**Design docs structure:**
- `docs/design/DESIGN.md` — Design system: tokens, principles, rules (WHAT to use)
- `docs/design/UI-PATTERNS.md` — Component specs, code examples, layout patterns (HOW to use)
- `docs/design/DECISIONS-LOG.md` — Design decisions with rationale
- `docs/design/STATUS.md` — Current project status
- `docs/design/WORKFLOW-LOG.md` — Session history

**When making UI changes, update docs:**
- New/changed component → update `UI-PATTERNS.md` (specs + code examples)
- New/changed token → update `DESIGN.md` (token list)
- Design decision → log in `DECISIONS-LOG.md`
- End of session → update `STATUS.md` + `WORKFLOW-LOG.md`

Key rules from the design system:
- **Never hardcode colors** — use `--gs-*` tokens, never raw `--vscode-*` in view CSS
- **Never hardcode font sizes** — use `--gs-font-*` variables (xs/sm/base/md/lg/xl)
- **Never use font sizes below 11px**
- **Never use emoji in UI** — use Codicons (theme-aware, pixel-consistent)
- **4px spacing grid** — all spacing must be multiples of 4
- **`--gs-inset-x`** — horizontal padding for all sections (consistency)
- **Blend into VS Code** — extension should look native, not like an embedded web app
- Design doc filenames: UPPERCASE with lowercase extension (e.g. `DESIGN.md`, `STATUS.md`)
- For major UI changes, prototype in Pencil first before implementing in code
- Pencil mockups: `docs/pencil/ideas.pen`

## Code Style

- TypeScript strict mode — no `any` unless absolutely necessary
- Use VS Code API patterns: `Disposable`, `EventEmitter`, `TreeDataProvider`
- Webview JS is vanilla — no frameworks (React, Vue, etc.)
- CSS uses BEM-like class naming within each webview
- Keep webview HTML generation in provider `.ts` files, behavior in `media/webview/*.js`

## Git Workflow

- **Main branch:** `main`
- Feature branches: `<author>-<feature>` (e.g. `hiru-uiux`, `alex-auth`)
- Never force-push
