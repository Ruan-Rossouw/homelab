# Newt

The connector half of the Pangolin front door — see `services/pangolin/
README.md` for the full architecture and why this exists. This is the only
part of that system that runs on `homelab-server`; everything else
(Pangolin's control plane, Traefik, Gerbil) runs on a separate VPS.

## What It Does

Dials out over WireGuard to the Pangolin control plane on the VPS and stays
connected — an **outbound-only** connection, so nothing on the home network
needs to accept an unsolicited inbound connection or have a port forwarded.
Once connected, whatever Resources are configured in the Pangolin dashboard
can reach services on this LAN through the tunnel.

Runs in userspace with no elevated capabilities — no `cap_add`, `devices`,
or `privileged` needed (confirmed against the upstream image's own compose
example), so it fits this repo's default non-root, unprivileged shape with
no deviation to document.

## Setup

1. Complete `services/pangolin/README.md`'s VPS-side runbook through
   "Create a Site for homelab-server" — that step produces `NEWT_ID` and
   `NEWT_SECRET`.
2. Copy `.env.example` to `.env`, fill in `PANGOLIN_ENDPOINT`, `NEWT_ID`,
   `NEWT_SECRET`.
3. Encrypt: `make secrets-encrypt SERVICE=newt` (see `docs/secrets.md`).
   `NEWT_SECRET` is picked up automatically by the existing `_SECRET$`
   pattern in `.sops.yaml` — no config changes needed there.
4. Deploy: `docker compose up -d` in this directory (or let the existing
   auto-deploy timer pick it up once merged to `main`, per
   `docs/zimaos.md`'s "Auto-Deploy on Merge to Main").
5. Verify the Site shows **online** in the Pangolin dashboard before
   creating any Resources against it.

## Why Not `DOCKER_SOCKET`

Newt supports an optional Docker-socket integration for auto-discovering
other containers' ports, so Resources can be configured without typing a
target host:port by hand. Not enabled here, deliberately — this repo's
existing rule is that every service reaches every other service via the
host's LAN IP, never a shared Docker network or socket access
(`services/caddy/README.md`'s "Cross-Container Networking" section is the
precedent). Mounting the Docker socket into Newt would also hand it
effective root-equivalent control over every other container on this box —
a large blast-radius increase for a convenience feature. Configure each
Resource's target manually in the Pangolin dashboard instead
(`<LAN-IP>:<port>`, same pattern as every Caddy block).
