# Seerr

The request UI — the piece originally planned as "Jellyseerr" and
deliberately deferred until the core pipeline was proven (see project
history). It's the only genuinely optional piece of this whole stack:
it just watches Jellyfin/Radarr/Sonarr from the outside and lets
household members request content through a UI instead of you manually
searching and adding things in Radarr/Sonarr directly. Nothing else in
this pipeline depends on it.

## Decision: Seerr, Not Jellyseerr

Same situation as rdt-client → Decypharr earlier in this project:
**Jellyseerr is no longer independently maintained.** It's been
consolidated with Overseerr (the Plex-focused equivalent) into a single
project called **Seerr**, which is the actively developed successor to
both. Deploying under the old name would mean starting on something
already superseded — this repo uses `services/seerr/`, not
`services/jellyseerr/`, for the same reason it uses Decypharr instead of
rdt-client.

## Image: Official, Pinned

`ghcr.io/seerr-team/seerr:v3.0.0` — the project's own official image,
published on GHCR.

## Port: 5055 (Default)

See [`docs/networking.md`](../../docs/networking.md#port-map) for the
full port map.

## Volumes

- `/DATA/AppData/seerr/config` → `/app/config` — Seerr's own database,
  user accounts, and settings. Bind-mounted rather than the named Docker
  volume shown in the project's own quick-start example, to stay
  consistent with this repo's convention (every other service uses
  `/DATA/AppData/<service>`, not anonymous/named volumes).

## Deploy

```bash
mkdir -p /DATA/AppData/seerr/config
cd /DATA/Infrastructure/homelab/services/seerr
docker pull ghcr.io/seerr-team/seerr:v3.0.0
docker inspect ghcr.io/seerr-team/seerr:v3.0.0 --format '{{.Config.User}}'
```

Check the UID per the standing rule in `docs/storage.md` before first
start, same as every other service.

```bash
cp .env.example .env
docker compose up -d
```

## First Run

Browse to `http://192.168.68.110:5055` and walk through the setup
wizard:

1. Sign in with your Jellyfin account (Seerr uses Jellyfin's own auth,
   not a separate account system).
2. **Jellyfin connection**: `http://192.168.68.110:8096` — host LAN IP,
   same reasoning as every other cross-container connection in this
   stack (separate `docker compose` projects, no shared internal
   network, so a container name won't resolve).
3. **Radarr connection**: Settings → Services → Add Radarr Server —
   `192.168.68.110`, port `7878`, API key from Radarr's own Settings →
   General → Security, and point it at the same **Root Folder**
   (`/movies` as Seerr will see it, via Radarr's own path — this is
   Radarr's path, not Seerr's own filesystem) and quality profile
   (`Custom - 2160p - 1080p`) already set up.
4. **Sonarr connection**: same pattern — `192.168.68.110`, port `8989`,
   Sonarr's own API key, its root folder and quality profile.

Once connected, requesting something through Seerr's UI hands it to
Radarr/Sonarr exactly the same way manually adding it there would —
same quality profile, same language enforcement, same Decypharr/Real-Debrid
pipeline underneath.

## Not Yet Built

- Scoped external access (letting people outside the household reach
  only Jellyfin/Seerr, not the whole tailnet) — explicitly parked, see
  project memory. Not needed for household-only use.
