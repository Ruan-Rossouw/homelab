#!/bin/sh
# Open one service's encrypted secrets in $EDITOR; sops re-encrypts on save.
# Usage: scripts/secrets-edit.sh <service-name>
set -eu

SERVICE="${1:?Usage: scripts/secrets-edit.sh <service-name>}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

sops "services/$SERVICE/secrets.enc.env"
