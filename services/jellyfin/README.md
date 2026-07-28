# Jellyfin

The first Phase 4 application service, and the one the household expects the
most day-to-day value from. This is **Stage 1 of 2**: Jellyfin deployed on
its own, with no automation pipeline in front of it yet. The goal is narrow
on purpose — prove the server, library scanning, transcoding, and the three
client apps (iPhone/iPad, Apple TV, web) all work end-to-end before layering
Prowlarr/Radarr/Sonarr/a Real-Debrid bridge/Zurg on top in Stage 2. Isolating
this failure domain now means that if something's wrong later, it's
obviously the automation layer's problem, not Jellyfin's.

**Not pointed at `/DATA/Media`.** That drive holds the household's personal
photo/video collection, which was never actually intended to be Jellyfin
content — an earlier version of this README assumed otherwise. Jellyfin's
real content will eventually come from wherever Stage 2's Zurg mount lands,
which isn't `/DATA/Media` either. Until Stage 2 exists, this deploy uses a
single synthetic throwaway test clip (see First Run below) just to exercise
scanning/playback/transcoding without touching either.

## Networking: Bridge + Explicit Port, Not Host Mode

Jellyfin's own documentation defaults to `network_mode: host`, mainly so LAN
clients can auto-discover the server via UDP broadcast instead of being
given an address. That's declined here. Every service in this repo except
Tailscale uses bridge networking with an explicitly published port —
Tailscale's `network_mode: host` was a narrow exception for what *it* needs
to do (expose every other container's ports over the tailnet), not a
precedent for services generally. Auto-discovery only works on the same L2
network anyway, and it buys nothing for the actual harder case (phone on
cellular, reached via Tailscale) where clients need a fixed address
regardless. Bridge mode keeps Jellyfin's exposure the same shape as every
other service on the box: one port, nothing else on the network stack.

## Port: 8096, Checked Against the Existing Map

Jellyfin's default port was free — nothing else on this host has claimed it:

| Port | Service |
|---|---|
| 3000 | AdGuard Home (web UI) |
| 3001 | Uptime Kuma |
| 3002 | Grafana |
| 8080 | cAdvisor |
| 8096 | **Jellyfin** |
| 9090 | Prometheus |
| 9100 | node-exporter |
| 9443 | Portainer |
| 9898 | Backrest |

## Hardware Transcoding: Intel QuickSync via `/dev/dri`, Enabled from the Start

The server's CPU (i5-8265U, 15W mobile part) is weak for software video
transcoding — one 1080p transcode is borderline, two concurrent ones will
likely stutter. Its integrated UHD 620 graphics support Intel QuickSync,
which Jellyfin can use directly via VAAPI. Passing `/dev/dri` through now is
a one-line addition; deferring it would mean redeploying later anyway once
transcoding proves to be the bottleneck, so there's no real cost to doing it
upfront. Hardware acceleration still needs to be turned on explicitly in
Jellyfin's own **Dashboard → Playback → Transcoding** settings after first
run (device passthrough alone doesn't enable it) — set **Hardware
acceleration** to **Intel QuickSync (QSV)** and enable VAAPI decoding/encoding
there.

The synthetic test clip below is H.264/AAC in an MP4 container — compatible
enough that every client will just direct-play it by default, which
exercises nothing on the transcode path. To actually verify hardware
transcoding, force it: in the web client's player, click the quality/gear
icon and manually select a lower resolution/bitrate than the source. Then
check **Dashboard → Activity/Playback** (the active-sessions panel) for the
session — it should show `Transcode` (not `Direct Play`) with a hardware
icon, not just software `h264`.

## Volumes

- `/DATA/AppData/jellyfin/config` → `/config` — library database, users,
  metadata, plugin state. The thing that actually matters for backup.
- `/DATA/AppData/jellyfin/cache` → `/cache` — transcoding scratch space and
  image cache. Disposable; safe to wipe if it ever needs reclaiming.
- `/DATA/AppData/jellyfin/test-media` → `/testmedia`, **read-only** — the
  Stage 1 synthetic throwaway clip. Left in place as a known-good sanity
  check even now that Stage 2c is wired up — if real content ever stops
  scanning, re-checking this library first tells us whether it's a
  regression in Jellyfin itself or something specific to the new content.
- `/DATA/AppData/media-library/movies` → `/movies`, **read-only** —
  Radarr's organized output (see `services/radarr/README.md`).
- `/DATA/AppData/media-library/tv` → `/tv`, **read-only** — Sonarr's
  organized output (see `services/sonarr/README.md`).
- `/DATA/AppData/decypharr/mnt` → `/mnt`, **read-only**, mounted
  `rshared` — required for the same reason it was required in Radarr and
  Sonarr: the symlinks Radarr/Sonarr create in `/movies`/`/tv` use
  absolute paths into `/mnt/decypharr/__all__/...`, so without this mount
  present at the identical path, those symlinks dangle from Jellyfin's
  point of view even though the files are right there from Decypharr's
  side. All four of these mounts are read-only for the same reason
  Backrest's source mounts are — a media server has no legitimate reason
  to write into its own source library.

## Deploy

```bash
mkdir -p /DATA/AppData/jellyfin/{config,cache,test-media}
cd /DATA/Infrastructure/homelab/services/jellyfin
# /movies, /tv, and /mnt already exist from the Radarr/Sonarr/Decypharr
# deploys -- nothing new to create here, just mounting existing paths.
docker pull jellyfin/jellyfin:10.11.7
docker inspect jellyfin/jellyfin:10.11.7 --format '{{.Config.User}}'
```

Check the UID before assuming anything, per the standing rule in
`docs/storage.md` — Prometheus and Grafana both run as non-root by default
and both needed an explicit `chown` before their first start. The official
`jellyfin/jellyfin` image is expected to run as root unless a `user:`
override is added (unlike Grafana/Prometheus, and unlike the
`linuxserver/jellyfin` fork, which exposes `PUID`/`PGID`) — if `docker
inspect` confirms an empty/`root` user, no `chown` is needed, root reads
`/DATA/AppData` without friction. If it shows a non-root UID, `chown -R
<uid>:<gid> /DATA/AppData/jellyfin` before starting.

```bash
cp .env.example .env   # adjust JELLYFIN_PORT/TZ if needed
docker compose up -d
```

## First Run

Generate the throwaway test clip before starting the wizard — a 30-second
synthetic video, no download required, via a one-shot `ffmpeg` container
(not something that needs pinning like a deployed service; this runs once
and is discarded):

```bash
docker run --rm -v /DATA/AppData/jellyfin/test-media:/media lscr.io/linuxserver/ffmpeg \
  -f lavfi -i testsrc=size=1280x720:rate=30 \
  -f lavfi -i sine=frequency=1000 \
  -t 30 -c:v libx264 -c:a aac -shortest /media/test-clip.mp4
```

Then browse to `http://192.168.68.110:8096` and walk through Jellyfin's
setup wizard: admin account, then add a library pointing at `/testmedia`
(the container path — maps to the read-only test-clip mount above, not
`/DATA/Media`). Skip the wizard's remote-access/UPnP step — Tailscale
already covers that, per `docs/networking.md`. Set the library's content
type to **Mixed Content** and turn off metadata downloaders/image fetchers
for it in the library's advanced settings — it's a synthetic clip with a
made-up filename, so letting Jellyfin try to match it against TheMovieDB
would just generate noise, not a real test of anything. Let the scan finish
before connecting clients.

## Stage 2c: Adding the Movies/TV Libraries

Unlike the Stage 1 test clip, this is real content organized by
Radarr/Sonarr with proper TMDb/TVDB-friendly naming — so, unlike the
throwaway test library, use the **real** content types and turn metadata
**on**:

- **Movies** library → path `/movies`, content type **Movies**, metadata
  downloaders/image fetchers **on**.
- **TV Shows** library → path `/tv`, content type **Shows**, metadata
  downloaders/image fetchers **on**.

This is the step most likely to hit the unresolved Stage 1 scanner bug
(see "Known Issue" below) — if a scan completes but shows 0 items despite
files clearly being present (verify with `docker exec jellyfin ls -la
/movies` / `/tv`), that's the same bug, now blocking real content instead
of a synthetic clip.

## Known Issue: Jellyfin Library Scanner Bug (Unresolved)

Jellyfin 10.11.x (and 10.10.7, tested) has a real, unresolved scanner bug
in this environment: newly-added files sometimes never get discovered by
the library scanner, even though they're valid, correctly permissioned,
and provably readable (confirmed via a vanilla .NET program successfully
enumerating a file Jellyfin's own resolver couldn't). Matches several
open upstream issues describing 10.11.x scan/discovery regressions
(jellyfin/jellyfin#15518, #15855, #15375, #15874). Deliberately parked in
Stage 1 rather than root-caused. If hit again here: check
`docker exec jellyfin ls -la /movies` (confirm the file is genuinely
visible to the container), try **Scan Library Files** from the library's
own menu, and if that doesn't help, the next real step is testing a much
older Jellyfin version (e.g. `10.9.11`) to bound the regression, since
that's not something this repo has root-caused yet.

## Client Apps

- **iPhone/iPad** — official **Jellyfin Mobile** app, App Store. No known
  issues.
- **Apple TV** — there is no app literally named "Jellyfin" on tvOS. Use
  **Swiftfin**, a separate but Jellyfin-project-endorsed native client.
  Known live bug: Swiftfin's transcoding path on tvOS can hang (direct play
  is unaffected). Workaround: set Swiftfin's **Maximum Bitrate** to
  **Maximum** so it doesn't request a transcoded stream unnecessarily —
  most files should direct-play fine on Apple TV 4K hardware anyway.
- **Web** — `http://192.168.68.110:8096` from any browser, same as the
  first-run wizard above.
- **Remote access** — the server is already reachable over Tailscale at its
  own tailnet address (`services/tailscale/README.md`), independent of the
  subnet-routing ACL scoping (that ACL governs reaching *other* LAN devices,
  not the server itself). Any tailnet-authorized device can reach Jellyfin
  at `<server-tailnet-ip>:8096` without being on the home Wi-Fi.

## Not Yet Built

Stage 2's automation pipeline (Prowlarr, Radarr, Sonarr, Decypharr) is
built, deployed, and proven end-to-end for grabbing content — see
`services/decypharr/README.md`, `services/radarr/README.md`, and
`services/sonarr/README.md`. What's left here is confirming Jellyfin
actually plays what the pipeline grabs (Stage 2c, above), and — assuming
that works — the same client-app testing across all three clients that
was always the actual point of Stage 1.
