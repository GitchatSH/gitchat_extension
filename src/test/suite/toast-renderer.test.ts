// src/test/suite/toast-renderer.test.ts
import * as assert from "assert";
import { selectRenderer } from "../../notifications/toast-renderer";

suite("selectRenderer", () => {
  test("visible + focused → webview", () => {
    assert.strictEqual(selectRenderer({ viewVisible: true, windowFocused: true }), "webview");
  });
  test("visible + unfocused → native", () => {
    assert.strictEqual(selectRenderer({ viewVisible: true, windowFocused: false }), "native");
  });
  test("hidden + focused → native", () => {
    assert.strictEqual(selectRenderer({ viewVisible: false, windowFocused: true }), "native");
  });
  test("hidden + unfocused → native", () => {
    assert.strictEqual(selectRenderer({ viewVisible: false, windowFocused: false }), "native");
  });
  test("fork-editor: focused === undefined treated as true", () => {
    assert.strictEqual(selectRenderer({ viewVisible: true, windowFocused: undefined }), "webview");
  });
  test("fork-editor: viewVisible===false overrides undefined focus", () => {
    assert.strictEqual(selectRenderer({ viewVisible: false, windowFocused: undefined }), "native");
  });
});
