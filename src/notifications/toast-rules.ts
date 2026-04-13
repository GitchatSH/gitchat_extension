import type { Notification } from "../types";

export interface ToastDecision {
  show: boolean;
  reason: string;
}

export interface ToastContext {
  type: string;
  conversationId?: string;
  actorLogin?: string;
  isChatOpen: boolean;
  isMuted: boolean;
  doNotDisturb: boolean;
  isOwnActor: boolean;
  conversationKind?: "dm" | "group" | "community" | "team";
  configs: {
    showMessageNotifications: boolean;
    showMentionNotifications: boolean;
    showWaveNotifications: boolean;
  };
}

export function decideToast(ctx: ToastContext): ToastDecision {
  if (ctx.isOwnActor) { return { show: false, reason: "own actor" }; }
  if (ctx.doNotDisturb) { return { show: false, reason: "DND on" }; }

  switch (ctx.type) {
    case "mention":
      if (!ctx.configs.showMentionNotifications) { return { show: false, reason: "mention toasts disabled" }; }
      return { show: true, reason: "mention always toasts" };

    case "wave":
      if (!ctx.configs.showWaveNotifications) { return { show: false, reason: "wave toasts disabled" }; }
      return { show: true, reason: "wave toasts" };

    case "new_message":
      if (!ctx.configs.showMessageNotifications) { return { show: false, reason: "message toasts disabled" }; }
      if (ctx.isChatOpen) { return { show: false, reason: "chat already open" }; }
      if (ctx.isMuted) { return { show: false, reason: "conversation muted" }; }
      if (ctx.conversationKind === "community" || ctx.conversationKind === "team") {
        return { show: false, reason: "community/team messages only badge, no toast" };
      }
      return { show: true, reason: "dm/group toast" };

    case "follow":
      return { show: false, reason: "follow only in list" };

    case "repo_activity":
      return { show: false, reason: "repo activity only inline in WP7 chat" };

    default:
      return { show: false, reason: `unknown type: ${ctx.type}` };
  }
}

export function describeNotification(notification: Notification): { title: string; body: string } {
  const actor = notification.actor_name || notification.actor_login || "Someone";
  const meta = notification.metadata ?? {};

  switch (notification.type) {
    case "mention":
      return {
        title: `${actor} mentioned you`,
        body: meta.preview || "",
      };
    case "wave":
      return { title: `${actor} waved at you`, body: "Tap to say hi back" };
    case "new_message":
      return { title: actor, body: meta.preview || "" };
    case "follow":
      return { title: `${actor} followed you`, body: "" };
    case "repo_activity": {
      const repo = meta.repoFullName || "a repo";
      const evt = meta.eventType || "activity";
      return { title: `${repo} — ${evt}`, body: meta.title || "" };
    }
    default:
      return { title: actor, body: "" };
  }
}
