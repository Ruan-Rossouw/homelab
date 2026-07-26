# Backrest

A web UI and scheduler for restic — added as a more convenient way to view
backup history and manage restores than the CLI commands used to set up and
verify the original backup (see `docs/backup.md`).

**Not yet the production backup mechanism.** `scripts/backup.sh` plus the
systemd timer remain authoritative until this has actually been tested —
see "Important" below before configuring anything.

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
  `scripts/backup.sh` already uses for `/DATA/Media` and `/DATA/AppData`.
  Deliberately matched, not arbitrary: restic records the path a file was
  backed up from as part of the snapshot tree, so if a plan inside Backrest
  is ever pointed at these same paths and the existing repository, it
  continues the same snapshot lineage instead of starting a second,
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

## Important: Don't Double-Schedule the Existing Backup Yet

The repository at `/DATA/Backup` (`/repos/backup` inside this container) is
already the live, verified backup target for the systemd timer
(`docs/backup.md`). If you add it as a repository inside Backrest:

- **Fine:** browsing existing snapshot history, or testing a restore —
  read-only operations don't conflict with anything.
- **Not yet:** creating a *scheduled* plan against it. Two independent
  schedulers (the systemd timer and Backrest) both triggering backups
  against the same repository won't corrupt anything — restic's locking
  handles concurrent access safely — but they can collide mid-run and
  are redundant regardless.

Once Backrest's been tested and is trusted enough to take over, retiring
the systemd timer in its favor is a `docs/backup.md` update to make
deliberately, not a side effect of clicking around this UI.

## Connecting to the Existing Repository

To point Backrest at the same repository the systemd timer already uses
(for browsing, or eventually for real): repository path
`/repos/backup/repo`, same password as `RESTIC_PASSWORD` in
`scripts/backup.env` on this server — it's the same encrypted repository,
so it takes the same key.
