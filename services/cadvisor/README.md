# cAdvisor

Exposes per-container resource metrics (CPU, memory, network, filesystem
usage per container) as a Prometheus scrape target. Part of the Prometheus
stack — see [`services/prometheus/README.md`](../prometheus/README.md) for
the full picture; this file covers only what's specific to this container.

## `--privileged`: A Deliberate, Larger Trade-Off Than Usual

This is the most security-sensitive service in the repo so far, and that's
worth saying plainly rather than burying in a volumes list. Every prior
service that needed elevated access (Portainer's `docker.sock` mount,
Tailscale/node-exporter's host networking) still ran as a normally-confined
container process. `privileged: true` is a different category: it hands
the container the host's full device list and full Linux capability set,
and disables most of the seccomp/AppArmor confinement Docker normally
applies. If cAdvisor itself were ever compromised — a real vulnerability or
a supply-chain issue in its image — that compromise plausibly extends to
the host, not just the container.

This is the upstream-documented deployment for cAdvisor, not a shortcut
taken here — accurate per-container metrics require reading cgroup and
container-runtime state that isn't accessible any less invasively. It was
deployed anyway, deliberately, on the judgment that this is a LAN/tailnet-only
homelab with no WAN exposure (see `docs/networking.md`'s no-direct-WAN-exposure
principle) — a meaningfully lower-risk environment for this than a
public-facing server would be. That risk calculus is specific to this box;
it isn't a blanket "privileged mode is fine," and it's worth re-examining
this decision if the network's risk posture ever changes (e.g. WAN exposure
gets introduced for some other reason).

## Deploy

```bash
cd /DATA/Infrastructure/homelab/services/cadvisor
docker compose up -d
```

No `AppData` directory needed — cAdvisor is stateless, it only ever reports
live metrics, nothing persists across a restart.

## First Run

Browse to `http://192.168.68.110:8080` for cAdvisor's own basic built-in UI,
or check the raw scrape endpoint directly:

```bash
curl -s http://192.168.68.110:8080/metrics | head -20
```

Once `services/prometheus/` is deployed, its **Status → Targets** page is
the more useful place to check — it confirms Prometheus can actually reach
and scrape this exporter, not just that it's running.
