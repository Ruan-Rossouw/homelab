# Networking

This document answers: **how does traffic get from A to B?** For remote
access and DNS *service* deployments, see the Phase 2 entry in
[`roadmap.md`](roadmap.md) — this document covers current physical/network
reality, not services that don't exist yet.

## Current Topology

```text
Internet
   │
   ▼
ONT (Openserve fiber termination)
   │
   ▼
TP-Link Deco — router + mesh Wi-Fi
   │
   ▼
LAN  192.168.68.0/24
   │
   ▼
Server  192.168.68.110  (ZimaOS)
```

- **ISP:** Vodacom, over Openserve fiber, terminated at an ONT.
- **LAN:** the Deco connects directly to the ONT and handles routing itself
  (not sitting behind a separate ISP-supplied router) — one router hop
  between the ONT and the LAN, subnet `192.168.68.0/24`.
- **Server:** reachable at `192.168.68.110`, a DHCP reservation on the Deco
  tied to the server's MAC address — stable across reboots and lease
  renewals, so services (e.g. AdGuard Home in Phase 2) can point at it
  directly.

This is a change from the original setup, which had a Vodacom-supplied
router between the ONT and the Deco. Removing that hop simplifies the path
and avoids the double-NAT / two-router-configs-to-keep-in-sync situation
that setup implied.

## Server Reachability

- SSH is enabled and working (ZimaOS Developer Mode).
- No inbound WAN access is configured — nothing on this network is
  port-forwarded from the internet today, and that's a deliberate default,
  not just an unconfigured gap.
- **Remote access is live via Tailscale** (`services/tailscale/`), running
  with `network_mode: host` so every service on the server — not just
  Tailscale itself — is reachable at the server's tailnet address. Verified
  working: Portainer (`:9443`) reachable from a phone on cellular data, off
  the home network entirely.
- **Subnet routing is enabled** (revised 2026-07-26 — originally scoped to
  server-only, no subnet routing): the server advertises `192.168.68.0/24`
  to the tailnet, so any authorized tailnet device can reach the whole home
  LAN by its LAN IP, not just the server. This was needed because AdGuard
  DNS rewrites (e.g. `portainer.home` → `192.168.68.110`) resolve to LAN
  IPs, which aren't reachable remotely without a routed subnet. **ACL-scoped
  the same day**: only the phone and Mac (tagged `tag:trusted-lan` in the
  Tailscale admin console) can actually route into the LAN via this
  subnet — other tailnet devices (e.g. an Apple TV) can no longer reach it.
  See `services/tailscale/README.md` for the full ACL policy and the
  parked follow-up (tagging the server itself as infrastructure). No exit
  node is advertised.

## Principle: No Direct WAN Exposure

Remote access to homelab services goes through an overlay network
(Tailscale) rather than router port-forwarding. Port-forwarding means every
exposed service is directly reachable by anything on the internet and
becomes a standalone attack surface; an overlay network means the only
thing exposed is the VPN endpoint itself, and access is tied to
authenticated devices rather than a port being open. This is a standing
security decision, not an implementation detail — future services should
assume they'll be reached over Tailscale, not by forwarding a port on the
Deco.

## Planned: Second Node Network Buildout (not yet built)

Prep work for the Phase 6 Kubernetes/second-node exploration (see
`roadmap.md`'s Immich section) — nothing below is deployed yet. Captured
here as of 2026-08-23 so the reasoning survives even though the build
hasn't started.

### Target topology

```text
Main Deco (1st floor)
   │  LAN — wired backhaul (replaces today's wireless backhaul)
   ▼
Managed Switch (2nd floor, at Second Deco's current spot)
   ├── Second Deco       (backhaul now wired instead of wireless)
   ├── Server
   ├── Mac
   └── Second node — 2013 MacBook Pro, repurposed as a headless Linux box
```

Today, Second Deco reaches Main Deco over wireless mesh backhaul, and
Server + Mac hang off Second Deco directly. Feeding a managed switch from
Main Deco and moving Second Deco/Server/Mac onto it converts that backhaul
hop from wireless to wired — Deco auto-prefers a wired link the moment it
detects one, so this is a reliability upgrade for the whole house's Wi-Fi,
not just a way to add ports for the new node.

**Switch:** managed, gigabit, sized for the 4 devices above plus headroom
for whatever Phase 6 adds next. No PoE — nothing on the network needs it
yet, and a single future PoE AP is cheaper solved with an injector or one
dedicated PoE-safe cable run than by paying a PoE premium on the whole
switch today. **Doesn't need to be Ubiquiti-branded** to support a later
full UniFi buildout: 802.1Q VLAN tagging and RJ45/Cat6 are vendor-neutral
standards, so a standards-compliant managed switch fully interoperates
with a future UniFi gateway/AP setup regardless of brand — a genuine UniFi
switch would only add unified single-pane management via the UniFi
Controller, not interoperability.

### Cabling

Going with **CCA (copper-clad aluminium), not solid copper**, for the bulk
cable run — solid copper's main advantage is lower resistance over long or
PoE-carrying runs, and all three new runs (Main Deco→Switch, Switch→Second
Deco, Switch→new node) are short and carry no PoE, so that advantage
doesn't apply here. If a PoE AP is ever added later, that run gets its own
short length of solid copper rather than paying the copper premium on the
whole cable run up front.

The Main Deco→Switch run crosses from the 1st to 2nd floor through
existing (disused) telephone-cable wall penetrations, with a few meters
exposed on the outside wall in between (low sun exposure, but still needs
protection from rain/humidity/temperature cycling — indoor-rated cable
jacket isn't rated for any of that). Decided **against** switching to
outdoor-rated Cat6 for that section: outdoor-rated Cat6 is typically
shielded (FTP), which needs different connectors than unshielded indoor
cable plus proper shield grounding — real added complexity for a few
meters. Instead: route the exposed section through PVC electrical conduit,
silicone-sealed at the top and bottom where it meets the wall, but with
the lowest point left able to weep/drain rather than fully sealed, so
trapped moisture doesn't pool against the cable. Also reseal the actual
wall penetration holes (the old phone-cable holes) on both floors while
doing this — as much a water path as the visible run.

Wiring standard: T568B both ends — no crossover cables needed, every NIC
since the early 2000s auto-negotiates (Auto-MDI/MDIX).

### Second node

2013 MacBook Pro (Retina, 13"), dual-core i5 2.4GHz, 8GB RAM — repurposed
as a headless Linux box. No built-in Ethernet port, so it connects via a
USB-to-Gigabit-Ethernet adapter instead.

## Open Questions

- **VLAN segmentation:** none currently — flat network. Deliberately
  deferred; VLANs are listed as Phase 6 (Continuous Improvement) territory
  in `roadmap.md`, not a Phase 1 or Phase 2 concern.

## DNS: AdGuard Home

Network-wide DNS filtering and local DNS resolution for homelab services
(e.g. `portainer.home` → `192.168.68.110`) — deployed in Phase 2. See
`services/adguard/README.md` for configuration details.

## Port Map

The canonical list of what's listening on which port — kept in exactly
one place rather than duplicated as a full table in ten separate
service READMEs, which is how it was done through 2026-08-22. That
pattern had already drifted by the time it was noticed during a
documentation review: several README copies still listed FlareSolverr
after it was retired, one was missing Byparr entirely, and no two
copies had the same row count. Each service's own README now states
only its own port and links back here instead of re-copying the whole
table.

| Port | Service |
|---|---|
| 53 | AdGuard Home (DNS) |
| 443 | Caddy |
| 445 | SMB |
| 3000 | AdGuard Home (web UI) |
| 3001 | Uptime Kuma |
| 3002 | Grafana |
| 5055 | Seerr |
| 7878 | Radarr |
| 8080 | cAdvisor |
| 8096 | Jellyfin |
| 8123 | Home Assistant |
| 8192 | Byparr |
| 8282 | Decypharr |
| 8989 | Sonarr |
| 9090 | Prometheus |
| 9100 | node-exporter |
| 9443 | Portainer |
| 9696 | Prowlarr |
| 9898 | Backrest |

Not listed: **Prefetcharr** (headless, exposes nothing) and
**Tailscale** (a VPN daemon, not a LAN-reachable web/API port — see
"Server Reachability" above for how it's actually reached).
