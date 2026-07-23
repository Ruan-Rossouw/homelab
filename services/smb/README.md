# SMB (Samba)

Native ZimaOS Samba, not a container — this is the one deliberate exception
to "everything through Docker Compose." See the "Documented Exception: SMB
Uses ZimaOS's Native Samba" section in
[`docs/architecture.md`](../../docs/architecture.md) for the full reasoning,
and note the caveat there: this is scoped to staying on ZimaOS, not a
general preference for native tooling over containers.

There is no `compose.yml`, `.env.example`, or `config/` here — deliberately.
This README *is* the deployment mechanism: a manual runbook, not something
`git pull` + `docker compose up` can restore on its own.

## What's Shared

**`/DATA/Media` only.** Nothing else under `/DATA` is exposed:

- `/DATA/AppData` — live service state (Portainer/AdGuard/etc.); concurrent
  external writes over a network share could corrupt it.
- `/DATA/Infrastructure` — the Git repo and developer environment,
  including SSH keys (`Infrastructure/developer/ssh`). This must never be
  network-shared.
- `/DATA/Backup` — not yet a concern; `backup.md` is still deferred per
  `docs/roadmap.md`.

## Permissions

Single authenticated SMB user, read-write, on the `Media` share only. No
guest/anonymous access.

## Setup Steps (Manual)

This is a best-effort runbook written before actually walking through
ZimaOS's Files app UI — the exact menu labels below need confirming against
reality and correcting once done, same as every other gotcha we've
documented in this repo.

1. Open the ZimaOS dashboard (`http://192.168.68.110`) → Files app.
2. Locate `/DATA/Media`.
3. Enable the Samba/network-share toggle for that folder specifically —
   not for `/DATA` as a whole.
4. Create a dedicated SMB user (a separate credential from your ZimaOS
   login, not the same account) with read-write permission on this share.
5. Confirm no guest/anonymous access is enabled anywhere in the Samba
   settings.

## Connecting From a Device

- **Mac Finder:** `Go → Connect to Server → smb://192.168.68.110/Media`
  (share name may differ slightly — whatever ZimaOS assigns), then
  authenticate with the SMB user from step 4.
- **Windows Explorer:** `\\192.168.68.110\Media`

## Recovery, If the Server Is Rebuilt

Reinstall ZimaOS, redo steps 1–5 above exactly, recreate the SMB user with
the same username. This file is the source of truth for those steps —
update it immediately if the actual configuration ever diverges from what's
written here, since there's no `compose.yml` to fall back on as ground
truth.
