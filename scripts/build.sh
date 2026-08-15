#!/usr/bin/env bash
#
# Regenerates content/ from the vault, then builds one static site per language
# into public/<lang>/, plus a language-picking redirect at public/index.html.
#
#   public/
#   ├── index.html   → redirects to fr/ or en/ following the browser's language
#   ├── fr/          → French site, served at https://<domain>/fr/
#   └── en/          → English site, served at https://<domain>/en/
#
# Each language is a separate build: `locale` (interface strings, date formats)
# and the search index, explorer tree, graph, feed and sitemap are all decided
# once per build, so sharing one would mean serving English notes with French
# chrome. See the header comment in quartz.ts.

set -euo pipefail

cd "$(dirname "$0")/.."

# Order is irrelevant here; the default language lives in scripts/root-redirect.html.
LANGS=(fr en)

node scripts/assets.mjs
node scripts/sync.mjs

rm -rf public

for lang in "${LANGS[@]}"; do
  echo
  echo "── ${lang} ──────────────────────────────────────────"
  QUARTZ_LANG="$lang" QUARTZ_BASE_PATH="/$lang" \
    npx quartz build -d "content/$lang" -o "public/$lang"
done

cp scripts/root-redirect.html public/index.html

echo
echo "Site construit dans public/ — ./scripts/deploy.sh pour l'envoyer en ligne."
