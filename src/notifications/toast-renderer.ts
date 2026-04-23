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
  // Fork-editor fallback: treat undefined focus as true per spec §Routing
  const focused = ctx.windowFocused ?? true;
  if (ctx.viewVisible && focused) { return "webview"; }
  return "native";
}
