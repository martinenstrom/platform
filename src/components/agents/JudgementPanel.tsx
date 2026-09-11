import { useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { DashboardCard } from '~/components/ui/DashboardCard'
import { Button } from '~/components/ui/Button'
import { StatusBadge } from '~/components/ui/StatusBadge'
import { ActingAsPanel, useActingAs } from './ActingAs'
import {
  REJECTION_CODE_LABEL,
  rejectedByText,
  runStateText,
} from '~/presentation/analysis/runText'
import {
  acceptContributionFn,
  rejectContributionFn,
} from '~/infrastructure/analysis/serverFns'
import type { ActResponse } from '~/infrastructure/analysis/serverFns'
import type { OperatorIdentity } from '~/application/analysis/operatorIdentity'
import type { RunReview } from '~/application/analysis/runReview'
import type { ContributionRejectionCode } from '~/domain/analysis'

/**
 * The decision.
 *
 * Two acts, both through the commands that have existed since C2-1, both
 * signed by a named employee of the firm. What this panel adds is that a person
 * can now perform them — and that before they do, they are told in plain terms
 * what each one means, because "accept" and "reject" are not self-explanatory
 * when the difference is whether something becomes citable institutional
 * evidence forever.
 *
 * ## It decides nothing itself
 *
 * Whether the work can still be judged comes from the read model, which reads
 * it from the run's own state machine. Whether this operator may judge it is
 * decided by the institution when the command runs. This panel renders the
 * question and reports the answer.
 */
export function JudgementPanel({
  review,
  identities,
}: {
  review: RunReview
  identities: readonly OperatorIdentity[]
}) {
  const router = useRouter()
  const actingAs = useActingAs()
  const [pending, setPending] = useState<'accept' | 'reject' | null>(null)
  const [result, setResult] = useState<ActResponse | null>(null)
  const [code, setCode] = useState<ContributionRejectionCode>('unsupported-by-evidence')
  const [detail, setDetail] = useState('')

  /* Already settled: report what was decided, and offer nothing. */
  if (review.decision.kind === 'settled') {
    return <SettledPanel review={review} />
  }

  const act = async (
    which: 'accept' | 'reject',
    run: () => Promise<ActResponse>,
  ): Promise<void> => {
    setPending(which)
    setResult(null)
    try {
      const outcome = await run()
      setResult(outcome)
      /*
       * Re-read rather than patch local state. The run's new state, its events
       * and — for an acceptance — a case that now holds institutional claims are
       * all facts the server owns, and a page that updated itself from the
       * response would be maintaining a second copy of them.
       */
      if (outcome.ok) await router.invalidate()
    } finally {
      setPending(null)
    }
  }

  return (
    <DashboardCard title="Ditt beslut">
      <div className="flex flex-col gap-6">
        {/*
         * What the two acts mean, before the buttons that perform them. The
         * asymmetry is the point: acceptance is what makes work citable, and
         * rejection is permanent in the opposite direction.
         */}
        <div className="flex flex-col gap-2">
          <p className="text-sm leading-relaxed text-content-muted">
            <strong className="text-content">Godkänner du</strong> blir påståendena
            institutionella: de kan granskas, ifrågasättas, vägas samman och åberopas i
            beslutsunderlag. Firman står bakom dem.
          </p>
          <p className="text-sm leading-relaxed text-content-muted">
            <strong className="text-content">Avvisar du</strong> blir arbetet kvar som
            historik — läsbart, mätbart och för alltid utan möjlighet att åberopas. Inget
            återanvänds. Skälet du skriver är det enda som gör nästa försök bättre.
          </p>
        </div>

        <ActingAsPanel
          identities={identities}
          owningDepartmentName={review.department.name}
        />

        {/* ------------------------------------------------------- accept */}

        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="primary"
            size="sm"
            disabled={actingAs === null || pending !== null}
            onClick={() =>
              act('accept', () =>
                acceptContributionFn({
                  data: { runId: review.run.id, actingEmployeeId: actingAs! },
                }),
              )
            }
          >
            {pending === 'accept' ? 'Godkänner…' : 'Godkänn arbetet'}
          </Button>
          {actingAs === null && (
            <span className="type-metadata">Välj vem du agerar som först.</span>
          )}
        </div>

        {/* ------------------------------------------------------- reject */}

        <form
          className="flex flex-col gap-3 border-t border-line pt-5"
          onSubmit={(event) => {
            event.preventDefault()
            if (actingAs === null) return
            void act('reject', () =>
              rejectContributionFn({
                data: {
                  runId: review.run.id,
                  actingEmployeeId: actingAs,
                  code,
                  detail,
                },
              }),
            )
          }}
        >
          <label htmlFor="rejection-code" className="text-sm font-medium">
            Avvisa — vad var fel?
          </label>
          <select
            id="rejection-code"
            value={code}
            onChange={(event) => setCode(event.target.value as ContributionRejectionCode)}
            className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-content"
          >
            {/*
             * The firm's vocabulary, as the read model hands it over. Imported
             * here it would be a second copy of a list that exists to be
             * counted over years — and a component that held its own would be
             * free to drift from the codes the command accepts.
             */}
            {review.rejectionCodes.map((candidate) => (
              <option key={candidate} value={candidate}>
                {REJECTION_CODE_LABEL[candidate]}
              </option>
            ))}
          </select>

          <label htmlFor="rejection-detail" className="text-sm font-medium">
            Motivering
          </label>
          {/*
           * `required` is a form affordance, not the rule. The command refuses
           * an empty explanation regardless — a rejection nobody can learn from
           * is the discarded history the record exists to prevent.
           */}
          <textarea
            id="rejection-detail"
            required
            rows={3}
            value={detail}
            onChange={(event) => setDetail(event.target.value)}
            placeholder="Vad behöver vara annorlunda nästa gång?"
            className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-content"
          />
          <p className="type-metadata">
            Koden räknas över år — vilka agenter som avvisas, varför, och om de blir
            bättre. Motiveringen är det ingen kod kan bära.
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="submit"
              variant="secondary"
              size="sm"
              disabled={actingAs === null || pending !== null}
            >
              {pending === 'reject' ? 'Avvisar…' : 'Avvisa arbetet'}
            </Button>
          </div>
        </form>

        {result && <Outcome result={result} />}
      </div>
    </DashboardCard>
  )
}

/**
 * What the institution answered.
 *
 * A refusal is reported as the firm declining, never as a system error. The two
 * lead a person to completely different next actions: one means pick the right
 * desk, the other means go and look at the logs.
 */
function Outcome({ result }: { result: ActResponse }) {
  if (result.ok) {
    const state = runStateText(result.state)
    return (
      <p className="flex flex-wrap items-center gap-2 text-sm">
        Klart. Körningen är nu <StatusBadge tone={state.tone}>{state.label}</StatusBadge>
      </p>
    )
  }

  if (result.outcome === 'refused') {
    return (
      <p className="text-sm text-warning">
        {REFUSAL_TEXT[result.code] ?? 'Firman genomförde inte handlingen.'}
      </p>
    )
  }

  return (
    <p className="text-sm text-negative">
      Handlingen kunde inte genomföras. Ingenting bokfördes — försök igen.
    </p>
  )
}

/**
 * The firm's refusals, in words.
 *
 * Bounded codes in, a sentence out — and each says what to do about it, because
 * a refusal a person cannot act on is indistinguishable from a fault.
 */
const REFUSAL_TEXT: Record<string, string> = {
  'not-authorised':
    'Den du agerar som har inte mandat att bedöma det här arbetet. Bara den ägande avdelningen kan det.',
  'unknown-actor': 'Den du agerar som är inte anställd i firman.',
  'illegal-prior-state':
    'Körningen väntar inte längre på ett beslut — någon annan har hunnit före.',
  'not-found': 'Körningen eller ärendet finns inte längre.',
  'invariant-violated':
    'Handlingen bröt mot en regel firman upprätthåller. En avvisning kräver både en kod och en motivering.',
  'aggregate-conflict': 'Ärendet har ändrats under tiden. Läs om sidan och försök igen.',
  'payload-conflict':
    'Ett tidigare försök med samma identitet hade ett annat innehåll. Ändra motiveringen eller läs om sidan.',
}

/** Work that has already been judged, or that never reached a judgement. */
function SettledPanel({ review }: { review: RunReview }) {
  const state = runStateText(review.run.state)
  const rejection = review.run.rejection

  return (
    <DashboardCard title="Beslutat">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge tone={state.tone}>{state.label}</StatusBadge>
          {review.run.completedAt && (
            <span className="type-metadata">{review.run.completedAt}</span>
          )}
        </div>

        {rejection ? (
          <div className="flex flex-col gap-1">
            <span className="text-sm">{REJECTION_CODE_LABEL[rejection.code]}</span>
            <span className="type-metadata">{rejection.detail}</span>
            <span className="type-metadata">
              Avvisat av {rejectedByText(rejection)}
            </span>
            <p className="mt-2 text-sm text-content-muted">
              Arbetet finns kvar som historik och kan aldrig åberopas som underlag.
            </p>
          </div>
        ) : review.run.state === 'completed' ? (
          <p className="text-sm text-content-muted">
            Påståendena är institutionella och kan åberopas i ärendets beslutsunderlag.
          </p>
        ) : (
          <p className="text-sm text-content-muted">
            Körningen nådde aldrig fram till ett beslut, så det finns inget att bedöma.
          </p>
        )}
      </div>
    </DashboardCard>
  )
}
