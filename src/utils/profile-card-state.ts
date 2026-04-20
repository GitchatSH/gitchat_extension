/**
 * State machine for the Profile Card and Profile Screen primary action.
 *
 * Webview JS mirrors this logic — if you change the rules here, also update
 * `media/webview/profile-card.js::determineState` and
 * `media/webview/profile-screen.js` equivalent.
 */
export type ProfileCardState =
  | "self"
  | "not-on-gitchat"
  | "view-only"
  | "eligible"
  | "stranger";

export interface ProfileCardStateInput {
  is_self?: boolean;
  login: string;
  on_gitchat?: boolean;
  type?: "User" | "Organization";
  follow_status?: { following?: boolean };
}

export function getProfileCardState(
  data: ProfileCardStateInput,
  currentUser: string | null,
): ProfileCardState {
  if (data.is_self || data.login === currentUser) { return "self"; }
  if (!data.on_gitchat) { return "not-on-gitchat"; }
  // #112 — Organizations must not show a Message button. Ghost DM guard.
  if (data.type === "Organization") { return "view-only"; }
  const s = data.follow_status || {};
  if (s.following) { return "eligible"; }
  return "stranger";
}
