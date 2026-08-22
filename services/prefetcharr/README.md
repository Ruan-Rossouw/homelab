# Prefetcharr

A small quality-of-life piece bolted onto the Jellyfin/Sonarr side of the
Stage 2 pipeline (`services/decypharr/README.md`, `services/sonarr/README.md`).
It polls Jellyfin for active playback sessions, and when a show is far
enough into its current season, tells Sonarr to grab the next one — so the
next season is already cached via Decypharr/Real-Debrid by the time you
finish the current one, instead of waiting on a manual search.

**It only ever talks to Sonarr's API to trigger a search.** It doesn't touch
Decypharr, the DFS mount, or Jellyfin's library at all — the existing
Sonarr → Decypharr → Real-Debrid → mount → Jellyfin pipeline handles the
actual grab exactly as if you'd clicked "Search" yourself. Prefetcharr is
purely the trigger.

## Image: Official, Pinned — Not `latest`

`phueber/prefetcharr:1.6.2`, the project's own image on Docker Hub. The
upstream `README` example uses `:latest`; pinned here to `1.6.2` (current
stable tag as of this deploy) per this repo's own convention against
floating tags.

## No Port — Headless by Design

Unlike every other service in this repo, Prefetcharr has no web UI and
exposes nothing. It's a single polling loop that reads its config once at
startup and calls two other services' APIs. See
[`docs/networking.md`](../../docs/networking.md#port-map) for the full
port map — Prefetcharr is listed there as taking no port at all.

## Config: `PREFETCHARR_CONFIG`, Not a Mounted File

Prefetcharr's own docs offer two ways to configure it: a single
`PREFETCHARR_CONFIG` environment variable holding the whole TOML config, or
a `config.toml` bind-mounted at `/config`. Went with the environment
variable, for one reason: it lets the config's *structure* live in
`compose.yml` (versioned, reviewable) while the two secrets it needs —
Jellyfin and Sonarr API keys — get interpolated in from `.env` (gitignored)
via `${JELLYFIN_API_KEY}` / `${SONARR_API_KEY}`. A mounted `config.toml`
would have put those same keys in a plaintext file on disk with no
`.gitignore` equivalent protecting it from an accidental `git add`. This is
the same reasoning as every other service's `.env` / `.env.example` split —
just applied to a tool whose only "config" *is* two API keys and a URL,
so there's no separate `/config` volume to speak of.

Tuning knobs (`interval`, `prefetch_num`, `request_seasons`, `log_level`,
etc.) are left hardcoded in `compose.yml` rather than pulled into `.env` —
they're not secret and not host-specific, just occasionally-adjusted
values, same tier as Grafana's internal container port. Only what's
genuinely per-environment (the two service URLs) and genuinely secret (the
two API keys) live in `.env`.

`.env` itself is generated, not hand-maintained — its real values live
encrypted at `secrets.enc.env` (sops+age; see `docs/secrets.md`), and
`scripts/secrets-decrypt.sh prefetcharr` produces `.env` from it. This
service was the pilot for that mechanism; see `docs/secrets.md`'s Status
section for what's proven vs. still pending.

**`request_seasons = true`** was the deliberate choice for "grab the next
season," matching the ask directly — Sonarr is told to fetch the whole
season as a pack rather than episode-by-episode, which also plays nicer
with Prowlarr's indexers (season packs are typically better-seeded/cached
than chasing individual episodes one at a time).

## User: `1000:1000`, Set Explicitly

Prefetcharr's own image doesn't support `PUID`/`PGID` env vars the way the
linuxserver.io images do — its upstream `docker-compose` example instead
sets `user: 1000:1000` directly on the container, which is what's used
here. Since the image itself tells us the UID up front, there's no need
for the usual `docker inspect --format '{{.Config.User}}'` step from
`docs/storage.md` — just `chown` the log directory to `1000:1000` before
first start, same as it would've told us anyway.

**Use `sudo` for that `chown`.** The server login (`ruan`) is UID 999, not
1000 — a non-root user can't reassign a file's owner to a UID it isn't,
only root can. Running the chown unprivileged fails silently (no error
surfaced in the container logs, just a permission-denied crash loop from
Prefetcharr's Rust logger trying to create the log file), so verify with
`ls -la` that the directory actually shows `1000` as owner before starting
the container, not just that the `chown` command returned.

## Volumes

- `/DATA/AppData/prefetcharr/log` → `/log` — Prefetcharr's own log file.
  That's the only state this service has; it keeps no database and no
  queue of its own, it just re-derives "what's being watched" fresh from
  Jellyfin on every poll.

No `/config` volume — see above, the config is the `PREFETCHARR_CONFIG`
env var, not a file.

## Deploy

```bash
mkdir -p /DATA/AppData/prefetcharr/log
chown -R 1000:1000 /DATA/AppData/prefetcharr
cd /DATA/Infrastructure/homelab/services/prefetcharr
docker pull phueber/prefetcharr:1.6.2
```

`secrets.enc.env` currently holds placeholder values (mechanism pilot, see
`docs/secrets.md`) — replace them with the real keys before first deploy.
Do this from the Mac, not the server (that's where real values get typed
in and committed; the server only ever decrypts):

```bash
scripts/secrets-edit.sh prefetcharr   # or: make secrets-edit SERVICE=prefetcharr
```

Fill in:

- `JELLYFIN_API_KEY` — Jellyfin admin → **Administration → Dashboard →
  Advanced → API Keys** → add a new key.
- `SONARR_API_KEY` — Sonarr → **Settings → General → Security** → copy the
  existing key.
- `JELLYFIN_URL` / `SONARR_URL` default to this stack's host LAN IP and
  already-established ports (`8096`, `8989`) — same "host IP, never
  `localhost`" reasoning as every other cross-container connection in this
  repo (separate `docker compose` projects, no shared internal network).
  Only change these if the server's LAN IP changes.

Saving re-encrypts automatically. Commit and push, then on the **server**
(no `make` there — see `docs/secrets.md`), pull and decrypt:

```bash
git pull
scripts/secrets-decrypt.sh prefetcharr
docker compose up -d
```

## Testing the Integration in Isolation

Per this repo's staged-deploy pattern (same as Decypharr and Prowlarr
before it): confirm this piece works on its own before calling it done.

1. `docker logs prefetcharr` — first thing to check is that it started
   cleanly and didn't immediately fail Sonarr/Jellyfin connection probing
   (`connection_retries = 6` at startup). A bad API key or URL fails loud
   here, not silently.
2. Temporarily set `log_level = "Debug"` in `compose.yml` and
   `docker compose up -d` again to see each poll cycle logged — confirms
   it's actually reaching Jellyfin every `interval` (900s) and reporting
   session state, not just idling.
3. Start playback of a show in Jellyfin that's partway into a season with
   another season already available upstream (to test the everyday
   "prefetch within a season" path without needing to wait on an actual
   missing-season grab). Confirm the log shows the session being picked
   up.
4. For the actual grab path: pick a show close to the end of its last
   available season, play into it past the `prefetch_num = 2` threshold,
   wait for the next poll, then check Sonarr's **Activity → Queue/History**
   for a search Prefetcharr triggered (not one you started by hand).
5. Once confirmed, set `log_level` back to `"Info"` and redeploy — `Debug`
   is noisy for something meant to run unattended long-term.

## Status: Confirmed Working in Isolation (2026-08-15)

Deployed on `feature/prefetcharr` and confirmed polling Jellyfin and
reaching Sonarr successfully.

**Secrets fully migrated to sops+age (2026-08-18):** `secrets.enc.env`
holds the real `JELLYFIN_API_KEY`/`SONARR_API_KEY`, not placeholders.
Confirmed by redeploying against them, not just by decrypting and
inspecting: `docker compose up -d --force-recreate` on the server
produced a genuinely fresh container (`Started`, not just left running)
whose logs show a clean startup and `Start watching Jellyfin sessions`
with no connection error — the failure mode a bad key/URL would produce.
See `docs/secrets.md`'s Status section — this is the first (and so far
only) service fully migrated; the rest are still on plain `.env`.
