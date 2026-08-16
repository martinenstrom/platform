/**
 * The one URL that runs the C2-1 smoke proof.
 *
 * Not a product surface and not Agent Headquarters: no navigation links here,
 * no components, no styling. It renders the result as JSON because the point is
 * evidence a person reads once, not a view anybody maintains.
 *
 * It exists because the proof has to run in the SERVED runtime — the same env
 * loading, the same container, the same non-owner database role the request
 * path uses. A standalone script would have proved a different thing.
 */

import { createFileRoute } from '@tanstack/react-router'
import { c2SmokeProofFn } from '~/infrastructure/analysis/serverFns'

export const Route = createFileRoute('/smoke/c2-1')({
  loader: () => c2SmokeProofFn(),
  component: SmokeProof,
})

function SmokeProof() {
  const result = Route.useLoaderData()
  return (
    <pre style={{ padding: 16, fontSize: 12, whiteSpace: 'pre-wrap' }}>
      {JSON.stringify(result, null, 2)}
    </pre>
  )
}
