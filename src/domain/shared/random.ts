/**
 * Randomness abstraction.
 *
 * Retry jitter and correlation ids need randomness, and both need to be
 * reproducible in tests. `Math.random()` is therefore banned below the
 * presentation layer for the same reason `Date.now()` is: it makes behaviour
 * unobservable. Inject it instead.
 */

export interface Random {
  /** Uniform in [0, 1). */
  next(): number
  /** Integer in [min, max). */
  intBetween(min: number, max: number): number
  /** Lowercase hex string of `length` characters. */
  hex(length: number): string
}

abstract class BaseRandom implements Random {
  abstract next(): number

  intBetween(min: number, max: number): number {
    if (max <= min) throw new Error(`intBetween: max must exceed min (${min}, ${max})`)
    return min + Math.floor(this.next() * (max - min))
  }

  hex(length: number): string {
    let out = ''
    while (out.length < length) {
      out += Math.floor(this.next() * 0x10000)
        .toString(16)
        .padStart(4, '0')
    }
    return out.slice(0, length)
  }
}

export class SystemRandom extends BaseRandom {
  next(): number {
    return Math.random()
  }
}

/** Deterministic mulberry32 for tests. Same seed, same sequence, every run. */
export class SeededRandom extends BaseRandom {
  private state: number

  constructor(seed = 1) {
    super()
    this.state = seed >>> 0
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const systemRandom: Random = new SystemRandom()
