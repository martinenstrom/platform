/**
 * Financial value objects.
 *
 * Design decision (Phase A): these are **branded primitives with smart
 * constructors**, not wrapper classes.
 *
 * A wrapper class (`new Percent(0.32)`) would give the same compile-time
 * safety but three runtime costs this app should not pay: it allocates on
 * every quote, it does not survive `JSON.stringify` across the
 * `createServerFn` boundary without a bespoke revive step, and it forces
 * `.value` unwrapping at every arithmetic site. A brand is erased at compile
 * time — the runtime representation is a plain `number`, so a snapshot
 * serializes and revives with no custom logic at all, while the type system
 * still refuses to let basis points be assigned to a percent.
 *
 * `Money` is the exception. Its whole purpose is to bind an amount to its
 * currency, which a brand on `number` cannot express, so it is a plain data
 * interface — still JSON-safe, still allocation-cheap, no methods.
 *
 * Rule: constructors validate and are the ONLY way to mint a branded value.
 * A raw `number` can never be assigned to a branded type by accident.
 */

/* ------------------------------------------------------------------ brands */

declare const percentBrand: unique symbol
declare const basisPointsBrand: unique symbol
declare const priceBrand: unique symbol
declare const yieldPercentBrand: unique symbol
declare const iso4217Brand: unique symbol

/** A percentage, expressed in percent units: `0.32` means +0.32 %, not 32 %. */
export type Percent = number & { readonly [percentBrand]: true }

/** One hundredth of a percentage point. The market's unit for rate changes. */
export type BasisPoints = number & { readonly [basisPointsBrand]: true }

/** A price or index level, in the instrument's own unit. Non-negative. */
export type Price = number & { readonly [priceBrand]: true }

/** A bond yield, percent per annum: `4.32` means 4.32 %. May be negative. */
export type YieldPercent = number & { readonly [yieldPercentBrand]: true }

/** ISO 4217 alphabetic currency code, uppercase — 'SEK', 'USD', 'EUR'. */
export type IsoCurrencyCode = string & { readonly [iso4217Brand]: true }

/* ------------------------------------------------------------------- errors */

/**
 * Thrown by a smart constructor when a value cannot be a valid financial
 * primitive. Distinct from `DomainError` (see `./provenance.ts`), which
 * describes a *fetch* failing; this one means the program is wrong.
 */
export class InvalidValueError extends Error {
  constructor(
    readonly primitive: string,
    readonly received: unknown,
    reason: string,
  ) {
    super(`Invalid ${primitive}: ${reason} (received ${String(received)})`)
    this.name = 'InvalidValueError'
  }
}

function assertFinite(primitive: string, value: number): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new InvalidValueError(primitive, value, 'must be a finite number')
  }
}

/* ------------------------------------------------------- smart constructors */

export function percent(value: number): Percent {
  assertFinite('Percent', value)
  return value as Percent
}

export function basisPoints(value: number): BasisPoints {
  assertFinite('BasisPoints', value)
  return value as BasisPoints
}

/** Prices and index levels are never negative; a negative one is a parse bug. */
export function price(value: number): Price {
  assertFinite('Price', value)
  if (value < 0) throw new InvalidValueError('Price', value, 'must not be negative')
  return value as Price
}

/** Yields may legitimately be negative — Bunds traded below zero for years. */
export function yieldPercent(value: number): YieldPercent {
  assertFinite('YieldPercent', value)
  return value as YieldPercent
}

const ISO_4217_PATTERN = /^[A-Z]{3}$/

export function isoCurrency(code: string): IsoCurrencyCode {
  if (!ISO_4217_PATTERN.test(code)) {
    throw new InvalidValueError(
      'IsoCurrencyCode',
      code,
      'must be three uppercase letters',
    )
  }
  return code as IsoCurrencyCode
}

/* -------------------------------------------------------------------- money */

/**
 * An amount bound to its currency. A plain data shape, not a class: it must
 * cross the server/client boundary as JSON without a revive step.
 */
export interface Money {
  readonly amount: number
  readonly currency: IsoCurrencyCode
}

export function money(amount: number, currency: IsoCurrencyCode): Money {
  assertFinite('Money', amount)
  return { amount, currency }
}

/**
 * Adds two amounts, refusing to mix currencies. There is no implicit FX
 * conversion anywhere in the domain — converting is an explicit operation that
 * needs a rate and a timestamp, so it cannot hide inside an operator.
 */
export function addMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) {
    throw new InvalidValueError(
      'Money',
      `${a.currency}+${b.currency}`,
      'cannot add amounts in different currencies',
    )
  }
  return { amount: a.amount + b.amount, currency: a.currency }
}

/* ---------------------------------------------------------- unit conversion */

/** 1 percentage point = 100 basis points. The only sanctioned conversion. */
export function percentToBasisPoints(value: Percent): BasisPoints {
  return basisPoints(value * 100)
}

export function basisPointsToPercent(value: BasisPoints): Percent {
  return percent(value / 100)
}

/**
 * Percentage change between two levels. Returns `null` rather than `Infinity`
 * or `NaN` when the base is zero or missing — an honest "cannot be derived"
 * that the `Envelope` layer can carry, instead of a number that renders as
 * garbage.
 */
export function changePercent(current: number, previous: number | null): Percent | null {
  if (previous === null || previous === 0) return null
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null
  return percent(((current - previous) / previous) * 100)
}
