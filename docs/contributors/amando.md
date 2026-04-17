# amando

## Current
- **Role:** Growth
- **Branch:** develop
- **Working on:** Cold email growth — personalize template + A/B metrics trên `cold-dm` module (gitchat-webapp backend, Resend stack)
- **ETA:**
  - Goal 1 (personalize 2 variant template): 2026-04-17
  - Goal 2 (Resend webhook + A/B stats endpoint): 2026-04-21
- **Last updated:** 2026-04-15

## Decisions
- 2026-04-15: Cold email chạy trên `cold-dm` module có sẵn (Resend đã wired) — không build stack mới, chỉ extend
- 2026-04-15: Goal 1 trước Goal 2 — không có variant thì metrics A/B vô nghĩa
- 2026-04-15: Variant selection hash theo `recipientLogin` (stable per recipient), không random
- 2026-04-15: Reply signal dùng `accepted_at` có sẵn, không cần reply detection riêng
