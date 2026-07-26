# Disaster Recovery

This document answers: **if the server dies today, what do I do?** For what's
backed up and why, see [`backup.md`](backup.md). For the physical layout
being recreated below, see [`storage.md`](storage.md).

## Scope — What This Covers, and What It Doesn't

This procedure assumes **the server itself (internal drive) is lost or dead,
but both external USB drives (`Media`, `Backup`) physically survive** — a
failed motherboard, a dead internal disk, a botched OS upgrade.

**It does not cover total loss of the physical location** (fire, theft,
flood) — there is currently no offsite copy of `/DATA/Backup` (see
`storage.md`'s Open Questions and `backup.md`'s Known Limitations). If both
external drives are lost simultaneously, the data on `/DATA/Media` beyond
whatever independently exists elsewhere (e.g. still on the source SSD) is
not recoverable by this procedure. That gap is known and tracked, not
missed here.

## Hard Prerequisite

**The restic repository password, saved outside Git** (a password manager —
it was never committed, deliberately; see `backup.md`). Without it, none of
the steps below can recover anything: restic encrypts the entire repository
with this password, so a physically intact `/DATA/Backup` drive is useless
without it. If it's lost along with the server, stop here — this is the one
single point of failure this whole plan has, and it lives outside `/DATA`
entirely on purpose.

## Recovery Steps

### 1. Base OS and Docker

Fresh ZimaOS install, enable Developer Mode and SSH (see `zimaos.md`).
Install/verify Docker is available.

### 2. Reconnect and Mount the External Drives

Identify drives by **label/UUID, never assumed `/dev/sdX` ordering** —
ZimaOS's own storage service can auto-mount drives to locations independent
of `fstab`, which is a real source of confusion (`zimaos.md`). Confirm with
`lsblk -o NAME,LABEL,UUID,FSTYPE`:

- `Mieke se hardeskyf`, `UUID=904861014860E784`, NTFS → `/DATA/Media`
- `ExtHD-1TB`, `UUID=6A64-686E`, exFAT → `/DATA/Backup`

Recreate the `/etc/fstab` entries (adjust device paths to match `lsblk`
output, but mount **by UUID**):

```text
UUID=904861014860E784  /DATA/Media   ntfs3   defaults,nofail  0  0
UUID=6A64-686E          /DATA/Backup  exfat   defaults,nofail  0  0
```

```bash
sudo mkdir -p /DATA/Media /DATA/Backup
sudo mount -a
```

### 3. Restore the Developer Environment and Repo

Follow the bootstrap process in `zimaos.md` (`GIT_CONFIG_GLOBAL`,
`DOCKER_CONFIG`, XDG directories), then:

```bash
mkdir -p /DATA/Infrastructure
cd /DATA/Infrastructure
git clone https://github.com/Ruan-Rossouw/homelab.git homelab
cd homelab
```

### 4. Redeploy Services

For every directory under `services/`, follow that service's own `README.md`
— each is an independent Compose project (`architecture.md`). Check the
container's expected UID before first start and `chown` the corresponding
`AppData` subdirectory if it's non-root (`storage.md`'s standing rule) —
though if `AppData` is being restored from backup in step 5 below, ownership
comes back with it and this is just a sanity check, not a fresh setup.

**Exception: SMB.** It's ZimaOS's native Samba, not a container — its
configuration lives in ZimaOS's own database, not Git. Follow the manual
runbook in `services/smb/README.md` to recreate the shares by hand.

### 5. Recreate the Backup Secrets File

```bash
cp scripts/backup.env.example scripts/backup.env
```

Edit `scripts/backup.env` and set `RESTIC_PASSWORD` to the **same password**
saved outside Git per the Hard Prerequisite above. `RESTIC_REPOSITORY`
stays as the template value (`/backup/repo`) — it's a path inside the
container, unrelated to the new host's directory layout.

### 6. Restore Data From the Backup Repository

This restores both `/DATA/Media` and `/DATA/AppData` directly back into
place, since the container's bind mounts match the exact paths recorded in
the snapshot:

```bash
docker run --rm --env-file scripts/backup.env \
  -v /DATA/Backup:/backup \
  -v /DATA/Media:/data/media \
  -v /DATA/AppData:/data/appdata \
  restic/restic:0.17.3 restore latest --target /
```

### 7. Verify Before Trusting It

Don't assume the restore worked — check it, the same way it was verified
when this document was written (`backup.md`):

```bash
docker run --rm --env-file scripts/backup.env -v /DATA/Backup:/backup \
  restic/restic:0.17.3 check
```

Spot-check a handful of restored files in `/DATA/Media` and `/DATA/AppData`
by eye (do photos open, does Grafana start with its dashboards intact) before
considering the server "recovered."

### 8. Re-enable the Scheduled Backup

The restore above brings back data, not the schedule. Re-run the systemd
install from `backup.md`:

```bash
sudo ln -sf /DATA/Infrastructure/homelab/scripts/systemd/homelab-backup.service /etc/systemd/system/homelab-backup.service
sudo ln -sf /DATA/Infrastructure/homelab/scripts/systemd/homelab-backup.timer /etc/systemd/system/homelab-backup.timer
sudo systemctl daemon-reload
sudo systemctl enable --now homelab-backup.timer
```

### 9. Reapply Anything Configured Outside Git

Anything stored in a service's own database rather than this repo needs
manual reapplication — e.g. AdGuard DNS rewrites, SMB shares (step 4 above).
Check each service's `README.md` for what, if anything, falls into this
category before considering the rebuild complete.
