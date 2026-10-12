# Swiss Transports

![Swiss Transports: Swiss flag, train and bus in an alpine landscape](cover.jpg)

External integration for **Gladys Assistant ≥ 5.2**, built from the official JavaScript integration template and `@gladysassistant/integration-sdk` 0.15.

Swiss public transport timetables powered by the [Transport API](https://transport.opendata.ch/docs.html), **without an account, API key or provider authentication**. Transport tag: **cloud** — Internet access is required.

- Search for stations and their identifiers.
- Monitor a station and, optionally, a route to a destination.
- **Next departures** and **Connections** widgets with per-instance settings, platforms, delays, arrival times and transfers.
- Find station IDs directly from either widget using a native Gladys form.
- **Departure approaching** and **Departure delayed** scene triggers.
- **Get next departure**, **Get next connection** and **Refresh monitored timetables** scene actions.
- Declarative widgets and user guides in English and French.

[English guide](docs/en.md) · [French guide](docs/fr.md) · [Security](SECURITY.md) · [Changelog](CHANGELOG.md)

## Installation and publishing

Source repository: [valentinhttr/gladys-swiss-transports](https://github.com/valentinhttr/gladys-swiss-transports). The manifest targets `ghcr.io/valentinhttr/gladys-swiss-transports:1.0.0`, but **this image has not been published**. No release or version tag has been created, and the repository does not carry the `gladys-assistant-integration` topic used for store discovery.

To build and check locally:

```sh
npm ci
npm run format:check
npm run lint
npm test
docker build -t gladys-swiss-transports:1.0.0 .
```

In Gladys developer mode, use a copy of the manifest with `docker_image` pointing to an image accessible to its Docker engine. A locally built image must be available on the same Docker engine as Gladys.

For future image publication, when explicitly requested:

1. Run **Build and publish image** with `image-tag: 1.0.0`, or push the `v1.0.0` tag.
2. Make the GHCR package public before installing from another machine.
3. Install the manifest through **Integrations → Install an integration → Developer mode**. The included `cover.jpg` is registered through `cover_image`.

Add the `gladys-assistant-integration` topic only when store listing is requested and admission checks pass.

## Changelog-based releases

`CHANGELOG.md` is the source of release notes. Add changes under `## [Unreleased]`, grouped into sections such as `Added`, `Changed` and `Fixed`.

For subsequent versions, run the **Release** workflow and select `patch`, `minor` or `major`. It:

1. Updates the package, lockfile, manifest version and Docker image tag.
2. Moves the unreleased changes under `## [X.Y.Z] - YYYY-MM-DD`, leaving a fresh `[Unreleased]` section. An empty section produces a maintenance-release note.
3. Commits the changes and creates the version tag.
4. Builds and publishes the image, deriving its registry path from the actual repository.
5. Creates the GitHub release using exactly that version's changelog section.

The **GitHub releases** workflow also creates releases for older tags that do not have one yet. A missing or empty version section fails the workflow instead of generating notes from commits or pull requests. Existing releases are left unchanged.

## Quick configuration

Choose `station` (default: **Lausanne**) and optionally `destination` (for example **Genève**). Use **Find a station ID** to resolve ambiguous names. Keep identifiers as strings, including any leading zeros.

Add the discovered devices in Gladys. Monitoring and events start immediately; adding the station device makes it available as a scene trigger filter. Widgets can display other stations or routes, but their settings do not create additional monitoring.

The default refresh interval is **60 seconds**, with a **30-second** minimum. Timetables share a 30-second cache; station searches are cached for five minutes. Manual refresh also respects the cache. Displayed times use `Europe/Zurich`; scene outputs use ISO UTC timestamps.

State publications use SDK deduplication: only changed values are sent, with a 30-minute heartbeat for stable values. Reconnection, configuration replacement and adding a device force a fresh publication on the next refresh. Monitoring retains its single configurable timer.

## Development

Development tools require Node.js **22.13+ or 24+**; the Docker image uses Node 24. `npm start` expects the variables supplied by the Gladys supervisor:

- `GLADYS_HOST_API_URL`
- `GLADYS_INTEGRATION_TOKEN`
- `GLADYS_INTEGRATION_SELECTOR`

This internal Gladys token is unrelated to the Transport API. Never commit it. No inbound HTTP server, exposed port, host access or additional persistent storage is required.

Tests run offline and cover caching, limits, HTTP errors, timetable normalization, configuration changes, reconnection, SDK widget validation and event deduplication. They do not replace acceptance testing in a live Gladys instance.

| Workflow             | Purpose                                                                                   |
| -------------------- | ----------------------------------------------------------------------------------------- |
| `ci.yml`             | Prettier, ESLint and Node 22/24 tests; store validation and Docker build on pull requests |
| `build.yml`          | GHCR publishing for `linux/amd64` and `linux/arm64`; manual builds do not move `latest`   |
| `release.yml`        | Version bump, changelog rollover, commit/tag, image publishing and GitHub release         |
| `github-release.yml` | Creates missing releases from version tags and their changelog sections                   |

Store admission checks also verify that the image exists. They will fail until the referenced image is published and public. Release workflows require GitHub Actions write permissions and branch rules that allow automated release commits.

## Data source

[Transport API — Opendata.ch](https://transport.opendata.ch/) · [API documentation](https://transport.opendata.ch/docs.html). Timetable data: [opentransportdata.swiss](https://opentransportdata.swiss/). Widgets display this attribution too. Real-time data may be missing or delayed; the integration does not infer cancellations from missing departures.

Code is distributed under the [Apache-2.0 license](LICENSE). Data remains subject to its providers' terms.
