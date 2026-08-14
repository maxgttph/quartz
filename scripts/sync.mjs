#!/usr/bin/env node
// Regenerates content/ from the Obsidian vault:
//   - one symlink per topic folder (folders starting with _ or . are vault
//     infrastructure and are skipped, per the vault's own CLAUDE.md convention)
//   - a generated index.md homepage
//
// The vault itself is never written to.

import fs from "node:fs/promises"
import path from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { parse as parseYaml } from "yaml"

const exec = promisify(execFile)

const VAULT = process.env.VAULT ?? "/home/maximilien/learning-vault"
const SITE = path.resolve(import.meta.dirname, "..")
const CONTENT = path.join(SITE, "content")

// Display names for topic folders. Unlisted folders fall back to a
// capitalised, de-hyphenated version of the folder name.
const DOMAIN_LABELS = {
  astronomy: "Astronomie",
  economics: "Économie",
  "food-science": "Science des aliments",
  "machine-learning": "Machine learning",
  meteorology: "Météorologie",
  neurology: "Neurologie",
  neuroscience: "Neurosciences",
}

const label = (dir) =>
  DOMAIN_LABELS[dir] ?? dir.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase())

/** Topic folders: real directories not prefixed with `_` (infrastructure) or `.`. */
async function topicFolders() {
  const entries = await fs.readdir(VAULT, { withFileTypes: true })
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith("_") && !e.name.startsWith("."))
    .map((e) => e.name)
    .sort()
}

/** Parse the `---` frontmatter block at the top of a note. */
function frontmatter(raw, file) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!m) return null
  try {
    return parseYaml(m[1])
  } catch (err) {
    console.warn(`  ! frontmatter illisible dans ${file}: ${err.message}`)
    return null
  }
}

/** Last commit date for a file, as an ISO string. Null if never committed. */
async function gitModified(relPath) {
  try {
    const { stdout } = await exec("git", ["log", "-1", "--format=%aI", "--", relPath], {
      cwd: VAULT,
    })
    return stdout.trim() || null
  } catch {
    return null
  }
}

async function collectNotes(folders) {
  const notes = []
  for (const folder of folders) {
    const files = (await fs.readdir(path.join(VAULT, folder))).filter((f) => f.endsWith(".md"))
    for (const file of files) {
      const rel = path.join(folder, file)
      const raw = await fs.readFile(path.join(VAULT, rel), "utf8")
      const fm = frontmatter(raw, rel)
      const slug = file.replace(/\.md$/, "")
      notes.push({
        folder,
        slug,
        title: fm?.title ?? slug,
        created: fm?.created ? String(fm.created).slice(0, 10) : null,
        modified: await gitModified(rel),
      })
    }
  }
  return notes
}

const DATE_FMT = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "long",
  year: "numeric",
})
const formatDate = (iso) => (iso ? DATE_FMT.format(new Date(iso)) : "")

/** `[[slug|Title]]`, or `[[slug]]` when the title adds nothing. */
const link = (n) => (n.title === n.slug ? `[[${n.slug}]]` : `[[${n.slug}|${n.title}]]`)

function buildIndex(folders, notes) {
  // Recency comes from frontmatter `created`, not git: the vault is committed
  // in topic batches, so commit dates cluster and hide the real authoring order.
  const recent = [...notes]
    .filter((n) => n.created)
    .sort((a, b) => b.created.localeCompare(a.created))
    .slice(0, 6)

  const byTitle = (a, b) => a.title.localeCompare(b.title, "fr")

  const plural = (n, word) => `${n} ${word}${n > 1 ? "s" : ""}`

  const out = []
  out.push("---")
  out.push('title: "Carnet d\'apprentissage"')
  out.push(`created: ${new Date().toISOString().slice(0, 10)}`)
  out.push("---")
  out.push("")
  out.push(
    `> ${plural(notes.length, "fiche")} de synthèse réparties en ${plural(folders.length, "domaine")}. ` +
      `Chaque fiche condense une conversation en une note durable : l'essentiel en tête, ` +
      `le détail ensuite, et des liens vers les fiches voisines.`,
  )
  out.push("")

  out.push("## Dernières fiches")
  out.push("")
  for (const n of recent) {
    out.push(`- ${link(n)} — *${label(n.folder)}*, ${formatDate(n.created)}`)
  }
  out.push("")

  out.push("## Tous les domaines")
  out.push("")
  // Order domains by their French display label, not by folder name.
  const ordered = [...folders].sort((a, b) => label(a).localeCompare(label(b), "fr"))
  for (const folder of ordered) {
    const inFolder = notes.filter((n) => n.folder === folder).sort(byTitle)
    out.push(`### ${label(folder)}`)
    out.push("")
    out.push(`${plural(inFolder.length, "fiche")}.`)
    out.push("")
    for (const n of inFolder) out.push(`- ${link(n)}`)
    out.push("")
  }

  return out.join("\n")
}

async function main() {
  const folders = await topicFolders()
  if (folders.length === 0) {
    console.error(`Aucun dossier de contenu trouvé dans ${VAULT}`)
    process.exit(1)
  }

  await fs.rm(CONTENT, { recursive: true, force: true })
  await fs.mkdir(CONTENT, { recursive: true })

  for (const folder of folders) {
    await fs.symlink(path.join(VAULT, folder), path.join(CONTENT, folder), "dir")
  }

  const notes = await collectNotes(folders)
  await fs.writeFile(path.join(CONTENT, "index.md"), buildIndex(folders, notes) + "\n")

  console.log(`content/ régénéré depuis ${VAULT}`)
  console.log(`  ${folders.length} domaines : ${folders.join(", ")}`)
  console.log(`  ${notes.length} fiches + index.md`)
}

await main()
