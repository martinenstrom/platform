/**
 * *Kalla samman kommittén* — the Chairman asks the firm a question.
 *
 * The act the whole institution starts from, and until now something only a
 * development script could do. The Chairman supplies two things and nothing
 * else:
 *
 *   **Fråga**  what the firm is being asked
 *   **Ämne**   what the question is about
 *
 * Owner, participating departments, the acting department and the playbook are
 * **not** asked for. They are institutional routing facts, resolved centrally
 * by `resolveCaseIntake` from the approved playbook and the seeded
 * organisation, and a form that asked a person to choose them would be a
 * development console wearing a product's clothes.
 *
 * ## Two commits, and the middle state is real
 *
 * Opening the case and convening the committee are separate institutional acts
 * with separate transaction boundaries. Three answers come back and all three
 * are shown as themselves: convened, convening-incomplete, refused. A partial
 * result is never dressed up as either success or failure — the Chairman's
 * question is durable and the committee is not convened, and that is a state
 * the person needs to know they are in.
 *
 * ## Who acts
 *
 * Every employee is offered. The list is deliberately not filtered to those who
 * may convene: filtering it would put an authority decision into the dropdown,
 * and the mandate would then be enforced twice by two rules, one of which
 * nobody wrote down. Choose someone without the authority and the institution
 * refuses — the case is opened, the committee is not convened, and the room
 * says so.
 */

import { useState } from 'react'
import { DashboardCard } from '~/components/ui/DashboardCard'
import type { OperatorIdentity } from '~/application/analysis/operatorIdentity'
import type { StartInvestmentCaseResponse } from '~/infrastructure/analysis/serverFns'

/** What the firm answered, in words a person can act on. */
const OUTCOME_TEXT: Record<string, string> = {
  QUESTION_REQUIRED: 'En fråga måste ställas.',
  SUBJECT_REQUIRED: 'Ett ämne måste anges.',
  NOT_ROUTABLE: 'Firman har ingen godkänd arbetsgång för den här sortens ärende.',
  UNKNOWN_OPERATOR: 'Den som agerar är inte anställd i firman.',
  NOT_CONFIGURED: 'Analysmiljön saknar databaskonfiguration.',
  SERVICE_UNAVAILABLE: 'Analysmiljön svarar inte just nu.',
  'not-authorised': 'Den som agerar får inte kalla samman kommittén.',
}

export function ConveneCommittee({
  identities,
  onSubmit,
}: {
  identities: readonly OperatorIdentity[]
  onSubmit: (input: {
    question: string
    subjectDisplayName: string
    requestId: string
    actingEmployeeId: string
  }) => Promise<StartInvestmentCaseResponse>
}) {
  const [question, setQuestion] = useState('')
  const [subject, setSubject] = useState('')
  const [actingAs, setActingAs] = useState(identities[0]?.employeeId ?? '')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<StartInvestmentCaseResponse | null>(null)
  /*
   * Minted once per submission, not per attempt. A retried network call lands
   * on the same case rather than opening a second one holding one question.
   */
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    const answer = await onSubmit({
      question,
      subjectDisplayName: subject,
      requestId,
      actingEmployeeId: actingAs,
    })
    setBusy(false)
    setResult(answer)

    if (answer.state === 'convened') {
      /* Straight into the room the question now has. */
      window.location.href = `/cases/${answer.caseId}`
      return
    }
    if (answer.state === 'refused') {
      /* Nothing was created, so the next attempt is a new submission. */
      setRequestId(crypto.randomUUID())
    }
  }

  return (
    <DashboardCard title="Kalla samman kommittén">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span className="type-section">Fråga</span>
          <input
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Varför rörde sig den amerikanska långänden?"
            className="hq-field"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="type-section">Ämne</span>
          <input
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            placeholder="Amerikanska statsräntor"
            className="hq-field"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="type-section">Agerar som</span>
          <select
            value={actingAs}
            onChange={(event) => setActingAs(event.target.value)}
            className="hq-field"
          >
            {identities.map((identity) => (
              <option key={identity.employeeId} value={identity.employeeId}>
                {identity.displayName} · {identity.roleTitle}
              </option>
            ))}
          </select>
          {/* The interface is required to say this where a person chooses. */}
          <span className="type-metadata">
            Identiteten är vald, inte styrkt. Ingen inloggning sker.
          </span>
        </label>

        <button type="submit" disabled={busy} className="brd-console-action">
          {busy ? 'Sammankallar…' : 'Kalla samman kommittén'}
        </button>

        {result?.state === 'convening-incomplete' && (
          <div className="flex flex-col gap-1">
            {/*
             * The honest middle. The question is registered and kept; the
             * committee is not convened. The case's own room offers the resume.
             */}
            <p className="brd-console-warning">Kommittén kunde inte sammankallas.</p>
            <p className="type-metadata">
              {OUTCOME_TEXT[result.code] ?? 'Sammankallningen gick inte igenom.'}{' '}
              Frågan är registrerad och ärendet finns kvar.
            </p>
            <a href={`/cases/${result.caseId}`} className="brd-console-link">
              Öppna ärendet och återuppta →
            </a>
          </div>
        )}

        {result?.state === 'refused' && (
          <p className="brd-console-warning">
            {OUTCOME_TEXT[result.code] ?? 'Frågan kunde inte registreras.'}
          </p>
        )}
      </form>
    </DashboardCard>
  )
}
