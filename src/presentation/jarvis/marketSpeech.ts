/**
 * The market brief as Swedish sentences — for the one-second path, and as
 * the context a model reads.
 *
 * `retrievalSpeech` answers a Tier-0 question deterministically: the named
 * instrument's level and move with its session, time and source, and an
 * honest sentence where the platform serves nothing. `marketContextText`
 * renders the same brief compactly for a model's instructions, with the
 * observation times and sources beside every number, so a follow-up is
 * reasoned over the numbers already fetched and never over memory.
 *
 * Nothing here interprets. A move is up or down by the source's figure; a
 * missing figure is missing; a driver is named only where a headline was
 * served, and otherwise the sentence says the driver is not verified.
 */

import type {
  BriefQuote,
  BriefYield,
  MarketBrief,
} from '~/application/jarvis/marketBrief'
import type { RetrievalTarget } from '~/application/jarvis/marketIntent'

const TZ = 'Europe/Stockholm'

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString('sv-SE', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
  })
const day = (iso: string) =>
  new Date(iso).toLocaleDateString('sv-SE', {
    timeZone: TZ,
    day: 'numeric',
    month: 'long',
  })

/* Swedish formatting, with the locale's non-breaking thousands separator made an ordinary space for speech and text. */
const sv = (value: number, digits: { min: number; max: number }) =>
  new Intl.NumberFormat('sv-SE', {
    minimumFractionDigits: digits.min,
    maximumFractionDigits: digits.max,
  })
    .format(value)
    .replace(/ /g, ' ')
const level = (value: number, symbol: string): string => {
  const digits = symbol.startsWith('fx:') ? 4 : value >= 1000 ? 0 : 2
  return sv(value, { min: digits, max: digits })
}
const pct = (value: number): string => sv(Math.abs(value), { min: 1, max: 2 })

/** "upp 0,45 procent" / "ned 0,45 procent" / "oförändrad". */
const move = (changePercent: number | null): string | null => {
  if (changePercent === null) return null
  if (Math.abs(changePercent) < 0.005) return 'oförändrad'
  return `${changePercent > 0 ? 'upp' : 'ned'} ${pct(changePercent)} procent`
}

const bp = (value: number): string => {
  const rounded = Math.round(value)
  if (rounded === 0) return 'oförändrad'
  return `${rounded > 0 ? 'upp' : 'ned'} ${Math.abs(rounded)} ${Math.abs(rounded) === 1 ? 'baspunkt' : 'baspunkter'}`
}

/** A quote's move over the period the source's figure covers. */
function quoteSentence(q: BriefQuote): string {
  const m = move(q.changePercent)
  const period =
    q.changePeriod === 'publication-to-publication' ? 'mot föregående notering' : 'idag'
  const value = `${level(q.level, q.symbol)}${q.symbol.startsWith('fx:') ? ` (${q.name})` : ''}`
  if (q.freshness === 'stale') {
    return `Senaste tillgängliga noteringen för ${q.name} är från kl. ${clock(q.observedAt)} (${q.source}): ${value}${m ? `, ${m}` : ''}.`
  }
  if (q.symbol.startsWith('sector:')) {
    return `${q.name} är ${m ?? 'utan dagsförändring i källan'} idag.`
  }
  if (q.symbol.startsWith('fx:')) {
    return `${q.name} står i ${level(q.level, q.symbol)}${m ? `, ${m} ${period}` : ''} (${q.source}, ${day(q.observedAt)}).`
  }
  if (q.session === 'closed') {
    return `${q.name} stängde på ${value}${m ? `, ${m} idag` : ' (dagsförändring saknas i källan)'}.`
  }
  if (q.session === 'open') {
    return `${q.name} ligger på ${value} just nu${m ? `, ${m} idag` : ' (dagsförändring saknas i källan)'}.`
  }
  return `${q.name}: senaste notering ${value}${m ? `, ${m} ${period}` : ' (dagsförändring saknas i källan)'}.`
}

function yieldSentence(r: BriefYield): string {
  const name =
    r.symbol === 'rate:us10y'
      ? 'USA:s tioårsränta'
      : r.symbol === 'rate:us2y'
        ? 'USA:s tvåårsränta'
        : r.symbol === 'rate:de10y'
          ? 'Tysklands tioårsränta'
          : r.symbol === 'rate:se10y'
            ? 'Sveriges tioårsränta'
            : r.name
  const value = sv(r.yieldPercent, { min: 2, max: 2 })
  const change = r.changeBasisPoints === null ? '' : `, ${bp(r.changeBasisPoints)}`
  return `${name} ligger på ${value} procent${change} (officiell dagsnivå ${day(r.observationDate)}, ${r.source}).`
}

/** The provenance clause for a group of quotes: sources and the newest observation time. */
function provenanceClause(quotes: readonly BriefQuote[]): string {
  const served = quotes.filter((q) => q.freshness !== 'stale')
  if (served.length === 0) return ''
  const sources = [...new Set(served.map((q) => q.source))].join(' och ')
  const newest = served
    .map((q) => q.observedAt)
    .sort()
    .at(-1)!
  const delayed = served.some((q) => q.quality === 'delayed') ? 'fördröjd data' : 'data'
  return ` (${delayed} från ${sources}, kl. ${clock(newest)})`
}

/**
 * A Tier-0 answer: one sentence per named target from the brief, honest
 * where the brief has nothing, and the provenance once.
 */
export function retrievalSpeech(
  targets: readonly RetrievalTarget[],
  brief: MarketBrief,
): string {
  const sentences: string[] = []
  const quoted: BriefQuote[] = []
  const sp500 = brief.indices.find((q) => q.symbol === 'idx:sp500') ?? null

  for (const target of targets) {
    switch (target.kind) {
      case 'quote': {
        const q =
          brief.indices.find((entry) => entry.symbol === target.symbol) ??
          brief.sectors.find((entry) => entry.symbol === target.symbol) ??
          brief.fx.find((entry) => entry.symbol === target.symbol) ??
          brief.commodities.find((entry) => entry.symbol === target.symbol) ??
          null
        if (!q) {
          const name =
            brief.unavailable.find((entry) =>
              entry.toLowerCase().includes(target.symbol.split(':')[1] ?? ''),
            ) ?? nameFor(target.symbol)
          sentences.push(
            `${name} saknas i datan just nu — källan svarar inte, och jag vill inte gissa.`,
          )
          break
        }
        let sentence = quoteSentence(q)
        /* A sector against the broad index, when both are served: the one comparison a person wants. */
        if (
          q.symbol.startsWith('sector:') &&
          sp500 &&
          sp500.changePercent !== null &&
          q.changePercent !== null
        ) {
          const better = q.changePercent > sp500.changePercent
          sentence += ` Det är ${better ? 'bättre' : 'svagare'} än S&P 500, som är ${move(sp500.changePercent)}.`
        }
        sentences.push(sentence)
        /* A daily fix names its own source and date; the trailing clause is for intraday quotes. */
        if (!q.symbol.startsWith('fx:')) quoted.push(q)
        break
      }
      case 'rate': {
        const r = brief.rates.find((entry) => entry.symbol === target.symbol)
        if (!r) {
          sentences.push(
            `${nameFor(target.symbol)} saknas i datan just nu; jag vill inte gissa.`,
          )
          break
        }
        sentences.push(yieldSentence(r))
        break
      }
      case 'sectors': {
        if (brief.sectors.length === 0) {
          sentences.push('Sektorerna saknas i datan just nu.')
          break
        }
        const withMove = brief.sectors.filter((q) => q.changePercent !== null)
        const best = withMove[0]
        const worst = withMove[withMove.length - 1]
        if (best && worst && best !== worst) {
          sentences.push(
            `Starkast idag är ${best.name}, ${move(best.changePercent)}; svagast ${worst.name}, ${move(worst.changePercent)}.`,
          )
        } else if (best) {
          sentences.push(`${best.name} är ${move(best.changePercent)} idag.`)
        }
        quoted.push(...withMove)
        break
      }
      case 'risk': {
        if (!brief.riskAppetite) {
          sentences.push('Riskaptitindexet saknas i datan just nu.')
          break
        }
        const { score, label } = brief.riskAppetite
        const word =
          label === 'risk-on' ? 'risk-on' : label === 'risk-off' ? 'risk-off' : 'neutralt'
        sentences.push(
          `Plattformens riskaptitindex står i ${score} av 100 — ${word} (härlett, ${day(brief.riskAppetite.observedAt)}).`,
        )
        break
      }
      case 'vix':
        sentences.push(
          'En VIX-nivå serveras inte av plattformen.' +
            (brief.riskAppetite
              ? ` Riskaptitindexet står i ${brief.riskAppetite.score} av 100.`
              : ''),
        )
        break
      case 'not-served':
        sentences.push(
          `${target.name} serveras inte av plattformen, så jag har ingen siffra att ge.`,
        )
        break
    }
  }
  const clause = provenanceClause(quoted)
  if (clause && sentences.length > 0)
    sentences[sentences.length - 1] =
      sentences[sentences.length - 1]!.replace(/\.$/, '') + `${clause}.`
  return sentences.join(' ')
}

function nameFor(symbol: string): string {
  switch (symbol) {
    case 'idx:sp500':
      return 'S&P 500'
    case 'idx:nasdaq100':
      return 'Nasdaq 100'
    case 'idx:omxs30':
      return 'OMXS30'
    case 'idx:dax':
      return 'DAX'
    case 'idx:ftse100':
      return 'FTSE 100'
    case 'idx:nikkei225':
      return 'Nikkei 225'
    case 'rate:us10y':
      return 'USA:s tioårsränta'
    case 'rate:us2y':
      return 'USA:s tvåårsränta'
    case 'rate:de10y':
      return 'Tysklands tioårsränta'
    case 'rate:se10y':
      return 'Sveriges tioårsränta'
    case 'cmd:gold':
      return 'Guldet'
    case 'cmd:brent':
      return 'Brent'
    case 'fx:usdsek':
      return 'USD/SEK'
    case 'fx:eurusd':
      return 'EUR/USD'
    default:
      return symbol.replace(/^sector:/, 'Sektorn ')
  }
}

/**
 * The brief as a model reads it: compact, every number beside its time and
 * source, what is missing named, and the headlines or the sentence that
 * says the driver is not verified.
 */
export function marketContextText(brief: MarketBrief): string {
  const q = (entry: BriefQuote) =>
    `${entry.name}: ${level(entry.level, entry.symbol)}${entry.changePercent === null ? ' (förändring saknas)' : `, ${move(entry.changePercent)}`}, ${entry.session}, ${entry.freshness === 'stale' ? 'INAKTUELL ' : ''}${entry.source} kl. ${clock(entry.observedAt)}`
  const lines: string[] = []
  lines.push(
    `MARKNADSLÄGE hämtat ${clock(brief.generatedAt)} (${day(brief.generatedAt)}), omfattning ${brief.scope}.`,
  )
  if (brief.indices.length) lines.push(`Index: ${brief.indices.map(q).join(' · ')}`)
  if (brief.sectors.length)
    lines.push(
      `Sektorer (bäst→sämst): ${brief.sectors.map((s) => `${s.name} ${s.changePercent === null ? '(saknas)' : move(s.changePercent)}`).join(' · ')}`,
    )
  if (brief.rates.length)
    lines.push(
      `Räntor: ${brief.rates.map((r) => `${r.name} ${sv(r.yieldPercent, { min: 2, max: 2 })} % ${r.changeBasisPoints === null ? '' : `(${bp(r.changeBasisPoints)})`} ${day(r.observationDate)} ${r.source}`).join(' · ')}${brief.curveSlopeBasisPoints === null ? '' : ` · kurvlutning 10y−2y ${Math.round(brief.curveSlopeBasisPoints)} bp`}`,
    )
  if (brief.fx.length) lines.push(`Valutor: ${brief.fx.map(q).join(' · ')}`)
  if (brief.commodities.length)
    lines.push(`Råvaror: ${brief.commodities.map(q).join(' · ')}`)
  if (brief.riskAppetite)
    lines.push(
      `Riskaptitindex (härlett, 0–100, aldrig VIX): ${brief.riskAppetite.score} ${brief.riskAppetite.label}`,
    )
  lines.push(
    brief.headlines.length
      ? `Rubriker: ${brief.headlines.map((h) => `"${h.headline}" (${h.outlet})`).join(' · ')}`
      : 'Rubriker: inga i källan — dagens drivkraft är inte verifierad; beskriv rörelserna, hitta inte på en orsak.',
  )
  if (brief.unavailable.length)
    lines.push(`Saknas just nu: ${brief.unavailable.join(', ')}.`)
  lines.push(`Serveras inte alls: ${brief.notServed.join(', ')}.`)
  return lines.join('\n')
}

/* ------------------------------------------- the brief for the voice */

const dayShort = (iso: string) =>
  new Date(iso).toLocaleDateString('sv-SE', {
    timeZone: TZ,
    day: 'numeric',
    month: 'short',
  })

/** "upp 0,45 %" / "ned 0,45 %" / "oförändrad" / "(förändring saknas)". */
const shortMove = (changePercent: number | null): string => {
  if (changePercent === null) return '(förändring saknas)'
  if (Math.abs(changePercent) < 0.005) return 'oförändrad'
  return `${changePercent > 0 ? 'upp' : 'ned'} ${pct(changePercent)} %`
}

const shortBp = (value: number | null): string => {
  if (value === null) return 'förändring saknas'
  const rounded = Math.round(value)
  return rounded === 0
    ? 'oförändrad'
    : `${rounded > 0 ? 'upp' : 'ned'} ${Math.abs(rounded)} bp`
}

const shortRateName = (r: BriefYield): string =>
  r.symbol === 'rate:us10y'
    ? 'USA 10 år'
    : r.symbol === 'rate:us2y'
      ? 'USA 2 år'
      : r.symbol === 'rate:de10y'
        ? 'Tyskland 10 år'
        : r.symbol === 'rate:se10y'
          ? 'Sverige 10 år'
          : r.name

const voiceQuote = (q: BriefQuote): string => {
  const stale = q.freshness === 'stale' ? 'INAKTUELL ' : ''
  const session =
    q.session === 'closed' ? 'stängt, ' : q.session === 'open' ? 'öppet, ' : ''
  const when =
    q.changePeriod === 'publication-to-publication'
      ? dayShort(q.observedAt)
      : clock(q.observedAt)
  return `${stale}${q.name} ${level(q.level, q.symbol)} ${shortMove(q.changePercent)} (${session}${q.source} ${when})`
}

/** What the voice is allowed to drop, least useful first, when the brief must fit a provider's limit. */
interface VoiceTrim {
  notServed: boolean
  sectors: 'all' | 'edges' | 'none'
  headlines: number
  unavailable: boolean
  fxAndCommodities: boolean
}

const VOICE_TRIM_LADDER: readonly VoiceTrim[] = [
  {
    notServed: true,
    sectors: 'all',
    headlines: 3,
    unavailable: true,
    fxAndCommodities: true,
  },
  {
    notServed: false,
    sectors: 'all',
    headlines: 3,
    unavailable: true,
    fxAndCommodities: true,
  },
  {
    notServed: false,
    sectors: 'edges',
    headlines: 3,
    unavailable: true,
    fxAndCommodities: true,
  },
  {
    notServed: false,
    sectors: 'edges',
    headlines: 1,
    unavailable: true,
    fxAndCommodities: true,
  },
  {
    notServed: false,
    sectors: 'none',
    headlines: 1,
    unavailable: true,
    fxAndCommodities: true,
  },
  {
    notServed: false,
    sectors: 'none',
    headlines: 1,
    unavailable: false,
    fxAndCommodities: true,
  },
  {
    notServed: false,
    sectors: 'none',
    headlines: 0,
    unavailable: false,
    fxAndCommodities: false,
  },
]

function voiceContextAt(brief: MarketBrief, trim: VoiceTrim): string {
  const lines: string[] = []
  lines.push(
    `MARKNADSLÄGE hämtat ${clock(brief.generatedAt)} (${dayShort(brief.generatedAt)}), ${brief.scope}.`,
  )
  if (brief.indices.length)
    lines.push(`Index: ${brief.indices.map(voiceQuote).join(' · ')}`)
  if (brief.sectors.length && trim.sectors !== 'none') {
    let sectors = brief.sectors
    if (trim.sectors === 'edges' && sectors.length > 7) {
      /* The strongest three, the weakest three, and technology — the sector a person asks about by name. */
      const tech = sectors.find((s) => s.symbol === 'sector:technology')
      const edges = [...sectors.slice(0, 3), ...sectors.slice(-3)]
      sectors = tech && !edges.includes(tech) ? [...edges, tech] : edges
    }
    lines.push(
      `Sektorer (bäst→sämst): ${sectors.map((s) => `${s.name} ${s.changePercent === null ? '(saknas)' : shortMove(s.changePercent)}`).join(' · ')}`,
    )
  }
  if (brief.rates.length)
    lines.push(
      `Räntor: ${brief.rates.map((r) => `${r.freshness === 'stale' ? 'INAKTUELL ' : ''}${shortRateName(r)} ${sv(r.yieldPercent, { min: 2, max: 2 })} % (${shortBp(r.changeBasisPoints)}, ${dayShort(r.observationDate)}, ${r.source})`).join(' · ')}${brief.curveSlopeBasisPoints === null ? '' : ` · 10y−2y ${Math.round(brief.curveSlopeBasisPoints)} bp`}`,
    )
  if (trim.fxAndCommodities) {
    if (brief.fx.length) lines.push(`Valutor: ${brief.fx.map(voiceQuote).join(' · ')}`)
    if (brief.commodities.length)
      lines.push(`Råvaror: ${brief.commodities.map(voiceQuote).join(' · ')}`)
  }
  if (brief.riskAppetite)
    lines.push(
      `Riskaptit (härlett 0–100, aldrig VIX): ${brief.riskAppetite.score} ${brief.riskAppetite.label}`,
    )
  if (brief.headlines.length && trim.headlines > 0) {
    lines.push(
      `Rubriker: ${brief.headlines
        .slice(0, trim.headlines)
        .map((h) => `"${h.headline.slice(0, 90)}" (${h.outlet})`)
        .join(' · ')}`,
    )
  } else {
    lines.push('Rubriker: inga — drivkraften ej verifierad, hitta inte på en orsak.')
  }
  if (brief.unavailable.length && trim.unavailable)
    lines.push(`Saknas: ${brief.unavailable.join(', ')}.`)
  if (trim.notServed) lines.push(`Ej serverat: ${brief.notServed.join(', ')}.`)
  return lines.join('\n')
}

/**
 * The brief as the voice reads it, held under `maxChars` by construction:
 * the same numbers with their times and sources, in fewer words, and when
 * that is still too long, the least useful lines dropped first — the
 * never-served list, then the middle of the sector table, then headlines
 * and the missing list — so the indices and the rates are the last to go.
 * What is dropped is not lied about: a thing not in the brief is handed to
 * the backend, which reads the full brief.
 */
export function marketVoiceContext(brief: MarketBrief, maxChars: number): string {
  let text = ''
  for (const trim of VOICE_TRIM_LADDER) {
    text = voiceContextAt(brief, trim)
    if (text.length <= maxChars) return text
  }
  return text.slice(0, Math.max(0, maxChars))
}
