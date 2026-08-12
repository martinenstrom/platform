/**
 * Where the case stands, above everything it contains.
 *
 * The first thing a reader sees, because the first question is never "what
 * claims are in this" — it is "whose desk is this on and what happens next".
 *
 * ## The rule this component exists to honour
 *
 * If two institutional states would lead to different obligations, they must
 * not render as the same visual state. Applied here in three places:
 *
 *   - a step that is `not-applicable` does not look like one that is `complete`
 *   - a settled case shows *no owner*, not a blank owner
 *   - "nothing outstanding" and "not judged yet" are different sentences
 *
 * Every label comes from the presentation mapping. No wording is composed from
 * a code here, because a component that builds a sentence out of an identifier
 * becomes the place the identifier's meaning is defined.
 */

import { Check, CircleDashed, Minus, TriangleAlert } from 'lucide-react'
import { DashboardCard } from '~/components/ui/DashboardCard'
import { StatusBadge } from '~/components/ui/StatusBadge'
import { cn } from '~/lib/cn'
import { toneText } from '~/lib/tone'
import type { CaseStanding, StepStatus } from '~/domain/analysis'
import {
  ACT_LABEL,
  ownershipText,
  STAGE_LABEL,
  STAGE_TONE,
  STEP_LABEL,
  STEP_STATUS,
} from '~/presentation/analysis/caseStandingText'

/**
 * Three states, three marks.
 *
 * Deliberately not a checkmark with a colour change: colour alone is not a
 * distinction for a reader who cannot see it, and these three carry different
 * obligations. A dash means the firm ruled the control was not owed; a hollow
 * ring means it is still owed.
 */
const STEP_MARK: Record<StepStatus, typeof Check> = {
  complete: Check,
  outstanding: CircleDashed,
  'not-applicable': Minus,
}

export function CaseStandingPanel({ standing }: { standing: CaseStanding }) {
  const owner = ownershipText(standing.ownership)
  const outstanding = standing.steps.filter((entry) => entry.status === 'outstanding')

  return (
    <DashboardCard title="Ärendets ställning">
      <div className="flex flex-col gap-6">
        {/* ---------------------------------------------- where, and with whom */}
        <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
          <Field label="Läge">
            <StatusBadge tone={STAGE_TONE[standing.stage]}>
              {STAGE_LABEL[standing.stage]}
            </StatusBadge>
          </Field>

          <Field label="Ansvarig nu">
            {owner === null ? (
              /*
               * A settled case is owned by nobody. Said in words rather than
               * left blank: an empty cell reads as missing data, and "ingen"
               * is a fact.
               */
              <span className="text-sm text-content-muted">
                Ingen — ärendet är avgjort
              </span>
            ) : (
              <span className="text-sm font-medium">{owner}</span>
            )}
          </Field>

          <Field label="Nästa steg">
            <span
              className={cn(
                'text-sm font-medium',
                standing.settled ? 'text-content-muted' : undefined,
              )}
            >
              {ACT_LABEL[standing.nextAct.act]}
            </span>
            {standing.nextAct.owningDepartmentId && (
              <span className="type-metadata">
                {' '}
                · {standing.nextAct.owningDepartmentId}
              </span>
            )}
          </Field>
        </div>

        {/* --------------------------------------------------- what is blocking */}
        {standing.blockers.length > 0 && (
          <div className="rounded-lg bg-warning-soft p-4">
            <div className="mb-2 flex items-center gap-2">
              <TriangleAlert
                className={cn('h-4 w-4', toneText.warning)}
                aria-hidden="true"
              />
              <span className="type-label">Blockerar framdrift</span>
            </div>
            <ul className="flex flex-col gap-1">
              {standing.blockers.map((blocker, index) => (
                <li key={`${blocker.kind}-${index}`} className="text-sm">
                  {/*
                   * The blocker KIND verbatim. It is the firm's own vocabulary
                   * and the same string the workflow acts on; translating it
                   * here would give one fact two names.
                   */}
                  <code className="font-mono text-xs">{blocker.kind}</code>
                  {blocker.owningDepartmentId && (
                    <span className="text-content-muted">
                      {' '}
                      · {blocker.owningDepartmentId}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ------------------------------------------------------------- steps */}
        <div>
          <div className="mb-3 flex items-baseline justify-between gap-4">
            <span className="type-label">Institutionella steg</span>
            <span className="type-metadata">
              {outstanding.length === 0
                ? 'Inget utestående'
                : `${outstanding.length} utestående`}
            </span>
          </div>

          <ol className="flex flex-col gap-2">
            {standing.steps.map((entry) => {
              const rendered = STEP_STATUS[entry.status]
              const Mark = STEP_MARK[entry.status]
              return (
                <li key={entry.step} className="flex items-center gap-3">
                  <Mark
                    className={cn('h-4 w-4 shrink-0', toneText[rendered.tone])}
                    aria-hidden="true"
                  />
                  <span
                    className={cn(
                      'text-sm',
                      entry.status === 'not-applicable'
                        ? 'text-content-muted'
                        : undefined,
                    )}
                  >
                    {STEP_LABEL[entry.step]}
                  </span>
                  <span className="ml-auto">
                    <StatusBadge tone={rendered.tone}>{rendered.label}</StatusBadge>
                  </span>
                </li>
              )
            })}
          </ol>
        </div>
      </div>
    </DashboardCard>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="type-metadata">{label}</span>
      <div className="flex items-baseline">{children}</div>
    </div>
  )
}
