#!/usr/bin/env bash
#
# Regenerates content/ from the vault, then builds the static site into public/.

set -euo pipefail

cd "$(dirname "$0")/.."

node scripts/assets.mjs
node scripts/sync.mjs
npx quartz build

echo
echo "Site construit dans public/ — ./scripts/deploy.sh pour l'envoyer en ligne."
