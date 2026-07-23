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

## Open Questions

- **`/DATA/AppData/<service>` write permissions, unverified.** `zimaos.md`
  documents that `/DATA` itself is `root:root`, which is exactly what broke
  Git/SSH/Docker global config in Phase 0. We haven't yet confirmed whether
  newly created `AppData/<service>` subdirectories are writable by the
  non-root UIDs some containers run as (Docker will happily create a bind
  mount path as `root` if it doesn't exist, which can silently leave a
  container unable to write to its own data directory). This needs to be
  verified — not assumed — when the first service with a real bind mount
  (Portainer, Phase 2) is actually deployed, and the answer belongs in this
  document once known.
- **No offsite/second-medium backup yet.** Everything — primary data *and*
  the eventual `Backup/` directory — currently lives on the same single
  physical disk. A backup that lives on the same drive it's backing up
  doesn't protect against the one failure mode (drive death) most likely to
  happen. This is explicitly what `backup.md` needs to resolve, following
  something like the 3-2-1 rule (3 copies, 2 different media, 1 offsite) —
  not solved here, just flagged so it isn't forgotten between now and
  Phase 1's `backup.md`.
