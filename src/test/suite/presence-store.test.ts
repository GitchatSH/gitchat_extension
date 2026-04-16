import * as assert from "assert";
import { PresenceStore } from "../../realtime/presence-store";

suite("PresenceStore", () => {
  test("set + get returns entry", () => {
    const store = new PresenceStore();
    store.set("alice", { online: true, lastSeenAt: "2026-04-16T10:00:00Z" });
    assert.deepStrictEqual(store.get("alice"), { online: true, lastSeenAt: "2026-04-16T10:00:00Z" });
  });

  test("set fires onChange when value changes", () => {
    const store = new PresenceStore();
    let fired = 0;
    store.onChange(() => fired++);
    store.set("alice", { online: true, lastSeenAt: null });
    assert.strictEqual(fired, 1);
  });

  test("set is deduped when value unchanged", () => {
    const store = new PresenceStore();
    let fired = 0;
    store.set("alice", { online: true, lastSeenAt: null });
    store.onChange(() => fired++);
    store.set("alice", { online: true, lastSeenAt: null });
    assert.strictEqual(fired, 0);
  });

  test("bulkSet fires per changed entry", () => {
    const store = new PresenceStore();
    let fired = 0;
    store.onChange(() => fired++);
    store.bulkSet({
      alice: { online: true, lastSeenAt: null },
      bob: { online: false, lastSeenAt: null },
    });
    assert.strictEqual(fired, 2);
  });

  test("snapshot returns plain object copy", () => {
    const store = new PresenceStore();
    store.set("alice", { online: true, lastSeenAt: null });
    const snap = store.snapshot();
    assert.deepStrictEqual(snap, { alice: { online: true, lastSeenAt: null } });
    delete (snap as { alice?: unknown }).alice;
    assert.ok(store.get("alice"));
  });

  test("LRU evicts oldest at cap and fires onEvict", () => {
    const store = new PresenceStore({ maxEntries: 3 });
    const unwatched: string[] = [];
    store.onEvict((login) => unwatched.push(login));
    store.set("a", { online: true, lastSeenAt: null });
    store.set("b", { online: true, lastSeenAt: null });
    store.set("c", { online: true, lastSeenAt: null });
    store.set("d", { online: true, lastSeenAt: null });
    assert.deepStrictEqual(unwatched, ["a"]);
    assert.strictEqual(store.get("a"), undefined);
  });
});
