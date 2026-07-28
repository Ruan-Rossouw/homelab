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

- `/DATA/AppData/decypharr/mnt` → `/mnt`, mounted `rshared` — **the same
  host directory, container-internal path, and propagation mode**
  Decypharr itself uses for its DFS mount. Discovered as a hard
  requirement, not an optimization, via a real failed import: Decypharr's
  "Create Symlink" post-download action creates symlinks using
  **absolute paths into `/mnt`** (e.g.
  `/mnt/decypharr/__all__/<title>/<file>`). Radarr sees the symlink fine
  via the shared `/downloads` mount, but without `/mnt` also mounted into
  Radarr's own container, that symlink's target doesn't exist from
  Radarr's point of view — a dangling link, `FileNotFoundException` on
  import, even though the file is right there from Decypharr's side.
- `/DATA/AppData/media-library/movies` → `/movies` — Radarr's organized
  library output, set as its **Root Folder**. Deliberately a new, shared
  location — not `/downloads` (Decypharr's territory) and not
  `/DATA/Media` (the household's personal photo/video drive, explicitly
  not for this pipeline). This is meant to be the path Jellyfin eventually
  points a library at too (Stage 2c), same convention Sonarr's `/tv`
  equivalent should follow.

**Import behavior — confirmed via a real test, not assumed.** Radarr's
Media Management → Advanced settings has **"Use Hardlinks instead of
Copy"** (checked by default), but no separate "Use Symlinks" toggle
exists in this version despite some older documentation describing one.
Real test result (Spider-Man (2002), 2026-07-28): a hardlink from the
DFS-backed source into `/movies` isn't possible (different filesystems —
Decypharr's DFS mount vs. a normal AppData volume), but **Radarr's actual
fallback is to create a symlink, not to silently copy the file**.
Confirmed by inspecting the result directly:
`/movies/<title>/<file> -> /mnt/decypharr/__all__/<title>/<file>`
(`lrwxrwxrwx`), and confirming that target reads correctly. This is the
best-case outcome for this pipeline's whole reason for existing — zero
bytes duplicated onto local disk — and it required no special
configuration to get; Radarr just does the right thing here on its own
once `/mnt` is correctly mounted into its container (see above).

## Deploy

```bash
mkdir -p /DATA/AppData/radarr/config /DATA/AppData/media-library/movies
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

## Proven Working (2026-07-28)

Full loop confirmed end-to-end: Prowlarr connection (Settings → Apps,
Full Sync), Decypharr as the qBittorrent-type download client, and a
real search → grab → symlink-import, all using host-IP addressing
between containers (never `localhost` — see the Decypharr/Prowlarr setup
notes for why). See the import-behavior note above for the actual
(good) result on hardlink-vs-symlink-vs-copy.

One real-world gotcha hit along the way, not a bug in this stack: some
Real-Debrid "cached" torrents return an **empty download link**
(`reason=empty_link` in Decypharr's logs) despite showing as cached —
observed specifically with a major-studio blockbuster (The Dark Knight),
not with an open-source test file or an older/less-mainstream title
(Spider-Man (2002) worked fine). This is Real-Debrid's own content
policy, not something to debug in our containers if it happens again.

## Status

Sonarr (the TV-show equivalent) and Stage 2c (Jellyfin libraries) are
both done — see `services/sonarr/README.md` and
`services/jellyfin/README.md`. Nothing outstanding for this service.
