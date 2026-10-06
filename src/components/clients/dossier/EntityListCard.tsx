import { Link } from '@tanstack/react-router'
import {
  Building2,
  ChevronRight,
  Landmark,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react'
import type { Client360 } from '~/application/advisory/client360'
import type { HouseholdMemberRole } from '~/domain/advisory'
import { formatLongDate } from '~/presentation/advisory/format'
import { initialsOf } from '~/presentation/advisory/portraits'
import { CHANNEL_LABEL, HOUSEHOLD_ROLE_LABEL } from '~/presentation/advisory/text'
import { Empty, Fact, Module } from './Module'

const ENTITY_ICON: Partial<Record<HouseholdMemberRole, LucideIcon>> = {
  company: Building2,
  'holding-company': Building2,
  foundation: Landmark,
  related: UserRound,
}

/**
 * Template 6 — the connected people and companies. The household around
 * the client, one icon-led row each: the person's monogram or the
 * company's mark, the name, the role — and the door to their own dossier
 * where a member is a client of the firm. Beneath, the two facts about
 * the client the household frames: how they like to be reached, and when
 * they were born.
 */
export function EntityListCard({
  view,
  className,
}: {
  view: Client360
  className?: string
}) {
  const { household, client } = view
  const members = (household?.members ?? []).filter(
    (member) => member.clientId !== client.id,
  )
  return (
    <Module
      id="familj"
      title="Familj & bolag"
      icon={Users}
      meta={household?.displayName}
      className={className}
    >
      {members.length === 0 ? (
        <Empty>
          {household
            ? 'Inga andra personer eller bolag i hushållet.'
            : 'Inget hushåll registrerat.'}
        </Empty>
      ) : (
        <ul className="flex flex-col">
          {members.map((member) => {
            const Icon = ENTITY_ICON[member.role]
            const door = member.clientId && member.clientId !== client.id
            return (
              <li key={member.id} className="dossier-row flex items-center gap-3 py-2.5">
                <span
                  aria-hidden="true"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-hairline-strong bg-[rgb(150_172_210_/_0.06)] font-display text-[12px] text-content"
                >
                  {Icon ? (
                    <Icon
                      className="h-[14px] w-[14px] text-[#e6c987]"
                      strokeWidth={1.6}
                    />
                  ) : (
                    initialsOf(member.displayName)
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-content">
                    {door ? (
                      <Link
                        to="/clients/$clientId"
                        params={{ clientId: member.clientId! }}
                        className="hover:text-institution"
                      >
                        {member.displayName}
                      </Link>
                    ) : (
                      member.displayName
                    )}
                  </span>
                  <span className="type-inst-sub block">
                    {HOUSEHOLD_ROLE_LABEL[member.role]}
                    {member.dateOfBirth && ` · f. ${formatLongDate(member.dateOfBirth)}`}
                  </span>
                </span>
                {door && (
                  <Link
                    to="/clients/$clientId"
                    params={{ clientId: member.clientId! }}
                    aria-label={`Öppna ${member.displayName}`}
                    className="dossier-chevron"
                  >
                    <ChevronRight
                      className="h-3.5 w-3.5"
                      aria-hidden="true"
                      strokeWidth={1.8}
                    />
                  </Link>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <dl className="mt-3 grid grid-cols-2 gap-x-4 border-t border-hairline pt-3">
        <Fact label="Föredragen kanal">{CHANNEL_LABEL[client.preferredChannel]}</Fact>
        <Fact label="Född">
          {client.dateOfBirth === null ? (
            <span className="type-inst-sub">Data saknas</span>
          ) : (
            formatLongDate(client.dateOfBirth)
          )}
        </Fact>
      </dl>
    </Module>
  )
}
