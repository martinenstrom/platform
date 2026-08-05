/**
 * Canonical values, version 1 — the strict identity encoding.
 *
 * The normative specification is `docs/canonical-value-v1.md`. **That document
 * defines the meaning; this file implements it.** If they disagree, the
 * document is right and this is a bug.
 *
 * ## What this replaces, and why
 *
 * `canonicalJson` is `JSON.stringify` with sorted object keys. Sorted keys do
 * not make a canonical format, and `JSON.stringify` is not one. Measured:
 * `null`, `NaN`, `Infinity`, `-Infinity` and `undefined` all produced `null`;
 * every `Date` produced `{}`; `-0` produced `0`; `9007199254740993` produced
 * `...992`; `BigInt` threw; a property holding `undefined` was dropped, while
 * the same `undefined` inside an array became `null`.
 *
 * Observation content hashes ran through it, and `isRevisionOf` compares those
 * hashes to decide whether an observation was revised — so a value that went
 * from missing to `NaN` read as unrevised.
 *
 * The rule that follows: **a value this format cannot represent exactly is
 * refused, never approximated.** An identity that quietly stands for two things
 * is worse than an error, because nothing reports it.
 *
 * ## The encoding
 *
 * Length-prefixed and self-describing, so nothing is escaped and no content can
 * be read as structure:
 *
 *   null     `n`                       false `b0`      true `b1`
 *   integer  `i` <decimal>
 *   string   `s` <utf8ByteLength> `:` <utf8 bytes>
 *   array    `l` <count> `:` <elements concatenated>
 *   object   `d` <memberCount> `:` <key-then-value pairs, concatenated>
 *
 * Object keys are ordered by **UTF-8 byte order** — the bytes the encoder
 * itself emits. Never `localeCompare`, whose no-argument form reads the host's
 * default locale: measured under Node's ICU, `tr` and `da` order the keys `Id`
 * and `id` opposite to `en`, `sv`, `lt`, `cs` and `et`.
 */

import { utf8ByteLength } from './sha256'

export const CANONICAL_VALUE_VERSION = 1

/* ------------------------------------------------------------------- types */

/**
 * A JavaScript number this format accepts: finite, a safe integer, not `-0`.
 *
 * Not a branded type, because the constraint is on the value rather than on its
 * provenance and every caller would otherwise need a cast. `validateCanonical`
 * is the enforcement.
 */
export type CanonicalInteger = number

export type CanonicalScalar = null | boolean | string | CanonicalInteger

export type CanonicalValue =
  CanonicalScalar | readonly CanonicalValue[] | { readonly [key: string]: CanonicalValue }

/** Why a value is not canonical. Bounded; carries a path, never the value. */
export interface CanonicalProblem {
  code: CanonicalProblemCode
  /** Where, as a dotted path from the root. `''` is the root itself. */
  path: string
}

export type CanonicalProblemCode =
  | 'undefined-is-not-a-value'
  | 'number-not-finite'
  | 'number-not-an-integer'
  | 'number-not-safe'
  | 'number-negative-zero'
  | 'string-unpaired-surrogate'
  | 'bigint-unsupported'
  | 'symbol-unsupported'
  | 'function-unsupported'
  | 'array-is-sparse'
  | 'object-not-plain'
  | 'object-has-to-json'
  | 'object-has-symbol-key'
  | 'object-has-non-enumerable-property'
  | 'object-has-accessor-property'
  | 'value-is-cyclic'

export class NotCanonicalError extends Error {
  constructor(readonly problem: CanonicalProblem) {
    super(
      `Value at ${problem.path === '' ? 'the root' : `"${problem.path}"`} is not ` +
        `canonical: ${problem.code}`,
    )
    this.name = 'NotCanonicalError'
  }
}

/* -------------------------------------------------------------- validation */

const OBJECT_PROTOTYPE = Object.prototype

/**
 * A high surrogate must be followed by a low one, and a low surrogate must not
 * appear alone.
 *
 * Hand-rolled rather than `String.prototype.isWellFormed`, which is ES2024 and
 * the `lib` target here is ES2022 — so it exists at runtime but not in the
 * type system, and depending on that gap is how a build breaks on someone
 * else's toolchain.
 */
function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const low = index + 1 < value.length ? value.charCodeAt(index + 1) : 0
      if (low < 0xdc00 || low > 0xdfff) return true
      index += 1
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true
    }
  }
  return false
}

const step = (path: string, key: string) => (path === '' ? key : `${path}.${key}`)

/**
 * The first reason a value is not canonical, or `null`.
 *
 * Returns rather than throws so a caller can decide whether a rejection is a
 * caller error or a corrupt record — the same distinction the aggregate
 * validators draw. `seen` tracks the current path only, so a value appearing
 * twice as siblings is fine and a value containing itself is not.
 */
function findProblem(
  value: unknown,
  path: string,
  seen: Set<object>,
): CanonicalProblem | null {
  if (value === undefined) return { code: 'undefined-is-not-a-value', path }
  if (value === null) return null

  switch (typeof value) {
    case 'boolean':
    case 'string':
      break
    case 'number': {
      if (!Number.isFinite(value)) return { code: 'number-not-finite', path }
      if (!Number.isInteger(value)) return { code: 'number-not-an-integer', path }
      if (!Number.isSafeInteger(value)) return { code: 'number-not-safe', path }
      // The only value for which 1/x is -Infinity. `x === 0` cannot see it.
      if (Object.is(value, -0)) return { code: 'number-negative-zero', path }
      return null
    }
    case 'bigint':
      return { code: 'bigint-unsupported', path }
    case 'symbol':
      return { code: 'symbol-unsupported', path }
    case 'function':
      return { code: 'function-unsupported', path }
    default:
      break
  }

  if (typeof value === 'string') {
    return hasUnpairedSurrogate(value)
      ? { code: 'string-unpaired-surrogate', path }
      : null
  }
  if (typeof value === 'boolean') return null

  const object = value as object
  if (seen.has(object)) return { code: 'value-is-cyclic', path }
  seen.add(object)
  try {
    if (Array.isArray(object)) {
      for (let index = 0; index < object.length; index += 1) {
        // A hole is neither a value nor an expressible absence.
        if (!(index in object)) return { code: 'array-is-sparse', path }
        const problem = findProblem(object[index], step(path, String(index)), seen)
        if (problem !== null) return problem
      }
      return null
    }

    /*
     * Plain objects only. Restricting the prototype also disposes of inherited
     * enumerable data: `Object.prototype` has none, and a null prototype has
     * nothing at all. Everything else -- Date, Map, Set, typed arrays, class
     * instances -- fails here, which is why they need no individual case.
     */
    const prototype = Object.getPrototypeOf(object)
    if (prototype !== OBJECT_PROTOTYPE && prototype !== null) {
      return { code: 'object-not-plain', path }
    }

    /*
     * Never consulted, and its presence is disqualifying. A class instance must
     * not become canonical merely because it implements a convenient
     * serializer -- that is how an object of unknown shape acquires an identity
     * nobody specified.
     */
    if ('toJSON' in object) return { code: 'object-has-to-json', path }

    if (Object.getOwnPropertySymbols(object).length > 0) {
      return { code: 'object-has-symbol-key', path }
    }

    for (const key of Object.getOwnPropertyNames(object)) {
      const descriptor = Object.getOwnPropertyDescriptor(object, key)!
      // A getter runs code; an unenumerable property would be silently omitted.
      if (!('value' in descriptor)) return { code: 'object-has-accessor-property', path }
      if (!descriptor.enumerable) {
        return { code: 'object-has-non-enumerable-property', path }
      }
      const problem = findProblem(descriptor.value, step(path, key), seen)
      if (problem !== null) return problem
    }
    return null
  } finally {
    seen.delete(object)
  }
}

/** The first reason `value` is not canonical, or `null` if it is. */
export function validateCanonical(value: unknown): CanonicalProblem | null {
  return findProblem(value, '', new Set())
}

export function isCanonicalValue(value: unknown): value is CanonicalValue {
  return validateCanonical(value) === null
}

/** Throws `NotCanonicalError` unless `value` is canonical. */
export function assertCanonical(value: unknown): asserts value is CanonicalValue {
  const problem = validateCanonical(value)
  if (problem !== null) throw new NotCanonicalError(problem)
}

/* --------------------------------------------------------- canonical decimal */

/**
 * A decimal quantity, exactly as approved. Branded, so an arbitrary string
 * containing digits is not one.
 */
export type CanonicalDecimal = string & { readonly __brand: 'CanonicalDecimal' }

/** At most 38 significant digits: the widest commonly portable fixed precision. */
export const CANONICAL_DECIMAL_MAX_SIGNIFICANT_DIGITS = 38

/**
 * Canonical form: optional minus, no exponent, no redundant zeros either end,
 * no trailing point, and zero written exactly `0`.
 */
const CANONICAL_DECIMAL = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]*[1-9])?$/

export function isCanonicalDecimal(value: string): value is CanonicalDecimal {
  if (!CANONICAL_DECIMAL.test(value)) return false
  /*
   * `-0` passes the pattern and must not pass here. Refused rather than
   * normalized: silently rewriting a caller's value is how a boundary stops
   * being a boundary.
   */
  if (value === '-0') return false

  // Leading zeros are already excluded, so significance is just the digit count.
  const digits = value.replace(/[-.]/g, '').replace(/^0+/, '')
  return digits.length <= CANONICAL_DECIMAL_MAX_SIGNIFICANT_DIGITS
}

/* ---------------------------------------------------------------- encoding */

const NUL = 'n'
const FALSE = 'b0'
const TRUE = 'b1'

const encodeInteger = (value: number) => `i${value}`
const encodeString = (value: string) => `s${utf8ByteLength(value)}:${value}`

/**
 * Ascending UTF-8 byte order, which is also Unicode code-point order and what
 * `COLLATE "C"` gives on UTF-8.
 *
 * JavaScript's `<` compares UTF-16 code units, which differs from code-point
 * order exactly where surrogate pairs meet U+E000-U+FFFF, so it is not enough
 * on its own. Comparing code points reproduces byte order without materialising
 * the bytes: UTF-8 preserves code-point order by construction.
 */
export function utf8ByteOrder(left: string, right: string): number {
  if (left === right) return 0

  const leftPoints = [...left]
  const rightPoints = [...right]
  const shared = Math.min(leftPoints.length, rightPoints.length)

  for (let index = 0; index < shared; index += 1) {
    const a = leftPoints[index]!.codePointAt(0)!
    const b = rightPoints[index]!.codePointAt(0)!
    if (a !== b) return a < b ? -1 : 1
  }
  // A proper prefix is smaller.
  return leftPoints.length < rightPoints.length ? -1 : 1
}

/**
 * The canonical bytes of a value.
 *
 * Validates first and refuses rather than approximating. The validation is not
 * an optimisation to skip: it is the difference between an identity that means
 * one thing and an identity that quietly means two.
 */
export function canonicalValueString(value: CanonicalValue): string {
  assertCanonical(value)
  return encode(value)
}

function encode(value: CanonicalValue): string {
  if (value === null) return NUL
  if (typeof value === 'boolean') return value ? TRUE : FALSE
  if (typeof value === 'number') return encodeInteger(value)
  if (typeof value === 'string') return encodeString(value)

  if (Array.isArray(value)) {
    const elements = (value as readonly CanonicalValue[]).map(encode)
    return `l${elements.length}:${elements.join('')}`
  }

  const object = value as { readonly [key: string]: CanonicalValue }
  const keys = Object.keys(object).sort(utf8ByteOrder)
  const members = keys.map((key) => encodeString(key) + encode(object[key]!))
  return `d${members.length}:${members.join('')}`
}

/**
 * The bytes to hash, separated from every other digest in the system.
 *
 * Without a domain tag, two different kinds of value that happen to encode
 * identically produce one identity, and a value computed for one purpose could
 * be presented as another. The tag is a compile-time constant; if it ever
 * becomes variable it must be length-prefixed like every other string.
 */
export function canonicalIdentityInput(domainTag: string, value: CanonicalValue): string {
  return `${domainTag}|${canonicalValueString(value)}`
}
