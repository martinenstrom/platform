import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { DashboardCard } from '~/components/ui/DashboardCard'
import { Button } from '~/components/ui/Button'
import { StatusBadge } from '~/components/ui/StatusBadge'
import { ActingAsPanel, useActingAs } from './ActingAs'
import { assembleEvidenceSetFn } from '~/infrastructure/analysis/serverFns'
import type { AssembleResponse } from '~/infrastructure/analysis/serverFns'
import type { EvidenceDeskView } from '~/application/analysis/evidenceDesk'
import type { OperatorIdentity } from '~/application/analysis/operatorIdentity'
import { ASSEMBLY_REFUSAL_LABEL } from '~/presentation/analysis/evidenceText'

/**
 * Sammanställ underlag — the first thing C3 lets a person do.
 *
 * Three panels, in the order the act happens: what the firm holds, the
 * selection that turns some of it into a body of evidence, and what has been
 * assembled. The middle one is an institutional act with an actor and a
 * mandate; the other two are reads.
 *
 * ## The person chooses a rule and a window, never observations
 *
 * There is deliberately no list of observations with checkboxes. An assembler
 * who could pick individual observations could drop the inconvenient source,
 * and the disagreement machinery — which the set computes from its own
 * membership — would never see it (gate §0.3). What a person chooses is a
 * registered selection rule, a family, and a window.
 *
 * ## The holdings are counted by the same query the act runs
 *
 * `evidenceDesk` runs `runSelection`, which is what `AssembleEvidenceSet` runs.
 * So the count a person sees before pressing the button is the count the act
 * will select — not a screen's estimate of it.
 *
 * ## It decides nothing
 *
 * The command refuses independently: an unregistered rule, a window that ends
 * before it starts, a knowledge time in the future, a family the firm holds
 * nothing for, or an operator who does not manage the department. Every one of
 * those comes back as a refusal with the institution's own code.
 */
export function EvidencePanel({
  view,
  identities,
  query,
  onQueryChange,
}: {
  view: EvidenceDeskView
  identities: readonly OperatorIdentity[]
  query: AssemblyQuery
  onQueryChange: (query: AssemblyQuery) => void
}) {
  const actingAs = useActingAs()
  const [pending, setPending] = useState(false)
  const [response, setResponse] = useState<AssembleResponse | null>(null)

  const rule = view.rules.find((candidate) => candidate.ruleId === query.ruleId)
  const family = rule?.families.find((candidate) => candidate.id === query.subjectFamily)
  const holdings = view.holdings
  const holdsSomething = (holdings?.totalObservations ?? 0) > 0

  const ready =
    actingAs !== null &&
    rule !== undefined &&
    family !== undefined &&
    query.from.trim() !== '' &&
    query.to.trim() !== '' &&
    !pending

  const assemble = async () => {
    if (!ready || actingAs === null) return
    setPending(true)
    setResponse(null)
    try {
      setResponse(
        await assembleEvidenceSetFn({
          data: {
            ruleId: query.ruleId,
            subjectFamily: query.subjectFamily,
            from: query.from,
            to: query.to,
            ...(query.knownAt.trim() ? { knownAt: query.knownAt } : {}),
            onBehalfOfDepartmentId: query.onBehalfOfDepartmentId,
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
      {/* ============================================== what the firm holds == */}
      <DashboardCard title="Observationer firman håller">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-4">
            <Field label="Urvalsregel">
              <select
                className="type-metadata rounded border border-line bg-surface px-2 py-1"
                value={query.ruleId}
                onChange={(event) =>
                  onQueryChange({ ...query, ruleId: event.target.value })
                }
              >
                {view.rules.map((candidate) => (
                  <option key={candidate.ruleId} value={candidate.ruleId}>
                    {candidate.ruleId}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Familj">
              <select
                className="type-metadata rounded border border-line bg-surface px-2 py-1"
                value={query.subjectFamily}
                onChange={(event) =>
                  onQueryChange({ ...query, subjectFamily: event.target.value })
                }
              >
                {(rule?.families ?? []).map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.id} ({candidate.sourceId})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Från (referensperiod)">
              <input
                type="date"
                className="type-metadata rounded border border-line bg-surface px-2 py-1"
                value={query.from}
                onChange={(event) => onQueryChange({ ...query, from: event.target.value })}
              />
            </Field>
            <Field label="Till (referensperiod)">
              <input
                type="date"
                className="type-metadata rounded border border-line bg-surface px-2 py-1"
                value={query.to}
                onChange={(event) => onQueryChange({ ...query, to: event.target.value })}
              />
            </Field>
          </div>

          {rule && <p className="type-metadata">{rule.states}</p>}

          {holdings === null ? (
            <p className="text-sm text-content-muted">
              Välj regel och fönster för att se vad firman håller.
            </p>
          ) : (
            <>
              <table className="w-full text-sm">
                <thead>
                  <tr className="type-metadata text-left">
                    <th className="py-1">Serie</th>
                    <th className="py-1 text-right">Observationer</th>
                    <th className="py-1">Tidigast</th>
                    <th className="py-1">Senast</th>
                  </tr>
                </thead>
                <tbody>
                  {holdings.subjects.map((subject) => (
                    <tr key={subject.subject} className="border-t border-line">
                      <td className="py-1 tabular">{subject.subject}</td>
                      <td className="py-1 text-right tabular">
                        {subject.observationCount}
                      </td>
                      <td className="py-1 tabular">
                        {subject.earliestReferencePeriod ?? '—'}
                      </td>
                      <td className="py-1 tabular">
                        {subject.latestReferencePeriod ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="type-metadata">
                {holdings.totalObservations} observationer i fönstret ·{' '}
                {holdings.derivableCount} härledda observationer skulle beräknas ·
                räknat som firman visste {holdings.knownAt}
              </p>
              {!holdsSomething && (
                <p className="text-sm text-warning">
                  Firman håller inga observationer för det här fönstret. Ingenting kan
                  sammanställas — observationer hämtas som en egen handling och kan inte
                  skapas härifrån.
                </p>
              )}
            </>
          )}
        </div>
      </DashboardCard>

      {/* ==================================================== the assembly == */}
      <DashboardCard title="Sammanställ underlag">
        <div className="flex flex-col gap-6">
          <p className="text-sm leading-relaxed text-content-muted">
            Att sammanställa underlag är{' '}
            <strong className="text-content">en institutionell handling</strong>: den
            avgör vad en avdelning får resonera över, och därmed taket för vad firman kan
            hävda. Den bokförs med din namngivna person, ditt mandat och den urvalsregel
            som kördes.
          </p>

          <div className="flex flex-wrap items-end gap-4">
            <Field label="Som firman visste (valfritt)">
              <input
                type="datetime-local"
                className="type-metadata rounded border border-line bg-surface px-2 py-1"
                value={query.knownAt}
                onChange={(event) =>
                  onQueryChange({ ...query, knownAt: event.target.value })
                }
              />
            </Field>
            <Field label="På uppdrag av avdelning">
              <input
                type="text"
                className="type-metadata rounded border border-line bg-surface px-2 py-1"
                value={query.onBehalfOfDepartmentId}
                onChange={(event) =>
                  onQueryChange({ ...query, onBehalfOfDepartmentId: event.target.value })
                }
              />
            </Field>
          </div>
          <p className="type-metadata">
            Lämnas tidpunkten tom används handlingens egen tidpunkt, och den bokförs — det
            går inte att i efterhand säga vad ”senast kända” betydde.
          </p>

          <ActingAsPanel identities={identities} owningDepartmentName="Firman" />

          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="primary"
              size="sm"
              disabled={!ready}
              onClick={() => void assemble()}
            >
              {pending ? 'Sammanställer…' : 'Sammanställ underlag'}
            </Button>
            {!ready && !pending && (
              <span className="type-metadata">
                {actingAs === null
                  ? 'Välj vem handlingen bokförs på.'
                  : 'Välj regel, familj och fönster.'}
              </span>
            )}
          </div>

          {response && <Outcome response={response} />}
        </div>
      </DashboardCard>

      {/* ============================================ what has been assembled == */}
      <DashboardCard title={`Sammanställda underlag (${view.recent.length})`}>
        {view.recent.length === 0 ? (
          <p className="text-sm text-content-muted">
            Firman har inte sammanställt något underlag genom den bokförda handlingen än.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {view.recent.map((entry) => (
              <li key={entry.assembly.assemblyId} className="flex flex-col gap-1 py-3">
                <span className="text-sm tabular">
                  {entry.assembly.evidenceSetId.slice(0, 16)}… ·{' '}
                  {entry.assembly.observationCount} observationer ·{' '}
                  {entry.assembly.derivedCount} härledda
                </span>
                <span className="type-metadata">
                  {entry.assembly.selection.ruleId} ·{' '}
                  {entry.assembly.selection.subjectFamily} ·{' '}
                  {entry.assembly.selection.from}–{entry.assembly.selection.to} · som
                  firman visste {entry.assembly.selection.knownAt}
                </span>
                <span className="type-metadata">
                  Sammanställt av {entry.assembly.actorEmployeeId} för{' '}
                  {entry.assembly.onBehalfOfDepartmentId} · {entry.assembly.assembledAt}
                  {entry.sources.length > 0 ? ` · ${entry.sources.join(', ')}` : ''}
                  {entry.disagreementCount > 0
                    ? ` · ${entry.disagreementCount} motsägelser`
                    : ''}
                  {entry.revisionCount > 0 ? ` · ${entry.revisionCount} revideringar` : ''}
                </span>
                {entry.missing && (
                  /*
                   * Stated, never hidden. A recorded act whose set does not read
                   * back is an inconsistency only a person can act on.
                   */
                  <span className="type-metadata text-warning">
                    Underlaget som handlingen pekar på kan inte läsas tillbaka.
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="pt-4">
          <Link
            to="/agents/$departmentId/commission"
            params={{ departmentId: 'global-macro' }}
            className="type-metadata hover:text-content"
          >
            Beställ analys av Global Macro mot ett underlag
          </Link>
        </div>
      </DashboardCard>
    </>
  )
}

/** The form's state, lifted so the route can re-load holdings when it changes. */
export interface AssemblyQuery {
  ruleId: string
  subjectFamily: string
  from: string
  to: string
  /** Empty means "the act's own instant", which the command resolves and stores. */
  knownAt: string
  onBehalfOfDepartmentId: string
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="type-metadata">{label}</span>
      {children}
    </label>
  )
}

/** What the institution answered. A refusal is an answer, not a fault. */
function Outcome({ response }: { response: AssembleResponse }) {
  if (response.ok) {
    return (
      <div className="flex flex-col gap-1">
        <StatusBadge tone="positive">Underlag sammanställt</StatusBadge>
        <span className="text-sm tabular">
          {response.evidenceSetId} · {response.observationCount} observationer ·{' '}
          {response.derivedCount} härledda
        </span>
        <span className="type-metadata">Handling {response.assemblyId}</span>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-1">
      <StatusBadge tone={response.outcome === 'refused' ? 'warning' : 'negative'}>
        {response.outcome === 'refused' ? 'Firman avböjde' : 'Kunde inte genomföras'}
      </StatusBadge>
      <span className="text-sm">
        {ASSEMBLY_REFUSAL_LABEL[response.code] ?? response.code}
      </span>
    </div>
  )
}
