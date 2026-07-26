# Backrest

A web UI and scheduler for restic — **the production backup mechanism**
(since 2026-07-26). It replaced the original `scripts/backup.sh` + systemd
timer design once tested and trusted; that mechanism is retired, its
reasoning preserved in git history and `docs/zimaos.md`. See
`docs/backup.md` for the full picture of what's backed up and how.

## What This Is, Mechanically

Backrest is a Go binary wrapping restic: it stores its own "plans" (a
source path + a repository + a schedule + a retention policy) and runs them
via its own internal scheduler, not systemd or `cron`. Because it's a
long-running container (`restart: unless-stopped`, same pattern as every
other service here), it isn't affected by the tmpfs-`/var` problem that
ruled out `cron` for the original setup (`docs/zimaos.md`) — its schedule
lives inside its own process, not on the host filesystem.

## Volumes, and Why Each One's There

- `/data`, `/config`, `/cache`, `/tmp` — Backrest's own operational state
  (plan definitions, job history, UI config), backed by
  `/DATA/AppData/backrest/`, same convention as every other service.
- `/data/media` and `/data/appdata` — the **same container-internal paths**
  the original `scripts/backup.sh` design used for `/DATA/Media` and
  `/DATA/AppData`. Deliberately matched, not arbitrary: restic records the
  path a file was backed up from as part of the snapshot tree, so the Plan
  here continues the same snapshot lineage rather than starting a second,
  disconnected backup history for the same data. Mounted read-only — this
  container should never be able to modify backup sources.
- `/repos/backup` — `/DATA/Backup`, mounted read-write (Backrest needs to
  write new snapshots and run `forget`/`prune`, unlike the read-only
  source mounts above).

## Deploy

```bash
mkdir -p /DATA/AppData/backrest/{data,config,cache,tmp}
cd /DATA/Infrastructure/homelab/services/backrest
docker pull ghcr.io/garethgeorge/backrest:v1.14.1
docker inspect ghcr.io/garethgeorge/backrest:v1.14.1 --format '{{.Config.User}}'
docker compose up -d
```

Check the UID from `docker inspect` before assuming anything, per the
standing rule in `docs/storage.md`. Backrest doesn't document a UID/GID
environment variable, which usually means it runs as root by default — if
so, no `chown` is needed: root inside the container reads `/DATA/AppData`
without friction, the same way the existing restic backups already do,
regardless of what a non-root SSH user can read directly on the host. If
`docker inspect` shows a non-root user, `chown` the four
`/DATA/AppData/backrest/*` directories to match before first start.

## First Run

Browse to `http://192.168.68.110:9898` and create an admin account — first
visit only, no separate setup wizard.

## Connecting to the Existing Repository

Repository path (inside this container): `/repos/backup/repo`. The
password is the same one generated during the original setup — retrieve it
from wherever it was saved outside Git (password manager), since
`scripts/backup.env` no longer exists to read it from.

## The Production Plan

One Plan, backing up `/data/media` and `/data/appdata` against the
repository above, on a nightly schedule, with retention set to 7 daily / 4
weekly / 6 monthly — matching the values `docs/backup.md` documents. This
is the sole scheduled backup mechanism for this homelab; there is no
systemd timer or `cron` job running alongside it.
