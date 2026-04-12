# Telegram-style In-Chat Message Search

## Overview

Clone Telegram's in-chat search UX for the VS Code extension chat panel. Users can search messages within the current conversation, filter by user or jump to a date, and navigate results with full message context loading.

## Scope

- Text search within current conversation (API-backed)
- Filter by user (group conversations only)
- Jump to Date (navigate conversation timeline)
- Results list overlay (Telegram-style)
- Jump to message with context loading (reuse existing `jumpToMessage` flow)
- Graceful fallbacks for missing BE endpoints

## UX Flow

### State Machine

```
Idle ──(click search icon)──► Search Active (empty input, no results)
  │
  ▼
Search Active ──(type query, debounce 300ms)──► Loading
  │                                                │
  │                                                ▼
  │◄─────────────────────────────────── Results List (API responded)
  │                                       │              ▲
  │                         (click result  │              │ (click search input)
  │                          or Enter)     ▼              │
  │                                    Chat Navigation ───┘
  │
  ▼
(Escape / close ✕ from ANY state) ──► Idle
```

### States

1. **Idle** — Normal chat header with search icon button (codicon-search) added to `header-right`, next to the gear button.

2. **Search Active** — Search bar **replaces the entire chat header**:
   - Left: `↑ ↓` navigation arrow buttons (visually present but disabled until Chat Navigation state)
   - Center: Rounded pill-shaped search input with codicon-search icon inside left + clear ✕ button right. Auto-focused.
   - Right: Filter icons — by user (codicon-person, group only), Jump to Date (codicon-calendar), close ✕ (codicon-close)
   - Below: Empty results area. Ready to type.

3. **Loading** — User has typed (after 300ms debounce). Subtle spinner in the search input (right side, before clear ✕). **Previous results stay visible** (dimmed) while loading — do NOT clear and show full-screen spinner. On first search (no previous results), show centered spinner in results area.

4. **Results List** — API responded with results:
   - Results overlay **covers the entire chat area**
   - **User matches first** (client-side): If query matches a conversation member's name/login, show a user card at the top (avatar + name + @handle), separated by border-bottom. Clicking a user card activates the user filter.
   - **Message results below**: Each result row layout:
     - Left: avatar (40px round)
     - Middle top: sender name (blue, bold) — use `sender` field (login). Note: `Message` type only has `sender` (login string), not display name. Use login as-is.
     - Middle bottom: message preview — keyword match in **bold, foreground color**, rest in muted. Truncated with "…" to single line.
     - Right: date, right-aligned
   - **Attachment previews in message preview line**: `attachment_url` is a single nullable string. If present and no `content`, show filename from URL path. If `content` also present, show content (attachment is supplementary).
   - **Date format**: Relative for recent ("Sat", "Yesterday"), absolute DD/MM/YY for older ("6/02/26", "14/07/25")
   - **No results**: Show "No messages found" centered
   - **Arrow buttons** in search bar: still disabled (only active in Chat Navigation)
   - Infinite scroll on results list via cursor pagination

5. **Chat Navigation** — User clicks a result row or presses Enter on highlighted row:
   - Results list overlay **hides** (cached in memory for quick return)
   - Search bar **stays visible** at top
   - `↑ ↓` arrow buttons now **enabled** — navigate between search results, each press jumps to the prev/next matched message
   - Counter appears between arrows and input: "3 of N" (see Counter section)
   - Uses existing `jumpToMessage` → `jumpToMessageResult` postMessage flow:
     - Save current messages array + scroll position + pagination cursors to snapshot (data, NOT DOM)
     - Post `jumpToMessage` with messageId → chat.ts calls `apiClient.getMessageContext()` → responds with `jumpToMessageResult`
     - Render context messages, scrollIntoView target message
     - **Highlight**: Target message gets blue left-border + light blue background, fade out after 2s
     - **Keyword highlight**: Search keyword is highlighted (bold, yellow/accent background) within the target message text in the chat view
     - Normal scroll pagination resumes from jumped-to position (scroll up = older, scroll down = newer)
   - **Arrow nav optimization**: If next/prev result message is already visible in current DOM, just scroll to it + highlight. Only call `jumpToMessage` API if the message is not in current DOM.
   - **Debounce arrow presses**: 200ms throttle to prevent rapid API calls

6. **Back to Results** (transition, not a state) — Click search input while in Chat Navigation → results list reappears, returns to Results List state.

### Counter

- Displayed in Chat Navigation state, between ↑↓ arrows and search input
- Format: "3 of 12" where 12 = total loaded results count
- If more results available (nextCursor exists), show "3 of 12+"
- Updates as user navigates ↑↓ and as more results load via pagination
- Note: API returns `{ messages, nextCursor }` — no `totalCount`. Counter uses count of loaded results.
- BE requirement (optional): Add `total` field to search response for accurate count

### Return from Search

- Close search (✕ or Escape from any state) → restore snapshot: re-render saved messages array via `renderMessages()`, restore scroll position + pagination cursors
- If user has scrolled to bottom (at live chat) after jumping → skip restore, already at live position
- If no jump was made (closed from Results List state) → no restore needed, chat was untouched (hidden behind overlay)

### Filter: By User

- Click codicon-person icon → dropdown list of conversation members
- Data source: reuse existing `groupMembersList` array in chat.js (populated at init via `groupMembers` postMessage, line 181). Do NOT use `groupMembers` (populated on-demand when group info panel opens — may be empty).
- Only available in **group conversations** (icon hidden for DMs — only 2 participants, filtering is meaningless)
- Select a member → adds user login as badge/chip in search bar (between input and filters)
- Results re-fetched with `user` param added to API call
- Click ✕ on badge to remove filter, re-fetch without `user`
- Multiple user selection: NOT supported (Telegram only allows one)

### Filter: Jump to Date

- Click codicon-calendar icon → calendar dropdown (vanilla JS)
- Calendar shows month grid with year navigation (◄ 2025 ►, then month buttons: Jan Feb Mar ... Dec)
- User picks a specific date → sends `postMessage("jumpToDate", { date: "2025-07-14" })`
- chat.ts handler → new API call or reuse context API with date param → responds with messages around that date
- Chat scrolls to that point in history
- This is **independent of text search query** — it's a timeline navigation tool, same as Telegram
- Can be combined with active search: jump to date, then ↑↓ navigate results from that position
- BE requirement: `GET /messages/conversations/{id}/messages?around_date={ISO date}` or similar

### Close Search

Press ✕ button or Escape key → restore normal header + chat view (see "Return from Search").

### Keyboard

- `Escape` → close search entirely (from any state)
- In **Results List** state:
  - `↑` / `↓` arrow keys → move highlight between result rows in the list
  - `Enter` → jump into chat for the highlighted result (transitions to Chat Navigation)
- In **Chat Navigation** state:
  - `↑` / `↓` arrow keys → jump to prev/next matched message in chat (same as clicking arrow buttons)
  - Click search input → return to Results List
- Note: `Ctrl+F`/`Cmd+F` intentionally NOT used — conflicts with VS Code's built-in find

### WebSocket Messages During Search

- **Results List state**: New incoming messages do NOT auto-update the results list. Results are a snapshot of the API response.
- **Chat Navigation state**:
  - If viewing latest messages (near bottom), new messages append normally
  - If viewing older context (jumped to old message), new messages are queued — shown when user returns to live chat
- **On close search**: Any queued messages are rendered when chat restores to live view

## Architecture

### Data Flow — Search

```
User types → debounce 300ms → postMessage("searchMessages", {query, cursor?, user?})
  → chat.ts handler → apiClient.searchMessages(conversationId, query, cursor, user?)
  → postMessage("searchResults", {messages, nextCursor, query})
     OR postMessage("searchError", {query, error: true})  ← on API failure
  → chat.js renders results list (or "Search unavailable" on error)
```

### Data Flow — Jump to Message (REUSE EXISTING)

```
User clicks result → postMessage("jumpToMessage", {messageId})
  → chat.ts handler (ALREADY EXISTS, line 815) → apiClient.getMessageContext()
  → postMessage("jumpToMessageResult", {messages, targetMessageId, hasMoreBefore, hasMoreAfter})
  → chat.js saves snapshot (messages array + scroll pos + cursors),
    renders context messages, scrollIntoView target, highlight 2s
```

### Components (chat.js)

- `SearchManager` — State machine (idle/search-active/loading/results-list/chat-nav), manages query, results, filters, current result index, chat snapshot
- `renderSearchBar()` — Replaces `.chat-header` when search is active
- `renderSearchResults(results, query)` — Overlay results list over `#messages` area
- `highlightKeyword(text, query)` — Returns HTML with keyword wrapped in highlight span
- `renderUserFilter()` — Dropdown of conversation members from `groupMembers`
- `renderDatePicker()` — Month/year calendar grid dropdown
- `matchUsers(query)` — Client-side filter of groupMembers by name/login for user cards at top of results
- `saveSnapshot()` / `restoreSnapshot()` — Save/restore messages array, scroll position, pagination cursors

### Extension Handler (chat.ts)

- `case "searchMessages"` — Exists (line 670). Needs changes:
  - Add `user` to payload typing (date filtering is handled separately via Jump to Date, not via search params)
  - On API failure: send `{ type: "searchError", query, error: true }` instead of `{ type: "searchResults", messages: [] }`
- `case "jumpToMessage"` — Already exists (line 815). Reuse as-is for search result jumps.
- `case "jumpToDate"` — New handler. Calls API to get messages around a date.

### API Layer (api/index.ts)

- `searchMessages()` — Exists (line 488), signature: `searchMessages(conversationId, query, cursor?, limit?)`. Needs changes: add optional `user` param (pass as options object to avoid positional sprawl: `{ cursor?, limit?, user? }`).
- `getMessageContext()` — Already exists (line 295). URL: `GET /messages/conversations/{conversationId}/messages/{messageId}/context`. Reuse as-is.

### Message Type Constraints

The `Message` interface (src/types/index.ts line 118-128) has:
- `sender`: string (login, NOT display name)
- `sender_avatar`: string
- `content`: string
- `attachment_url`: string | null (single URL, no filename/type metadata)
- No forwarded message fields

Results UI must work within these constraints:
- Sender name in results = `sender` (login)
- Attachment preview = extract filename from `attachment_url` path, or show "Attachment" as fallback
- No rich attachment type detection (photo vs file vs link) — treat all as generic attachment

## BE Requirements

New endpoints/params needed (document separately for BE team):

1. **`GET /messages/conversations/{id}/search` — Additional filter params (extend existing):**
   - `user` (string) — Filter results by sender login
   - `total` (response field, optional) — Total result count for accurate counter
   - Note: `date_from`/`date_to` search filters deferred to V2. Jump to Date uses separate endpoint.

2. **`GET /messages/conversations/{id}/messages?around_date={ISO date}`** — Returns messages around a specific date for Jump to Date feature. Response shape should match existing message list response.

3. **`GET /messages/conversations/{id}/messages/{messageId}/context`** — Already exists and works. No changes needed.

## Graceful Fallbacks

- **Context endpoint 404/500**: Scroll to message if present in DOM, show toast "Cannot load older messages" if not
- **Filter params ignored by BE**: FE sends params, results come back unfiltered but no crash
- **Search endpoint 500**: Show "Search unavailable" in results area (via `searchError` message type)
- **Jump to Date endpoint missing**: Show toast "Jump to date not available yet", disable calendar icon
- **`total` field missing from response**: Counter shows "3 of 12+" based on loaded count + nextCursor presence

## Error Handling & Edge Cases

- Empty query → don't call API, clear results, show empty state
- API error/500 → show "Search unavailable" in results area
- No results → show "No messages found"
- Rapid typing → debounce 300ms, discard stale responses by comparing returned `query` against current input value. This also applies to paginated requests — cursor responses carry `query` for staleness checking.
- Close search after jump → restore snapshot via `restoreSnapshot()` (messages array + scroll pos + cursors), re-render with `renderMessages()`
- Close search without jump (from Results List) → just hide overlay, chat was untouched underneath
- User filter + search active → combine params: `?q=hazel&user=alice`
- Arrow press when next result already in DOM → scroll to it, skip API call
- Arrow press when next result NOT in DOM → call `jumpToMessage`, full context load
- User scrolls away in Chat Nav then presses ↑↓ → jumps to next result by index (maintains result index, not viewport-relative)
- Message in results gets deleted/edited via WebSocket → stale data in results list (acceptable — results are a snapshot, user can re-search)
- Conversation has very few messages → results may be empty or show all messages, no special handling needed

## Performance

- Results list: Render max 20 results initially, infinite scroll loads more via cursor
- Debounce input: 300ms
- Throttle arrow navigation: 200ms
- Loading state: keep previous results visible (dimmed), don't clear
- Close search → dispose overlay, free cached results
- Cancel stale requests when new query arrives
- Arrow nav: skip API call if target message already in DOM

## Existing Code (reuse & modify)

- CSS: `.search-bar` classes in `chat.css` (line 38-107) — **replace** with new Telegram-style layout. Remove old CSS rules, rewrite with same class names. No other features depend on these classes (only used for in-chat search).
- Handler `case "searchMessages"` in `chat.ts` (line 670-677) — add filter params + error response
- Handler `case "jumpToMessage"` in `chat.ts` (line 815-842) — **reuse as-is**
- API `searchMessages()` in `api/index.ts` (line 488-495) — add filter params
- API `getMessageContext()` in `api/index.ts` (line 295-310) — **reuse as-is**
- Chat.js `jumpToMessageResult` handler (line 298-332) — **reuse**, extend with search keyword highlight. Note: handler reads `msg.hasMore` (not `msg.hasMoreBefore`) for load-more button — may need updating.

## Pagination with Filters

When filters are active and user scrolls to load more results, FE must re-send filter params with each paginated request alongside the cursor. Cursor carries position only, not filter context.

## Known Omissions vs Telegram (V1)

- No recent search history (empty state shows nothing, not recent queries)
- No global search across all conversations (only in-chat)
- No media/file type filters (Photos, Videos, Files, Links, Music, Voice, GIFs)
- No rich attachment type detection in results (all attachments shown generically)
- No sender display name (only login — requires BE to add `sender_name` to Message type)
- No accessibility (ARIA roles, screen reader support) — can add in V2
