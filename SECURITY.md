# Security policy

## Supported versions

Security fixes target the latest released 1.x version. The source repository is public, but no Docker image or release has been published yet.

## Reporting a vulnerability

Do not disclose exploitable details, private travel information or Gladys tokens in a public issue. Use the repository's **Security → Report a vulnerability** private reporting feature if enabled, or contact its maintainer privately.

Provide the affected version, reproduction steps, impact and a minimal redacted example. Never send a real integration token.

## Trust boundaries

- Provider traffic uses a fixed HTTPS origin, `transport.opendata.ch`. No provider credentials are accepted or required. Redirects are refused; user fields are encoded query parameters, never destination URLs.
- Station names/IDs, destinations and transport filters are sent to the provider. Cache and journey deduplication are memory-only and cleared on process restart. No telemetry or extra inbound listener is implemented.
- Requests have a 3.5-second timeout, a 2 MiB response limit, bounded concurrent requests and cache size. HTTP failures are not retried in a tight loop; HTTP 429 applies a cooldown.
- Provider data is rendered through Gladys' declarative widget vocabulary. No remote HTML, script or executable is loaded.
- `GLADYS_INTEGRATION_TOKEN` authenticates the SDK with Gladys. It is supplied by the supervisor, never used with Transport API and must never be logged or committed.
- Docker runs as the unprivileged `node` user and supports a read-only root filesystem. No privileged mode, host mounts or published ports are needed.
- Device data can become stale during outages. Use validity/availability features and integration status in automations. Transport information is not a guaranteed safety or emergency signal.

Run `npm audit` when updating dependencies. The lockfile is committed to the source tree and production installation uses `npm ci --omit=dev`. Dependabot and CI cover dependency updates. Publishing workflows use GitHub's scoped token; publishing permissions belong only to the relevant jobs.
