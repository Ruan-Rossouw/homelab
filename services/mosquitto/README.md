# Mosquitto

The first MQTT broker in this repo, added specifically to unblock the
LuxPower inverter integration (`services/home-assistant/README.md`'s "Not
Yet Built"): `lxp-bridge`/`eg4-bridge` talks to the inverter's WiFi dongle
directly and republishes readings over MQTT, and Home Assistant's own
built-in MQTT integration (core, no HACS) subscribes to pick them up.
Deployed as its own service rather than bundled into Home Assistant's
container because other things (the CBI/geyser breaker, if it's ever worth
moving off the Tuya cloud integration; any future sensor) may want to
publish to the same broker later — a shared, independent broker keeps that
option open instead of coupling it to one consumer.

## Networking: Back to Bridge + One Port

Unlike Home Assistant, this doesn't need `network_mode: host` — MQTT is a
plain TCP protocol on a fixed port, no mDNS/Bonjour discovery involved.
Standard bridge networking with one explicit published port, same as most
other services in this repo.

## Auth: Not Anonymous

Mosquitto's out-of-the-box behavior on a listener with no `password_file`
configured is to refuse to start in 2.x (an explicit safety change from
1.x, which defaulted to open). Anonymous access was left off deliberately
rather than turned on to get past that: this broker relaying live inverter
telemetry (and later, potentially, exposing writable inverter registers —
`eg4-bridge` supports commands, not just readings) is exactly the kind of
thing that shouldn't be reachable by anything on the LAN without a
credential, even though the LAN itself isn't internet-exposed
(`docs/networking.md`'s "No Direct WAN Exposure"). Defense in depth, not
a response to a specific threat.

Credentials live in a `mosquitto_passwd`-generated file, not in `.env` —
Mosquitto's `password_file` directive wants a file of salted/hashed
entries, not a plaintext value an env var could hold, so unlike most
secrets in this repo (`docs/conventions.md`'s ".env, gitignored" pattern)
this one is generated straight into the persistent `AppData` volume at
deploy time instead. `.env.example`'s `MQTT_USERNAME`/`MQTT_PASSWORD`
exist only as the documented values to use *when generating* that file, and
for `lxp-bridge`/Home Assistant's own `.env` files to reference the same
pair.

## Port: 1883, Checked Against the Existing Map

Standard MQTT port, unclaimed:

| Port | Service |
|---|---|
| 1883 | **Mosquitto** |
| 3000 | AdGuard Home (web UI) |
| 3001 | Uptime Kuma |
| 3002 | Grafana |
| 5055 | Seerr |
| 7878 | Radarr |
| 8080 | cAdvisor |
| 8096 | Jellyfin |
| 8123 | Home Assistant |
| 8191 | FlareSolverr |
| 8282 | Decypharr |
| 8989 | Sonarr |
| 9090 | Prometheus |
| 9100 | node-exporter |
| 9443 | Portainer |
| 9696 | Prowlarr |
| 9898 | Backrest |

## Volumes

- `./config/mosquitto.conf` → `/mosquitto/config/mosquitto.conf` (read-only)
  — the broker config itself, versioned in the repo since it holds no
  secrets, just the listener/auth/persistence setup.
- `/DATA/AppData/mosquitto/passwd` → `/mosquitto/passwd_dir` — the
  generated credentials file. Not versioned (see "Auth" above).
- `/DATA/AppData/mosquitto/data` → `/mosquitto/data` — message
  persistence (retained messages, queued QoS>0 messages for offline
  clients).
- `/DATA/AppData/mosquitto/log` → `/mosquitto/log`.

## Deploy

```bash
mkdir -p /DATA/AppData/mosquitto/{passwd,data,log}
cd /DATA/Infrastructure/homelab/services/mosquitto
docker pull eclipse-mosquitto:2.0.22
docker inspect eclipse-mosquitto:2.0.22 --format '{{.Config.User}}'
```

Check the UID per the standing rule in `docs/storage.md` before assuming
anything — the official image is expected to run as a non-root `mosquitto`
user (unlike most services in this repo so far), which likely means
`chown`-ing the three `AppData` subdirectories above to match before the
container can write to them. Confirm rather than assume.

```bash
cp .env.example .env   # adjust MQTT_USERNAME/MQTT_PASSWORD if needed
docker compose up -d
```

## First Run: Generate the Password File

The broker will refuse client connections (not refuse to start — the
container comes up fine either way) until a passwd file exists:

```bash
docker exec -it mosquitto mosquitto_passwd -c /mosquitto/passwd_dir/passwd homeassistant
```

Deliberately no `-b` (batch) flag — that would pass the password as a
plaintext CLI argument, landing in shell history. The interactive prompt
avoids that. Use the same username/password here as `.env`'s
`MQTT_USERNAME`/`MQTT_PASSWORD` so `eg4-bridge` and Home Assistant's MQTT
integration (added next) can both authenticate with one shared credential
pair. Restart the container after creating the file so it picks up the
now-non-empty passwd file:

```bash
docker compose restart
```

Verify with `mosquitto_sub`/`mosquitto_pub` from another container or the
`mosquitto_clients` package, or just move on to wiring up `eg4-bridge` and
confirm end-to-end there.
