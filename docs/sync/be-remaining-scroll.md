# BE Remaining: Scroll System — Cai gi con thieu?

**Updated:** 2026-04-10
**FE Branch:** `slug-scroll` — da integrate xong, dang test

---

## Da co (confirmed working)

| Item | Status |
|------|--------|
| `unread_mentions_count` field | ✅ FE da nhan duoc, @ button hien dung |
| `GET /conversations/:id/unread-mentions` | ✅ Tra ve message_ids, FE cycle dung |

---

## Chua co / Chua verify

### P0 — Can gap

| # | Item | Mo ta | FE Impact |
|---|------|-------|-----------|
| 1 | `unread_reactions_count` field | Tra ve so luong messages cua user co reaction moi chua xem. Hien tai field nay = 0 hoac khong co -> FE an reaction button | **Reaction heart button trong chat + sidebar ❤️ indicator deu bi an** |
| 2 | `last_read_message_id` field | ID message cuoi cung user da doc. Tra ve trong `GET /conversations` | **FE khong scroll duoc den dung vi tri unread khi mo chat** |
| 3 | `PATCH /conversations/:id/read` update | Khi FE goi mark-read, BE can set `last_read_message_id` = message moi nhat | **Neu khong update thi lan sau mo chat van khong biet scroll den dau** |

### P1 — Can co

| # | Item | Mo ta | FE Impact |
|---|------|-------|-----------|
| 4 | `GET /conversations/:id/unread-reactions` | Tra ve array message_ids co reaction moi. Format giong `/unread-mentions` | **FE da code san, chi can endpoint tra data la reaction button hoat dong** |

### P2 — Nice to have

| # | Item | Mo ta | FE Impact |
|---|------|-------|-----------|
| 5 | WS event `mention:new` | `{ conversationId, messageId }` khi co mention moi | FE da listen san, badge se update realtime |
| 6 | WS event `reaction:new` | `{ conversationId, messageId }` khi co reaction moi | FE da listen san, badge se update realtime |

---

## Response format can thiet

### `GET /conversations` — conversation object can them:

```json
{
  "id": "conv_123",
  "unread_count": 5,
  "unread_mentions_count": 2,      // ← da co
  "unread_reactions_count": 1,      // ← THIEU
  "last_read_message_id": "msg_abc", // ← THIEU
  "is_muted": false
}
```

### `GET /conversations/:id/unread-reactions` — format giong unread-mentions:

```json
{
  "data": {
    "message_ids": ["msg_xyz789", "msg_uvw456"]
  }
}
```

Logic:
- Messages ma `sender = current_user` va co reaction voi `created_at > last_read_at`
- Sort theo `created_at` ASC (cu nhat truoc)

---

## Tom tat: BE can lam 4 viec

1. ❗ Them `unread_reactions_count` vao conversation response
2. ❗ Them `last_read_message_id` vao conversation response
3. ❗ Update `PATCH .../read` de set `last_read_message_id`
4. ❗ Tao endpoint `GET .../unread-reactions` (copy logic tu unread-mentions)

FE da san sang — khi BE deploy xong, tat ca features tu dong bat.
