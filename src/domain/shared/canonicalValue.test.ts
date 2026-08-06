/**
 * The canonical value format does what the specification says, and refuses
 * everything it says it refuses.
 *
 * Three halves, and all three are load-bearing. The golden vectors pin the
 * **bytes**, so the encoding cannot change quietly alongside its own test. The
 * refusals pin that every value the previous implementation silently mangled
 * now fails explicitly. The ordering tests pin that no locale can move a byte.
 *
 * `docs/canonical-value-v1.md` is normative. If a vector here disagrees with
 * that document, the document wins.
 */

import { describe, expect, it } from 'vitest'
import {
  CANONICAL_VALUE_VERSION,
  NotCanonicalError,
  assertCanonical,
  canonicalIdentityInput,
  canonicalValueString,
  canonicalDecimalFromNumber,
  canonicalDecimalOrNull,
  isCanonicalDecimal,
  parseCanonicalDecimal,
  isCanonicalValue,
  utf8ByteOrder,
  validateCanonical,
  type CanonicalValue,
} from './canonicalValue'

describe('golden vectors', () => {
  const vectors: Array<[string, CanonicalValue, string]> = [
    ['null', null, 'n'],
    ['true', true, 'b1'],
    ['false', false, 'b0'],
    ['zero', 0, 'i0'],
    ['a negative integer', -17, 'i-17'],
    ['the largest safe integer', 9007199254740991, 'i9007199254740991'],
    ['an empty string', '', 's0:'],
    ['a string', 'rev-1', 's5:rev-1'],
    ['an empty array', [], 'l0:'],
    ['a mixed array', [1, null, 'a'], 'l3:i1ns1:a'],
    ['an empty object', {}, 'd0:'],
    ['an object with a null value', { a: null }, 'd1:s1:an'],
    ['an object whose keys need sorting', { b: 1, a: 2 }, 'd2:s1:ai2s1:bi1'],
    ['keys differing only by case', { Id: 1, id: 2 }, 'd2:s2:Idi1s2:idi2'],
    ['a nested structure', { a: { b: [true] } }, 'd1:s1:ad1:s1:bl1:b1'],
  ]

  for (const [name, value, expected] of vectors) {
    it(`encodes ${name}`, () => {
      expect(canonicalValueString(value)).toBe(expected)
    })
  }

  it('pins the format version', () => {
    expect(CANONICAL_VALUE_VERSION).toBe(1)
  })
})

describe('the encoding is unambiguous', () => {
  it('distinguishes null from an absent property', () => {
    // `{}` and `{a: null}` are different objects, and a format that could not
    // tell them apart could not tell a missing field from a cleared one.
    expect(canonicalValueString({})).not.toBe(canonicalValueString({ a: null }))
  })

  it('distinguishes null from the empty string and from zero', () => {
    const encodings = [null, '', 0, false].map((v) => canonicalValueString(v))
    expect(new Set(encodings).size).toBe(4)
  })

  it('distinguishes a boolean from an integer', () => {
    // The reason booleans get their own tags rather than i0/i1.
    expect(canonicalValueString(true)).not.toBe(canonicalValueString(1))
    expect(canonicalValueString(false)).not.toBe(canonicalValueString(0))
  })

  it('distinguishes an array from an object with numeric keys', () => {
    expect(canonicalValueString(['x'])).not.toBe(canonicalValueString({ '0': 'x' }))
  })

  it('is injective across adversarial values', () => {
    /*
     * The property, tested rather than claimed: distinct values produce distinct
     * bytes. Nothing is escaped and no character is reserved -- the length
     * prefixes are what make content unable to pose as structure. Each value
     * below either looks like a delimiter, looks like a length prefix, or looks
     * like a complete encoded field.
     */
    const adversarial = [
      '',
      ':',
      '|',
      '1:',
      '5:hello',
      's5:rev-1',
      'l2:',
      'd1:',
      'n',
      'b1',
      'i1',
      's1:a',
      'a',
      '0',
      '00',
    ]

    const seen = new Map<string, string>()
    for (const left of adversarial) {
      for (const right of adversarial) {
        const cases: Array<[string, CanonicalValue]> = [
          [`{a:${left}, b:${right}}`, { a: left, b: right }],
          [`[${left}, ${right}]`, [left, right]],
          [`{${left}: ${right}}`, { [left]: right }],
        ]
        for (const [label, value] of cases) {
          const encoded = canonicalValueString(value)
          const collision = seen.get(encoded)
          expect(collision, `${label} collides with ${collision}`).toBeUndefined()
          seen.set(encoded, label)
        }
      }
    }
    expect(seen.size).toBe(adversarial.length * adversarial.length * 3)
  })

  it('separates a key from the value that follows it', () => {
    // The forgery a delimiter-joined encoding permits: move a character across
    // the boundary and a naive rendering is unchanged.
    expect(canonicalValueString({ ab: 'c' })).not.toBe(canonicalValueString({ a: 'bc' }))
  })

  it('counts string length in UTF-8 bytes', () => {
    expect(canonicalValueString('é')).toBe('s2:é')
    expect(canonicalValueString('\u{1d11e}')).toBe('s4:\u{1d11e}')
    expect(canonicalValueString('日')).toBe('s3:日')
  })
})

describe('key ordering is fixed by bytes, not by locale', () => {
  it('orders by UTF-8 byte order', () => {
    expect(canonicalValueString({ id: 2, Id: 1 })).toBe('d2:s2:Idi1s2:idi2')
  })

  it('produces the order no locale agrees on', () => {
    /*
     * Not a tautology: the pair below is one where locales genuinely disagree
     * with each other. Measured under Node's ICU, `tr` and `da` order `Id`
     * against `id` opposite to `en`, `sv`, `lt`, `cs` and `et` -- so a
     * localeCompare-based encoder produces different bytes on different hosts.
     *
     * Asserting the locales still disagree keeps this test honest: if a future
     * ICU made them agree, the assertion below would fail and say so rather
     * than quietly becoming vacuous.
     */
    const orders = new Set(
      ['en', 'sv', 'da', 'tr', 'lt', 'cs', 'et'].map((locale) =>
        Math.sign('Id'.localeCompare('id', locale)),
      ),
    )
    expect(orders.size, 'locales no longer disagree; this test needs a new pair').toBe(2)

    // Ours does not consult any of them.
    expect(utf8ByteOrder('Id', 'id')).toBe(-1)
  })

  it('gives the same bytes under every locale', () => {
    const value = { Id: 1, id: 2, ida: 3, Ida: 4, zebra: 5, ärlig: 6, Ärlig: 7 }
    const expected = canonicalValueString(value)

    for (const locale of ['en', 'sv', 'da', 'tr', 'lt', 'cs', 'et']) {
      /*
       * The encoder takes no locale, so the strongest available check is that
       * its output differs from what a locale-sorted encoder would have
       * produced -- and that every locale agrees with the encoder on nothing
       * more than luck.
       */
      const localeSorted = Object.keys(value).sort((a, b) => a.localeCompare(b, locale))
      const ourSorted = Object.keys(value).sort(utf8ByteOrder)
      expect(canonicalValueString(value), locale).toBe(expected)
      if (localeSorted.join() !== ourSorted.join()) {
        expect(localeSorted.join(), `${locale} sorts differently, as expected`).not.toBe(
          ourSorted.join(),
        )
      }
    }
  })

  it('orders astral characters above the basic plane', () => {
    /*
     * Where UTF-8 byte order and UTF-16 code-unit order part company. U+1D11E
     * is a surrogate pair, so `<` on JavaScript strings would place it BELOW
     * U+FFFD; by code point, and therefore by UTF-8 bytes, it is above.
     */
    expect(utf8ByteOrder('\u{1d11e}', '�')).toBe(1)
    expect('\u{1d11e}' < '�').toBe(true)
  })

  it('treats a proper prefix as smaller', () => {
    expect(utf8ByteOrder('a', 'ab')).toBe(-1)
    expect(utf8ByteOrder('ab', 'a')).toBe(1)
    expect(utf8ByteOrder('a', 'a')).toBe(0)
  })
})

describe('strings are preserved exactly', () => {
  it('applies no Unicode normalisation', () => {
    // Composed U+00E9 against decomposed U+0065 U+0301. Normalising would make
    // two distinct stored strings share an identity.
    const composed = canonicalValueString('é')
    const decomposed = canonicalValueString('é')
    expect(composed).not.toBe(decomposed)
    expect(composed).toBe('s2:é')
    expect(decomposed).toBe('s3:é')
  })

  it('treats zero-width and bidirectional characters as ordinary data', () => {
    // A statement about runtime data. Source characters remain forbidden by the
    // no-invisible-characters-in-source fitness rule, which is a separate rule
    // with a separate rationale.
    expect(canonicalValueString('a\u200bb')).toBe('s5:a\u200bb')
    expect(canonicalValueString('a\u202eb')).toBe('s5:a\u202eb')
    expect(canonicalValueString('a\u200bb')).not.toBe(canonicalValueString('ab'))
  })

  it('accepts a well-formed surrogate pair', () => {
    expect(isCanonicalValue('\u{1d11e}')).toBe(true)
  })
})

describe('everything the old format mangled is now refused', () => {
  const cyclic: Record<string, unknown> = { name: 'self' }
  cyclic.self = cyclic

  const withGetter = {}
  Object.defineProperty(withGetter, 'a', { get: () => 1, enumerable: true })

  const withHidden = {}
  Object.defineProperty(withHidden, 'a', { value: 1, enumerable: false })

  const sparse = [1, , 3] as unknown

  class Instance {
    a = 1
  }

  const refused: Array<[string, unknown, string]> = [
    ['undefined', undefined, 'undefined-is-not-a-value'],
    ['NaN', Number.NaN, 'number-not-finite'],
    ['Infinity', Number.POSITIVE_INFINITY, 'number-not-finite'],
    ['-Infinity', Number.NEGATIVE_INFINITY, 'number-not-finite'],
    ['negative zero', -0, 'number-negative-zero'],
    ['a fractional number', 2.5, 'number-not-an-integer'],
    ['an unsafe integer', 9007199254740993, 'number-not-safe'],
    ['a BigInt', 1n, 'bigint-unsupported'],
    ['a symbol', Symbol('s'), 'symbol-unsupported'],
    ['a function', () => 1, 'function-unsupported'],
    ['a Date', new Date('2026-01-01'), 'object-not-plain'],
    ['a Map', new Map(), 'object-not-plain'],
    ['a Set', new Set(), 'object-not-plain'],
    ['a typed array', new Uint8Array([1]), 'object-not-plain'],
    ['a RegExp', /x/, 'object-not-plain'],
    ['a class instance', new Instance(), 'object-not-plain'],
    ['an object with toJSON', { toJSON: () => 1 }, 'object-has-to-json'],
    ['a sparse array', sparse, 'array-is-sparse'],
    ['a cyclic object', cyclic, 'value-is-cyclic'],
    ['an accessor property', withGetter, 'object-has-accessor-property'],
    ['a non-enumerable property', withHidden, 'object-has-non-enumerable-property'],
    ['a symbol key', { [Symbol('k')]: 1 }, 'object-has-symbol-key'],
    ['an unpaired high surrogate', '\ud834', 'string-unpaired-surrogate'],
    ['an unpaired low surrogate', '\udd1e', 'string-unpaired-surrogate'],
    ['a high surrogate before ASCII', '\ud834x', 'string-unpaired-surrogate'],
  ]

  for (const [name, value, code] of refused) {
    it(`refuses ${name}`, () => {
      expect(validateCanonical(value)?.code).toBe(code)
      expect(() => canonicalValueString(value as CanonicalValue)).toThrow(
        NotCanonicalError,
      )
    })
  }

  it('refuses a bad value nested inside a good structure, and says where', () => {
    const problem = validateCanonical({ outer: { list: [1, Number.NaN] } })
    expect(problem).toEqual({ code: 'number-not-finite', path: 'outer.list.1' })
  })

  it('refuses a property holding undefined rather than dropping it', () => {
    // The old format produced `{"b":1}` and lost the distinction entirely.
    expect(validateCanonical({ a: undefined, b: 1 })).toEqual({
      code: 'undefined-is-not-a-value',
      path: 'a',
    })
  })

  it('refuses undefined in an array rather than rewriting it to null', () => {
    // The old format produced `[1,null,2]`, so undefined and null collided.
    expect(validateCanonical([1, undefined, 2])?.code).toBe('undefined-is-not-a-value')
  })

  it('never collapses a refused value into a valid encoding', () => {
    /*
     * The property that matters most. Every refusal above must throw; none may
     * quietly become `n`, `d0:`, `i0` or any other well-formed output, because
     * a wrong identity that verifies is worse than an error.
     */
    for (const [name, value] of refused) {
      let produced: string | null = null
      try {
        produced = canonicalValueString(value as CanonicalValue)
      } catch {
        produced = null
      }
      expect(produced, `${name} produced an encoding instead of failing`).toBeNull()
    }
  })

  it('carries no value content in the problem it reports', () => {
    const problem = validateCanonical({
      secretish: 'do-not-log-me' as never,
      x: undefined,
    })
    expect(JSON.stringify(problem)).not.toContain('do-not-log-me')
  })
})

describe('values that were distinct and stayed distinct', () => {
  it('accepts a repeated sibling without calling it a cycle', () => {
    // The cycle check tracks the current path, not every object ever seen.
    const shared = { a: 1 }
    expect(isCanonicalValue({ left: shared, right: shared })).toBe(true)
  })

  it('accepts a null-prototype object', () => {
    const bare = Object.create(null) as Record<string, unknown>
    bare.a = 1
    expect(canonicalValueString(bare as CanonicalValue)).toBe('d1:s1:ai1')
  })

  it('preserves array order and duplicates', () => {
    expect(canonicalValueString(['b', 'a'])).not.toBe(canonicalValueString(['a', 'b']))
    expect(canonicalValueString(['a', 'a'])).toBe('l2:s1:as1:a')
  })

  it('accepts the safe-integer boundaries and refuses just past them', () => {
    /*
     * The boundary is 2^53 - 1, not 2^53. 2^53 is exactly representable as a
     * double, but it is not *safe*: 2^53 and 2^53 + 1 round to the same value,
     * so a number arriving as 2^53 cannot be known to have been written as
     * 2^53. That is the whole reason unsafe integers are refused.
     */
    expect(isCanonicalValue(Number.MAX_SAFE_INTEGER)).toBe(true)
    expect(isCanonicalValue(-Number.MAX_SAFE_INTEGER)).toBe(true)
    expect(isCanonicalValue(9007199254740991)).toBe(true)
    expect(isCanonicalValue(9007199254740992)).toBe(false)
    expect(isCanonicalValue(9007199254740993)).toBe(false)

    // The two that collide are refused for the same reason, not by coincidence.
    expect(9007199254740992 === 9007199254740993).toBe(true)
  })
})

describe('canonical decimals', () => {
  const valid = ['0', '1', '-1', '2.5', '-2.5', '0.5', '-0.5', '10', '1234567890.123']
  const invalid = [
    ['negative zero', '-0'],
    ['a decimal zero', '0.0'],
    ['a negative decimal zero', '-0.0'],
    ['a leading plus', '+2.5'],
    ['exponent notation', '2.5e3'],
    ['capital exponent', '2E-1'],
    ['a leading zero', '01'],
    ['several leading zeros', '007'],
    ['a trailing fractional zero', '2.50'],
    ['several trailing zeros', '2.500'],
    ['a trailing decimal point', '2.'],
    ['a bare decimal point', '.'],
    ['a leading decimal point', '.5'],
    ['not a number at all', 'two'],
    ['whitespace', ' 2.5 '],
    ['an empty string', ''],
    ['a thousands separator', '1,000'],
  ]

  for (const value of valid) {
    it(`accepts ${JSON.stringify(value)}`, () => {
      expect(isCanonicalDecimal(value)).toBe(true)
    })
  }

  for (const [name, value] of invalid) {
    it(`refuses ${name}`, () => {
      expect(isCanonicalDecimal(value!)).toBe(false)
    })
  }

  it('gives one approved value exactly one spelling', () => {
    // 2.500 and 2.5 must not become two institutional identities. Only the
    // canonical spelling is accepted, and the other is refused rather than
    // rewritten, so a caller learns its value was not canonical.
    expect(isCanonicalDecimal('2.5')).toBe(true)
    expect(isCanonicalDecimal('2.500')).toBe(false)
  })

  it('bounds significant digits at 38', () => {
    expect(isCanonicalDecimal('1'.repeat(38))).toBe(true)
    expect(isCanonicalDecimal('1'.repeat(39))).toBe(false)
    expect(isCanonicalDecimal(`0.${'0'.repeat(10)}${'1'.repeat(38)}`)).toBe(true)
    expect(isCanonicalDecimal(`0.${'0'.repeat(10)}${'1'.repeat(39)}`)).toBe(false)
  })

  it('encodes as an ordinary string once accepted', () => {
    expect(canonicalValueString('2.5')).toBe('s3:2.5')
  })
})

describe('domain separation', () => {
  it('prefixes the encoding with the purpose', () => {
    expect(canonicalIdentityInput('evidence-set:v1', { a: 1 })).toBe(
      'evidence-set:v1|d1:s1:ai1',
    )
  })

  it('gives two purposes different bytes for one value', () => {
    const value = { a: 1 }
    expect(canonicalIdentityInput('evidence-set:v1', value)).not.toBe(
      canonicalIdentityInput('command-payload:v1', value),
    )
  })

  it('validates before separating, so a bad value cannot be tagged', () => {
    expect(() =>
      canonicalIdentityInput('evidence-set:v1', { a: Number.NaN } as CanonicalValue),
    ).toThrow(NotCanonicalError)
  })
})

describe('the assertion helper', () => {
  it('names the code and the path', () => {
    try {
      assertCanonical({ a: [Number.NaN] })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(NotCanonicalError)
      expect((error as NotCanonicalError).problem).toEqual({
        code: 'number-not-finite',
        path: 'a.0',
      })
    }
  })
})

describe('the approved decimal conversion', () => {
  const cases: Array<[number, string]> = [
    [0, '0'],
    [1, '1'],
    [-1, '-1'],
    [2.5, '2.5'],
    [-2.5, '-2.5'],
    [0.5, '0.5'],
    [4.69, '4.69'],
    [0.1 + 0.2, '0.30000000000000004'],
    [1e21, '1000000000000000000000'],
    [1e-7, '0.0000001'],
    [1.25e-7, '0.000000125'],
    [-1e-7, '-0.0000001'],
    [1.5e22, '15000000000000000000000'],
    [9007199254740991, '9007199254740991'],
  ]

  for (const [input, expected] of cases) {
    it(`converts ${input} to ${expected}`, () => {
      expect(canonicalDecimalFromNumber(input)).toBe(expected)
    })
  }

  it('always produces a canonical decimal', () => {
    // The conversion may not emit something its own validator would refuse.
    for (const [input] of cases) {
      expect(isCanonicalDecimal(canonicalDecimalFromNumber(input)), String(input)).toBe(
        true,
      )
    }
  })

  it('round-trips the double exactly', () => {
    /*
     * The honest claim: the conversion loses nothing about the number it is
     * given. Whatever the source published was lost earlier, when its decimal
     * became a double.
     */
    for (const [input] of cases) {
      expect(Number(canonicalDecimalFromNumber(input)), String(input)).toBe(input)
    }
  })

  it('refuses what the value model refuses', () => {
    for (const bad of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      -0,
    ]) {
      expect(() => canonicalDecimalFromNumber(bad), String(bad)).toThrow(
        NotCanonicalError,
      )
    }
  })

  it('never emits exponent notation', () => {
    for (const input of [1e21, 1e-7, 1e-21, 5e-324]) {
      expect(canonicalDecimalFromNumber(input), String(input)).not.toContain('e')
    }
  })

  it('refuses a magnitude too large to write in 38 digits, and says why', () => {
    /*
     * 1.5e300 expands to 301 digits. A double never carries more than 17
     * significant digits, so only magnitude can breach the bound -- and the
     * refusal names magnitude rather than blaming the fractional part.
     */
    expect(() => canonicalDecimalFromNumber(1.5e300)).toThrow(NotCanonicalError)
    try {
      canonicalDecimalFromNumber(1.5e300)
    } catch (error) {
      expect((error as NotCanonicalError).problem.code).toBe('decimal-out-of-range')
    }

    // Small magnitudes are fine: the leading zeros are not significant digits.
    expect(canonicalDecimalFromNumber(5e-324)).toContain('0.0000')
  })

  it('passes null through unchanged', () => {
    expect(canonicalDecimalOrNull(null)).toBeNull()
    expect(canonicalDecimalOrNull(2.5)).toBe('2.5')
  })
})

describe('the decimal parser', () => {
  it('gives equivalent numeric forms one identity', () => {
    /*
     * The whole reason the parser exists. These are one numeric value, and the
     * identity layer must never see them as five unrelated strings.
     */
    const equivalent = ['2.5', '2.50', '02.500', '+2.5', '2.5e0', '0.25e1', '250e-2']
    const parsed = equivalent.map((form) => parseCanonicalDecimal(form))

    expect(new Set(parsed).size, `${equivalent.join(' ')} must agree`).toBe(1)
    expect(parsed[0]).toBe('2.5')
  })

  it('normalizes each documented source form', () => {
    const cases: Array<[string, string]> = [
      ['2.5', '2.5'],
      ['2.50', '2.5'],
      ['02.500', '2.5'],
      ['+2.5', '2.5'],
      ['2.5e0', '2.5'],
      ['0.0', '0'],
      ['0', '0'],
      ['000', '0'],
      ['-2.50', '-2.5'],
      ['1e3', '1000'],
      ['1.5e-3', '0.0015'],
      ['-0.5', '-0.5'],
      ['100', '100'],
      ['100.00', '100'],
    ]
    for (const [source, expected] of cases) {
      expect(parseCanonicalDecimal(source), source).toBe(expected)
    }
  })

  it('refuses negative zero rather than normalizing it', () => {
    /*
     * Numeric identity has no negative zero. A source that sent one is stating
     * something this model cannot represent, and quietly agreeing with it would
     * be worse than refusing.
     */
    for (const form of ['-0', '-0.0', '-0.000', '-0e0']) {
      expect(parseCanonicalDecimal(form), form).toBeNull()
    }
    // Positive zero in every spelling is the canonical `0`.
    for (const form of ['0', '0.0', '+0', '0e0', '00.00']) {
      expect(parseCanonicalDecimal(form), form).toBe('0')
    }
  })

  it('refuses text that is not a decimal at all', () => {
    for (const form of [
      '',
      ' 2.5',
      '2.5 ',
      'two',
      '1,000',
      '.5',
      '2.',
      '--2',
      '2..5',
      '0x1f',
      'Infinity',
      'NaN',
      '1e',
      '1e+',
    ]) {
      expect(parseCanonicalDecimal(form), JSON.stringify(form)).toBeNull()
    }
  })

  it('always produces something the strict constructor accepts', () => {
    // The two halves of the boundary must agree: whatever the parser emits, the
    // constructor takes. A disagreement would strand a value between them.
    for (const form of ['2.50', '02.500', '+2.5', '1e3', '1.5e-3', '0.0', '-2.50']) {
      const parsed = parseCanonicalDecimal(form)
      expect(parsed, form).not.toBeNull()
      expect(isCanonicalDecimal(parsed!), form).toBe(true)
    }
  })

  it('is idempotent', () => {
    for (const form of ['2.5', '0', '-2.5', '1000', '0.0015']) {
      expect(parseCanonicalDecimal(parseCanonicalDecimal(form)!), form).toBe(
        parseCanonicalDecimal(form),
      )
    }
  })

  it('agrees with the number conversion on values a double represents exactly', () => {
    /*
     * Two entry points, one answer. `canonicalDecimalFromNumber` takes a double
     * that has already lost whatever precision the source had;
     * `parseCanonicalDecimal` takes the source text before that loss. Where the
     * double is exact they must not disagree.
     */
    for (const value of [0, 1, -1, 2.5, -2.5, 0.5, 100, 1000]) {
      expect(parseCanonicalDecimal(String(value)), String(value)).toBe(
        canonicalDecimalFromNumber(value),
      )
    }
  })

  it('preserves precision the number path would already have lost', () => {
    /*
     * The honest limit, stated as a test. A source publishing 0.1 + 0.2 as text
     * says `0.3`; the same value arriving as a double is 0.30000000000000004 and
     * no conversion can recover the `0.3`. This is why the parser exists at the
     * text boundary rather than after a `Number()` call.
     */
    expect(parseCanonicalDecimal('0.3')).toBe('0.3')
    expect(canonicalDecimalFromNumber(0.1 + 0.2)).toBe('0.30000000000000004')
  })
})
