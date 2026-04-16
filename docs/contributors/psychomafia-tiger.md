# psychomafia-tiger

## Current
- **Branch:** psychomafia-tiger-fix-marketplace-links
- **Working on:** Fix marketplace links in README and bump package.json version to 1.1.0 to match published release
- **Blockers:** None
- **Last updated:** 2026-04-16

## Decisions
- 2026-04-13: Publish GitChat as new extension (name=gitchat, publisher=Gitchat), accept losing old installs
- 2026-04-13: Rename all command/view/config prefixes from trending.* to gitchat.* in package.json + src/
- 2026-04-13: README restructured chat-first, live features separated from "What's Next" roadmap
- 2026-04-13: Backend URLs (api-dev.gitstar.ai) not changed — server not migrated yet
- 2026-04-16: Created GitchatSH/brand-assets public repo to host images — private repo causes broken images on marketplace listings
- 2026-04-16: Fixed git config email to 420.wza@gmail.com to match GitHub account psychomafia-tiger
- 2026-04-16: VS Code Marketplace publisher is `GitchatSH` (not `Gitchat` as in package.json) — README links use `GitchatSH.gitchat`; Open VSX keeps `Gitchat/gitchat`
- 2026-04-16: Bumped package.json version 1.0.4 → 1.1.0 to match already-published Marketplace/OpenVSX release (someone published without bumping repo)
