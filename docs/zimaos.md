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

### Restrict Internal-Only Services to Loopback + Docker Traffic

`/etc/systemd/system/restrict-internal-ports.sh` +
`/etc/systemd/system/restrict-internal-ports.service`, added 2026-08-21 as
the first fix out of Phase 5's security-hardening audit (see
`docs/roadmap.md`). A Trivy/manual compose review found Prometheus (9090),
cAdvisor (8080), node-exporter (9100), and Byparr (its container-internal
port, 8191 — see the correction below) all published on every interface
(`0.0.0.0`) with no built-in authentication and no Caddy TLS/auth in
front — reachable by any device on the LAN, not just this household's
own.

**Updated 2026-08-22**: FlareSolverr was retired and replaced by Byparr
(`services/byparr/README.md`) — same unauthenticated-LAN-exposure
reasoning applies, so Byparr needed a slot in this restriction rather
than shipping unrestricted.

**Corrected same day, after a real external-connection test caught it**:
the first attempt at this swap used Byparr's *host*-published port
(8192) in the `PORTS` list, which looked right but didn't actually block
anything — verified via `curl` from a genuine LAN device (not the
server, not through a Docker bridge), which showed the TCP handshake
completing before hanging on the HTTP response, rather than the
connection just failing to establish at all. Root cause: this rule lives
in `DOCKER-USER`, a `FORWARD`-chain hook, which iptables evaluates
*after* the `nat` table's `PREROUTING` DNAT has already rewritten the
packet's destination port from the host-published port to the
container's internal port. For Prometheus/cAdvisor, host and container
ports are numerically identical (`9090:9090`, `8080:8080`), so this
rewrite is invisible and the original rule worked by coincidence, not by
correct design. Byparr publishes `8192:8191` (host:container) — its
container always listens on hardcoded internal port `8191`, published
externally as `8192` specifically to avoid colliding with FlareSolverr
during the migration's parallel-run phase — so by the time `DOCKER-USER`
sees the packet, its destination port is already `8191`, not `8192`, and
a rule matching `8192` never fires. **The rule must match the
container-side port for any service with an asymmetric host:container
mapping**, not the externally-published one. The script and prose below
already reflect the corrected value (`8191` — Byparr's container port,
not a leftover FlareSolverr reference despite the matching digits). If
you already applied the wrong (`8192`) version, re-running the commands
below will correct it.

```bash
sudo iptables -D DOCKER-USER -p tcp -m multiport --dports 8080,8192,9090,9100 -j DROP
sudo iptables -D DOCKER-USER -i br-+ -p tcp -m multiport --dports 8080,8192,9090,9100 -j RETURN
sudo iptables -D DOCKER-USER -i docker0 -p tcp -m multiport --dports 8080,8192,9090,9100 -j RETURN
sudo iptables -D DOCKER-USER -i lo -p tcp -m multiport --dports 8080,8192,9090,9100 -j RETURN
```

then re-run the full "Recreate on a rebuild" block below (using the
corrected port `8191`) to rewrite the script file itself and restart the
service — the delete above only clears the stale *live* rules, it
doesn't touch the script on disk, so skipping the recreate step would
leave the service re-adding the wrong rules on its next restart/boot.

None of the four could simply be rebound to `127.0.0.1`: this repo's
cross-container convention is that services reach each other via the
**host's real LAN IP** (see `services/caddy/config/Caddyfile`'s own
comment on this), since each service is an independent Compose project
with no shared Docker network. Binding to loopback would have silently
broken Grafana's Prometheus queries, Prometheus's own scrapes of
cAdvisor/node-exporter, and Prowlarr's Byparr calls.

The fix instead filters by **interface** in iptables, not IP range or
rebinding: container-to-container traffic between two Compose projects
hairpins through the host and always arrives at the target port via a
Docker bridge interface (`br-<hash>`, one per Compose project on this
box — confirmed via `docker network ls`), even though it's addressed to
the host's LAN IP. A genuine external LAN device's packet arrives via the
real NIC (`eth1` on this hardware — `eth0` is present but unused/down).
So "allow `lo` + `docker0` + `br-*`, drop everything else" blocks real LAN
access while leaving every legitimate internal path untouched, without
needing to track Docker's shifting bridge subnets at all (two of them,
`caddy_default` and `prefetcharr_default`, use `192.168.0.0/20` and
`192.168.16.0/20` — awkwardly LAN-adjacent by address, unambiguous by
interface).

**Two separate chains, because these four services don't all reach the
host the same way:**

- Prometheus, cAdvisor, and Byparr are ordinary bridge-networked
  Compose services with published ports — that traffic is DNAT'd and
  evaluated by the `FORWARD` chain, specifically `DOCKER-USER` (the one
  hook point Docker itself respects for user-added filtering, guaranteed
  to run before Docker's own generated ACCEPT rules).
- node-exporter runs with `network_mode: host` (like Tailscale) — it
  binds directly to the host's real interfaces rather than going through
  Docker's bridge/port-publish path, so `DOCKER-USER` never sees its
  traffic at all. That's evaluated by the plain `INPUT` chain instead.
  Found the hard way: the `DOCKER-USER` rule alone correctly blocked LAN
  access to the other three ports but left 9100 wide open.

Both chains use the same idempotent pattern (`iptables -C` checks before
`iptables -I <chain> 1` inserts, so re-runs never stack duplicate rules),
with rules inserted in reverse order so the final chain order reads
allow/allow/allow/drop.

**Known gap, not yet closed:** IPv4-only (`iptables`, not `ip6tables`).
Every one of these ports is also published dual-stack (confirmed via
`ps aux | grep docker-proxy`, showing paired `-host-ip 0.0.0.0` /
`-host-ip ::` processes for each), so if IPv6 is actually routable
between devices on this LAN, that's an open bypass — not evaluated yet.

Recreate on a rebuild:

```bash
sudo tee /etc/systemd/system/restrict-internal-ports.sh > /dev/null <<'EOF'
#!/bin/sh
# Restrict Prometheus (9090), cAdvisor (8080), node-exporter (9100), and
# Byparr (8191 -- its container-internal port; Byparr is published
# externally as 8192, but DOCKER-USER sees packets post-DNAT, so the
# rule has to match the container-side port, not the host-side one --
# see this section's 2026-08-22 correction) to loopback +
# Docker-bridge-originated traffic only.
# None of these four have their own auth and none are fronted by Caddy;
# cross-container access (Grafana->Prometheus, Prometheus->cAdvisor/
# node-exporter, Prowlarr->Byparr) arrives via a br-* interface even
# though it's addressed to the host's LAN IP, so this doesn't break that.
# Real LAN NIC on this box is eth1 -- everything not lo/docker0/br-* is
# treated as external and dropped. Idempotent: safe to re-run.
PORTS="8080,8191,9090,9100"

add_rule_once() {
  iptables -C DOCKER-USER "$@" 2>/dev/null || iptables -I DOCKER-USER 1 "$@"
}

add_rule_once -p tcp -m multiport --dports "$PORTS" -j DROP
add_rule_once -i br-+ -p tcp -m multiport --dports "$PORTS" -j RETURN
add_rule_once -i docker0 -p tcp -m multiport --dports "$PORTS" -j RETURN
add_rule_once -i lo -p tcp -m multiport --dports "$PORTS" -j RETURN

# node-exporter (9100) runs with network_mode: host (like Tailscale) --
# it binds directly to the host's real interfaces rather than going
# through Docker's bridge/port-publish path, so DOCKER-USER (a FORWARD-
# chain hook) never sees this traffic. It's evaluated by INPUT instead.
add_input_rule_once() {
  iptables -C INPUT "$@" 2>/dev/null || iptables -I INPUT 1 "$@"
}

add_input_rule_once -p tcp --dport 9100 -j DROP
add_input_rule_once -i br-+ -p tcp --dport 9100 -j ACCEPT
add_input_rule_once -i docker0 -p tcp --dport 9100 -j ACCEPT
add_input_rule_once -i lo -p tcp --dport 9100 -j ACCEPT
EOF
sudo chmod +x /etc/systemd/system/restrict-internal-ports.sh

sudo tee /etc/systemd/system/restrict-internal-ports.service > /dev/null <<'EOF'
[Unit]
Description=Restrict Prometheus/cAdvisor/node-exporter/Byparr to loopback + Docker-internal traffic (no built-in auth on these)
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
ExecStart=/bin/sh /etc/systemd/system/restrict-internal-ports.sh
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now restrict-internal-ports.service
```

### Battery-Based Graceful Shutdown (No External UPS)

`/etc/systemd/system/battery-shutdown.sh` + `.service` + `.timer`, added
2026-08-22 as Phase 5's UPS-integration task (see `docs/roadmap.md`).
This server is a laptop (see the Backlight section above) with a real,
present internal battery — confirmed via `/sys/class/power_supply/BAT0/`
(`present=1`, `capacity=100`, `status=Full` at the time of writing) and
already exposed to Prometheus by node-exporter's power-supply collector
(`node_power_supply_online{power_supply="AC"}`,
`node_power_supply_capacity{power_supply="BAT0"}`) with no extra setup
needed. Rather than buy a dedicated UPS, this repo uses that existing
battery as one: an instant Grafana alert on mains loss (reusing the ntfy
channel every other alert already goes through — see
`services/grafana/config/provisioning/alerting/rules.yaml`'s
`server_on_battery_power` rule) plus a host-level systemd timer that
shuts the box down gracefully before the battery is actually exhausted.
BIOS AC Recovery (`docs/secrets.md`) already handles the other half —
booting back up unattended once mains power returns — so this closes the
loop without any new hardware.

**Battery health, honestly, not assumed**: `charge_full` (2.811 Ah) vs.
`charge_full_design` (3.684 Ah) — about 76% of original design capacity,
not a fresh battery (Dell `Y3F7Y6B`, per
`node_power_supply_info`'s `model_name` label). At its rated 12.585V
that's roughly 35 Wh usable at full charge. **Real runtime under this
server's actual load hasn't been measured yet** — the 20% shutdown
threshold below is a conservative starting guess, not a validated
number. A real unplug test is the next step to tune it; until then, this
errs toward shutting down earlier than strictly necessary rather than
risking an unclean power-off.

**This is the first genuine `.service` + `.timer` pair in this repo** —
the other host-level customizations above (`wait-for-mounts`,
`backlight-off`, `restrict-internal-ports`) are all `Type=oneshot`
triggered once at boot via `After=`, not actually recurring. This one
needs to keep checking on a schedule for as long as the box is up, which
is exactly the case `docs/zimaos.md`'s own "Anything that needs to run
on a schedule uses a systemd `.service` + `.timer` pair" rule (see the
`/var` section above) was written for.

Checks every 2 minutes: if AC power is offline (`/sys/class/
power_supply/AC/online` reads `0`) *and* battery capacity is at or below
20%, it issues a graceful `shutdown -h now`. Both conditions have to be
true together, and the capacity threshold itself only becomes true after
a genuinely sustained drain (hours, not a single flaky reading), so this
doesn't need extra debounce logic layered on top — deliberately kept as
simple as the rest of this repo's host-level scripts, not engineered
against edge cases that don't apply on a homelab.

Recreate on a rebuild:

```bash
sudo tee /etc/systemd/system/battery-shutdown.sh > /dev/null <<'EOF'
#!/bin/sh
# Gracefully shuts the server down before its internal battery is
# exhausted during a mains power outage -- this box has no external UPS,
# see docs/zimaos.md's "Battery-Based Graceful Shutdown" section for the
# full reasoning. Threshold (20%) is a conservative starting guess, not
# yet validated against a real unplug test.
AC_ONLINE=$(cat /sys/class/power_supply/AC/online 2>/dev/null)
CAPACITY=$(cat /sys/class/power_supply/BAT0/capacity 2>/dev/null)

if [ "$AC_ONLINE" = "0" ] && [ -n "$CAPACITY" ] && [ "$CAPACITY" -le 20 ]; then
  logger -t battery-shutdown "AC offline, battery at ${CAPACITY}% -- shutting down"
  /sbin/shutdown -h now "Battery critically low (${CAPACITY}%) -- shutting down to avoid an unclean power-off"
fi
EOF
sudo chmod +x /etc/systemd/system/battery-shutdown.sh

sudo tee /etc/systemd/system/battery-shutdown.service > /dev/null <<'EOF'
[Unit]
Description=Check AC/battery status, shut down gracefully if AC is offline and battery is critically low

[Service]
Type=oneshot
ExecStart=/bin/sh /etc/systemd/system/battery-shutdown.sh
EOF

sudo tee /etc/systemd/system/battery-shutdown.timer > /dev/null <<'EOF'
[Unit]
Description=Run battery-shutdown.service every 2 minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=2min
Unit=battery-shutdown.service

[Install]
WantedBy=timers.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now battery-shutdown.timer
```

**Verify the timer is actually scheduled** (not just the service file
existing):

```bash
sudo systemctl list-timers battery-shutdown.timer
```

### SMART Disk Health Capture (Textfile Collector)

`/etc/systemd/system/smart-textfile.sh` + `.service` + `.timer`, added
2026-08-22 as Phase 5's "deeper storage monitoring" task (see
`docs/roadmap.md`). `docs/storage.md` is explicit that all three of this
box's drives are single points of failure with no RAID at any layer —
the existing capacity alerts (`internal_disk_capacity`,
`backup_disk_capacity` in
`services/grafana/config/provisioning/alerting/rules.yaml`) only ever
catch "drive is full," never "drive is dying." This adds the actual
predictive-failure signal: SMART health status and attribute data,
scraped periodically and fed into node-exporter's textfile collector so
Prometheus/Grafana see it like any other host metric.

**`smartmontools` isn't natively available on this box** (no package
manager, see "Read-Only Root" above), so this runs via Docker like
`sops`/`restic` already do — same pattern, same reasoning. Rather than
hand-parsing `smartctl`'s raw text output (fragile across drive/vendor
differences) or running a persistent `smartctl_exporter` daemon
(rejected for the same "another always-on service" reason the battery
timer above chose a timer over a container), this starts the official
`prometheuscommunity/smartctl-exporter` image briefly, scrapes its
`/metrics` once over `127.0.0.1` (never exposed to the LAN — no
firewall rule needed, unlike the services in "Restrict Internal-Only
Services" above), writes the result into node-exporter's textfile
directory, then stops the container. This reuses the exporter's own
well-tested SMART parsing (`smartctl_device_smart_status`,
`smartctl_device_attribute`, etc. — verified directly against its
source, `metrics.go`/`smartctl.go`, not guessed) instead of
reimplementing it, while keeping the "no new persistent service"
property intact. Follows the project's own documented deployment
(`privileged: true`, `user: root` — not narrowed further, since even
their own README doesn't commit to a smaller capability set as a
supported interface).

**node-exporter needed a config change to read this**:
`services/node-exporter/compose.yml` now passes
`--collector.textfile.directory=/host/DATA/Infrastructure/node-exporter/
textfile_collector` — the path is under `/host` because node-exporter's
existing `/:/host:ro,rslave` mount (see
`services/node-exporter/README.md`) already gives it read-only visibility
into the entire real host filesystem; no new volume mount needed, just
telling it where to look.

**Known limitation, not yet closed**: NVMe drives don't expose the
classic SATA attributes (`Reallocated_Sector_Ct`,
`Current_Pending_Sector`) this setup's second alert rule watches — they
use separate NVMe-specific fields
(`smartctl_device_media_errors`/`smartctl_device_critical_warning`,
also emitted by the same exporter) that aren't alerted on yet. Not
confirmed whether any of this box's three drives are actually NVMe
rather than SATA — the overall-health alert
(`smartctl_device_smart_status`) covers both interface types uniformly
regardless, so this is a gap in the *early-warning* layer specifically,
not in catching an outright failure.

Recreate on a rebuild:

```bash
sudo tee /etc/systemd/system/smart-textfile.sh > /dev/null <<'EOF'
#!/bin/sh
# Captures SMART health/attribute data for every attached disk into a
# Prometheus textfile-collector .prom file. Runs the official
# smartctl_exporter image just long enough to scrape it once, rather
# than as a permanent daemon -- see docs/zimaos.md's "SMART Disk Health
# Capture" section for the full reasoning.
set -eu

TEXTFILE_DIR=/DATA/Infrastructure/node-exporter/textfile_collector
CONTAINER=smartctl-exporter-scrape
IMAGE=prometheuscommunity/smartctl-exporter:v0.14.0

mkdir -p "$TEXTFILE_DIR"
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true

docker run -d --name "$CONTAINER" --privileged --user root \
  -p 127.0.0.1:9633:9633 "$IMAGE" >/dev/null

# Give it time to complete its initial device scan + smartctl poll
# before scraping -- USB drives in particular can be slower to respond
# than the internal disk.
sleep 15

if curl -sf http://127.0.0.1:9633/metrics -o "$TEXTFILE_DIR/smart.prom.tmp"; then
  mv "$TEXTFILE_DIR/smart.prom.tmp" "$TEXTFILE_DIR/smart.prom"
else
  logger -t smart-textfile "Failed to scrape smartctl_exporter -- leaving previous smart.prom in place"
  rm -f "$TEXTFILE_DIR/smart.prom.tmp"
fi

docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
EOF
sudo chmod +x /etc/systemd/system/smart-textfile.sh

sudo tee /etc/systemd/system/smart-textfile.service > /dev/null <<'EOF'
[Unit]
Description=Scrape SMART disk health into node-exporter's textfile collector
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
ExecStart=/bin/sh /etc/systemd/system/smart-textfile.sh
EOF

sudo tee /etc/systemd/system/smart-textfile.timer > /dev/null <<'EOF'
[Unit]
Description=Run smart-textfile.service every 30 minutes

[Timer]
OnBootSec=5min
OnUnitActiveSec=30min
Unit=smart-textfile.service

[Install]
WantedBy=timers.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now smart-textfile.timer
```

**Verify** — both that the timer ran and that node-exporter is actually
reading the result:

```bash
sudo systemctl list-timers smart-textfile.timer
cat /DATA/Infrastructure/node-exporter/textfile_collector/smart.prom | head -20
curl -s http://127.0.0.1:9100/metrics | grep smartctl_device_smart_status
```

### Docker Daemon: `live-restore` Enabled

`/etc/docker/daemon.json`, set 2026-08-22 during Phase 5's security
hardening (Docker Bench for Security flagged 2.14 -- live restore not
enabled). With this on, running containers survive a `dockerd`
restart/crash instead of going down with it -- confirmed live: restarted
`docker.service` and all 19 containers kept their original uptime
throughout, not reset.

**Found the file already broken before touching it**: `cat -A
/etc/docker/daemon.json` showed a bare `{` followed by a blank line, no
closing brace -- invalid JSON, not something either this repo or any
documented change here produced. Docker only reads `daemon.json` at
daemon startup, so it hadn't caused a problem yet, but a future
`systemctl restart docker` for any unrelated reason (a Docker upgrade,
say) would very likely have failed to start `dockerd` on that malformed
file. Backed it up (`daemon.json.bak`, not tracked in git, host-only)
and replaced it with a clean, valid file rather than trying to patch
around the corruption -- there were no real keys in the broken version to
preserve.

```json
{
  "live-restore": true
}
```

Recreate on a rebuild:

```bash
sudo tee /etc/docker/daemon.json > /dev/null <<'EOF'
{
  "live-restore": true
}
EOF
sudo systemctl restart docker
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
