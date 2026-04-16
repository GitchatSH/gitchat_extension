import * as assert from "assert";
import { extractSenderLogin } from "../../realtime/nudge";

suite("defensive nudge — extractSenderLogin", () => {
  test("reads top-level sender", () => {
    assert.strictEqual(extractSenderLogin({ sender: "alice" }), "alice");
  });
  test("reads senderLogin", () => {
    assert.strictEqual(extractSenderLogin({ senderLogin: "alice" }), "alice");
  });
  test("reads author.login", () => {
    assert.strictEqual(extractSenderLogin({ author: { login: "alice" } }), "alice");
  });
  test("reads from.login", () => {
    assert.strictEqual(extractSenderLogin({ from: { login: "alice" } }), "alice");
  });
  test("returns undefined for unknown shape", () => {
    assert.strictEqual(extractSenderLogin({}), undefined);
    assert.strictEqual(extractSenderLogin({ sender: 42 }), undefined);
    assert.strictEqual(extractSenderLogin(null), undefined);
    assert.strictEqual(extractSenderLogin(undefined), undefined);
  });
  test("prefers sender over author.login when both present", () => {
    assert.strictEqual(extractSenderLogin({ sender: "a", author: { login: "b" } }), "a");
  });
});
