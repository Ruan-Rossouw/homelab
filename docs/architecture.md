# Architecture

This document answers: **why is the system shaped this way?** For *what* is
being built and *when*, see [`roadmap.md`](roadmap.md). For the rules
everything follows, see [`conventions.md`](conventions.md). For ZimaOS-specific
detail, see [`zimaos.md`](zimaos.md).

## Core Principle: The Repository Is the Product

The operating system is a deployment target, not the system of record. If the
server were lost tomorrow, the goal is to recreate everything from Git and
documentation alone — a fresh ZimaOS install plus a `git clone` should get
back to a known state.

This inverts the instinct a lot of self-hosters start with, which is to
configure the box directly (SSH in, `docker run` something, tweak a file by
hand) and treat that running state as the source of truth. That approach
works right up until the disk fails or a setting is forgotten, at which point
the "documentation" is whatever you can remember. Treating the repo as the
source of truth means the server is disposable: it holds *state* (running
containers, media, databases) but not *definition* (how those containers are
configured, why they're networked the way they are).

## Deployment Flow

```text
Mac / VS Code → git commit → GitHub → git pull (server) → docker compose up
```

Development happens on the primary machine, not on the server. The server is
almost never used as a text editor except for genuine emergency fixes — and
any emergency fix gets backported into a commit afterward rather than left as
undocumented drift. This is the same discipline as "no console changes in
prod": if a change didn't go through Git, it doesn't officially exist, and the
next `git pull` risks silently overwriting it.

## Docker Philosophy

No ZimaOS App Store. Every service is a standalone Docker Compose project
(see the Compose Conventions in `conventions.md`) rather than a vendor-managed
install. Three reasons:

1. **Portability.** A `compose.yml` runs the same on this Dell Inspiron as it
   would on a Raspberry Pi, a cloud VM, or a future replacement box. A
   ZimaOS App Store install does not — it's tied to ZimaOS's own management
   layer.
2. **Inspectability.** Compose files are plain text in Git; an App Store
   install's configuration lives in ZimaOS's own database, invisible to
   version control.
3. **Minimal vendor lock-in.** ZimaOS is treated as a Linux host that happens
   to run Docker, not as a platform to build on top of. If ZimaOS were
   replaced with plain Debian tomorrow, the `services/` directory should need
   little to no change.

Runtime data (databases, media, container state) lives on the server under
`/DATA/AppData/<service>/`, never inside the repo — the repo defines
infrastructure, it doesn't store state.

### Documented Exception: SMB Uses ZimaOS's Native Samba

SMB (`services/smb/`) is deployed via ZimaOS's built-in Samba toggle, not a
container — the one deliberate exception to "everything through Docker
Compose" so far. The reasoning is specific to *this* service, not a general
loosening of the rule:

- SMB fundamentally requires mapping network users/permissions onto the
  underlying ownership of `/DATA`. That's precisely the category of problem
  that has already caused friction twice (Portainer and AdGuard both ended
  up running as root partly because containerized permission-mapping
  against `/DATA` is genuinely fiddly). ZimaOS's native Samba is built by
  the OS vendor for its own storage layout and user accounts, and already
  handles that mapping correctly.
- Unlike Portainer or AdGuard — generic tools ZimaOS has no special
  competency in — file sharing tied to storage is the one thing a NAS
  appliance OS is actually specialized for. Refusing the native option here
  to preserve Docker purity would mean fighting the platform on the exact
  thing it's built to do well — the mirror image of the lesson from the
  `/DATA` permission model below, not an application of it.
- A second, containerized Samba server alongside would risk the same class
  of port conflict already hit once with AdGuard (port 80 vs. 3000), this
  time on 445.

The real cost, stated plainly: native Samba's configuration lives in
ZimaOS's own database, not Git. Losing the server means shares aren't
restored by `git clone` + `docker compose up` — someone has to manually
re-enable Samba and recreate them. `services/smb/README.md` exists to keep
that recoverable anyway, as a precise manual runbook (exact folders, exact
permissions) — documented-but-manual for this one service, rather than
automated, while still meeting the "recoverable from Git and documentation"
bar this whole project is built around.

**This exception is scoped to staying on ZimaOS.** If the platform is ever
migrated away from ZimaOS, this decision gets revisited from scratch — it
was made because ZimaOS specifically is good at this, not because native
OS integrations are generally preferable to containers.

## The ZimaOS Permission Model and the Developer Environment

Early on, we discovered ZimaOS is an **appliance OS**, not a general-purpose
Linux distribution: `HOME=/DATA`, but `/DATA` itself is `root:root`, which
silently breaks Git, SSH, Docker, and any tool that expects to write to
`$HOME`. Full details are in `zimaos.md`; the architectural decision worth
recording here is *how* we responded to it.

The tempting fix would have been to fight the OS — `chown` the data
partition, patch permissions, or otherwise force ZimaOS to behave like a
normal distro. We rejected that: undocumented system-level permission changes
are exactly the kind of undiscoverable drift this whole project exists to
avoid, and ZimaOS updates could silently revert or conflict with them.

Instead we built a self-contained developer environment under
`/DATA/Infrastructure/developer/`, following the XDG Base Directory
Specification, and redirected tooling to it via a sourced `bootstrap.sh`
(`GIT_CONFIG_GLOBAL`, `DOCKER_CONFIG`, `XDG_CONFIG_HOME`, `XDG_CACHE_HOME`,
`XDG_STATE_HOME`). This is the same principle as the Docker decision above,
applied one layer down: work *with* the platform's constraints using
standard, portable mechanisms, rather than reshaping the platform itself.
The result is a developer environment that would port to any XDG-respecting
Linux system largely unchanged, even though the OS underneath it is
non-standard.

## Design Priorities

In rough order, when priorities conflict:

1. **Clean architecture** — decisions should be explainable, not just
   functional. "It works" is necessary, not sufficient.
2. **Reproducibility** — anything not reproducible from Git is treated as a
   bug, even if it currently works.
3. **Documentation** — a decision without a written "why" will look
   arbitrary or get silently reversed in six months.
4. **Git version control** — every change to infrastructure definition goes
   through Git; see the Deployment Flow above.
5. **Easy migration** — minimize anything that ties the system to this
   specific box, this specific OS, or this specific ISP/network.
6. **Minimal vendor lock-in** — prefer open, standard tooling (Docker
   Compose, plain XDG dirs) over platform-specific features (ZimaOS App
   Store), even when the platform-specific option is faster to set up.
7. **Professional standards** — build it the way a small platform
   engineering team would for a company, not the way a one-off home project
   gets built. See the project framing in `roadmap.md`.

These are ordered because they occasionally trade off against each other —
e.g. the ZimaOS workaround above cost an evening of setup (against "fast")
to buy reproducibility and minimal lock-in. When a future decision has to
pick between these, prefer the one earlier in this list.
