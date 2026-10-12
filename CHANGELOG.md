# Changelog

## [Unreleased]

### Changed

- Document the published 1.0.0 image and installation through the integration store or repository URL.

## [1.0.0] - 2026-10-12

### Added

- External Gladys integration based on the official JavaScript SDK template, requiring Gladys 5.2 or newer.
- Transport API station search, departure boards and connection planning without provider authentication.
- Cloud transport classification and configurable polling, transport filters and alert thresholds.
- Read-only station and route devices, with explicit availability and real-time validity features.
- French and English departure and connection widgets with per-instance settings.
- Departure approaching and departure delayed scene triggers, deduplicated per journey.
- Next departure, next connection and refresh scene actions with scalar outputs.
- Bounded shared cache, request coalescing, timeout, response size limit and HTTP 429 cooldown.
- CI, multi-architecture GHCR builds, version release and GitHub release workflows.
- Offline tests, French/English documentation, security policy and contributor instructions.
- Swiss Transports catalog cover featuring the Swiss flag, a train, a bus and an alpine landscape.
- Offline integration coverage using the SDK's official fake Gladys for discovery, states, scenes, widgets and reconnection.
- Native station-search forms in both widgets, with French/English messages and complete station IDs.
- Declare the existing `line` event variable so it is available in the scene editor.

### Changed

- Set repository and cover URLs to `valentinhttr/gladys-swiss-transports`.
- Upgrade the official integration SDK to 0.15 and require Gladys Assistant 5.2 or newer.
- Deduplicate state publications with the SDK, re-send stable values every 30 minutes and reset on configuration changes and reconnection.
- Bound and clean provider text and journey identities; reject malformed numbers and timezone-free dates, and keep unavailable arrival/transfer data explicit.
- Clarify empty connection results and early departures in widgets.
- Translate the main README into English.
- Require version-specific changelog notes for GitHub releases, with no automatically generated fallback.

### Fixed

- Stop publishing a device polling frequency in seconds, which Gladys rejects: the integration already owns the configurable monitoring timer.
- Serialize publications across configuration changes and discard obsolete scene/widget responses and initialization failures.
- Preserve the longest cooldown when concurrent requests receive HTTP 429 responses.
- Avoid false zero-minute delays from malformed provider values, partial station IDs in search results and late alerts for departed services.
- Keep upstream error details out of integration logs.
