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

## Phase 1 – Repository & Standards (Current)

**Goal:** Establish engineering standards before infrastructure grows.

**Tasks:**

- [x] Create `docs/roadmap.md` (this document)
- [ ] Complete `README.md`
- [x] Define documentation standards (`docs/conventions.md`)
- [x] Define directory conventions (`docs/conventions.md`)
- [ ] Create `docs/architecture.md`
- [ ] Create `docs/networking.md`
- [ ] Create `docs/storage.md`
- [x] Define commit conventions (`docs/conventions.md`)
- [x] Define branching strategy (`docs/conventions.md`; CI + branch protection on `main`)
- [x] Define Compose conventions (`docs/conventions.md`)
- [ ] Define backup strategy (`docs/backup.md`)
- [ ] Define disaster recovery documentation (`docs/disaster-recovery.md`)

**Deliverable:** A fully documented repository with clear engineering
standards.

---

## Phase 2 – Core Infrastructure

**Goal:** Deploy the essential infrastructure that everything else depends on.

**Services:** Portainer, Tailscale, AdGuard Home, SMB

**Focus:** Networking, remote access, DNS, file storage, container management.

**Deliverable:** A secure and manageable infrastructure platform.

---

## Phase 3 – Platform Services

**Goal:** Deploy the services that provide ongoing monitoring and management.

**Services:** Uptime Kuma, Prometheus, Grafana

**Focus:** Monitoring, metrics, dashboards, alerting, health checks.

**Deliverable:** Complete visibility into the health of the homelab.

---

## Phase 4 – Application Services

**Goal:** Deploy end-user applications.

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
