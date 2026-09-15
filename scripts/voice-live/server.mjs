/**
 * The GPT-Live proof server: the only place the OpenAI key exists.
 *
 * The browser (live.html) owns the microphone and the speaker on a WebRTC
 * media track. This server (a) turns the browser's SDP offer into a live
 * session by calling POST /v1/live/sessions with the server-side key, (b)
 * attaches a sideband WebSocket to that session with the same key, and
 * from there executes every backend function call — the JARVIS delegation
 * boundary — and reads usage, (c) serves a typed-text path through the
 * same tools when there is no live session, and (d) keeps telemetry with
 * counts and costs and never a word of the conversation.
 *
 * Architecture under test (the ruling's):
 *
 *   user ⇄ gpt-live-1 (audio, turn-taking, interruption)
 *              ⇅ Responses delegation
 *          backend model (deeper JARVIS reasoning)
 *              ⇅ function tools, executed HERE
 *          JARVIS delegation stub → a real reference, never a fake result
 *
 * The stub creates durable references and never completes them by itself:
 * "Jag kollar på det och återkommer" is allowed only once a reference
 * exists, and a status check answers "still working" for as long as that is
 * true. Nothing here is Financial OS and nothing here decides anything
 * institutional.
 *
 *   node scripts/voice-live/server.mjs        → http://localhost:4175/
 *
 * Needs OPENAI_API_KEY (server-side, from .env). Optional: LIVE_VOICE,
 * LIVE_BACKEND_MODEL (default gpt-5.6-luna), LIVE_PRICE_PER_MINUTE (0.05),
 * LIVE_PORT (4175).
 */

import { createServer } from 'node:http'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnv } from '../voice-bakeoff/lib.mjs'

loadEnv()

const HERE = dirname(fileURLToPath(import.meta.url))
const RESULTS = join(HERE, 'results')
mkdirSync(RESULTS, { recursive: true })

const KEY = process.env.OPENAI_API_KEY
if (!KEY) {
  console.error('OPENAI_API_KEY is not set. This is the credential boundary; nothing starts.')
  process.exit(3)
}

export const CONFIG = {
  model: process.env.LIVE_MODEL ?? 'gpt-live-1',
  backendModel: process.env.LIVE_BACKEND_MODEL ?? 'gpt-5.6-luna',
  /* Measured 2026-09-15: the ten names the API accepts for gpt-live-1; `sol` exists but is gated. */
  voices: ['marin', 'cedar', 'alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse'],
  defaultVoice: process.env.LIVE_VOICE ?? 'marin',
  prices: {
    voicePerMinute: Number(process.env.LIVE_PRICE_PER_MINUTE ?? 0.05),
    /* USD per 1M tokens, from the pricing page on 2026-09-15. */
    backend: {
      'gpt-5.6-luna': { input: 0.2, cached: 0.02, output: 1.2 },
      'gpt-5.6-terra': { input: 2.0, cached: 0.2, output: 12.0 },
    },
  },
  port: Number(process.env.LIVE_PORT ?? 4175),
  /*
   * `store: true` would keep a recording at OpenAI (30 days). Measured
   * 2026-09-15: this project refuses it — "Stored sessions require a
   * project that permits data persistence" — which is the retention
   * posture the ruling wants. Left as an option, off; the listening set
   * is captured in the browser instead (live.html?record=1 → /audio).
   */
  store: process.env.LIVE_STORE === '1',
  /*
   * How the voice may acknowledge a handoff. `natural`: as written for the
   * first runs. `strict`: measured on 2026-09-15 that the voice said "Jag
   * kollar på det och återkommer" ~1.8 s BEFORE the backend had created the
   * reference; strict makes the handoff phrase neutral and reserves the
   * ruling's sentence for the tool's confirmation.
   */
  ackMode: process.env.LIVE_ACK_MODE ?? 'natural',
}

/* ---------------------------------------------------------- instructions */

const VOICE_INSTRUCTIONS = `Du är JARVIS, en personlig investeringsintelligens i ett institutionellt kommandocenter. Du talar svenska som förstaspråk.
Språk: svenska in → svenska ut. Engelska in → engelska. Blandat → svenska, med engelska namn och finanstermer oförändrade och naturligt uttalade: Nvidia, Fed, ECB, CPI, Treasury, duration, yield curve, equity risk premium, earnings yield, term premium, higher for longer.
Karaktär: lugn, intelligent, självsäker, varm men återhållsam, mänsklig, närvarande, lite levande. Inte teatralisk, inte radioröst, inte kundtjänst, ingen överdriven entusiasm, aldrig mångordig. Korta svar på enkla frågor.
Svara själv, direkt, på enkla frågor, definitioner, uppföljningar och småprat.
Delegera till backend när frågan kräver djupare resonemang, och ALLTID när det är en investeringsbedömning: köpa, sälja, minska, öka, en position, ett bolag eller en fond givet makro. Sådant avgörs av investeringskommittén i Financial OS, aldrig av dig.
${
  CONFIG.ackMode === 'strict'
    ? `När du lämnar över till backend: säg högst "Ett ögonblick." eller ingenting, och vänta. Säg ALDRIG själv "Jag kollar på det och återkommer" — den meningen får bara komma från backend, som säger den när ett ärende faktiskt skapats hos kommittén; då förmedlar du den en gång. Svarar backend självt på frågan finns inget ärende, och då säger du inte att du återkommer.`
    : `Säg "Jag kollar på det och återkommer." ENDAST när backend bekräftat att ett ärende faktiskt skapats. Påstå aldrig att kommittén är klar eller vad den kom fram till förrän ett resultat faktiskt finns. Gick något inte, säg det rakt.`
}
Påstå aldrig att kommittén är klar eller vad den kom fram till förrän ett resultat faktiskt finns.
Fortsätter användaren tala medan ett ärende pågår, till exempel "ta hänsyn till dollarn också", ska det läggas till i det pågående ärendet via backend; bekräfta kort, en gång.
Tala alltid samtalets språk: det backend ber dig förmedla säger du på det språk användaren just använde, översatt om det behövs.
Läs aldrig upp tekniska id:n, referenser eller verktygsnamn.`

const BACKEND_INSTRUCTIONS = `Du är JARVIS resonerande lager bakom rösten. Du får samtalets kontext från röstlagret. Svara alltid på svenska med engelska finanstermer oförändrade, i kort talat format: inga listor, inga id:n.
Regler:
1. Investeringsbedömningar (köp/sälj/minska/öka, positioner, bolag eller fond givet makro) delegeras ALLTID med delegate_to_financial_os. Ge aldrig en egen slutsats om sådant.
2. Följdfrågor eller tillägg om ett pågående ärende: add_to_delegation. Frågor om läget: check_delegation.
3. Allmänna finansfrågor (vad är term premium, hur påverkar duration en obligation) besvarar du själv, kort och korrekt.
4. Verktygssvar innehåller fältet "say" med en svensk och en engelsk version: förmedla den som matchar språket användaren just talade, gärna med egna ord, men hitta aldrig på ett resultat som verktyget inte gav.
5. Svarar du själv (regel 3) så svarar du på användarens språk och säger inte att du återkommer.`

const TOOLS = [
  {
    type: 'function',
    name: 'delegate_to_financial_os',
    description:
      'Skapar ett ärende hos investeringskommittén (Financial OS) för en investeringsbedömning. Returnerar en referens och läget "working". Använd för köp/sälj/minska/öka, positioner, bolag eller fonder givet makro.',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'Frågan som ställdes, på användarens språk.' },
        subject: { type: 'string', description: 'Vad frågan gäller: bolag, fond, tillgång eller tema.' },
      },
      required: ['question', 'subject'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'add_to_delegation',
    description: 'Lägger till ett hänsynstagande eller en följdinstruktion i det pågående ärendet, t.ex. "ta hänsyn till dollarn också".',
    parameters: {
      type: 'object',
      properties: {
        note: { type: 'string', description: 'Vad som ska tas med.' },
        reference_id: { type: 'string', description: 'Ärendets referens om känd; annars det senaste pågående.' },
      },
      required: ['note'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'check_delegation',
    description: 'Läser läget för ett pågående ärende hos investeringskommittén. Returnerar sanningsenligt läge; ett ärende är klart först när ett resultat faktiskt finns.',
    parameters: {
      type: 'object',
      properties: { reference_id: { type: 'string', description: 'Ärendets referens om känd; annars det senaste.' } },
      required: [],
      additionalProperties: false,
    },
  },
]

/* --------------------------------------------------- the delegation stub */

/**
 * A safe stand-in for the Financial OS host gateway. It creates real
 * references with real timestamps and remembers what was added to them.
 * It never completes anything: no result exists until a real institution
 * produces one, and the stub is not one.
 */
class DelegationStub {
  constructor() {
    this.delegations = []
  }
  latest() {
    return [...this.delegations].reverse().find((d) => d.state === 'working') ?? null
  }
  find(id) {
    return (id && this.delegations.find((d) => d.reference.id === id)) || this.latest()
  }
  call(name, args) {
    switch (name) {
      case 'delegate_to_financial_os': {
        const delegation = {
          reference: { system: 'financial-os', kind: 'case', id: `ref-${Date.now().toString(36)}` },
          question: String(args.question ?? ''),
          subject: String(args.subject ?? ''),
          state: 'working',
          createdAt: new Date().toISOString(),
          notes: [],
        }
        this.delegations.push(delegation)
        return {
          ok: true,
          state: 'working',
          reference: delegation.reference,
          say: { sv: 'Jag kollar på det och återkommer.', en: "I'll look into it and get back to you." },
          rule: 'Ett ärende finns nu. Säg exakt att du kollar på det och återkommer, en gång; påstå inget om resultatet.',
        }
      }
      case 'add_to_delegation': {
        const delegation = this.find(args.reference_id)
        if (!delegation) return { ok: false, say: { sv: 'Det finns inget pågående ärende att lägga det till.', en: 'There is no open case to add that to.' } }
        delegation.notes.push({ note: String(args.note ?? ''), at: new Date().toISOString() })
        return { ok: true, reference: delegation.reference, say: { sv: 'Noterat, det tas med i ärendet.', en: 'Noted, that goes into the case.' } }
      }
      case 'check_delegation': {
        const delegation = this.find(args.reference_id)
        if (!delegation) return { ok: false, say: { sv: 'Det finns inget pågående ärende.', en: 'There is no open case.' } }
        const seconds = Math.round((Date.now() - Date.parse(delegation.createdAt)) / 1000)
        const withNotes = delegation.notes.length > 0
        return {
          ok: true,
          state: delegation.state,
          reference: delegation.reference,
          workingForSeconds: seconds,
          notes: delegation.notes.length,
          say: {
            sv: `Kommittén arbetar fortfarande med det${withNotes ? ', med dina tillägg' : ''}. Jag återkommer när det finns ett resultat.`,
            en: `The committee is still working on it${withNotes ? ', with your additions' : ''}. I'll get back to you when there is a result.`,
          },
        }
      }
      default:
        return { ok: false, say: { sv: 'Det verktyget finns inte.', en: 'That tool does not exist.' } }
    }
  }
}

/* -------------------------------------------------------------- telemetry */

function newTelemetry(sessionId) {
  return {
    sessionId,
    model: CONFIG.model,
    backendModel: CONFIG.backendModel,
    startedAt: new Date().toISOString(),
    closedAt: null,
    reason: null,
    voiceSeconds: 0,
    voiceCostUsd: 0,
    backend: { responses: 0, inputTokens: 0, cachedTokens: 0, outputTokens: 0, costUsd: 0 },
    toolCalls: 0,
    toolCallsByName: {},
    delegationsCreated: 0,
    typedInjections: 0,
    eventCounts: {},
    firstStartedMs: null,
    projectedPerHourUsd: 0,
    /*
     * The session clock, as far as the sideband can see it: assistant audio
     * segments (merged when contiguous), delegations with their offset, and
     * tool executions stamped with the latest audio position seen. Counts
     * and milliseconds only.
     */
    timeline: { outputAudio: [], delegations: [], tools: [], lastAudioMs: 0 },
  }
}

function noteOutputAudio(t, startMs, endMs) {
  if (typeof startMs !== 'number' || typeof endMs !== 'number') return
  const segments = t.timeline.outputAudio
  const last = segments[segments.length - 1]
  if (last && startMs - last.endMs <= 250) last.endMs = Math.max(last.endMs, endMs)
  else segments.push({ startMs, endMs })
  t.timeline.lastAudioMs = Math.max(t.timeline.lastAudioMs, endMs)
}

function backendCost(usage) {
  const price = CONFIG.prices.backend[CONFIG.backendModel] ?? { input: 0, cached: 0, output: 0 }
  const cached = usage.input_tokens_details?.cached_tokens ?? 0
  const input = Math.max(0, (usage.input_tokens ?? 0) - cached)
  return (input * price.input + cached * price.cached + (usage.output_tokens ?? 0) * price.output) / 1_000_000
}

function accumulate(t, usage) {
  const cached = usage.input_tokens_details?.cached_tokens ?? 0
  t.backend.responses += 1
  t.backend.inputTokens += Math.max(0, (usage.input_tokens ?? 0) - cached)
  t.backend.cachedTokens += cached
  t.backend.outputTokens += usage.output_tokens ?? 0
  t.backend.costUsd += backendCost(usage)
  project(t)
}

function project(t) {
  t.voiceCostUsd = (t.voiceSeconds / 60) * CONFIG.prices.voicePerMinute
  const perSecondBackend = t.voiceSeconds > 0 ? t.backend.costUsd / t.voiceSeconds : 0
  t.projectedPerHourUsd = CONFIG.prices.voicePerMinute * 60 + perSecondBackend * 3600
}

/* ------------------------------------------------------------ sessions */

const sessions = new Map()

async function createSession(sdp, voice) {
  const body = {
    session: {
      model: CONFIG.model,
      instructions: VOICE_INSTRUCTIONS,
      audio: { output: { voice: CONFIG.voices.includes(voice) ? voice : CONFIG.defaultVoice } },
      delegation: {
        type: 'responses',
        responses: {
          model: CONFIG.backendModel,
          instructions: BACKEND_INSTRUCTIONS,
          tools: TOOLS,
          tool_choice: 'auto',
          parallel_tool_calls: false,
        },
      },
      ...(CONFIG.store ? { store: true } : {}),
    },
    transport: { type: 'webrtc', sdp },
  }
  const started = performance.now()
  const response = await fetch('https://api.openai.com/v1/live/sessions', {
    method: 'POST',
    headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`live/sessions ${response.status}: ${text.slice(0, 400)}`)
  const json = JSON.parse(text)
  const id = json.session?.id ?? json.id
  const answer = json.transport?.sdp ?? json.sdp
  if (!id || !answer) throw new Error(`live/sessions: unexpected shape ${text.slice(0, 200)}`)
  const record = {
    id,
    answer,
    voice: body.session.audio.output.voice,
    stub: new DelegationStub(),
    telemetry: newTelemetry(id),
    sideband: null,
    closed: null,
    negotiationMs: Math.round(performance.now() - started),
    pending: new Map(),
  }
  sessions.set(id, record)
  attachSideband(record).catch((error) => console.error(`[${id}] sideband failed: ${error.message}`))
  console.log(`[${id}] created in ${record.negotiationMs} ms · voice ${record.voice}`)
  return record
}

function count(t, type) {
  t.eventCounts[type] = (t.eventCounts[type] ?? 0) + 1
}

/**
 * The sideband: the same events the browser sees, on a server socket that
 * carries the key. Function calls are executed here and only here.
 */
async function attachSideband(record) {
  const url = `wss://api.openai.com/v1/live/sessions/${record.id}/attach`
  const socket = new WebSocket(url, { headers: { authorization: `Bearer ${KEY}` } })
  record.sideband = socket
  const t = record.telemetry
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', (event) => reject(new Error(event.message ?? 'websocket error')), { once: true })
  })
  console.log(`[${record.id}] sideband attached`)
  socket.addEventListener('message', ({ data }) => {
    let event
    try {
      event = JSON.parse(data)
    } catch {
      return
    }
    count(t, event.type)
    switch (event.type) {
      case 'session.started':
        t.firstStartedMs = Date.now()
        record.startedWallMs = Date.now()
        break
      case 'session.usage.updated':
        t.voiceSeconds = event.usage?.seconds ?? t.voiceSeconds
        project(t)
        break
      case 'session.output_audio.delta':
        noteOutputAudio(t, event.start_ms, event.end_ms)
        break
      case 'session.output_transcript.delta':
      case 'session.input_transcript.delta':
        if (typeof event.end_ms === 'number') t.timeline.lastAudioMs = Math.max(t.timeline.lastAudioMs, event.end_ms)
        break
      case 'session.delegation.created':
        t.delegationsCreated += 1
        t.timeline.delegations.push({ id: event.delegation?.id ?? null, target: event.delegation?.target ?? null, offsetMs: event.offset_ms ?? null, wallMs: Date.now() })
        break
      case 'response.event': {
        const inner = event.event ?? {}
        count(t, `response.event/${inner.type}`)
        if (inner.type === 'response.output_item.done' && inner.item?.type === 'function_call') {
          handleFunctionCall(record, inner.item).catch((error) => console.error(`[${record.id}] tool: ${error.message}`))
        }
        if (inner.type === 'response.completed' && inner.response?.usage) accumulate(t, inner.response.usage)
        break
      }
      case 'session.closed':
        t.voiceSeconds = event.usage?.seconds ?? t.voiceSeconds
        t.reason = event.reason ?? null
        t.closedAt = new Date().toISOString()
        project(t)
        record.closed = event
        persist(record)
        break
      case 'error':
        console.error(`[${record.id}] error event: ${JSON.stringify(event.error ?? event).slice(0, 300)}`)
        break
    }
  })
  socket.addEventListener('close', () => {
    if (!record.closed) {
      t.closedAt = t.closedAt ?? new Date().toISOString()
      t.reason = t.reason ?? 'transport-closed'
      project(t)
      persist(record)
    }
    console.log(`[${record.id}] sideband closed`)
  })
}

async function handleFunctionCall(record, item) {
  const t = record.telemetry
  let args = {}
  try {
    args = JSON.parse(item.arguments ?? '{}')
  } catch {
    args = {}
  }
  t.toolCalls += 1
  t.toolCallsByName[item.name] = (t.toolCallsByName[item.name] ?? 0) + 1
  const output = record.stub.call(item.name, args)
  t.timeline.tools.push({ name: item.name, atAudioMs: t.timeline.lastAudioMs, wallMs: Date.now(), reference: output.reference?.id ?? null })
  console.log(`[${record.id}] ${item.name} → ${output.state ?? (output.ok ? 'ok' : 'refused')} · at ≈${t.timeline.lastAudioMs} ms of session audio`)
  send(record, {
    type: 'response.item.create',
    event_id: `out_${item.call_id}`,
    item: { type: 'function_call_output', call_id: item.call_id, output: JSON.stringify(output) },
  })
  send(record, { type: 'response.create', event_id: `continue_${item.call_id}` })
}

function send(record, event) {
  if (record.sideband?.readyState === 1) record.sideband.send(JSON.stringify(event))
  else console.error(`[${record.id}] sideband not open; dropped ${event.type}`)
}

function persist(record) {
  const file = join(RESULTS, `telemetry-${record.id}.json`)
  writeFileSync(file, JSON.stringify({ ...record.telemetry, voice: record.voice, negotiationMs: record.negotiationMs, delegations: record.stub.delegations.map((d) => ({ id: d.reference.id, state: d.state, notes: d.notes.length })) }, null, 2))
}

/* --------------------------------------------------------- text path */

/**
 * The same JARVIS backend and the same tools with no voice at all: what the
 * person gets when the microphone or the live session is unavailable.
 */
const textStub = new DelegationStub()
const textTelemetry = { responses: 0, inputTokens: 0, cachedTokens: 0, outputTokens: 0, costUsd: 0 }

async function textPath(text) {
  const headers = { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' }
  let response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: CONFIG.backendModel,
      instructions: `${VOICE_INSTRUCTIONS}\n\n${BACKEND_INSTRUCTIONS}`,
      tools: TOOLS,
      tool_choice: 'auto',
      input: text,
    }),
  })
  let body = await response.json()
  if (!response.ok) throw new Error(`responses ${response.status}: ${JSON.stringify(body).slice(0, 300)}`)
  const usages = [body.usage]
  for (let round = 0; round < 4; round++) {
    const calls = (body.output ?? []).filter((item) => item.type === 'function_call')
    if (calls.length === 0) break
    const outputs = calls.map((call) => {
      let args = {}
      try {
        args = JSON.parse(call.arguments ?? '{}')
      } catch {}
      return { type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(textStub.call(call.name, args)) }
    })
    response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: CONFIG.backendModel, previous_response_id: body.id, tools: TOOLS, input: outputs }),
    })
    body = await response.json()
    if (!response.ok) throw new Error(`responses ${response.status}: ${JSON.stringify(body).slice(0, 300)}`)
    usages.push(body.usage)
  }
  for (const usage of usages) {
    if (!usage) continue
    const cached = usage.input_tokens_details?.cached_tokens ?? 0
    textTelemetry.responses += 1
    textTelemetry.inputTokens += Math.max(0, (usage.input_tokens ?? 0) - cached)
    textTelemetry.cachedTokens += cached
    textTelemetry.outputTokens += usage.output_tokens ?? 0
    textTelemetry.costUsd += backendCost(usage)
  }
  const answer = (body.output ?? [])
    .filter((item) => item.type === 'message')
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === 'output_text')
    .map((part) => part.text)
    .join('\n')
  return { answer, usage: body.usage, delegations: textStub.delegations, telemetry: textTelemetry }
}

/* ----------------------------------------------------------------- http */

const json = (response, status, body) => {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(body))
}
const readBody = (request) =>
  new Promise((resolve) => {
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      } catch {
        resolve({})
      }
    })
  })

createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost')
  const path = url.pathname
  try {
    if (request.method === 'GET' && path === '/') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      return response.end(readFileSync(join(HERE, 'live.html')))
    }
    if (request.method === 'GET' && path === '/config') {
      return json(response, 200, {
        model: CONFIG.model,
        backendModel: CONFIG.backendModel,
        voices: CONFIG.voices,
        defaultVoice: CONFIG.defaultVoice,
        store: CONFIG.store,
        ackMode: CONFIG.ackMode,
        prices: { voicePerMinute: CONFIG.prices.voicePerMinute, backend: CONFIG.prices.backend[CONFIG.backendModel] ?? null },
      })
    }
    if (request.method === 'POST' && path === '/session') {
      const { sdp, voice } = await readBody(request)
      if (!sdp) return json(response, 400, { error: 'sdp required' })
      const record = await createSession(sdp, voice)
      return json(response, 200, { sessionId: record.id, sdp: (await sessionAnswer(record)) })
    }
    const match = /^\/session\/([^/]+)\/(state|text|close|recording|audio)$/.exec(path)
    if (match) {
      const record = sessions.get(match[1])
      if (!record) return json(response, 404, { error: 'no such session' })
      if (match[2] === 'audio' && request.method === 'POST') {
        /*
         * JARVIS's side of the conversation, captured by the browser from
         * the remote track — opt-in (live.html?record=1), local, git-ignored.
         * The person's own microphone is never uploaded here.
         */
        const chunks = []
        for await (const chunk of request) chunks.push(chunk)
        const file = join(RESULTS, `live-${record.voice}-${record.id}.webm`)
        writeFileSync(file, Buffer.concat(chunks))
        return json(response, 200, { file, bytes: Buffer.concat(chunks).length })
      }
      if (match[2] === 'recording' && request.method === 'POST') {
        /* Only with store: the stereo WAV (input left, output right) OpenAI kept, saved beside the telemetry. */
        const r = await fetch(`https://api.openai.com/v1/live/sessions/${record.id}/content`, { headers: { authorization: `Bearer ${KEY}` } })
        if (!r.ok) return json(response, r.status, { error: (await r.text()).slice(0, 300) })
        const bytes = Buffer.from(await r.arrayBuffer())
        const file = join(RESULTS, `recording-${record.voice}-${record.id}.wav`)
        writeFileSync(file, bytes)
        return json(response, 200, { file, bytes: bytes.length })
      }
      if (match[2] === 'state' && request.method === 'GET') {
        return json(response, 200, { telemetry: record.telemetry, delegations: record.stub.delegations, closed: Boolean(record.closed), negotiationMs: record.negotiationMs })
      }
      if (match[2] === 'text' && request.method === 'POST') {
        const { text } = await readBody(request)
        if (!text) return json(response, 400, { error: 'text required' })
        record.telemetry.typedInjections += 1
        /*
         * GPT-Live has no user-text event mid-session (measured against the
         * docs on 2026-09-15); the closest instrument is a trusted
         * instruction telling the model what was typed. Whether that yields
         * a spoken answer is what the probe measures.
         */
        send(record, {
          type: 'session.instructions.append',
          event_id: `typed_${Date.now()}`,
          delegation_id: null,
          content: `Användaren skrev just detta (text, inte tal): «${String(text).slice(0, 800)}». Behandla det som om det sagts och svara nu.`,
        })
        return json(response, 202, { injected: 'session.instructions.append' })
      }
      if (match[2] === 'close' && request.method === 'POST') {
        send(record, { type: 'session.close', event_id: `close_${Date.now()}` })
        const closed = await new Promise((resolve) => {
          const started = Date.now()
          const tick = setInterval(() => {
            if (record.closed || Date.now() - started > 5000) {
              clearInterval(tick)
              resolve(record.closed)
            }
          }, 100)
        })
        if (!closed) persist(record)
        return json(response, 200, { reason: record.telemetry.reason, telemetry: record.telemetry, delegations: record.stub.delegations })
      }
    }
    if (request.method === 'POST' && path === '/text') {
      const { text } = await readBody(request)
      if (!text) return json(response, 400, { error: 'text required' })
      return json(response, 200, await textPath(String(text)))
    }
    if (request.method === 'GET' && path === '/telemetry') {
      return json(response, 200, { sessions: [...sessions.values()].map((r) => r.telemetry), textPath: textTelemetry })
    }
    response.writeHead(404).end()
  } catch (error) {
    console.error(error)
    json(response, 500, { error: String(error.message ?? error).slice(0, 400) })
  }
}).listen(CONFIG.port, () => console.log(`JARVIS GPT-Live proof at http://localhost:${CONFIG.port}/ · ${CONFIG.model} + ${CONFIG.backendModel}`))

/* The SDP answer arrives with the session; kept on the record for the HTTP reply. */
async function sessionAnswer(record) {
  return record.answer
}
