import { h } from "preact"
import { loadQuartzConfig, loadQuartzLayout } from "./quartz/plugins/loader/config-loader"
import { componentRegistry } from "./quartz/components/registry"
import { PageTypeDispatcher } from "./quartz/plugins/pageTypes/dispatcher"
import type { QuartzTransformerPluginInstance } from "./quartz/plugins/types"
import type { ValidLocale } from "./quartz/i18n"
import type { Root } from "mdast"
import LanguageSwitcher, { type LanguageOption } from "./LanguageSwitcher"

/**
 * The vault holds every note in both languages (`<slug>.en.md`, `<slug>.fr.md`),
 * and the site is built once per language: `QUARTZ_LANG` picks which one.
 *
 * One build per language rather than one build for both, because almost
 * everything that makes a page feel localised is decided per *build* and not
 * per page — the interface strings and date formats behind `locale`, and the
 * search index, explorer tree, graph, RSS feed and sitemap, which are all
 * emitted once from the whole content tree. Splitting the build is what keeps
 * an English note from being served with French chrome and French search hits.
 *
 * Must match LANGS in scripts/sync.mjs.
 */
export const LANGUAGES: LanguageOption[] = [
  { code: "fr", short: "FR", name: "Français" },
  { code: "en", short: "EN", name: "English" },
]

const LOCALES: Record<string, ValidLocale> = { fr: "fr-FR", en: "en-GB" }
const SITE_TITLES: Record<string, string> = {
  fr: "Carnet d'apprentissage",
  en: "Learning Vault",
}
const HOME_LABELS: Record<string, string> = { fr: "Accueil", en: "Home" }
const SWITCHER_LABELS: Record<string, string> = { fr: "Choix de la langue", en: "Language" }
const SWITCHER_HINTS: Record<string, string> = {
  fr: "Les autres langues ne sont pas servies par `npm run dev` — utilisez `npm run preview`.",
  en: "Other languages are not served by `npm run dev` — use `npm run preview`.",
}

const lang = process.env.QUARTZ_LANG ?? LANGUAGES[0].code
if (!LANGUAGES.some((l) => l.code === lang)) {
  throw new Error(
    `QUARTZ_LANG="${lang}" inconnu — attendu : ${LANGUAGES.map((l) => l.code).join(", ")}.`,
  )
}

/**
 * URL prefix this build is served under, e.g. `/fr`. Empty during `--serve`,
 * where the dev server mounts a single language at the root.
 *
 * Quartz derives the same prefix from `baseUrl` for its own client-side
 * navigation (see `basePath` in quartz/components/renderPage.tsx); appending it
 * to baseUrl below keeps the two in step from a single source of truth.
 */
const basePath = process.env.QUARTZ_BASE_PATH ?? ""

/**
 * A build under a language prefix sits next to its siblings, so the switcher
 * can reach them. Without one, this build is alone at the root — the shape
 * `npm run dev` produces — and the switcher must not offer a link that would
 * only ever 404.
 */
const siblingsReachable = basePath !== ""

// Component options come from quartz.config.yaml, which has no way to vary by
// language. Overrides have to be registered before loadQuartzLayout() below
// instantiates the components.
componentRegistry.setOptionOverrides("@quartz-community/breadcrumbs", {
  rootName: HOME_LABELS[lang],
})

const config = await loadQuartzConfig()

config.configuration.locale = LOCALES[lang]
config.configuration.pageTitle = SITE_TITLES[lang]
config.configuration.baseUrl = (config.configuration.baseUrl ?? "") + basePath

/**
 * Every note in the vault opens with `# Title`, duplicating frontmatter `title`.
 * The article-title plugin already renders that title as the page <h1>, so the
 * body copy has to go — otherwise each page shows its title twice.
 *
 * article-title is kept (rather than dropping it in favour of the body H1)
 * because two notes have a frontmatter title that is more complete than their
 * H1: meteorology/nao-et-enso.md and
 * meteorology/circulation-atmospherique-generale.md.
 *
 * Runs first so heading-consuming plugins (table-of-contents) never see the H1
 * and the on-page outline starts cleanly at the `##` sections.
 */
const stripLeadingH1: QuartzTransformerPluginInstance = {
  name: "StripLeadingH1",
  markdownPlugins: () => [
    () => (tree: Root) => {
      const i = tree.children.findIndex((n) => n.type === "heading" && n.depth === 1)
      // Only strip a *leading* H1 — nothing but frontmatter may precede it.
      if (i !== -1 && tree.children.slice(0, i).every((n) => n.type === "yaml")) {
        tree.children.splice(i, 1)
      }
    },
  ],
}

/**
 * The vault writes display math on a single line (`$$ ... $$`), which is what
 * its CLAUDE.md prescribes and what Obsidian renders correctly.
 *
 * micromark only opens a *math flow* block when `$$` sits alone on its line;
 * a one-line `$$...$$` falls back to math *text*, so all 53 display equations
 * in the vault were rendering inline — sums and fractions cramped into
 * textstyle instead of centred display style.
 *
 * Normalising the source before parsing keeps the vault's own convention
 * intact. Only whole lines that are exactly one `$$...$$` are touched; inline
 * `$...$` and already-fenced blocks are left alone.
 */
const displayMathOnOwnLine: QuartzTransformerPluginInstance = {
  name: "DisplayMathOnOwnLine",
  textTransform: (_ctx, src) => src.replace(/^[ \t]*\$\$([^\n]+?)\$\$[ \t]*$/gm, "$$$$\n$1\n$$$$"),
}

/**
 * "Key concepts" bullets are written `- **Term** — definition.`
 *
 * The theme promotes the leading <strong> to its own line, which leaves the
 * em dash dangling at the start of the definition ("— le thermostat qui…").
 * The dash is a separator, and once the layout separates the two parts it has
 * no job left.
 *
 * Scoped to the list that directly follows the `## Key concepts` heading, so
 * the same `**Bold** — text` shape elsewhere in a note keeps its dash.
 */
const unwrapKeyConceptDashes: QuartzTransformerPluginInstance = {
  name: "UnwrapKeyConceptDashes",
  markdownPlugins: () => [
    () => (tree: Root) => {
      tree.children.forEach((node, i) => {
        const isKeyConcepts =
          node.type === "heading" &&
          node.depth === 2 &&
          node.children.length === 1 &&
          node.children[0].type === "text" &&
          node.children[0].value.trim() === "Key concepts"
        if (!isKeyConcepts) return

        const list = tree.children[i + 1]
        if (list?.type !== "list") return

        for (const item of list.children) {
          const para = item.children[0]
          if (para?.type !== "paragraph") continue
          const [term, sep] = para.children
          if (term?.type !== "strong" || sep?.type !== "text") continue
          sep.value = sep.value.replace(/^\s*—\s+/, "")
        }
      })
    },
  ],
}

/**
 * Vault wiki-links carry the target's language: `[[solar-eclipses.fr]]`, and
 * never cross languages (the vault's CLAUDE.md makes `translations:` the single
 * bridge). Each build only ever sees one language, and scripts/sync.mjs drops
 * the suffix from the filenames it links into content/, so the suffix in the
 * link text is redundant here — and left alone it would resolve to nothing.
 *
 * Stripping it in the source, rather than rewriting the vault, keeps Obsidian's
 * own link resolution working: it needs the suffix to tell the two files apart
 * inside a single note folder.
 */
const linkLanguageSuffix = new RegExp(
  // `[[<target>` … the target stops at the first `|`, `#` or `]`, and the pipe
  // may be backslash-escaped — Obsidian requires that inside a table cell.
  String.raw`(\[\[[^\[\]|#]+?)\.(?:${LANGUAGES.map((l) => l.code).join("|")})(?=\\?[|#\]])`,
  "g",
)

const stripLinkLanguageSuffix: QuartzTransformerPluginInstance = {
  name: "StripLinkLanguageSuffix",
  textTransform: (_ctx, src) => src.replace(linkLanguageSuffix, "$1"),
}

// textTransform runs on raw source, so this must precede any parsing.
config.plugins.transformers.unshift(stripLeadingH1, unwrapKeyConceptDashes)
config.plugins.transformers.unshift(displayMathOnOwnLine, stripLinkLanguageSuffix)

/**
 * The site is self-hosted, so it should not depend on third-party CDNs staying
 * up. scripts/assets.mjs copies the fonts and the KaTeX stylesheet into
 * quartz/static/; the two overrides below point the build at those copies.
 */

/**
 * `fontOrigin: selfHosted` in quartz.config.yaml gives us the right <link> tag,
 * but it also activates the plugin's FontsEmitter, which re-downloads the
 * families from Google at build time and rewrites their URLs to an absolute
 * https://<baseUrl>/… — breaking `--serve` and refusing to build until baseUrl
 * is set. scripts/assets.mjs already wrote that stylesheet, so the emitter has
 * nothing left to do.
 */
config.plugins.emitters = config.plugins.emitters.filter((e) => e.name !== "FontsEmitter")

/**
 * `/static/…` is relative to the *build* root, which is the language prefix
 * once deployed (`/fr/static/…`). Quartz builds its own asset URLs relative to
 * each page, but the two hardcoded paths below are ours to prefix.
 */
const asset = (p: string) => `${basePath}/static/${p}`

/**
 * The fonts plugin hardcodes `/static/fonts/quartz-fonts.css` in the <link> it
 * adds to <head>. Only that tag is replaced; the inline @font-face CSS it also
 * returns is what declares the families, and is kept as-is.
 */
const fonts = config.plugins.transformers.find((t) => t.name === "Fonts")
if (!fonts?.externalResources) {
  throw new Error("Plugin Fonts introuvable — le préfixe de langue sur /static/fonts/ est caduc.")
}
const fontResources = fonts.externalResources.bind(fonts)
fonts.externalResources = (ctx) => ({
  ...fontResources(ctx),
  additionalHead: [h("link", { rel: "stylesheet", href: asset("fonts/quartz-fonts.css") })],
})

/**
 * The latex plugin hardcodes cdn.jsdelivr.net for katex.min.css and the
 * copy-tex helper. Its options expose no way to change that, so the resource
 * list is swapped after the fact.
 */
const latex = config.plugins.transformers.find((t) => t.name === "Latex")
if (!latex) {
  throw new Error("Plugin Latex introuvable — la redirection KaTeX vers /static/ est caduque.")
}
latex.externalResources = () => ({
  css: [{ content: asset("katex/katex.min.css") }],
  js: [{ src: asset("katex/copy-tex.min.js"), loadTime: "afterDOMReady", contentType: "external" }],
})

/**
 * The language switcher rides at the top of the page header, on the breadcrumb
 * line (custom.scss pins it to the right). It is prepended by hand rather than
 * slotted in by priority because quartz.config.yaml's `layout` block can only
 * order components that come from plugins.
 *
 * Page types that deliberately empty their `beforeBody` — the 404 page — are
 * left empty: a page with no slug has no counterpart to link to.
 */
const pageLayout = await loadQuartzLayout()
const switcher = LanguageSwitcher({
  current: lang,
  languages: LANGUAGES,
  ariaLabel: SWITCHER_LABELS[lang],
  siblingsReachable,
  unreachableHint: SWITCHER_HINTS[lang],
})
for (const l of [pageLayout.defaults, ...Object.values(pageLayout.byPageType)]) {
  if (l.beforeBody?.length) l.beforeBody = [switcher, ...l.beforeBody]
}

/**
 * loadQuartzConfig() already built its own layout and handed it to the emitter
 * that renders every page, so editing the exported `layout` below would change
 * nothing. The emitter is rebuilt in place on top of the amended layout — in
 * place, so it keeps its position among the emitters.
 */
const dispatcher = config.plugins.emitters.findIndex((e) => e.name === "PageTypeDispatcher")
if (dispatcher === -1) {
  throw new Error("Émetteur PageTypeDispatcher introuvable — le sélecteur de langue est caduc.")
}
config.plugins.emitters[dispatcher] = PageTypeDispatcher({
  defaults: pageLayout.defaults,
  byPageType: pageLayout.byPageType,
})

export default config
export const layout = pageLayout
