# FlareSolverr

A proxy that runs a headless browser specifically to solve Cloudflare's
JavaScript challenge on behalf of Prowlarr — some public indexers
(1337x, extratorrent-st) sit behind Cloudflare's bot-detection, which a
plain HTTP request from Prowlarr can't pass. FlareSolverr solves the
challenge once and hands back a working session, letting Prowlarr's
requests through.

Added specifically to unlock this whole *class* of indexer, not just
one — 1337x was abandoned entirely earlier (switched to The Pirate Bay
instead) rather than solved, when this exact problem first came up.

## Resource Trade-Off, Named Explicitly

This is a real cost worth being upfront about, not quietly absorbed:
running a headless browser has meaningfully more memory/CPU overhead
than anything else this lightweight in the stack, on a server that's
already a constrained 15W mobile CPU with 8GB RAM (see
`services/jellyfin/README.md` for the same hardware context). Worth it
given the goal (indexer diversity, directly useful for routing around
Real-Debrid content-availability blocks — see `services/sonarr/README.md`
project history), but if resource pressure ever becomes a real problem
on this box, this is one of the first places to look.

## Known Vulnerability: Bundled Chromium, Accepted Risk — Migration to Byparr Planned Next

Flagged by Trivy during Phase 5's security audit: this image bundles a
stale Debian-packaged Chromium (`148.0.7778.178-1~deb12u1`, several point
releases behind fixed upstream versions) — it accounts for 2138 of the
2141 HIGH/CRITICAL CVEs Trivy reports against this image, one root cause,
not thousands of independent problems. This is a real, meaningful risk
specifically for this service: FlareSolverr's whole job is fetching and
rendering whatever page an indexer sends it to solve a Cloudflare
challenge, which is exactly the vector a Chromium rendering-engine bug
would get triggered through — narrower network exposure (see below)
doesn't touch this.

**No local fix exists.** Checked directly (2026-08-22): FlareSolverr's
own latest release is `v3.5.0`, published 2026-05-26 — exactly what this
service already runs. Nothing newer has shipped in three months, and
community consensus is the project is no longer actively maintained.
Renovate is correctly configured to pick up any future release the
moment one exists (no exclusions in `renovate.json`), but there's
currently nothing for it to pick up, and that may not change.

**Accepted for now, not indefinitely.** Phase 5's `restrict-internal-ports`
firewall work (`docs/zimaos.md`) already closed the *inbound* path —
nothing on the LAN can reach this service directly anymore, only Prowlarr
via the docker-bridge hairpin. That's a real reduction in exposure, but
it doesn't eliminate the rendering-engine risk above, so this isn't fully
closed, just narrowed.

**Next planned step: migrate to [Byparr](https://github.com/ThePhaseless/Byparr)**
(`ghcr.io/thephaseless/byparr`) — a drop-in, API-compatible replacement
(same Prowlarr indexer-proxy interface, migration is repointing the URL,
not reconfiguring indexers), actively maintained with real CI/CD-published
releases, and built on Playwright rather than raw Selenium +
undetected-chromedriver — Playwright manages its own browser binary,
which is a structurally better position against exactly this class of
problem than FlareSolverr's approach. Not done yet: this repo's pattern
for swapping a pipeline dependency is proving the replacement in
isolation first (same as Decypharr's original standalone test before
Prowlarr/Radarr/Sonarr got wired to it) — needs deploying alongside
FlareSolverr and confirming it actually clears Cloudflare challenges for
the indexers currently tagged for it (1337x, extratorrent-st) before
cutting over.

## Image: Official, Pinned

`ghcr.io/flaresolverr/flaresolverr:v3.5.0` — FlareSolverr's own official
image, published on GHCR (not Docker Hub).

## Port: 8191 (Default), Checked Against the Existing Map

| Port | Service |
|---|---|
| 3000 | AdGuard Home (web UI) |
| 3001 | Uptime Kuma |
| 3002 | Grafana |
| 7878 | Radarr |
| 8080 | cAdvisor |
| 8096 | Jellyfin |
| 8191 | **FlareSolverr** |
| 8282 | Decypharr |
| 8989 | Sonarr |
| 9090 | Prometheus |
| 9100 | node-exporter |
| 9443 | Portainer |
| 9696 | Prowlarr |
| 9898 | Backrest |

## Volumes

None. FlareSolverr is stateless — no config file, no database, nothing
worth persisting across restarts.

## Deploy

```bash
cd /DATA/Infrastructure/homelab/services/flaresolverr
docker pull ghcr.io/flaresolverr/flaresolverr:v3.5.0
docker inspect ghcr.io/flaresolverr/flaresolverr:v3.5.0 --format '{{.Config.User}}'
```

Check the UID per the standing rule in `docs/storage.md` — though with
no volumes to `chown`, this is really just about confirming the
container starts cleanly, not about fixing permissions.

```bash
cp .env.example .env
docker compose up -d
```

## Wiring into Prowlarr

**Settings → Indexers → Indexer Proxies → Add** (FlareSolverr type):

- **Host URL**: `http://192.168.68.110:8191` — the host LAN IP, same
  reasoning as every other cross-container connection in this stack
  (Prowlarr↔Radarr/Sonarr, Radarr/Sonarr↔Decypharr): these are separate
  `docker compose` projects with no shared internal network, so a
  container name like `flaresolverr` won't resolve from Prowlarr's
  container — only the host IP will.
- **Request Timeout**: default (60s) is fine.
- **Tags**: pick something like `flaresolverr` — this tag is what
  actually activates the proxy; a proxy with no matching indexer tags
  does nothing.
- **Test**, then **Save**.

Then, per indexer that needs it (1337x, extratorrent-st): open the
indexer's own settings in Prowlarr, scroll to **Tags**, add the same
tag (`flaresolverr`), **Test**, **Save**. The proxy only engages for
requests where Prowlarr actually detects Cloudflare — it won't slow down
indexers that don't need it, even if tagged.
