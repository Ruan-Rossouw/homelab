# Byparr

A drop-in replacement for FlareSolverr — same job (a headless browser that
solves Cloudflare's JavaScript challenge on behalf of Prowlarr, for
indexers like 1337x and extratorrent-st that sit behind it), different
implementation. See `services/flaresolverr/README.md` for why this proxy
exists at all and the Trivy finding that prompted this migration.

## Why Migrate: FlareSolverr's Chromium Is Stuck, Byparr's Isn't

FlareSolverr bundles a stale Debian-packaged Chromium responsible for
2138 of 2141 HIGH/CRITICAL CVEs Trivy flags against that image, with no
upstream fix available — the project hasn't released since 2026-05-26 and
looks unmaintained. Byparr is under active development (latest release
`v3.0.4`, 2026-08-18 — four days before this migration started) and uses
Playwright/Camoufox against Firefox rather than Selenium +
undetected-chromedriver against Chromium, which puts it in a structurally
better position against the same class of problem: Playwright manages and
updates its own browser binary instead of depending on a distro package
falling behind upstream.

## API Compatibility: Confirmed, Not Assumed

Checked directly against Byparr's source (`src/models.py`,
`src/endpoints.py`, 2026-08-22) rather than taken on faith: it exposes the
same `POST /v1` endpoint FlareSolverr does, and its request model's `cmd`
field docstring says outright *"This string is purely for compatibility
with FlareSolverr"*, while `maxTimeout` is documented as *"matching
FlareSolverr's maxTimeout parameter"*. The response shape (`solution.url`,
`.status`, `.cookies`, `.headers`, `.userAgent`, `.response`) matches too.
This is why the migration is a URL repoint in Prowlarr, not a
reconfiguration — same interface Prowlarr's FlareSolverr indexer-proxy
type already speaks.

## Proving Phase: Deployed Alongside FlareSolverr, Not Cut Over Yet

Following this repo's pattern for swapping a pipeline dependency (see
Decypharr's original standalone test before Prowlarr/Radarr/Sonarr got
wired to it): Byparr runs alongside FlareSolverr first, on a different
host port (`8192`, not FlareSolverr's `8191`), so both can be compared
directly before anything in Prowlarr changes. FlareSolverr keeps serving
production traffic until Byparr is confirmed to actually clear Cloudflare
challenges for the indexers currently tagged for it (1337x,
extratorrent-st).

**Once deployed**, verify with a direct request before touching Prowlarr:

```bash
curl -s -X POST http://192.168.68.110:8192/v1 \
  -H "Content-Type: application/json" \
  -d '{"cmd":"request.get","url":"https://1337x.to","maxTimeout":60000}' | jq .
```

Expect `"status": "ok"` and a `solution.response` containing real page
HTML (not a Cloudflare challenge page) and a non-empty `solution.cookies`
list. Repeat against extratorrent-st's URL. Both passing is the gate for
cutover.

Pre-checked (2026-08-22) from a non-server sandbox before writing these
instructions: the container builds, starts, and passes `/health` and a
general `/v1` request (`google.com`) correctly. The 1337x-specific check
above returned Cloudflare's own "Access denied" page rather than a
challenge Byparr failed to solve — almost certainly the sandbox's
datacenter IP getting blocked by Cloudflare's WAF layer before any
JS-challenge-solving is even relevant, not a Byparr defect. This is
exactly why the gate has to run from the server's own (residential) IP,
not be taken as already proven here.

**Cutover** (only after the gate above passes): in Prowlarr, **Settings →
Indexers → Indexer Proxies**, edit the existing FlareSolverr proxy entry
to point at `http://192.168.68.110:8192` instead of `:8191` (same tags,
same indexers — nothing else changes), **Test**, **Save**. Confirm
1337x/extratorrent-st searches still work in Prowlarr. Once confirmed,
stop and remove the FlareSolverr container/service and drop its firewall
rule (`docs/zimaos.md`), then update `docs/roadmap.md`'s Phase 5 section
to close out the migration.

## Resource Trade-Off

Same shape as FlareSolverr's own trade-off write-up: a headless browser
costs meaningfully more than anything else this lightweight, on an
already-constrained 15W/8GB box. `mem_limit: 2g` here starts as a
conservative estimate carried over from FlareSolverr's own limit — Firefox
via Camoufox is typically lighter than Chromium, but there's no
Byparr-specific measurement yet. Revisit after 1-2 weeks of real traffic
using `max_over_time(container_memory_usage_bytes{name="byparr"}[14d])`
per `docs/conventions.md`, same as every other service's limit.

## Image: Official, Pinned

`ghcr.io/thephaseless/byparr:3.0.4` — the project's own GHCR image, tag
pinned to its latest release (`v3.0.4` on GitHub; the `docker/
metadata-action` semver pattern the project's CI uses strips the `v`
prefix when publishing to GHCR, so the actual pushed tag is `3.0.4`, not
`v3.0.4` — checked directly against the registry since the two didn't
match and it wasn't obvious which was right) rather than `:latest` (see
`docs/conventions.md`). Renovate will pick up future releases normally.

## Container User: Non-Root, No PUID/PGID

Checked directly (`docker inspect`): the image sets `USER 1000` with no
PUID/PGID environment-variable support (unlike most linuxserver.io
images) — the UID is fixed at build time. No `config/` volume is mounted
(see Volumes below), so there's nothing to `chown`; this is just a
non-root default, not a gap needing a README justification per
`docs/conventions.md`'s root-user rule.

## Port: 8192 (Deliberately Not 8191), Checked Against the Existing Map

| Port | Service |
|---|---|
| 3000 | AdGuard Home (web UI) |
| 3001 | Uptime Kuma |
| 3002 | Grafana |
| 7878 | Radarr |
| 8080 | cAdvisor |
| 8096 | Jellyfin |
| 8191 | FlareSolverr (being replaced) |
| 8192 | **Byparr** |
| 8282 | Decypharr |
| 8989 | Sonarr |
| 9090 | Prometheus |
| 9100 | node-exporter |
| 9443 | Portainer |
| 9696 | Prowlarr |
| 9898 | Backrest |

`8191` stays free for FlareSolverr until it's decommissioned; `8192` is
Byparr's permanent port even after cutover, since there's no reason to
reclaim `8191` and force a second Prowlarr reconfiguration later.

## Volumes

None. Byparr is stateless, same as FlareSolverr — no config file, no
database, nothing worth persisting across restarts. The `config/`
directory in this service folder exists only to match this repo's
standard per-service shape (`docs/conventions.md`); it isn't mounted.

## Deploy

```bash
cd /DATA/Infrastructure/homelab/services/byparr
docker pull ghcr.io/thephaseless/byparr:v3.0.4
cp .env.example .env
docker compose up -d
```

Then run the proving-phase `curl` checks above before touching Prowlarr.
