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
artifact — a `.env`-shaped file with every value encrypted, replacing the
role the gitignored `.env` used to play as "the real values." Decrypting it
produces `services/<name>/.env`, gitignored, exactly as before —
`compose.yml` doesn't change at all, it still just reads `.env`.

`.env.example` is unchanged and still committed — it documents the shape
for anyone reading the repo without sops installed, same as always.

Only the age **public** key lives in the repo (`.sops.yaml`, one entry,
one key — a single maintainer on a single box doesn't need per-service or
per-environment key separation). The age **private** key must never be
committed; see Key Management below.

## How It Runs

```bash
# Decrypt one service's secrets into the .env docker compose reads:
make secrets-decrypt SERVICE=<name>

# Edit a service's encrypted secrets (opens $EDITOR, re-encrypts on save):
make secrets-edit SERVICE=<name>

# One-time migration: encrypt an existing plaintext .env:
make secrets-encrypt SERVICE=<name>
```

These wrap `sops` directly (see `Makefile`) rather than introducing a
separate script — sops is already the right level of abstraction, the
Makefile targets just save typing `--input-type dotenv --output-type
dotenv` every time and give the workflow a name.

Deploy flow gains exactly one step: `make secrets-decrypt SERVICE=<name>`
before `docker compose up -d`, for any service whose secrets changed since
the last deploy. Services with an already-current `.env` on disk need
nothing extra.

## Key Management

The age private key lives at `~/.config/sops/age/keys.txt` on whichever
machine needs to decrypt — the Mac (to author/edit committed ciphertext)
and the server (to decrypt at deploy time). This mirrors the restic
repository password's pattern exactly (`backup.md`): a secret that
*cannot* live in Git backing something that *does*, so it has to exist
outside the repo on every machine that needs it, plus one more copy in the
password manager as the actual backup — losing every copy of the age key
makes every `secrets.enc.env` file in this repo permanently unreadable,
the same failure mode `backup.md` describes for the restic password.

**Not yet done:** the private key exists only on this Mac right now (see
Status below). It still needs to be placed on the server and backed up to
the password manager before this becomes the real deploy mechanism rather
than a proven-but-unused pattern.

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
- `make secrets-decrypt SERVICE=prefetcharr` — the actual Makefile target,
  not just the raw `sops` command — produced `services/prefetcharr/.env`
  correctly, confirmed gitignored (`.env`) vs. committable
  (`secrets.enc.env`) status with `git status --ignored`.

## Status: Mechanism Proven, Rollout Not Started

What exists after this: tooling (`sops`, `age` installed on the Mac),
`.sops.yaml`, Makefile targets, and one pilot file
(`services/prefetcharr/secrets.enc.env`) with placeholder values proving
the round-trip.

**What's still open, deliberately not done in the same pass as the
mechanism itself:**

- Prefetcharr's `secrets.enc.env` needs its placeholder values replaced
  with the real `JELLYFIN_API_KEY` / `SONARR_API_KEY` (`make secrets-edit
  SERVICE=prefetcharr`), and the resulting `.env` verified against what's
  actually running before calling Prefetcharr migrated.
- The other ~19 services are still on plain gitignored `.env` — untouched
  by this pass. Converting them is mechanical (`make secrets-encrypt
  SERVICE=<name>` against each real `.env`) but real secret values only
  exist on the server, not this Mac, so each conversion needs to happen
  from wherever the real value can be read, then committed from the Mac
  per the normal git flow.
- `sops`/`age` aren't installed on the server yet, and the age private key
  isn't there either — both required before `make secrets-decrypt` can run
  as part of an actual deploy.
- No rotation cadence is written down yet (see Rotation above).
- Backing the private key up to the password manager, per Key Management
  above, hasn't happened yet.

Tracked as Phase 5's "secret management" item — not closed until the above
is done and verified, not just built.
