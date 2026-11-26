#!/bin/sh
# Post-deploy hook for the auto-deploy poller (docs/zimaos.md, "Auto-Deploy on
# Merge to Main"). After it brings the container up, the poller runs this
# when it exists. Home Assistant reads its cards and packages from its config
# directory, not from this checkout, so copy the committed files across.
# Only files that changed are touched. The poller runs as `ruan`, so the
# two target directories must be owned by `ruan:samba` (see the doc).
#
# This copies files only. A new or edited package still needs a reload
# (Developer tools > YAML, or `template.reload`, `automation.reload`,
# `script.reload`) or an HA restart. A new card build reaches the wall panel
# by itself (its self-updater).
set -eu

SRC=$(cd "$(dirname "$0")" && pwd)
CFG=/DATA/AppData/home-assistant/config

copy_if_changed() {
  if ! cmp -s "$1" "$2" 2>/dev/null; then
    cp "$1" "$2"
    logger -t homelab-deploy "home-assistant: updated $2"
  fi
}

mkdir -p "$CFG/www/custom-cards" "$CFG/packages"

for f in "$SRC"/custom-cards/*.js "$SRC"/custom-cards/panel-reload.html; do
  [ -f "$f" ] && copy_if_changed "$f" "$CFG/www/custom-cards/$(basename "$f")"
done

for f in "$SRC"/packages/*.yaml; do
  [ -f "$f" ] && copy_if_changed "$f" "$CFG/packages/$(basename "$f")"
done
exit 0
