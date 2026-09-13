---
name: renovate-review
description: Reviews open Renovate PRs on Ruan-Rossouw/homelab, skims release notes for breaking changes, merges clean patch/minor bumps, flags majors and anything with applicable breaking changes for manual review, and reports what happened. Invoke for periodic Renovate PR triage on this repo.
---

# Renovate PR Review

Reviews and triages this repo's open Renovate dependency-bump PRs. Scope is
strictly `author:app/renovate` PRs on `Ruan-Rossouw/homelab` — never touch a
PR opened by anyone else.

## 1. List open Renovate PRs

```bash
gh pr list --repo Ruan-Rossouw/homelab --search "author:app/renovate" --state open \
  --json number,title,body,mergeable,mergeStateStatus,statusCheckRollup
```

If empty, say so and stop — there's nothing to review.

## 2. Per-PR triage

For each PR, in order:

1. **Parse the update tier** from the PR body's update table (`major` /
   `minor` / `patch`) and the version change (`from` → `to`).
2. **Check CI.** All `statusCheckRollup` entries must show
   `conclusion: SUCCESS`. This repo's CI is lint-only (markdown/YAML/shell
   lint, secret scan, custom-cards build freshness) — it does **not**
   functionally test the bumped service, so a green check here is
   necessary but not sufficient; the release-notes skim below is what
   actually catches a risky bump. If CI is still running, skip this PR for
   now and note it as "CI pending" in the final report rather than waiting
   on it.
3. **Get release notes.** Some Renovate PR bodies already embed a "Release
   Notes" section (Grafana and Tailscale did, in past runs); if the body
   has one, read it directly. Otherwise `WebFetch` the upstream project's
   GitHub releases page for the target version tag (e.g.
   `https://github.com/<owner>/<repo>/releases/tag/<version>`) and ask for
   breaking changes, deprecations, and migration steps.
4. **Check applicability.** If the notes mention a deprecated flag, config
   key, or removed feature, `grep` the relevant `services/<name>/`
   directory in this repo to see whether it's actually in use here before
   treating it as blocking — a deprecation that doesn't apply to this
   repo's config isn't a reason to hold the PR.

## 3. Merge decision (tiered)

- **Major version bump** → never auto-merge, regardless of how clean the
  notes look. Leave the PR open and note it in the final report as
  needing manual review, with a one-line summary of what changed.
- **Minor/patch, CI green, notes clean (or an applicable-but-harmless
  deprecation)** → merge.
- **Minor/patch but notes flag something that genuinely applies to this
  repo's config** → treat like a major: leave open, flag in the report,
  explain what and why.

To merge:

```bash
gh pr merge <n> --repo Ruan-Rossouw/homelab --squash --delete-branch
```

**Use `--squash`, not `--rebase`**, even though `docs/conventions.md`
currently states "rebase and merge only" — actual practice for every
Renovate merge so far (verified by comparing commit metadata, not just
assumed) has been squash. This is a known doc/practice mismatch, not yet
resolved; don't "fix" it unilaterally by switching methods mid-flight. If
it comes up, mention it in the report rather than silently picking one.

**Handle the async `BLOCKED`/`BEHIND` retry.** This repo's branch
protection uses strict status checks — merging one PR briefly knocks any
other open PR's `mergeStateStatus` into `BEHIND` or `BLOCKED` while GitHub
recomputes against the new base, even though nothing about that PR
actually changed. If a merge attempt fails with a status-check or
mergeability error, retry up to ~6 times, 10 seconds apart, before
treating it as a real failure. This is expected, not a sign something is
wrong.

## 4. After merging — no server action needed

This repo has an auto-deploy timer (`docs/zimaos.md`'s "Auto-Deploy on
Merge to Main") that polls `origin/main` every 5 minutes and redeploys
only the services that changed. Once a PR is merged here, it goes live on
its own — don't produce manual server commands unless the user says the
timer isn't running or asks for them explicitly.

## 5. Report

End with a summary table: PR number, package, version change, and outcome
(merged / left open + one-line reason / CI pending). Keep it short — this
is a status report, not a changelog.
