# Storage

This document answers: **where does data live, and why there?** For how that
data gets protected, see `backup.md` and `disaster-recovery.md` (in progress,
gating Phase 4 — see `roadmap.md`). For the developer-environment permission
workaround, see [`zimaos.md`](zimaos.md).

## Physical Storage

Three physical drives, each a single point of failure on its own — no RAID
at any layer (the hardware doesn't support it, one drive bay for the internal
disk, the other two are USB-attached), so RAID protection isn't a choice
being made here, it's a constraint being worked around:

- **Internal drive** — ext4, ~904 GB, mounted at `/DATA`. Hosts
  `AppData/` and `Infrastructure/` only (94 MB total as of Phase 3) —
  deliberately not used for media or backups.
- **2 TB external USB drive** — NTFS, label `Mieke se hardeskyf`,
  `UUID=904861014860E784`, mounted at `/DATA/Media`. The primary media
  library: the drive's own original content plus a photo/video collection
  migrated from a separate 1 TB drive that has since been repurposed below.
- **1 TB external USB drive** — exFAT, label `ExtHD-1TB`, `UUID=6A64-686E`,
  mounted at `/DATA/Backup`. Reformatted from HFS+ (its original filesystem
  from prior use on a Mac) to exFAT so Linux can mount it natively — the
  reformat itself went through a Mac, since macOS reads/writes both
  filesystems natively but Linux's HFS+ support proved unreliable. This is
  the restic backup destination (see `backup.md`).

This is exactly why `backup.md` matters: RAID protects against a drive
failing mid-operation; it does nothing for accidental deletion, corruption,
or ransomware. Until `backup.md`'s mechanism is actually running (not just
documented), the data on `/DATA/Media` remains unprotected.

**Disk health monitoring — closed 2026-08-22.** With no RAID at any layer,
a capacity alert alone ("drive is full") was never enough — nothing
watched for "drive is dying" until now. `docs/zimaos.md`'s "SMART Disk
Health Capture" section adds a host-level systemd timer that feeds SMART
health/attribute data into node-exporter's textfile collector, backing
two Grafana alerts: overall SMART health FAILED
(`smart_health_failed`), and a Reallocated/Pending sector count going
nonzero (`smart_reallocated_pending_sectors`) — the classic early-warning
sign that precedes an outright failure. All three drives get capacity
alerts too as of the same date (`/DATA`, `/DATA/Media`, `/DATA/Backup` —
Media had been missing one). Known gap: the sector-count alert only
covers SATA-attribute drives, not NVMe (not confirmed which interface
this box's drives actually use) — see `docs/zimaos.md` for detail.

### Mounting External Drives

Both external drives are wired into `/etc/fstab` by `UUID` (not device name —
`/dev/sdX` assignment isn't guaranteed stable across reboots on a box with
multiple USB drives) with the `nofail` option, since a USB drive being
unplugged should never block the server from booting. `/etc/fstab.bak` is
kept on the server as a pre-edit snapshot of the file. This is server-local
state, not something `git clone` restores — see `disaster-recovery.md` for
the exact entries to recreate it.

## `/DATA` Layout

```text
/DATA
├── AppData/<service>       # persistent application data, one dir per service (internal drive)
├── Backup/                 # restic backup destination — separate 1TB exFAT USB drive, see backup.md
├── Media/                  # media library — separate 2TB NTFS USB drive (Jellyfin, Phase 4)
└── Infrastructure/
    ├── homelab/             # this git repo
    ├── docker-config/       # DOCKER_CONFIG target
    └── developer/           # XDG-style developer environment (see zimaos.md)
```

`Media/` and `Backup/` are mount points for distinct physical disks, not
directories on the internal drive — losing the internal drive doesn't take
either of them down, and vice versa.

## Persistent Data Convention

Application state lives at `/DATA/AppData/<service-name>/`, bind-mounted into
that service's containers — never inside the Git repo. This is the storage
side of the "repo defines infrastructure, it doesn't hold state" principle in
`architecture.md`: `/DATA/AppData` can be large, binary, and constantly
changing; the repo stays small, textual, and diffable.

The repo itself lives on the server at `/DATA/Infrastructure/homelab/`, kept
separate from both application state (`AppData/`) and the developer
environment (`Infrastructure/developer/`) so that wiping or rebuilding one
doesn't touch the others.

## AppData Permissions: Non-Root Containers Need an Explicit `chown`

Answered, not assumed — verified when Prometheus (Phase 3) first hit this.
`/DATA` itself is `root:root` (`zimaos.md`), but a freshly-`mkdir`'d
`AppData/<service>` subdirectory is owned by whichever user ran the
command, not by `root` and not by whatever UID the container happens to run
as. Every service through Phase 2 (Portainer, AdGuard, Tailscale) and
Uptime Kuma in Phase 3 sidestepped this by running as root inside the
container, which can always write regardless of host-side ownership.
Prometheus was the first to run as a non-root UID by default (`nobody`,
`65534`) — its container hit `permission denied` on startup and sat in a
silent restart loop (looked "up" in `docker ps`, actually crash-looping)
until `services/prometheus/README.md`'s deploy steps added an explicit
`chown -R 65534:65534` before first start.

**Standing rule going forward:** before deploying any service, `docker pull`
the image first (`docker inspect` only works on images already present
locally — Grafana's deploy hit exactly this ordering mistake), check what
UID it runs as (`docker inspect <image> --format '{{.Config.User}}'`), and
`chown` the `AppData` directory to match *before* first start if it's
non-root — don't wait for a crash loop to reveal it.

**That check alone isn't always sufficient** — Decypharr (Phase 4) exposed
a gap: `docker inspect`'s `Config.User` reflects the image's *declared*
default, but some entrypoint scripts drop privileges to a different UID
internally at runtime regardless (Decypharr's does, starting as root and
switching to `1000:1000`), which `docker inspect` on the image can't see.
This didn't crash-loop the way Prometheus did — it surfaced instead as a
permission error partway through Decypharr's own setup wizard, when it
tried to create a directory under a mount the declared-root check had
said was fine. If a service behaves like it's ignoring an already-correct
`chown`, check the *actual running* UID after first start
(`docker exec <container> id`, or check which UID owns files the
container has already created) rather than trusting the pre-start image
inspection alone.

## Open Questions

- **3-2-1 is now met, at reduced verification confidence on the offsite
  leg.** `/DATA/Backup` (2 copies, 2 media — drive-death protection) plus
  a Backblaze B2 repository (offsite, started 2026-07-27, structurally
  verified 2026-07-28) closes all three legs. See `backup.md`'s "Verified
  Working (2026-07-28, B2 offsite)" for exactly what was checked — a
  metadata-only `restic check` plus a single-directory restore, not the
  full data-read check and full restore the local copy got, a deliberate
  cost trade-off rather than an oversight.
