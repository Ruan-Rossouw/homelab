# Secret management (sops + age) — see docs/secrets.md for the full design.
#
# Each service's real secrets live encrypted at services/<name>/secrets.enc.env
# (committed). Decrypting produces services/<name>/.env (gitignored), the same
# file docker compose has always read — nothing about compose.yml changes.
#
# Requires SOPS_AGE_KEY_FILE to point at an age private key that can decrypt
# services/*/secrets.enc.env (default below assumes the standard sops lookup
# location; override if yours lives elsewhere).
SOPS_AGE_KEY_FILE ?= $(HOME)/.config/sops/age/keys.txt
export SOPS_AGE_KEY_FILE

.PHONY: secrets-decrypt secrets-edit secrets-encrypt

# Decrypt one service's committed ciphertext into the .env docker compose reads.
# Usage: make secrets-decrypt SERVICE=prefetcharr
secrets-decrypt:
	@test -n "$(SERVICE)" || (echo "Usage: make secrets-decrypt SERVICE=<name>" && exit 1)
	sops --decrypt --input-type dotenv --output-type dotenv \
		services/$(SERVICE)/secrets.enc.env > services/$(SERVICE)/.env

# Open one service's encrypted secrets in $EDITOR; re-encrypts on save.
# Usage: make secrets-edit SERVICE=prefetcharr
secrets-edit:
	@test -n "$(SERVICE)" || (echo "Usage: make secrets-edit SERVICE=<name>" && exit 1)
	sops services/$(SERVICE)/secrets.enc.env

# One-time migration path: encrypt an existing plaintext .env into
# secrets.enc.env. Does not delete the plaintext .env.
# Usage: make secrets-encrypt SERVICE=prefetcharr
secrets-encrypt:
	@test -n "$(SERVICE)" || (echo "Usage: make secrets-encrypt SERVICE=<name>" && exit 1)
	cp services/$(SERVICE)/.env services/$(SERVICE)/secrets.enc.env
	sops --encrypt --input-type dotenv --output-type dotenv -i \
		services/$(SERVICE)/secrets.enc.env
