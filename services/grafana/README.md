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

It's given a fixed `uid: prometheus` (rather than letting Grafana
auto-generate one) specifically so the dashboard JSON files below can
reference it by a stable, known value instead of something that only
exists once deployed.

## Dashboards: Provisioned from Committed JSON, Not Imported

`config/dashboards/*.json` are provisioned via
`config/provisioning/dashboards/dashboards.yml`, the same "config as code"
reasoning as the datasource above — the alternative would be clicking
**Dashboards → New → Import** by hand after every fresh deploy, which is
exactly the kind of manual step that's easy to forget ever happened.

This is a deliberate, real trade-off, not a free upgrade over the datasource
case — worth being honest about it:

- **These are large, machine-generated files** (Node Exporter Full is
  ~15,000 lines), not hand-authored config like everything else in this
  repo. Nobody's meaningfully code-reviewing a diff to that file; it's
  vendored content.
- **`allowUiUpdates: false`** — a deliberate choice, not the safer default
  glossed over. It means these dashboards are read-only in Grafana's UI;
  editing them means editing the JSON file and redeploying, not clicking
  around and saving. The alternative (`allowUiUpdates: true`) would let you
  tweak panels interactively, but every edit would save into Grafana's own
  database instead of back into this file — silently diverging the
  committed version from the running one, with nothing surfacing that it
  happened. Locking it down keeps git as the actual source of truth, at
  the cost of a slower edit loop (edit JSON → `docker compose restart
  grafana` → reload, instead of click → save). If that trade-off turns out
  to be more friction than it's worth in practice, `allowUiUpdates: true`
  is a one-line change to reverse.
- **The downloaded JSON used Grafana's shareable-export format**
  (`${ds_prometheus}` / `${DS_PROMETHEUS}` placeholders, meant to be
  resolved by the UI's *import* wizard, which file-based provisioning
  doesn't do). Both files had every occurrence replaced with the literal
  string `prometheus`, matching the datasource's fixed `uid` above — this
  repo's copies are no longer "importable via UI" in their original form,
  they're pre-wired specifically for this provisioning setup.
- **Node Exporter Full still shows a "Datasource" dropdown variable** at
  the top of the dashboard — a leftover from the original share-export
  format. It's vestigial (no panel actually reads it anymore, since they
  all reference the hardcoded `prometheus` UID directly) but harmless, and
  wasn't worth surgically stripping out of a 15,000-line vendored file for
  a cosmetic dropdown.

Updating either dashboard later means re-downloading
(`https://grafana.com/api/dashboards/<id>/revisions/latest/download`),
re-applying the same placeholder replacement, and committing the result —
not a `git pull`-and-forget upgrade path.

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

## Dashboards Included

Both provisioned automatically on first start, in a "Homelab" folder —
nothing to import by hand:

| Dashboard | Source ID | Covers |
|---|---|---|
| Node Exporter Full | `1860` | Host CPU, memory, disk, network — the most widely used node-exporter dashboard |
| Cadvisor exporter | `14282` | Per-container CPU/memory/network from cAdvisor |

Confirm both appear under **Dashboards → Homelab** and render real data
(not "No data") once Prometheus, node-exporter, and cAdvisor are all up.
