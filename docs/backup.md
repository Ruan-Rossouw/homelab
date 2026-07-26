# Backup

This document answers: **what is backed up, how, and how often?** For what to
do if the server itself is lost, see [`disaster-recovery.md`](disaster-recovery.md).
For where the data physically lives, see [`storage.md`](storage.md).

## Tool: restic

Backups are taken with [restic](https://restic.net/), chosen over a simpler
tool like `rsync` for one specific reason: it works identically against a
local path today and a cloud target (Backblaze B2, or any S3-compatible
store) later, without switching tools or re-architecting anything — just a
different `RESTIC_REPOSITORY` value. It also handles encryption and
deduplication natively, neither of which `rsync` gives you for free.

Restic runs as the official `restic/restic` Docker image, not a native
binary. This isn't a preference — ZimaOS has no package manager and a
read-only root filesystem, so a native install isn't possible. See
[`zimaos.md`](zimaos.md) for the full detail; running it as a container
sidesteps the constraint entirely and matches how every other service in
this repo is already deployed.

## What's Backed Up

- **`/DATA/Media`** — the primary media library (2 TB NTFS drive).
- **`/DATA/AppData`** — persistent state for every deployed service.

**Deliberately not backed up:**

- **`/DATA/Backup`** — the restic repository's own destination; backing up
  a repository into itself is meaningless.
- **`/DATA/Infrastructure/homelab`** (this repo) — already multi-copy via
  Git (Mac, GitHub, server clone), per the reasoning `roadmap.md` used to
  originally defer this document in Phase 1.
- **`/DATA/Infrastructure/developer`** — recreatable from `bootstrap.sh` and
  `zimaos.md`, not runtime state.

## How It Runs

`scripts/backup.sh` does two things, in order:

1. `restic backup /data/media /data/appdata` — the incremental backup.
2. `restic forget --prune` with the retention policy below.

Configuration lives in `scripts/backup.env` (gitignored — copy it from the
committed `scripts/backup.env.example` template on the server). It holds
the restic repository path and password.

**The password is not, and cannot be, recovered from Git.** Restic encrypts
the entire repository with it. Losing the password makes every snapshot on
`/DATA/Backup` permanently unreadable, even though the drive itself is
physically fine — it must be saved somewhere outside this repo (a password
manager) the moment it's generated. See `disaster-recovery.md` for why this
matters at restore time.

## Schedule

A systemd `.service` + `.timer` pair (`scripts/systemd/`), not `cron` —
ZimaOS's `/var` is `tmpfs`, so a cron job would silently stop surviving
reboots (see `zimaos.md`). Runs nightly at 03:00, with up to 15 minutes of
randomized delay to avoid always hitting the drives at the exact same
instant, and `Persistent=true` so a missed run (box off at 03:00) fires as
soon as it's back up.

The unit files are committed to the repo and **symlinked** (not copied)
into `/etc/systemd/system/`, so a future `git pull` keeps the live units in
sync automatically:

```bash
sudo ln -sf /DATA/Infrastructure/homelab/scripts/systemd/homelab-backup.service /etc/systemd/system/homelab-backup.service
sudo ln -sf /DATA/Infrastructure/homelab/scripts/systemd/homelab-backup.timer /etc/systemd/system/homelab-backup.timer
sudo systemctl daemon-reload
sudo systemctl enable --now homelab-backup.timer
```

Confirm it's actually scheduled with `systemctl list-timers homelab-backup.timer`.

## Retention Policy

`--keep-daily 7 --keep-weekly 4 --keep-monthly 6` — roughly a week of daily
granularity, a month of weekly, six months of monthly. Sized for the current
data volume (~240 GB) against a ~932 GB backup drive, with headroom for
restic's deduplication (unchanged files across snapshots cost close to
nothing after the first backup, so this is far cheaper than 17 full copies).
Revisit if data volume grows substantially — Immich and Home Assistant
(Phase 4) will add meaningfully more than the current mostly-static Media
library.

## Verified Working (2026-07-25)

A backup, unverified, is a hope, not a backup — so this was actually tested,
not just configured:

- First backup: 47,406 files, 239.969 GiB processed, 158.391 GiB stored
  (post-compression) in 6h32m. Expected to be the slowest run this backup
  will ever do, since it had no deduplication baseline.
- `restic check` — repository integrity check — passed clean: "no errors
  were found."
- Full restore of `/DATA/AppData` to a scratch directory, via:

  ```bash
  docker run --rm --env-file scripts/backup.env \
    -v /DATA/Backup:/backup -v /DATA/restore-test:/restore \
    restic/restic:0.17.3 restore latest --target /restore --include /data/appdata
  ```

- Byte-for-byte checksum match (`sha256sum`) between two live `/DATA/Media`
  files and the same files pulled back out of the repository via
  `restic dump latest <path>` — proves the encrypt/store/retrieve path is
  correct, not just that `restic backup` exits `0`.

## Known Limitations

- **No offsite copy yet.** `/DATA/Backup` is a second physical disk, but
  it's in the same room as `/DATA/Media` — fire, theft, or flood takes out
  both. This is exactly why restic was chosen over `rsync`: adding a
  Backblaze B2 target later is a config change (a second `RESTIC_REPOSITORY`
  destination), not a re-architecture. Tracked in `storage.md`'s Open
  Questions, not solved here.
- **File-level backup, not application-consistent.** `AppData` includes live
  databases (Grafana's SQLite, Portainer's BoltDB, Tailscale's state) that
  restic backs up as plain files, with no transactional quiescing. A backup
  could theoretically catch one of these mid-write. Low risk today — these
  files are tiny and mostly reproducible from provisioned config already in
  Git — but worth revisiting before Immich (Postgres) or Home Assistant
  (SQLite) land in Phase 4, where the data stops being reproducible.
- **Restore is manual, CLI-only.** That's sufficient for `disaster-recovery.md`,
  but there's no automated periodic restore-test — that's Phase 5 (Operations)
  territory, not required for the Phase 4 gate this document satisfies.
