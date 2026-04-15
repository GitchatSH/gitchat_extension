// Isolated mock layer for Profile Card fields that require BE work.
// Every export in this file is a temporary bridge — see strip paths in
// docs/superpowers/specs/2026-04-14-profile-card-design.md §11.

// ─── on_gitchat heuristic ────────────────────────────────────────────────
// TODO: REMOVE WHEN BE SHIPS on_gitchat field on /profile/:username (spec §10.1)
// Until BE ships the field, every user resolved via our API is assumed to be
// on GitChat. Override the blacklist below to exercise the not-on-gitchat
// state during manual testing.
export function mockOnGitchat(login: string): boolean {
  const FORCED_OFFLINE: string[] = [];
  return !FORCED_OFFLINE.includes(login);
}
