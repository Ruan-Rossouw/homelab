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

## Stage 4: Energy Cost — Custom "Energy Cost Card" (2026-08-31)

Tracking the real City of Tshwane inclining-block tariff (not a flat
rate) against the household's combined grid import (inverter + geyser,
two separate circuits at one point of municipal supply) started as a
fully custom pipeline: Utility Meter/Group helpers plus template sensors
re-implementing the tariff math by hand. Rejected that approach after
building most of it, for three concrete reasons:

1. Helper entities have no history — a Utility Meter's cumulative state
   only exists from the moment it's created forward, so it can't answer
   anything about a past month.
2. Not reactive — a fixed source → cycle → sum pipeline baked in at
   creation time. A different grouping means a new helper, not a config
   change.
3. Don't participate in the Energy dashboard's own date-picker — they're
   just regular entities with their own state history, disconnected from
   whatever range `energy-date-selection` has selected.

**What's actually in place instead**:

- One template sensor, `sensor.tshwane_marginal_rate` — the one piece of
  tariff logic HA has no native equivalent for (inclining-block pricing).
  Returns the current marginal R/kWh rate based on
  `sensor.total_grid_import_monthly` (the pre-existing combined-total
  Group helper). Wired into **both** grid sources in Settings →
  Dashboards → Energy as "an entity with the current price."
- Because cost for each source is `price(t) × Δconsumption(t)`, applying
  the *same* rate entity to both sources sums to the same result as
  applying the tariff to the combined total — no per-source tariff split
  needed, which is what made this deferred the first time it came up.
  Once wired, HA auto-generates a `_cost` statistic per source (e.g.
  `sensor.geyser_total_energy_cost`,
  `sensor.luxpower_inverter_grid_energy_from_grid_today_cost`) — real
  entities with proper long-term statistics, no template math involved.
- **`custom-cards/energy-cost-card.js`** — a small dependency-free
  custom Lovelace card (`type: custom:energy-cost-card`) replacing what
  would otherwise be a Group helper + Utility Meter + apexcharts-card
  chart. It:
  - Discovers which stat_ids to sum by reading `energy/get_prefs`
    (`energy_sources` where `type === "grid"`, each entry's `stat_cost`
    field) — the same lookup the native energy cards use internally.
    Zero hardcoded entity IDs; add or remove a grid source in Energy
    settings and the card's inputs change with it.
  - Attaches to the exact same shared data collection
    `energy-date-selection` drives (cached on `hass.connection`, not a
    separate query) — so it always reflects whichever date range is
    selected there, rather than shipping its own picker.
  - Renders a hand-rolled inline SVG (no ApexCharts/Lit/build step) —
    deliberately dependency-free so it isn't coupled to another HACS
    card's internal bundling.
  - **Requires** an `energy-date-selection` card on the same dashboard
    view — it has no fallback of its own and will show a "waiting for…"
    message until one exists.

**Maintenance model** — deliberately *not* bind-mounted into the
container. `custom-cards/energy-cost-card.js` is tracked here like any
other file in this repo (diffable, PR-reviewed, rollback-able via git),
but deploying a change is one manual copy, same call already made for
the LuxPower integration above (HACS/build tooling not worth it for
something that changes rarely):

```bash
cp services/home-assistant/custom-cards/energy-cost-card.js \
   /DATA/AppData/home-assistant/config/www/custom-cards/energy-cost-card.js
```

Registered once as a Lovelace resource: Settings → Dashboards → ⋮ →
Resources → Add Resource → URL `/local/custom-cards/energy-cost-card.js`
→ Resource type "JavaScript Module". After the `cp` above, changes are
live immediately (static file serving, no container restart) — just a
hard browser refresh to bust the cache.

**Deliberately dropped**: the fixed monthly Basic Charge — no native HA
equivalent (no fixed-fee concept in cost tracking), and simplifying to
just the combined variable grid cost was preferred over carrying that
extra custom logic. A projection *was* added back in, but as a linear
reference line derived entirely from data the card already has (the
average rate since `data.start`, extended to `data.end`) rather than the
original tariff-reapplication approach — it doubles as an average-pace
benchmark (above/below the line = above/below the period's average),
which is also why it still draws for an already-elapsed period like
"Yesterday", using the real final total instead of an estimate.

See [`custom-cards/CLAUDE.md`](custom-cards/CLAUDE.md) before building
another card for this instance — it captures the native-styling
conventions, the shared-date-picker mechanism, and a few wrong guesses
already corrected once, so they don't need re-discovering.

## Stage 5: Wall Panel — Scene-Driven Display Card

A second kind of custom card, unlike the energy ones: `custom-cards/wall-panel-card.js`
drives the always-on lounge display (the Frameo kiosk in
[`devices/frameo-wall-panel`](../../devices/frameo-wall-panel/README.md))
from what is happening in the house. One card, seven scenes, picked in
priority order from live entity state:

| Scene | Triggered by | Shows | Backlight |
|---|---|---|---|
| `cinema` | a video is playing on the Apple TV | black | minimum |
| `music` | the HomePod (or the TV) is playing music | album art, track, progress on a drifting colour background | 30% |
| `browsing` | the Apple TV is paused or idle | poster or artwork, title, progress, on a drifting colour background | 20% |
| `sleep` | night window and the TV is off | black | minimum |
| `away` | nobody is `home` | dim clock | 12% |
| `morning` | morning window | greeting, clock, weather, power tiles | 50% |
| `day` | otherwise | clock, weather, battery, grid, geyser | 40% |

The `music` background, and the `browsing` background when there is artwork,
is an Apple Music-style fluid gradient: four soft colour blobs taken from the
artwork's own palette drift slowly behind the cover (a darker veil on the info
screen so text stays readable). It is drawn on a tiny 96x60 canvas that CSS
scales up (no blur filters, which are too slow for the panel's Mali-400 GPU),
repainted about 8 times a second. With no usable artwork (a video with no
poster, or a blank placeholder image) music falls back to a default palette and
the info screen to a calm, dark palette derived from a hash of the title, so a
given title always gets the same colours and different titles differ, and it is
never a flat black screen. If the
panel ever struggles, `fluid: false` keeps the same palette as a still
gradient. The palette and blob maths are pure and unit-tested
(`src/lib/fluid-palette.js`).

Reading an image's colours needs its pixels, and a page may only read pixels
of artwork from another origin (the Jellyfin posters on `jellyfin.home`) if the
server allows it and the image was fetched with CORS. Jellyfin sends
`Access-Control-Allow-Origin: *`, so the card fetches each artwork once in CORS
mode and uses that one same-origin copy both to show it and to read its colours.
A plain load for display first would cache a copy without the CORS permission
that a later CORS read cannot reuse. If an artwork cannot be fetched that way,
it is still shown, just without a colour palette.

**Touch controls.** The frame has a touchscreen, so the `music` scene has big
round buttons under the progress bar (previous, play/pause, next, and a
volume stepper showing the level) for whichever player is playing, and the
paused info screen has a single **Resume** button for the Apple TV. Only what
the player supports is shown (read from its `supported_features`: the HomePod
and Apple TV both support pause, play, previous, next and volume), so a button
never does nothing. Play/pause is explicit (pause while playing, play
otherwise) rather than a toggle, so a late state update cannot make a tap do the
opposite of what the screen shows; repeat taps within 350 ms are ignored.
Taps are handled by one delegated listener on the card, so the 15 s re-render
cannot drop them. `touch_controls: false` hides them. There are deliberately no
controls on the cinema screen, which is black so as not to light the room.

**The card updates itself.** The kiosk loads the dashboard once and never
reloads it, and HA lets browsers cache each card URL for 31 days, so a new
`wall-panel-card.js` on the server would otherwise never reach the panel. Every
`auto_update_minutes` (default 5) the card fetches the server's current copy
and compares its fingerprint with the copy it is running. If they differ it
refreshes its cached copy and reloads the page, so deploying a card is just
the `cp` to `www/custom-cards/`: no `?v=` bump and nothing to do on the panel.
Safeguards: it only reloads in the `day`, `morning` and `away` scenes (a reload
shows HA's bright loading screen for ~10-20 s, so never during cinema, music,
browsing or sleep), at most once per 10 minutes, and it stops retrying a
version that a reload failed to deliver. `auto_update: false` turns it off.
The first deploy of a version with this feature still needs the panel reloaded
once (power-cycle it), because the old card has no updater. Chrome on a
desktop only gets the new card after a hard refresh or a `?v=` bump of the
Lovelace resource.

**Forcing a refresh remotely.** The updater above only exists in card versions
that already contain it, so a panel still running an older card cannot update
itself, and the kiosk has no way to be reloaded by hand. `custom-cards/panel-reload.html`
reloads it from the server instead. Home Assistant pushes a dashboard change to
every open screen, so a hidden `iframe` card pointing at that page makes the panel
reload itself once:

1. Copy `panel-reload.html` to `www/custom-cards/` (same folder as the card).
2. In the Wall Panel dashboard config, wrap the card in a `vertical-stack` with the
   iframe next to it (a panel-mode view only shows its first card):

   ```yaml
   type: vertical-stack
   cards:
     - type: custom:wall-panel-card
       # ... the existing card config ...
     - type: iframe
       url: /local/custom-cards/panel-reload.html?t=<any new value, e.g. a timestamp>
       aspect_ratio: 1%
   ```

3. Give it a minute (the panel reloads, which takes 10-20 s on its CPU), then restore
   the original single-card config.

It cannot loop: the page does nothing unless it is inside a frame and given a `?t=`
token it has not seen, and it reloads at most once per token (remembered in
localStorage, shared with the parent), so a card left in place is harmless. Use a
new `t` value for each refresh. If the Lovelace resource version (`?v=`) was bumped
first, the reloaded page also loads the new card file. Tested in an iframe with the
same `sandbox` attributes Home Assistant's iframe card uses: a new token reloaded the
parent exactly once, a repeat of the same token and opening the page directly did nothing.

Some players pass a placeholder instead of real artwork (the Moonfin
Jellyfin client on the Apple TV sends a plain white image). The card
measures the image's pixel variance and, if it has no detail, drops the art
frame and backdrop for a text-only layout. Real artwork is sized from the
actual image shape (portrait, square or landscape).

Media always wins over the clock: starting a film at 01:00 goes to
`cinema`, not back to `sleep`. Each scene has a hold time (cinema 5 s,
browsing 8 s, music/day 3 s, away 30 s) so a short pause or an app switch
doesn't flash the panel. The scene logic is pure and unit-tested
(`npm test` in `custom-cards/`, `src/lib/panel-scene.js`).

Same no-helper-entities pattern as the energy cards (see
`custom-cards/CLAUDE.md`): nothing is created in HA, the card reads the
entities named in its own config. Unlike them it does hardcode no IDs,
so a different room is just a different YAML block.

Deploy and register exactly like the energy cards:

```bash
cp services/home-assistant/custom-cards/wall-panel-card.js \
   /DATA/AppData/home-assistant/config/www/custom-cards/wall-panel-card.js
```

Add a Lovelace resource `/local/custom-cards/wall-panel-card.js` (type
"JavaScript Module"), then put the card on a dedicated **panel-mode**
dashboard (one view, one card) that only the panel's non-admin user opens:

```yaml
type: custom:wall-panel-card
tv: media_player.living_room_4_living_room_4
music:
  - media_player.kitchen_homepod
people:
  - person.ruan
  - person.mieks
weather: weather.forecast_home
battery: sensor.luxpower_inverter_battery_battery_soc
grid: binary_sensor.luxpower_inverter_grid_grid_connected
geyser: sensor.geyser_power
sleep: { start: "22:30", end: "06:00" }
morning: { start: "06:00", end: "10:00" }
```

**The TV switching off is not visible to HA.** Checked against 36 hours of
history: the Apple TV's media entity only ever reports `idle`, `paused` and
`playing` (never `standby` or `off`), and its remote entity stays `on`. So a
film paused halfway and a TV switched off look identical. The card therefore
treats a TV that has sat in `paused` or `idle` for `browsing_timeout_min`
minutes (default 15, `0` disables) as off and returns to the general
screen; a pause shorter than that keeps the info screen. For an instant
switch, point `tv_power` at any entity that really tracks the TV's power
(the TV's own integration, or a smart plug): `off`, `standby`,
`unavailable` or `unknown` counts as off immediately.

Optional keys: `jellyfin` (a `sensor.jellyfin_now_playing`) and `jellyfin_library`
(a `sensor.jellyfin_library`, the idle carousel), both described in Stage 6,
`browsing_timeout_min`, `last_film_minutes`, `tv_power`, `touch_controls`, `fluid` (`false` for a still music
background), `auto_update` / `auto_update_minutes`,
`brightness` (per-scene 0–1), `hold_ms` (per-scene),
`sleep_clock: true` (dim clock instead of pure black while sleeping).

The card is `position: fixed` over the whole viewport so it covers HA's
header; the sidebar should also be hidden for that user (Profile → "Always
hide the sidebar"). If the panel is used in the lounge, the backlight is
driven through the kiosk app's `KioskBridge` — a no-op in any other
browser.

## Stage 6: Wall Panel — Jellyfin Descriptions and Posters

The Apple TV tells Home Assistant only a title, an episode label, a progress
position and a picture, and the Moonfin client sends a blank white image.
Jellyfin has the real description, rating, genres and poster, so
`packages/jellyfin_now_playing.yaml` asks Jellyfin what the Apple TV is
playing and exposes it as `sensor.jellyfin_now_playing` (`idle`, `playing`
or `paused`, with the details in a JSON `data` attribute). The wall panel
card uses it, when configured, to show the portrait poster, episode line,
chips (year, rating, runtime, genres) and the description on the `browsing`
scene.

How it works: a `rest_command` calls `http://localhost:8096/Sessions` (host
networking, so `localhost` is the server) every 5 seconds from a
trigger-based template sensor. Only the session whose `DeviceName` is
`Apple TV` counts, so a browser or phone playing something is ignored. The
card only borrows the description when the Apple TV's title equals
Jellyfin's series or episode title, so a stale session can never put the
wrong film's description under the right poster. If Jellyfin is down or
nothing matches, the card falls back to what the Apple TV provides.

The Jellyfin API key lives only in HA's own `secrets.yaml` on the server
(`!secret jellyfin_api_key`), never in the dashboard, the card or on the
panel. Jellyfin API keys cannot be scoped: this one has full access to
Jellyfin, so label it `ha-wall-panel` and revoke it in Jellyfin if the
panel is ever lost. Poster images are fetched by the panel from
`https://jellyfin.home` (no login needed for images), through Caddy, whose
mkcert certificate the kiosk app already trusts.

Jellyfin only reports an item to Home Assistant while it is *playing*, and the
Moonfin client does not report which item it is merely *viewing* (checked against
the session's fields: there is no `NowViewingItem`), so details cannot be shown
while you browse a movie's page. Two things cover the gap:

- **The last film is remembered.** `sensor.jellyfin_now_playing` keeps a `last`
  attribute (and the Jellyfin `user_id`). When Moonfin leaves playback Jellyfin
  drops the item but the Apple TV still says it is paused on that title; the paused screen
  then still shows that film's poster and details, but only while the Apple TV's
  title matches (case and punctuation ignored), so a stale item never appears
  under a different title.
- **An idle carousel.** `sensor.jellyfin_library` (refreshed every 30 minutes, and
  on demand by firing the `wall_panel_refresh_library` event) holds `resume`
  ("Continue watching", needs the user id above) and `recent` ("Recently added").
  The card steps through them, 15 seconds each, with the same poster-and-details
  layout, a "% watched" bar for partly watched items and a fade between items.
  Enable it with `jellyfin_library: sensor.jellyfin_library` in the card config.

  When it shows: with Moonfin the Apple TV hardly ever reports `idle` (leaving
  playback leaves it `paused` on the film; over 45 minutes of real history `idle`
  appeared once, for under a second), so an idle check alone would almost never
  show it. The carousel therefore takes over when the Apple TV is `idle`, **or**
  once Jellyfin has had no playing item for `last_film_minutes` (default 2, `0` =
  straight away) while the Apple TV is still paused on that film: for those two
  minutes you see the film you just left, then the carousel, until the
  `browsing_timeout_min` timeout (15) treats the TV as off and the panel returns
  to the Day screen. A pause *inside* a film keeps its item in Jellyfin, so it
  keeps its details however long it lasts.

After copying a changed package, `template.reload` (Developer Tools → YAML →
"Template entities") applies sensor changes without a restart; changes to the
`rest_command` section need `rest_command.reload` or a restart.

**Deploy** (the first time):

1. In Jellyfin: Dashboard → Advanced → API Keys → **+**, name it
   `ha-wall-panel`.
2. Add the key to HA's secrets, typed at a hidden prompt:

   ```bash
   printf "Jellyfin key: "; stty -echo; read K; stty echo; echo; printf '\njellyfin_api_key: %s\n' "$K" >> /DATA/AppData/home-assistant/config/secrets.yaml; unset K
   ```

3. Enable packages once, by adding this to `configuration.yaml`:

   ```yaml
   homeassistant:
     packages: !include_dir_named packages
   ```

4. Copy the package and the rebuilt card:

   ```bash
   mkdir -p /DATA/AppData/home-assistant/config/packages
   cp services/home-assistant/packages/jellyfin_now_playing.yaml /DATA/AppData/home-assistant/config/packages/
   cp services/home-assistant/custom-cards/wall-panel-card.js /DATA/AppData/home-assistant/config/www/custom-cards/
   ```

5. Developer Tools → YAML → **Check configuration**, then restart Home
   Assistant (needed this first time only).
6. Bump the card's Lovelace resource (`?v=`) and add one line to the card
   config: `jellyfin: sensor.jellyfin_now_playing`.

## Stage 7: Wall Panel — Real Screen Off, Navigation, Mini-Player, Geyser

- **Screen off/on.** `packages/wall_panel_power.yaml` switches the panel's
  display off and on through the Android Debug Bridge integration
  (`KEYCODE_SLEEP` 223 / `KEYCODE_WAKEUP` 224). Android keeps running, so
  there is no boot screen. Off: a film is playing, bedtime (after 20:00, Apple
  TV idle, every home person's phone charging), or nobody home for 10 minutes.
  On: 06:00, first arrival while the sun is up (same rule as "Play music when
  anyone arrives"), or a film stopping. The integration entity must be named
  `media_player.wall_panel_adb`; its key lives in the HA config directory
  (`wall_panel_adbkey`, never committed). The frame needs a DHCP reservation,
  as the integration connects by IP.
- **Navigation.** Swipe left/right between home, music and movies; three dots
  show the page. A manual page returns to the automatic one after
  `nav_return_minutes` (5) or when the automatic scene changes.
- **Mini-player and power tile.** The home screen shows a music tile
  (`mini_style`: `tile`, `bar` or `orb`) and one Power tile (battery %,
  charging/discharging via `battery_power`, grid state). Music stays on screen
  `music_linger_seconds` (30) after a pause.
- **Geyser.** Tapping the geyser tile opens a sheet: On, Off and "heat for
  the timer's duration". It reuses `script.toggle_geyser` and the existing
  `timer.geaser_timer` (config keys `geyser_switch`, `geyser_timer`).

### Deploying cards and packages

Merging to `main` is enough: the auto-deploy poller (`docs/zimaos.md`) runs
`services/home-assistant/deploy-hook.sh`, which copies the built cards and
the packages into the config directory within about five minutes. Reload
the changed package afterwards (or restart HA). The wall panel picks up a
new card by itself.

### Burn-in guard (pixel shift)

Every few minutes the card slowly nudges the whole static layout (text, tiles,
dots, buttons) by up to three pixels in a rotating pattern; the backgrounds
stay put. Keys: `pixel_shift` (default on), `pixel_shift_minutes` (3),
`pixel_shift_px` (3). The frame is an LCD, so the risk is temporary image
retention rather than burn-in, and the screen is also off at night, when
nobody is home and during films.

### Power details screen

Tapping the Power tile opens a full screen (with a "Home" back button): battery (with time to full or time
left), what the home is using, grid import or export, solar, today's grid cost
and energy, and the geyser. Extra card keys: `grid_from`, `grid_to`,
`pv_power` (W), `grid_today_kwh`, `grid_export_today_kwh`, `pv_today_kwh`,
`battery_temp` and `grid_volts`. "Home using" is worked out as grid net +
battery discharge + solar, so it is approximate. It closes by itself after a minute without
touch. The music and movies screens have a faint home button in the corner
(`home_button`: `icon` (default), `pill` or `off`).

Tapping Battery, Home or Grid there opens a detail screen with a
graph (6 h or 24 h) and a few figures for that item: battery (lowest and
highest, energy charged and discharged today), home (peak, average, lowest)
and grid (import, export, cost, peak). The graph uses Home Assistant's
5-minute statistics (`recorder/statistics_during_period`), about 288 points a
day, so it is cheap to load; "Home" is worked out from grid, battery and solar
like the sheet's own figure. Extra keys: `battery_charge_today` and
`battery_discharge_today` (kWh).

### Power cut screen

When the inverter's grid sensor (`grid`) reads off, the panel shows the battery
percentage, roughly how long it will last, what is drawing from it and what
the grid has cost today. Extra card keys: `load_power` (the inverter's backup
output power in W), `battery_ah`, `battery_volts`, `battery_reserve_pct`
(default 10) and `grid_cost` (grid cost today). The runtime is usable energy
(Ah x V x charge above the reserve) over the load, so it is approximate and
depends on the Ah value matching the whole battery bank. The geyser is never
on the battery. Sleep, music and nobody-home screens still take priority.

## Not Yet Built

- **HomeKit Bridge** — deliberately not set up, see above. Exposing Home
  Assistant entities to Apple Home via the HomePod, if wanted later.
- **Wall panel photo mode** — a slow cross-fading slideshow on the panel's
  `day` scene after it has been idle for a while, so the frame is still a photo
  frame. Needs a photo source first (Immich is on the Phase 6 roadmap); loading
  only one image at a time would keep it light enough for the panel's 1 GB.
