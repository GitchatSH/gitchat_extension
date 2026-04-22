// src/test/suite/toast-stack-state.test.ts
import * as assert from "assert";
import {
  initialStackState,
  nextStack,
  MAX_CARDS,
} from "../../notifications/toast-stack-state";
import type { ToastSpec } from "../../notifications/toast-renderer";

function mkSpec(id: string, title = "T", body = "B"): ToastSpec {
  return {
    id, kind: "single", title, body,
    primary: { kind: "dismiss" }, notifIds: [],
  };
}

suite("nextStack", () => {
  test("push onto empty stack prepends", () => {
    const s = nextStack(initialStackState(), { kind: "push", spec: mkSpec("a"), now: 1 });
    assert.strictEqual(s.cards.length, 1);
    assert.strictEqual(s.cards[0].spec.id, "a");
    assert.strictEqual(s.cards[0].startedAt, 1);
  });

  test("push new id prepends to top (newest first)", () => {
    let s = nextStack(initialStackState(), { kind: "push", spec: mkSpec("a"), now: 1 });
    s = nextStack(s, { kind: "push", spec: mkSpec("b"), now: 2 });
    assert.deepStrictEqual(s.cards.map(c => c.spec.id), ["b", "a"]);
  });

  test("push existing id updates in place without reordering", () => {
    let s = nextStack(initialStackState(), { kind: "push", spec: mkSpec("a", "t1"), now: 1 });
    s = nextStack(s, { kind: "push", spec: mkSpec("b"), now: 2 });
    s = nextStack(s, { kind: "push", spec: mkSpec("a", "t2"), now: 3 });
    assert.deepStrictEqual(s.cards.map(c => c.spec.id), ["b", "a"]);
    const a = s.cards.find(c => c.spec.id === "a")!;
    assert.strictEqual(a.spec.title, "t2");
    assert.strictEqual(a.startedAt, 3); // timer reset
  });

  test("push at capacity evicts oldest (bottom)", () => {
    let s = initialStackState();
    s = nextStack(s, { kind: "push", spec: mkSpec("a"), now: 1 });
    s = nextStack(s, { kind: "push", spec: mkSpec("b"), now: 2 });
    s = nextStack(s, { kind: "push", spec: mkSpec("c"), now: 3 });
    assert.strictEqual(s.cards.length, MAX_CARDS);
    s = nextStack(s, { kind: "push", spec: mkSpec("d"), now: 4 });
    assert.strictEqual(s.cards.length, MAX_CARDS);
    assert.deepStrictEqual(s.cards.map(c => c.spec.id), ["d", "c", "b"]);
  });

  test("dismiss by id removes exact card", () => {
    let s = initialStackState();
    s = nextStack(s, { kind: "push", spec: mkSpec("a"), now: 1 });
    s = nextStack(s, { kind: "push", spec: mkSpec("b"), now: 2 });
    s = nextStack(s, { kind: "dismiss", id: "a" });
    assert.deepStrictEqual(s.cards.map(c => c.spec.id), ["b"]);
  });

  test("dismiss nonexistent id is a no-op", () => {
    let s = initialStackState();
    s = nextStack(s, { kind: "push", spec: mkSpec("a"), now: 1 });
    s = nextStack(s, { kind: "dismiss", id: "zzz" });
    assert.strictEqual(s.cards.length, 1);
  });

  test("reset clears all cards", () => {
    let s = initialStackState();
    s = nextStack(s, { kind: "push", spec: mkSpec("a"), now: 1 });
    s = nextStack(s, { kind: "push", spec: mkSpec("b"), now: 2 });
    s = nextStack(s, { kind: "reset" });
    assert.strictEqual(s.cards.length, 0);
  });
});
