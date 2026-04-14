# Backend Requirements: Telegram Scroll System

**FE Branch:** `slug-scroll`
**FE Status:** Done — all features implemented with graceful fallback. Khi BE add fields/endpoints, FE tự động enable features tương ứng.
**Priority:** High — ảnh hưởng trực tiếp đến chat UX

---

## 1. New fields trên Conversation object

Thêm 3 fields vào response của `GET /messages/conversations`:

| Field | Type | Mô tả |
|-------|------|--------|
| `last_read_message_id` | `string \| null` | ID của message cuối cùng user đã đọc. `null` nếu chưa đọc message nào. Update mỗi khi FE gọi `PATCH /messages/conversations/:id/read` |
| `unread_mentions_count` | `number` | Số lượng messages có @mention đến user mà user chưa đọc. Reset về 0 khi mark-as-read |
| `unread_reactions_count` | `number` | Số lượng messages mà user bị react (reaction trên message của user) mà user chưa xem. Reset về 0 khi mark-as-read |

**Hiện tại đã có:**
- `unread_count` — OK
- `is_muted` — OK (đang dùng nhưng chưa có trong TypeScript type, FE đã fix)

---

## 2. New endpoints

### `GET /messages/conversations/:id/unread-mentions`

Trả về danh sách message IDs có @mention đến current user mà chưa đọc.

**Response:**
```json
{
  "data": {
    "message_ids": ["msg_abc123", "msg_def456", "msg_ghi789"]
  }
}
```

**Logic:**
- Scan messages trong conversation có chứa `@{current_user_login}` trong content
- Chỉ trả về messages có `created_at` > `last_read_at` của user trong conversation
- Sort theo `created_at` ASC (oldest first — FE cycle từ cũ đến mới)
- Không cần pagination (thường chỉ có vài mentions chưa đọc)

---

### `GET /messages/conversations/:id/unread-reactions`

Trả về danh sách message IDs của current user mà có reaction mới chưa xem.

**Response:**
```json
{
  "data": {
    "message_ids": ["msg_xyz789", "msg_uvw456"]
  }
}
```

**Logic:**
- Scan messages trong conversation mà `sender = current_user`
- Chỉ trả về messages có reaction mới (reaction `created_at` > `last_read_at` của user)
- Sort theo reaction `created_at` ASC (oldest first)
- Không cần pagination

---

## 3. Update `PATCH /messages/conversations/:id/read`

Endpoint này đã có. Cần update thêm:

- Set `last_read_message_id` = ID của message mới nhất trong conversation tại thời điểm gọi
- Reset `unread_mentions_count` = 0
- Reset `unread_reactions_count` = 0

---

## 4. WebSocket events (nice-to-have, không bắt buộc)

Nếu có thể, push realtime update khi:

| Event | Payload | Khi nào |
|-------|---------|---------|
| `mention:new` | `{ conversationId, messageId }` | Có message mới mention đến user |
| `reaction:new` | `{ conversationId, messageId }` | Có reaction mới trên message của user |

FE sẽ update badge mention/reaction button realtime. Nếu chưa có WebSocket events, FE sẽ fetch từ endpoints khi mở conversation.

---

## Tóm tắt ưu tiên

| # | Item | Priority | Lý do |
|---|------|----------|-------|
| 1 | `last_read_message_id` field | **P0** | Cần để scroll đến đúng vị trí unread khi mở chat |
| 2 | `unread_mentions_count` field | **P1** | Enable mention @ button trong chat |
| 3 | `unread_reactions_count` field | **P1** | Enable reaction button trong chat |
| 4 | `GET .../unread-mentions` endpoint | **P1** | Cần để FE biết jump đến message nào |
| 5 | `GET .../unread-reactions` endpoint | **P1** | Tương tự |
| 6 | Update `PATCH .../read` | **P0** | Cần để track `last_read_message_id` |
| 7 | WebSocket events | **P2** | Nice-to-have, FE đã có fallback |
