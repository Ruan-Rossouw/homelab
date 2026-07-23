# AdGuard Home

Network-wide DNS filtering and local DNS resolution. Third service in
Phase 2 — deployed, but not yet doing anything for the network until the
Deco is told to hand it out as the DNS server (see "Making It Actually
Used" below).

## What This Is, Mechanically

AdGuard Home is a DNS server. Every device on the network resolves domain
names (`example.com` → an IP address) by asking *some* DNS server; normally
that's the ISP's or a public one (`1.1.1.1`, `8.8.8.8`). Once devices are
pointed at AdGuard instead, every query passes through it first: known
ad/tracker domains get blocked (returned as `0.0.0.0`/NXDOMAIN) via
subscribed blocklists, everything else gets forwarded on to an upstream
resolver and returned normally. It also lets you define custom local DNS
records — e.g. `portainer.home` → `192.168.68.110` — as a friendlier
alternative to remembering IPs and ports.

**Deliberately out of scope:** AdGuard Home also has a built-in DHCP server.
We are not using it — the Deco already handles DHCP for the network, and
running two DHCP servers on one network causes real, hard-to-diagnose
conflicts (two authorities handing out potentially different leases).
AdGuard here does exactly one job: DNS.

## Before You Deploy: Check Port 53

```bash
sudo ss -tulpn | grep ':53 '
```

If anything is already listening on port 53 (commonly `systemd-resolved`'s
stub listener), AdGuard's container will fail to bind it. Deal with
whatever's found before proceeding — this isn't something to work around in
the compose file, since the compose file already does the right thing
(explicit port publish, same as any other service here).

## Deploy

```bash
mkdir -p /DATA/AppData/adguard/work /DATA/AppData/adguard/conf
cd /DATA/Infrastructure/homelab/services/adguard
docker compose up -d
```

## First Run

Browse to `http://192.168.68.110:3000` for the setup wizard. DNS on port 53
defaults correctly — **but on the admin web interface step, explicitly set
the port to `3000`, don't accept whatever the wizard suggests.** It has been
observed suggesting port `80` here, which `compose.yml` doesn't publish to
the host at all; accepting it silently moves AdGuard's UI somewhere
unreachable. See "Known Gotcha" below if this has already happened to you.
Unlike Portainer, there's no setup-token/timeout mechanic here — the wizard
just runs until you complete it.

## Known Gotcha: Wizard Defaults the Admin Port to 80

**Symptom:** setup wizard completes, then you land on ZimaOS's own
dashboard (`http://192.168.68.110/#/`) instead of AdGuard, and
`http://192.168.68.110:3000` gives "unable to connect."

**Cause:** the wizard reconfigured AdGuard's admin interface to listen on
port 80 inside the container (confirm via `docker logs adguard`, look for
`starting plain server server=plain addr=0.0.0.0:80`). Port 80 was never
published to the host, so nothing answers on `:3000` anymore, and port 80
on the host resolves to ZimaOS's own service instead, not AdGuard.

**Fix:**

```bash
docker compose stop adguard
sudo sed -i 's/address: 0.0.0.0:80/address: 0.0.0.0:3000/' \
  /DATA/AppData/adguard/conf/AdGuardHome.yaml
docker compose up -d adguard
```

Confirm with `docker logs adguard --tail 5` — it should show
`addr=0.0.0.0:3000` — then `http://192.168.68.110:3000` loads normally.

## Recommended Configuration (Post-Setup)

Changes worth making from AdGuard's defaults, in Settings:

- **DNS Settings → Upstream DNS servers:** switch from plain DNS to an
  encrypted upstream, e.g. `https://dns.cloudflare.com/dns-query` (DoH) or
  `tls://1.1.1.1` (DoT). By default, AdGuard forwards unresolved queries as
  plain DNS, meaning the ISP can see every domain every device visits at
  the DNS level. This closes that specific leak — it doesn't hide traffic
  in general (TLS SNI still reveals the domain over the connection itself),
  but it's a real, free improvement, consistent with preferring HTTPS/
  Tailscale over cleartext elsewhere in this repo.
- **DNS Settings → Enable DNSSEC.** Validates DNS responses haven't been
  tampered with in transit. Low-cost, rarely breaks anything.
- **Filters → DNS blocklists:** keep the default AdGuard filter, optionally
  add one well-curated list like **OISD** rather than stacking several
  overlapping ones. Every blocklist is checked on every query from every
  device on an 8 GB RAM box that's about to host more services — one good
  list plus the default is the right amount for a home network.
- **Settings → Encryption: leave disabled.** This exposes AdGuard as a
  public DoH/DoT server — i.e. accepting encrypted DNS queries from
  *outside* the network. Enabling it would reopen exactly the WAN exposure
  `docs/networking.md` commits against. Not needed: devices reach AdGuard
  over the LAN or Tailscale, never the open internet.

Left at default deliberately: query log / statistics retention (useful for
troubleshooting later, DNS logs are tiny) and per-client settings (no need
for per-device rules yet — YAGNI until there's an actual reason).

## Making It Actually Used

Deploying AdGuard doesn't change anything on its own — devices only use it
once they're told to. In the Deco app: change the network's DNS server
(usually under advanced/DHCP settings) to `192.168.68.110`. Every device
that renews its DHCP lease afterward starts using AdGuard automatically; no
per-device configuration needed.

**Set a secondary DNS server too** (a public resolver like `1.1.1.1`) if
the Deco's settings allow it. AdGuard is about to become a single point of
failure for DNS resolution on the entire network — if the container is
down and there's no fallback configured, nothing in the house resolves
domain names, which is a much bigger blast radius than one service being
briefly unreachable. A secondary resolver doesn't fully eliminate that risk
(not every device honors a fallback DNS promptly), but it's a cheap partial
mitigation worth taking.
