# Bug #31 — Seen avatars hiển thị sai user (handoff)

> Issue: [#31 Seen avatars show incorrect users not in the conversation](https://github.com/GitchatSH/top-github-trending/issues/31)
> Evidence bổ sung: [#32](https://github.com/GitchatSH/top-github-trending/issues/32) — bug lặp cả ở DM với recipient offline.
> Introduced in commit `a59fb76` — feat(chat): add Telegram-style seen avatars.

## 1. Hiện tượng

- Group chat: avatar "seen" hiển thị user **không thuộc conversation**, số lượng avatar không khớp số người thật sự đã đọc.
- DM: dù recipient đang **offline** (không thể đọc), tin nhắn vẫn render avatar "seen" cạnh `✓✓`.

## 2. Root cause — relay WebSocket không filter theo conversationId

**File:** `src/webviews/explore.ts`
**Lines:** 1695–1699

```ts
realtimeClient.onConversationRead((data) => {
  if (exploreWebviewProvider._activeChatConvId) {     // ← chỉ check "có chat đang mở"
    exploreWebviewProvider.postToWebview({ type: "chat:conversationRead", payload: data });
  }
});
```

So sánh với các handler cùng file:

| Handler | Line | Check | Đúng? |
|---|---|---|---|
| `onMessagePinned` | 1700 | `data.conversationId === _activeChatConvId` | ✅ |
| `onMessageUnpinned` | 1705 | `data.conversationId === _activeChatConvId` | ✅ |
| `onMentionNew` | 1710 | `data.conversationId === _activeChatConvId` | ✅ |
| `onReactionNew` | 1715 | `data.conversationId === _activeChatConvId` | ✅ |
| **`onConversationRead`** | **1695** | chỉ `_activeChatConvId` tồn tại | ❌ |
| `onReactionUpdated` | 1690 | chỉ `_activeChatConvId` tồn tại | ❌ (lỗi phụ) |

### Luồng gây bug

1. User đang mở DM với @norwayiscoming (offline).
2. Một conversation khác (conv Y) nhận read event — ai đó trong conv Y vừa đọc.
3. WebSocket bắn `conversationRead` với `{ conversationId: Y, login: someoneElse, readAt }`.
4. `explore.ts:1695` forward vào webview **không kiểm tra `data.conversationId`** → webview nghĩ event này cho chat đang mở.
5. `sidebar-chat.js:3835` (`case 'conversationRead'`) ghi `_state.seenMap["someoneElse"] = { readAt }`.
6. `refreshSeenAvatars()` (`sidebar-chat.js:730`) render avatar @someoneElse trên outgoing message của DM hiện tại.

Giải thích trọn vẹn cả hai hiện tượng:
- **Avatar user lạ** — do state bị đổ data read từ conv khác.
- **DM với recipient offline vẫn show seen** — vì người đọc thật sự là user của conv khác, không phải recipient.

## 3. Các lỗi phụ (nên fix cùng để defensive)

### 3.1. Handler `conversationRead` không validate `readLogin`
**File:** `media/webview/sidebar-chat.js`
**Lines:** 3835–3848

```js
case 'conversationRead': {
  var readAt = payload.readAt;
  var readLogin = payload.login || _state.otherLogin;  // ← fallback nguy hiểm
  if (!readAt) break;
  _state.otherReadAt = readAt;
  if (readLogin) {
    var existingEntry = _state.seenMap[readLogin];
    _state.seenMap[readLogin] = { ... };               // ← không check readLogin thuộc members
  }
  ...
}
```

Vấn đề:
- Không kiểm tra `readLogin` có thuộc `_state.groupMembers` (group) hoặc bằng `_state.otherLogin` (DM).
- Fallback `payload.login || _state.otherLogin` gán nhầm tên recipient khi payload thiếu login → DM luôn hiện seen bởi "người kia" dù event thực sự không phải từ họ.

### 3.2. Init build `seenMap` không filter theo participants
**File:** `media/webview/sidebar-chat.js`
**Lines:** 3667–3672

```js
if (payload.readReceipts && payload.readReceipts.length) {
  payload.readReceipts.forEach(function(r) {
    if (r.login && r.readAt) {
      _state.seenMap[r.login] = { ... };   // ← không check r.login ∈ groupMembers
    }
  });
}
```

Nếu server trả receipts stale (user đã rời group / receipts của conv khác), avatar vẫn render.

### 3.3. `otherReadAt` fallback giữ giá trị conversation cũ
**File:** `media/webview/sidebar-chat.js`
**Line:** 3661

```js
_state.otherReadAt = payload.otherReadAt || _state.otherReadAt;
```

Dùng `||` → nếu payload mới không có `otherReadAt`, giá trị conv trước đó vẫn leak sang conv mới. Phải gán trực tiếp từ payload (fallback `null`).

## 4. Giải pháp

### 4.1. Fix chính — `src/webviews/explore.ts:1695`

```ts
realtimeClient.onConversationRead((data) => {
  if (data.conversationId === exploreWebviewProvider._activeChatConvId) {
    exploreWebviewProvider.postToWebview({ type: "chat:conversationRead", payload: data });
  }
});
```

### 4.2. Fix kèm — `src/webviews/explore.ts:1690` (`onReactionUpdated`)

```ts
realtimeClient.onReactionUpdated((data) => {
  if (data.conversationId === exploreWebviewProvider._activeChatConvId) {
    exploreWebviewProvider.postToWebview({ type: "chat:reactionUpdated", payload: data });
  }
});
```
⚠️ Kiểm tra lại `realtimeClient.onReactionUpdated` có expose `conversationId` trong payload không — nếu chưa thì bổ sung ở `src/realtime/`.

### 4.3. Hardening — `media/webview/sidebar-chat.js:3835`

Trong case `'conversationRead'`, trước khi update `seenMap`:

```js
case 'conversationRead': {
  var readAt = payload.readAt;
  var readLogin = payload.login;                         // bỏ fallback otherLogin
  if (!readAt || !readLogin) break;

  // Validate: readLogin phải là participant của conv hiện tại
  if (_state.isGroup) {
    var isMember = (_state.groupMembers || []).some(function(m) { return m.login === readLogin; });
    if (!isMember) break;
  } else {
    if (readLogin !== _state.otherLogin) break;
  }

  _state.otherReadAt = readAt;
  // ... phần còn lại giữ nguyên
}
```

### 4.4. Hardening — `media/webview/sidebar-chat.js:3667`

```js
if (payload.readReceipts && payload.readReceipts.length) {
  var memberSet = {};
  if (payload.isGroup) {
    (payload.groupMembers || []).forEach(function(m) { memberSet[m.login] = true; });
  }
  payload.readReceipts.forEach(function(r) {
    if (!r.login || !r.readAt) return;
    if (payload.isGroup && !memberSet[r.login]) return;          // drop stale
    if (!payload.isGroup && r.login !== _state.otherLogin) return;
    _state.seenMap[r.login] = { name: r.name || r.login, avatar_url: r.avatar_url || '', readAt: r.readAt };
  });
}
```

### 4.5. Hardening — `media/webview/sidebar-chat.js:3661`

```js
_state.otherReadAt = payload.otherReadAt || null;   // không giữ giá trị cũ
```

## 5. Steps cho session handle fix

1. **Checkout branch mới** từ `develop`:
   ```bash
   git checkout develop && git pull && git checkout -b <tên-author>-fix-seen-avatars-31
   ```
2. **Apply fix chính** ở `src/webviews/explore.ts:1695` (mục 4.1).
3. **Apply fix phụ** ở `src/webviews/explore.ts:1690` (mục 4.2). Verify `realtimeClient.onReactionUpdated` có `conversationId` trong payload — nếu chưa thì bổ sung ở emitter (`src/realtime/`).
4. **Apply hardening** ở `media/webview/sidebar-chat.js`:
   - Line 3835 — validate `readLogin` thuộc conversation (mục 4.3).
   - Line 3667 — filter `readReceipts` theo `groupMembers` / `otherLogin` (mục 4.4).
   - Line 3661 — bỏ fallback `||` cho `otherReadAt` (mục 4.5).
5. **Build & lint:**
   ```bash
   npm run compile
   ```
6. **Repro test theo scenario của QA:**
   - Mở DM với account đang **offline** → gửi message → **không được** render seen avatar.
   - Mở 2 conversation song song (A đang mở, B ở background) → trigger read event ở B → avatar seen ở A **không được** thay đổi.
   - Group chat → tạo receipt giả cho user đã rời group → avatar đó **không được** hiển thị.
   - Group chat bình thường → verify avatar seen vẫn hoạt động đúng cho member thật.
   - Verify `<img title="Seen by ...">` ở DOM khớp đúng user.
7. **Update** `docs/contributors/<current-user>.md` — Current section + Decisions section (theo quy ước CLAUDE.md).
8. **Commit:**
   ```
   fix(chat): filter conversationRead events by conversationId (#31)
   ```
9. **Tạo PR** target `develop`, link issue #31 + #32, đính screenshot repro trước/sau.

## 6. Files liên quan (quick ref)

| File | Lines | Vai trò |
|---|---|---|
| `src/webviews/explore.ts` | 1695–1699 | **Root cause** — relay thiếu filter |
| `src/webviews/explore.ts` | 1690–1694 | Lỗi phụ cùng pattern (reactions) |
| `media/webview/sidebar-chat.js` | 3835–3864 | Handler `conversationRead` |
| `media/webview/sidebar-chat.js` | 3661–3675 | Init build `seenMap` |
| `media/webview/sidebar-chat.js` | 730–780 | `refreshSeenAvatars()` render logic |
| `src/realtime/` | — | Kiểm tra WebSocket emitter cho `conversationRead` + `reactionUpdated` có gửi đủ `conversationId` |

## 7. Ghi chú

- **Không cần fix server-side** nếu server đang gửi đúng `conversationId` — bug chỉ ở phía client relay.
- Nếu sau khi apply mục 4.1 mà vẫn còn repro được, kiểm tra `realtimeClient.onConversationRead` xem `data.conversationId` có thực sự được populate từ WebSocket payload không (debug ở `src/realtime/`).
- QA nên retest cả 2 issue #31 + #32 vì cùng root cause.
