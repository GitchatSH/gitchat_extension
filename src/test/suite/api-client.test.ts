import * as assert from "assert";
import { formatCount, timeAgo } from "../../utils";

suite("Utils", () => {
  suite("formatCount", () => {
    test("formats numbers below 1000 as-is", () => {
      assert.strictEqual(formatCount(0), "0");
      assert.strictEqual(formatCount(999), "999");
    });

    test("formats thousands with k suffix", () => {
      assert.strictEqual(formatCount(1000), "1.0k");
      assert.strictEqual(formatCount(12500), "12.5k");
    });

    test("formats millions with M suffix", () => {
      assert.strictEqual(formatCount(1000000), "1.0M");
      assert.strictEqual(formatCount(2500000), "2.5M");
    });
  });

  suite("timeAgo", () => {
    test("returns 'just now' for recent dates", () => {
      const now = new Date().toISOString();
      assert.strictEqual(timeAgo(now), "just now");
    });

    test("returns minutes for dates within an hour", () => {
      const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      assert.strictEqual(timeAgo(tenMinAgo), "10m ago");
    });

    test("returns hours for dates within a day", () => {
      const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
      assert.strictEqual(timeAgo(threeHoursAgo), "3h ago");
    });

    test("returns days for dates within a month", () => {
      const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
      assert.strictEqual(timeAgo(fiveDaysAgo), "5d ago");
    });
  });
});
