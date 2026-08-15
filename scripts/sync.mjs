#!/usr/bin/env node
// Regenerates content/ from the Obsidian vault.
//
// The vault stores one folder per note, holding one file per language:
//
//   <topic>/[<sub-topic>/]<slug>/<slug>.en.md
//                               /<slug>.fr.md
//
// The site is built once per language (see scripts/build.sh), so content/ is
// split into one self-contained tree per language:
//
//   content/fr/<topic>/<slug>.md      → symlink to <slug>.fr.md in the vault
//   content/fr/<topic>/index.md       → generated, localised folder title
//   content/fr/index.md               → generated homepage
//
// The language suffix is dropped from the filename because it is already
// carried by the tree root: `/fr/astronomy/solar-eclipses` needs no second
// marker. Wiki-links inside the notes still spell it (`[[solar-eclipses.fr]]`)
// — quartz.ts strips the suffix before the links are resolved.
//
// Notes are symlinked rather than copied so that `--serve` keeps live-reloading
// on edits made in Obsidian. The vault itself is never written to.

import fs from "node:fs/promises"
import path from "node:path"
import { parse as parseYaml } from "yaml"

const VAULT = process.env.VAULT ?? "/home/maximilien/learning-vault"
const SITE = path.resolve(import.meta.dirname, "..")
const CONTENT = path.join(SITE, "content")

/** Supported languages, default first. Must match LANGUAGES in quartz.ts. */
const LANGS = ["fr", "en"]

// Display names for topic folders. Unlisted folders fall back to a
// capitalised, de-hyphenated version of the folder name, which is already
// correct for most English labels.
const DOMAIN_LABELS = {
  astronomy: { fr: "Astronomie", en: "Astronomy" },
  economics: { fr: "Économie", en: "Economics" },
  "food-science": { fr: "Science des aliments", en: "Food science" },
  "machine-learning": { fr: "Machine learning", en: "Machine learning" },
  meteorology: { fr: "Météorologie", en: "Meteorology" },
  neurology: { fr: "Neurologie", en: "Neurology" },
  neuroscience: { fr: "Neurosciences", en: "Neuroscience" },
}

const titleCase = (dir) => dir.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase())

/** Localised label for a folder, keyed by its *last* segment. */
const label = (dir, lang) => {
  const name = dir.split("/").pop()
  return DOMAIN_LABELS[name]?.[lang] ?? titleCase(name)
}

/** Everything the generated pages say, in each supported language. */
const UI = {
  fr: {
    locale: "fr-FR",
    homeTitle: "Carnet d'apprentissage",
    notes: (n) => `${n} fiche${n > 1 ? "s" : ""}`,
    domains: (n) => `${n} domaine${n > 1 ? "s" : ""}`,
    intro: (notes, domains) =>
      `${notes} de synthèse réparties en ${domains}. Chaque fiche condense une ` +
      `conversation en une note durable : l'essentiel en tête, le détail ensuite, ` +
      `et des liens vers les fiches voisines.`,
    latest: "Dernières fiches",
    allDomains: "Tous les domaines",
  },
  en: {
    locale: "en-GB",
    homeTitle: "Learning Vault",
    notes: (n) => `${n} note${n > 1 ? "s" : ""}`,
    domains: (n) => `${n} domain${n > 1 ? "s" : ""}`,
    intro: (notes, domains) =>
      `${notes} across ${domains}. Each note distils a conversation into something ` +
      `durable: the essentials first, the detail after, and links to neighbouring notes.`,
    latest: "Latest notes",
    allDomains: "All domains",
  },
}

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

/**
 * Depth-first walk of a topic folder. A directory is a *note folder* as soon as
 * it holds a `<its own name>.<lang>.md` file; anything else is a topic folder
 * and gets recursed into.
 */
async function walkNotes(relDir, notes, warnings) {
  const entries = await fs.readdir(path.join(VAULT, relDir), { withFileTypes: true })
  const slug = path.basename(relDir)
  const files = entries.filter((e) => e.isFile() && e.name.endsWith(".md")).map((e) => e.name)

  const byLang = {}
  for (const lang of LANGS) {
    const name = `${slug}.${lang}.md`
    if (files.includes(name)) byLang[lang] = name
  }

  if (Object.keys(byLang).length > 0) {
    for (const lang of LANGS) {
      if (!byLang[lang]) warnings.push(`${relDir}/${slug}.${lang}.md manquant`)
    }
    const claimed = Object.values(byLang)
    for (const f of files) {
      if (!claimed.includes(f)) warnings.push(`${relDir}/${f} ignoré (nom hors convention)`)
    }
    notes.push({ dir: path.dirname(relDir), slug, byLang })
  } else {
    for (const f of files) {
      warnings.push(`${relDir}/${f} ignoré (pas dans un dossier de fiche)`)
    }
  }

  for (const e of entries) {
    if (e.isDirectory() && !e.name.startsWith("_") && !e.name.startsWith(".")) {
      await walkNotes(path.join(relDir, e.name), notes, warnings)
    }
  }
}

/** Read title + created date for one language of a note. */
async function noteMeta(note, lang) {
  const rel = path.join(note.dir, note.slug, note.byLang[lang])
  const raw = await fs.readFile(path.join(VAULT, rel), "utf8")
  const fm = frontmatter(raw, rel)
  return {
    dir: note.dir,
    slug: note.slug,
    title: fm?.title ?? note.slug,
    created: fm?.created ? String(fm.created).slice(0, 10) : null,
  }
}

/** `[[slug|Title]]`, or `[[slug]]` when the title adds nothing. */
const link = (n) => (n.title === n.slug ? `[[${n.slug}]]` : `[[${n.slug}|${n.title}]]`)

function buildIndex(lang, folders, notes) {
  const t = UI[lang]
  const dateFmt = new Intl.DateTimeFormat(t.locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
  })
  const formatDate = (iso) => (iso ? dateFmt.format(new Date(iso)) : "")

  // Recency comes from frontmatter `created`, not git: the vault is committed
  // in topic batches, so commit dates cluster and hide the real authoring order.
  const recent = [...notes]
    .filter((n) => n.created)
    .sort((a, b) => b.created.localeCompare(a.created))
    .slice(0, 6)

  const byTitle = (a, b) => a.title.localeCompare(b.title, t.locale)

  const out = []
  out.push("---")
  out.push(`title: "${t.homeTitle}"`)
  out.push(`lang: ${lang}`)
  out.push(`created: ${new Date().toISOString().slice(0, 10)}`)
  out.push("---")
  out.push("")
  out.push(`> ${t.intro(t.notes(notes.length), t.domains(folders.length))}`)
  out.push("")

  out.push(`## ${t.latest}`)
  out.push("")
  for (const n of recent) {
    out.push(`- ${link(n)} — *${label(n.dir, lang)}*, ${formatDate(n.created)}`)
  }
  out.push("")

  out.push(`## ${t.allDomains}`)
  out.push("")
  // Order domains by their display label, not by folder name.
  const ordered = [...folders].sort((a, b) =>
    label(a, lang).localeCompare(label(b, lang), t.locale),
  )
  for (const folder of ordered) {
    const inFolder = notes.filter((n) => n.dir === folder).sort(byTitle)
    out.push(`### ${label(folder, lang)}`)
    out.push("")
    out.push(`${t.notes(inFolder.length)}.`)
    out.push("")
    for (const n of inFolder) out.push(`- ${link(n)}`)
    out.push("")
  }

  return out.join("\n")
}

/**
 * A folder gets an `index.md` carrying nothing but its localised title. Quartz
 * still renders it as a folder page — the listing comes from FolderContent —
 * but the title now reads "Astronomie" instead of the raw folder name, both on
 * the page and in the explorer tree.
 */
const folderIndex = (folder, lang) =>
  ["---", `title: "${label(folder, lang)}"`, `lang: ${lang}`, "---", ""].join("\n")

/** Every folder that holds notes, plus its ancestors. */
function folderSet(notes) {
  const folders = new Set()
  for (const n of notes) {
    const parts = n.dir.split("/")
    for (let i = 1; i <= parts.length; i++) folders.add(parts.slice(0, i).join("/"))
  }
  return [...folders].sort()
}

async function main() {
  const topics = await topicFolders()
  if (topics.length === 0) {
    console.error(`Aucun dossier de contenu trouvé dans ${VAULT}`)
    process.exit(1)
  }

  const notes = []
  const warnings = []
  for (const topic of topics) await walkNotes(topic, notes, warnings)

  if (notes.length === 0) {
    console.error(
      `Aucune fiche trouvée dans ${VAULT}.\n` +
        `Attendu : <topic>/<slug>/<slug>.<lang>.md (langues : ${LANGS.join(", ")}).`,
    )
    process.exit(1)
  }

  await fs.rm(CONTENT, { recursive: true, force: true })

  const folders = folderSet(notes)

  for (const lang of LANGS) {
    const root = path.join(CONTENT, lang)

    for (const folder of folders) {
      await fs.mkdir(path.join(root, folder), { recursive: true })
      await fs.writeFile(path.join(root, folder, "index.md"), folderIndex(folder, lang))
    }

    const present = []
    for (const note of notes) {
      if (!note.byLang[lang]) continue
      await fs.symlink(
        path.join(VAULT, note.dir, note.slug, note.byLang[lang]),
        path.join(root, note.dir, `${note.slug}.md`),
        "file",
      )
      present.push(await noteMeta(note, lang))
    }

    // Only list domains that actually have a note in this language.
    const live = folders.filter((f) => present.some((n) => n.dir === f))
    await fs.writeFile(path.join(root, "index.md"), buildIndex(lang, live, present) + "\n")

    console.log(`content/${lang}/ : ${present.length} fiches, ${live.length} domaines + index.md`)
  }

  for (const w of warnings) console.warn(`  ! ${w}`)
  console.log(`content/ régénéré depuis ${VAULT}`)
}

await main()
