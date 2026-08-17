import { useSyncExternalStore } from 'react'
import { StatusBadge } from '~/components/ui/StatusBadge'
import type { OperatorIdentity } from '~/application/analysis/operatorIdentity'

/**
 * Which employee the operator is acting as.
 *
 * **Operator identity, not authentication.** Selecting a name here does not
 * establish that the person at the keyboard is that employee, and the panel
 * below says so on screen rather than in a comment. What the selection does is
 * make every institutional act name a real employee of the seeded firm, so the
 * mandate checks the commands already perform are genuinely load-bearing: a
 * desk cannot accept another desk's work, and choosing the wrong person
 * produces a real refusal from the institution.
 *
 * Real authentication is TD-8, is a different thing, and is not this.
 *
 * ## Session-scoped, and chosen once
 *
 * `sessionStorage`, so the choice survives a reload and dies with the tab. It
 * is deliberately not re-asked per act: an operator confirming who they are on
 * every button press stops reading the confirmation by the third one, which
 * makes the prompt worse than useless.
 *
 * ## It grants nothing
 *
 * The store holds an employee id and no permission, no role and no capability.
 * Whether that employee may accept a given piece of work is decided by the
 * institution when the command runs, against the seeded organization — never
 * here, and never by filtering the list this renders.
 */

const KEY = 'financial-os:acting-as'

const listeners = new Set<() => void>()

function read(): string | null {
  /* Server render, or a browser with storage disabled. Both mean "nobody yet". */
  if (typeof window === 'undefined') return null
  try {
    return window.sessionStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function setActingAs(employeeId: string | null): void {
  try {
    if (employeeId === null) window.sessionStorage.removeItem(KEY)
    else window.sessionStorage.setItem(KEY, employeeId)
  } catch {
    /* Storage refused. The selection still applies for this render pass. */
  }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  /*
   * Also across tabs. `storage` fires in the OTHER tab, so a second window
   * changing the operator does not leave this one signing acts as somebody the
   * user has since stopped being.
   */
  if (typeof window !== 'undefined') window.addEventListener('storage', listener)
  return () => {
    listeners.delete(listener)
    if (typeof window !== 'undefined') window.removeEventListener('storage', listener)
  }
}

/** The employee id currently selected, or `null` when nobody has chosen. */
export function useActingAs(): string | null {
  return useSyncExternalStore(subscribe, read, () => null)
}

/**
 * The selector, and the disclosure that has to travel with it.
 *
 * Every employee of the firm is offered. The list is deliberately not narrowed
 * to whoever may act on the work in front of the operator — filtering it would
 * move an authority decision into a dropdown, and the mandate would then be
 * enforced twice by two rules, one of which nobody wrote down.
 */
export function ActingAsPanel({
  identities,
  /** The desk that owns the work being judged, stated as a fact, not a filter. */
  owningDepartmentName,
}: {
  identities: readonly OperatorIdentity[]
  owningDepartmentName?: string
}) {
  const selected = useActingAs()

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="acting-as" className="text-sm font-medium">
          Du agerar som
        </label>
        <select
          id="acting-as"
          value={selected ?? ''}
          onChange={(event) => setActingAs(event.target.value || null)}
          className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-content"
        >
          <option value="">Välj medarbetare…</option>
          {identities.map((identity) => (
            <option key={identity.employeeId} value={identity.employeeId}>
              {identity.departmentName} · {identity.displayName} ({identity.roleTitle})
            </option>
          ))}
        </select>
        {/*
         * On screen, not in a comment. A person signing institutional acts has
         * to know the system is taking their word for who they are.
         */}
        <StatusBadge tone="warning">Operatörsidentitet — inte inloggning</StatusBadge>
      </div>

      <p className="type-metadata">
        Valet avgör vem handlingen bokförs på. Systemet kontrollerar inte att du är den
        personen — det kontrollerar att personen har mandat att göra det du försöker göra.
        {owningDepartmentName
          ? ` Det här arbetet ägs av ${owningDepartmentName}, och bara den avdelningen kan bedöma det.`
          : ''}
      </p>
    </div>
  )
}
