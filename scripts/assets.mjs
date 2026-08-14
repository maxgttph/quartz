#!/usr/bin/env node
/**
 * Copies the site's web fonts and KaTeX stylesheet out of node_modules and into
 * quartz/static/, so the published site makes no requests to fonts.googleapis.com,
 * fonts.gstatic.com or cdn.jsdelivr.net.
 *
 * Two reasons this exists rather than the quartz-fonts plugin's own `selfHosted`
 * mode:
 *
 *   1. That mode rewrites font URLs to `https://<baseUrl>/static/fonts/…`. Absolute
 *      URLs mean the local `--serve` preview requests fonts from the production
 *      domain, and the build refuses to run at all until baseUrl is set.
 *   2. It only downloads the `title`, `header`, `body` and `code` slots — see
 *      googleFontHref() in the plugin. The `interface` family (Inter) is declared
 *      as a CSS variable but never fetched, so the whole UI chrome silently falls
 *      back to the browser default.
 *
 * Everything here uses root-relative URLs, which work identically under
 * `--serve` and in production. Run it after `npm i`; re-run when the font or
 * katex versions change. Output is committed-ignored via quartz/static/fonts.
 */

import fs from "node:fs/promises"
import path from "node:path"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const SITE = path.resolve(import.meta.dirname, "..")
const STATIC = path.join(SITE, "quartz", "static")

// The two Google subsets we serve. `latin` alone covers French (including the
// Œ/œ ligature at U+0152-0153); `latin-ext` is here for the occasional foreign
// term and only downloads when a page actually uses a character in its range.
const SUBSETS = {
  latin:
    "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329," +
    "U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD",
  "latin-ext":
    "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329," +
    "U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F," +
    "U+A720-A7FF",
}

/**
 * Weights match what the theme actually uses; adding more only costs bytes.
 * Source Serif 4 carries italics because body prose uses them (the TL;DR lede
 * is upright by design, but emphasis inside the deep dive is not).
 */
const FAMILIES = [
  { pkg: "@fontsource/newsreader", family: "Newsreader", file: "newsreader", faces: [[500, "normal"], [600, "normal"]] },
  {
    pkg: "@fontsource/source-serif-4",
    family: "Source Serif 4",
    file: "source-serif-4",
    faces: [
      [400, "normal"], [600, "normal"], [700, "normal"],
      [400, "italic"], [600, "italic"], [700, "italic"],
    ],
  },
  { pkg: "@fontsource/inter", family: "Inter", file: "inter", faces: [[400, "normal"], [500, "normal"], [600, "normal"]] },
]

/**
 * JetBrains Mono is served unsubsetted, from the upstream package rather than
 * from @fontsource.
 *
 * 14 notes draw ASCII pipeline diagrams with box-drawing characters
 * (U+2500-257F: ─ ┬ │ └ ┼) and arrows (U+2192: →). None of those code points
 * fall inside Google's `latin` or `latin-ext` ranges, so the @fontsource build
 * omits them entirely — verified with fontTools: 229 glyphs, no box drawing.
 * The letters in a diagram would render in JetBrains Mono while the rules
 * around them fell back to whatever monospace the visitor's browser defaults
 * to, and any difference in advance width pulls the diagram apart.
 *
 * The complete face is 69 kB, barely more than the two subsets it replaces,
 * and covers all 1182 glyphs. No unicode-range: the whole file is always used.
 */
const FULL_FAMILIES = [
  {
    pkg: "jetbrains-mono",
    family: "JetBrains Mono",
    dir: "fonts/webfonts",
    faces: [
      [400, "normal", "JetBrainsMono-Regular.woff2"],
      [500, "normal", "JetBrainsMono-Medium.woff2"],
    ],
  },
]

async function buildFonts() {
  const outDir = path.join(STATIC, "fonts")
  await fs.rm(outDir, { recursive: true, force: true })
  await fs.mkdir(outDir, { recursive: true })

  const blocks = []
  let copied = 0

  for (const { pkg, family, file, faces } of FAMILIES) {
    const filesDir = path.join(path.dirname(require.resolve(`${pkg}/package.json`)), "files")
    for (const [weight, style] of faces) {
      for (const [subset, range] of Object.entries(SUBSETS)) {
        const name = `${file}-${subset}-${weight}-${style}.woff2`
        const src = path.join(filesDir, name)
        try {
          await fs.copyFile(src, path.join(outDir, name))
        } catch {
          throw new Error(`Police absente : ${src}\nRelancez \`npm i\` ou ajustez FAMILIES.`)
        }
        copied++
        blocks.push(
          [
            `@font-face {`,
            `  font-family: "${family}";`,
            `  font-style: ${style};`,
            `  font-weight: ${weight};`,
            `  font-display: swap;`,
            `  src: url("./${name}") format("woff2");`,
            `  unicode-range: ${range};`,
            `}`,
          ].join("\n"),
        )
      }
    }
  }

  for (const { pkg, family, dir, faces } of FULL_FAMILIES) {
    const filesDir = path.join(path.dirname(require.resolve(`${pkg}/package.json`)), dir)
    for (const [weight, style, name] of faces) {
      await fs.copyFile(path.join(filesDir, name), path.join(outDir, name))
      copied++
      blocks.push(
        [
          `@font-face {`,
          `  font-family: "${family}";`,
          `  font-style: ${style};`,
          `  font-weight: ${weight};`,
          `  font-display: swap;`,
          `  src: url("./${name}") format("woff2");`,
          `}`,
        ].join("\n"),
      )
    }
  }

  const header =
    "/* Généré par scripts/assets.mjs — ne pas éditer à la main. */\n" +
    "/* Polices auto-hébergées : aucune requête vers fonts.gstatic.com. */\n\n"
  await fs.writeFile(path.join(outDir, "quartz-fonts.css"), header + blocks.join("\n\n") + "\n")
  return copied
}

async function buildKatex() {
  const dist = path.join(path.dirname(require.resolve("katex/package.json")), "dist")
  const outDir = path.join(STATIC, "katex")
  await fs.rm(outDir, { recursive: true, force: true })
  await fs.mkdir(outDir, { recursive: true })

  // katex.min.css references ./fonts/KaTeX_*.woff2 relatively, so the fonts
  // directory has to keep its name and position next to the stylesheet.
  await fs.copyFile(path.join(dist, "katex.min.css"), path.join(outDir, "katex.min.css"))
  await fs.copyFile(
    path.join(dist, "contrib", "copy-tex.min.js"),
    path.join(outDir, "copy-tex.min.js"),
  )

  // KaTeX ships ttf/woff/woff2 for every face; only woff2 is worth serving, and
  // dropping the rest cuts the copied payload by roughly three quarters.
  const fontsOut = path.join(outDir, "fonts")
  await fs.mkdir(fontsOut, { recursive: true })
  const fonts = (await fs.readdir(path.join(dist, "fonts"))).filter((f) => f.endsWith(".woff2"))
  for (const f of fonts) {
    await fs.copyFile(path.join(dist, "fonts", f), path.join(fontsOut, f))
  }
  return fonts.length
}

const [fontCount, katexFontCount] = await Promise.all([buildFonts(), buildKatex()])
console.log(`Polices : ${fontCount} fichiers woff2 + quartz-fonts.css`)
console.log(`KaTeX   : katex.min.css, copy-tex.min.js + ${katexFontCount} fichiers woff2`)
