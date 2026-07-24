# Storage

This document answers: **where does data live, and why there?** For how that
data gets protected, see `backup.md` and `disaster-recovery.md` (both still
TODO in Phase 1). For the developer-environment permission workaround, see
[`zimaos.md`](zimaos.md).

## Physical Storage

A single 1 TB HDD. No RAID, no redundancy at the disk layer — the hardware
doesn't support it (one drive bay), so it isn't a choice being made here, it's
a constraint being worked around. That constraint is exactly why `backup.md`
matters more than it would on redundant storage: RAID protects against a
drive failing mid-operation; it does nothing for accidental deletion,
corruption, or ransomware, and this box has neither RAID nor, yet, a backup
strategy. Until `backup.md` exists, everything under `/DATA` is a single
point of failure.

## `/DATA` Layout

```text
/DATA
├── AppData/<service>       # persistent application data, one dir per service
├── Backup/                 # backup destination — see backup.md
├── Media/                  # media library (Jellyfin, Phase 4)
└── Infrastructure/
    ├── homelab/             # this git repo
    ├── docker-config/       # DOCKER_CONFIG target
    └── developer/           # XDG-style developer environment (see zimaos.md)
```

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

**Standing rule going forward:** before deploying any service, check what
UID its image runs as (`docker inspect <image> --format '{{.Config.User}}'`)
and `chown` the `AppData` directory to match *before* first start if it's
non-root — don't wait for a crash loop to reveal it.

## Open Questions

- **No offsite/second-medium backup yet.** Everything — primary data *and*
  the eventual `Backup/` directory — currently lives on the same single
  physical disk. A backup that lives on the same drive it's backing up
  doesn't protect against the one failure mode (drive death) most likely to
  happen. This is explicitly what `backup.md` needs to resolve, following
  something like the 3-2-1 rule (3 copies, 2 different media, 1 offsite) —
  not solved here, just flagged so it isn't forgotten between now and
  Phase 1's `backup.md`.
