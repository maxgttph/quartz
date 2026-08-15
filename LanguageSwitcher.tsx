import { joinSegments, pathToRoot, simplifySlug } from "./quartz/util/path"
import { classNames } from "./quartz/util/lang"
import type {
  QuartzComponent,
  QuartzComponentConstructor,
  QuartzComponentProps,
} from "./quartz/components/types"

export interface LanguageOption {
  /** Language tag, and the URL segment the language is served under. */
  code: string
  /** What the link says: "FR", "EN". */
  short: string
  /** What a screen reader (and the title tooltip) says: "Français". */
  name: string
}

interface Options {
  /** The language of *this* build. Must appear in `languages`. */
  current: string
  /** Every language the site is built in, in display order. */
  languages: LanguageOption[]
  /** Accessible name for the group of links, in the current language. */
  ariaLabel: string
  /**
   * Whether the other languages are actually reachable from here. False under
   * `npm run dev`, which mounts one language alone at the root; the switcher
   * then shows them greyed out with `unreachableHint` as its tooltip rather
   * than linking to a page the dev server cannot serve.
   */
  siblingsReachable: boolean
  /** Tooltip for a greyed-out language, in the current language. */
  unreachableHint: string
}

/**
 * Links the current page to its counterpart in the other languages.
 *
 * Each language is a separate Quartz build served under its own URL prefix
 * (`/fr/…`, `/en/…`), and the vault names a note's folder after its *English*
 * slug whatever the language of the file — so a page's slug is identical in
 * every language and the sibling URL is a pure prefix swap. That is why this
 * component needs no per-page translation table.
 *
 * Two exceptions:
 *
 *   - Tag pages. Tags are translated (`astronomie` / `astronomy`), so the slug
 *     is *not* stable across languages. They point at the other language's tag
 *     index instead of a page that would not exist.
 *   - The 404 page, which has no slug to swap. The layout gives it no
 *     `beforeBody` at all, so it never renders this component.
 *
 * Links are relative (`../../en/astronomy/solar-eclipses`) like every other
 * internal Quartz link, so the site keeps working whatever it is mounted under.
 */
export default ((opts: Options) => {
  const LanguageSwitcher: QuartzComponent = ({ fileData, displayClass }: QuartzComponentProps) => {
    const slug = fileData.slug
    if (!slug) return null

    const isTagPage = slug.startsWith("tags/") && slug !== "tags/index"
    const target = isTagPage ? "tags" : simplifySlug(slug)

    return (
      <nav class={classNames(displayClass, "lang-switcher")} aria-label={opts.ariaLabel}>
        {opts.languages.map((l) =>
          l.code === opts.current ? (
            <span key={l.code} class="lang-current" aria-current="true" title={l.name}>
              {l.short}
            </span>
          ) : !opts.siblingsReachable ? (
            <span key={l.code} class="lang-unreachable" title={opts.unreachableHint}>
              {l.short}
            </span>
          ) : (
            <a
              key={l.code}
              href={joinSegments(pathToRoot(slug), "..", l.code, target)}
              hrefLang={l.code}
              lang={l.code}
              title={l.name}
              // The other language is a separate build with its own script
              // bundle, search index and content index. Letting the SPA router
              // swap in its HTML would leave all three behind, so this link has
              // to be a real navigation.
              data-router-ignore=""
            >
              {l.short}
            </a>
          ),
        )}
      </nav>
    )
  }

  return LanguageSwitcher
}) satisfies QuartzComponentConstructor<Options>
