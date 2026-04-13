# Changelog

All notable changes to the "Top GitHub Trending Repo & People" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [1.3.2] - 2026-04-04

### Fixed
- Sort conversations by recent activity with unread badge debounce
- Clear unread badge when user reads messages
- Inbox status bar click opens chat panel correctly
- Only mark conversation read when chat panel is visible

### Added
- Send client/IDE metadata on sign-in for analytics

## [1.2.0] - 2026-04-02

### Added
- Sidebar badges for unread messages and notifications
- Multi-file attachments in chat
- Image grid layout for multiple attachments
- Attach menu with file picker

### Fixed
- Unread count sync issues

## [1.1.4] - 2026-03-31

### Fixed
- Debug logging for feed and notifications data loading
- Who-to-follow suggestions API response parsing

## [1.1.3] - 2026-03-30

### Changed
- Replace placeholder icon with Gitchat logo

## [1.1.2] - 2026-03-29

### Added
- For You personalized feed
- Redesigned profile and repo detail panels
- Filter chips for feed (All, Trending, Releases, Merged PRs, Notable Stars)
- Inbox-first chat layout with typing indicators and smart sorting
- Group chat management (info panel, add/remove members, leave, mute)

### Fixed
- Markdown README rendering in repo detail
- Profile fallback for missing data
- Duplicate messages on send

### Changed
- CI: trigger publish only on GitHub release

## [0.1.1] - 2026-03-25

### Added
- Initial release
- Trending repos and people discovery
- GitHub OAuth authentication
- Real-time messaging with WebSocket
- Follow/unfollow, star/unstar
- Notifications
- Search
