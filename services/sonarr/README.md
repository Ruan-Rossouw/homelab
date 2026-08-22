# Sonarr

The TV-show equivalent of Radarr — see `services/radarr/README.md` for
the full reasoning behind this pipeline's shape, since Sonarr follows the
exact same proven pattern rather than re-deriving it from scratch. Sonarr
takes search results from Prowlarr, decides what to grab based on quality
profiles, hands the grab to Decypharr (its download client), and
imports/organizes the result — the TV/episode-tracking counterpart to
Radarr's movie automation.

Deployed with the full, already-proven volume setup from the start
(unlike Radarr, which discovered these requirements one failed import at
a time) — see Radarr's README for the discovery process behind each of
these if the "why" isn't obvious:

## Image: linuxserver.io, Pinned

`lscr.io/linuxserver/sonarr:4.0.19.2979-ls320` — same de facto standard
as Prowlarr/Radarr, no official image published by the Sonarr project
itself.

## Port: 8989 (Default)

See [`docs/networking.md`](../../docs/networking.md#port-map) for the
full port map.

## Volumes

- `/DATA/AppData/sonarr/config` → `/config` — Sonarr's own database,
  quality profiles, and settings.
- `/DATA/AppData/decypharr/downloads` → `/downloads` — same host
  directory and container-internal path as Decypharr and Radarr. Required
  for Sonarr to see completed downloads at the same path Decypharr
  reports them at.
- `/DATA/AppData/decypharr/mnt` → `/mnt`, mounted `rshared` — same DFS
  mount as Decypharr and Radarr. Required for Sonarr to actually resolve
  the *target* of Decypharr's symlinks (which use absolute `/mnt/...`
  paths), not just see the symlink files themselves. Radarr hit a real
  `FileNotFoundException` without this; built in from the start here.
- `/DATA/AppData/media-library/tv` → `/tv` — Sonarr's organized library
  output, set as its **Root Folder**. Its own dedicated location,
  parallel to Radarr's `/movies` — not shared with Radarr's folder, not
  `/downloads`, not `/DATA/Media`.

## Deploy

```bash
mkdir -p /DATA/AppData/sonarr/config /DATA/AppData/media-library/tv
cd /DATA/Infrastructure/homelab/services/sonarr
docker pull lscr.io/linuxserver/sonarr:4.0.19.2979-ls320
docker inspect lscr.io/linuxserver/sonarr:4.0.19.2979-ls320 --format '{{.Config.User}}'
```

Check the UID per the standing rule in `docs/storage.md` — same
linuxserver.io PUID/PGID pattern as Prowlarr/Radarr.

```bash
cp .env.example .env   # adjust SONARR_PORT/TZ if needed
docker compose up -d
```

## First Run — Same Sequence as Radarr

1. **Root Folder**: Settings → Media Management → Root Folders → Add →
   `/tv`.
2. **Connect to Prowlarr**: in Prowlarr, Settings → Apps → Add
   Application → Sonarr. Both server URLs use the **host LAN IP**
   (`http://192.168.68.110:8989` / `http://192.168.68.110:9696`), never
   `localhost` — these are separate `docker compose` projects.
3. **Connect to Decypharr**: Settings → Download Clients → Add →
   qBittorrent. Host `192.168.68.110`, port `8282`, **username/password**
   (Decypharr's own admin credentials — not an API key), category `sonarr`.
4. **Real test**: add a TV show, let Sonarr search/grab/import an episode
   via Prowlarr → Decypharr → Real-Debrid, same as Radarr's Spider-Man
   test. Confirm the result the same way — inspect the actual file in
   `/tv/<show>/` and confirm it's a symlink pointing into
   `/mnt/decypharr/__all__/...`, not a full copy.

**One gotcha hit during setup**: adding a series doesn't auto-search by
default the way adding a movie does in Radarr — "Start search for
missing episodes" needs to be checked when adding, or trigger it
manually afterward via **Search Monitored** in the series' own toolbar.

## Proven Working (2026-07-28)

Full loop confirmed end-to-end — a real series (*The Agency*, Season 2,
10 episodes) grabbed in one shot via Prowlarr → Decypharr → Real-Debrid,
all 10 episodes correctly symlinked under `/tv/The Agency (2024)/Season
2/` into `/mnt/decypharr/__all__/...`, confirmed readable. Same
symlink-not-copy result as Radarr, no special configuration needed
beyond the volumes already set up from the start.

## Status

**Stage 2c done (2026-07-28)**: `/movies` and `/tv` are shared into
Jellyfin and both libraries scan and play correctly. The Stage 1 scanner
bug did not recur against real content — see
`services/jellyfin/README.md`'s "Stage 2c" section for the confirmed
result. Nothing outstanding for this service.
