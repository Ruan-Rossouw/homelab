# Tailscale

Remote access to this server and everything running on it, without opening
any port on the router. See the "No Direct WAN Exposure" principle in
[`docs/networking.md`](../../docs/networking.md) — this service is how that
principle is actually implemented.

## What This Is

Tailscale is a mesh VPN built on WireGuard. Installing it on a device adds
that device to your private **tailnet** with a stable `100.x.y.z` address;
any other device on the same tailnet can reach it directly (usually via a
peer-to-peer WireGuard tunnel, falling back to a relay if NAT prevents a
direct connection), with no router configuration involved at all.

## Why `network_mode: host`

This container runs on the host's network namespace rather than Docker's
default isolated bridge network. That's a deliberate, load-bearing choice,
not a shortcut: in bridge mode, the tailnet connection would reach *only*
the Tailscale container itself. Host mode is what makes the server's other
services — Portainer's `:9443` today, Jellyfin/Home Assistant/Immich later —
reachable at the same tailnet address, since they all end up sharing one
network namespace.

## Scope: Server Only, No Subnet Routing

This node does **not** advertise the home LAN (`192.168.68.0/24`) as a
subnet route. The tailnet gives you remote access to *this server* and
whatever it runs — which, per the roadmap, ends up covering most of what
you'd want (Jellyfin, Home Assistant, Immich) since those are all
server-hosted services, not standalone LAN devices. Anything that needs
direct LAN reach without a server-hosted intermediary (e.g. Home Assistant
talking to smart devices locally) would be a reason to revisit this, but
that's not a need that exists today. See the design discussion in this
service's PR for the full reasoning.

## Deploy

```bash
mkdir -p /DATA/AppData/tailscale
cd /DATA/Infrastructure/homelab/services/tailscale
docker compose up -d
```

## First Run

No `TS_AUTHKEY` is set by default, so the container starts in an
unauthenticated state and waits for you to approve it. Check the logs for a
login link:

```bash
docker logs tailscale
```

Open the printed `https://login.tailscale.com/...` URL in a browser,
approve the new device, and it joins your tailnet as `homelab-server`. If
`docker logs` shows an error about `/dev/net/tun` instead (permission
denied or device not found), that means the `tun` kernel module isn't
available on the ZimaOS host — worth flagging back rather than assuming, if
it happens.

## After That

Install the Tailscale client on whatever device you want remote access
from (phone, laptop), log into the same account, and the server becomes
reachable at its `100.x.y.z` tailnet address — including Portainer at
`:9443` — from anywhere, not just the home network.
