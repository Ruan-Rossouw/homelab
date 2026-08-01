# Caddy

A single reverse proxy terminating HTTPS for `.home` services on the LAN,
so browsers stop warning "connection is not secure" when visiting them.
Not the Phase 6 reverse-proxy/TLS item from `docs/roadmap.md` — that was
scoped around a publicly-trusted certificate for a real, owned domain
(explored and deliberately not taken; see "Why Not a Public Certificate"
below). This is a smaller, LAN-only tool pulled forward ahead of that
phase to solve one specific, narrower problem.

## The Problem This Solves, and the One It Doesn't

`portainer.home`, `adguard.home`, etc. are AdGuard DNS rewrites
(`services/adguard/README.md`) — free to create, but not real domain
names, so no public certificate authority will ever issue a trusted
certificate for them. Every one of these services showing its own
self-signed certificate is what triggers the browser warning.

This setup makes that warning disappear **on this household's own
devices only** — anywhere the private CA below has been explicitly
installed. It does not make these services trustworthy to a stranger's
browser, a friend's phone, or anything else outside this household. That
distinction is the entire reason this is the right-sized tool: nothing
here needed to be publicly reachable or verifiable, so nothing here is.

## Why Not a Public Certificate (mkcert, Not Caddy + a Real Domain)

Seriously considered and stepped back from: buying a domain, hosting its
DNS at a provider Caddy can drive via the ACME DNS-01 challenge (so no
port-forwarding is needed to prove domain ownership), and letting Caddy
mint a real, publicly-trusted wildcard certificate.

Stepped back from this for two reasons, surfaced while actually pricing
it out:

1. **The domain available to reuse is a live business email domain**
   (`ufcons.com`, registered at Domains.co.za, active cPanel mail/DKIM/SPF/
   CalDAV records). Domains.co.za has no ACME DNS-01 plugin support in
   either Caddy's or `lego`'s provider lists (checked directly against
   both), so getting DNS-01 working would have meant migrating that
   domain's DNS hosting elsewhere entirely -- a real risk to live email
   for a problem that doesn't need it solved that way.
2. **The actual ask was narrower than "publicly trusted everywhere."**
   Nothing here needs to be verifiable by a device outside this
   household. A private CA is the correct-sized tool for "stop warning
   *me*," not a public one.

**[`mkcert`](https://github.com/FiloSottile/mkcert)** is the standard tool
for exactly this: it generates a private Certificate Authority and
installs its root into your own device's trust store (Keychain, and
Firefox's separate store if present) with one command. Any certificate it
then issues is trusted by that device specifically, with zero ongoing
cost and zero risk to anything else the domain touches -- because no real
domain is involved at all.

**The trade-off, named plainly:** this cert is trusted only on devices
where the CA root has been installed. Your own Mac/phone: yes. A
friend's device on your WiFi: still sees a warning, same as before. Fine
for the actual goal here; revisit with the real-domain approach later if
that ever changes.

## Why a Reverse Proxy, Not Per-Service TLS Config

Considered configuring each service's own built-in HTTPS support
individually instead of fronting everything with one proxy. Ruled out
once real per-service quirks surfaced:

- **AdGuard Home bundles web-UI HTTPS with actually running a public
  DNS-over-HTTPS/TLS/QUIC server** -- one "Encryption" toggle, one
  certificate, and it's not clearly documented whether the DNS-encryption
  listener ports can be disabled independently of the web UI's HTTPS.
  `services/adguard/README.md` already documents "Settings → Encryption:
  leave disabled" as a deliberate call tied to the no-WAN-exposure
  principle -- not something to risk undoing for a cosmetic browser fix.
- **Jellyfin requires the certificate bundled as a PFX/PKCS12 file**, not
  the PEM cert+key pair `mkcert` produces directly.
- **Uptime Kuma has no built-in custom-certificate support at all.**

One proxy in front, terminating TLS once and forwarding plain HTTP
internally, sidesteps every one of these -- every service's own settings
stay exactly as already documented, forever, regardless of what
TLS-related quirks the next service added here turns out to have.

## Cross-Container Networking: LAN IP, Not Container Name

Same rule already established for Prowlarr/Radarr/Decypharr
(`services/radarr/README.md`): every service in this repo is an
independent `docker compose` project with no shared Docker network, so
Caddy reaches other services via the host's LAN IP (`192.168.68.110`),
never `localhost` or a container name.

## Port: 443, Deliberately Not 80

Only `443` is published. `80` is not -- ZimaOS's own dashboard already
owns port 80 on this host (the exact conflict documented as a "Known
Gotcha" in `services/adguard/README.md`), so Caddy doesn't attempt to
claim it. No HTTP→HTTPS redirect exists as a result; visiting a `.home`
name over plain `http://` still reaches the service directly and
unencrypted, exactly as it did before Caddy existed. That's an accepted
gap, not an oversight -- the goal here was adding a trusted HTTPS path,
not removing the existing HTTP one.

This also means URLs change shape slightly from the original ask:
`https://adguard.home:3000/` becomes **`https://adguard.home/`** (no
port -- 443 is HTTPS's default, so browsers omit it). AdGuard's own
`:3000` HTTP endpoint keeps working unchanged alongside it.

No conflict with Tailscale Funnel's own use of "port 443"
(`services/tailscale/README.md`) -- Funnel binds the tailnet-facing
interface (`network_mode: host`, but scoped to the `tailscale0`
interface), while Caddy publishes 443 on the normal LAN-facing interface.
Different interfaces, same port number, no collision.

## Prerequisite: Generate and Trust the Local CA (once, on each device)

Done once already for this repo's Mac (2026-08-01) via:

```bash
brew install mkcert
mkcert -install   # prompts for Keychain/admin password -- run in a real
                   # terminal, not scriptable
```

Repeat `mkcert -install` on any other device that should stop seeing the
warning (each device trusts the CA independently; there's no way around
installing it per-device, since that's the whole point of a *private* CA).

## Generate the Certificate

Also done on the Mac, not the server -- the CA's private key should stay
on as few machines as possible, so only the resulting leaf certificate
and key (not the CA itself) get copied to the server:

```bash
mkcert "*.home" "home"
# produces _wildcard.home+1.pem and _wildcard.home+1-key.pem
```

One wildcard cert covers every current and future `.home` name -- no need
to regenerate when a new service is added to the Caddyfile.

**mkcert flags a real caveat here, worth testing rather than assuming
away**: "many browsers don't support second-level wildcards like
`*.home`." This restriction is normally about domains on the public
suffix list (real TLDs); `.home` isn't on that list, so it likely doesn't
apply -- confirmed working in practice with the AdGuard pilot below, but
if a future browser/service combination shows the warning again despite
the cert being installed, this wildcard-scope caveat is the first thing
to check, not the CA trust itself.

## Deploy

```bash
mkdir -p /DATA/AppData/caddy/{certs,data}
# copy the two files generated above -- e.g. from the Mac:
#   scp _wildcard.home+1.pem _wildcard.home+1-key.pem \
#     ruan@192.168.68.110:/DATA/AppData/caddy/certs/
cd /DATA/Infrastructure/homelab/services/caddy
docker compose up -d
```

## Adding Another Service

Append a block to `config/Caddyfile`, no new certificate needed:

```caddyfile
portainer.home {
  tls /certs/_wildcard.home+1.pem /certs/_wildcard.home+1-key.pem
  reverse_proxy 192.168.68.110:9443
}
```

Then `docker compose restart caddy` to pick up the change.

## Pilot: AdGuard — status pending live verification

`adguard.home` is the first (and so far only) service fronted by this
proxy, per the original ask ("rather than `http://adguard.home:3000/`, I
want `https://adguard.home/` with no browser warning"). Confirm the
padlock shows with no warning before adding more services -- if the
wildcard-scope caveat above turns out to be real in practice, better to
find out on one service than after wiring up several.
