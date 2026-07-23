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
| Tailscale | TCP Port | the server's Tailscale IP, port `41641` (or any port a service publishes over the tailnet) |

Tailscale doesn't have a clean HTTP endpoint of its own to check — the TCP
port monitor above just confirms `tailscaled` is still listening, which is
the closest equivalent to "is the VPN up" without standing up a dedicated
health check.

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
