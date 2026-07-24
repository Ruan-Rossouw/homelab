# Grafana

Dashboards on top of Prometheus's stored metrics — the fourth and final
Phase 3 service. Prometheus collects and stores time series; Grafana is
where they actually become readable graphs. See
[`services/prometheus/README.md`](../prometheus/README.md) for the metrics
side of this.

## Port: 3002, Not Grafana's Default 3000

Grafana's container listens on `3000` internally, but the host port is
overridden to `3002` by default (`GRAFANA_PORT` in `.env.example`) —
AdGuard Home's admin UI already claimed `3000` on this host, and Uptime
Kuma already claimed `3001`. Current port map across every deployed
service:

| Port | Service |
|---|---|
| 3000 | AdGuard Home (web UI) |
| 3001 | Uptime Kuma |
| 3002 | Grafana |
| 8080 | cAdvisor |
| 9090 | Prometheus |
| 9100 | node-exporter |
| 9443 | Portainer |

Picking `3002` proactively avoids repeating the exact kind of collision
already hit once with AdGuard (which defaulted to port 80 during its own
setup wizard) — better to check the existing map before deploying than
discover a `port is already allocated` error, or worse, a silent conflict.

## Container User: Non-Root by Default — `chown` Before First Start

Grafana's official image runs as UID `472` (not root), same category of
issue Prometheus hit in this repo. Applying the standing rule written into
`docs/storage.md` after that incident — check the image's UID before first
deploy, `chown` the `AppData` directory to match *before* starting, rather
than discover it via a crash loop — the deploy steps below include this
upfront instead of waiting for a failure to reveal it.

## Datasource: Provisioned, Not Clicked Through the UI

The Prometheus connection (`config/provisioning/datasources/prometheus.yml`)
is set up declaratively via Grafana's provisioning mechanism, bind-mounted
into `/etc/grafana/provisioning/datasources/`, rather than added by hand in
Settings → Data Sources after first login. This is the more deliberate
choice here, not just the default: this repo's whole premise is
recoverability from Git alone, and a datasource connection is exactly the
kind of thing that's easy to forget you configured by hand until a rebuild
loses it silently. Uptime Kuma's monitors, by contrast, stayed manual —
Uptime Kuma doesn't have an equivalent clean provisioning-as-code mechanism,
so there was no meaningfully more reproducible alternative there. Grafana
does, so it's used.

## Deploy

```bash
mkdir -p /DATA/AppData/grafana
docker inspect grafana/grafana:13.1.1 --format '{{.Config.User}}'
sudo chown -R 472:472 /DATA/AppData/grafana
cd /DATA/Infrastructure/homelab/services/grafana
docker compose up -d
```

The `docker inspect` step confirms the UID before committing to the
`chown` — worth the extra command rather than trusting a remembered number,
per the same reasoning as Prometheus's deploy steps.

## First Run

Browse to `http://192.168.68.110:3002`. Log in with the default
`admin` / `admin` — Grafana forces a password change immediately on first
login, so there's no need to set `GF_SECURITY_ADMIN_PASSWORD` as an
upfront secret in `.env`, unlike Tailscale's `TS_AUTHKEY`. Once logged in,
**Connections → Data sources** should already show "Prometheus" as
provisioned and connected — if it shows an error instead, check that
Prometheus itself is reachable at `192.168.68.110:9090` from the server.

## Recommended Dashboards

Rather than build panels from scratch, import these well-established
community dashboards (**Dashboards → New → Import**, enter the ID):

| Dashboard | ID | Covers |
|---|---|---|
| Node Exporter Full | `1860` | Host CPU, memory, disk, network — the most widely used node-exporter dashboard |
| Cadvisor exporter | `14282` | Per-container CPU/memory/network from cAdvisor |

Both expect the datasource named exactly `Prometheus` — matching what's
provisioned above, so no manual re-mapping should be needed on import.
