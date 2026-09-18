/**
 * What JARVIS says, for each thing the firm can tell it.
 *
 * Financial OS answers in six typed product states and a handful of typed
 * reasons. It never speaks to the person; this is where those states become
 * sentences, and the one place they do. The firm stays free to change how it
 * derives a state without any of these words moving, and these words stay
 * free to change without the firm knowing.
 *
 * ## Three sentences that must never be the same
 *
 * The firm having work, the firm being unable to proceed, and the firm
 * needing the person are three different situations, and the wrong sentence
 * for any of them is a lie the person will act on. `working` promises a
 * return; `blocked` promises nothing and says why; `needs-decision` asks.
 *
 * ## Exhaustive, never defaulted
 *
 * Every table below is keyed by the union it phrases, with no fallback. A
 * reason the contract adds tomorrow fails the typecheck here rather than
 * rendering as a blank the person cannot act on.
 */

import type {
  BlockedReason,
  FailureReason,
  HostClosure,
  HostDecision,
  HostInspection,
  HostResult,
  InstitutionalAnswer,
  UnsupportedReason,
} from '~/application/analysis/hostContract'
import type { Tone } from '~/types'

export interface Phrasing {
  headline: string
  detail?: string
  tone: Tone
}

const BLOCKED: Record<BlockedReason, string> = {
  'execution-recovery-required':
    'En körning avbröts utan att avslutas och behöver återställas av firman.',
  'adoption-required': 'Ett arbete är färdigt men ännu inte antaget av sitt bord.',
  'analysis-required': 'Ett bords analys saknas eller misslyckades.',
  'synthesis-required': 'Research Office har inte vägt samman bordens arbete.',
  'peer-scrutiny-required': 'Den kollegiala granskningen är inte gjord.',
  'verification-required': 'Faktagranskningen är inte gjord.',
  'challenge-required': "Devil's Advocate har inte prövat argumentet.",
  'risk-review-required': 'Riskgranskningen är inte gjord.',
  'objections-unresolved': 'En invändning som avgör svaret är fortfarande öppen.',
  'returned-for-revision':
    'CIO skickade tillbaka arbetet, och borden har inte lämnat in igen.',
  'institutional-requirement-outstanding': 'Ett institutionellt krav är inte uppfyllt.',
}

/*
 * The one question JARVIS may ask before the committee starts on a capital
 * question — ruled 2026-09-17, after a conversation that asked five times for
 * a thesis, a scope and a formal approval. An explanation never reaches this
 * sentence: the firm opens on it at once. A position reaches it once, and any
 * reasonable answer — the person's own view, or "pröva den öppet", or "kör"
 * — walks through the door.
 */
const DECISION: Record<HostDecision['reason'], string> = {
  'institutional-initialization-required':
    'Vill du att de utgår från din egen syn — och vad är huvudskälet — eller prövar frågan helt öppet?',
  'cio-decision-required': 'Ärendet ligger hos CIO för beslut.',
}

const UNSUPPORTED: Record<UnsupportedReason, string> = {
  'unknown-reference': 'Jag hittar inget ärende som svarar mot det.',
  'not-routable': 'Firman har ingen godkänd arbetsgång för den sortens fråga ännu.',
  'unknown-desk': 'Firman har inget sådant bord.',
  'no-institutional-conclusion': 'Ärendet är avslutat utan en slutsats jag kan återge.',
}

const FAILURE: Record<FailureReason, string> = {
  'invalid-request': 'Frågan gick inte att ställa som den var formulerad.',
  'operator-unresolved':
    'Ingen operatör är konfigurerad, så jag kan inte ställa frågan i någons namn.',
  'convening-incomplete': 'Frågan är registrerad, men kommittén kunde inte sammankallas.',
  'not-configured': 'Analysmiljön saknar databaskonfiguration.',
  'service-unavailable': 'Analysmiljön svarar inte just nu.',
  'case-settled': 'Ärendet är redan avslutat, så det går inte att ändra.',
  refused: 'Firman avböjde.',
}

const CLOSURE: Record<HostClosure['kind'], string> = {
  cancelled: 'Pågående arbete avbröts',
  abandoned: 'Lades ner innan något arbete gjorts',
}

const OUTCOME: Record<'selected' | 'deferred' | 'declined', string> = {
  selected: 'position tagen',
  deferred: 'bordlagt',
  declined: 'avslaget',
}

/** The sentence for a result, and the tone it is said in. */
export function phrase(result: HostResult): Phrasing {
  switch (result.state) {
    case 'working': {
      const desks = result.activity.desks.map((desk) => desk.name).join(' · ')
      return {
        headline: 'Jag kollar på det.',
        detail: desks
          ? `Investeringskommittén arbetar · ${desks}`
          : 'Investeringskommittén arbetar',
        tone: 'accent',
      }
    }
    case 'answer-ready':
      return {
        headline: 'Jag är klar.',
        detail:
          result.kind === 'cio-decision'
            ? 'CIO-beslutet är klart.'
            : 'Kommitténs slutsats är klar.',
        tone: 'positive',
      }
    case 'blocked': {
      const owner = result.block.owner ? ` Ligger hos ${result.block.owner.name}.` : ''
      /* A failed run is said, not folded into the step it left owed. */
      const failed = result.activity.failed > 0 ? ' Ett bord kunde inte slutföra sitt arbete.' : ''
      return {
        headline: 'Analysen kan inte fortsätta just nu.',
        detail: `${BLOCKED[result.block.reason]}${owner}${failed}`,
        tone: 'warning',
      }
    }
    case 'needs-decision':
      return {
        headline:
          result.decision.reason === 'institutional-initialization-required'
            ? 'En sak innan de sätter igång.'
            : 'Jag behöver ditt beslut på en sak.',
        detail: DECISION[result.decision.reason],
        tone: 'warning',
      }
    case 'closed': {
      const reason = result.closure.reason ? ` — ${result.closure.reason}` : ''
      const by = result.closure.byDesk ? ` (${result.closure.byDesk.name})` : ''
      return {
        headline: 'Ärendet är stängt.',
        detail: `${CLOSURE[result.closure.kind]}${reason}${by}`,
        tone: 'neutral',
      }
    }
    case 'unsupported':
      return {
        headline: 'Det kan jag inte låta investeringsteamet ta just nu.',
        detail: UNSUPPORTED[result.reason],
        tone: 'neutral',
      }
    case 'failed': {
      const remedy = result.resumable
        ? ' Jag kan försöka återuppta sammankallningen.'
        : ''
      const code = result.code ? ` (${result.code})` : ''
      return {
        headline: 'Något gick inte igenom.',
        detail: `${FAILURE[result.reason]}${code}${remedy}`,
        tone: 'negative',
      }
    }
  }
}

/**
 * The person's additions, as one line — or nothing, where there are none.
 *
 * Said beside any state, because the one thing a person must hear about an
 * addition is whether the work already done took it into account.
 */
export function amendmentLine(result: HostResult): string | null {
  if (!('amendments' in result) || result.amendments.count === 0) return null
  const count =
    result.amendments.count === 1 ? 'Ett tillägg' : `${result.amendments.count} tillägg`
  return result.amendments.workPredates
    ? `${count} sedan ärendet öppnades; det arbete som redan gjorts tar inte hänsyn till det senaste.`
    : `${count} sedan ärendet öppnades.`
}

/**
 * The institution's result, as lines a person reads. Read off the typed
 * answer; nothing is summarised, and dissent is never left out.
 */
export function answerLines(answer: InstitutionalAnswer): string[] {
  const dissent = (count: number) =>
    count === 0
      ? 'Ingen materiell invändning kvarstår.'
      : count === 1
        ? 'En materiell invändning kvarstår.'
        : `${count} materiella invändningar kvarstår.`

  if (answer.kind === 'committee-conclusion') {
    return [
      `Kommitténs slutsats är ${answer.thesis.position}: ${answer.thesis.statement}`,
      `Synen skulle ändras om: ${answer.thesis.invalidationCriteria}`,
      dissent(answer.materialDissentCount),
      ...answer.dissent.map(
        (objection) => `Invändning (${objection.byDepartmentId}): ${objection.argument}`,
      ),
    ]
  }

  return [
    `CIO-beslutet är ${OUTCOME[answer.decision.outcome]}: ${answer.decision.rationale}`,
    ...(answer.thesis
      ? [`Vald tes (${answer.thesis.position}): ${answer.thesis.statement}`]
      : []),
    dissent(answer.materialDissentCount),
    ...answer.dissent.map((entry) => `Invändning: ${entry.rationale}`),
    ...(answer.reconsiderationTriggers.length > 0
      ? [`${answer.reconsiderationTriggers.length} villkor skulle öppna ärendet igen.`]
      : []),
  ]
}

/** Deeper material, as lines a person reads. */
export function inspectionLines(inspection: HostInspection): string[] {
  switch (inspection.view) {
    case 'debate': {
      const acted = inspection.seats.filter(
        (seat) => seat.participation === 'acted',
      ).length
      return [
        `${inspection.entries.length} institutionella akter i rummet; ${acted} bord har agerat.`,
      ]
    }
    case 'objections': {
      const open = inspection.objections.filter(
        (objection) => objection.outcome === 'open',
      )
      return [
        `${open.length} öppna invändningar av ${inspection.objections.length}.`,
        ...open.map((objection) => `${objection.byDepartmentId}: ${objection.argument}`),
      ]
    }
    case 'desk':
      return inspection.claims.length === 0
        ? [`${inspection.desk.name} har inte sagt något i ärendet.`]
        : inspection.claims.map((claim) => `${inspection.desk.name}: ${claim.statement}`)
  }
}
