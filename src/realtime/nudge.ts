/**
 * Extract a sender login from a message payload. Backend payload shape has
 * drifted historically (sender | senderLogin | author.login | from.login).
 * Returns undefined if nothing looks like a valid non-empty login string.
 */
export function extractSenderLogin(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const p = payload as Record<string, unknown>;
  const candidates: unknown[] = [
    p.sender,
    p.senderLogin,
    (p.author as Record<string, unknown> | undefined)?.login,
    (p.from as Record<string, unknown> | undefined)?.login,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.length > 0) return c;
  }
  return undefined;
}
