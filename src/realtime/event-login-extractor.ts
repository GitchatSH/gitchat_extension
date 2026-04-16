import { extractSenderLogin } from "./nudge";

/**
 * Given a WS event name + payload, return all user logins referenced. Used
 * by RealtimeClient to auto-watch presence for any user we see on the wire.
 * Returns deduplicated list; unknown events and malformed payloads → [].
 */
export function extractLoginsFromEvent(eventName: string, payload: unknown): string[] {
  if (!payload || typeof payload !== "object") { return []; }
  const p = payload as Record<string, unknown>;
  const data = (p.data ?? p) as Record<string, unknown>;
  const out = new Set<string>();

  switch (eventName) {
    case "message:sent": {
      const sender = extractSenderLogin(data);
      if (sender) { out.add(sender); }
      break;
    }
    case "conversation:read":
    case "typing:start":
    case "member:added":
    case "member:left":
    case "mention:new":
    case "reaction:new": {
      if (typeof data.login === "string" && data.login.length > 0) { out.add(data.login); }
      if (typeof data.addedBy === "string" && data.addedBy.length > 0) { out.add(data.addedBy); }
      break;
    }
    case "reaction:updated": {
      const reactions = data.reactions;
      if (Array.isArray(reactions)) {
        for (const r of reactions) {
          const ul = (r as Record<string, unknown>)?.user_login;
          if (typeof ul === "string" && ul.length > 0) { out.add(ul); }
        }
      }
      break;
    }
    default:
      return [];
  }
  return Array.from(out);
}
