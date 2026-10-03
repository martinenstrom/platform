/**
 * The evening plate behind an office's tile — a photograph of the street
 * at night, where the presentation has one. Presentation only: an office
 * without a plate stands on the tile's own navy, and nothing else changes.
 */

const PLATES: Readonly<Record<string, string>> = Object.freeze({
  'of-strandvagen': '/data/offices/strandvagen.jpg',
  'of-arbetargatan': '/data/offices/arbetargatan.jpg',
  'of-avenyn': '/data/offices/avenyn.jpg',
})

/** The plate URL for an office id, or null when there is none. */
export function officePlateUrlOf(officeId: string): string | null {
  return PLATES[officeId] ?? null
}
