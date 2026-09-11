/**
 * Identity has exactly one home.
 *
 * The personas are the firm's permanent colleagues: the same face and the same
 * name represent the same desk on Huvudkontoret, in the activity feed, on a
 * case, on a run and on every surface built later. That only holds while there
 * is one place to change them.
 *
 * So this reads the source of every module that renders an agent and asserts
 * that none of them contains a persona's name or a portrait path of its own.
 * A component that hard-codes "Anders Wikström" keeps working perfectly and
 * silently disagrees with the roster the moment the roster moves — which is the
 * failure that produced this suite.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AGENT_PERSONAS, CIO_PERSONA } from '~/presentation/analysis/agentPersona'

const CANONICAL = 'src/presentation/analysis/agentPersona.ts'
const ROOT = process.cwd()

/** Every source file in the product, excluding the canonical table itself. */
function sources(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      sources(full, found)
      continue
    }
    if (!/\.(ts|tsx)$/.test(entry)) continue
    const rel = relative(ROOT, full).replace(/\\/g, '/')
    if (rel === CANONICAL) continue
    /* The persona suite names identities on purpose, to assert them. */
    if (rel === 'src/presentation/analysis/agentPersona.test.ts') continue
    if (rel === 'src/test/fitness/personaIdentity.test.ts') continue
    found.push(rel)
  }
  return found
}

const FILES = sources(join(ROOT, 'src'))
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

describe('a persona has one home', () => {
  it('finds no persona name written anywhere but the canonical table', () => {
    const names = Object.values(AGENT_PERSONAS).map((persona) => persona.displayName)
    const offenders: string[] = []

    for (const file of FILES) {
      const source = read(file)
      for (const name of names) {
        if (source.includes(name)) offenders.push(`${file} → ${name}`)
      }
    }

    expect(offenders).toEqual([])
  })

  it('finds no portrait path written anywhere but the canonical table', () => {
    const offenders = FILES.filter((file) => read(file).includes('/data/personas/'))
    expect(offenders).toEqual([])
  })
})

describe('the CIO is one identity', () => {
  it('is the executive department, resolved and not restated', () => {
    expect(CIO_PERSONA).toBe(AGENT_PERSONAS.executive)
    expect(CIO_PERSONA.departmentId).toBe('executive')
  })

  it('renders on both CIO surfaces from that identity alone', () => {
    /*
     * The chief appears twice on Huvudkontoret — in the rail and at the
     * convergence of the network. Two surfaces showing the same person is a
     * design decision; two surfaces *stating* the same person would be a
     * duplication waiting to disagree. Both must read the persona.
     */
    const surfaces = [
      'src/components/commandCenter/CommandCenter.tsx',
      'src/components/commandCenter/AgentNetwork.tsx',
    ]
    for (const surface of surfaces) {
      const source = read(surface)
      expect(source, surface).toMatch(/CIO_PERSONA/)
      expect(source, surface).not.toContain(CIO_PERSONA.displayName)
      expect(source, surface).not.toContain(CIO_PERSONA.roleTitle)
    }
  })
})

describe('a persona carries no institutional state', () => {
  it('declares no field that could report activity or output', () => {
    /*
     * Guarded on the shape rather than on the words: a persona gains a
     * `status` or a `conviction` by someone adding a field, and the addition
     * is what has to fail. What an agent is doing is a fact in the read
     * models, and an identity that could shadow it would be the fabrication
     * this product exists to prevent.
     */
    const allowed = [
      'departmentId',
      'displayName',
      'roleTitle',
      'monogram',
      'portrait',
      'character',
    ].sort()
    for (const persona of Object.values(AGENT_PERSONAS)) {
      expect(Object.keys(persona).sort()).toEqual(allowed)
    }
  })

  it('never describes an identity as active, working or producing', () => {
    const forbidden =
      /\b(active|aktiv|live|running|kör|working|arbetar|processing|busy|online|status)\b/i
    for (const persona of Object.values(AGENT_PERSONAS)) {
      expect(persona.character, persona.departmentId).not.toMatch(forbidden)
      expect(persona.roleTitle, persona.departmentId).not.toMatch(forbidden)
    }
  })
})
