/**
 * The decision, as the executive synthesis a Chairman receives.
 *
 * ## Built against the contract, not against a wish
 *
 * `CaseDecision` carries an outcome, a rationale, the submissions it decided,
 * the evidence set it was decided against, the dissent it retained, and the
 * authority it was taken under. This panel shows those and nothing else.
 *
 * Two things a decision panel is often expected to show do **not exist** in the
 * domain and are therefore absent rather than approximated:
 *
 *   **confidence** — composed per claim, never on a decision. There is no
 *   decision-level confidence to render and none is manufactured here.
 *
 *   **an investment action** — `CioDecisionOutcome` names a selected REVISION,
 *   not an instruction. Where a selected revision exists its statement is shown
 *   and labelled as the selected thesis, because that is what it is; presenting
 *   it as an action would invent a field the firm never recorded.
 *
 * ## Not the audit
 *
 * The full gate report, the review objects and the event trail belong to the
 * case-scoped Underlag route, which this links to. A compact panel that
 * reproduced the audit would be the report stack again, in a smaller box.
 */

import type { CaseOverview } from '~/application/analysis/caseOverview'
import type { CaseDecision } from '~/domain/analysis'
import { StatusBadge } from '~/components/ui/StatusBadge'
import { Inspect } from './Inspect'
import { formatDateTime } from '~/lib/format'

/** The firm's words for what the CIO did. */
const OUTCOME_LABEL: Record<string, string> = {
  selected: 'Firman tar positionen',
  deferred: 'Avvaktar',
  declined: 'Avstår',
}

export function CioDecisionPanel({
  decision,
  overview,
  onClose,
}: {
  decision: CaseDecision
  overview: CaseOverview
  onClose: () => void
}) {
  const selectedRevisionId =
    decision.outcome.kind === 'selected' ? decision.outcome.selectedRevisionId : null
  const selected = selectedRevisionId
    ? overview.revisions.find((revision) => revision.revisionId === selectedRevisionId)
    : undefined

  return (
    <aside className="brd-decision" aria-label="CIO:s beslut">
      <header className="brd-console-head">
        <span className="type-section">CIO · Beslut</span>
        <button type="button" onClick={onClose} className="brd-console-close">
          Stäng
        </button>
      </header>

      <StatusBadge tone={decision.outcome.kind === 'selected' ? 'positive' : 'neutral'}>
        {OUTCOME_LABEL[decision.outcome.kind] ?? decision.outcome.kind}
      </StatusBadge>

      {selected && (
        <section className="brd-decision-block">
          {/* Labelled as the thesis it is, never as an "action" the firm
           * did not record. */}
          <h3 className="type-section">Vald tes</h3>
          <p className="brd-decision-text">{selected.statement}</p>
        </section>
      )}

      <section className="brd-decision-block">
        <h3 className="type-section">Skäl</h3>
        <p className="brd-decision-text">{decision.rationale}</p>
      </section>

      {decision.unresolvedDissent.length > 0 && (
        <section className="brd-decision-block">
          {/*
           * The firm decided KNOWING somebody disagreed. Dropping this would
           * make the record describe an agreement that never happened.
           */}
          <h3 className="type-section">Kvarstående invändning</h3>
          {decision.unresolvedDissent.map((dissent) => (
            <div key={dissent.sourceId} className="brd-decision-dissent">
              {/* The objection in the words of whoever raised it, not a gloss. */}
              <p className="brd-decision-text">{dissent.rationale}</p>
              <Inspect>{dissent.sourceId}</Inspect>
            </div>
          ))}
        </section>
      )}

      <p className="type-metadata">
        {decision.decidedBy.employeeId} · {formatDateTime(decision.decidedAt)} ·{' '}
        {decision.authorizationBasis}
      </p>
      <Inspect>{decision.decisionId}</Inspect>

      <a href={`/cases/${overview.investmentCase.id}/underlag`} className="brd-console-link">
        Hela underlaget →
      </a>
    </aside>
  )
}
