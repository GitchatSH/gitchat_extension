// src/notifications/toast-renderer.ts

export type ToastKind = "single" | "digest" | "multi-digest";

export type ToastAction =
  | { kind: "openChat"; conversationId: string }
  | { kind: "openInbox" }
  | { kind: "openUrl"; url: string }
  | { kind: "markRead" }
  | { kind: "dismiss" };

export interface ToastSpec {
  id: string;
  kind: ToastKind;
  conversationId?: string;
  actorLogin?: string;
  actorName?: string;
  avatarUrl?: string;
  title: string;
  body: string;
  primary: ToastAction;
  secondary?: ToastAction;
  notifIds: string[];
}

export interface ToastRenderer {
  show(spec: ToastSpec): Promise<ToastAction>;
  dismiss(id: string): void;
  reset(): void;
}

export interface RouteContext {
  viewVisible: boolean;
  windowFocused: boolean | undefined;
}

export type RouteDecision = "webview" | "native";

export function selectRenderer(ctx: RouteContext): RouteDecision {
  // Prefer webview whenever the sidebar is visible — even if focus is in the
  // editor pane or another webview. Tester expectation: while the Chat sidebar
  // is open, new messages should render as in-webview toasts rather than the
  // OS-level native popup, which is visually inconsistent with the design.
  // Native renderer is the last-resort fallback for when the sidebar is
  // collapsed / a different view is active / window is minimized.
  //
  // Fork-editor fallback: treat undefined focus as true per spec §Routing.
  void ctx.windowFocused;
  if (ctx.viewVisible) { return "webview"; }
  return "native";
}
