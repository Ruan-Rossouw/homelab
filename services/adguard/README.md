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

Browse to `http://192.168.68.110:3000` for the setup wizard: choose the
listen interfaces/ports (defaults are fine — DNS on 53, web UI stays on
3000) and create the admin account. Unlike Portainer, there's no
setup-token/timeout mechanic here — the wizard just runs until you complete
it.

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
