# amando

## Current
- **Role:** Growth
- **Branch:** develop
- **Working on:** Cold email growth — personalize template + A/B metrics on `cold-dm` module (gitchat-webapp backend, Resend stack)
- **ETA:**
  - Goal 1 (personalize 2 variant template): 2026-04-17
  - Goal 2 (Resend webhook + A/B stats endpoint): 2026-04-21
- **Last updated:** 2026-04-15

## Decisions
- 2026-04-15: Cold email runs on the existing `cold-dm` module (Resend already wired) — no new stack, extend only
- 2026-04-15: Goal 1 before Goal 2 — without variants the A/B metrics are meaningless
- 2026-04-15: Variant selection hashed by `recipientLogin` (stable per recipient), not random
- 2026-04-15: Reply signal uses existing `accepted_at`, no separate reply detection needed
