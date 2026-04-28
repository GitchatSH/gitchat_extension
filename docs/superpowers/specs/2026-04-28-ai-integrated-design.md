# AI Integration — Design Spec

**Discussion:** https://github.com/GitchatSH/gitchat_extension/discussions/206  
**Branch:** `norway-ai-intergrated`  
**Date:** 2026-04-28  
**Author:** norwayishere  
**Status:** Draft

---

## Overview

Bring AI capabilities natively into the Gitchat editor experience. Not a bolt-on assistant, but a layer that understands the social + code context Gitchat already has — who you're talking to, what repo you're in, what's trending.

---

## Goals

- [ ] Define which AI features ship in this phase
- [ ] Agree on architecture (local inference vs API, streaming vs request-response)
- [ ] Identify which existing Gitchat surfaces get AI-enhanced first

---

## Feature Areas

### 1. AI-assisted chat
_TBD — e.g. smart reply suggestions, message summarization, tone adjust_

### 2. Repo context awareness
_TBD — e.g. surface relevant discussions/issues when entering a community channel_

### 3. Founder / onboarding agent
Related to issue [#162](https://github.com/GitchatSH/gitchat_extension/issues/162) — AI-guided onboarding flow that helps new users find communities, follow relevant devs, and start conversations.

### 4. Discovery intelligence
_TBD — e.g. personalized trending, "devs you should meet" recommendations_

---

## Architecture

_TBD_

- API provider:
- Streaming:
- Context window strategy:
- Auth / rate limiting:

---

## Open Questions

- Which features are Phase 2 vs later?
- Do we call Claude API directly from the extension or route through our BE?
- How do we handle users who are not signed in?

---

## References

- Discussion: https://github.com/GitchatSH/gitchat_extension/discussions/206
- Related issue: [#162 Founder Agent](https://github.com/GitchatSH/gitchat_extension/issues/162)
- Branch: `norway-ai-intergrated`
