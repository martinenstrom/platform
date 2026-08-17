import { Link } from '@tanstack/react-router'
import { StatusBadge } from '~/components/ui/StatusBadge'
import { RunStateBadge } from './RunStateBadge'
import type { AgentDesk } from '~/application/analysis/agentDirectory'

/**
 * One desk on the floor.
 *
 * Who owns it, what the firm's workflow asks it for, and what it has actually
 * done. A desk that has never run anything says so — an empty run history is a
 * fact about the firm, and filling it with an invented activity line is the
 * exact fiction this surface replaced.
 */
export function DeskCard({ desk }: { desk: AgentDesk }) {
  const latest = desk.runs[0]

  return (
    <article className="hud-frame flex flex-col rounded-xl bg-surface p-6 shadow-card transition-colors duration-150 hover:bg-surface-2">
      <header className="flex items-start justify-between gap-3">
        <h3 className="truncate text-sm font-medium text-content">
          <Link
            to="/agents/$departmentId"
            params={{ departmentId: desk.departmentId }}
            className="hover:underline"
          >
            {desk.name}
          </Link>
        </h3>
        {/*
         * Governance is marked, never ranked. An independent control function
         * and a producing desk place different obligations on a reader, and the
         * seed records which is which.
         */}
        {desk.isGovernance && <StatusBadge tone="neutral">Kontrollfunktion</StatusBadge>}
      </header>

      <p className="mt-2 type-metadata">
        {desk.manager.displayName} · {desk.manager.roleTitle}
      </p>

      <p className="mt-3 text-sm leading-relaxed text-content-muted">
        {desk.responsibilities.length === 0
          ? 'Inget ansvarsområde registrerat.'
          : desk.responsibilities.map((responsibility) => responsibility.summary).join(' ')}
      </p>

      <footer className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="type-metadata">
          {desk.assignableWork.length} uppdrag i arbetsflödet
        </span>
        {latest ? (
          <>
            <span className="type-metadata">{desk.runs.length} körningar</span>
            <span className="ml-auto">
              <RunStateBadge state={latest.state} />
            </span>
          </>
        ) : (
          /*
           * Said in words rather than shown as a zero beside a status dot. "No
           * work yet" and "work that produced nothing" are different facts.
           */
          <span className="type-metadata ml-auto">Har inte kört något ännu</span>
        )}
      </footer>
    </article>
  )
}
