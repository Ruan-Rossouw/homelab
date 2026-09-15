# Trailarr

A trial deploy to fix a real, previously-diagnosed problem: trailers played
through Moonbase's YouTube IFrame embed are stuck at whatever low resolution
YouTube's own algorithm decides to serve an embedded player — confirmed as a
hard platform limit, not a Moonbase bug (two closed upstream feature
requests, both `not_planned`, both from the Moonfin maintainers themselves).
The maintainers' own recommended fix is a **local trailer file** next to the
movie, which Jellyfin serves and transcodes like any other video instead of
going through YouTube at all.

## Why This Image, Not a Custom Script

The obvious next step was a small script: look up a movie's trailer via
TMDb, pull it with `yt-dlp`, drop it next to the file. Before building that,
[nandyalu/trailarr](https://github.com/nandyalu/trailarr) turned out to
already do exactly this, actively maintained (releases every few days),
with the two things a custom script would have had to build and then
maintain forever: Intel VAAPI hardware acceleration for the ffmpeg
conversion step, and cookie-file support plus deliberate rate-limiting for
YouTube's bot-detection (`"Sign in to confirm you're not a bot"`) -- a real,
recurring problem in its own issue tracker, not a hypothetical.

## This Is a Trial, Not a Commitment

The open question this deploy exists to answer: **does it actually get
meaningfully better trailers than Moonbase's embed, from this network?**
Deliberately started **without** a YouTube cookies file -- see "Cookies:
Deferred, Not Forgotten" below. If plain, unauthenticated downloads already
land at 1080p for most of the library, that's a clean win with no further
setup. If they cap out low (the same wall a manual `yt-dlp` test hit
earlier), the next step is wiring in a cookies file, not scrapping the
approach.

## Volumes

- `/DATA/AppData/trailarr/config` → `/config` -- Trailarr's own database,
  connections, and quality profiles.
- `/DATA/AppData/media-library/movies` → `/movies` -- **the same host path
  and container-internal path** as Radarr's own `/movies`
  (`services/radarr/compose.yml`). This has to match exactly: Trailarr maps
  paths it gets back from Radarr's API against its own filesystem view, and
  a mismatch here is the same class of bug the Radarr/Decypharr path-match
  requirement already documents. Read-write -- Trailarr writes new trailer
  files as siblings of the movie file; it never touches the movie file
  itself.
- `/DATA/AppData/media-library/tv` → `/tv` -- same reasoning, matched
  against Sonarr's `/tv` (`services/sonarr/compose.yml`).

Deliberately **not** mounting `/DATA/AppData/decypharr/mnt` the way
Radarr/Sonarr do. That mount exists so those two can resolve the absolute-
path symlinks Decypharr's import creates -- Trailarr never opens the movie
file itself, only checks for a sibling trailer file's existence and writes
a new one, so it has no reason to follow those symlinks.

## Hardware Acceleration

`/dev/dri` is passed through for Intel QuickSync (VAAPI), the same device
`services/jellyfin/compose.yml` uses -- speeds up the ffmpeg re-encode step
after `yt-dlp` downloads a trailer. Unlike Jellyfin, this doesn't force a
root-vs-non-root trade-off: Trailarr's image auto-adds its container user to
the `render`/`video` groups at startup, so `PUID=1000`/`PGID=1000` and
working VAAPI access aren't in tension here the way they are for Jellyfin
(see that service's README "Container User" section for the contrast).
Verify after first start:

```bash
docker exec -it trailarr ls -la /dev/dri
docker exec -it trailarr vainfo --display drm --device /dev/dri/renderD128
```

Then confirm in Trailarr's own UI: **Settings → General → Advanced Settings
→ Health** shows which GPU it detected and whether hardware acceleration is
enabled.

## Cookies: Deferred, Not Forgotten

Trailarr supports pointing it at a YouTube cookies file (`Settings →
General → Yt-dlp Cookies Path`) specifically for cases where unauthenticated
downloads get capped or blocked by YouTube's bot-detection -- the same
mechanism a manual `yt-dlp` test against this network hit before this
service existed. **Not wired in for this first pass, on purpose** -- see
"This Is a Trial" above. If the no-cookies run underperforms, the fix is
exporting cookies from a signed-in browser session and adding them here,
not a different tool. A cookies file is live session auth, equivalent to a
password: if it's ever added, it does not belong in this repo, not even
encrypted via `secrets.enc.env` (git history is forever; a session token
that leaks once should just be revoked, not carried as project history) --
drop it directly into `/DATA/AppData/trailarr/` on the server and reference
it by path in Trailarr's UI instead.

## Port: 7889

See [`docs/networking.md`](../../docs/networking.md#port-map) for the full
port map.

## Deploy

```bash
mkdir -p /DATA/AppData/trailarr/config
cd /DATA/Infrastructure/homelab/services/trailarr
docker pull nandyalu/trailarr:0.12.1
docker inspect nandyalu/trailarr:0.12.1 --format '{{.Config.User}}'
```

Check the UID per the standing rule in `docs/storage.md` before assuming
`PUID=1000`/`PGID=1000` is sufficient -- confirm the actual runtime UID
after first start rather than trusting the image inspection alone, same
caveat `docs/storage.md` documents from the Decypharr deploy (a declared
image UID and the UID an entrypoint actually drops to can differ).

```bash
cp .env.example .env   # adjust TRAILARR_PORT/TZ if needed
docker compose up -d
```

## First-Run Setup

1. Browse to `http://<server>:7889`, create the admin account.
2. **Settings → Connections**: add the Radarr instance
   (`http://<server-or-container-ip>:7878`, API key from Radarr's own
   Settings → General) and the Sonarr instance likewise. Use host-IP
   addressing between containers, never `localhost` -- same rule
   `services/radarr/README.md` already documents for Prowlarr/Decypharr.
3. **Settings → Connections**: add the Jellyfin instance so it can notify
   Jellyfin to rescan after dropping a new trailer file, instead of waiting
   for Jellyfin's own next scheduled library scan.
4. **Settings → General → Advanced Settings**: confirm Hardware
   Acceleration is enabled (see "Hardware Acceleration" above) and leave
   **Yt-dlp Cookies Path** empty for this first pass.
5. Set a quality profile -- target 1080p, source format whatever the
   default profile ships with; revisit once real results are in.
6. Let it run against a small slice of the library first (a handful of
   movies, not the whole thing) before trusting it unattended --
   consistent with how every other new service in this repo got proven on
   a small case before being trusted broadly (Jellyfin's synthetic test
   clip, Radarr/Sonarr's single-title first import).

## Status

Not yet deployed. Waiting on the no-cookies trial run to answer the
"meaningfully better than Moonbase's embed" question above before treating
this as a kept service rather than an experiment.
