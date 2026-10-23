# Pangolin

Self-hosted identity-aware reverse proxy and tunnel, adopted as this
homelab's general public front door — the mechanism for exposing services
to people outside the household without a VPN client.

**This service has no `compose.yml` in this directory.** Unlike every other
entry under `services/`, its control plane (Pangolin + Traefik + Gerbil)
runs on a separate rented VPS, not on `homelab-server` — see "Architecture"
below for why. The piece that *does* run on `homelab-server` is the Newt
connector, tracked separately at `services/newt/`. This README documents
the whole system; `services/newt/README.md` documents just its half.

## The Problem This Solves

A non-technical friend needed a handful of files from `services/smb/`'s
share. The only remote-access path that existed was inviting them into the
full tailnet as a member (`services/smb/README.md`'s "Remote Friend Access"
section) — installing Tailscale, logging in, finding the share. Too much
for a non-technical person, and the friend gave up.

**Root cause, not just the trigger:** SMB is a raw file-sharing protocol
with no web mode — it can only be reached over a real network-layer
connection (LAN or VPN), which is *why* full tailnet membership was the
only option. Tailscale Funnel (already proven for Jellyfin, see
`services/tailscale/README.md`) can't carry SMB either — it only proxies
HTTPS/TCP.

## Why Pangolin, and Not Something Narrower

A narrower fix was seriously on the table: a lightweight web file-browser
exposed on a second path under the *already-funneled* Jellyfin hostname
(`tailscale serve --set-path=/files ...` — confirmed to coexist with the
existing `funnel --https=443` mapping), reusing infrastructure that already
works for zero new cost. That remains the smaller, cheaper answer to the
literal file-sharing problem.

**Deliberately chosen to go bigger instead**, because the underlying need
recurs: `docs/roadmap.md`'s Phase 6 already lists reverse proxy, SSL
automation, and identity provider/SSO as open platform goals. Rather than
solve "one friend, one file share" and hit the same wall again for the next
external-access need, Pangolin is being adopted as the **general front
door** — one place that fronts every service meant to be reachable from
outside the household, with real per-resource or per-user access control
and (once confirmed available, see "Open Questions" below) SSO across all
of them. Tailscale Funnel is not being removed yet; see "Rollout" below.

This is a materially bigger commitment than the original ask: a rented VPS
(recurring cost, new attack surface to patch and monitor), a purchased
domain, and a new platform to operate. Accepted deliberately, not
backed into.

## Architecture

```text
                    Internet
                       |
              (friend's browser, HTTPS)
                       |
                       v
        ┌─────────────────────────────┐
        │   VPS — public IP           │
        │  ┌────────┐  ┌───────────┐  │
        │  │Pangolin│  │  Traefik  │  │   Pangolin: control plane,
        │  │ (ctrl  │──│ (reverse  │  │   dashboard, org/site/
        │  │ plane) │  │  proxy,   │  │   resource model, auth
        │  └────────┘  │  TLS)     │  │
        │       |      └───────────┘  │   Traefik: terminates TLS,
        │       |            |        │   routes by hostname
        │  ┌────────┐        |        │
        │  │ Gerbil │────────┘        │   Gerbil: WireGuard endpoint
        │  │(WG side│                 │   on the VPS side
        │  └────────┘                 │
        └───────────|──────────────────┘
                     | WireGuard tunnel (outbound from home,
                     | no inbound port-forward needed)
                     v
        ┌─────────────────────────────┐
        │   homelab-server (home LAN) │
        │  ┌────────┐                 │
        │  │  Newt   │── proxies to → whatever service a Resource
        │  │(connector)│               points at (e.g. Filebrowser,
        │  └────────┘                 │  eventually Jellyfin)
        └─────────────────────────────┘
```

**Why the control plane lives on a VPS, not `homelab-server`:** Pangolin's
model is inbound-proxy-based — public traffic has to land somewhere with a
real public IP before it's authenticated and tunneled back down. This
homelab's home internet connection has no static public IP and (correctly,
per every existing security decision in this repo) no inbound port-forward
to the LAN. Newt is the piece designed to sit behind that: it's an
outbound-only connector, dialing out to the VPS over WireGuard, so nothing
on the home network ever needs to accept an unsolicited inbound connection.

**Why not run everything on one VPS instead of a home server at all:**
out of scope for this change — the whole rest of the platform (Jellyfin,
Home Assistant, monitoring, backups) stays exactly where it is. Pangolin
only adds a new *front door*, it doesn't relocate anything behind it.

## Domain

A **new, dedicated domain** is being bought for this — not the household's
existing business email domain. See
`services/caddy/README.md`'s "Why Not a Public Certificate" section for
why that domain is a live-mail liability for anything DNS-related; in
Pangolin's specific case the constraint is narrower (Traefik only needs
HTTP-01/TLS-ALPN-01 — a plain A record, not a DNS-01 migration — since the
VPS has a public IP and answers on 443 directly), but a dedicated domain
was chosen anyway to keep personal homelab traffic off business-owned DNS
entirely, and to avoid re-litigating this question for every future
public-facing project.

Not yet purchased as of this draft. Once bought, its DNS just needs one
`A` record pointing at the VPS's public IP (plus any subdomains per
Resource, or a wildcard `A`/`CNAME` if the registrar supports it) —
no migration to a different DNS host required.

## Licensing: Enterprise Edition

Running the **Enterprise Edition** (`fosrl/pangolin:ee-latest` /
pinned equivalent), not Community. Confirmed genuinely free for
personal/hobbyist use (and businesses under $100k USD/yr revenue), but
still requires applying for a free license key:

1. Create an account and org at [app.pangolin.net](https://app.pangolin.net).
2. Fill in the license request form.
3. Activate the issued key at `/admin/license` on the running instance.

Community and Enterprise share the same database schema — switching later
is a Docker image tag change, not a migration, so starting on Enterprise
carries no lock-in risk if the license turns out unnecessary.

### Open Question — Verify Before Relying On It

**Whether SSO/external-identity-provider integration and RBAC are actually
included in the free personal Enterprise license, or gated behind
Pangolin's paid self-hosted tiers** (Starter $449/yr for 25 users, Scale
$1,249/yr — a *separate* pricing table from Pangolin Cloud's SaaS pricing,
which clearly does gate SSO+RBAC behind its paid Team tier). Public
docs/README/pricing pages didn't give a clean self-host-specific feature
matrix as of 2026-09-13. **Needs to be checked directly** by signing up at
app.pangolin.net and inspecting what the free license actually unlocks,
before assuming the "SSO across every service" part of this plan's scope
is achievable for free. If it turns out gated, the fallback is per-resource
password/pincode auth (still solves the original friend-file-sharing
problem fine) with real SSO revisited later as a deliberate paid upgrade.

## Rollout — Staged, Not Straight to "Replace Everything"

Mirrors the same pattern already used for Caddy (`services/caddy/README.md`
— pilot one hostname before batch-rolling the rest) and the Jellyfin Funnel
work (`services/tailscale/README.md` — `serve` before `funnel`, tailnet-only
before public):

1. **Stand up the VPS + Pangolin + Newt.** Prove the tunnel mechanics work
   at all before pointing anything real at it.
2. **First Resource: Filebrowser** (`services/filebrowser/`), read-only
   against the same files the SMB friend-access share exposes. This is the
   actual trigger for the whole project — get it working end-to-end for
   the friend before touching anything else.
3. **Only after that's proven:** revisit whether Jellyfin migrates off
   Tailscale Funnel onto a Pangolin Resource, and whether the SMB friend
   user (`services/smb/README.md`) gets retired once Filebrowser replaces
   its use case. Not decided yet — Funnel is proven, low-maintenance, and
   free; there needs to be a real reason to move it, not just "because
   Pangolin now exists."

## Manual Setup (VPS Side) — Runbook

Not yet executed as of this draft — domain and VPS are still pending. Steps,
for when both exist:

```bash
# On the VPS, as root or a sudo user:
curl -fsSL https://digpangolin.com/get-installer.sh | bash
# Official guided installer: asks for the domain, an admin email, and
# whether to enable the Enterprise license during setup. Generates its own
# docker-compose.yml and config files on the VPS -- these are NOT
# hand-authored in this repo, deliberately: the installer wires up
# Traefik's ACME config and Gerbil's WireGuard keys correctly, and
# hand-rolling a from-scratch compose stack here would just drift from
# whatever the installer actually produces.
```

After install:

1. Point the domain's `A` record at the VPS's public IP (if not already
   done before running the installer).
2. Log into the Pangolin dashboard at `https://<your-domain>`, create the
   first Org.
3. Apply for and activate the Enterprise license key (see "Licensing"
   above).
4. Create a **Site** for `homelab-server` — this generates the `NEWT_ID`
   and `NEWT_SECRET` needed by `services/newt/.env` (see
   `services/newt/README.md`).
5. Create a **Resource** pointing at Filebrowser's port on
   `homelab-server` (see `services/filebrowser/README.md`) once Newt is
   connected and shows the Site online.
6. Set that Resource's access control (password/pincode, or SSO once
   confirmed available) — never leave a Resource with no auth gate, same
   lesson already learned the hard way with Funnel+Jellyfin
   (`services/tailscale/README.md`: "Funnel is on, Jellyfin's own login is
   the sole auth gate").

**Backing up the VPS's own config/state is a real gap this plan doesn't
close yet** — it's a new single point of failure outside this repo's
existing Backrest/B2 coverage (`docs/backup.md`). Revisit once the VPS
exists; likely just needs its own restic/Backrest target pointed at
whatever Pangolin's own data directory turns out to be.

## Not Yet Decided

- VPS provider/region/size. A starting-point suggestion: something like
  Hetzner CX22 (2 vCPU / 4GB RAM, ~€4-5/mo) — 2-4GB RAM / 2 vCPU is
  reportedly sufficient for a homelab-scale Pangolin instance. Not
  committed to a provider yet.
- Whether the friend also keeps her own login on Filebrowser (defense in
  depth) in addition to Pangolin's Resource-level gate, matching the
  Funnel/Jellyfin lesson above — leaning yes, not finalized.
- Fate of the SMB friend user and Tailscale Funnel once this is proven —
  see "Rollout."
