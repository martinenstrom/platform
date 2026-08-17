import { StatusBadge } from '~/components/ui/StatusBadge'
import { runStateText } from '~/presentation/analysis/runText'
import type { RunState } from '~/domain/analysis'

/**
 * A run's state, as the record holds it.
 *
 * The label is always present, so the state never depends on colour alone —
 * and the two pairs that must not be confused, `rejected` against `failed` and
 * `awaiting-acceptance` against `completed`, differ in both word and tone.
 *
 * There is no progress indicator here and there is not going to be one. A run
 * reports state transitions, not completion fractions, so a bar would be a
 * number nobody measured.
 */
export function RunStateBadge({ state }: { state: RunState }) {
  const rendered = runStateText(state)
  return <StatusBadge tone={rendered.tone}>{rendered.label}</StatusBadge>
}
