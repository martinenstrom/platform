/**
 * Agent 11: Compliance & Risk Officer.
 *
 * Role: the final gate before publication, with the mandate to stop the
 * letter. Checks the draft against the publication checklist (see
 * `../qualityChecklist.ts`): no investment promises or guaranteed forecasts,
 * clear separation of fact/analysis/judgment, sources present, uncertainty
 * disclosed, balanced language, no individual advice, long-term horizon
 * stated, risks stated. Attaches the mandatory disclaimer. A "no" on any
 * checklist row must block publication — enforced by `pipeline.ts`, not just
 * described here.
 *
 * TODO(llm): a real implementation could combine the structural
 * `evaluatePublicationChecklist()` checks with an LLM doing a qualitative
 * read of tone and balance before setting `approved`.
 */

import { evaluatePublicationChecklist, MANDATORY_DISCLAIMER } from '../qualityChecklist'
import type {
  ComplianceReviewOutput,
  WeeklyLetterPipelineContext,
} from '~/types/investmentLetter'

export async function runComplianceRiskOfficerAgent(
  context: WeeklyLetterPipelineContext,
): Promise<ComplianceReviewOutput> {
  if (!context.draft) {
    throw new Error('Compliance review requires a draft from the Editorial Director.')
  }
  const checklist = evaluatePublicationChecklist(context.draft)
  return {
    checklist,
    approved: checklist.every((item) => item.passed),
    disclaimer: MANDATORY_DISCLAIMER,
  }
}
