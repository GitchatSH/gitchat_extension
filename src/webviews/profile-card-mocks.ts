// Isolated mock layer for Profile Card fields that require BE work.
// Every export in this file is a temporary bridge — see strip paths in
// docs/superpowers/specs/2026-04-14-profile-card-design.md §11.

import type * as vscode from "vscode";

// ─── on_gitchat heuristic ────────────────────────────────────────────────
// TODO: REMOVE WHEN BE SHIPS on_gitchat field on /profile/:username (spec §10.1)
// Until BE ships the field, every user resolved via our API is assumed to be
// on GitChat. Override the blacklist below to exercise the not-on-gitchat
// state during manual testing.
export function mockOnGitchat(login: string): boolean {
  const FORCED_OFFLINE: string[] = [];
  return !FORCED_OFFLINE.includes(login);
}

// ─── Wave client-side store ──────────────────────────────────────────────
// TODO: REMOVE WHEN BE SHIPS POST /waves (spec §10.2)
// Mirrors the eventual BE rate limit (1 wave per target per sender lifetime)
// by tracking sent waves in the extension's globalState. Recipients never
// actually receive anything until BE ships the endpoint.
export interface WaveMockStore {
  hasWaved(target: string): boolean;
  markWaved(target: string): void;
}

const WAVE_STATE_KEY = "profileCard.wavesSent";

export function createWaveMockStore(ctx: vscode.ExtensionContext): WaveMockStore {
  return {
    hasWaved(target: string): boolean {
      const sent = ctx.globalState.get<string[]>(WAVE_STATE_KEY, []);
      return sent.includes(target);
    },
    markWaved(target: string): void {
      const sent = ctx.globalState.get<string[]>(WAVE_STATE_KEY, []);
      if (!sent.includes(target)) {
        sent.push(target);
        void ctx.globalState.update(WAVE_STATE_KEY, sent);
      }
    },
  };
}
