/**
 * Deep immutability at the repository boundary.
 *
 * ## Why this exists
 *
 * The in-memory adapter rolls a transaction back by restoring a **shallow**
 * snapshot of its collections. That is only correct if a stored value cannot be
 * mutated in place — otherwise a rollback would restore the map entries while
 * leaving the mutated object exactly as the failed transaction left it, and the
 * store would report success on a state that never legally existed.
 *
 * The domain builders freeze, but they freeze **shallowly**: `buildAssignment`
 * freezes the assignment and not its `waitingOn`, `buildClaim` freezes the
 * claim and not its `confidence` or `attribution`, and `InvestmentCase` has no
 * builder at all — a plain object literal is a legal case. So the invariant the
 * rollback depends on was, in practice, a convention that future domain code
 * could break without any test noticing.
 *
 * Rather than document that, the boundary enforces it. Every write seals what
 * it stores, all the way down.
 *
 * ## Seal, not copy
 *
 * `seal` freezes the caller's object rather than freezing a clone. That is
 * deliberate: cloning would make a retained reference mutable while the stored
 * copy stayed frozen, which is the exact hazard this is meant to remove. After
 * a write, the caller's reference and the stored value are the same frozen
 * object, and mutating it through either throws (module code is strict mode, so
 * a rejected write is a `TypeError`, not a silent no-op).
 *
 * ## What is rejected
 *
 * `Map`, `Set` and other mutable containers are **refused**, because
 * `Object.freeze` does not stop `.set()` or `.add()` — sealing one would report
 * an immutability that does not exist. Nothing in the analysis domain stores
 * one today; if something starts to, this throws at the write rather than
 * corrupting a rollback much later.
 */

/**
 * Thrown when a value cannot be made immutable.
 *
 * Names the path, because "a Map is not sealable" is useless without knowing
 * which field of which aggregate holds it.
 */
export class MutableValueError extends Error {
  constructor(
    readonly path: string,
    kind: string,
  ) {
    super(
      `Cannot store a mutable ${kind} at "${path}". Freezing it would not stop ` +
        `it being changed in place, and the in-memory adapter rolls back by ` +
        `restoring a shallow snapshot. Use a plain object or an array.`,
    )
    this.name = 'MutableValueError'
  }
}

/**
 * Values already sealed by a previous write.
 *
 * A sealed object is frozen and all of its children are sealed, so it can never
 * need sealing again — re-saving the same aggregate is a `WeakSet` hit rather
 * than another walk of the graph.
 */
const SEALED = new WeakSet<object>()

function isPlainish(value: object): boolean {
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null || Array.isArray(value)
}

function walk(value: unknown, path: string, seen: Set<object>): void {
  if (value === null || typeof value !== 'object') return
  const object = value as object

  if (SEALED.has(object) || seen.has(object)) return
  seen.add(object)

  if (object instanceof Map || object instanceof Set || object instanceof WeakMap) {
    throw new MutableValueError(path, object.constructor.name)
  }
  if (!isPlainish(object)) {
    /*
     * A class instance can carry state that freezing does not reach — `Date`
     * is the everyday example, since `setTime` writes an internal slot rather
     * than a property and survives `Object.freeze`. The analysis domain stores
     * ISO strings and plain objects, so anything else is a mistake worth
     * hearing about at the write.
     */
    throw new MutableValueError(path, `${object.constructor.name} instance`)
  }

  for (const [key, child] of Object.entries(object)) {
    walk(child, `${path}.${key}`, seen)
  }

  Object.freeze(object)
  SEALED.add(object)
}

/**
 * Freezes a value and everything it reaches, and returns it.
 *
 * Called by every write in the in-memory adapter. `label` is the aggregate
 * name, so a rejection reads `cases.subject.tags` rather than `.subject.tags`.
 */
export function seal<T>(value: T, label: string): T {
  walk(value, label, new Set())
  return value
}

/**
 * Whether a value and everything it reaches is frozen.
 *
 * Exists for tests: `Object.isFrozen` answers only for the top level, which is
 * exactly the shallow check that missed the gap this module closes.
 */
export function isDeeplyFrozen(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || typeof value !== 'object') return true
  const object = value as object
  if (seen.has(object)) return true
  seen.add(object)

  if (object instanceof Map || object instanceof Set) return false
  if (!Object.isFrozen(object)) return false
  return Object.values(object).every((child) => isDeeplyFrozen(child, seen))
}
