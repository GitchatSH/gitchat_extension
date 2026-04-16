import * as assert from "assert";
import { extractLoginsFromEvent } from "../../realtime/event-login-extractor";

suite("extractLoginsFromEvent", () => {
  test("message:sent → sender", () => {
    assert.deepStrictEqual(
      extractLoginsFromEvent("message:sent", { data: { sender: "alice" } }),
      ["alice"],
    );
  });
  test("conversation:read → login", () => {
    assert.deepStrictEqual(
      extractLoginsFromEvent("conversation:read", { data: { login: "bob" } }),
      ["bob"],
    );
  });
  test("reaction:updated → reaction authors (deduped)", () => {
    assert.deepStrictEqual(
      extractLoginsFromEvent("reaction:updated", {
        data: { reactions: [{ user_login: "a" }, { user_login: "b" }, { user_login: "a" }] },
      }).sort(),
      ["a", "b"],
    );
  });
  test("member:added → login and addedBy", () => {
    assert.deepStrictEqual(
      extractLoginsFromEvent("member:added", { data: { login: "a", addedBy: "b" } }).sort(),
      ["a", "b"],
    );
  });
  test("unknown event → empty", () => {
    assert.deepStrictEqual(extractLoginsFromEvent("random:event", {}), []);
  });
  test("malformed payload → empty", () => {
    assert.deepStrictEqual(extractLoginsFromEvent("message:sent", null), []);
    assert.deepStrictEqual(extractLoginsFromEvent("message:sent", undefined), []);
  });
});
