import { DashboardCard } from '~/components/ui/DashboardCard'
import { formatTime } from '~/lib/format'
import type { AnalysisRun, Agent } from '~/types'

interface ConsoleFeedProps {
  agents: Agent[]
  recentAnalyses: AnalysisRun[]
}

interface LogLine {
  id: string
  at: string
  text: string
}

/**
 * Right column of the command center: a real system-activity log styled as a
 * console, built from the same `agents` and `recentAnalyses` data the
 * Agents page uses — not a chat feature. The input below is intentionally
 * `disabled`: no state, no submit handler, nothing to mistake for working.
 */
export function ConsoleFeed({ agents, recentAnalyses }: ConsoleFeedProps) {
  const lines = buildLogLines(agents, recentAnalyses)

  return (
    <DashboardCard title="Konsol" bodyClassName="flex flex-col gap-3">
      <ul className="flex max-h-80 flex-col gap-2.5 overflow-y-auto pr-1 font-mono text-xs">
        {lines.map((line) => (
          <li key={line.id} className="flex gap-2 text-content-muted">
            <span className="shrink-0 text-content-subtle">{formatTime(line.at)}</span>
            <span className="min-w-0 text-content">{line.text}</span>
          </li>
        ))}
      </ul>

      <label className="sr-only" htmlFor="console-input">
        Konsolinmatning
      </label>
      <input
        id="console-input"
        type="text"
        disabled
        placeholder="Chattfunktion inte aktiverad i den här versionen"
        className="hud-frame h-9 w-full rounded-lg bg-surface-2 px-3 text-xs text-content-subtle placeholder:text-content-subtle disabled:opacity-60"
      />
    </DashboardCard>
  )
}

/** Merges agent activity and analysis runs into one time-sorted feed, most recent first. */
function buildLogLines(agents: Agent[], recentAnalyses: AnalysisRun[]): LogLine[] {
  const agentLines: LogLine[] = agents.map((agent) => ({
    id: `agent-${agent.id}`,
    at: agent.lastRunAt,
    text: `${agent.name}: ${agent.result ?? agent.activity}`,
  }))

  const analysisLines: LogLine[] = recentAnalyses.map((run) => ({
    id: `analysis-${run.id}`,
    at: run.generatedAt,
    text: `${run.instrument} — ${run.type}`,
  }))

  return [...agentLines, ...analysisLines]
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 10)
}
