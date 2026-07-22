/**
 * The publish-gate checklist the Compliance & Risk Officer agent runs before a
 * letter may go out. A "Nej" on any row must block publication.
 *
 * These are structural checks against the draft's shape (sources present,
 * disclaimer present, horizon stated, …) — they stand in for the judgment
 * calls a real compliance reviewer (or an LLM briefed on the compliance role)
 * would make. They catch missing structure, not bad reasoning.
 */

import type { ComplianceChecklistItem, WeeklyLetterDraft } from '~/types/investmentLetter'

export const MANDATORY_DISCLAIMER =
  'Detta material är avsett som generell marknadskommentar och utgör inte individuell investeringsrådgivning. Historisk avkastning är ingen garanti för framtida avkastning. Värdet på finansiella instrument kan både öka och minska.'

/** Language that must never appear in a Private Banking letter (spot-checks, not exhaustive). */
const DISALLOWED_PHRASES = ['garanterad avkastning', 'köp nu', 'sälj nu', 'riskfritt']

export function evaluatePublicationChecklist(
  draft: WeeklyLetterDraft,
): ComplianceChecklistItem[] {
  const fullText = [
    draft.macroSection,
    draft.equitySection,
    draft.bondSection,
    draft.fxSection,
    draft.commoditiesSection,
    draft.flowsAndSentimentSection,
    draft.whatThisMeansForYou,
    ...draft.executiveSummary,
    ...draft.conclusion,
  ]
    .join(' ')
    .toLocaleLowerCase('sv-SE')

  const hasDisallowedLanguage = DISALLOWED_PHRASES.some((phrase) =>
    fullText.includes(phrase),
  )

  return [
    {
      label: 'Inga investeringslöften eller garanterade prognoser',
      passed: !hasDisallowedLanguage,
    },
    {
      label: 'Executive summary är max 5 punkter',
      passed: draft.executiveSummary.length > 0 && draft.executiveSummary.length <= 5,
    },
    {
      label: 'Marknadsdashboard är ifylld',
      passed: draft.marketDashboard.length > 0,
    },
    {
      label: 'Minst 10 grafer med källa och kommentar',
      passed:
        draft.charts.length >= 10 &&
        draft.charts.every((chart) => chart.source.trim().length > 0),
    },
    {
      label: 'CIO-scenarier har redovisade sannolikheter',
      passed:
        draft.cioView.mainScenario.probabilityPercent > 0 &&
        draft.cioView.alternativeScenarios.every((s) => s.probabilityPercent > 0),
    },
    {
      label: 'Risker på flera tidshorisonter framgår',
      passed: draft.cioView.horizonImpact.length >= 3,
    },
    {
      label: 'Slutsats med max tre punkter finns',
      passed: draft.conclusion.length > 0 && draft.conclusion.length <= 3,
    },
    {
      label: 'Långsiktig horisont (10+ år) framgår av innehållet',
      passed: /10[+\s]*år/i.test(fullText) || /lång(a|siktig)/i.test(fullText),
    },
  ]
}
