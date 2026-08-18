#!/bin/sh
# Decrypt one service's committed ciphertext into the .env docker compose
# reads. Portable entry point for secret decryption — unlike the Makefile
# targets, this doesn't require `make` (not present on the ZimaOS server).
# Usage: scripts/secrets-decrypt.sh <service-name>
set -eu

SERVICE="${1:?Usage: scripts/secrets-decrypt.sh <service-name>}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

sops --decrypt --input-type dotenv --output-type dotenv \
	"$REPO_ROOT/services/$SERVICE/secrets.enc.env" \
	> "$REPO_ROOT/services/$SERVICE/.env"
