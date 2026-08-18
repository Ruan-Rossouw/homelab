#!/bin/sh
# Decrypt one service's committed ciphertext into the .env docker compose
# reads. Portable entry point for secret decryption — unlike the Makefile
# targets, this doesn't require `make` (not present on the ZimaOS server).
# Usage: scripts/secrets-decrypt.sh <service-name>
#
# Uses a path relative to the repo root, not an absolute one — on the
# server, `sops` runs inside a Docker container that only has $PWD mounted
# (as /work), so an absolute host path like /DATA/... doesn't exist from
# the container's point of view even though it's real on the host.
set -eu

SERVICE="${1:?Usage: scripts/secrets-decrypt.sh <service-name>}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

sops --decrypt --input-type dotenv --output-type dotenv \
	"services/$SERVICE/secrets.enc.env" \
	> "services/$SERVICE/.env"
