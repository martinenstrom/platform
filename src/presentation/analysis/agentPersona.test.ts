/**
 * The persona registry.
 *
 * Two properties, and the second is the one that keeps the product honest.
 *
 * **Identity is stable.** A persona that changed between two screens would be a
 * different colleague on each, and the recognition the personas exist to build
 * would never form.
 *
 * **A persona carries no institutional state.** The face is presentation — a
 * representation of an agent, never a claim that a human performed anything.
 * Whether a desk is working, what it produced and whether anyone accepted it
 * are facts, they live in the read models, and nothing in this table may
 * shadow them. A persona that could say "active" would be the exact
 * fabrication the reference's agent cards commit.
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  AGENT_PERSONAS,
  CIO_PERSONA,
  PERSONA_ART_DIRECTION,
  personaFor,
  personaPortrait,
} from './agentPersona'

const personas = Object.values(AGENT_PERSONAS)

describe('a persona is an identity, and only an identity', () => {
  it('carries no status, activity or output field', () => {
    /*
     * Asserted structurally rather than by review. Adding `isActive` or
     * `lastSeen` to this table would put institutional state somewhere nothing
     * verifies it, and the next person to do it should fail here.
     */
    const allowed = [
      'departmentId',
      'displayName',
      'roleTitle',
      'monogram',
      'portrait',
      'character',
    ].sort()

    for (const persona of personas) {
      expect(Object.keys(persona).sort()).toEqual(allowed)
    }
  })

  it('never describes a persona as active, working or producing', () => {
    const forbidden = /\b(aktiv|active|online|arbetar|working|running|live)\b/i
    for (const persona of personas) {
      expect(persona.displayName).not.toMatch(forbidden)
      expect(persona.roleTitle).not.toMatch(forbidden)
      expect(persona.character).not.toMatch(forbidden)
    }
  })
})

describe('identity is stable by construction', () => {
  it('returns the same persona for the same department, every time', () => {
    expect(personaFor('global-macro')).toBe(personaFor('global-macro'))
    expect(personaFor('global-macro')?.displayName).toBe(
      AGENT_PERSONAS['global-macro']!.displayName,
    )
  })

  it('keys every persona to the department it represents', () => {
    for (const [departmentId, persona] of Object.entries(AGENT_PERSONAS)) {
      expect(persona.departmentId).toBe(departmentId)
      expect(persona.portrait).toBe(`/data/personas/${departmentId}.jpg`)
    }
  })

  it('refuses to invent a persona for a department it does not know', () => {
    /*
     * `null`, not a generated stand-in. A department with no persona is a gap
     * in the presentation table, and filling it silently would hide the gap
     * exactly where somebody should notice it.
     */
    expect(personaFor('no-such-department')).toBeNull()
  })

  it('gives every persona a distinct face, name and monogram', () => {
    expect(new Set(personas.map((p) => p.displayName)).size).toBe(personas.length)
    expect(new Set(personas.map((p) => p.portrait)).size).toBe(personas.length)
    expect(new Set(personas.map((p) => p.monogram)).size).toBe(personas.length)
  })

  it('derives the portrait from the department rather than repeating it', () => {
    /*
     * The one mapping that must not be typed twice. A hand-written portrait
     * path is how a renamed department keeps a face that no longer belongs to
     * it — so the path is a function of the id, and this asserts it stays one.
     */
    for (const persona of personas) {
      expect(persona.portrait).toBe(`/data/personas/${persona.departmentId}.jpg`)
    }
  })
})

describe('the firm is one firm', () => {
  /**
   * The seeded organisation, as the database holds it.
   *
   * Written out rather than read from the database so this suite stays a unit
   * test — but it is the full roster, not a sample, because the drift this
   * table exists to prevent is exactly the kind that hides on a desk nobody has
   * looked at yet. A department seeded without a persona must fail here, on the
   * day it is seeded.
   */
  const SEEDED_DEPARTMENTS = [
    'behavioural-finance',
    'compliance',
    'devils-advocate',
    'editorial',
    'equity-research',
    'executive',
    'flow-positioning',
    'global-macro',
    'market-intelligence-office',
    'news-intelligence',
    'portfolio-strategy',
    'quant-technical',
    'research-office',
    'risk',
    'verification',
  ] as const

  it('resolves every seeded department to exactly one persona', () => {
    for (const departmentId of SEEDED_DEPARTMENTS) {
      const persona = personaFor(departmentId)
      expect(persona, departmentId).not.toBeNull()
      expect(persona!.departmentId).toBe(departmentId)
    }
  })

  it('registers a persona for no department the firm has not seeded', () => {
    /*
     * The reverse direction, and it matters as much: a persona for a department
     * that does not exist is an identity nothing can ever resolve, and it would
     * sit in the table looking like coverage.
     */
    expect(Object.keys(AGENT_PERSONAS).sort()).toEqual([...SEEDED_DEPARTMENTS].sort())
  })

  it('holds one persona per department and one department per persona', () => {
    const ids = personas.map((persona) => persona.departmentId)
    expect(new Set(ids).size).toBe(personas.length)
    for (const [key, persona] of Object.entries(AGENT_PERSONAS)) {
      /* The key IS the identity. A table keyed one way and built another is
         how a rename leaves a stale mapping behind. */
      expect(persona.departmentId).toBe(key)
    }
  })

  it('resolves the same identity every time, for every department', () => {
    for (const departmentId of SEEDED_DEPARTMENTS) {
      const first = personaFor(departmentId)
      const second = personaFor(departmentId)
      expect(second).toBe(first)
      expect(second).toEqual(first)
    }
  })

  it('makes the CIO the executive persona, not a separate one', () => {
    expect(CIO_PERSONA).toBe(AGENT_PERSONAS.executive)
    expect(CIO_PERSONA.roleTitle).toBe('Chief Investment Officer')
  })

  it('records the art direction beside the identities it governs', () => {
    /*
     * Portraits produced without a shared brief is how a set of professionals
     * stops looking like one firm. The brief lives in the code that consumes
     * the assets so it cannot drift from them.
     */
    expect(PERSONA_ART_DIRECTION.length).toBeGreaterThan(4)
    expect(PERSONA_ART_DIRECTION.join(' ')).toMatch(/no cartoon or avatar/i)
  })
})

describe('a portrait is claimed only where a file exists', () => {
  /*
   * The one way this table can put a broken image on the firm's own floor is by
   * naming an identity whose file is absent. Asserted against the filesystem
   * rather than reviewed: `public/` is served verbatim by Vite, so a path that
   * resolves here resolves in the browser.
   */
  const publicPath = (portrait: string) => join(process.cwd(), 'public', portrait)

  it('resolves every claimed portrait to a real file', () => {
    const claimed = Object.values(AGENT_PERSONAS)
      .map((persona) => personaPortrait(persona))
      .filter((portrait): portrait is string => portrait !== null)

    expect(claimed.length).toBeGreaterThan(0)
    for (const portrait of claimed) {
      expect(existsSync(publicPath(portrait)), `missing ${portrait}`).toBe(true)
    }
  })

  it('falls back to a monogram rather than a missing file', () => {
    /*
     * An identity the firm has not photographed returns `null`, and the plate
     * renders its monogram. Returning the path anyway would be a 404 wearing a
     * portrait's geometry.
     */
    const unphotographed = Object.values(AGENT_PERSONAS).filter(
      (persona) => personaPortrait(persona) === null,
    )
    for (const persona of unphotographed) {
      expect(existsSync(publicPath(persona.portrait))).toBe(false)
    }
  })

  it('photographs the CIO, who heads the floor', () => {
    expect(personaPortrait(CIO_PERSONA)).toBe('/data/personas/executive.jpg')
  })
})
