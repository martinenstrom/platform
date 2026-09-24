import { Link } from '@tanstack/react-router'
import type { Client360 } from '~/application/advisory/client360'
import { Panel } from '~/components/ui/Panel'
import { formatLongDate } from '~/presentation/advisory/format'
import { CHANNEL_LABEL, HOUSEHOLD_ROLE_LABEL } from '~/presentation/advisory/text'

/**
 * The household around the client: partner, children, companies, the
 * holding company, related relationships. Phase 1 lists; a member who is a
 * client of the firm links to their own page.
 */
export function HouseholdPanel({ view }: { view: Client360 }) {
  const { household, client } = view
  return (
    <Panel
      title="Hushåll"
      meta={household ? household.displayName : undefined}
      bodyClassName="p-3"
    >
      <ul className="space-y-1.5">
        {(household?.members ?? []).map((member) => (
          <li
            key={member.id}
            className="flex items-baseline justify-between gap-3 text-[12.5px]"
          >
            <span className="min-w-0 truncate text-content">
              {member.clientId && member.clientId !== client.id ? (
                <Link
                  to="/clients/$clientId"
                  params={{ clientId: member.clientId }}
                  className="underline decoration-dotted underline-offset-2 hover:text-institution"
                >
                  {member.displayName}
                </Link>
              ) : (
                member.displayName
              )}
              {member.dateOfBirth && (
                <span className="type-machine ml-2">
                  f. {formatLongDate(member.dateOfBirth)}
                </span>
              )}
            </span>
            <span className="type-machine shrink-0">
              {HOUSEHOLD_ROLE_LABEL[member.role]}
            </span>
          </li>
        ))}
        {!household && <li className="type-inst-sub">Inget hushåll registrerat.</li>}
      </ul>
      <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 border-t border-line pt-2">
        <div className="flex items-baseline gap-2">
          <dt className="type-inst-sub">Föredragen kanal</dt>
          <dd className="type-inst">{CHANNEL_LABEL[client.preferredChannel]}</dd>
        </div>
        <div className="flex items-baseline gap-2">
          <dt className="type-inst-sub">Född</dt>
          <dd className="type-inst">{formatLongDate(client.dateOfBirth)}</dd>
        </div>
      </dl>
    </Panel>
  )
}
