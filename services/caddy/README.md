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
installs its root into your own device's trust store (the OS Keychain,
plus Firefox-based browsers' own separate store -- *if* a prerequisite
package is already present, see "Firefox-Family Browsers" below, learned
the hard way) with one command. Any certificate it then issues is trusted
by that device specifically, with zero ongoing cost and zero risk to
anything else the domain touches -- because no real domain is involved at
all.

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
and key (not the CA itself) get copied to the server.

**First attempt used a wildcard (`mkcert "*.home" "home"`) and it does
not work in practice** -- not just the theoretical caveat mkcert prints
at generation time, but a confirmed real failure: `curl`, Safari, and
Zen all rejected `*.home` for `adguard.home` with `SSL: no alternative
certificate subject name matches target host name`. Many TLS stacks
(this one included) treat a wildcard directly under a single-label base
domain like `.home` the same as `*.com` -- structurally indistinguishable
from wildcarding an entire TLD, so it's rejected regardless of `.home`
not being on the real public suffix list. Confirmed via macOS Keychain's
own `security verify-cert` (chain trusted fine) versus `curl -v` against
the real hostname (hostname match failed) -- the CA trust was never the
problem, the wildcard's SAN was.

**What actually works: list every hostname explicitly**, one shared cert
covering all of them:

```bash
mkcert -cert-file home-services.pem -key-file home-services-key.pem \
  adguard.home
# add more names to the same command as more services get fronted, e.g.:
#   mkcert -cert-file home-services.pem -key-file home-services-key.pem \
#     adguard.home portainer.home grafana.home
```

Named `home-services.*` rather than after any one service, since the same
file is meant to be regenerated with a growing hostname list over time --
**there's no way to add a name to an existing cert, only regenerate it
with the full list** each time a service is added. More manual than the
wildcard idea would have been, but the wildcard idea didn't work.

## Deploy

```bash
mkdir -p /DATA/AppData/caddy/{certs,data}
# copy the two files generated above -- e.g. from the Mac:
#   scp home-services.pem home-services-key.pem \
#     ruan@192.168.68.110:/DATA/AppData/caddy/certs/
cd /DATA/Infrastructure/homelab/services/caddy
docker compose up -d
```

## Adding Another Service

Two steps, not one -- regenerate the shared cert with the new hostname
added to the list (see "Generate the Certificate" above), re-copy both
files to `/DATA/AppData/caddy/certs/` (overwriting the old ones), *then*
append a block to `config/Caddyfile`:

```caddyfile
portainer.home {
  tls /certs/home-services.pem /certs/home-services-key.pem
  reverse_proxy 192.168.68.110:9443
}
```

Then `docker compose restart caddy` to pick up both changes.

## Firefox-Family Browsers (Zen, Firefox itself): a Separate Trust Store

Confirmed the hard way: Firefox and Firefox-based browsers (Zen here)
**do not use the OS Keychain** -- they keep their own certificate store
per-profile, and `mkcert -install` only reaches it if the `nss` package
(`certutil`) was already installed at the time. If not, `mkcert -install`
silently succeeds for Keychain-based browsers (Safari, Chrome) and skips
Firefox-based ones with no error -- worth knowing before assuming a
"trusted" CA covers every browser on a device.

Fix, per Firefox-based browser:

```bash
brew install nss
```

Then find that browser's actual active profile directory -- check
`profiles.ini` inside its Application Support folder for a `Locked=1`
`Install...` section, which names the real default profile (a plain
`Default=1` flag elsewhere in the same file can be stale/misleading) --
and add the CA to it directly:

```bash
CAROOT=$(mkcert -CAROOT)
certutil -A -n "mkcert local CA" -t "C,," -i "$CAROOT/rootCA.pem" \
  -d "sql:/path/to/that/profile"
```

Requires a full quit and reopen of the browser to take effect, not just
closing the window.

## Pilot: AdGuard — confirmed working (2026-08-01)

`adguard.home` was the first service fronted by this proxy, per the
original ask ("rather than `http://adguard.home:3000/`, I want
`https://adguard.home/` with no browser warning"). Took two real fixes
beyond the initial deploy to get there -- the wildcard-cert failure and
the Firefox/Zen separate-trust-store gap, both above -- confirmed clean
in both Safari and Zen after both were resolved. Deliberately kept to one
service until both of those were understood, rather than batching several
in front of an unproven mechanism.

## Full Rollout — All Existing `.home` Names (2026-08-01)

Once the pilot confirmed clean, extended to every hostname already
present in AdGuard's DNS rewrites at the time (`server.home`,
`portainer.home`, `uptime.home`, `adguard.home`, `grafana.home`,
`backrest.home`, `jellyfin.home`, `decypharr.home`, `prowlarr.home`,
`radarr.home`, `sonarr.home`, `seerr.home`, `home-assistant.home`) — see
`config/Caddyfile` for the full list, ports cross-checked against each
service's own README rather than assumed. One exception worth naming:
`server.home` isn't a service tracked in this repo at all -- it's
ZimaOS's own dashboard, inferred to be port 80 from the existing "Known
Gotcha" note in `services/adguard/README.md`, not independently
confirmed the way every other entry here was.

**Jellyfin already has its own remote-access story via Tailscale Funnel**
(`services/tailscale/README.md`) -- `jellyfin.home` here is a separate,
purely local convenience (no browser warning on the home LAN) and doesn't
change or replace that; the two solve different problems (local cosmetic
fix vs. actual remote access for friends) and don't conflict.

Not yet fronted, deliberately: FlareSolverr, cAdvisor, Prometheus,
node-exporter -- none of these have an AdGuard `.home` rewrite today,
being admin/API-only surfaces nobody browses to directly. Add them the
same way (regenerate the cert with the new name, add a Caddyfile block)
if that ever changes.
