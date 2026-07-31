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
- `/DATA/AppData/decypharr/cache` → `/cache` — DFS chunk cache for
  streaming/seeking performance. Persisted rather than left in the
  container's ephemeral layer (the setup wizard defaults this to
  `/tmp/decypharr-cache`, which is *not* bind-mounted and gets wiped on
  every container recreation) — set it to `/cache` during setup instead,
  matching this mount.
- `/DATA/AppData/decypharr/mnt` → `/mnt`, mounted `rshared` — where the
  Real-Debrid library gets mounted via Decypharr's embedded rclone/WebDAV.
  `rshared` propagation is required so the FUSE mount created inside the
  container is visible outside it; without it, the mount would only exist
  inside Decypharr's own filesystem namespace. **Also bind-mounted
  read-only into Jellyfin, Radarr, and Sonarr** at the identical path
  (`/mnt`) — their symlinks use absolute `/mnt/...` paths, so each
  container needs the same mount to resolve them. See
  `services/jellyfin/README.md` (Stage 2c).
- `/DATA/AppData/decypharr/downloads` → `/downloads` — the symlink
  destination for the "Create Symlink" post-download action, **not** a
  subdirectory of `/mnt`. This distinction cost real debugging time:
  `/mnt/decypharr` is the DFS virtual filesystem itself, which enforces
  its own fixed internal structure (`__all__`, `realdebrid`, `torrents`,
  etc.) and doesn't support creating arbitrary new directories inside it
  (`mkdir` fails with `operation not supported`, not a permissions error).
  The download folder needs to be a genuinely separate, ordinary writable
  location that Decypharr symlinks *into* the DFS mount — set the wizard's
  **Download Folder** field to `/downloads`, never anything under `/mnt`.

## Deploy

```bash
mkdir -p /DATA/AppData/decypharr/{config,cache,downloads,mnt}
cd /DATA/Infrastructure/homelab/services/decypharr
docker pull cy01/blackhole:v2.3
docker inspect cy01/blackhole:v2.3 --format '{{.Config.User}}'
```

Check the UID before assuming anything, per the standing rule in
`docs/storage.md`. **This is one case where that check alone isn't
enough**: `docker inspect --format '{{.Config.User}}'` returns empty
(root) here, but Decypharr's entrypoint silently drops privileges to UID
`1000` at runtime regardless — a detail only visible after first start,
via `docker exec decypharr id` or by checking which UID actually owns
files it creates under `/app`. `chown -R 1000:1000
/DATA/AppData/decypharr` (all three subdirectories) before running the
setup wizard, or the wizard's mount-creation step fails with a permission
error partway through.

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

**Download Folder**: `/downloads` (see Volumes above — not `/mnt/...`).
**Cache Directory**: `/cache` (not the wizard's `/tmp/...` default).
**Mount Type**: DFS (Decypharr's own native mount, recommended over
Rclone mode for streaming performance). **Mount Path**: `/mnt/decypharr`.

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

## Status: Fully Wired In (2026-07-28)

Prowlarr, Radarr, and Sonarr are all deployed and use Decypharr as their
download client — the manual-magnet testing above is no longer how this
gets exercised day to day. `/mnt` is also bind-mounted read-only into
Jellyfin, and the whole pipeline (search → grab → cache → play) is
proven end-to-end with real content. See
`services/jellyfin/README.md`'s "Stage 2c" section for the confirmed
result — the scanner bug this section used to warn about did not recur
against real, properly-organized content.

## Real-Debrid Content Filtering (2026-05) — TorBox Added as Backup Provider

Starting ~2026-05-10, Real-Debrid began enforcing automated filename-keyword
content filtering (blocking release tags like `WEB-DL`, `WEBRip`, `AMZN`,
`NF`, `CR`, `YTS`, `RARBG`, `[eztv]`, etc.) after legal pressure from a
French rights-holder group (FNEF), under the EU DSA "trusted flagger"
mechanism. This is a server-side, content-based block — nothing to do with
this stack being misconfigured. Symptom: Sonarr/Radarr grabs fail with

```
realdebrid API error: Status: 451
```

surfaced by Decypharr at the `/unrestrict/link` step, right after a
successful grab. It hits hardest on brand-new episodes of currently-airing
shows, because *arr quality-profile scoring naturally prefers exactly the
scene-tagged releases that trip the filter, whereas Stremio's addon
ecosystem (Torrentio, Comet, etc.) got patched to filter those tags out
*before* presenting results — which is why the identical content can fail
via Sonarr but stream fine via Stremio or Real-Debrid's own website
seconds later. No config flag, request-header trick, or retry pattern
avoids it — confirmed via Decypharr's and rdt-client's own issue trackers,
no workaround exists upstream. Real-Debrid also removed its Instant
Availability endpoint in 2025, so pre-checking cache status isn't an
option either.

**Fix: TorBox added as a second debrid provider (2026-07-31).** TorBox is
Delaware-incorporated, outside the EU DSA mechanism that pressured
Real-Debrid, and has no equivalent filter as of this writing (AllDebrid,
by contrast, is Paris-based — same legal exposure as Real-Debrid, a weaker
long-term bet). Decypharr already supports multiple configured debrid
providers natively: on a `SubmitMagnet`/`CheckStatus` error from one
provider (including a 451), it automatically tries the next configured
provider rather than failing the grab outright
([`pkg/manager/processor.go`](https://github.com/sirrobot01/decypharr/blob/main/pkg/manager/processor.go)).
Added via Decypharr's own Settings UI, same place Real-Debrid was
originally configured — both providers stay active side by side, no
architecture change.

**Known limitation, not yet fixed upstream**: provider try-order is
currently non-deterministic (backed by a concurrent hash map, not config
array order) — there's no way yet to force "always try Real-Debrid
first." Tracked in
[decypharr#285](https://github.com/sirrobot01/decypharr/issues/285), with
two competing unmerged fixes
([#294](https://github.com/sirrobot01/decypharr/pull/294),
[#355](https://github.com/sirrobot01/decypharr/pull/355)). Not a practical
problem for playback — failover still works, it just doesn't guarantee
preferring Real-Debrid's larger cache on a given grab. Worth revisiting
once priority ordering lands upstream.

**Confirmed working end-to-end (2026-07-31)**: tested against a
previously-blocked release, Decypharr failed over to TorBox automatically,
grab succeeded, played back cleanly including on TV — no issues.

Considered and rejected before landing on this fix: **Gelato** (Jellyfin
plugin bridging Stremio addons for on-demand streaming) — mechanically
sound (same resolve-at-playtime approach Stremio uses, sidesteps the
qBittorrent-emulation code path entirely) but its own issue tracker
documents open bugs where its search feature corrupts/breaks existing
local library items in exactly the "coexist with Sonarr-managed library"
mode this use case needed. Parked, not ruled out forever — worth
reconsidering only if TorBox-as-backup stops being sufficient.

## Known Issue: Never Let Backups Read Through `/mnt`

`decypharr/mnt` is a **FUSE-mounted virtual view into Real-Debrid's
cloud storage**, not real local files — reading through it triggers an
actual network fetch from Real-Debrid per file. On 2026-07-30, Backrest's
nightly backup (which backs up `/DATA/AppData` wholesale) swept through
this path and tried to back up the entire remote-hosted library over the
network, overnight, hitting repeated I/O errors and timeouts and pegging
the server at ~100% CPU / load ~24 for 6+ hours in the process. See
`docs/backup.md`'s "Incident" section for the full diagnosis. Fixed by
excluding `/data/appdata/decypharr/mnt/**` on both Backrest Plans — this
path never needed its own backup anyway, since a rebuilt server just
remounts the same Real-Debrid content fresh. Any future backup tooling
pointed at `/DATA/AppData` needs the same exclusion applied *before*
its first run against this path, not discovered the same way twice.
