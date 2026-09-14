/**
 * Shared pieces of the voice bake-off: the environment, timing, text
 * normalisation, word error rate, term checks and a little markdown.
 *
 * Nothing here talks to a provider. Nothing here touches the product.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const HERE = dirname(fileURLToPath(import.meta.url))
export const RECORDINGS = join(HERE, 'recordings')
export const RESULTS = join(HERE, 'results')

/**
 * Reads `.env` at the repository root into `process.env` without a library.
 * Values already present in the environment win. Nothing is printed.
 */
export function loadEnv() {
  const file = join(HERE, '..', '..', '.env')
  if (!existsSync(file)) return
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
    if (!match) continue
    const [, key, raw] = match
    if (process.env[key] !== undefined) continue
    process.env[key] = raw.replace(/^["']|["']$/g, '')
  }
}

/** The credential boundary, stated once: which keys a provider needs and lacks. */
export function credentials(keys) {
  const missing = keys.filter((key) => !process.env[key])
  return { ok: missing.length === 0, missing }
}

export const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))

export function writeResult(name, content) {
  mkdirSync(RESULTS, { recursive: true })
  const path = join(RESULTS, name)
  writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content, null, 2))
  return path
}

export const now = () => performance.now()
export const ms = (from) => Math.round(performance.now() - from)

/* ------------------------------------------------------------- scoring */

/**
 * Lower-cases, unifies decimal commas and percent signs, and strips the
 * punctuation that carries no meaning — so "3,2 procent" and "3.2 %" agree
 * and "Nvidia," matches "nvidia". Punctuation inside a token (P/E, 3,2,
 * Nvidia's) is kept, because there it carries meaning.
 */
export function normalise(text) {
  return text
    .toLowerCase()
    .replace(/(\d)\.(\d)/g, '$1,$2')
    .replace(/\s*%/g, ' procent')
    .replace(/[–—]/g, '-')
    .replace(/[.,!?;:"“”‘’()]+(?=\s|$)/g, '')
    .replace(/(?<=\s|^)[.,!?;:"“”‘’()-]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Word error rate: Levenshtein distance over normalised words, divided by reference length. */
export function wer(reference, hypothesis) {
  const ref = normalise(reference).split(' ')
  const hyp = normalise(hypothesis).split(' ').filter(Boolean)
  const rows = ref.length + 1
  const cols = hyp.length + 1
  const d = Array.from({ length: rows }, (_, i) => {
    const row = new Array(cols).fill(0)
    row[0] = i
    return row
  })
  for (let j = 0; j < cols; j++) d[0][j] = j
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = ref[i - 1] === hyp[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
    }
  }
  return ref.length === 0 ? 0 : d[ref.length][hyp.length] / ref.length
}

/**
 * Which of the terms that matter survived. A term is present when any of
 * its accepted spellings appears in the normalised transcript as whole
 * words — "fed" does not hide inside "federal".
 */
export function termHits(terms, hypothesis) {
  const text = ` ${normalise(hypothesis)} `
  return terms.map(({ term, accept }) => ({
    term,
    hit: (accept ?? [term]).some((spelling) => text.includes(` ${normalise(spelling)} `)),
  }))
}

export const percent = (value) => `${(value * 100).toFixed(1)} %`
export const cell = (text) => String(text ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')

export function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  if (sorted.length === 0) return null
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2)
}
