# Prometheus

Metrics collection and storage — the second Phase 3 service. Unlike
Uptime Kuma (which polls existing endpoints), Prometheus is a **scraper**:
it pulls metrics from exporters on an interval and stores them as time
series. On its own it has nothing to scrape — it's deployed alongside
[`services/node-exporter/`](../node-exporter/README.md) (host metrics) and
[`services/cadvisor/`](../cadvisor/README.md) (per-container metrics), all
three as one coherent unit of work even though each is its own
independently-removable Compose project, per convention.

Prometheus stores data but doesn't visualize it well on its own — Grafana
(next in Phase 3) is the dashboard layer on top of this.

## Why Targets Are Hardcoded IPs, Not Service Names

`config/prometheus.yml` scrapes `192.168.68.110:9100` and `192.168.68.110:8080`
directly, not `node-exporter:9100` / `cadvisor:8080`. That's not an oversight —
there's no shared Docker network across services in this repo yet (a decision
explicitly deferred in `docs/conventions.md` until there's a real reason to
make it), so container-name-based DNS resolution between separate Compose
projects isn't available. Every service so far reaches every other service
over the LAN IP, the same way Uptime Kuma's monitors do — this is consistent
with that, not a new pattern.

## Why Prometheus Itself Doesn't Need Host Networking

Only `node-exporter` needs `network_mode: host` (to read the *host's* own
`/proc`/`/sys`, not the container's). Prometheus just needs outbound reach to
`node-exporter`'s and `cadvisor`'s published ports over the LAN IP — which
a normal bridge-networked container can already do. This was confirmed
concretely while troubleshooting Uptime Kuma's Tailscale monitor: a
bridge-networked container reaching the host's regular LAN IP works fine;
it was specifically reaching an IP that only exists inside a *different*
container's borrowed host-network-namespace (Tailscale's) that failed. Since
node-exporter and cadvisor both publish to the host's LAN IP (one via
`network_mode: host`, one via a normal port mapping), Prometheus reaching
either from its own bridge network isn't the same problem.

## Deploy

```bash
mkdir -p /DATA/AppData/prometheus
sudo chown -R 65534:65534 /DATA/AppData/prometheus
cd /DATA/Infrastructure/homelab/services/prometheus
docker compose up -d
```

The `chown` is required, not optional: unlike every other service deployed
so far, the official `prom/prometheus` image runs as a non-root user
(`nobody`, UID/GID `65534`) rather than root. A freshly-`mkdir`'d directory
is owned by whoever ran the command — not `65534` — so without this step
Prometheus panics on startup (`permission denied` opening its own query log)
and sits in a restart loop that *looks* like a running container in
`docker ps` right up until you check its actual status or logs. This is the
first concrete, verified answer to the open question in `docs/storage.md`
about non-root UIDs and `AppData` permissions — see that document for the
general write-up.

Deploy `node-exporter` and `cadvisor` (see their READMEs) either before or
after this — order doesn't matter, Prometheus will just show scrape targets
as down until they're up.

## First Run

Browse to `http://192.168.68.110:9090`. Under **Status → Targets**, confirm
all three jobs (`prometheus`, `node-exporter`, `cadvisor`) show as `UP` once
those services are deployed. If a target shows `DOWN`, the error message
there (e.g. connection refused vs. timeout) is the fastest way to tell "not
deployed yet" from "deployed but unreachable."

## Retention and Scrape Interval

Left at sensible defaults rather than tuned: `scrape_interval: 15s` (a
common baseline — frequent enough for meaningful graphs, not so frequent it
generates excessive write volume for a single-host homelab) and
Prometheus's own default 15-day retention (untouched — no retention flag
set). Both are easy to revisit once actual disk usage or graph resolution
needs are observed, rather than guessed at upfront.
