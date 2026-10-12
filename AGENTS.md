# Working on Swiss Transports

## Project boundaries

- This is an external Gladys Assistant integration using the official JavaScript SDK. Do not add core Gladys patches or a standalone frontend.
- Provider: `https://transport.opendata.ch/v1/`, documentation: `https://transport.opendata.ch/docs.html`. No API key or provider authentication. Keep `transports: ["cloud"]`.
- Do not initialize or create a Git repository, add remotes, publish images, tag or release unless explicitly requested. Workflow definitions are preparation, not authorization to execute them.
- The repository owner is `valentinhttr`. The manifest names the intended image, which has not been published. Do not claim it exists or add the `gladys-assistant-integration` store topic unless explicitly requested.

## Architecture

- `index.js`: SDK startup only.
- `src/integration.js`: lifecycle, handler wiring, monitoring and state publication.
- `src/client.js`: fixed-origin HTTP, cache, coalescing, limits and cooldown.
- `src/transport.js`: API queries and normalization.
- `src/config.js`: defaults and input validation.
- `src/devices.js`: stable device and feature IDs, discovery payloads.
- `src/scenes.js`: scalar outputs and event deduplication.
- `src/widgets.js`: declarative SDK widgets, no HTML/CSS.
- `gladys-assistant-integration.json`: configuration and public capability contract.

## Invariants

- Keep manifest keys and handlers synchronized. Published device, feature, action, widget and trigger keys must remain stable.
- Use official SDK feature constants and `externalIds`. Use Gladys' native widget vocabulary and `validateWidgetContent` in tests.
- Unknown delays are not on-time readings. Preserve `delay_known`; empty/API-error states must not fabricate departures or zeros.
- Do not publish stale responses after disconnect or configuration replacement. Keep one monitoring timer and one refresh in flight per configuration.
- Preserve rate limiting even for manual actions. Never make unit tests use the public API.
- Keep runtime caches, event records, HTTP response sizes and concurrency bounded.
- Treat every provider value as untrusted. No arbitrary URLs, HTML, executable payloads or secrets in logs.
- Use Europe/Zurich for displayed times and ISO UTC for scene outputs. Tests must not depend on the host timezone.
- All user-facing manifest and widget labels must support French and English.
- Attribute Transport API and its timetable source in documentation and widgets.

## Checks and releases

Run `npm run format:check`, `npm run lint`, and `npm test` for code changes. Run the official integration-store validator when changing the manifest; full admission also needs a published image. A successful mocked SDK test is not a live Gladys installation test.

Update `CHANGELOG.md` under `[Unreleased]` for subsequent user-visible changes. Version, lockfile and manifest/image tag move together. Preserve the four workflow roles and multi-architecture images. Docker must remain non-root and compatible with read-only rootfs. Never add tokens to examples or commit local `.env` files.
