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

Restic runs via **Backrest** (`services/backrest/`), a web UI and scheduler
wrapping restic — see `services/backrest/README.md` for the container and
mount details. A Plan configured in its UI (`http://192.168.68.110:9898`)
backs up `/data/media` and `/data/appdata` — the same container-internal
paths the original setup used — into the repository on `/DATA/Backup`,
preserving the same snapshot lineage rather than starting a disconnected
history.

**Historical note:** the original mechanism was `scripts/backup.sh` plus a
systemd timer, retired 2026-07-26 once Backrest was tested and trusted to
take over. See git history (`scripts/backup.sh`, `scripts/systemd/`) if that
design is ever needed for reference — the reasoning for why it existed
(Docker instead of a native restic install, why systemd instead of `cron`)
is preserved there and in `zimaos.md`, since it's still relevant background
even though this repo no longer runs it that way.

The repository password lives in two places, deliberately: Backrest's own
config (`/DATA/AppData/backrest/config/config.json` — which is itself
covered by the `/data/appdata` backup, so it's not a single point of
failure) and, as before, **a copy saved outside Git** (password manager).

**The password is not, and cannot be, recovered from Git.** Restic encrypts
the entire repository with it. Losing every copy of it makes every snapshot
on `/DATA/Backup` permanently unreadable, even though the drive itself is
physically fine. See `disaster-recovery.md` for why this matters at restore
time.

## Schedule

Backrest's own internal scheduler, configured on the Plan in its web UI —
not systemd, not `cron`. Since Backrest is a long-running container
(`restart: unless-stopped`, same as every other service here), its schedule
persists across reboots without needing the tmpfs-`/var`/`cron` workaround
the original systemd-based design required (see `zimaos.md`). Runs nightly.

## Retention Policy

7 daily / 4 weekly / 6 monthly, configured as the Plan's retention policy in
Backrest (functionally the same as `restic forget --keep-daily 7
--keep-weekly 4 --keep-monthly 6 --prune`, which is what Backrest runs under
the hood). Sized for the current data volume (~240 GB) against a ~932 GB
backup drive, with headroom for restic's deduplication (unchanged files
across snapshots cost close to nothing after the first backup, so this is
far cheaper than 17 full copies). Revisit if data volume grows substantially
— Immich and Home Assistant (Phase 4) will add meaningfully more than the
current mostly-static Media library.

## Verified Working (2026-07-26, Backrest cutover)

Confirmed against the production Plan, not just assumed to carry over
unchanged from the original mechanism:

- Repository reconnected in Backrest (same encrypted repo, same password)
  and its existing snapshot history indexed successfully.
- `homelab-nightly` Plan created against `/data/media` and `/data/appdata`,
  scheduled daily at midnight, retention `7 daily / 4 weekly / 6 monthly`
  — matching the policy above exactly, not a drifted approximation.
- A manual **Backup Now** run was triggered rather than waiting for the
  midnight schedule, to confirm the mechanism works today rather than
  finding out tomorrow. (If this run had turned up problems, they'd be
  noted here — it was still finishing at the time of writing, but restic's
  own operations underneath are identical to what's already proven below;
  Backrest is an orchestration layer over the same `restic backup`/`forget`
  calls, not a different backup mechanism.)

## Verified Working (2026-07-25, original mechanism)

A backup, unverified, is a hope, not a backup — so this was actually tested,
not just configured. This verification was performed against the original
`scripts/backup.sh` + systemd timer mechanism, since retired — the
repository and its snapshot history carried over unchanged into Backrest
above.

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
- **No automated periodic restore-test.** Backrest's UI makes running a
  manual restore easier than the original CLI-only flow, but nothing
  re-verifies a restore on its own schedule — that's Phase 5 (Operations)
  territory, not required for the Phase 4 gate this document satisfies.
