# Home Assistant

The second Phase 4 application service. Same staging discipline as
Jellyfin: this is **Stage 1** — get the platform itself deployed,
onboarded, and reachable — before wiring in any real device (the CBI
smart circuit breaker, the LuxPower/LuxCloud inverter dongle, or
HomeKit/HomePod bridging). Isolating this failure domain now means that
if a later integration doesn't work, it's obviously that integration's
problem, not Home Assistant's.

## Networking: Host Mode, Not Bridge — the Opposite Call From Jellyfin

Every service in this repo defaults to bridge networking with one
explicit published port; Jellyfin deliberately declined host mode
(`services/jellyfin/README.md`) because nothing it does actually needs
same-L2-network discovery. Home Assistant is the opposite case, and the
decision here is deliberately the other way:

- The stated goal for this service includes bridging with HomeKit — both
  pulling accessories in (HomeKit Controller) and exposing Home
  Assistant entities out to Apple Home so the HomePod can act as a hub
  (HomeKit Bridge). Both rely on mDNS/Bonjour discovery on the local
  network, which doesn't cross a Docker bridge network without extra
  plumbing (a macvlan network or an mDNS reflector), and even then it's
  fragile.
- This is Home Assistant's own official recommendation for Docker
  installs, not a project-specific judgment call.
- Other WiFi-based integrations (the CBI breaker, the LuxPower dongle if
  it ends up integrated locally rather than via LuxCloud) generally
  benefit from the same LAN-local reachability, even where they don't
  strictly require it the way mDNS discovery does.

**The real cost, named plainly**: this makes Home Assistant the *second*
exception (after Tailscale) to this repo's "bridge + one explicit port"
pattern. Worth tracking as a deliberate, cumulative decision rather than
letting exceptions accumulate silently — see `docs/architecture.md`'s
Design Priorities if a third case ever comes up.

## Privilege: Not Using `--privileged` (Yet)

Home Assistant's own quick-start docs default to `--privileged`, mainly
so USB hardware (Zigbee/Z-Wave dongles) is accessible without naming
specific devices. Declined here for Stage 1: nothing currently planned
needs USB passthrough — the CBI breaker and the LuxPower dongle are both
WiFi/network-attached, not USB. If a Zigbee/Z-Wave dongle gets added
later, the right move is a scoped `devices:` entry for that specific
`/dev/ttyUSB*` (or similar) path, not a blanket `--privileged` grant —
matches the least-privilege reasoning already applied to Decypharr's
more targeted `SYS_ADMIN`/`apparmor:unconfined` grants
(`services/decypharr/README.md`), rather than defaulting to the broadest
option available.

## Port: 8123, Checked Against the Existing Map

Not published via a `ports:` entry — `network_mode: host` binds directly
to the host's own network stack, same as Tailscale. Still checked against
the existing map for collisions:

| Port | Service |
|---|---|
| 3000 | AdGuard Home (web UI) |
| 3001 | Uptime Kuma |
| 3002 | Grafana |
| 5055 | Seerr |
| 7878 | Radarr |
| 8080 | cAdvisor |
| 8096 | Jellyfin |
| 8123 | **Home Assistant** |
| 8191 | FlareSolverr |
| 8282 | Decypharr |
| 8989 | Sonarr |
| 9090 | Prometheus |
| 9100 | node-exporter |
| 9443 | Portainer |
| 9696 | Prowlarr |
| 9898 | Backrest |

## Volumes

- `/DATA/AppData/home-assistant/config` → `/config` — the entire Home
  Assistant state: `configuration.yaml`, the entity registry, the
  recorder database (SQLite by default), integrations, automations. This
  is the one directory that actually matters for backup, already covered
  by Backrest's `/data/appdata` plan (`services/backrest/README.md`).

## Deploy

```bash
mkdir -p /DATA/AppData/home-assistant/config
cd /DATA/Infrastructure/homelab/services/home-assistant
docker pull ghcr.io/home-assistant/home-assistant:2026.7.4
docker inspect ghcr.io/home-assistant/home-assistant:2026.7.4 --format '{{.Config.User}}'
```

Check the UID per the standing rule in `docs/storage.md` before assuming
anything — the official image is expected to run as root (needed for
host-network capabilities and, later, arbitrary hardware access), but
confirm rather than assume, same as every other service here. If
`docker inspect` confirms empty/`root`, no `chown` is needed.

```bash
cp .env.example .env   # adjust TZ if needed
docker compose up -d
```

## First Run

Browse to `http://192.168.68.110:8123` and walk through the onboarding
wizard: create the admin account, confirm the detected location/timezone,
and skip integration discovery for now — nothing's wired up yet, and
Stage 1's goal is just confirming the platform itself comes up cleanly.

Remote access works the same way it does for every other service here:
reachable over Tailscale at the server's tailnet address, no extra
configuration needed (`docs/networking.md`).

## Stage 1: Platform Proven Working (2026-07-28)

Onboarding completed cleanly on the first attempt — location was the
only thing that needed manual input; admin account creation and the
detected timezone/unit-system defaults needed no changes. Confirms the
bare platform (host networking, `/config` volume, no `--privileged`) is
solid before any device integration gets layered on top.

## Not Yet Built

Device integrations, deliberately deferred to keep this failure domain
isolated from the platform itself:

- **CBI smart circuit breaker** — integration mechanism not yet
  researched (native integration vs. a HACS custom component vs. Tuya
  Local vs. cloud-only isn't confirmed). Worth verifying properly before
  building on an assumption, rather than guessing from a generic "smart
  plug" pattern that might not apply.
- **LuxPower/LuxCloud inverter dongle** — user is still completing setup
  in the vendor's own app. Likely candidates once that's done: a local
  bridge (e.g. `lxp-bridge`, talking to the dongle directly over LAN plus
  MQTT into Home Assistant) versus polling LuxCloud's own API — the
  local-bridge pattern is generally preferred across this project
  (Decypharr over polling a slower remote refresh is the closest
  precedent), but not confirmed as available/current for this specific
  dongle yet.
- **HomeKit bridging** — both directions (HomeKit Controller to pull in
  any existing HomeKit accessories, HomeKit Bridge to expose Home
  Assistant entities to Apple Home via the HomePod) are the whole reason
  host networking was chosen above, but neither is configured yet.
