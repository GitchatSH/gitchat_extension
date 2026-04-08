import * as assert from "assert";

function groupMessages(messages: { id: string; sender_login: string; created_at: string; type?: string }[]) {
  const toDateStr = (d: string) => new Date(d).toDateString();
  return messages.map((msg, i) => {
    const prev = messages[i - 1];
    const next = messages[i + 1];
    const newDay = !prev || toDateStr(msg.created_at) !== toDateStr(prev.created_at);
    const sameSender = !!prev && !newDay && prev.sender_login === msg.sender_login
      && (new Date(msg.created_at).getTime() - new Date(prev.created_at).getTime()) <= 120000;
    const nextBreaks = !next || toDateStr(next.created_at) !== toDateStr(msg.created_at)
      || next.sender_login !== msg.sender_login
      || (new Date(next.created_at).getTime() - new Date(msg.created_at).getTime()) > 120000;
    const isFirst = !sameSender;
    const isLast = nextBreaks || !next || next.sender_login !== msg.sender_login;
    let groupPosition: "single" | "first" | "middle" | "last" = "single";
    if (!isFirst && !isLast) groupPosition = "middle";
    else if (!isFirst) groupPosition = "last";
    else if (!isLast) groupPosition = "first";
    return { ...msg, showDateSeparator: newDay, groupPosition };
  });
}

suite("groupMessages", () => {
  test("single message is 'single'", () => {
    const msgs = [{ id: "1", sender_login: "hiru", created_at: "2026-04-07T10:00:00Z" }];
    const result = groupMessages(msgs);
    assert.strictEqual(result[0].groupPosition, "single");
    assert.strictEqual(result[0].showDateSeparator, true);
  });

  test("two messages same sender within 2min → first + last", () => {
    const msgs = [
      { id: "1", sender_login: "hiru", created_at: "2026-04-07T10:00:00Z" },
      { id: "2", sender_login: "hiru", created_at: "2026-04-07T10:01:00Z" },
    ];
    const result = groupMessages(msgs);
    assert.strictEqual(result[0].groupPosition, "first");
    assert.strictEqual(result[1].groupPosition, "last");
  });

  test("three messages same sender within 2min → first + middle + last", () => {
    const msgs = [
      { id: "1", sender_login: "hiru", created_at: "2026-04-07T10:00:00Z" },
      { id: "2", sender_login: "hiru", created_at: "2026-04-07T10:00:30Z" },
      { id: "3", sender_login: "hiru", created_at: "2026-04-07T10:01:00Z" },
    ];
    const result = groupMessages(msgs);
    assert.strictEqual(result[0].groupPosition, "first");
    assert.strictEqual(result[1].groupPosition, "middle");
    assert.strictEqual(result[2].groupPosition, "last");
  });

  test("messages more than 2min apart → both single", () => {
    const msgs = [
      { id: "1", sender_login: "hiru", created_at: "2026-04-07T10:00:00Z" },
      { id: "2", sender_login: "hiru", created_at: "2026-04-07T10:03:00Z" },
    ];
    const result = groupMessages(msgs);
    assert.strictEqual(result[0].groupPosition, "single");
    assert.strictEqual(result[1].groupPosition, "single");
  });

  test("date boundary resets group", () => {
    const msgs = [
      { id: "1", sender_login: "hiru", created_at: "2026-04-06T23:59:00Z" },
      { id: "2", sender_login: "hiru", created_at: "2026-04-07T00:00:30Z" },
    ];
    const result = groupMessages(msgs);
    assert.strictEqual(result[0].groupPosition, "single");
    assert.strictEqual(result[1].groupPosition, "single");
    assert.strictEqual(result[1].showDateSeparator, true);
  });

  test("different senders → both single", () => {
    const msgs = [
      { id: "1", sender_login: "hiru", created_at: "2026-04-07T10:00:00Z" },
      { id: "2", sender_login: "slugmacro", created_at: "2026-04-07T10:00:30Z" },
    ];
    const result = groupMessages(msgs);
    assert.strictEqual(result[0].groupPosition, "single");
    assert.strictEqual(result[1].groupPosition, "single");
  });
});
