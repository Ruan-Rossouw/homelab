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
docker pull grafana/grafana:13.1.1
docker inspect grafana/grafana:13.1.1 --format '{{.Config.User}}'
sudo chown -R 472:472 /DATA/AppData/grafana
cd /DATA/Infrastructure/homelab
scripts/secrets-decrypt.sh grafana
cd services/grafana
docker compose up -d
```

`scripts/secrets-decrypt.sh` is repo-root-relative — run it before `cd`ing
into `services/grafana/`, not after (same directory gotcha documented in
`docs/secrets.md`, just the reverse: that one was about running `docker
compose` from the wrong directory, this is about running the script from
the wrong one).

The `docker pull` has to come before `docker inspect` — `inspect` only
works on images already present locally, and `docker compose up` hasn't
run yet to pull one implicitly. The `docker inspect` step itself confirms
the UID before committing to the `chown` — worth the extra command rather
than trusting a remembered number, per the same reasoning as Prometheus's
deploy steps.

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

## Alerting: Provisioned as Code, Routed Through ntfy

`config/provisioning/alerting/` — same "config as code" reasoning as the
datasource and dashboards above, not clicked together in
**Alerting → Notification configuration**. Added 2026-07-30, verified
working end-to-end (all 6 rules load cleanly, notification policy
confirmed routing to the `ntfy` contact point, contact point's own
**Test** button confirmed a real notification arrives).

**Six rules, one "System Health" folder:**

| Rule | Fires when | Why |
|---|---|---|
| Sustained High CPU | >85% for 15min | Baseline resource alert |
| Sustained High Load Average | >1.5x core count (8 cores) for 15min | Would have caught the 2026-07-30 backup I/O storm *faster* than CPU% alone — that incident's load average was wildly disproportionate to raw CPU usage, the actual tell that something was I/O-bound |
| Backup Drive Capacity High | `/DATA/Backup` >90% full | Direct capacity alert |
| Internal Drive Capacity High | `/DATA` >90% full | Increasingly relevant now that Renovate (`renovate.json`) drives regular image version bumps, each leaving the superseded image on disk until pruned |
| Sustained Swap Usage | >80% for 15min | Usually the earlier warning sign, before a system gets as sluggish as the 2026-07-30 incident |
| Container Restart Loop | >2 restarts in 15min | cAdvisor has no direct restart-count metric (unlike Kubernetes' `kube_pod_container_status_restarts_total`) — detected indirectly via `changes(container_start_time_seconds[15m])`, since that gauge only changes value when a container actually restarts |

**Contact point uses ntfy's native JSON publish API directly**
(`url: https://ntfy.sh`, structured `payload.template` producing ntfy's
own `{topic, title, message, priority, tags}` JSON shape) rather than
Grafana's default webhook payload format, which doesn't match what ntfy
expects at all.

**The `NTFY_TOPIC` secret is encrypted, not just gitignored** — migrated
to sops+age (2026-08-18, see `docs/secrets.md`): the real value lives at
`secrets.enc.env` (committed, `NTFY_TOPIC=ENC[...]`), decrypted via
`scripts/secrets-decrypt.sh grafana` into the same gitignored `.env`
Grafana's provisioning YAML already resolved via its own `$VARIABLE_NAME`
substitution — nothing about the provisioning mechanism changed, only
where the real value is stored between deploys. A public ntfy.sh topic
name is effectively a shared secret (anyone who knows/guesses it can read
or publish to it), and this repo is public — this was, in fact, the
second service migrated (after Prefetcharr) specifically because
`.sops.yaml`'s original `encrypted_regex` didn't cover a `_TOPIC`-suffixed
key by default and needed widening.

**Fully migrated (2026-08-18):** `secrets.enc.env` holds the real topic,
not a placeholder. Confirmed by an actual redeploy
(`docker compose up -d --force-recreate`) with a clean log —
`starting to provision alerting` → `finished to provision alerting` with
nothing fatal in between — followed by the contact point's own **Test**
button in **Alerting → Notification configuration → Contact points**
confirming a real notification still arrives. Same verification standard
the original 2026-07-30 setup was held to.

**Real gotcha hit building this, worth remembering**: Grafana's webhook
contact point `payload` setting is **not** a plain string — it's a
`CustomPayload` struct requiring a `template` sub-field
(`payload: {template: "..."}`, not `payload: "..."`). Getting this wrong
isn't a soft failure: Grafana's alerting provisioning is **fatal at
startup** on a bad contact point, crash-looping the *entire instance* —
existing dashboards went down along with the broken alerting config,
not just the new feature. Confirmed the correct shape directly from
Grafana's own source
(`pkg/services/ngalert/api/tooling/definitions/contact_points.go`)
rather than guessing a second time.
