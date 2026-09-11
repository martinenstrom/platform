/**
 * A durable identifier, reachable but out of the reading layer.
 *
 * Provenance is not decoration and is never removed — a reader must always be
 * able to follow a position back to the persisted act. But a raw `clm-…` hash
 * set as body text beside a sentence competes with the sentence, and this
 * surface is read by people deciding whether to trust an argument, not by
 * people grepping a ledger.
 *
 * So it folds: a hairline affordance closed, machine metadata open. Native
 * `<details>`, so it works without JavaScript, is keyboard-reachable, and is
 * announced as a disclosure rather than as mystery text.
 */

import { cn } from '~/lib/cn'

export function Inspect({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <details className={cn('brd-inspect', className)}>
      <summary className="type-machine inline-flex w-fit items-center gap-1.5">
        <span aria-hidden="true">⌗</span>
        <span>Härkomst</span>
      </summary>
      <code className="type-machine mt-1 block font-mono break-all">{children}</code>
    </details>
  )
}
