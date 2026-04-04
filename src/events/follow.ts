import * as vscode from "vscode";

export interface FollowChangeEvent {
  username: string;
  following: boolean;
}

const _emitter = new vscode.EventEmitter<FollowChangeEvent>();

/** Subscribe to follow/unfollow events from any source */
export const onDidChangeFollow = _emitter.event;

/** Broadcast a follow state change so all UI components can sync */
export function fireFollowChanged(username: string, following: boolean): void {
  _emitter.fire({ username, following });
}

export function disposeFollowEvents(): void {
  _emitter.dispose();
}
