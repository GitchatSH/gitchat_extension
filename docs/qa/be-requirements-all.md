# BE Requirements — Tong hop tat ca FE can

**Updated:** 2026-04-13
**FE Branches:** `slug-layout-refactor`, `slug-search-scroll`

FE da code san tat ca features duoi day. Khi BE deploy xong, features tu dong bat — khong can FE deploy lai.

---

## P0 — Can gap (dang block features)

### 1. `unread_reactions_count` field

**Endpoint:** `GET /messages/conversations`

Them field vao conversation object:
```json
{
  "unread_reactions_count": 1
}
```

Logic: Dem so messages cua current_user co reaction voi `created_at > last_read_at`

**FE Impact:** Reaction heart button trong chat + sidebar indicator deu bi an vi khong co data

---

### 2. `last_read_message_id` field

**Endpoint:** `GET /messages/conversations`

Them field vao conversation object:
```json
{
  "last_read_message_id": "msg_abc"
}
```

**FE Impact:** Khong scroll duoc den dung vi tri unread khi mo chat (luon scroll xuong bottom)

---

### 3. `PATCH /messages/conversations/:id/read` — update last_read

Khi FE goi mark-read, BE can set:
- `last_read_message_id` = ID message moi nhat
- `unread_reactions_count` = 0

**FE Impact:** Neu khong update thi lan sau mo chat van khong biet scroll den dau

---

### 4. `GET /messages/conversations/:id/unread-reactions`

Endpoint moi — copy logic tu `/unread-mentions` (da working).

**Response:**
```json
{
  "data": {
    "message_ids": ["msg_xyz789", "msg_uvw456"]
  }
}
```

Logic: Messages ma `sender = current_user` va co reaction voi `created_at > last_read_at`. Sort theo `created_at` ASC.

**FE Impact:** FE da code san, chi can endpoint tra data la reaction button hoat dong

---

## P1 — Can co (features lam viec nhung chua tot)

### 5. Search — `user` filter param

**Endpoint:** `GET /messages/conversations/:id/search`

Them query param:
- `user` (string, optional) — Filter ket qua theo sender login

**Response:** Giu nguyen structure, them `total`:
```json
{
  "messages": [...],
  "nextCursor": "abc123",
  "total": 42
}
```

**FE Impact:** Hien tai FE fallback bang cach load 3 pages roi filter client-side — cham va thieu ket qua

---

### 6. Global Message Search

**Endpoint:** `GET /messages/search?q={query}&cursor={cursor}&limit={limit}`

Search across tat ca conversations cua user.

**Response:**
```json
{
  "data": {
    "messages": [
      {
        "id": "msg_123",
        "conversation_id": "conv_456",
        "sender_login": "alice",
        "sender_name": "Alice",
        "sender_avatar_url": "https://...",
        "body": "message content",
        "created_at": "2026-04-13T..."
      }
    ],
    "nextCursor": "abc123"
  }
}
```

**FE Impact:** Hien tai search inbox chi filter conversations client-side (theo ten + preview). Co endpoint nay thi search se giong Telegram — tim duoc moi message trong moi conversation.

---

## P2 — Nice to have

### 7. Jump to Date

**Endpoint:** `GET /messages/conversations/:id/messages?around_date={ISO date}`

Tra ve ~20 messages centered around ngay do.

**Response:** Giong message list response:
```json
{
  "messages": [...],
  "hasMoreBefore": true,
  "hasMoreAfter": true,
  "previousCursor": "...",
  "nextCursor": "..."
}
```

**FE Impact:** Calendar picker da co tren FE nhung chua call duoc endpoint

---

### 8. WebSocket events

| Event | Payload | FE Status |
|-------|---------|-----------|
| `mention:new` | `{ conversationId, messageId }` | FE da listen san, badge se update realtime |
| `reaction:new` | `{ conversationId, messageId }` | FE da listen san, badge se update realtime |

---

## Da co (confirmed working)

| Item | Status |
|------|--------|
| `unread_mentions_count` field | ✅ |
| `GET /conversations/:id/unread-mentions` | ✅ |
| `GET /conversations/:id/search?q=...` | ✅ (thieu `user` param) |
| `GET /conversations/:id/messages/:id/context` | ✅ |
| `PATCH /conversations/:id/read` | ✅ (thieu `last_read_message_id` update) |

---

## Tom tat: BE can lam gi?

| # | Priority | Effort | Item |
|---|----------|--------|------|
| 1 | P0 | Nho | Them `unread_reactions_count` vao conversation response |
| 2 | P0 | Nho | Them `last_read_message_id` vao conversation response |
| 3 | P0 | Nho | Update `PATCH .../read` de set `last_read_message_id` |
| 4 | P0 | Nho | Tao endpoint `GET .../unread-reactions` (copy tu unread-mentions) |
| 5 | P1 | Nho | Them `user` + `total` param cho search endpoint |
| 6 | P1 | Trung binh | Tao endpoint `GET /messages/search` (global search) |
| 7 | P2 | Trung binh | Tao endpoint `around_date` cho jump-to-date |
| 8 | P2 | Nho | Them WS events `mention:new` + `reaction:new` |
