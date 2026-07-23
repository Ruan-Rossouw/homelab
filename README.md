# Homelab

**Homelab as an Engineering Platform.**

This repository is the source of truth for a self-hosted homelab, built the
way a small platform engineering team would build infrastructure for a
company — not just "get services running," but reproducible, documented, and
recoverable from Git alone.

The server (currently a Dell Inspiron running ZimaOS) is a deployment
target, not the product. If it were lost tomorrow, the goal is to recreate
everything from this repository and its documentation.

## How This Works

```text
Mac / VS Code → git commit → GitHub → git pull (server) → docker compose up
```

Development happens off the server. Every service is an independent Docker
Compose project — no vendor app store, no undocumented manual configuration.
See [`docs/conventions.md`](docs/conventions.md) for the exact rules.

## Project Structure

```text
homelab/
├── docs/          # architecture, networking, storage, conventions, roadmap
├── scripts/       # standalone operational scripts
├── services/      # one directory per deployed service (compose.yml, README, config)
└── templates/     # boilerplate for new services/docs
```

## Documentation

| Doc | Answers |
|---|---|
| [`roadmap.md`](docs/roadmap.md) | What are we building, in what order, and why? |
| [`architecture.md`](docs/architecture.md) | Why is the system shaped this way? |
| [`conventions.md`](docs/conventions.md) | What rules does everything follow? |
| [`networking.md`](docs/networking.md) | How does traffic get from A to B? |
| [`storage.md`](docs/storage.md) | Where does data live, and why there? |
| [`zimaos.md`](docs/zimaos.md) | What's non-standard about this OS, and how did we work around it? |

## Status

Foundation, standards, and core infrastructure (Phases 0–2) are complete:
Portainer, Tailscale, AdGuard Home, and SMB are all deployed. Currently in
**Phase 3 – Platform Services**: Uptime Kuma, Prometheus, Grafana. See
[`docs/roadmap.md`](docs/roadmap.md) for the full phase breakdown, including
applications and ongoing operations still ahead.
