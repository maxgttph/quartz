#!/usr/bin/env node
// Serves public/ exactly as the web server will: both languages side by side
// under /fr/ and /en/, with the language-picking redirect at the root.
//
// This is the only local mode where the language switcher works, because
// switching language means crossing from one build's output into the other's.
// `npm run dev` is faster and live-reloads, but mounts a single language at the
// root — see the note in package.json.
//
// Run it through `npm run preview`, which builds first.

import fs from "node:fs"
import http from "node:http"
import path from "node:path"
import handler from "serve-handler"

const SITE = path.resolve(import.meta.dirname, "..")
const PUBLIC = path.join(SITE, "public")
const PORT = Number(process.env.PORT ?? 8080)

if (!fs.existsSync(path.join(PUBLIC, "index.html"))) {
  console.error("public/ est absent ou incomplet — lancez `npm run build` d'abord.")
  process.exit(1)
}

// serve-handler resolves an extensionless request to its `.html` file on its
// own, which is what the deployed site relies on too.
const server = http.createServer((req, res) =>
  handler(req, res, { public: PUBLIC, directoryListing: false }),
)

server.listen(PORT, () => {
  console.log(`public/ servi sur http://localhost:${PORT}/`)
  // One directory per language is all build.sh ever puts at the root of public/.
  const langs = fs
    .readdirSync(PUBLIC, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
  for (const lang of langs) console.log(`  http://localhost:${PORT}/${lang}/`)
})
