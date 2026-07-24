# Uptime Kuma

Self-hosted uptime/health monitoring with a web dashboard. First service in
Phase 3 — the goal is visibility into everything deployed so far (Portainer,
Tailscale, AdGuard Home, SMB), not just running more software.

## What This Is

Uptime Kuma polls configured "monitors" (HTTP(S) endpoints, TCP ports, DNS
queries, ping, and more) on an interval and records up/down history and
response time. It's the dashboard-and-history half of monitoring; alerting
(push notifications when something goes down) is a separate, deliberately
deferred decision — see "Alerting: Deferred" below.

## Container User: Root, Matching the Existing Pattern

The image ships two variants: a standard build (runs as root) and a
`-rootless` build (runs as a non-root UID, requires the bind-mount directory
to be pre-owned by that UID). We're using the standard, root build here —
consistent with Portainer and AdGuard, which both ended up running as root
because containerized permission-mapping against `/DATA` proved fiddly (see
`docs/architecture.md`).

This is a deliberate trade-off, not an oversight: it's simpler to deploy
(no `chown` step) but continues a "everything runs as root" pattern rather
than least-privilege, and it means `docs/storage.md`'s open question — do
non-root UIDs get write access to freshly-created `AppData` subdirectories?
— is *still* unverified, not resolved. If a future service has a real reason
to run non-root (or if that question needs answering directly), the
`-rootless` tag is sitting right there as the natural test case.

## Database: SQLite, Not Embedded MariaDB

The first-run wizard offers a choice between SQLite (a single file) and an
embedded MariaDB (a second process bundled into the same container,
connected to over a Unix socket — no separate service to deploy). We picked
SQLite: the wizard's own text recommends it for "small-scale deployments,"
which is exactly what a handful of monitors on one server is. Embedded
MariaDB's only real advantage is write concurrency at a scale (many
monitors, sub-second intervals, multiple writers) this deployment doesn't
have — the cost of a second daemon's baseline memory and startup complexity
on an already-busy 8 GB box isn't worth paying for a scaling problem that
doesn't exist yet.

## Deploy

```bash
mkdir -p /DATA/AppData/uptime-kuma
cd /DATA/Infrastructure/homelab/services/uptime-kuma
docker compose up -d
```

The `AppData` directory is created explicitly rather than left for Docker to
auto-create on first mount — same habit established with Portainer.

## First Run

Browse to `http://192.168.68.110:3001`. Unlike Portainer, there's no
setup-timeout mechanic — the first-run screen just waits until you create the
admin account, no rush.

## Recommended Monitors (Post-Setup)

Add a monitor for each service already deployed, so Uptime Kuma is useful
immediately instead of watching itself:

| Service | Monitor type | Target |
|---|---|---|
| Portainer | HTTP(S) | `https://192.168.68.110:9443` (ignore TLS errors — self-signed cert) |
| AdGuard Home | HTTP(S) | `http://192.168.68.110:3000` |
| AdGuard Home | DNS | query `192.168.68.110` on port 53, e.g. resolve `example.com` |
| SMB | TCP Port | `192.168.68.110:445` |

Tailscale is deliberately **not** monitored here — see "Known Limitation:
Tailscale Isn't Monitored" below for why, rather than assuming it was
overlooked.

## Known Limitation: Tailscale Isn't Monitored

We tried and deliberately backed off, rather than never having tried. Two
approaches were ruled out:

1. **A TCP port check against `41641`** (Tailscale's listening port) always
   reports down — that port is UDP (the WireGuard-style transport), and a
   TCP monitor performs a TCP handshake, so there's nothing there to
   connect to regardless of whether Tailscale is actually healthy.
2. **A Ping check against the server's own Tailscale IP** fails too, but
   for a more structural reason: `uptime-kuma`'s container is *not* on
   `network_mode: host` (only `services/tailscale/` is, per that service's
   README). Its own Tailscale IP only exists inside the network namespace
   Tailscale's container borrowed from the host. Reaching it from
   Uptime Kuma's isolated bridge network means hairpinning back into the
   host and onto an interface a different container claimed — confirmed
   with `docker exec uptime-kuma ping -c3 <lan-ip>` (succeeds) vs.
   `docker exec uptime-kuma ping -c3 <tailscale-ip>` (100% loss, no reply
   at all).

A third option — polling Tailscale's own REST API
(`GET /api/v2/tailnet/{tailnet}/devices`) instead of the tailnet interface —
was considered and rejected. It sidesteps the networking problem entirely
(a normal outbound HTTPS call, not tailnet-dependent), but the only
officially documented field is a `lastSeen` timestamp, not a real online
flag; the closer signal (`connectedToControl`) is undocumented and the
subject of an [open upstream feature request](https://github.com/tailscale/tailscale/issues/7209)
to make it official. On top of that, API access tokens expire in 1–90 days
with no longer-lived option, turning "one-time setup" into a recurring
manual-renewal chore for a check that isn't even fully documented. Not worth
it for what this buys.

**Fixing this properly** means restructuring `services/tailscale/` to *not*
use `network_mode: host` — instead giving it its own isolated namespace
that other containers explicitly join via `network_mode: service:tailscale`
— which would let any container reach the tailnet without full host
networking. That's a real architecture change to a decision already made
and documented in Phase 2, not a tweak, and belongs in a deliberate
networking-model review (Phase 6 territory), not bolted on to fix one
monitor.

**In the meantime:** there's no dashboard history for Tailscale specifically,
but it isn't a monitoring blind spot in practice — every other monitor above
depends on the server being reachable at all, and remote access (Portainer
from off-network, etc.) breaking is itself an immediate, obvious signal that
Tailscale is down. Coarser than a dedicated check, but not silent.

## Alerting: Deferred

Phase 3's goal includes alerting, not just a dashboard, but this deployment
intentionally stops at monitors with no notification channel configured —
scoped the same way AdGuard was deployed before DNS was actually pointed at
it. Wiring up Discord/ntfy/Telegram/email means picking a channel and storing
a real credential (webhook URL, bot token, or SMTP password) in `.env`, which
deserves its own deliberate follow-up rather than being bundled into "get the
dashboard running." Until that lands, Uptime Kuma will show you *that*
something is down if you're looking at it, but won't tell you.

## Known Limitation: Monitoring the Monitor

Uptime Kuma is itself a single point of failure for monitoring — if its
container or the server goes down, nothing alerts you that monitoring itself
is gone (the classic "who watches the watchmen" problem). There's no fix
within this service; a real answer means an *external* check (something
outside this box, e.g. a free third-party uptime pinger hitting Uptime Kuma
over Tailscale or a public endpoint) — worth revisiting once alerting is
actually wired up, not before.
