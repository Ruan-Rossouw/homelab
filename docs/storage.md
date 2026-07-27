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

- **Second medium exists; offsite doesn't yet.** `/DATA/Backup` is now a
  physically separate disk from `/DATA/Media` (2 copies, 2 media), which
  covers the drive-death failure mode a same-disk backup wouldn't. It's
  still in the same room as the primary drive, though — theft, fire, or
  flood takes out both. The 3-2-1 rule's third leg (1 offsite) isn't met
  yet. This is part of why restic was chosen over a simpler tool like
  `rsync`: it can push the same repository to Backblaze B2 or another S3
  target later without changing tools, so the offsite leg is a
  configuration change, not a re-architecture. Not solved here — tracked as
  remaining work in `backup.md`.
