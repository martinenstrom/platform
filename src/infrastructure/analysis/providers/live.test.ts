/**
 * The live provider, against a fake transport.
 *
 * Deterministic by construction: no credential, no network, no sampling. The
 * one real call is a smoke proof run by hand, deliberately outside this suite —
 * a test that depended on external availability, latency or a model's mood
 * would be measuring the provider's weather rather than the firm's code.
 */

import { describe, expect, it } from 'vitest'
import {
  buildEvidenceSet,
  observationRef,
  type EvidenceItem,
  type EvidenceSet,
} from '~/domain/analysis'
import { buildProvenance, type Quality } from '~/domain/shared/provenance'
import type { ContributionRequest } from '~/application/analysis/contributionPort'
import { NON_CONSUMING_BUDGET } from '~/domain/analysis'
import { createLiveContributionProvider, parseCandidates } from './live'
import { ContributionFailure } from '~/application/analysis/contributionPort'

const AT = '2026-08-16T09:00:00.000Z'

function item(subject: string, value: string, quality: Quality): EvidenceItem {
  return {
    ref: observationRef(
      {
        subjectKind: 'series',
        subject,
        kind: 'yield',
        observedAt: '2026-08-15T00:00:00.000Z',
        referencePeriod: '2026-08-15',
        sourceId: quality === 'fixture' ? 'fixture' : 'ecb',
      },
      { yieldPercent: value, changeBasisPoints: null, observationDate: '2026-08-15' },
    ),
    value: {
      yieldPercent: value,
      changeBasisPoints: null,
      observationDate: '2026-08-15',
    },
    provenance: buildProvenance({
      asOf: '2026-08-15T00:00:00.000Z',
      nowMs: Date.parse(AT),
      quality,
      source: {
        providerId: quality === 'fixture' ? 'fixture' : 'ecb',
        providerName: quality === 'fixture' ? 'Fixture' : 'ECB',
        trust: quality === 'fixture' ? 'synthetic' : 'central-bank',
      },
    }),
  }
}

const REAL = item('de10y', '2.41', 'official-daily')
const INVENTED = item('made-up', '1.11', 'fixture')

const realSet: EvidenceSet = buildEvidenceSet({
  items: [REAL],
  assembledAt: AT,
  correlationId: 'corr-1',
})
const fixtureSet: EvidenceSet = buildEvidenceSet({
  items: [INVENTED],
  assembledAt: AT,
  correlationId: 'corr-2',
})

/** A transport that answers with a canned body and records what it was sent. */
function fakeTransport(body: unknown, status = 200) {
  const calls: { url: string; init: RequestInit }[] = []
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as unknown as Response
  }) as unknown as typeof globalThis.fetch
  return { fetch, calls }
}

const answer = (
  claims: unknown,
  usage: unknown = { input_tokens: 120, output_tokens: 40 },
) => ({
  model: 'claude-opus-5-20260101',
  content: [{ type: 'text', text: JSON.stringify({ claims }) }],
  usage,
})

const ONE_CLAIM = [
  {
    type: 'observation',
    statement: 'The German 10y sits at 2.41%.',
    observationIds: [REAL.ref.id],
    status: 'supported',
    confidence: 'high',
  },
]

function providerFor(body: unknown, set: EvidenceSet = realSet, status = 200) {
  const transport = fakeTransport(body, status)
  const provider = createLiveContributionProvider({
    apiKey: 'test-key-not-a-real-credential',
    model: 'claude-opus-5',
    maxTokens: 1_024,
    fetch: transport.fetch,
    loadEvidenceSet: async () => set,
  })
  return { provider, transport }
}

const request = (over: Partial<ContributionRequest> = {}): ContributionRequest => ({
  caseId: 'case-1',
  assignmentId: 'a-1',
  departmentId: 'global-macro',
  employeeId: 'macro-analyst',
  brief: 'Where is the German 10y?',
  evidenceSetId: realSet.id,
  inputs: {},
  budget: NON_CONSUMING_BUDGET,
  signal: new AbortController().signal,
  ...over,
})

describe('what the model is asked for', () => {
  it('never asks it to produce a hash, an id or a citation', () => {
    // The firm's half of the contract. A model that cannot express a content
    // hash cannot forge one, which is why the split is at the prompt and not
    // at a validation rule downstream.
    const { provider, transport } = providerFor(answer(ONE_CLAIM))
    void provider.declare(request())
    return provider.contribute(request()).then(() => {
      const sent = JSON.parse(String(transport.calls[0]!.init.body))
      expect(sent.system).not.toMatch(/contentHash|evidenceRefs|claimId/)
      expect(sent.system).toMatch(/observationIds/)
      // The observation ids it may use are the ones it was given.
      expect(sent.messages[0].content).toContain(REAL.ref.id)
    })
  })

  it('declares the exact prompt and model before running', () => {
    const { provider } = providerFor(answer(ONE_CLAIM))
    const declaration = provider.declare(request())

    expect(declaration.identity.kind).toBe('model')
    if (declaration.identity.kind !== 'model') throw new Error('unreachable')
    expect(declaration.identity.model.provider).toBe('anthropic')
    expect(declaration.identity.prompt.contentHash).toMatch(/^[0-9a-f]+$/)
    expect(declaration.identity.model.parametersHash).toMatch(/^[0-9a-f]+$/)
  })

  it('records exactly the parameters the request carries, and no others', async () => {
    /*
     * The stored identity must describe the call that was SENT.
     *
     * This provider used to send `temperature` and record it in `ModelRef`.
     * The provider rejected the field outright — "`temperature` is deprecated
     * for this model" (HTTP 400) — so it was removed from the body. Removing
     * it from the body alone would have left `parametersHash` as the content
     * address of a request that never existed, which is the one thing hashing
     * the parameters is there to prevent.
     *
     * So this asserts BOTH directions against the same call: every recorded
     * parameter appears in the wire body, and the body carries no shaping
     * parameter the record omits.
     */
    const { provider, transport } = providerFor(answer(ONE_CLAIM))
    const declaration = provider.declare(request())
    await provider.contribute(request())

    if (declaration.identity.kind !== 'model') throw new Error('unreachable')
    const recorded = declaration.identity.model.parameters
    const sent = JSON.parse(String(transport.calls[0]!.init.body)) as Record<
      string,
      unknown
    >

    // Recorded → sent. `maxTokens` is the wire's `max_tokens`.
    expect(recorded).toEqual({ maxTokens: 1_024 })
    expect(sent.max_tokens).toBe(1_024)

    // Sent → recorded. No sampling parameter is present in either place.
    for (const rejected of ['temperature', 'top_p', 'top_k']) {
      expect(sent).not.toHaveProperty(rejected)
      expect(recorded).not.toHaveProperty(rejected)
    }
  })

  it('hashes a different brief differently', () => {
    // The prompt is content-addressed, so "which exact instruction produced
    // this claim" survives a brief that varies per entry.
    const { provider } = providerFor(answer(ONE_CLAIM))
    const a = provider.declare(request({ brief: 'one' }))
    const b = provider.declare(request({ brief: 'two' }))
    if (a.identity.kind !== 'model' || b.identity.kind !== 'model') {
      throw new Error('unreachable')
    }
    expect(a.identity.prompt.contentHash).not.toBe(b.identity.prompt.contentHash)
  })
})

describe('turning candidate output into claims', () => {
  it('builds the citation itself rather than trusting the model', async () => {
    const { provider } = providerFor(answer(ONE_CLAIM))
    const result = await provider.contribute(request())

    expect(result.claims).toHaveLength(1)
    const [claim] = result.claims
    expect(claim!.evidenceRefs).toHaveLength(1)
    // The hash came from the evidence set, not from anything the model said.
    expect(claim!.evidenceRefs[0]!.setId).toBe(realSet.id)
    expect(claim!.evidenceRefs[0]!.contentHash).toBe(REAL.ref.contentHash)
  })

  it('refuses a citation of evidence the run was never given', async () => {
    /*
     * The hallucination case. `citeFrom` would throw; this names it instead,
     * and names it `malformed-output` — which the pipeline retries, because a
     * sampled producer may well cite correctly on the next attempt.
     */
    const { provider } = providerFor(
      answer([{ ...ONE_CLAIM[0], observationIds: ['obs-that-does-not-exist'] }]),
    )
    await expect(provider.contribute(request())).rejects.toMatchObject({
      category: 'malformed-output',
    })
  })

  it('reports tokens measured with the cost unreported', async () => {
    // The truthful combination migration 0029 exists to make sayable.
    const { provider } = providerFor(answer(ONE_CLAIM))
    const result = await provider.contribute(request())

    expect(result.usage).toEqual({
      state: 'measured',
      inputTokens: 120,
      outputTokens: 40,
      cost: { state: 'not-reported' },
    })
  })

  it('reports nothing at all when the provider reported no usage', async () => {
    const { provider } = providerFor(answer(ONE_CLAIM, null))
    const result = await provider.contribute(request())
    expect(result.usage).toEqual({ state: 'not-reported' })
  })

  it('reports only progress, never an outcome the firm has not granted', async () => {
    const { provider } = providerFor(answer(ONE_CLAIM))
    const result = await provider.contribute(request())
    expect(result.observedStates).toEqual(['running'])
  })
})

describe('confidence is a proposal the firm may lower', () => {
  it('keeps the proposal when no derivable cap applies, and says so', async () => {
    const { provider } = providerFor(answer(ONE_CLAIM))
    const [claim] = (await provider.contribute(request())).claims

    expect(claim!.confidence.level).toBe('high')
    // It must not read as though the firm corroborated the level.
    expect(claim!.confidence.basis.join(' ')).toMatch(/proposed by the model/)
    expect(claim!.confidence.basis.join(' ')).toMatch(/not independently corroborated/)
  })

  it('caps a claim resting on invented evidence, whatever the model proposed', async () => {
    /*
     * The model says `high`; the evidence is fixture-backed. The firm can
     * derive this one, so it wins — and `validateContribution` refuses an
     * uncapped fixture-backed claim downstream regardless.
     */
    const { provider } = providerFor(
      answer([
        { ...ONE_CLAIM[0], observationIds: [INVENTED.ref.id], confidence: 'high' },
      ]),
      fixtureSet,
    )
    const [claim] = (await provider.contribute(request({ evidenceSetId: fixtureSet.id })))
      .claims

    expect(claim!.confidence.level).toBe('insufficient')
    expect(claim!.confidence.cappedBy).toBe('fixture-evidence')
  })

  it('never raises a proposal above what the firm can justify', async () => {
    // A claim citing nothing cannot be `high` however sure the model is.
    const { provider } = providerFor(
      answer([
        {
          type: 'observation',
          statement: 'Rates will be fine.',
          observationIds: [],
          status: 'insufficient-evidence',
          confidence: 'high',
        },
      ]),
    )
    const [claim] = (await provider.contribute(request())).claims
    expect(claim!.confidence.level).toBe('insufficient')
    expect(claim!.confidence.cappedBy).toBe('no-evidence')
  })
})

describe('failures are bounded categories, never provider prose', () => {
  it.each([
    [429, 'provider-unavailable'],
    [500, 'provider-unavailable'],
    [401, 'provider-unavailable'],
    [400, 'provider-error'],
  ])('maps HTTP %i onto %s', async (status, category) => {
    const { provider } = providerFor(answer(ONE_CLAIM), realSet, status)
    await expect(provider.contribute(request())).rejects.toMatchObject({ category })
  })

  it('treats unparseable output as malformed, which is retryable', async () => {
    const { provider } = providerFor({
      model: 'claude-opus-5',
      content: [{ type: 'text', text: 'I think rates are going up!' }],
      usage: null,
    })
    await expect(provider.contribute(request())).rejects.toBeInstanceOf(
      ContributionFailure,
    )
    await expect(provider.contribute(request())).rejects.toMatchObject({
      category: 'malformed-output',
    })
  })

  it('reports missing evidence as its own category', async () => {
    const transport = fakeTransport(answer(ONE_CLAIM))
    const provider = createLiveContributionProvider({
      apiKey: 'test-key-not-a-real-credential',
      model: 'claude-opus-5',
      maxTokens: 1_024,
      fetch: transport.fetch,
      loadEvidenceSet: async () => null,
    })
    await expect(provider.contribute(request())).rejects.toMatchObject({
      category: 'evidence-unavailable',
    })
    // It never reached the model, so nothing was spent.
    expect(transport.calls).toHaveLength(0)
  })
})

describe('parsing refuses anything it cannot vouch for', () => {
  it.each([
    ['not JSON at all', 'hello'],
    ['no claims key', '{"other":[]}'],
    ['an empty set of claims', '{"claims":[]}'],
    [
      'an unknown claim type',
      '{"claims":[{"type":"vibe","statement":"x","observationIds":[],"status":"supported","confidence":"high"}]}',
    ],
    [
      'an unknown confidence level',
      '{"claims":[{"type":"observation","statement":"x","observationIds":[],"status":"supported","confidence":"certain"}]}',
    ],
    [
      'a missing statement',
      '{"claims":[{"type":"observation","observationIds":[],"status":"supported","confidence":"high"}]}',
    ],
  ])('refuses %s', (_label, text) => {
    expect(parseCandidates(text)).toBeNull()
  })

  it('accepts the shape the prompt asks for', () => {
    const parsed = parseCandidates(JSON.stringify({ claims: ONE_CLAIM }))
    expect(parsed).toHaveLength(1)
    expect(parsed![0]!.statement).toBe('The German 10y sits at 2.41%.')
  })
})
