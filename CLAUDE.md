# CLAUDE.md — Top GitHub Trending Repo & People

## Project Overview

VS Code extension by GitchatAI — discover trending GitHub repos/developers, social feed, chat, and networking inside the editor.

- **Type:** VS Code Extension (not a web app, not Next.js)
- **Publisher:** GitchatAI | **ID:** `top-github-trending`
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
docs/contributors/      # Per-member status & decisions
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

**Design docs:**
- `docs/design/DESIGN.md` — Design system: tokens, principles, rules (WHAT to use)
- `docs/design/UI-PATTERNS.md` — Component specs, code examples, layout patterns (HOW to use)

**When making UI changes, update docs:**
- New/changed component → update `UI-PATTERNS.md` (specs + code examples)
- New/changed token → update `DESIGN.md` (token list)

Key rules from the design system:
- **Reuse existing components, don't invent new ones** — before styling anything, check `shared.css` for `.gs-btn*`, `.gs-input`, `.gs-avatar`, `.gs-row-item`, `.gs-dropdown`, `.gs-sub-tab`, `.gs-main-tab`, `.gs-empty`, `.gs-filter-bar`, etc. If a primitive exists, use it as-is. Only create a new `.gs-*` class when no existing component fits AND the new one is reusable across views. Component-scoped one-offs (like `.gs-pc-*`) are fine, but their internals must still compose existing primitives (e.g. action buttons inside a card use `.gs-btn .gs-btn-primary`, not a custom button).
- **Never hardcode colors** — use `--gs-*` tokens, never raw `--vscode-*` in view CSS
- **Never hardcode font sizes** — use `--gs-font-*` variables (xs/sm/base/md/lg/xl)
- **Never use font sizes below 11px**
- **Never use emoji in UI** — use Codicons (theme-aware, pixel-consistent)
- **4px spacing grid** — all spacing must be multiples of 4
- **`--gs-inset-x`** — horizontal padding for all sections (consistency)
- **Blend into VS Code** — extension should look native, not like an embedded web app
- For major UI changes, prototype in Pencil first before implementing in code
- Pencil mockups: `docs/pencil/ideas.pen`

## Code Style

- TypeScript strict mode — no `any` unless absolutely necessary
- Use VS Code API patterns: `Disposable`, `EventEmitter`, `TreeDataProvider`
- Webview JS is vanilla — no frameworks (React, Vue, etc.)
- CSS uses BEM-like class naming within each webview
- Keep webview HTML generation in provider `.ts` files, behavior in `media/webview/*.js`

## Git & Team Workflow

### Branches
- **Main branch:** `main` — stable release, synced by lead
- **Integration branch:** `develop` — all PRs target here
- Feature branches: `<author>-<feature>` (e.g. `hiru-uiux`, `slug-chat`)

### Rules
- PRs always target `develop` — never merge directly, always create PR
- **NEVER push directly to `main`** — `main` is protected. All changes to `main` MUST go through a Pull Request from `develop`. No exceptions, no force-push, no direct commits. Any team member who pushes directly to `main` without a PR will have the commit reverted.
- **NEVER push directly to `develop`** — all changes to `develop` MUST go through a Pull Request from a feature branch. No direct commits.
- Never force-push to any branch
- All git actions that modify remote state (commit, push, merge, create PR, delete branch) require explicit user confirmation before executing
- Commit messages: `type(scope): description` — types: `feat`, `fix`, `style`, `refactor`, `docs`, `test`, `chore`
- All docs, commit messages, PR descriptions, and code comments must be in English

### Community Contributors

For anyone outside the core team who wants to contribute:

1. **Do not push directly to `main` or `develop`** — these branches are reserved. Direct pushes will be reverted.
2. **Fork or branch workflow:**
   - Core team members: create a feature branch from `develop` (`git checkout -b <your-github-username>-<feature> develop`)
   - External contributors: fork the repo, make changes on a feature branch in your fork, then open a PR targeting `develop` on the main repo
3. **Branch naming:** `<your-github-username>-<short-description>` (e.g. `johndoe-fix-avatar`)
4. **PR checklist before opening:**
   - Branch is up to date with `develop` (`git pull origin develop`)
   - `npm run compile` passes with no errors
   - PR description explains what changed and why
   - All docs, commit messages, and comments are in English
5. **PRs are reviewed by the core team** — a maintainer will review and merge. Do not merge your own PR.
6. **Do not modify** `docs/contributors/` files — these are for core team members only.

### Role-Based Session Rules

**At every session start**, Claude MUST read `docs/contributors/ROLE-RULES.md` and follow the briefing protocol for the current user's role.

### Team Roles

| Username | Role |
|---|---|
| norwayishere | PO |
| Akemi0x | PO |
| slugmacro | FE |
| nakamoto-hiru | FE |
| cairo-cmd | FE |
| ryan | FE |
| ethanmiller0x | BE |
| vincent | BE |
| conal-cpu | Growth |
| amando | Growth |
| psychomafia-tiger | Growth |
| tiger | Growth |
| sarahxbt | Growth |
| leeknowsai | Advisor |

### Contributor Docs (`docs/contributors/[name].md`)
Each team member maintains their own status file:
- **Current** — branch, task, blockers, last updated date
- **Decisions** — date + what was decided and why (things git doesn't capture)

Rules:
- Filename: lowercase git username (e.g. `nakamoto-hiru.md`, `slugmacro.md`)
- Current section: overwrite each session (always latest state)
- Decisions section: append-only, one line per entry, date prefix
- Claude detects current user from `git config user.name`
- If "Last updated" is older than 3 days, warn user that context may be stale

### Announcement (`docs/contributors/announcement.md`)
A shared announcement file for broadcasting important updates to the whole team.

Rules:
- **Authorized writers only:** `norwayishere`, `Akemi0x`, `hiru` — only these three may write to or edit this file
- **All other contributors must NOT edit this file** — Claude must refuse or warn if any other contributor attempts to modify it
- Claude must check `git config user.name` to identify the current user before allowing any edit to `announcement.md`
- Format: date-prefixed entries, append-only (never delete past announcements)

### Session start
1. **Fetch & sync:** `git fetch origin` → pull latest `develop` → merge into working branch. If merge conflict: STOP and report, don't auto-resolve
2. **Team activity:** `git log --oneline -10 origin/develop` — flag commits touching UI/styles/components
3. **Recall context:** Read `docs/contributors/[current-user].md` — status, blockers, decisions
4. **Open PRs:** `gh pr list --state open` — flag reviews needed, conflicts, CI failures
5. **Suggest focus:** based on team changes, blockers, and last session context
6. **Report** in Vietnamese: branch status (ahead/behind), PRs, team changes, suggested focus
7. **Daily plan prompt:** Ask the user to state their plan for today and append it to their contributor file. Required fields:
   - Today's date
   - What they plan to work on
   - For each feature/task: **who they are collaborating with** (must not be left blank if working with others)

### Session end
1. Update `docs/contributors/[current-user].md` — current status + any decisions made
2. If uncommitted changes: ask user if they want to commit
3. If branch is ahead of develop: ask user if they want to create PR

### On commit/push
**IMPORTANT:** Contributor doc updates are tied to **push**, not commit:
- Do NOT update `docs/contributors/[current-user].md` on every commit
- **After each successful `git push`**, Claude MUST update `docs/contributors/[current-user].md`:
  - **Current section:** overwrite with latest branch, task, blockers, and today's date
  - **Decisions section:** append any new decisions made during this session
- The contributor doc update after push is a **separate commit** (do not bundle it with code commits)
