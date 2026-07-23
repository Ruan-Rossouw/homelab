# Portainer

Web UI for managing Docker on the server. First service in Phase 2 — the
plan is that Portainer eventually gives visibility into every other service
deployed here, so it goes in before anything it would need to manage.

## What This Is

Portainer CE (Community Edition — free, sufficient for a single-host
homelab; the paid Business Edition adds multi-team/RBAC features this
project doesn't need). It talks to the Docker daemon over the mounted
`docker.sock`.

**Security note:** mounting `docker.sock` gives Portainer root-equivalent
control over the host — it can start a container with any bind mount,
including the root filesystem. This is inherent to what Portainer does, not
a misconfiguration, but it means the Portainer login is the single most
security-sensitive credential on this server. Use a strong password. Once
Tailscale is deployed (next in Phase 2), consider restricting access to the
Tailnet rather than leaving it reachable from the whole LAN — not done yet
since Tailscale doesn't exist at this point in the rollout.

## Deploy

```bash
mkdir -p /DATA/AppData/portainer
cd /DATA/Infrastructure/homelab/services/portainer
docker compose up -d
```

The `AppData` directory is created explicitly rather than left for Docker to
auto-create on first mount. Docker will silently create bind-mount paths as
`root:root` if they don't already exist, which is fine for Portainer (it
runs as root in-container anyway) but won't be fine for every future
service — see the open permissions question in
[`docs/storage.md`](../../docs/storage.md). Creating the directory
explicitly, every time, is the habit worth establishing now.

## First Run

Browse to `https://<server-ip>:9443` (self-signed certificate — the browser
warning is expected, this is LAN-only). **Portainer requires the initial
admin account to be created within a short timeout window after first
start** (historically around 5 minutes) — if you miss it, setup locks out
and the container needs a restart (`docker compose restart portainer`) to
get a fresh window.

## Configuration

No `.env` values are required for a default install; `PORTAINER_HTTPS_PORT`
is available if port 9443 is already in use for something else.
