# Secrets

This document answers: **how are secrets stored, and how do they get from
Git onto a running container?** For the general `.env` / `.env.example`
split every service follows, see [`conventions.md`](conventions.md). For
where the age private key lives outside Git, see below — same reasoning
[`backup.md`](backup.md) uses for the restic repository password.

## Problem This Replaces

Every service already used a gitignored `.env` (real values) interpolated
into `compose.yml`, with a committed `.env.example` (placeholder values)
documenting its shape. That part isn't changing. What it lacked: the real
`.env` files were unencrypted at rest on both the Mac and the server, had no
rotation discipline, and there was no single place to see what secrets
exist across ~20 services without SSHing into the server and reading each
one by hand.

## Tool: sops + age

Both are single static binaries — no daemon, no background process, no
persistent RAM footprint beyond the instant a command runs. That mattered
more than usual here: this box has already turned away Wazuh and Immich on
resource grounds, so any secrets mechanism that adds a standing service was
a non-starter before it even solved the actual problem.

**age** generates a keypair — a public key safe to put in Git, a private
key that decrypts. **sops** encrypts the *values* in a `.env`-shaped file
while leaving the *keys* readable, calling out to age to handle the actual
encryption. The result: `git diff` on a secrets file shows *which* variable
changed (`SONARR_API_KEY=ENC[...]` vs `SONARR_API_KEY=ENC[...]`, different
ciphertext) without ever showing the value — so the file is safe to commit
and its history is a real audit trail, not just "trust me, I rotated it."

**Alternatives considered and rejected:**

- **Password-manager-backed CLI injection** (1Password/Bitwarden secrets,
  self-hosted Vaultwarden included) — rejected because every service here
  runs `restart: unless-stopped` and the server is specifically hardened
  (BIOS AC Recovery) to come back unattended after a power loss. CLI
  injection means secrets are fetched from a live vault at container-start
  time, which means the vault has to be up, unlocked, and reachable
  *before* anything else can start — a new dependency in every service's
  boot path that didn't exist before. Vaultwarden specifically also doesn't
  support Bitwarden's machine-account/API-key flow (that's gated to
  Bitwarden's own licensed cloud product), so unattended unlock would mean
  a human credential sitting accessible on disk anyway — the same
  at-rest-exposure problem this document exists to fix, just moved up a
  layer. (Self-hosting Vaultwarden as an actual personal password manager
  is still a reasonable project — just a separate one from this.)
- **Formalize the plaintext `.env` pattern** (documented rotation +
  audit checklist, no new tooling) — rejected as the primary mechanism
  because it does nothing for "unencrypted at rest," which was the
  original complaint. Its rotation-discipline half is still necessary
  *alongside* sops (see Rotation below) — sops fixes the storage problem,
  not the "did anyone actually rotate this" problem.

## What's Encrypted, and What Isn't

Per service: `services/<name>/secrets.enc.env` is the new committed
artifact, replacing the role the gitignored `.env` used to play as "the
real values." Decrypting it produces `services/<name>/.env`, gitignored,
exactly as before — `compose.yml` doesn't change at all, it still just
reads `.env`. This split is forced by how Docker Compose works, not a
design preference: Compose does no decryption of its own, so whatever
file it reads at `up` time has to already hold literal plaintext values —
there's no way for one file to be both safely encrypted and directly
usable by Compose. The only choice is whether the plaintext form is
committed (defeats the point) or generated on demand and gitignored
(what this is).

**Not every value in that file is encrypted.** `.sops.yaml`'s
`encrypted_regex` (`_KEY$|_SECRET$|_TOKEN$|_PASSWORD$`) only encrypts
keys matching that pattern — so `JELLYFIN_API_KEY` becomes `ENC[...]` but
`TZ` and `JELLYFIN_URL` stay plaintext in the same committed file.
Deliberate, not an oversight: encrypting a timezone or a known LAN IP adds
no security value, and it means a non-secret config change (e.g. the LAN
IP changing) still shows up as a readable `git diff` instead of an opaque
ciphertext blob every time.

`.env.example` stays committed alongside `secrets.enc.env`, not made
redundant by it — they answer different questions. sops keeps *key names*
readable even inside the ciphertext, so `secrets.enc.env` already tells
you what keys exist without decrypting anything; what it can't give you
is a *usable* default without the age key, since (per above) even the
non-secret defaults are only genuinely useful once combined with whatever
secret fields are still encrypted. `.env.example` remains the zero-tooling,
no-key-required copy of the shape and non-secret defaults — matching this
repo's "recoverable from Git alone" identity (`roadmap.md`) for the parts
that don't actually need protecting. It's also, as of this pass, still
the *only* committed config documentation for the ~19 services not yet
migrated (see Status).

Only the age **public** key lives in the repo (`.sops.yaml`, one entry,
one key — a single maintainer on a single box doesn't need per-service or
per-environment key separation). The age **private** key must never be
committed; see Key Management below.

## How It Runs

```bash
# Decrypt one service's secrets into the .env docker compose reads:
scripts/secrets-decrypt.sh <name>

# Edit a service's encrypted secrets (opens $EDITOR, re-encrypts on save):
scripts/secrets-edit.sh <name>

# One-time migration: encrypt an existing plaintext .env:
scripts/secrets-encrypt.sh <name>
```

`scripts/secrets-*.sh` are the actual portable entry point — plain `sh`,
no dependencies beyond `sops` itself, so they work identically on the Mac
and the server. `make secrets-decrypt SERVICE=<name>` (and the `-edit`/
`-encrypt` equivalents) are a thinner, nicer-to-type wrapper around the
same scripts, but **Mac-only**: `make` isn't present on the ZimaOS server
at all (confirmed 2026-08-18 — no package manager, nothing outside the
base image, same reasoning as the read-only-root constraints below). Use
the scripts directly wherever `make` isn't available.

Both forms need `SOPS_AGE_KEY_FILE` set in the environment first — the
Makefile exports a Mac-appropriate default; calling the scripts directly
does not, since the right path differs by machine (see Key Management).

Deploy flow gains exactly one step: `scripts/secrets-decrypt.sh <name>`
before `docker compose up -d`, for any service whose secrets changed since
the last deploy. Services with an already-current `.env` on disk need
nothing extra. Run `docker compose up -d` from inside `services/<name>/`
as the README for each service already says — Compose's automatic `.env`
loading is relative to where it's invoked, not to the compose file's own
location, so running it from elsewhere (e.g. `docker compose -f
services/<name>/compose.yml up -d` from the repo root) can silently miss
the freshly-decrypted `.env` and leave an old container running against
stale config (this actually happened during Prefetcharr's migration —
see Status).

`sops` itself has no native install on the server either — same
"read-only root, no package manager" constraint as everything else on
ZimaOS (`zimaos.md`), so it runs via `docker run` there, wrapped in a
small shim script on `PATH` rather than a long command typed out each
time. See Status below for exactly what's in place.

## Key Management

The age private key needs to exist on whichever machine decrypts — the Mac
(to author/edit committed ciphertext) and the server (to decrypt at deploy
time) — but not at the same path on both, because ZimaOS's `HOME=/DATA`
isn't writable by non-root users (`zimaos.md`):

- **Mac:** `~/.config/sops/age/keys.txt` (sops's default lookup location).
- **Server:** `/DATA/Infrastructure/developer/config/sops/age/keys.txt` —
  alongside the rest of the redirected developer tooling config
  (`GIT_CONFIG_GLOBAL`, `DOCKER_CONFIG`), not under `$HOME`.

This mirrors the restic repository password's pattern exactly
(`backup.md`): a secret that *cannot* live in Git backing something that
*does*, so it has to exist outside the repo on every machine that needs
it, plus one more copy in the password manager as the actual backup —
losing every copy of the age key makes every `secrets.enc.env` file in
this repo permanently unreadable, the same failure mode `backup.md`
describes for the restic password.

**Not yet done:** backing the key up to the password manager (see Status
below).

## Rotation

sops makes rotation *auditable* (git log shows when a value last changed)
but doesn't automate or enforce it — that part is still a documented
discipline, same as it would be under any tool. No fixed cadence is set
yet; this needs a real policy (likely: annually, or immediately on
suspected exposure) before this section can claim more than "the mechanism
supports it."

## Verified Working (2026-08-15, mechanism proof)

Proven end-to-end against `services/prefetcharr/secrets.enc.env`
(Prefetcharr chosen as the pilot: simplest service, only two real secrets,
freshly documented) using placeholder values, not real API keys — real
secrets don't exist on this Mac at all (see Status below), so this proves
the *mechanism*, not a completed migration:

- `sops --encrypt --input-type dotenv --output-type dotenv -i
  services/prefetcharr/secrets.enc.env` — produced a `.env`-shaped file
  with every value as `ENC[AES256_GCM,...]` ciphertext, key names still
  readable.
- `sops --decrypt ...` piped back to plaintext and diffed byte-for-byte
  against the original — identical.
- `make secrets-decrypt SERVICE=prefetcharr` **and**
  `scripts/secrets-decrypt.sh prefetcharr` directly — both produced
  `services/prefetcharr/.env` correctly, confirmed gitignored (`.env`) vs.
  committable (`secrets.enc.env`) status with `git status --ignored`.

## Verified Working (2026-08-18, server-side)

Proven against the real server (ZimaOS, physical console — no SSH access
from the Mac, see `reference` notes), not assumed to carry over from the
Mac-only proof above. Two real bugs surfaced and were fixed in the
process, not glossed over:

- **`make: command not found`.** ZimaOS's base image doesn't ship `make`
  at all — the original Makefile-only design would have silently only
  ever worked on the Mac. Fixed by moving the actual logic into
  `scripts/secrets-*.sh` (plain `sh`, no dependency beyond `sops`), with
  the Makefile now a thin Mac-only wrapper around the same scripts.
- **`cannot operate on non-existent file`**, even though the file
  genuinely existed on disk at the exact path in the error. Root cause:
  the scripts resolved an *absolute host path*
  (`/DATA/Infrastructure/homelab/services/...`) and handed it to `sops` —
  but on the server, `sops` runs inside a Docker container (see below)
  with only `$PWD` bind-mounted, as `/work`. An absolute host path simply
  doesn't exist from inside that container's filesystem namespace, even
  though the same file is real on the host. Reproduced directly against
  `ghcr.io/getsops/sops:v3.13.2` on the Mac (Docker Desktop, not just
  reasoned about) to confirm the exact failure, then confirmed the fix —
  `cd` to the repo root first, use paths relative to it — resolves it
  through the same wrapper. Native `sops` on the Mac was unaffected
  either way, which is why this wasn't caught before the real server
  test.
- **Final result:** `scripts/secrets-decrypt.sh prefetcharr` on the
  server produced a `.env` byte-for-byte identical to the Mac's decrypt
  output — full round trip (encrypt on Mac → commit → `git pull` on
  server → decrypt via the Docker-wrapped `sops`) confirmed working
  end-to-end, still with placeholder values (see Status).

**Server-side `sops` mechanism**, for reference: no native install
(ZimaOS's read-only root, no package manager — `zimaos.md`), so `sops`
runs via `docker run --rm --entrypoint sops -v "$PWD":/work -v
<key>:/key.txt:ro -e SOPS_AGE_KEY_FILE=/key.txt -w /work
ghcr.io/getsops/sops:v3.13.2`, wrapped in a shim script at
`/DATA/Infrastructure/developer/bin/sops` so it's invoked exactly like a
native binary from every script and `PATH` lookup.

## Verified Working (2026-08-18, narrowed encryption scope)

Reworked to only encrypt actual secrets (see "What's Encrypted, and What
Isn't") rather than every value in the file, prompted by a direct
question about whether `.env.example` was still pulling its weight next
to `secrets.enc.env` — it surfaced that the original whole-file approach
was encrypting non-secret values (`TZ`, LAN URLs) for no security benefit.

Re-encrypted Prefetcharr's real `secrets.enc.env` under the new
`encrypted_regex` rule without exposing the real values in the process
(decrypted to a private scratch file, re-encrypted in place, diffed
against the pre-change plaintext to confirm an exact match, scratch file
removed) — confirmed: `JELLYFIN_API_KEY`/`SONARR_API_KEY` are `ENC[...]`,
`TZ`/`JELLYFIN_URL`/`SONARR_URL` are plaintext in the same file, and the
full `scripts/secrets-decrypt.sh` pipeline still produces a correct `.env`
against the new format. Not yet re-verified against the server's Docker-
wrapped `sops` specifically, since decryption is format-agnostic there —
covered by the Mac-side proof above, not a separate mechanism.

## Status: Prefetcharr Fully Migrated, ~19 Services Remaining

What exists, confirmed working on **both** machines (not assumed to carry
over from one to the other): tooling (`sops`, `age` installed natively on
the Mac via `brew`; `sops` on the server via the Docker-wrapped shim
above), `.sops.yaml`, `scripts/secrets-*.sh` (the portable interface) plus
`make secrets-*` (Mac-only convenience wrapper around the same scripts).

**Prefetcharr (2026-08-18): fully migrated, not just mechanism-proven.**
`secrets.enc.env` holds its real `JELLYFIN_API_KEY`/`SONARR_API_KEY`.
Confirmed by actually redeploying against them — `docker compose up -d
--force-recreate`, run from `services/prefetcharr/` (not `-f` from the
repo root; Compose's `.env` auto-loading is directory-relative, and
invoking from elsewhere silently left the old container running against
stale config the first time this was tried) — produced a genuinely fresh
container with a clean startup log and no connection error, the failure
mode a wrong key/URL would actually produce. See
`services/prefetcharr/README.md`'s Status section.

**What's still open:**

- The other ~19 services are still on plain gitignored `.env` — untouched
  by this pass. Converting them is mechanical
  (`scripts/secrets-encrypt.sh <name>` against each real `.env`) but real
  secret values only exist on the server, not this Mac, so each
  conversion needs to happen from wherever the real value can be read,
  then committed from the Mac per the normal git flow. Doing this as
  smaller follow-up batches rather than one large sweep, given what
  Prefetcharr's migration alone surfaced (a stale `.env`, a `make`
  gap, an absolute-path bug, a directory-relative Compose gotcha) —
  each one is a real thing to get wrong per service, not a purely
  mechanical copy-paste.
- No rotation cadence is written down yet (see Rotation above).
- Backing the private key up to the password manager, per Key Management
  above, hasn't happened yet.

Tracked as Phase 5's "secret management" item — not closed until the above
is done and verified, not just built.
