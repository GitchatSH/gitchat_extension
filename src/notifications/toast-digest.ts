import type { Notification } from "../types";

export const BUCKET_COUNT_CAP = 20;

export interface ConversationBucket {
  conversationId: string;
  latestActor: string;
  latestPreview: string;
  count: number;
  notifIds: string[];
}

export interface FormattedToast {
  title: string;
  body: string;
}

/**
 * Fold a new chat notification into the pending bucket map. If a bucket for
 * the conversation already exists, increment and refresh its latest actor +
 * preview. Otherwise create a new bucket with count 1.
 */
export function addMessageToBuckets(
  map: Map<string, ConversationBucket>,
  notification: Notification,
  conversationId: string,
): void {
  const actor = notification.actor_name || notification.actor_login || "Someone";
  const preview =
    (notification.metadata as Record<string, unknown> | undefined)?.preview as
      | string
      | undefined ?? "";
  const existing = map.get(conversationId);
  if (existing) {
    existing.count += 1;
    existing.latestActor = actor;
    existing.latestPreview = preview;
    existing.notifIds.push(notification.id);
  } else {
    map.set(conversationId, {
      conversationId,
      latestActor: actor,
      latestPreview: preview,
      count: 1,
      notifIds: [notification.id],
    });
  }
}

/**
 * Format a single-conversation digest toast.
 *   count=1  → "Alice": "preview"
 *   count>1  → "Alice (+2)": "latest preview"
 *   count≥20 → "Alice (20+ new)": "latest preview"
 */
export function formatSingleBucketDigest(bucket: ConversationBucket): FormattedToast {
  let countSuffix = "";
  if (bucket.count >= BUCKET_COUNT_CAP) {
    countSuffix = ` (${BUCKET_COUNT_CAP}+ new)`;
  } else if (bucket.count > 1) {
    countSuffix = ` (+${bucket.count - 1})`;
  }
  return {
    title: `${bucket.latestActor}${countSuffix}`,
    body: bucket.latestPreview,
  };
}

/**
 * Format a multi-conversation digest toast. Picks the bucket with the most
 * messages as "latest" for the body line. Total count is capped at 20+.
 */
export function formatMultiBucketDigest(buckets: ConversationBucket[]): FormattedToast {
  const totalCount = buckets.reduce((acc, b) => acc + b.count, 0);
  const latest = buckets.reduce((a, b) =>
    b.notifIds.length > a.notifIds.length ? b : a,
  );
  const countLabel =
    totalCount >= BUCKET_COUNT_CAP ? `${BUCKET_COUNT_CAP}+` : `${totalCount}`;
  const bodyTail = latest.latestPreview ? ` — ${latest.latestPreview}` : "";
  return {
    title: `${countLabel} new messages in ${buckets.length} chats`,
    body: `latest: ${latest.latestActor}${bodyTail}`,
  };
}
