# Radarr

Third piece of the Stage 2 automation pipeline. Radarr is the movie
automation layer — it takes search results from Prowlarr, decides what to
grab based on quality profiles, hands the grab to Decypharr (its download
client), and imports/organizes the result once it's ready. This is where
*new* movies are actually searched for and requested — Jellyfin only ever
plays what's already in its library, it doesn't search anything itself.

Deployed on its own first, same staged approach as the rest of this
pipeline: get Radarr running and reachable before wiring it to Prowlarr
(Settings → Indexers, or Prowlarr's own Apps sync) or Decypharr (Settings
→ Download Clients).

## Image: linuxserver.io, Pinned

`lscr.io/linuxserver/radarr:6.3.0.10514-ls312` — Radarr, like Prowlarr,
doesn't publish its own official image; linuxserver.io is the de facto
standard. If this exact tag turns out to be wrong or superseded by the
time of deploy, `docker pull` will fail cleanly rather than silently
running something unexpected.

## Port: 7878 (Default, Checked Against the Existing Map)

| Port | Service |
|---|---|
| 3000 | AdGuard Home (web UI) |
| 3001 | Uptime Kuma |
| 3002 | Grafana |
| 7878 | **Radarr** |
| 8080 | cAdvisor |
| 8096 | Jellyfin |
| 8282 | Decypharr |
| 9090 | Prometheus |
| 9100 | node-exporter |
| 9443 | Portainer |
| 9696 | Prowlarr |
| 9898 | Backrest |

## Volumes

- `/DATA/AppData/radarr/config` → `/config` — Radarr's own database,
  quality profiles, and settings.
- `/DATA/AppData/decypharr/downloads` → `/downloads` — **the same host
  directory and the same container-internal path** Decypharr itself uses.
  This isn't optional consistency, it's a hard requirement: Decypharr's
  qBittorrent-shim API reports completed items by path, and if Radarr's
  own container sees a different path for the same file, it can't
  actually import it even though the download client says it's done.
  Matching paths exactly across containers is the standard, well-known
  pattern for *arr + download-client integration.

**Deliberately not yet decided:** a "movies" library root folder / volume
for Radarr's *own* organized output (after it imports and renames from
`/downloads`). Getting this wrong risks Radarr silently copying full
files out of the symlinked/DFS-backed content onto local disk — exactly
the local-storage growth this whole debrid-based pipeline is designed to
avoid. This needs to be a deliberate choice made once Radarr's actual
Import Settings UI is in front of us (hardlink vs. copy vs. move
behavior), not guessed at now.

## Deploy

```bash
mkdir -p /DATA/AppData/radarr/config
cd /DATA/Infrastructure/homelab/services/radarr
docker pull lscr.io/linuxserver/radarr:6.3.0.10514-ls312
docker inspect lscr.io/linuxserver/radarr:6.3.0.10514-ls312 --format '{{.Config.User}}'
```

Check the UID per the standing rule in `docs/storage.md` — same
linuxserver.io PUID/PGID pattern as Prowlarr, confirm the actual runtime
UID after first start rather than trusting the image inspection alone.

```bash
cp .env.example .env   # adjust RADARR_PORT/TZ if needed
docker compose up -d
```

## Not Yet Built

- **Connect to Prowlarr**: add Radarr under Prowlarr's Settings → Apps
  (or add Prowlarr's indexers directly in Radarr — Prowlarr's own Apps
  sync is the less error-prone path since it keeps indexer config in one
  place).
- **Connect to Decypharr**: add it under Radarr's Settings → Download
  Clients as a qBittorrent-type client, pointed at Decypharr's API.
- **Root folder / import behavior**: see above — a deliberate decision
  once we're looking at the actual Import Settings screen.
- **Sonarr** — the TV-show equivalent, next in the sequence.
