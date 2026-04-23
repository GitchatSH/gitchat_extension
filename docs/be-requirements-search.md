# BE Requirements — In-Chat Message Search

## 1. Search Endpoint — Add `user` filter param (extend existing)

`GET /messages/conversations/{id}/search`

Current params: `q`, `cursor`, `limit`

**Add:**
- `user` (string, optional) — Filter results by sender login
- `total` (response field, optional) — Total result count

**Response (unchanged structure):**
```json
{
  "messages": [...],
  "nextCursor": "abc123",
  "total": 42
}
```

## 2. Jump to Date — New endpoint

`GET /messages/conversations/{id}/messages?around_date={ISO date}`

Returns ~20 messages centered around the given date.

**Response shape:** Same as existing message list response:
```json
{
  "messages": [...],
  "hasMoreBefore": true,
  "hasMoreAfter": true,
  "previousCursor": "...",
  "nextCursor": "..."
}
```

## 3. Message Context — No changes needed

`GET /messages/conversations/{id}/messages/{messageId}/context` — Already exists and works.

## Priority

1. `user` filter on search — Low effort, high value
2. `total` count on search — Low effort, nice to have
3. `around_date` endpoint — Medium effort, needed for Jump to Date feature
