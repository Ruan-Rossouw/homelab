# Conventions

This document defines the engineering standards for the repository. Anything
not covered here should default to whatever a small, disciplined platform
team would do — favor explicitness over cleverness.

## Directory Conventions

```text
homelab/
├── README.md          # high-level overview, not implementation detail
├── LICENSE
├── .gitignore
├── Makefile
├── docs/               # one file, one question — see Documentation below
├── scripts/            # standalone operational scripts (backup, bootstrap, etc.)
├── services/           # one directory per deployed service
└── templates/          # boilerplate for new services/docs
```

Every empty directory contains a `.gitkeep` — an empty directory that isn't
meaningfully empty (i.e. it's structural, not incidental) still belongs in
Git.

Every service under `services/` follows the same shape:

```text
services/<service-name>/
├── compose.yml
├── README.md
├── .env.example
└── config/
```

Runtime data (volumes, databases, media) never lives in the repo. It lives on
the server under `/DATA/AppData/<service-name>/`. The repo describes
infrastructure; it does not contain state.

## Documentation Conventions

Documentation is infrastructure, not an afterthought. Each doc answers **one**
question, named for the question it answers (`networking.md`, not `notes.md`):

| Doc | Question it answers |
|---|---|
| `architecture.md` | Why is the system shaped this way? |
| `networking.md` | How does traffic get from A to B? |
| `storage.md` | Where does data live, and why there? |
| `backup.md` | What is backed up, how, and how often? |
| `disaster-recovery.md` | If the server dies today, what do I do? |
| `conventions.md` | What are the rules everything else follows? |
| `zimaos.md` | What's non-standard about this OS, and how did we work around it? |
| `roadmap.md` | What are we building, in what order, and why? |

`README.md` stays high-level — a pitch and a map, linking into `docs/` for
anything implementation-specific. If you find yourself explaining *how* a
service is configured in the README, that content belongs in
`services/<name>/README.md` instead.

## Commit Conventions

Commits are logical and each describes exactly one change, written in
imperative mood (`Add Portainer service`, not `Added` or `Adding`):

```text
Add Portainer service
Configure Portainer volumes
Add AdGuard Home
```

Never commit with `First commit`, `Update`, `Changes`, or similar — a commit
message should let someone reconstruct the history of the project without
reading the diff.

**Note on Conventional Commits:** we're deliberately *not* using the
`feat:`/`fix:`/`chore:` prefix convention. That convention earns its keep when
you're generating changelogs or semantic version bumps for a published
package — neither applies to an infrastructure repo that only ever has one
"release" (whatever's running on the server right now). Plain imperative
messages are the older and more universal convention (this is Git's own
recommended style); we're choosing it because it's a better fit, not because
it's inherently superior. If this repo ever grows automated changelog
generation, Conventional Commits is the natural upgrade.

## Branching Strategy

- `main` — stable, always deployable. Nothing is pushed to `main` directly;
  everything arrives via pull request (see Branch Protection below).
- `feature/<service>` — deploying or substantially changing one service, e.g.
  `feature/portainer`, `feature/adguard`.
- `docs/<topic>` — documentation/standards work not tied to a single service,
  e.g. `docs/phase-1-foundation`.

Branch names are otherwise `<type>/<short-topic>`, mirroring the commit
scope: one branch, one coherent unit of work, not "misc fixes."

### Branch Protection & CI

Even solo, a PR-gated `main` is worth the friction: it's what turns "did I
remember to sanity-check this" into something the platform enforces instead
of something you have to remember. Configuration on `main`:

- **Require a pull request before merging.** No direct pushes, including from
  admins — if the rule doesn't apply to you, it isn't really a rule.
- **Require status checks to pass** (see CI below) and require the branch to
  be up to date with `main` before merging.
- **No force pushes, no branch deletion** on `main`.
- **Merge strategy: rebase and merge only.** Squash merging would collapse
  the atomic, logically-scoped commits described above into one commit per
  PR, which defeats the point of writing them that way. A plain merge commit
  adds noise without benefit for a single-contributor repo. Rebase keeps
  history linear *and* keeps each commit intact.
- **Required approvals: 0.** GitHub doesn't let an author approve their own
  PR, so requiring approvals on a solo repo would either lock the repo or
  require a bypass — neither is worth it. The required status checks are the
  actual quality gate here; this is a deliberate trade-off for a
  single-maintainer repo, not a best practice to carry into a team repo.

CI (GitHub Actions, runs on every PR into `main`):

| Check | Tool | Scope |
|---|---|---|
| Markdown lint | `markdownlint` | `docs/**/*.md`, `README.md` |
| YAML lint | `yamllint` | `**/*.yml`, `**/*.yaml` |
| Shell lint | `shellcheck` | `scripts/**/*.sh` |
| Secret scan | `gitleaks` | entire repo |

Kept deliberately cheap — linters only, no build/deploy step. Nothing here
touches the server; CI validates the repo, deployment is still a manual
`git pull` on the box per the repo philosophy.

## Compose Conventions

- One `compose.yml` per service, under `services/<name>/`. No multi-service
  mega-compose files — each service is independently deployable and
  removable.
- **Pin image tags.** Never `image: foo:latest`. An unpinned tag means the
  same `git pull` + `docker compose up` can produce a different result on two
  different days — that's the opposite of reproducible.
- Secrets and environment-specific values go in `.env` (gitignored); a
  `.env.example` with placeholder values is committed so the shape of the
  configuration is documented even though the values aren't.
- `restart: unless-stopped` as the default restart policy, so services
  survive a server reboot without needing the ZimaOS app layer.
- Container networking model (shared network vs. per-service isolation) is
  intentionally **not** decided here — that's a Phase 2 architecture decision
  once Portainer/Tailscale/AdGuard give us a real topology to design against,
  not something to lock in speculatively during Phase 1.

## What's Deliberately Not Decided Yet

Per the phase philosophy in [`roadmap.md`](roadmap.md), the following are
out of scope until their phase arrives: reverse proxy / TLS conventions,
inter-service networking, secret management tooling beyond `.env`, and backup
scheduling mechanics (`backup.md` and `disaster-recovery.md` land later in
Phase 1, but the automation itself is Phase 5).
