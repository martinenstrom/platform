import { useEffect, useState } from 'react'
import type { DossierSection } from './sections'

/**
 * The band under the hero: the dossier's sections as a structural strip.
 * Part navigation — each label is a door to its section — and part
 * orientation: the section in view is underlined, so a reader always knows
 * where on the dossier they stand. It stays under the bar while the page
 * scrolls. Nothing heavy: one hairline above, one below, the labels.
 */
export function SectionBand({ sections }: { sections: readonly DossierSection[] }) {
  const active = useSectionInView(sections.map((section) => section.id))
  return (
    <nav aria-label="Avsnitt" className="dossier-band sticky top-[53px] z-20">
      {sections.map((section) => (
        <a
          key={section.id}
          href={`#${section.id}`}
          aria-current={active === section.id ? 'location' : undefined}
          className="dossier-band-link"
        >
          {section.label}
        </a>
      ))}
    </nav>
  )
}

/** The band's reading line, under the bar and the band itself. */
const READING_LINE = 132

/**
 * Which section stands at the reading line: the last one whose top has
 * passed it. Read on scroll, never on a timer; the first section until the
 * page has moved.
 */
function useSectionInView(ids: readonly string[]): string | undefined {
  const [active, setActive] = useState<string | undefined>(ids[0])
  useEffect(() => {
    let frame = 0
    const read = () => {
      frame = 0
      /*
       * The section whose top stands nearest the reading line from above.
       * Modules in one row share a top; among those the one the reader
       * asked for (the hash) wins, else the first in the dossier's order.
       */
      let best = Number.NEGATIVE_INFINITY
      const tops = new Map<string, number>()
      for (const id of ids) {
        const element = document.getElementById(id)
        if (!element) continue
        const top = element.getBoundingClientRect().top
        tops.set(id, top)
        if (top <= READING_LINE && top > best) best = top
      }
      const tied = ids.filter((id) => {
        const top = tops.get(id)
        return top !== undefined && Math.abs(top - best) <= 2
      })
      const asked = window.location.hash.slice(1)
      setActive(tied.includes(asked) ? asked : (tied[0] ?? ids[0]))
    }
    const onScroll = () => {
      if (frame === 0) frame = window.requestAnimationFrame(read)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (frame !== 0) window.cancelAnimationFrame(frame)
    }
  }, [ids.join('|')])
  return active
}
