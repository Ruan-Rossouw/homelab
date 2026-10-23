# Filebrowser

The pilot resource behind `services/pangolin/`'s new front door — a
read-only, browser-based file listing so a non-technical friend can grab
files with just a link, no VPN client, no app install. See
`services/pangolin/README.md` for why this exists and the full rollout
plan; this README covers just this one container.

## What It Is

A lightweight (single Go binary) self-hosted web file manager. Mounted
read-only against the same directory the SMB friend-access share already
exposes (`services/smb/README.md`) — not a new or separate data set, just
a second, easier way to reach the same files.

Deliberately **not reachable directly from the LAN or internet**: no
published port beyond the container's own `${FILEBROWSER_PORT}`, no
AdGuard `.home` rewrite, no Caddy block. The only path in is through a
Pangolin Resource once Newt is connected (`services/pangolin/README.md`'s
runbook, step 5).

## Container User

Runs as `PUID=1000`/`PGID=1000` via the `-s6` image variant (s6-overlay
build), not the plain tag's root default — chosen specifically to match
this repo's preferred non-root shape (see `docs/conventions.md`'s Compose
Conventions) rather than needing a root-justification section.

## First-Run Setup

Filebrowser's own login is a **second, independent auth gate** behind
whatever Pangolin's Resource-level access control provides — deliberate
defense in depth, not redundancy. The lesson already learned the hard way
with Tailscale Funnel + Jellyfin (`services/tailscale/README.md`: "Funnel
is on, Jellyfin's own login is the sole auth gate — no network-layer
backstop") is not being repeated here.

1. `docker compose up -d`.
2. Log in with Filebrowser's default first-run admin account (check
   current-version docs for the exact default — this changes between
   releases and isn't worth hardcoding here).
3. **Immediately** change the admin password.
4. Create a **separate, read-only user account** for the friend, scoped to
   the mounted `/srv` path only — same "unique credential, no
   guest/anonymous access" principle already established for the SMB
   friend user.
5. Delete or disable the SMB friend user once this is confirmed working,
   per `services/pangolin/README.md`'s rollout plan (not automatic — a
   deliberate decision once this is actually proven with the real friend).

## Why This Image, Not a Heavier Alternative

Nextcloud, Seafile, and similar were not seriously considered — this needs
to solve "browse and download a folder," not full sync/collaboration, and
this box has already turned away heavier tools on resource grounds more
than once (Wazuh, Immich-in-place — see `docs/secrets.md` and
`docs/roadmap.md`). Filebrowser's entire footprint is one ~128MB-limited
container with no database server, no background workers, and no ongoing
RAM cost beyond an idle Go process.
