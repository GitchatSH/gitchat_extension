# Role-Based Session Rules

Claude reads this file at every session start to determine how to brief the current user.

## Step 1 — Read latest announcement

Read `docs/contributors/announcement.md` and surface the latest entry to the user at the top of every session briefing. Do this before anything else.

---

## Step 2 — Identify current user and role

Run `git config user.name` and look up their role in the Team Roles table in CLAUDE.md.

---

## Step 2 — Role-based briefing

### FE (slugmacro, nakamoto-hiru, cairo-cmd, ryan)

**Read in full:**
- All FE contributor docs: `slugmacro.md`, `nakamoto-hiru.md`, `cairo-cmd.md`, `ryan.md`
- Summarize each: current branch, task, blockers, last updated
- Flag any FE member whose "Last updated" is older than 3 days

**Read and summarize (2–3 sentences max):**
- Both BE contributor docs: `ethanmiller0x.md`, `vincent.md`
- Focus on: what they shipped recently, what endpoints/APIs they're currently changing, anything that may affect FE work

**Highlight specifically:**
- Any BE API contract changes (new/changed endpoints, payload shape changes) that FE needs to know about
- Any FE–BE blockers still open

**Before any UI work — remind FE dev:**
- Check `shared.css` first — reuse existing components (`.gs-btn*`, `.gs-input`, `.gs-avatar`, `.gs-row-item`, etc.) before creating anything new
- Never hardcode colors or font sizes — use `--gs-*` tokens only
- Full design rules in `CLAUDE.md` under Design & UI/UX

---

### BE (ethanmiller0x, vincent)

**Read in full:**
- Both BE contributor docs: `ethanmiller0x.md`, `vincent.md`
- Summarize each: current branch, task, blockers
- **File conflict check:** read each BE dev's current task, scan the codebase to identify likely affected files, cross-check for overlap — if overlap found, STOP and warn immediately before anything else

**Read and summarize (2–3 sentences max):**
- All FE contributor docs: `slugmacro.md`, `nakamoto-hiru.md`, `cairo-cmd.md`, `ryan.md`
- Focus on: what FE features are in progress that depend on BE, any open BE requirements docs

**Highlight specifically:**
- Any FE feature that is blocked waiting for a BE endpoint
- Any mismatch between what FE expects and what BE has shipped

---

### PO (norwayishere, Akemi0x)

**Read all contributor docs across all teams:**
- FE: `slugmacro.md`, `nakamoto-hiru.md`, `cairo-cmd.md`, `ryan.md`
- BE: `ethanmiller0x.md`, `vincent.md`
- Growth: `conal-cpu.md`, `amando.md`, `tiger.md`, `psychomafia-tiger.md`, `sarahxbt.md`
- Advisor: `leeknowsai.md`

**Report format (in Vietnamese):**
- Per team: 2–3 sentence summary of current status + any blockers
- Cross-team blockers: who is waiting on whom
- Anyone with "Last updated" older than 3 days → flag as stale

---

### Growth (conal-cpu, amando, tiger, psychomafia-tiger, sarahxbt) and Advisor (leeknowsai)

Same as PO — read all contributor docs across all teams and give a full team overview.

**Read all contributor docs across all teams:**
- FE: `slugmacro.md`, `nakamoto-hiru.md`, `cairo-cmd.md`, `ryan.md`
- BE: `ethanmiller0x.md`, `vincent.md`
- Growth: `conal-cpu.md`, `amando.md`, `tiger.md`, `psychomafia-tiger.md`, `sarahxbt.md`
- Advisor: `leeknowsai.md`

**Report format (in Vietnamese):**
- Per team: 2–3 sentence summary of current status + any blockers
- Cross-team blockers: who is waiting on whom
- Anyone with "Last updated" older than 3 days → flag as stale

---

## BE File Claim Rules

These rules apply to ethanmiller0x and vincent at all times.

**BE devs declare features, not files.** Claude does the file scanning.

**Step 1 — BE dev declares their task:**
- In the Current section of your contributor doc, write what feature/fix you are working on in plain terms
- Example: `**Task:** Fix group creation 403 — mutual follow gate logic`
- You do NOT need to list files — that is Claude's job

**Step 2 — Claude scans at session start:**
- When a BE dev starts a session, Claude reads both BE contributor docs to get each person's current task
- Claude then scans the codebase (`gitchat-webapp` backend) to identify which files each task is likely to touch
- Claude cross-checks: if both tasks point to overlapping files → warn immediately before the session continues

**Step 3 — If overlap is detected:**
- Claude reports: "Both you and @username are likely touching [file]. You must confirm on group chat before continuing."
- The BE dev MUST get confirmation from the other dev via group chat before proceeding — do not continue working until acknowledged

**`Working with:` is a feature-level tag, not a file-level tag:**
- Use `**Working with:** @username` only when two people are intentionally co-building the same feature together from the start
- It is NOT a workaround for an accidental file conflict — conflicts must go through group chat confirmation

**When done:**
- Update your contributor doc task to reflect what was shipped (this happens after push, per the push rule)

---

## Note on "dau phien" command

The `dau phien` command applies to all roles. However, BE devs often open a session without using it. The role-based briefing above applies regardless — Claude should run it automatically at session start by identifying the user from `git config user.name`.
