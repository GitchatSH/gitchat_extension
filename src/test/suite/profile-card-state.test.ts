import * as assert from "assert";
import { getProfileCardState } from "../../utils/profile-card-state";

suite("getProfileCardState", () => {
  test("returns 'self' when data.is_self is true", () => {
    assert.strictEqual(
      getProfileCardState({ is_self: true, login: "me", on_gitchat: true }, "other"),
      "self",
    );
  });

  test("returns 'self' when login matches currentUser", () => {
    assert.strictEqual(
      getProfileCardState({ login: "me", on_gitchat: true }, "me"),
      "self",
    );
  });

  test("returns 'not-on-gitchat' when on_gitchat is false", () => {
    assert.strictEqual(
      getProfileCardState({ login: "x", on_gitchat: false }, "me"),
      "not-on-gitchat",
    );
  });

  test("returns 'view-only' for Organization type", () => {
    assert.strictEqual(
      getProfileCardState(
        { login: "gitchatsh", on_gitchat: true, type: "Organization", follow_status: { following: true } },
        "me",
      ),
      "view-only",
    );
  });

  test("returns 'eligible' for followed User", () => {
    assert.strictEqual(
      getProfileCardState(
        { login: "alice", on_gitchat: true, type: "User", follow_status: { following: true } },
        "me",
      ),
      "eligible",
    );
  });

  test("returns 'stranger' for not-followed User", () => {
    assert.strictEqual(
      getProfileCardState(
        { login: "bob", on_gitchat: true, type: "User", follow_status: { following: false } },
        "me",
      ),
      "stranger",
    );
  });

  test("Organization check takes precedence over follow status", () => {
    assert.strictEqual(
      getProfileCardState(
        { login: "gitchatsh", on_gitchat: true, type: "Organization", follow_status: { following: true } },
        "me",
      ),
      "view-only",
    );
  });
});
