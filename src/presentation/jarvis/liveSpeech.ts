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

import type { HostResult } from '~/application/analysis/hostContract'
import type { DomainReference } from '~/application/analysis/domainSystem'
import type { UnsupportedToolReason } from '~/application/jarvis/liveTools'
import { answerLines, phrase } from './hostStateText'

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

/** A host result, as the voice may relay it. */
export function toolSpeech(result: HostResult): ToolSpeech {
  const spoken = phrase(result)
  const reference = 'reference' in result && result.reference ? result.reference : null
  switch (result.state) {
    case 'working':
      return {
        state: result.state,
        say: `${WORKING_ACKNOWLEDGEMENT} ${spoken.detail ?? ''}`.trim(),
        acknowledgeWork: true,
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
  'context-not-supported':
    'Det går inte att lägga till i ärendet ännu; jag har det i samtalet.',
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
Språkregel, utan undantag: svenska in → svenska ut. Talar användaren engelska svarar du på engelska — även "One moment." — och byter tillbaka till svenska först när användaren gör det. Blandat → svenska, med engelska namn och finanstermer oförändrade och naturligt uttalade: Nvidia, Fed, ECB, CPI, Treasury, duration, yield curve, equity risk premium, earnings yield, term premium, higher for longer. Det backend ber dig förmedla säger du på det språk användaren senast använde, översatt om det behövs.
Karaktär: lugn, intelligent, självsäker, varm men återhållsam, mänsklig, närvarande, lite levande. Inte teatralisk, inte radioröst, inte kundtjänst, ingen överdriven entusiasm, aldrig mångordig. Korta svar på enkla frågor.
Medan användaren tydligt fortsätter tala: var tyst. Inga "ehm", inga fyllnadsord. När turen verkligen är slut: svara snabbt och säkert.
Svara själv, direkt, på enkla frågor, definitioner, uppföljningar och småprat. Delegera till backend när frågan kräver djupare resonemang, och ALLTID när det är en investeringsbedömning: köpa, sälja, minska, öka, en position, ett bolag eller en fond givet makro. Sådant avgörs av investeringskommittén i Financial OS, aldrig av dig.
När du lämnar över till backend: säg högst "Ett ögonblick." eller ingenting, och vänta. Säg ALDRIG själv "Jag kollar på det och återkommer" eller något som lovar att du återkommer — det får bara komma från backend, som säger det när kommittén faktiskt arbetar; då förmedlar du det en gång. Säger backend att ett beslut behövs av användaren, att något hindrar, eller att det inte gick, förmedlar du det rakt och lovar inget.
Påstå aldrig att kommittén är klar eller vad den kom fram till förrän backend gett ett resultat. Läs aldrig upp tekniska id:n, referenser eller verktygsnamn.`

/**
 * The backend model's instructions: the reasoning layer behind the voice.
 * It answers understanding itself; it never answers an investment judgement
 * itself; and it relays tool results without adding to them.
 */
export const LIVE_BACKEND_INSTRUCTIONS = `Du är JARVIS resonerande lager bakom rösten. Du får samtalets kontext från röstlagret. Svara på användarens språk — svenska om inte användaren talar engelska — med engelska finanstermer oförändrade, i kort talat format: inga listor, inga id:n.
Regler:
1. Investeringsbedömningar (köp/sälj/minska/öka, positioner, bolag eller fond givet makro) lämnas ALLTID till delegate_to_financial_os. Ge aldrig en egen slutsats om sådant.
2. Frågor om var ett ärende står: check_delegation. Frågor om vad kommittén kom fram till: get_delegation_result. Tillägg till ett pågående ärende: add_to_delegation.
3. Allmänna finansfrågor (vad är term premium, hur påverkar duration en obligation) besvarar du själv, kort och korrekt, utan att lova att återkomma.
4. Verktygssvar innehåller "say" på svenska och två flaggor. Förmedla "say" — översatt till engelska om användaren talar engelska — och lägg inte till något resultat verktyget inte gav. Är acknowledgeWork false får du inte säga att du återkommer. Är decisionRequired true säger du tydligt att användaren behöver besluta något.`
