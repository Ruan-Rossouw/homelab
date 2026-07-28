# Prowlarr

The second piece of the Stage 2 automation pipeline (see
`services/decypharr/README.md` for Stage 2a, proven working). Prowlarr is
an indexer aggregator — it doesn't grab anything itself, it just manages a
list of indexers (public trackers, in this case — no private tracker
accounts to configure) and pushes search results to Radarr/Sonarr once
those exist.

Deployed alone first, same staged approach as everything else in this
stack: confirm Prowlarr itself works and can search its configured
indexers, before wiring it to Radarr/Sonarr (which don't exist yet) or to
Decypharr (which only Radarr/Sonarr talk to directly, not Prowlarr).

## Image: linuxserver.io, Not the Official Image

Prowlarr doesn't publish its own official Docker image the way Jellyfin
does — `lscr.io/linuxserver/prowlarr` is the de facto standard, widely
used and actively maintained. Pinned to `2.5.2`, the current stable
release as of this deploy.

## Port: 9696, Checked Against the Existing Map

| Port | Service |
|---|---|
| 3000 | AdGuard Home (web UI) |
| 3001 | Uptime Kuma |
| 3002 | Grafana |
| 8080 | cAdvisor |
| 8096 | Jellyfin |
| 8282 | Decypharr |
| 9090 | Prometheus |
| 9100 | node-exporter |
| 9443 | Portainer |
| 9696 | **Prowlarr** |
| 9898 | Backrest |

## Volumes

- `/DATA/AppData/prowlarr/config` → `/config` — indexer definitions, app
  connections (once Radarr/Sonarr exist), and Prowlarr's own settings.
  No shared/downloads volume needed here — Prowlarr never touches actual
  files, only search results and API calls.

## Deploy

```bash
mkdir -p /DATA/AppData/prowlarr/config
cd /DATA/Infrastructure/homelab/services/prowlarr
docker pull lscr.io/linuxserver/prowlarr:2.5.2
docker inspect lscr.io/linuxserver/prowlarr:2.5.2 --format '{{.Config.User}}'
```

Check the UID per the standing rule in `docs/storage.md` — and per the
gap documented there from the Decypharr deploy, don't stop at the image
inspection alone. linuxserver.io images use `PUID`/`PGID` environment
variables (set to `1000:1000` in `compose.yml`, matching the convention
used across this stack) and their own init process handles ownership
internally on first start — but confirm after first start
(`docker exec prowlarr id`, or check what UID owns files under `/config`)
rather than assuming.

```bash
cp .env.example .env   # adjust PROWLARR_PORT/TZ if needed
docker compose up -d
```

## First Run

Browse to `http://192.168.68.110:9696`. Add public indexers under
**Indexers → Add Indexer** — no private tracker accounts to configure,
per project decision. Prowlarr's own indexer list is the extent of what
this step tests; there's nothing to search *for* yet without Radarr/Sonarr
telling it what to look for.

## Status: Fully Wired In (2026-07-28)

Radarr and Sonarr are both connected under **Settings → Apps** and receive
Prowlarr's indexer list automatically. Decypharr is configured as the
download client directly in Radarr/Sonarr (Prowlarr never talks to a
download client itself). Full loop proven end-to-end for both movies and
TV — see `services/radarr/README.md` and `services/sonarr/README.md`.
