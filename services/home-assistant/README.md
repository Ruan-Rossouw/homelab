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

## Container User: Root — Vendor-Mandated, Not a Deployment Choice

Different in kind from every other root-running service in this repo:
this isn't a case of "the image happens to run root by default" (AdGuard,
Backrest) or "root is simpler to configure" (Caddy) — Home Assistant's
own project explicitly does not support and does not want non-root
operation of the official image. A real technical driver exists (some
integrations install Python packages site-wide at runtime, which only
root can do), and running non-root anyway causes Home Assistant to
mis-detect its own installation as an "Unsupported Third Party
Container," breaking its update/supervisor UX. Community workarounds
exist but aren't something to take on for a stock deployment. Nothing to
evaluate or revisit here the way Jellyfin's case might be — this one's
closed by the vendor, not by this repo's own judgment call.

## Port: 8123

Not published via a `ports:` entry — `network_mode: host` binds directly
to the host's own network stack, same as Tailscale. See
[`docs/networking.md`](../../docs/networking.md#port-map) for the full
port map.

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

## Stage 2: CBI Smart Circuit Breaker — Proven Working (2026-07-28)

The CBI device turned out to be controlling a **geyser**, and is genuine
Tuya hardware under the hood (the CBI Home app is a rebadged Tuya/Smart
Life app). Two integration paths exist — the official Tuya integration
(cloud-dependent, built into HA core, no extra install) versus LocalTuya
via HACS (fully local after setup, but Home Assistant Container has no
Supervisor/Add-on Store, so HACS itself needs a manual `docker exec`
install first, plus a one-time trip through Tuya's IoT Cloud platform to
extract a local key). **Went with the official Tuya integration** —
for a geyser schedule (not something needing sub-second local
responsiveness like a light switch), the cloud round-trip trade-off
wasn't worth HACS's extra setup surface. Revisit with LocalTuya if the
cloud dependency ever actually causes a problem in practice.

Setup: **Settings → Devices & Services → Add Integration → Tuya**, User
Code from the CBI Home app (⚙ → Account and Security), QR-code
confirmation scanned from the same app. Exposed two entities worth
knowing apart: `select.geyser_power_on_behavior` (a config setting for
what the breaker does after a power outage — **not** the live control)
and `switch.geyser_switch_1` (the actual on/off control, what everything
below targets).

**Scheduling**: a Schedule helper (`Geyser Schedule`, Settings → Devices
& Services → Helpers) with two daily time blocks — `06:00–07:00` and
`13:00–14:00`, every day — plus two automations using the dedicated
`schedule` trigger types (`Schedule block started` / `Schedule block
ended`), each simply turning `switch.geyser_switch_1` on or off. Two
small single-purpose automations rather than one automation branching on
trigger ID — same behavior, less indirection. Confirmed working: manual
**Run** on both automations toggled the geyser correctly, and both fired
correctly on their own at real schedule boundaries.

## Stage 2: HomeKit Controller — Done (2026-07-29)

Set up **HomeKit Controller** (pulls existing HomeKit accessories into
Home Assistant) — the mDNS-dependent piece host networking was chosen
for. **HomeKit Bridge** (the other direction — exposing Home Assistant
entities like the geyser back out to Apple Home/Siri via the HomePod)
was deliberately **not** set up. Home Assistant work is being closed out
here for now with that scope; Bridge can be added later without
redoing anything above if it turns out to be wanted.

## Stage 3: LuxPower Inverter — Done (2026-08-04)

The inverter (LuxPower/EG4-family hardware, marketed as **SNA 5K**, WiFi
datalogger serial `BA11340095`) is integrated via
[`ant0nkr/luxpower-ha-integration`](https://github.com/ant0nkr/luxpower-ha-integration)
(pinned commit `d3d101498bc2796d6d57142b0e8d7351fdd3cab6`) — a native Home
Assistant `custom_component` (`lxp_modbus`) that talks directly to the
dongle over local Modbus TCP. No MQTT, no separate bridge container, no
cloud dependency: just the one Python component dropped into
`custom_components/` and configured through the normal Add Integration UI.
Installed by manual copy rather than bootstrapping HACS — same call as the
CBI breaker's Tuya integration (Stage 2 above): not worth HACS's setup
surface for a single component. Produces 700+ entities across sensible
device groupings (Battery, Grid, PV, EPS, Generator, Smart Load,
Schedules), all confirmed showing live, real-time-updating values.

**First attempt, abandoned**: tried `jaredmauch/eg4-bridge` first (an
MQTT-based bridge, which would have meant standing up this repo's first
Mosquitto broker too). Found and patched two real upstream bugs along the
way — including one where upstream constructs its own periodic re-poll
scheduler but never actually spawns it anywhere in the codebase, so it
only ever received data once, at initial connection — but a deeper
protocol-level issue remained even after patching. Initially suspected to
be newer LuxPower firmware deliberately blocking local port 8000 (a
real, documented phenomenon for *some* dongle hardware generations), but
`lxp_modbus` successfully reading the exact same dongle/IP/port proved
that theory wrong: `eg4-bridge` simply had a broken protocol
implementation for this hardware, not a vendor-imposed wall. Full
investigation (including the Dockerfile/scheduler patches) lived in PR #73,
closed without merging once superseded — this repo doesn't carry
non-functional code forward, per `docs/architecture.md`.

## Not Yet Built

- **HomeKit Bridge** — deliberately not set up, see above. Exposing Home
  Assistant entities to Apple Home via the HomePod, if wanted later.
