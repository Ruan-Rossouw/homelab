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
Vodacom (Openserve) — ISP
   │
   ▼
TP-Link Deco — mesh Wi-Fi / router
   │
   ▼
LAN  192.168.68.0/24
   │
   ▼
Server  192.168.68.110  (ZimaOS)
```

- **ISP:** Vodacom, over Openserve infrastructure.
- **LAN:** TP-Link Deco mesh system, subnet `192.168.68.0/24`.
- **Server:** reachable at `192.168.68.110`, a DHCP reservation on the Deco
  tied to the server's MAC address — stable across reboots and lease
  renewals, so services (e.g. AdGuard Home in Phase 2) can point at it
  directly.

## Server Reachability

- SSH is enabled and working (ZimaOS Developer Mode).
- No inbound WAN access is configured — nothing on this network is
  port-forwarded from the internet today, and that's a deliberate default,
  not just an unconfigured gap.

## Principle: No Direct WAN Exposure

Remote access to homelab services will go through an overlay network
(Tailscale, Phase 2) rather than router port-forwarding. Port-forwarding
means every exposed service is directly reachable by anything on the
internet and becomes a standalone attack surface; an overlay network means
the only thing exposed is the VPN endpoint itself, and access is tied to
authenticated devices rather than a port being open. This is a standing
security decision, not an implementation detail — future services should
assume they'll be reached over Tailscale, not by forwarding a port on the
Deco.

## Open Questions

- **VLAN segmentation:** none currently — flat network. Deliberately
  deferred; VLANs are listed as Phase 6 (Continuous Improvement) territory
  in `roadmap.md`, not a Phase 1 or Phase 2 concern.

## Planned (Phase 2, not yet implemented)

- **Tailscale** — remote access via overlay network, replacing any need for
  port-forwarding.
- **AdGuard Home** — network-wide DNS filtering and local DNS resolution for
  homelab services.

Configuration details for both belong in `services/tailscale/README.md` and
`services/adguard/README.md` respectively once those services exist — this
document will be updated to reflect the resulting topology, not to
pre-specify it.
