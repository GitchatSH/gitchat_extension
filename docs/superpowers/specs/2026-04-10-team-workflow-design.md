# Team Workflow via CLAUDE.md — Design Spec

**Date:** 2026-04-10
**Author:** nakamoto-hiru
**Status:** Approved

## Problem

Team of 5-6 members all using Claude Code on the same repo. No shared context system — Claude doesn't know what others are working on, no session rituals enforced, status tracked externally in CRM.

## Goals

- Claude understands team context from repo files (not external tools)
- Each member's Claude session knows what that person is working on + what team did recently
- Consistent session start/end rituals defined in CLAUDE.md (no separate skills needed)
- Lead controls project rules/priorities, members self-manage status
- All git actions require user confirmation before executing

## Design Decisions

- **Approach:** Add `Team Workflow` section to existing CLAUDE.md (Approach 2 — single source of truth, auto-loaded by Claude)
- **User docs format:** Status + Decisions (Approach B — enough context without noise)
- **Session enforcement:** Rules in CLAUDE.md, no shared skills (Approach C — Claude reads rules and interprets "dau phien"/"ket phien")
- **CLAUDE.md ownership:** Lead updates rules/priorities, members update only their own `docs/contributors/[name].md`
- **Staleness detection:** `Last updated` field + 3-day warning threshold

## Changes to CLAUDE.md

### 1. Add `Team Workflow` section (after existing `Git Workflow`)

```markdown
## Team Workflow

### Branches
- `develop` — integration branch, all PRs target here
- `main` — stable release, synced from develop by lead
- Feature branches: `<author>-<feature>` (e.g. `hiru-uiux`, `slug-chat`)

### Git Safety
All git actions that modify remote state (commit, push, merge, create PR, delete branch)
require explicit user confirmation before executing. Report what will be done, wait for approval.

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

### Session: "dau phien" (start session)
1. `git fetch origin`
2. `git log --oneline -10 origin/develop` — report recent team activity
3. Read `docs/contributors/[current-user].md` — recall context
4. Report: who did what, current branch status (ahead/behind develop), any conflicts
5. Let user decide whether to sync develop

### Session: "ket phien" (end session)
1. Update `docs/contributors/[current-user].md` — current status + any decisions made
2. If uncommitted changes: ask user if they want to commit
3. If branch is ahead of develop: ask user if they want to create PR

### On commit/push
Before committing or creating PR, update `docs/contributors/[current-user].md` first.
```

### 2. Update `Git Workflow` section

Replace current content with pointer to Team Workflow:

```markdown
## Git Workflow

- **Main branch:** `main`
- **Integration branch:** `develop`
- See [Team Workflow](#team-workflow) for branch conventions and session rules
```

### 3. Update `Project Structure`

Add `docs/contributors/` to the structure listing.

## User Doc Template

File: `docs/contributors/[git-username].md`

```markdown
# [Display Name]

## Current
- **Branch:** (branch name)
- **Working on:** (current task)
- **Blockers:** None
- **Last updated:** YYYY-MM-DD

## Decisions
- YYYY-MM-DD: (what was decided and why)
```

## Files to create/modify

1. **Modify:** `CLAUDE.md` — add Team Workflow section, update Git Workflow, update Project Structure
2. **Create:** `docs/contributors/nakamoto-hiru.md` — seed with current status as example
3. **Create:** `docs/contributors/` directory

## Out of scope

- Shared skills (`.claude/skills/`) — may add later if CLAUDE.md rules prove inconsistent
- Cross-review of user docs — self-managed for now
- Automated staleness notifications — Claude warns manually based on date check
- Template for other repos — pilot this repo first, generalize later
