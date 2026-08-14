import { loadQuartzConfig, loadQuartzLayout } from "./quartz/plugins/loader/config-loader"
import type { QuartzTransformerPluginInstance } from "./quartz/plugins/types"
import type { Root } from "mdast"

const config = await loadQuartzConfig()

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

// textTransform runs on raw source, so this must precede any parsing.
config.plugins.transformers.unshift(stripLeadingH1, unwrapKeyConceptDashes)
config.plugins.transformers.unshift(displayMathOnOwnLine)

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
 * The latex plugin hardcodes cdn.jsdelivr.net for katex.min.css and the
 * copy-tex helper. Its options expose no way to change that, so the resource
 * list is swapped after the fact. Root-relative paths resolve correctly both
 * under `--serve` and on the deployed domain.
 */
const latex = config.plugins.transformers.find((t) => t.name === "Latex")
if (!latex) {
  throw new Error("Plugin Latex introuvable — la redirection KaTeX vers /static/ est caduque.")
}
latex.externalResources = () => ({
  css: [{ content: "/static/katex/katex.min.css" }],
  js: [{ src: "/static/katex/copy-tex.min.js", loadTime: "afterDOMReady", contentType: "external" }],
})

export default config
export const layout = await loadQuartzLayout()
