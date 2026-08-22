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

## Container User: Root, and Why It's Only `NET_ADMIN`, Not `--privileged`

Runs root, the official image's current default. Tailscale's own project
has stated the direction they want to go — running `tailscaled` as a
dedicated non-root system user with specific capabilities granted via
netlink — but that's not what ships today, so this is documented as
current state, not a permanent decision.

What *is* already deliberate here: `cap_add: NET_ADMIN` plus the
`/dev/net/tun` device, not `--privileged`. `NET_ADMIN` is upstream's own
recommended minimum for TUN-based operation (creating and configuring the
tunnel interface, setting up routes) — granting the whole host's
capability set via `--privileged` would be strictly broader than this
container ever needs, the same least-privilege reasoning already applied
to Home Assistant's declined `--privileged` default and Decypharr's
narrower `SYS_ADMIN` grant (`services/home-assistant/README.md`,
`services/decypharr/README.md`).

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
is ever compromised — mitigated (2026-07-26) by scoping the Tailscale ACL
policy (admin console → Access Controls) so only trusted devices can
actually use the route. See `docs/networking.md`'s "Server Reachability"
section for how this fits the overall network posture.

### ACL Policy (scoped 2026-07-26)

The policy lives only in the [Tailscale admin
console](https://login.tailscale.com/admin/acls) — there's no API/CLI access
set up for this tailnet, so it isn't mirrored into this repo the way other
service config is. Current shape, for reference:

- **`tag:trusted-lan`** applied to the phone and Mac only — the two devices
  that actually need home-LAN access. Tagging a device removes it from
  `autogroup:member`/`autogroup:self` matching (a Tailscale ACL quirk worth
  remembering), so plain "allow all members" rules stop covering it once
  tagged.
- **Grants**, replacing the original default-allow-all:
  - `autogroup:member → autogroup:member` — baseline tailnet mesh
    connectivity (e.g. SSH to the server) for any untagged member.
  - `tag:trusted-lan → 192.168.68.0/24` — only tagged devices may route
    into the home LAN via the approved subnet route.
  - `tag:trusted-lan → autogroup:member` — restores general tailnet
    reachability from the tagged devices to other members (e.g. the Apple
    TV), which tagging had incidentally cut off; this is separate from,
    and unrelated to, the LAN-subnet grant above.
- The `ssh` block (Tailscale SSH, `autogroup:self`-based) was left as-is —
  untagged devices only. Not yet an issue since neither tagged device
  relies on Tailscale SSH today.

**Parked follow-up:** the server itself (`homelab-server`) is still
untagged, i.e. still in the personal-identity bucket alongside the phone
and Mac rather than tagged as infrastructure (e.g. `tag:server`). Tagging
it would be the more correct long-term pattern — mainly to make it eligible
for disabling Tailscale key expiry without touching personal-device
semantics — an expired key on a headless server would need an interactive
browser reauth, the same "only remote path in is down" scenario as
stopping the container while away from home. Deliberately not done yet: tagging the
server would also require rewriting the `ssh` block (tagged devices drop
out of `autogroup:self`, the same issue hit with the phone/Mac above), so
it needs its own deliberate pass rather than folding into this change.

## Funnel: Scoped Public Access for Jellyfin (added 2026-08-01)

**Decision: use Tailscale Funnel to share Jellyfin with a handful of friends
outside the household**, rather than inviting them into the tailnet as
members. Chosen after comparing against Cloudflare Tunnel, a self-hosted
tunnel (Pangolin), a hardened reverse-proxy + router port-forward, and
Tailscale's own single-device sharing — Funnel won on ease of use (reuses
this already-running container, two CLI commands, no new infrastructure)
and cost (free on the Personal plan). Full comparison not reproduced here;
the point is this was a deliberate choice among several real options, not
the only one considered.

**Why not just invite friends to the tailnet:** the baseline ACL grant
above (`autogroup:member → autogroup:member`) means any tailnet member can
reach any other member device — fine for personal devices you trust, wrong
model for "one friend, one app." Funnel exposes exactly one port publicly
instead, with no client install required on the friend's end.

**Trade-offs accepted, not hidden:**

- Tailscale does not publish a bandwidth number for Funnel traffic (only
  "non-configurable limits" per their own docs) — there's no way to confirm
  in advance it holds up for multiple concurrent Jellyfin streams. Being
  validated empirically, not assumed safe; if playback degrades under real
  friend usage, that's the signal to fall back to a different option.
- Once Funnel is on, **Jellyfin's own login is the sole auth gate** — no
  network-layer backstop the way the tailnet normally provides. Friend
  accounts need real, unique passwords before this goes live.
- `tailscale funnel off` has a documented failure mode where it doesn't
  fully disable exposure ([tailscale/tailscale#15248](https://github.com/tailscale/tailscale/issues/15248)) —
  treat stopping the container as the actual kill switch if something looks
  wrong, don't trust the CLI toggle alone.

### ACL Grant Required (console-only, same as the ACL Policy above)

Funnel requires an explicit `nodeAttrs` grant in the same
[admin console policy file](https://login.tailscale.com/admin/acls):

```json
"nodeAttrs": [
  {
    "target": ["<tailnet-owner-email>"],
    "attr":   ["funnel"],
  },
],
```

(`<tailnet-owner-email>` — the account's own login, same as `alice@example.com`
in Tailscale's own docs. Not reproduced here since, like the rest of this
policy, it lives only in the admin console and isn't mirrored into this
repo — see the note at the top of the ACL Policy section above.)

`nodeAttrs` targets only accept a tag, a specific user, a group, or `*` —
no autogroups (`autogroup:self` is invalid here, unlike in `grants`/`ssh`
rules). Naming the owner's own identity scopes this to the devices that sit
under it, which today includes `homelab-server` since it's still untagged
— see the parked `tag:server` follow-up above. Same caveat applies here:
this technically also grants Funnel capability to the phone and Mac under
the same identity, not just the server. Accepted for now for the same
reason tagging the server was parked — revisit together if the server is
ever tagged as infrastructure.

### Rollout — Staged, Not Straight to Public

**Stage 1: `serve` only (tailnet-private), verify, then Stage 2: `funnel`
(public).** Don't skip straight to public — confirming the tailnet-only
path works first isolates "is Jellyfin reachable at all" from "is it
reachable from the public internet," so a failure in Stage 2 is unambiguous.

```bash
# Stage 1 — serve Jellyfin over HTTPS to the tailnet only, backgrounded
docker exec tailscale tailscale serve --bg --https=443 localhost:8096

# Verify from a tailnet device off the home network (e.g. phone on cellular):
# https://homelab-server.<your-tailnet-name>.ts.net should load Jellyfin's
# login page. Confirm this works before Stage 2.

# Stage 2 — make it public
docker exec tailscale tailscale funnel --bg --https=443 localhost:8096

# Verify from a device NOT on the tailnet (e.g. a friend, or your own phone
# with Tailscale temporarily off) that the same URL loads.
```

**Confirmed working end-to-end 2026-08-01.** Note the `funnel` syntax above
— `tailscale funnel 443 on` (an older pre-1.52 toggle form that shows up in
some docs/blog posts) errors on current Tailscale with "the CLI for serve
and funnel has changed." Current syntax mirrors `serve`'s target-based form
instead: `tailscale funnel --bg --https=443 localhost:8096`.

Check status any time with `docker exec tailscale tailscale funnel status`.
To fully back out: `docker exec tailscale tailscale funnel --https=443 localhost:8096 off`
followed by `docker exec tailscale tailscale serve reset` — and if either
doesn't visibly take effect, stop the container (`docker compose stop
tailscale` in this directory) rather than trusting the toggle, per the
caveat above.

No compose/`.env` changes are needed for this — Funnel/Serve config is
runtime `tailscaled` state, already persisted in the existing
`/DATA/AppData/tailscale` volume mount.

**Not yet done:** friend account passwords in Jellyfin haven't been audited
for this yet, and real-world bandwidth under concurrent streams is
untested. Both are pre-requisites before actually handing the URL to
friends, not optional follow-ups.

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
