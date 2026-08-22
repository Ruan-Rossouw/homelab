# Byparr

A drop-in replacement for FlareSolverr — same job (a headless browser that
solves Cloudflare's JavaScript challenge on behalf of Prowlarr, for
indexers like extratorrent-st that sit behind it), different
implementation. Migrated from FlareSolverr 2026-08-22 and now the
production proxy; FlareSolverr's own service directory has been removed
(its history is preserved in `docs/roadmap.md`'s Phase 5 section and this
file's own migration notes below).

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

## Migration History: Proving Phase, Then Cutover (Complete)

Following this repo's pattern for swapping a pipeline dependency (see
Decypharr's original standalone test before Prowlarr/Radarr/Sonarr got
wired to it): Byparr was deployed alongside FlareSolverr first, on a
different host port (`8192`, not FlareSolverr's `8191`), so both could be
compared directly before anything in Prowlarr changed. FlareSolverr kept
serving production traffic until Byparr was confirmed to actually clear
Cloudflare challenges for the indexers tagged for it (extratorrent-st;
1337x was not in active use — see below).

**Once deployed**, verify with a direct request before touching Prowlarr:

```bash
curl -s -X POST http://192.168.68.110:8192/v1 \
  -H "Content-Type: application/json" \
  -d '{"cmd":"request.get","url":"https://extratorrent.st","maxTimeout":60000}' | jq .
```

Expect `"status": "ok"` and a `solution.response` containing real page
HTML (not a Cloudflare challenge page) and a non-empty `solution.cookies`
list.

**Run from the server (2026-08-22), results:**

- **extratorrent-st: pass.** `status: ok`, a real `cf_clearance` cookie,
  and genuine page HTML (torrent listings, category nav) — Byparr solved
  the Cloudflare challenge correctly.
- **1337x: not a challenge failure — a Cloudflare IP ban.** The response
  was Cloudflare Error 1006, with the page stating outright *"The owner
  of this website (1337x.to) has banned your IP address"*. That's 1337x's
  own WAF rejecting this server's IP before any JS-challenge logic even
  runs — it would happen to FlareSolverr too, from the same IP. Not a
  Byparr defect, and not something either tool can route around.

1337x isn't currently in active use and is being considered for removal
entirely, so this is accepted as a known, pre-existing gap rather than a
migration blocker. extratorrent-st passing is the real gate, and it
passed.

**Cutover (done, 2026-08-22)**: Prowlarr's indexer-proxy entry was
repointed from `http://192.168.68.110:8191` to `:8192` (same tag, same
indexers — nothing else changed), tested, and confirmed working for
extratorrent-st. FlareSolverr's container/compose project was then
removed and its firewall restriction (`docs/zimaos.md`'s
`restrict-internal-ports` service) was moved to Byparr's port instead of
just being dropped, since Byparr has the same unauthenticated-LAN-exposure
shape FlareSolverr did. If 1337x is later removed from Prowlarr entirely,
drop its indexer-proxy tag at the same time.

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

## Port: 8192, Checked Against the Existing Map

| Port | Service |
|---|---|
| 3000 | AdGuard Home (web UI) |
| 3001 | Uptime Kuma |
| 3002 | Grafana |
| 7878 | Radarr |
| 8080 | cAdvisor |
| 8096 | Jellyfin |
| 8192 | **Byparr** |
| 8282 | Decypharr |
| 8989 | Sonarr |
| 9090 | Prometheus |
| 9100 | node-exporter |
| 9443 | Portainer |
| 9696 | Prowlarr |
| 9898 | Backrest |

`8191` (FlareSolverr's old port) is free again post-retirement. Byparr
deliberately stayed on `8192` rather than reclaiming `8191` after
cutover — no reason to force a second Prowlarr reconfiguration for a
purely cosmetic port change.

## Volumes

None. Byparr is stateless, same as FlareSolverr — no config file, no
database, nothing worth persisting across restarts. The `config/`
directory in this service folder exists only to match this repo's
standard per-service shape (`docs/conventions.md`); it isn't mounted.

## Deploy

```bash
cd /DATA/Infrastructure/homelab/services/byparr
docker pull ghcr.io/thephaseless/byparr:3.0.4
cp .env.example .env
docker compose up -d
```

Then run the proving-phase `curl` checks above before touching Prowlarr.
