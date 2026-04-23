import * as assert from "assert";
import {
  BUCKET_COUNT_CAP,
  addMessageToBuckets,
  formatMultiBucketDigest,
  formatSingleBucketDigest,
  type ConversationBucket,
} from "../../notifications/toast-digest";
import type { Notification } from "../../types";

function makeNotification(
  overrides: Partial<Notification> & { preview?: string; conversationId?: string },
): Notification {
  const { preview, conversationId, ...rest } = overrides;
  return {
    id: overrides.id ?? `n-${Math.random().toString(36).slice(2, 8)}`,
    type: "new_message",
    actor_login: "alice",
    actor_name: "Alice",
    actor_avatar_url: null,
    is_read: false,
    created_at: new Date().toISOString(),
    metadata: {
      conversationId: conversationId ?? "c1",
      preview: preview ?? "",
    },
    ...rest,
  } as Notification;
}

suite("ToastDigest", () => {
  suite("addMessageToBuckets", () => {
    test("creates a new bucket for a first message", () => {
      const map = new Map<string, ConversationBucket>();
      addMessageToBuckets(
        map,
        makeNotification({
          preview: "hey",
          actor_avatar_url: "https://avatars/alice.png",
        }),
        "c1",
      );

      assert.strictEqual(map.size, 1);
      const bucket = map.get("c1")!;
      assert.strictEqual(bucket.count, 1);
      assert.strictEqual(bucket.latestActor, "Alice");
      assert.strictEqual(bucket.latestActorLogin, "alice");
      assert.strictEqual(bucket.latestPreview, "hey");
      assert.strictEqual(bucket.notifIds.length, 1);
    });

    test("refreshes latest avatar when sender changes", () => {
      const map = new Map<string, ConversationBucket>();
      addMessageToBuckets(
        map,
        makeNotification({
          actor_login: "alice",
          actor_name: "Alice",
          actor_avatar_url: "https://avatars/alice.png",
        }),
        "c1",
      );
      addMessageToBuckets(
        map,
        makeNotification({
          actor_login: "bob",
          actor_name: "Bob",
          actor_avatar_url: "https://avatars/bob.png",
        }),
        "c1",
      );

      const bucket = map.get("c1")!;
      assert.strictEqual(bucket.latestActorLogin, "bob");
    });

    test("increments count and refreshes preview on same-convo follow-ups", () => {
      const map = new Map<string, ConversationBucket>();
      addMessageToBuckets(
        map,
        makeNotification({ id: "n1", preview: "first" }),
        "c1",
      );
      addMessageToBuckets(
        map,
        makeNotification({ id: "n2", preview: "second" }),
        "c1",
      );
      addMessageToBuckets(
        map,
        makeNotification({ id: "n3", preview: "third" }),
        "c1",
      );

      const bucket = map.get("c1")!;
      assert.strictEqual(bucket.count, 3);
      assert.strictEqual(bucket.latestPreview, "third");
      assert.deepStrictEqual(bucket.notifIds, ["n1", "n2", "n3"]);
    });

    test("refreshes latest actor when sender changes in same group convo", () => {
      const map = new Map<string, ConversationBucket>();
      addMessageToBuckets(
        map,
        makeNotification({ actor_login: "alice", actor_name: "Alice" }),
        "c1",
      );
      addMessageToBuckets(
        map,
        makeNotification({ actor_login: "bob", actor_name: "Bob" }),
        "c1",
      );

      const bucket = map.get("c1")!;
      assert.strictEqual(bucket.latestActor, "Bob");
      assert.strictEqual(bucket.count, 2);
    });

    test("falls back to 'Someone' when no actor name or login", () => {
      const map = new Map<string, ConversationBucket>();
      addMessageToBuckets(
        map,
        makeNotification({ actor_name: "", actor_login: "" }),
        "c1",
      );

      assert.strictEqual(map.get("c1")!.latestActor, "Someone");
    });

    test("keeps per-conversation buckets separate", () => {
      const map = new Map<string, ConversationBucket>();
      addMessageToBuckets(
        map,
        makeNotification({ actor_name: "Alice" }),
        "c1",
      );
      addMessageToBuckets(
        map,
        makeNotification({ actor_name: "Bob" }),
        "c2",
      );

      assert.strictEqual(map.size, 2);
      assert.strictEqual(map.get("c1")!.count, 1);
      assert.strictEqual(map.get("c2")!.count, 1);
      assert.strictEqual(map.get("c1")!.latestActor, "Alice");
      assert.strictEqual(map.get("c2")!.latestActor, "Bob");
    });
  });

  suite("formatSingleBucketDigest", () => {
    test("count=1 shows actor without suffix", () => {
      const bucket: ConversationBucket = {
        conversationId: "c1",
        latestActor: "Alice",
        latestPreview: "hello",
        count: 1,
        notifIds: ["n1"],
      };
      assert.deepStrictEqual(formatSingleBucketDigest(bucket), {
        title: "Alice",
        body: "hello",
      });
    });

    test("count>1 shows '(+N-1)' suffix", () => {
      const bucket: ConversationBucket = {
        conversationId: "c1",
        latestActor: "Alice",
        latestPreview: "latest msg",
        count: 4,
        notifIds: ["n1", "n2", "n3", "n4"],
      };
      assert.strictEqual(formatSingleBucketDigest(bucket).title, "Alice (+3)");
    });

    test("count at cap shows '(20+ new)' suffix", () => {
      const bucket: ConversationBucket = {
        conversationId: "c1",
        latestActor: "Alice",
        latestPreview: "...",
        count: BUCKET_COUNT_CAP,
        notifIds: [],
      };
      assert.strictEqual(
        formatSingleBucketDigest(bucket).title,
        `Alice (${BUCKET_COUNT_CAP}+ new)`,
      );
    });

    test("count beyond cap still shows '(20+ new)'", () => {
      const bucket: ConversationBucket = {
        conversationId: "c1",
        latestActor: "Alice",
        latestPreview: "...",
        count: 57,
        notifIds: [],
      };
      assert.strictEqual(
        formatSingleBucketDigest(bucket).title,
        `Alice (${BUCKET_COUNT_CAP}+ new)`,
      );
    });

    test("empty preview returns empty body", () => {
      const bucket: ConversationBucket = {
        conversationId: "c1",
        latestActor: "Alice",
        latestPreview: "",
        count: 1,
        notifIds: ["n1"],
      };
      assert.strictEqual(formatSingleBucketDigest(bucket).body, "");
    });
  });

  suite("formatMultiBucketDigest", () => {
    test("two conversations, equal counts, picks first as latest", () => {
      const buckets: ConversationBucket[] = [
        {
          conversationId: "c1",
          latestActor: "Alice",
          latestPreview: "hi",
          count: 1,
          notifIds: ["a1"],
        },
        {
          conversationId: "c2",
          latestActor: "Bob",
          latestPreview: "yo",
          count: 1,
          notifIds: ["b1"],
        },
      ];
      const { title, body } = formatMultiBucketDigest(buckets);
      assert.strictEqual(title, "2 new messages in 2 chats");
      assert.strictEqual(body, "latest: Alice — hi");
    });

    test("picks the bucket with the most messages as latest", () => {
      const buckets: ConversationBucket[] = [
        {
          conversationId: "c1",
          latestActor: "Alice",
          latestPreview: "one",
          count: 1,
          notifIds: ["a1"],
        },
        {
          conversationId: "c2",
          latestActor: "Bob",
          latestPreview: "third msg",
          count: 3,
          notifIds: ["b1", "b2", "b3"],
        },
      ];
      const { title, body } = formatMultiBucketDigest(buckets);
      assert.strictEqual(title, "4 new messages in 2 chats");
      assert.strictEqual(body, "latest: Bob — third msg");
    });

    test("total at or above cap shows '20+' label", () => {
      const buckets: ConversationBucket[] = [
        {
          conversationId: "c1",
          latestActor: "Alice",
          latestPreview: "hi",
          count: 15,
          notifIds: [],
        },
        {
          conversationId: "c2",
          latestActor: "Bob",
          latestPreview: "yo",
          count: 10,
          notifIds: [],
        },
      ];
      assert.strictEqual(
        formatMultiBucketDigest(buckets).title,
        `${BUCKET_COUNT_CAP}+ new messages in 2 chats`,
      );
    });

    test("latest preview empty omits em-dash tail", () => {
      const buckets: ConversationBucket[] = [
        {
          conversationId: "c1",
          latestActor: "Alice",
          latestPreview: "",
          count: 1,
          notifIds: ["a1"],
        },
        {
          conversationId: "c2",
          latestActor: "Bob",
          latestPreview: "",
          count: 1,
          notifIds: ["b1"],
        },
      ];
      assert.strictEqual(formatMultiBucketDigest(buckets).body, "latest: Alice");
    });
  });
});
