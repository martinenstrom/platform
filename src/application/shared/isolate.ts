/**
 * Failure isolation for one unit of a composed snapshot.
 *
 * `resolve()` is designed never to throw, but "designed never to" is not a
 * guarantee: a bug in an adapter, a normalizer or the pipeline itself would
 * otherwise reject the surrounding `Promise.all` and take a whole page down.
 * One failing unit must degrade one panel.
 *
 * Shared between the Overview and the central-bank snapshot, which had
 * independently grown identical copies. Any future snapshot composes the same
 * way, and the semantics — an unexpected throw becomes a retryable `error`
 * envelope naming the unit — should not be re-decided each time.
 */

import type { Envelope } from '~/domain/shared/provenance'

export async function isolate<T>(
  label: string,
  run: () => Promise<Envelope<T>>,
): Promise<Envelope<T>> {
  try {
    return await run()
  } catch (error) {
    return {
      state: 'error',
      error: {
        code: 'unknown',
        message: `"${label}" failed unexpectedly: ${
          error instanceof Error ? error.message : String(error)
        }`,
        providerId: null,
        retryable: true,
      },
    }
  }
}
