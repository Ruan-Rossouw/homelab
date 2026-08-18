# Secret management (sops + age) — see docs/secrets.md for the full design.
#
# Each service's real secrets live encrypted at services/<name>/secrets.enc.env
# (committed). Decrypting produces services/<name>/.env (gitignored), the same
# file docker compose has always read — nothing about compose.yml changes.
#
# These targets are Mac-side convenience only — `make` isn't present on the
# ZimaOS server (no package manager, nothing outside the base image). The
# actual portable entry point is scripts/secrets-*.sh, which these just call;
# use those scripts directly wherever `make` isn't available.
#
# Requires SOPS_AGE_KEY_FILE to point at an age private key that can decrypt
# services/*/secrets.enc.env (default below assumes the standard sops lookup
# location; override if yours lives elsewhere).
SOPS_AGE_KEY_FILE ?= $(HOME)/.config/sops/age/keys.txt
export SOPS_AGE_KEY_FILE

.PHONY: secrets-decrypt secrets-edit secrets-encrypt

# Usage: make secrets-decrypt SERVICE=prefetcharr
secrets-decrypt:
	@test -n "$(SERVICE)" || (echo "Usage: make secrets-decrypt SERVICE=<name>" && exit 1)
	scripts/secrets-decrypt.sh $(SERVICE)

# Usage: make secrets-edit SERVICE=prefetcharr
secrets-edit:
	@test -n "$(SERVICE)" || (echo "Usage: make secrets-edit SERVICE=<name>" && exit 1)
	scripts/secrets-edit.sh $(SERVICE)

# Usage: make secrets-encrypt SERVICE=prefetcharr
secrets-encrypt:
	@test -n "$(SERVICE)" || (echo "Usage: make secrets-encrypt SERVICE=<name>" && exit 1)
	scripts/secrets-encrypt.sh $(SERVICE)
