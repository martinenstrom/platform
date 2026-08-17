import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { DashboardCard } from '~/components/ui/DashboardCard'
import { Button } from '~/components/ui/Button'
import { StatusBadge } from '~/components/ui/StatusBadge'
import { ActingAsPanel, useActingAs } from './ActingAs'
import { RunStateBadge } from './RunStateBadge'
import {
  COMMISSION_ACT_REFUSAL_LABEL,
  COMMISSION_DECLINE_TEXT,
  CASE_STAGE_LABEL,
  commissionRefusalText,
  evidenceOfferText,
} from '~/presentation/analysis/commissionText'
import { budgetText, RUN_FAILURE_LABEL } from '~/presentation/analysis/runText'
import { commissionAnalysisFn } from '~/infrastructure/analysis/serverFns'
import type { CommissionResponse } from '~/infrastructure/analysis/serverFns'
import type {
  CommissionableCase,
  CommissionBrief,
} from '~/application/analysis/commissionAnalysis'
import type { OperatorIdentity } from '~/application/analysis/operatorIdentity'

/**
 * Commissioning a real analysis.
 *
 * The act C2-1 built, C2-2 Stage B made judgeable, and nobody could start
 * without a hard-coded route. Three explicit choices and a named operator: the
 * case the firm is asking about, the evidence the desk will reason over, and
 * who the act is booked to.
 *
 * ## Nothing is chosen for the operator
 *
 * No case is preselected and no evidence set is preselected, deliberately. This
 * button spends money against a real model and produces a durable institutional
 * record, and a default selection is how somebody commissions work against the
 * wrong question by pressing the obvious control.
 *
 * ## Ineligible choices are shown, not hidden
 *
 * A case the firm will not take this work against stays on the page with the
 * institution's own reason beside it. Filtering it out would leave a person
 * looking for a case they know exists, and — worse — would put the eligibility
 * decision in the layer that renders the list. The read model decided; this
 * renders what it decided.
 *
 * ## It computes nothing
 *
 * Eligibility, the authorized budget, and what came of the run are all read
 * from the boundary. This panel arranges them and reports the answer.
 */
export function CommissionPanel({
  brief,
  identities,
}: {
  brief: CommissionBrief
  identities: readonly OperatorIdentity[]
}) {
  const actingAs = useActingAs()
  const [caseId, setCaseId] = useState<string | null>(null)
  const [evidenceSetId, setEvidenceSetId] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [response, setResponse] = useState<CommissionResponse | null>(null)

  const selectedCase = brief.cases.find(
    (candidate) => candidate.investmentCase.id === caseId,
  )
  const selectedEligibility =
    selectedCase?.eligibility.kind === 'eligible' ? selectedCase.eligibility : null

  const ready =
    actingAs !== null &&
    selectedEligibility !== null &&
    evidenceSetId !== null &&
    !pending

  const commission = async () => {
    if (!ready || !selectedCase || evidenceSetId === null || actingAs === null) return
    setPending(true)
    setResponse(null)
    try {
      setResponse(
        await commissionAnalysisFn({
          data: {
            caseId: selectedCase.investmentCase.id,
            departmentId: brief.desk.departmentId,
            entryKey: brief.entryKey,
            evidenceSetId,
            actingEmployeeId: actingAs,
          },
        }),
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      {/* ============================================= what is being ordered == */}
      <DashboardCard title="Vad du beställer">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium">{brief.desk.name}</span>
            <span className="type-metadata">
              {brief.desk.manager.displayName} · {brief.desk.manager.roleTitle}
            </span>
            {/*
             * That this costs money, before anything else on the page. The
             * authorized amount appears once a case is chosen, because the
             * authorization belongs to the case's workflow version and stating
             * one before that would state a number no run would use.
             */}
            <StatusBadge tone="warning">Live · kostar riktiga pengar</StatusBadge>
          </div>

          <div className="flex flex-col gap-1">
            <span className="type-metadata">Uppdraget avdelningen får</span>
            <p className="text-sm leading-relaxed text-content">{brief.currentBrief}</p>
            <span className="type-metadata">{brief.entryKey}</span>
          </div>

          <p className="text-sm leading-relaxed text-content-muted">
            Beställningen startar{' '}
            <strong className="text-content">en riktig körning</strong> hos en
            språkmodell. Arbetet som kommer tillbaka är{' '}
            <strong className="text-content">producerat, inte firmans ståndpunkt</strong>{' '}
            — det måste godkännas av en människa innan det kan åberopas.
          </p>
        </div>
      </DashboardCard>

      {/* ========================================================== the case == */}
      <DashboardCard title={`Ärende (${brief.cases.length})`}>
        {brief.cases.length === 0 ? (
          <p className="text-sm text-content-muted">
            Firman håller inga ärenden. Ett ärende öppnas som en egen institutionell
            handling och kan inte skapas härifrån.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {brief.cases.map((candidate) => (
              <CaseChoice
                key={candidate.investmentCase.id}
                candidate={candidate}
                selected={candidate.investmentCase.id === caseId}
                onSelect={() => setCaseId(candidate.investmentCase.id)}
              />
            ))}
          </ul>
        )}
      </DashboardCard>

      {/* ====================================================== the evidence == */}
      <DashboardCard title={`Underlag firman håller (${brief.evidence.length})`}>
        {brief.evidence.length === 0 ? (
          /*
           * The stage ruling, on screen. Where the institution holds no
           * evidence, commissioning is refused rather than demonstrated against
           * something invented for the occasion.
           */
          <p className="text-sm text-content-muted">
            Firman håller inget institutionellt underlag. Utan underlag beställs inget
            arbete — en analys utan observationer är ett påstående, inte en analys.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {brief.evidence.map((offer) => {
              const text = evidenceOfferText(offer)
              const eligible = offer.eligibility.kind === 'eligible'
              return (
                <li key={offer.evidenceSetId} className="py-3">
                  <label className="flex cursor-pointer items-start gap-3">
                    <input
                      type="radio"
                      name="evidence-set"
                      className="mt-1"
                      disabled={!eligible}
                      checked={offer.evidenceSetId === evidenceSetId}
                      onChange={() => setEvidenceSetId(offer.evidenceSetId)}
                    />
                    <span className="flex flex-col gap-1">
                      <span className="text-sm">{text.summary}</span>
                      <span className="type-metadata tabular">
                        {offer.evidenceSetId.slice(0, 12)}… · sammanställt{' '}
                        {offer.assembledAt}
                      </span>
                      {text.refusal && (
                        <span className="type-metadata text-warning">{text.refusal}</span>
                      )}
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
        )}
      </DashboardCard>

      {/* ========================================================= the order == */}
      <DashboardCard title="Beställ">
        <div className="flex flex-col gap-6">
          <ActingAsPanel identities={identities} owningDepartmentName={brief.desk.name} />

          {/*
           * The authorization, from the case that would run under it. Read off
           * the read model's resolved budget rather than off the playbook, so
           * what is shown is the number the run will actually record.
           */}
          {selectedEligibility && (
            <div className="flex flex-col gap-1">
              <span className="type-metadata">
                Firman godkänner för den här körningen
              </span>
              <span className="text-sm tabular">
                {budgetText(selectedEligibility.budget).join(' · ')}
              </span>
              <span className="type-metadata">
                Beloppet är ett godkännande, inte en mätning: leverantören rapporterar
                tokens men inget pris, så ingen kostnadsgräns kan kontrolleras mot utfall.
              </span>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="primary"
              size="sm"
              disabled={!ready}
              onClick={() => void commission()}
            >
              {pending ? 'Kör…' : 'Beställ analys'}
            </Button>
            {!ready && !pending && (
              <span className="type-metadata">
                {whatIsMissing(actingAs, selectedCase, evidenceSetId)}
              </span>
            )}
            {pending && (
              /*
               * No percentage, no progress bar. Nothing is being measured, and
               * a moving bar would be an invented fact about work whose only
               * honest description is that it has not finished.
               */
              <span className="type-metadata">
                Körningen pågår. Sidan väntar tills firman har bokfört ett resultat.
              </span>
            )}
          </div>

          {response && <Outcome response={response} />}
        </div>
      </DashboardCard>
    </>
  )
}

/** Which of the three explicit choices is still missing. */
function whatIsMissing(
  actingAs: string | null,
  selectedCase: CommissionableCase | undefined,
  evidenceSetId: string | null,
): string {
  if (!selectedCase) return 'Välj ett ärende.'
  if (selectedCase.eligibility.kind === 'refused') {
    return 'Det valda ärendet kan inte ta emot det här arbetet.'
  }
  if (evidenceSetId === null) return 'Välj vilket underlag avdelningen ska få.'
  if (actingAs === null) return 'Välj vem du agerar som.'
  return ''
}

/** One case, with the institution's answer about it stated beside it. */
function CaseChoice({
  candidate,
  selected,
  onSelect,
}: {
  candidate: CommissionableCase
  selected: boolean
  onSelect: () => void
}) {
  const eligible = candidate.eligibility.kind === 'eligible'
  const { investmentCase } = candidate

  return (
    <li className="py-3">
      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="radio"
          name="investment-case"
          className="mt-1"
          disabled={!eligible}
          checked={selected}
          onChange={onSelect}
        />
        <span className="flex flex-col gap-1">
          <span className="text-sm">{investmentCase.question}</span>
          <span className="type-metadata">
            {investmentCase.subject.displayName} ·{' '}
            {CASE_STAGE_LABEL[investmentCase.stage] ?? investmentCase.stage}
            {candidate.playbookId
              ? ` · ${candidate.playbookId} v${candidate.playbookVersion}`
              : ' · inget arbetsflöde'}
          </span>
          {!eligible && (
            /*
             * The firm's reason, in full. A disabled row with no explanation is
             * indistinguishable from a broken one, and the commonest reason
             * here — a case pinned to a workflow version that authorizes no
             * budget — is the budget design working rather than a fault.
             */
            <span className="type-metadata text-warning">
              {commissionRefusalText(candidate.eligibility)}
            </span>
          )}
        </span>
      </label>
    </li>
  )
}

/**
 * What the institution did.
 *
 * Three shapes, kept apart. A run that exists is the one that leads somewhere:
 * it ends with the route to the decision it is now waiting for, which is the
 * link that makes commissioning and judging one journey rather than two
 * screens.
 */
function Outcome({ response }: { response: CommissionResponse }) {
  if (!response.ok) {
    return (
      <p className="text-sm text-negative">
        {response.code === 'NO_MODEL_CREDENTIAL'
          ? 'Ingen modellnyckel är konfigurerad, så ingen live-körning kan beställas. Ingenting bokfördes.'
          : 'Beställningen kunde inte genomföras. Ingenting bokfördes.'}
      </p>
    )
  }

  const { result } = response

  if (result.outcome === 'refused') {
    return (
      <p className="text-sm text-warning">
        {COMMISSION_ACT_REFUSAL_LABEL[result.reason]}
      </p>
    )
  }

  if (result.outcome === 'declined') {
    return (
      <p className="text-sm text-warning">
        {COMMISSION_DECLINE_TEXT[result.code] ?? 'Firman genomförde inte beställningen.'}
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-3 border-t border-line pt-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm">Körningen är bokförd.</span>
        <RunStateBadge state={result.state} />
      </div>

      {result.failureCategory ? (
        <p className="text-sm text-content-muted">
          {RUN_FAILURE_LABEL[result.failureCategory]} — körningen finns kvar som
          institutionell historik, men den producerade inget att bedöma.
        </p>
      ) : (
        <p className="text-sm text-content-muted">
          Arbetet är producerat och betalt, och väntar på ett mänskligt beslut innan det
          kan åberopas.
        </p>
      )}

      {/*
       * Where to go next, as a link rather than a redirect. The person who
       * commissioned the work is the person who now owes it a decision, and
       * navigating for them would take the choice of when away.
       */}
      <Link
        to="/runs/$runId"
        params={{ runId: result.runId }}
        className="text-sm text-accent hover:underline"
      >
        Granska och besluta
      </Link>
    </div>
  )
}
