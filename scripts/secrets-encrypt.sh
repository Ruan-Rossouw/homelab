#!/bin/sh
# One-time migration path: encrypt an existing plaintext .env into
# secrets.enc.env. Does not delete the plaintext .env.
# Usage: scripts/secrets-encrypt.sh <service-name>
set -eu

SERVICE="${1:?Usage: scripts/secrets-encrypt.sh <service-name>}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

cp "services/$SERVICE/.env" "services/$SERVICE/secrets.enc.env"
sops --encrypt --input-type dotenv --output-type dotenv -i \
	"services/$SERVICE/secrets.enc.env"
