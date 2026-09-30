/**
 * A client's portrait, where the presentation has one — and the monogram
 * where it has not.
 *
 * Deliberately not a field on the client record: a portrait is presentation,
 * a photograph of a real client is governed data, and Client 360 must work
 * without either. Synthetic clients carry none in V1, so every dossier
 * opens on the monogram; a deployment that is allowed to show approved
 * portraits maps them here and nothing else changes.
 */

const PORTRAITS: Readonly<Record<string, string>> = Object.freeze({})

/** The portrait URL for a client id, or null when there is none. */
export function portraitUrlOf(clientId: string): string | null {
  return PORTRAITS[clientId] ?? null
}

/**
 * "MB" from "Margareta Berglund"; "AD" from "Anna & Per Dahlqvist" (the
 * first and the last word, an ampersand and a lone initial ignored).
 */
export function initialsOf(displayName: string): string {
  const words = displayName
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}]/gu, ''))
    .filter((w) => w.length > 0)
  if (words.length === 0) return '—'
  const first = words[0]!
  const last = words.length > 1 ? words[words.length - 1]! : ''
  return `${first[0]}${last ? last[0] : ''}`.toUpperCase()
}
