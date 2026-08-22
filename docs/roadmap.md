# Roadmap

## Project Identity

This project is internally treated as **Homelab as an Engineering Platform**: the
goal is not "get Jellyfin running," it's to build and operate infrastructure the
way a small platform engineering team would — reproducible, documented, and
recoverable from Git alone. Every service deployed is an opportunity to practice
production-grade decisions, not just to get software online.

## Why Phases

This project is built in phases, not in services. Each phase has a single goal
and a clear deliverable, and later phases are not started until the current
phase's deliverable is met.

This mirrors how platform teams roll out new environments: foundation and
standards before workloads, core infrastructure before applications, monitoring
before you need it rather than after an outage. Skipping ahead (e.g. deploying
Jellyfin before Portainer/Tailscale/AdGuard exist) trades short-term
gratification for long-term rework, so we avoid it deliberately.

---

## Phase 0 – Foundation (Complete)

**Goal:** Build a reproducible, maintainable development environment before
deploying any services.

**Completed:**

- Install ZimaOS, enable Developer Mode
- Configure SSH, Docker CLI
- Resolve ZimaOS's root-owned `/DATA` permission model
- Create `/DATA/Infrastructure` directory structure
- Initialize Git repository
- Build developer bootstrap (`bootstrap.sh`)
- Redirect Git configuration (`GIT_CONFIG_GLOBAL`)
- Redirect Docker configuration (`DOCKER_CONFIG`)
- Configure XDG directories
- Establish repository conventions
- Create initial documentation (`docs/zimaos.md`)

**Deliverable:** A clean Infrastructure-as-Code foundation that can be
recreated from scratch. ✅

---

## Phase 1 – Repository & Standards (Complete)

**Goal:** Establish engineering standards before infrastructure grows.

**Tasks:**

- [x] Create `docs/roadmap.md` (this document)
- [x] Complete `README.md`
- [x] Define documentation standards (`docs/conventions.md`)
- [x] Define directory conventions (`docs/conventions.md`)
- [x] Create `docs/architecture.md`
- [x] Create `docs/networking.md`
- [x] Create `docs/storage.md`
- [x] Define commit conventions (`docs/conventions.md`)
- [x] Define branching strategy (`docs/conventions.md`; CI + branch protection on `main`)
- [x] Define Compose conventions (`docs/conventions.md`)

**Deliverable:** A fully documented repository with clear engineering
standards. ✅

**Deliberately deferred:** `docs/backup.md` and `docs/disaster-recovery.md`.
`storage.md` flagged that `/DATA/AppData/` — the only thing that would
actually need backing up — is currently empty; the repo itself is already
implicitly multi-copy via Git (Mac + GitHub + server clone). Writing a
backup strategy for data that doesn't exist yet would be speculative. These
become a **hard gate before Phase 4** instead (see below), since Immich and
Home Assistant are where irreplaceable data starts accumulating.

---

## Phase 2 – Core Infrastructure (Complete)

**Goal:** Deploy the essential infrastructure that everything else depends on.

**Services:**

- [x] Portainer
- [x] Tailscale
- [x] AdGuard Home
- [x] SMB

**Focus:** Networking, remote access, DNS, file storage, container management.

**Deliverable:** A secure and manageable infrastructure platform. ✅

---

## Phase 3 – Platform Services (Complete)

**Goal:** Deploy the services that provide ongoing monitoring and management.

**Services:**

- [x] Uptime Kuma
- [x] Prometheus
- [x] Grafana

**Focus:** Monitoring, metrics, dashboards, alerting, health checks.

**Deliverable:** Complete visibility into the health of the homelab. ✅

---

## Phase 4 – Application Services (Complete)

**Goal:** Deploy end-user applications.

**Gate (satisfied 2026-07-26):**

- [x] `docs/backup.md` written, describing a working mechanism, not just a design
- [x] `docs/disaster-recovery.md` written
- [x] A real backup ran (restic via Docker, scheduled by a systemd timer —
      see `backup.md` for why not a native install or `cron`), `restic
      check` passed clean, and a restore was tested and verified
      byte-for-byte, not just assumed to work

This is the phase where irreplaceable data (photos, automation history)
starts accumulating on drives with no RAID redundancy at the disk layer
(see `storage.md`). Jellyfin doesn't carry the same urgency (media is
typically re-acquirable) but ordering the gate before the whole phase is
simpler than tracking it per-service.

**Services:**

- [x] Jellyfin — done (2026-07-28). Built as a full media pipeline, not
      just the player: Prowlarr (indexers), Radarr/Sonarr (movie/TV
      automation), Decypharr (Real-Debrid download client + cloud mount,
      replacing the originally-planned rdt-client/Zurg split),
      FlareSolverr (Cloudflare bypass for indexers), Jellyfin (playback),
      and Seerr (request UI, the successor to the originally-planned
      Jellyseerr). Proven end-to-end with real content, both movies and
      TV. See `services/jellyfin/README.md` for the full build and
      remaining optional polish (iPhone/iPad + Tailscale client testing).
- [x] Home Assistant — closed out 2026-07-29. Platform (host networking,
      no `--privileged`), CBI smart circuit breaker (geyser, official
      Tuya cloud integration, Schedule helper + two automations), and
      HomeKit Controller all done. Deliberately left undone, not
      forgotten: HomeKit Bridge (Controller alone covered what was
      wanted) and the LuxPower/LuxCloud inverter dongle (blocked on
      vendor-app setup, not picked back up). See
      `services/home-assistant/README.md`.
- [x] Immich — re-scoped out of Phase 4 2026-08-15, not just deferred.
      Originally held back (2026-07-29) pending an SSD + RAM upgrade to
      cover its heavier footprint (Postgres + pgvector, Redis, a
      separate ML container). Decision on 2026-08-15: rather than wait
      on a hardware upgrade to run Immich on this single box, pair it
      with the Kubernetes/second-node exploration planned for Phase 6 —
      Immich becomes that second node's first real workload instead of
      a synthetic hello-world deployment, and a second machine solves
      the resource-headroom problem more durably than upgrading the
      first one. Formally out of Phase 4's scope now, tracked under
      Phase 6 instead (see below). Not blocked on anything else — the
      backup gate was already satisfied (`docs/backup.md`).

**Focus:** Media, home automation, photo management.

**Deliverable:** A production-ready application platform. ✅

---

## Phase 5 – Operations (Complete)

**Goal:** Make the homelab resilient and maintainable.

**Tasks:** Automated backups, restore testing, GitHub Actions (if
appropriate), container updates, security hardening, secret management, UPS
integration, storage monitoring, documentation review.

**Already underway, ahead of this phase formally opening:** automated
backups + restore testing (done, was actually Phase 4's gate), alerting
(ntfy + 6 Grafana Alerting rules), container updates (Renovate, proven
live), and baseline GitHub Actions CI (lint + secret scanning).

**Secret management — closed (2026-08-18).** Evaluated sops+age against
password-manager-backed CLI injection and a hardened-`.env`-only approach;
picked sops+age (see `docs/secrets.md` for the full trade-off writeup).
Rolled out to the only two services with real secrets in `.env`
(Prefetcharr, Grafana) — every other service either has no secret to
migrate or stores it outside `.env` entirely (Decypharr, Home Assistant).
Age key backed up to the password manager; rotation cadence deliberately
deferred, not an open gap.

**Security hardening — closed 2026-08-22 (started and finished same
day).** Wazuh rejected
outright (its indexer alone needs this server's entire RAM budget); picked
Docker Bench for Security + Trivy + Lynis instead, all one-shot/no
persistent footprint. Closed so far: Prometheus/cAdvisor/node-exporter/
FlareSolverr's unauthenticated LAN exposure (host-level firewall, see
`docs/zimaos.md`); resource limits + log rotation across all 19 services,
based on measured peak usage, not guessed; `pids_limit` +
`no-new-privileges` across all 19; Docker daemon `live-restore`; a root
account with no password set (`sudo passwd -S root` showed `NP`); and
root-user justification docs for every service that needed one.
**FlareSolverr → Byparr migration closed (2026-08-22)**: FlareSolverr's
bundled Chromium had no upstream fix available (project stalled);
replaced with [Byparr](https://github.com/ThePhaseless/Byparr)
(`services/byparr/README.md`), confirmed API-compatible from source and
proven against extratorrent-st from the server's own IP before cutover
(1337x excluded — a pre-existing Cloudflare IP ban unrelated to either
tool, and not an indexer in active use). FlareSolverr's container,
compose project, and firewall-restricted port were retired; Byparr
inherited the same LAN-exposure restriction on its own port (8192).
Also deliberately parked, not urgent on a homelab: user namespace
remapping, disabling Docker's userland-proxy, read-only root
filesystems, a Docker daemon audit-rule setup, and a handful of SSH
hardening suggestions from Lynis.

**UPS integration — closed 2026-08-22, no hardware purchased.** This
server is a laptop with a real, present internal battery (confirmed via
`/sys/class/power_supply/BAT0/`, already exposed to Prometheus by
node-exporter with no extra setup) — used as the UPS instead of buying
one. A Grafana Alerting rule fires instantly on mains loss
(`server_on_battery_power`, reusing the existing ntfy channel), and a
new host-level systemd timer (`docs/zimaos.md`'s "Battery-Based Graceful
Shutdown" section — the repo's first genuine recurring `.timer`, not
just an at-boot oneshot) shuts the box down cleanly once the battery
hits 20%, before it's actually exhausted. BIOS AC Recovery already
handles booting back up unattended once power returns. **Known caveat,
not yet closed**: the battery is measurably degraded (~76% of original
design capacity, Dell `Y3F7Y6B`) and real runtime under this server's
actual load hasn't been measured — 20% is a conservative starting
threshold, to be tuned after a real unplug test.

**Deeper storage monitoring — closed 2026-08-22.** `docs/storage.md` was
explicit that all three drives are single points of failure with no
RAID at any layer, but nothing watched for a drive actually *dying* —
only for "drive is full." Added SMART health monitoring via a host-level
systemd timer (`docs/zimaos.md`'s "SMART Disk Health Capture") feeding
node-exporter's textfile collector, backing two new Grafana alerts
(overall health FAILED, and Reallocated/Pending sector counts going
nonzero — the earlier warning sign). Also closed a real gap found along
the way: `/DATA/Media`, the most actively-growing volume, had no
capacity alert at all, unlike `/DATA` and `/DATA/Backup`. Known,
documented limitation: the sector-count alert only covers SATA
attributes, not NVMe.

**Documentation review — closed 2026-08-22.** Found real drift while
doing it, not just polish: 10 service READMEs each independently
hand-copied a full port table (the root cause of the FlareSolverr/Byparr
drift above), consolidated into a single canonical table in
`docs/networking.md`; `docs/storage.md` and this section both had stale
"in progress" language left over from phases/tasks that had already
closed. See `docs/networking.md`'s "Port Map" section for the
consolidated table.

**Deliverable:** A self-maintaining platform with tested recovery procedures. ✅

---

## Phase 6 – Continuous Improvement

This phase never ends. Possible future additions, roughly in order of
likely relevance: Kubernetes, Terraform, Ansible, GitOps, reverse proxy, SSL
automation, identity provider / SSO, object storage, CI/CD, local AI
workloads, additional monitoring, VLANs, high availability.

**Immich lives here now** (re-scoped out of Phase 4 on 2026-08-15 — see
above), tied specifically to the Kubernetes/second-node work: the plan is
a second machine, joined as a real multi-node cluster rather than a
single-node one, with Immich as its first workload. Worth remembering if
picked up: Immich's first-ever deployment coinciding with this project's
first-ever Kubernetes deployment stacks two new, unfamiliar things on top
of a workload holding irreplaceable photos. Standing Immich up standalone
on Compose first (on whichever box), then migrating it into the cluster
once Kubernetes itself is proven, is the safer order if that risk ever
matters more than the learning value of doing both at once.

The goal is to continuously improve the platform while maintaining the
architectural standards established in the earlier phases.

---

## Services Roadmap (deployment order)

1. Portainer
2. Tailscale
3. AdGuard Home
4. SMB
5. Uptime Kuma
6. Prometheus
7. Grafana
8. Jellyfin pipeline — Prowlarr, Radarr, Sonarr, Decypharr, FlareSolverr,
   Jellyfin, Seerr (done, 2026-07-28)
9. Home Assistant

Immich no longer appears in this Phase 4 list — re-scoped to Phase 6,
paired with the future Kubernetes/second-node work (see above).

Each service is expected to be production quality: independent Compose
project, isolated, documented, version controlled.
