# ZimaOS Notes

## HOME Directory

ZimaOS sets HOME=/DATA.

However, /DATA is not writable by non-root users.

## Read-Only Root, No Package Manager

`/` is `squashfs`, mounted `ro`. There is no `apt`, `dpkg`, or `opkg` —
ZimaOS doesn't ship a Debian-style package manager at all, so there's no
`apt-get install` fallback to reach for.

`/usr` is also read-only: it's a `systemd sysext` overlay, composed at boot
from extension images under `/run/systemd/sysext/extensions/`. This is how
ZimaOS layers in its own components (Files, PeerDrop, etc.) without touching
the base squashfs image. One consequence worth knowing: `/usr/local/bin`
doesn't exist as a path at all (not merely unwritable — `mkdir`/`touch`
against it fails with "No such file or directory"), because nothing in the
sysext layers created it.

`/opt` is a real writable `ext4` mount, but denies writes to a non-root user
at the permission layer — the same category of appliance-permission
friction as the `/DATA` `root:root` issue below, not a separate problem.

**Working with this rather than against it:** don't chase a native binary
install onto this box — `chown`-ing `/opt` or otherwise forcing write access
repeats the exact fight this project already rejected for `/DATA` (see
`architecture.md`, "The ZimaOS Permission Model"). Anything that would
normally be a native package or binary runs as a Docker container instead —
consistent with how every other service in this repo is already deployed,
and it sidesteps the read-only root entirely. See `services/` for the
pattern and `backup.md` for a concrete example (restic).

## `/var` Is `tmpfs` — Cron Jobs Don't Survive a Reboot

`/var` is RAM-backed (`tmpfs`), wiped on every reboot. A `cron` job — if a
cron daemon is even present — would be written to `/var/spool/cron` and
silently disappear the next time the box restarts: no error, no warning, the
job just stops running. This is the same class of "looks fine, silently
broken" failure as the Prometheus permission crash-loop from Phase 3
(`storage.md`), just in scheduling instead of container startup.

`systemd` is confirmed as PID 1, and `/etc` is a writable, persistent
overlay (`overlayfs` on `/etc`, backed by `/mnt/overlay`) — this is why
`/etc/fstab` edits survive reboots. **Anything that needs to run on a
schedule uses a systemd `.service` + `.timer` pair**, not `cron` — it's the
one scheduling mechanism on this box that's both native and actually
persistent.

## Storage Service vs. Manual Mounts

ZimaOS runs its own storage-management service that can auto-mount external
drives to locations of its own choosing, independent of whatever's in
`/etc/fstab`. This isn't a hard conflict — a block device can have multiple
simultaneous mount points — but it's a real source of confusion when
inspecting mounts (`df`/`mount` output can show a drive twice, at two
different paths, for two different reasons). When mounting external drives,
verify by `UUID`/label (`lsblk`, not assumed `/dev/sdX` ordering) and confirm
the mount point you expect (e.g. `/DATA/Media`) is the one actually in
`/etc/fstab`, rather than trusting ZimaOS's own storage UI to reflect it.

## Developer Bootstrap

To provide a standard Linux developer experience, this project redirects developer tooling using:

- GIT_CONFIG_GLOBAL
- DOCKER_CONFIG
- XDG_CONFIG_HOME
- XDG_CACHE_HOME
- XDG_STATE_HOME

The bootstrap script is located at:

/DATA/Infrastructure/developer/bootstrap.sh
