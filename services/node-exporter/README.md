# node-exporter

Exposes host-level metrics (CPU, memory, disk, network, filesystem) as a
Prometheus scrape target. Part of the Prometheus stack — see
[`services/prometheus/README.md`](../prometheus/README.md) for the full
picture; this file covers only what's specific to this container.

## Why `network_mode: host`, `pid: host`, and a Root Filesystem Mount

This is the most invasive-looking config in the repo so far, so it's worth
being explicit about why each piece is required rather than incidental:

- **`network_mode: host`** — same reasoning as Tailscale: node-exporter
  needs to read the *host's* `/proc`/`/sys`, not a container's isolated
  view of them.
- **`pid: host`** — lets it see host-level process information (needed for
  some collectors) rather than just its own container's process tree.
- **`/:/host:ro,rslave`** — a read-only, recursive-slave mount of the
  entire host root filesystem, paired with `--path.rootfs=/host` so
  node-exporter knows to treat that mount as "the real host" rather than
  monitoring its own container's filesystem. Read-only limits this to
  visibility, not write access — it can see everything, change nothing.

This is the upstream-documented deployment pattern for node-exporter, not a
homelab-specific choice — there's no meaningfully less invasive way to get
real host metrics out of a container, since the alternative (no host
namespace access at all) means it can only ever report on itself.

## Deploy

```bash
cd /DATA/Infrastructure/homelab/services/node-exporter
docker compose up -d
```

No `AppData` directory needed — node-exporter is stateless, it only ever
reports live metrics, nothing persists across a restart.

## First Run

No web UI. Confirm it's working with:

```bash
curl -s http://192.168.68.110:9100/metrics | head -20
```

You should see a stream of `# HELP` / `# TYPE` lines followed by metric
values. Once `services/prometheus/` is deployed, its **Status → Targets**
page is the more useful place to check — it confirms Prometheus can
actually reach and scrape this exporter, not just that it's running.
