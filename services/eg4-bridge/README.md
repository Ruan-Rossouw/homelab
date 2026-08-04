# eg4-bridge

Closes out `services/home-assistant/README.md`'s last "Not Yet Built" item:
the LuxPower inverter (model **SNA 5K**, WiFi datalogger serial
`BA11340095`) is now bridged into Home Assistant over MQTT instead of
staying unintegrated. Talks directly to the dongle over the LAN — no
LuxCloud dependency once running, even though LuxCloud was needed for the
one-time vendor-app setup that unblocked this.

## Why This Tool, Specifically

The obvious pick was `celsworth/lxp-bridge` (what `services/home-assistant/README.md`
originally named as the likely candidate). It turned out to be **officially
unmaintained** — the repo says so directly and points at
[`jaredmauch/eg4-bridge`](https://github.com/jaredmauch/eg4-bridge) as the
maintained successor (same LuxPower/EG4 protocol lineage, active commits
through mid-2026). Went with the fork over the abandoned original — matches
the project's general local-first bias (Decypharr over polling a slower
remote refresh is the closest existing precedent), but the maintenance
status mattered more here than it did there: this talks to a proprietary
binary protocol that only works because someone reverse-engineered it, and
an abandoned reverse-engineering project has no one left to fix it if the
dongle's firmware ever changes shape.

**The real cost of that choice**: unlike every other service in this repo,
`eg4-bridge` has no pre-built image published anywhere. It has to be built
from source.

## Fixed: Upstream's Dockerfile Doesn't Match Its Own Build Output

Upstream's own `Dockerfile` has two problems, both confirmed against the
pinned commit's actual build output rather than assumed from reading the
source:

1. It only copies the compiled binary into the runtime stage — not the
   `doc/` directory. The binary hard-requires `doc/eg4_registers.json` at
   startup (see `src/config.rs`'s `register_schema()`: it falls back to
   the relative path `"doc/eg4_registers.json"` whenever `register_file`
   isn't set, and `panic!`s if that file can't be found either way). Built
   and run exactly as upstream ships it, the container starts and
   immediately crashes.
2. It still names the compiled binary `lxp-bridge` — a holdover from
   before this fork renamed itself to `eg4-bridge`. `cargo install` at the
   pinned commit actually produces `/usr/local/cargo/bin/eg4-bridge`, so
   upstream's `COPY`/`ENTRYPOINT` lines reference a path that doesn't
   exist. This one isn't a judgment call or a subtle runtime failure —
   `docker buildx build` using upstream's own `Dockerfile` unmodified
   fails outright at the `COPY` step, confirmed while building this image
   the first time.

This repo's `Dockerfile` fixes both: copies `doc/eg4_registers.json` into
the runtime image and points `config.yaml`'s `register_file` at it
explicitly (rather than relying on the fallback lining up with the
container's working directory by accident), and copies/runs the binary
under its actual current name.

Worth knowing if this ever gets rebuilt against a newer upstream commit —
re-check both the binary name (`cargo install`'s own "Installed package"
log line states it plainly) and that `doc/`'s contents haven't moved,
rather than assuming either has stayed put.

## Built On the Mac, Not the Server

The server is the same 8 GB RAM / i5-8265U box that Immich got deferred
from for headroom reasons (`services/home-assistant/README.md`'s sibling
context, `project_homelab_overview`). Compiling a Rust project — even a
moderate one — inside `docker compose build` risks a RAM spike against
Jellyfin/Home Assistant/the *arr stack already running, for a one-time
build that gains nothing from happening on that specific machine. Built
instead on the dev Mac (Apple Silicon, cross-compiled for the server's
`linux/amd64`) and the resulting image is transferred as a tarball —
`docker save` / `docker load`, not a registry push, since this repo has no
private registry and standing one up for one image would be a
disproportionate amount of new infrastructure for this. This is a
deliberate, documented exception to the normal `git pull` → `docker compose
up` flow (`docs/architecture.md`), not an oversight — re-run the build
commands below (from the Mac) whenever the pinned commit changes, same as
`git pull` picks up any other change.

**Prerequisite**: Docker isn't currently installed on the dev Mac — install
Docker Desktop (or Colima/OrbStack, anything providing `docker buildx`)
before running the build.

## Read-Only: No Register Writes (Yet)

Both `read_only: true` settings in `config.yaml` (global and per-inverter)
are deliberate — this integration is scoped to monitoring only for now,
matching the same staged-rollout discipline as Home Assistant's own
Stage 1/Stage 2 split and the CBI breaker's cautious rollout. `eg4-bridge`
can write inverter registers (charge settings, work mode, etc.) — real
functionality, not a limitation being worked around — but that's a
meaningfully bigger blast radius than reading sensor values (upstream's own
config comment: *"i found it changed the charge settings for my battery in
some unexpected ways"*), and isn't needed for this stage's goal. Revisit
deliberately later if there's an actual automation that needs it, the same
way HomeKit Bridge was left for later rather than bundled in now.

## Networking: Outbound Only, No Published Port

`eg4-bridge` doesn't run a server of any kind — it opens two outbound TCP
connections (to the dongle on port 8000, to Mosquitto on port 1883) and
nothing listens for inbound traffic. Standard bridge networking, no `ports:`
entry needed at all; this is actually the *default* case the rest of the
repo's services deviate from with one explicit port, not an exception.

Reaches Mosquitto via the server's own LAN IP (`192.168.68.110:1883`), not
a Docker service name — `eg4-bridge` and `mosquitto` are separate Compose
projects with separate default networks (`docs/conventions.md`: "No
multi-service mega-compose files… independently deployable and
removable"), so container DNS doesn't cross between them. Same
cross-service pattern used everywhere else in this repo (Uptime Kuma's
monitor targets, for one) — reach other services over the LAN like
anything else would, not through Docker-internal networking.

Reaches the dongle at its DHCP-reserved IP on the IoT VLAN
(`192.168.68.103:8000`) — confirmed reachable from the server, same network
the geyser's Tuya integration already proved reachability across.

## Build

On the dev Mac, with Docker installed:

```bash
git clone https://github.com/jaredmauch/eg4-bridge.git /tmp/eg4-bridge-build
cd /tmp/eg4-bridge-build
git checkout 0475d855b48dd64256cd785093a0b59a805a31ff   # pinned commit, 2026-07-03

docker buildx build \
  --platform linux/amd64 \
  -f /Users/ruanrossouw/Development/homelab/services/eg4-bridge/Dockerfile \
  -t eg4-bridge:0475d85 \
  --load \
  .

docker save eg4-bridge:0475d85 | gzip > /tmp/eg4-bridge-0475d85.tar.gz
scp /tmp/eg4-bridge-0475d85.tar.gz <user>@192.168.68.110:/tmp/
```

On the server:

```bash
gunzip -c /tmp/eg4-bridge-0475d85.tar.gz | docker load
rm /tmp/eg4-bridge-0475d85.tar.gz   # and the local copy on the Mac, once loaded
```

`-f` points at *this* repo's corrected `Dockerfile` while the build context
(the final `.`) is the freshly cloned upstream source — that's why the
`docker buildx build` command runs from inside `/tmp/eg4-bridge-build` but
names a `-f` path back into this repo.

## Deploy

```bash
mkdir -p /DATA/AppData/eg4-bridge
cp config.yaml.example /DATA/AppData/eg4-bridge/config.yaml
```

Edit `/DATA/AppData/eg4-bridge/config.yaml` on the server and set the real
`mqtt.password` — the same value used when generating Mosquitto's passwd
file (`services/mosquitto/README.md`'s "First Run"). Not templated through
`.env` since this whole file only exists on the server, never in the repo
(same reasoning as Mosquitto's passwd file).

```bash
cd /DATA/Infrastructure/homelab/services/eg4-bridge
docker compose up -d
docker logs -f eg4-bridge
```

## First Run

Watch the logs for a successful connection to both the dongle and
Mosquitto. To confirm data is actually flowing before touching Home
Assistant at all:

```bash
docker exec -it mosquitto mosquitto_sub -u homeassistant -P <password> -t 'eg4/#' -v
```

Readings appearing here confirm `eg4-bridge` end of the chain works;
picking them up in Home Assistant is `services/home-assistant/README.md`'s
next step (enabling the built-in MQTT integration).
