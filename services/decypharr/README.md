# Decypharr

The first piece of the Stage 2 automation pipeline (see `services/jellyfin/README.md`
for Stage 1). Decypharr does two jobs in one process: it impersonates a
qBittorrent-compatible download client so Radarr/Sonarr can hand it a
magnet/torrent, and it forwards that to Real-Debrid instead of downloading
via BitTorrent locally — then exposes whatever's cached in the Real-Debrid
account as a mounted filesystem, via its own embedded rclone/WebDAV mount.

Deployed alone first, deliberately — same "prove one piece in isolation"
approach used for Jellyfin. This step only tests that Real-Debrid itself
works: add a magnet by hand through Decypharr's own UI, confirm it gets
cached, confirm the file shows up in the mount. Prowlarr/Radarr/Sonarr, and
wiring the mount into Jellyfin, come after this is proven.

## Decision: Decypharr, Not rdt-client + Zurg

The original plan (see project history) called for two separate tools: a
qBittorrent-shim bridge (rdt-client or Decypharr, undecided) plus Zurg for
the mount. That's been revised:

- **rdt-client is dead** — no longer maintained, with Decypharr explicitly
  positioned as its successor.
- **Decypharr's own built-in mount replaces Zurg**, and doing so is faster,
  not just simpler. Running Decypharr alongside a separate Zurg means
  Decypharr has to wait on Zurg's own periodic full-library refresh cycle
  (reported 5+ minutes on large libraries) before newly-grabbed content is
  visible. Decypharr's own mount mode skips that entirely.

One fewer service, less to maintain, and it's the option actually still
receiving updates.

## Privilege Footprint: Meaningfully Broader Than Every Other Service Here

Worth being explicit about, not quietly shipping: this container needs
`cap_add: SYS_ADMIN`, `security_opt: apparmor:unconfined`, and
`/dev/fuse` device access. That's a materially bigger blast radius than
anything else in this repo — Jellyfin's `/dev/dri` passthrough is a narrow,
specific device; this is closer to "let this container perform
near-root-level mount operations against the host kernel." It's not a
config choice being made carelessly — mounting a virtual filesystem via
FUSE from inside a container fundamentally requires these, there's no
lighter-weight way to do it with this tool. Just don't lose sight of it
when reasoning about this box's overall attack surface later.

## Port: 8282, Checked Against the Existing Map

| Port | Service |
|---|---|
| 3000 | AdGuard Home (web UI) |
| 3001 | Uptime Kuma |
| 3002 | Grafana |
| 8080 | cAdvisor |
| 8096 | Jellyfin |
| 8282 | **Decypharr** |
| 9090 | Prometheus |
| 9100 | node-exporter |
| 9443 | Portainer |
| 9898 | Backrest |

## Volumes

- `/DATA/AppData/decypharr/config` → `/app` — Decypharr's own state and
  `config.json` (debrid provider credentials, qBittorrent-shim settings).
- `/DATA/AppData/decypharr/mnt` → `/mnt`, mounted `rshared` — where the
  Real-Debrid library gets mounted via Decypharr's embedded rclone/WebDAV.
  `rshared` propagation is required so the FUSE mount created inside the
  container is visible outside it; without it, the mount would only exist
  inside Decypharr's own filesystem namespace. **Kept internal to this
  service for now** — not yet bind-mounted into Jellyfin. That wiring is a
  deliberate later step, once this piece is proven on its own.

## Deploy

```bash
mkdir -p /DATA/AppData/decypharr/{config,mnt}
cd /DATA/Infrastructure/homelab/services/decypharr
docker pull cy01/blackhole:v2.3
docker inspect cy01/blackhole:v2.3 --format '{{.Config.User}}'
```

Check the UID before assuming anything, per the standing rule in
`docs/storage.md`. If `docker inspect` shows a non-root UID, `chown -R
<uid>:<gid> /DATA/AppData/decypharr` before starting.

```bash
cp .env.example .env   # adjust DECYPHARR_PORT if needed
docker compose up -d
```

## First Run

Browse to `http://192.168.68.110:8282` for the setup wizard. Select
**Real Debrid** as the provider and paste the API key from
`https://real-debrid.com/apitoken` (already obtained — see project notes).
No extra whitespace when pasting; a stray space is a known way this fails
validation.

## Testing the Integration in Isolation

Before wiring up Prowlarr/Radarr/Sonarr:

1. Add a magnet link by hand through Decypharr's own UI (it has a
   qBittorrent-like interface for this).
2. Confirm it shows up as cached/downloaded against the Real-Debrid
   account.
3. Confirm the corresponding file appears under `/mnt` inside the
   container (`docker exec decypharr ls -la /mnt/...`).

Only once that round-trip is proven does it make sense to layer Prowlarr
(indexers) and Radarr/Sonarr (automated search/grab decisions) on top —
at that point Decypharr becomes their download client target instead of a
manually-added magnet.

## Not Yet Built

- Prowlarr, Radarr/Sonarr — the pieces that decide *what* to grab and hand
  it to Decypharr automatically, instead of adding magnets by hand.
- Sharing `/DATA/AppData/decypharr/mnt` into Jellyfin's own compose so the
  Real-Debrid library becomes an actual Jellyfin library. Deliberately
  deferred until Decypharr's Real-Debrid connection is proven working on
  its own.
- **Known blocker inherited from Stage 1**: Jellyfin's own library scanner
  has an unresolved bug in this environment where newly-added files never
  get discovered (see `services/jellyfin/README.md` and project history).
  Since this mount is exactly the mechanism that bug affects, expect to
  hit it again at the "Jellyfin sees the mounted content" step — building
  out the rest of this pipeline now is still worthwhile, but that specific
  link isn't proven to work yet.
