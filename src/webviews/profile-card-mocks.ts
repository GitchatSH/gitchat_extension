// Isolated mock layer for Profile Card fields that require BE work.
// Every export in this file is a temporary bridge — see strip paths in
// docs/superpowers/specs/2026-04-14-profile-card-design.md §11.

import type * as vscode from "vscode";

// TODO: REMOVE WHEN BE SHIPS on_gitchat field on /profile/:username (spec §10.1)
export function mockOnGitchat(login: string): boolean {
  void login;
  return true;
}

// TODO: REMOVE WHEN BE SHIPS POST /waves (spec §10.2)
export interface WaveMockStore {
  hasWaved(target: string): boolean;
  markWaved(target: string): void;
}

export function createWaveMockStore(_ctx: vscode.ExtensionContext): WaveMockStore {
  return {
    hasWaved: () => false,
    markWaved: () => undefined,
  };
}
