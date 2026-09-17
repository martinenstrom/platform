/**
 * What JARVIS says through the voice, and what it is told to be.
 *
 * The firm answers a delegation call with a typed `HostResult`. This is
 * where that result becomes the sentence the voice may relay — the same
 * sentences the typed presence shows (`hostStateText`), spoken — and where
 * the one claim that must never be invented is decided:
 *
 * ## The invariant, as a value rather than a rule
 *
 * "Jag kollar på det och återkommer" promises delegated work. It is produced
 * here for exactly one product state, `working`, and for nothing else: not
 * for a case that needs the person's decision, not for one that is blocked,
 * not for a failure, and never for a handoff the backend answered by itself.
 * `acknowledgeWork` says so as a boolean the session can hold the voice to.
 * The voice model is instructed never to say the sentence on its own; when
 * it does anyway, the session counts it (`ackWithoutReference`), because
 * obedience is measured, not assumed.
 *
 * ## Swedish, from the firm's states
 *
 * `phrase` and `answerLines` are the presence's; nothing here is a second
 * reading of a state. The backend model renders the sentence in the person's
 * language when that language is English.
 */

import type { HostRequest, HostResult } from '~/application/analysis/hostContract'
import type { DomainReference } from '~/application/analysis/domainSystem'
import type { UnsupportedToolReason } from '~/application/jarvis/liveTools'
import type { MarketBrief } from '~/application/jarvis/marketBrief'
import { amendmentLine, answerLines, phrase } from './hostStateText'
import { marketContextText, marketVoiceContext } from './marketSpeech'

/** The sentence the voice may say for delegated work, and the only one. */
export const WORKING_ACKNOWLEDGEMENT = 'Jag kollar på det och återkommer.'

/**
 * What a spoken claim of delegated work looks like, in either language, for
 * the session's watcher. Broad on purpose: a paraphrase that promises a
 * return is the same claim.
 */
export const ACKNOWLEDGEMENT_PATTERN =
  /kollar på det och återkommer|återkommer (när|med|så snart)|get back to you|circle back/i

export interface ToolSpeech {
  state: HostResult['state']
  /** Swedish. The backend relays it in the person's language. */
  say: string
  /** True only when the firm has delegated work under way. */
  acknowledgeWork: boolean
  /** True when the next move is the person's — a decision, not a wait. */
  decisionRequired: boolean
  reference: DomainReference | null
}

/**
 * A host result, as the voice may relay it.
 *
 * `act` is what the person asked for. After an addition the sentence leads
 * with the fact that it landed and whether work predates it, because that is
 * the answer to what was said; the case's state follows only where it is a
 * promise (`working`) or a demand (`needs-decision`). After anything else
 * the state is the answer.
 */
export function toolSpeech(result: HostResult, act?: HostRequest['kind']): ToolSpeech {
  const spoken = phrase(result)
  const reference = 'reference' in result && result.reference ? result.reference : null

  if (act === 'amend' && 'amendments' in result) {
    const predates = result.amendments.workPredates
      ? ' Det arbete som redan gjorts tar inte hänsyn till det.'
      : ''
    const working = result.state === 'working'
    return {
      state: result.state,
      say: `Tillagt i ärendet.${predates}${working ? ` ${WORKING_ACKNOWLEDGEMENT}` : ''}${
        result.state === 'needs-decision' ? ` ${spoken.headline} ${spoken.detail ?? ''}` : ''
      }`.trim(),
      acknowledgeWork: working,
      decisionRequired: result.state === 'needs-decision',
      reference,
    }
  }

  switch (result.state) {
    case 'working':
      return {
        state: result.state,
        say: [WORKING_ACKNOWLEDGEMENT, spoken.detail, amendmentLine(result)]
          .filter(Boolean)
          .join(' '),
        acknowledgeWork: true,
        decisionRequired: false,
        reference,
      }
    case 'closed':
      return {
        state: result.state,
        say: `${act === 'close' ? 'Ärendet är stängt.' : spoken.headline} ${spoken.detail ?? ''}`.trim(),
        acknowledgeWork: false,
        decisionRequired: false,
        reference,
      }
    case 'answer-ready':
      return {
        state: result.state,
        say: [spoken.headline, ...(result.answer ? answerLines(result.answer) : [spoken.detail ?? ''])]
          .filter(Boolean)
          .join(' '),
        acknowledgeWork: false,
        decisionRequired: false,
        reference,
      }
    case 'needs-decision':
      return {
        state: result.state,
        say: `${spoken.headline} ${spoken.detail ?? ''}`.trim(),
        acknowledgeWork: false,
        decisionRequired: true,
        reference,
      }
    case 'blocked':
      return {
        state: result.state,
        say: [spoken.headline, spoken.detail, amendmentLine(result)].filter(Boolean).join(' '),
        acknowledgeWork: false,
        decisionRequired: false,
        reference,
      }
    case 'unsupported':
    case 'failed':
      return {
        state: result.state,
        say: `${spoken.headline} ${spoken.detail ?? ''}`.trim(),
        acknowledgeWork: false,
        decisionRequired: false,
        reference,
      }
  }
}

const UNSUPPORTED_TOOL: Record<UnsupportedToolReason, string> = {
  'no-open-case': 'Det finns inget pågående ärende i det här samtalet.',
  'unknown-tool': 'Det kan jag inte göra.',
  'invalid-arguments': 'Jag uppfattade inte vad frågan gällde. Kan du säga det igen?',
}

/** A tool call the firm has no door for, said honestly. */
export function unsupportedSpeech(reason: UnsupportedToolReason): ToolSpeech {
  return {
    state: 'unsupported',
    say: UNSUPPORTED_TOOL[reason],
    acknowledgeWork: false,
    decisionRequired: false,
    reference: null,
  }
}

/* ------------------------------------------------------ the instructions */

/**
 * The voice model's instructions. Character, language, and the two things it
 * must never do: decide an investment question, and claim delegated work on
 * its own. Measured 2026-09-15 (docs/jarvis-voice-live-proof.md §7): the
 * "never say it yourself" form held in 13 of 13 sessions where the natural
 * form spoke the sentence before any reference existed.
 */
export const LIVE_VOICE_INSTRUCTIONS = `Du är JARVIS, en personlig investeringsintelligens i ett institutionellt kommandocenter. Du talar svenska som förstaspråk.
Språkregel, utan undantag: svenska in → svenska ut. Talar användaren engelska svarar du på engelska — även korta bekräftelser som "One moment." — och byter tillbaka till svenska först när användaren gör det. Blandat → svenska, med engelska namn och finanstermer oförändrade och naturligt uttalade: Nvidia, Fed, ECB, CPI, Treasury, duration, yield curve, equity risk premium, earnings yield, term premium, higher for longer. Det backend ber dig förmedla säger du på det språk användaren senast använde, översatt om det behövs.
Karaktär: lugn, intelligent, självsäker, varm men återhållsam, mänsklig, närvarande, lite levande. Inte teatralisk, inte radioröst, inte kundtjänst, ingen överdriven entusiasm. Tempo: lugnt men raskt, naturlig svensk samtalsrytm — inte långsamt, inte stressat.
Korta svar. Säg det som är nyttigt och sluta där; förklara mekanik bara när det ändrar vad användaren kan göra härnäst. Inga listor i tal.
Medan användaren tydligt fortsätter tala: var tyst. Inga "ehm", inga fyllnadsord, inget "låt mig tänka". När turen verkligen är slut: svara direkt.
Tre djup, efter konsekvens — en finansfråga är inte automatiskt ett ärende.
SNABBT, svara SJÄLV i samma andetag: definitioner, enkla räkneexempel, uppföljningar om något du redan sagt, småprat — durationsräkning, vad term premium är, vad en räntesänkning betyder.
MARKNADEN JUST NU: står svaret i det senaste MARKNADSLÄGET i dina instruktioner (färska siffror med tid och källa) svarar du direkt ur det — "S&P 500 är ned 0,45 procent" — med siffran först och utan inledning. Annars, eller om det som frågas inte står där, lämna över till backend som har färska siffror: allt om hur börsen, ett index, en sektor, en ränta, en valuta eller en råvara går, står eller rör sig — "idag", "just nu", "senaste", "hur handlar", "vad händer på börsen", "hur går tech", "vad gör tioåringen". Säg ALDRIG nivåer eller dagsrörelser ur minnet — bara ur MARKNADSLÄGET eller från backend. "Amerikanska börsen" betyder S&P 500 och Nasdaq 100 — fråga aldrig vilket index som menas. Saknas rubriker i läget är dagens drivkraft inte verifierad: säg det, hitta inte på en orsak.
RESONEMANG, svara själv: varför något händer, vad det i allmänhet betyder — "vad betyder högre tioårsränta för tech" — utifrån det som redan sagts i samtalet; behöver du färska siffror, backend.
INSTITUTIONELLT, lämna över till backend: vad användaren bör göra med kapital — köpa, sälja, minska, öka, positionera portföljen, om något är attraktivt på sikt — och allt som gäller ett ärende hos kommittén: lägga till, fråga om, avsluta. Sådant avgörs av investeringskommittén i Financial OS, aldrig av dig.
Be ALDRIG om en tes, ett scenario eller ett förtydligande kring en vanlig fråga om marknaden; det hör bara till ett ärende som kommittén faktiskt öppnat, och då säger backend det.
Börja med innehållet. Inte "Mm", "Hm", "Ja", "Jag kollar" — första ordet ska vara svaret: "S&P 500 är ned …", "Tioåringen ligger på …". Bekräftelser: säg INTE "Ett ögonblick" av vana. När du lämnar över till backend: var tyst och vänta. Bara om svaret dröjer märkbart — mer än ett par sekunder — säger du en kort, sann, varierad sak: "Jag kollar.", "Jag ser på det.", "Ja — jag tar med det." Aldrig samma fras två gånger i rad, aldrig påhittad väntan.
Säg ALDRIG själv "Jag kollar på det och återkommer" eller något som lovar att du återkommer — det får bara komma från backend, som säger det när kommittén faktiskt arbetar; då förmedlar du det en gång. Säger backend att ett beslut behövs av användaren, att något hindrar, eller att det inte gick, förmedlar du det rakt och lovar inget.
Påstå aldrig att du gjort något som backend inte bekräftat: inte att något lagts till i ärendet, inte att ett ärende stängts, inte att kommittén är klar. Kan det inte göras, säg det med vanliga ord och vad som krävs härnäst. Läs aldrig upp tekniska id:n, referenser eller verktygsnamn.`

/**
 * The backend model's instructions: the reasoning layer behind the voice.
 * It answers understanding itself; it never answers an investment judgement
 * itself; and it relays tool results without adding to them.
 */
export const LIVE_BACKEND_INSTRUCTIONS = `Du är JARVIS resonerande lager bakom rösten. Du får samtalets kontext från röstlagret. Svara på användarens språk — svenska om inte användaren talar engelska — med engelska finanstermer oförändrade, i kort talat format: inga listor, inga id:n, ingen inledning som "Uppfattat" eller "Ett ögonblick".
Djup, efter konsekvens — inte efter att ämnet råkar vara finans:
VAD HÄNDER? — svara själv, från färska data. VARFÖR? — oftast själv. VAD BETYDER DET I ALLMÄNHET? — resonera själv. VAD SKA JAG GÖRA MED KAPITAL? — investeringskommittén.
Regler:
0. Marknaden just nu: varje fråga om hur marknaden, ett index, en sektor, en ränta, en valuta eller en råvara går, står eller rör sig — "idag", "just nu", "senaste", "hur handlar", "vad händer på börsen", "hur går tech", "vad gör tioåringen", "hur är VIX" — besvaras med get_market_snapshot FÖRST och sedan direkt, i två till fem meningar: nivå och dagsförändring för det som frågades, det som sticker ut (sektorer, räntan, dollarn), och det som framför allt driver dagen om rubrikerna säger det. riskAppetite är plattformens härledda riskaptitindex på skalan 0–100 (50 neutralt) — kalla det aldrig VIX; en VIX-nivå serveras inte, och frågas det om VIX säger du det. "Amerikanska börsen" är S&P 500 och Nasdaq 100 som standard; säg vilket du använde, fråga aldrig vilket index som menas. Nämn observationstid och källa bara kort om data är fördröjd eller inaktuell. Nivåer ur minnet är förbjudna; det som står under unavailable eller notServed säger du saknas — aldrig ett gissat värde. Inget ärende, ingen kommitté, ingen tes, inget scenario. Uppföljningar — "varför?", "och tech?", "vad gör tioåringen?", "och Europa?" — svarar du i samma marknadskontext; finns ett MARKNADSLÄGE i instruktionerna använder du det och hämtar bara det som saknas där. Saknas rubriker är dagens drivkraft inte verifierad: beskriv rörelserna och säg det — hitta aldrig på en orsak som passar kursrörelsen. Inled inte: första meningen bär svaret.
1. Investeringsbedömningar — vad användaren bör göra med kapital: köpa, sälja, minska, öka, positionera portföljen, om något är attraktivt på sikt — lämnas ALLTID till delegate_to_financial_os. Ge aldrig en egen slutsats om sådant. En fråga om vad som händer är inte en investeringsbedömning.
2. Frågor om var ett ärende står: check_delegation. Frågor om vad kommittén kom fram till: get_delegation_result. Tillägg till ett pågående ärende — "ta hänsyn till dollarn också", "lägg till att värderingen är huvudskälet" — gäller ärendet i samtalet: add_to_delegation. Vill användaren avsluta, stänga eller lägga ner ärendet: close_case.
3. Allmänna finansfrågor och resonemang (vad är term premium, hur påverkar duration en obligation, vad högre långräntor gör med värderingar) besvarar du själv, kort och korrekt, utan att lova att återkomma. Frågor om värderingsläget — "hur ser värderingen ut?", om marknaden är dyr eller billig — är resonemang du gör själv, inte ett ärende; plattformen serverar inga värderingsmått (P/E, multiplar), så säg det och resonera utifrån räntor och rörelser. Ett ärende öppnas bara när användaren frågar vad de ska göra med kapital.
4. Verktygssvar från firman innehåller "say" på svenska och två flaggor. Förmedla "say" — översatt till engelska om användaren talar engelska — kort, gärna med egna ord, och lägg inte till något resultat verktyget inte gav. Är acknowledgeWork false får du inte säga att du återkommer. Är decisionRequired true säger du tydligt att användaren behöver besluta något. Be om en tes eller ett scenario ENDAST när ett sådant svar från firman kräver det, aldrig kring en vanlig marknadsfråga.
5. Påstå aldrig att något lagts till, stängts eller gjorts om verktyget inte bekräftade det. Gick det inte, säg det med vanliga ord och vad som krävs.`

/** What the market tool answers when the platform's sources cannot be reached. Said, never worked around. */
export const MARKET_UNAVAILABLE = 'Jag kommer inte åt färska marknadsdata just nu, så jag vill inte gissa om nivåer.'

/**
 * Bridging syllables and phrases a voice says before content — "Mm.",
 * "Hm.", "Jag kollar." — stripped when measuring where the useful answer
 * begins. Not a judgement of them; a ruler for them.
 */
export const BRIDGING_PATTERN =
  /^(\s*(?:\[[^\]]*\]\s*)?(?:(?:m+h*m*|h+m+|ja(?:ha)?|jo|okej|ok|absolut|visst|ett ögonblick|en sekund|en snabb titt|snabb titt)(?![\p{L}])|(?:jag (?:kollar|ser|tittar|kikar|tar fram|hämtar|tar (?:en )?(?:snabb )?titt|tar med det)|låt mig (?:se|titta|kolla))(?![\p{L}])[^.!?…]*)[.,!…\s]*)+/iu

/**
 * GPT-Live refuses a context append above 500 tokens. Measured 2026-09-17:
 * the full brief was refused six times in one session — "Context append
 * text must not exceed 500 tokens" — each time silently for the person,
 * who then waited for the backend on every question the voice should have
 * answered itself. Number-dense Swedish runs about 2.3 characters a token
 * (o200k_base, measured on the voice brief), so the append is held under
 * this many characters, with headroom.
 */
export const LIVE_APPEND_MAX_CHARS = 1000

/**
 * The market brief as context for a model: what it is, how fresh it is
 * allowed to be, and what may and may not be done with it. The voice's
 * standing rule for the brief is in LIVE_VOICE_INSTRUCTIONS; the append
 * carries only the numbers and the window, so it fits the provider's limit.
 */
export const LIVE_MARKET_CONTEXT = {
  /** Appended to a live voice session, so the voice answers a simple state question itself; always under the provider's limit. */
  voice: (brief: MarketBrief, windowSeconds: number): string => {
    const rule = `\nGäller ${Math.round(windowSeconds / 60)} min; nyare ersätter äldre. Tid och källa bara på fråga eller vid INAKTUELL.`
    return `${marketVoiceContext(brief, LIVE_APPEND_MAX_CHARS - rule.length)}${rule}`
  },
  /** Put into a typed turn's instructions, so the router answers over the numbers and fetches only what is missing. */
  typed: (brief: MarketBrief, windowSeconds: number): string =>
    `${marketContextText(brief)}\nRegel: svara ur detta MARKNADSLÄGE utan att anropa get_market_snapshot; anropa det bara för en omfattning som saknas här (till exempel Europa eller Sverige) eller om läget är äldre än ${Math.round(windowSeconds / 60)} minuter. Uppföljningar — "varför?", "och tech?", "vad gör tioåringen?" — besvaras ur samma siffror. Rubriker som saknas betyder att dagens drivkraft inte är verifierad — beskriv rörelserna och säg det; hitta inte på en orsak.`,
} as const

/**
 * A typed line reaches the backend without the voice: what the backend is
 * told about the channel, and what the voice is told to say afterwards.
 */
export const LIVE_TYPED_CONTEXT = {
  channel:
    'Kanalen är text: användaren skrev raden själv, utan röst. Svara som till en kollega som skrev — samma regler, samma korthet.',
  bound: 'Samtalet är bundet till ett ärende hos firman; check_delegation, add_to_delegation och close_case gäller det.',
  speak: (text: string, say: string) =>
    `Användaren skrev just detta (text, inte tal): «${text.slice(0, 800)}». Backend har svarat: «${say.slice(0, 1200)}». Säg det nu, högt, med egna ord men utan att lägga till eller ta bort något. Svara inte på frågan själv.`,
} as const
