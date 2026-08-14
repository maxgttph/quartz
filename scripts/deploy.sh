#!/usr/bin/env bash
#
# Ships public/ to the web server. Run ./scripts/build.sh first (or use
# `npm run deploy`, which chains both).
#
# Set the destination once, either here or in the environment:
#   export DEPLOY_TARGET="user@host:/var/www/notes.example.com/"

set -euo pipefail

cd "$(dirname "$0")/.."

TARGET="${DEPLOY_TARGET:-}"

if [[ -z "$TARGET" ]]; then
  cat >&2 <<'EOF'
DEPLOY_TARGET n'est pas défini.

  export DEPLOY_TARGET="user@host:/var/www/notes.example.com/"
  ./scripts/deploy.sh

Pensez aussi à renseigner `baseUrl` dans quartz.config.yaml : le flux RSS,
le sitemap et les images Open Graph en dépendent.
EOF
  exit 1
fi

if [[ ! -d public ]]; then
  echo "public/ est absent — lancez ./scripts/build.sh d'abord." >&2
  exit 1
fi

echo "Déploiement de public/ vers $TARGET"
# --delete removes files on the server that no longer exist locally, so a
# renamed or deleted note doesn't linger as a stale page.
rsync -avz --delete --human-readable public/ "$TARGET"
echo "Terminé."
