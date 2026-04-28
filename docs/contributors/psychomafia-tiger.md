# psychomafia-tiger

## Current
- **Role:** Growth
- **Branch:** psychomafia-tiger-readme-star-history
- **Working on:** Add Star History chart (star-history.com) to README under a new "Star History" section, with light/dark theme auto-switching via <picture>
- **Blockers:** None
- **Last updated:** 2026-04-28

## Decisions
- 2026-04-13: Publish GitChat as new extension (name=gitchat, publisher=Gitchat), accept losing old installs
- 2026-04-13: Rename all command/view/config prefixes from trending.* to gitchat.* in package.json + src/
- 2026-04-13: README restructured chat-first, live features separated from "What's Next" roadmap
- 2026-04-16: Created GitchatSH/brand-assets public repo to host images — private repo causes broken images on marketplace listings
- 2026-04-16: VS Code Marketplace publisher is `GitchatSH` (not `Gitchat` as in package.json) — README links use `GitchatSH.gitchat`; Open VSX keeps `Gitchat/gitchat`
- 2026-04-16: Bumped package.json version 1.0.4 → 1.1.0 to match already-published Marketplace/OpenVSX release (someone published without bumping repo)
- 2026-04-28: Added Star History chart to README (star-history.com) — surfaces community traction directly on the marketplace/Open VSX/GitHub listings, encourages new visitors to star the repo
