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

## Scope: Whole Home LAN, via Subnet Routing (revised 2026-07-26)

This node **advertises the home LAN (`192.168.68.0/24`) as a subnet route**
(`TS_ROUTES`), so any authorized tailnet device can reach anything on the
home network by its LAN IP — not just this server.

This is a deliberate reversal of the original scoping decision (server-only,
no subnet routing), made after AdGuard DNS rewrites (`services/adguard/`)
turned out to only resolve to LAN IPs (e.g. `portainer.home` →
`192.168.68.110`), which are unreachable over the tailnet without a routed
subnet — the rewrites worked at home, but not remotely. The trade-off
accepted here, explicitly: this expands what's reachable from the tailnet
from "just this server" to "the whole home LAN," including any other
devices on it. That's a real increase in blast radius if a tailnet device
is ever compromised — mitigate by keeping Tailscale ACLs (in the admin
console) scoped to only the devices/users that actually need this, rather
than trusting the route to every tailnet member by default. See
`docs/networking.md`'s "Server Reachability" section for how this fits the
overall network posture.

## Deploy — Enabling the Subnet Route

Two things are required beyond `docker compose up -d`, since routing
traffic *through* the server to other LAN devices needs the host's kernel
to actually forward packets — the container's own network stack isn't
enough here, and this can't be set via Docker's `sysctls:` compose option
when using `network_mode: host` (there's no separate network namespace for
Docker to scope it to; it has to be a real host-level setting):

```bash
# 1. Enable IP forwarding on the host, persistently across reboots
sudo tee /etc/sysctl.d/99-tailscale-forwarding.conf <<'EOF'
net.ipv4.ip_forward = 1
net.ipv6.conf.all.forwarding = 1
EOF
sudo sysctl -p /etc/sysctl.d/99-tailscale-forwarding.conf

# 2. Redeploy so the container picks up TS_ROUTES
cd /DATA/Infrastructure/homelab/services/tailscale
docker compose up -d
```

Then, in the [Tailscale admin console](https://login.tailscale.com/admin/machines):
find `homelab-server`, open its route settings, and **approve** the
`192.168.68.0/24` route — advertised routes are never auto-trusted, this is
a manual approval step every time a new route is advertised.

**Verify** from a tailnet-connected device on a *different* network (not
home WiFi): `ping 192.168.68.110` should succeed, and any AdGuard DNS
rewrite (e.g. `https://portainer.home:9443`) should now load identically to
being on the home network.

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
