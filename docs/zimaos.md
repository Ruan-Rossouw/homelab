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

## Host-Level systemd Customizations (Not Tracked in Git)

A couple of things live directly in `/etc/systemd/system/` on the server
itself rather than in this repo — genuine host configuration, not a Docker
Compose concern, so `git pull` never touches them. Documented here so a
rebuild (or a confused "why isn't this in the repo" moment) has a paper
trail; `disaster-recovery.md` points back here rather than duplicating it.

### Docker Waits for External Mounts Before Starting

`/etc/systemd/system/docker.service.d/wait-for-mounts.conf`, added
2026-07-29:

```ini
[Unit]
After=DATA-Media.mount DATA-Backup.mount
```

`/DATA/Media` and `/DATA/Backup` are external USB drives mounted via
`fstab` with `nofail` (so a missing drive never blocks boot), but `nofail`
also means nothing guarantees they're mounted *before* Docker starts
trying to bring containers up — a real risk on a cold boot after a full
power cut, where USB enumeration can be slower than after a warm reboot.
`services/backrest/compose.yml` bind-mounts both directly; without this,
Docker's default behavior for a missing bind-mount source (silently
create an empty directory instead of erroring) could leave Backrest
pointed at nothing. Deliberately **`After=`, not `RequiresMountsFor=`** —
the latter would make all of Docker hard-fail to start if either drive
were ever genuinely missing, undoing the entire reason `nofail` was
chosen for these mounts in the first place.

Recreate on a rebuild:

```bash
sudo mkdir -p /etc/systemd/system/docker.service.d
sudo tee /etc/systemd/system/docker.service.d/wait-for-mounts.conf > /dev/null <<'EOF'
[Unit]
After=DATA-Media.mount DATA-Backup.mount
EOF
sudo systemctl daemon-reload
```

### Backlight Off at Boot

`/etc/systemd/system/backlight-off.service`, added 2026-07-30. The server
is a laptop with its own built-in screen, which otherwise stays on 24/7
for no reason — this is a headless box, managed over SSH and web UIs,
nobody's meant to be looking at the physical display. Closing the lid
doesn't turn the backlight off on its own here (confirmed live — the lid
switch isn't wired to display power on this hardware, only to system
suspend, which is separately configured to do nothing). This service
turns the backlight off unconditionally at every boot instead.

The exact device path is hardcoded (`intel_backlight`, this hardware's
Intel UHD 620), not a glob — a glob (`/sys/class/backlight/*/bl_power`)
worked fine when run interactively but failed under systemd's
non-interactive `ExecStart=` context ("No such file or directory," the
pattern left unexpanded), even though the device clearly existed at the
time. Root cause not fully chased down; hardcoding the known-good path
sidesteps it entirely and is more predictable for a boot-time unit
regardless. **On different hardware**, confirm the actual device name
first — `ls /sys/class/backlight/` — rather than assuming `intel_backlight`
carries over.

```ini
[Unit]
Description=Turn off laptop display backlight at boot (headless server, screen not needed)
After=multi-user.target

[Service]
Type=oneshot
ExecStart=/bin/sh -c 'echo 1 > /sys/class/backlight/intel_backlight/bl_power'
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
```

**To turn the screen back on** (e.g. for a BIOS check or other physical
access):

```bash
echo 0 | sudo tee /sys/class/backlight/intel_backlight/bl_power
```

It'll turn itself off again on the next reboot via this service — that's
by design, not something to "fix." To disable the automatic behavior
entirely: `sudo systemctl disable --now backlight-off.service`.

Recreate on a rebuild:

```bash
sudo tee /etc/systemd/system/backlight-off.service > /dev/null <<'EOF'
[Unit]
Description=Turn off laptop display backlight at boot (headless server, screen not needed)
After=multi-user.target

[Service]
Type=oneshot
ExecStart=/bin/sh -c 'echo 1 > /sys/class/backlight/intel_backlight/bl_power'
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now backlight-off.service
```

## Developer Bootstrap

To provide a standard Linux developer experience, this project redirects developer tooling using:

- GIT_CONFIG_GLOBAL
- DOCKER_CONFIG
- XDG_CONFIG_HOME
- XDG_CACHE_HOME
- XDG_STATE_HOME

The bootstrap script is located at:

/DATA/Infrastructure/developer/bootstrap.sh
