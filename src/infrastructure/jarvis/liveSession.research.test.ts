/**
 * The research tier inside the runtime: a public, current question is
 * answered by the research dependency before any model — typed, through a
 * simulated session's microphone, and through the voice's workspace tool —
 * the strip travels with the answer, the context carries on to the next
 * line, and the simulated model's refusal never stands where research
 * could answer.
 */

import { describe, expect, it } from 'vitest'
import { SYM_SP500 } from '~/domain/market'
import type { MarketBrief, MarketScope } from '~/application/jarvis/marketBrief'
import type { ResearchContext } from '~/application/jarvis/research/researchQuery'
import type { ResearchCard } from '~/presentation/jarvis/researchCard'
import {
  createLiveRuntime,
  type LiveConfig,
  type LiveProvider,
  type LiveSideband,
  type ResearchInput,
  type ResearchTurn,
  type ResponsesResult,
} from './liveSession'
import { SIMULATED_MODEL_SAY } from './simulatedLive'

const config: LiveConfig = {
  model: 'gpt-live-1',
  backendModel: 'gpt-5.6-luna',
  voices: ['marin'],
  defaultVoice: 'marin',
  idleSeconds: 30,
  marketContextSeconds: 180,
  maxSeconds: 600,
  prices: {
    voicePerMinuteUsd: 0.05,
    backendInputUsd: 0.2,
    backendCachedUsd: 0.02,
    backendOutputUsd: 1.2,
  },
}

const brief = (scope: MarketScope): MarketBrief => ({
  scope,
  generatedAt: '2026-10-02T15:00:00.000Z',
  indices: [],
  sectors: [],
  rates: [],
  curveSlopeBasisPoints: null,
  fx: [],
  commodities: [],
  riskAppetite: null,
  headlines: [],
  unavailable: [],
  notServed: [],
})

const card: ResearchCard = {
  label: 'JARVIS RESEARCH',
  sourceCount: 2,
  sourcesLabel: '2 källor',
  asOf: 'Data / nyheter t.o.m. 2 okt. 16:40',
  confidence: { code: 'STRONG_EVIDENCE', label: 'Starkt stöd' },
  sources: [],
  conflicts: [],
  unavailable: false,
  depth: 'quick',
}

const context = (topic: string): ResearchContext => ({
  topic,
  region: 'us',
  period: { kind: 'range', range: 'this-week' },
  instruments: [SYM_SP500],
  companies: [],
  institution: null,
  release: null,
  evidenceIds: ['e1', 'e2'],
  asOf: '2026-10-02T14:40:00.000Z',
})

/** A provider that opens nothing and, asked to reason, says the simulated sentence. */
function fakeProvider() {
  const responses: unknown[] = []
  let sideband: LiveSideband | null = null
  const provider: LiveProvider = {
    async createSession() {
      return { id: 'live-1', sdp: 'simulated' }
    },
    async attach() {
      let onClose: () => void = () => {}
      sideband = {
        send: () => {},
        onMessage: () => {},
        onClose: (handler) => (onClose = handler),
        close: () => onClose(),
      }
      return sideband
    },
    async respond(request): Promise<ResponsesResult> {
      responses.push(request)
      return {
        id: 'sim',
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: SIMULATED_MODEL_SAY }],
          },
        ],
      }
    },
  }
  return { provider, responses }
}

describe('the research tier in the runtime', () => {
  const researchCalls: ResearchInput[] = []
  const research = async (input: ResearchInput): Promise<ResearchTurn | null> => {
    researchCalls.push(input)
    if (!/varför|analytiker/i.test(input.text)) return null
    return {
      say: 'S&P 500 pressas av högre långräntor efter jobbrapporten.',
      spokenSay:
        'S&P 500 pressas av högre långräntor efter jobbrapporten. Underlag: två källor, främst Reuters.',
      card,
      context: context(input.research ? `${input.research.topic}+` : 'idx:sp500'),
      kind: 'MARKET_WHY',
      unavailable: false,
      evidenceCount: 2,
    }
  }
  const runtime = (provider: LiveProvider) =>
    createLiveRuntime({
      provider,
      host: async () => {
        throw new Error('the firm is never asked')
      },
      market: async (scope) => brief(scope),
      research,
      simulated: true,
      config,
      requestId: () => 'req-1',
    })

  it('a typed "varför?" is research before the model: the strip, the state, the context handed back', async () => {
    const { provider, responses } = fakeProvider()
    const rt = runtime(provider)
    researchCalls.length = 0
    const result = await rt.respond({
      text: 'Varför föll börsen i veckan?',
      context: { route: '/' },
      marketContext: {
        at: '2026-10-02T15:00:00.000Z',
        conversation: {
          symbols: [SYM_SP500],
          region: null,
          period: { kind: 'range', range: 'this-week' },
        },
      },
    })
    expect(result.state).toBe('research')
    expect(result.say).toBe('S&P 500 pressas av högre långräntor efter jobbrapporten.')
    expect(result.spokenSay).toContain('Underlag: två källor')
    expect(result.research).toEqual(card)
    expect(result.stages.tier).toBe('research')
    expect(result.stages.modelPasses).toBe(0)
    expect(result.marketContext?.research?.topic).toBe('idx:sp500')
    expect(result.marketContext?.conversation?.symbols).toEqual(['idx:sp500'])
    expect(responses).toHaveLength(0)
    /* The research dependency saw the market conversation and no research context yet. */
    expect(researchCalls[0]).toMatchObject({
      text: 'Varför föll börsen i veckan?',
      route: '/',
      research: null,
    })
    expect(researchCalls[0]!.market?.symbols).toEqual(['idx:sp500'])
  })

  it('the context handed back is handed on: the next line continues the research subject', async () => {
    const { provider } = fakeProvider()
    const rt = runtime(provider)
    const first = await rt.respond({
      text: 'Varför föll börsen?',
      context: { route: '/' },
    })
    researchCalls.length = 0
    const second = await rt.respond({
      text: 'Vad säger analytiker om nästa vecka?',
      context: { route: '/' },
      marketContext: first.marketContext,
    })
    expect(researchCalls[0]!.research?.topic).toBe('idx:sp500')
    expect(second.marketContext?.research?.topic).toBe('idx:sp500+')
  })

  it('a line that is not research goes on to the model, and a research line in a simulated session is never the refusal', async () => {
    const { provider, responses } = fakeProvider()
    const rt = runtime(provider)
    const model = await rt.respond({
      text: 'Vad är term premium?',
      context: { route: '/' },
    })
    expect(model.say).toBe(SIMULATED_MODEL_SAY)
    expect(responses).toHaveLength(1)
    await rt.open({ sdp: 'simulated', route: '/' })
    const heard = await rt.hear('live-1', 'Varför föll börsen?')
    expect(heard?.say).not.toBe(SIMULATED_MODEL_SAY)
    expect(heard?.say).toContain('Underlag: två källor')
    expect(heard?.research).toEqual(card)
    expect(rt.state('live-1')!.advisory.at(-1)?.research).toEqual(card)
    expect(responses).toHaveLength(1)
  })
})
