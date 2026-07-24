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

## Phase 3 – Platform Services (Current)

**Goal:** Deploy the services that provide ongoing monitoring and management.

**Services:**

- [x] Uptime Kuma
- [x] Prometheus
- [ ] Grafana

**Focus:** Monitoring, metrics, dashboards, alerting, health checks.

**Deliverable:** Complete visibility into the health of the homelab.

---

## Phase 4 – Application Services

**Goal:** Deploy end-user applications.

**Gate:** `docs/backup.md` and `docs/disaster-recovery.md` must exist
*before* Immich or Home Assistant are deployed — this is the phase where
irreplaceable data (photos, automation history) starts accumulating on a
single HDD with no redundancy (see `storage.md`). Jellyfin doesn't carry the
same urgency (media is typically re-acquirable) but ordering the gate before
the whole phase is simpler than tracking it per-service.

**Services:** Jellyfin, Home Assistant, Immich

**Focus:** Media, home automation, photo management.

**Deliverable:** A production-ready application platform.

---

## Phase 5 – Operations

**Goal:** Make the homelab resilient and maintainable.

**Tasks:** Automated backups, restore testing, GitHub Actions (if
appropriate), container updates, security hardening, secret management, UPS
integration, storage monitoring, documentation review.

**Deliverable:** A self-maintaining platform with tested recovery procedures.

---

## Phase 6 – Continuous Improvement

This phase never ends. Possible future additions, roughly in order of
likely relevance: Kubernetes, Terraform, Ansible, GitOps, reverse proxy, SSL
automation, identity provider / SSO, object storage, CI/CD, local AI
workloads, additional monitoring, VLANs, high availability.

The goal is to continuously improve the platform while maintaining the
architectural standards established in the earlier phases.

---

## Services Roadmap (deployment order)

1. Portainer
2. Tailscale
3. AdGuard Home
4. SMB
5. Jellyfin
6. Home Assistant
7. Uptime Kuma
8. Grafana
9. Prometheus
10. Immich

Each service is expected to be production quality: independent Compose
project, isolated, documented, version controlled.
