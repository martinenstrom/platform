/**
 * The minimum a component needs to report something a human should see.
 *
 * Deliberately one method. The market-data logger adds `resolution()` and the
 * storage layer adds `slowQuery()`, because a structured event with named
 * fields is worth far more than a formatted sentence — but both of those are
 * their own context's vocabulary, and a shared base of every log shape in the
 * system would be a file every context has to edit.
 *
 * ## What must never reach a log
 *
 * The discipline that keeps provider credentials out of logs applies equally to
 * institutional content. No implementation of this interface may be handed a
 * claim, a thesis statement, a decision rationale, an evidence payload, a query
 * parameter, or SQL containing values. `meta` carries identifiers, durations,
 * counts and bounded codes.
 */
export interface Logger {
  warn(message: string, meta?: Record<string, unknown>): void
}

export const noopLogger: Logger = { warn: () => {} }
