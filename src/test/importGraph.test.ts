/**
 * Architectural fitness tests (T3 + T4) — the phase gates.
 *
 * These make the dependency rules in `docs/data-architecture.md` executable
 * rather than aspirational. Without them, "the UI never imports a concrete
 * provider" is a comment that decays the first time someone is in a hurry.
 *
 * Two things moved out of this file.
 *
 * The six load-bearing rules named in the C1C-3 review now live in
 * `fitness/rules.ts` as objects, so `fitness/ruleIntegrity.test.ts` can point
 * each one at a file that breaks it and require it to fail. Every rule here had
 * only ever been run against a tree that complied, which is how eleven of them
 * carrying a literal backspace byte where `\b` was meant passed for months.
 *
 * And the scanning itself: imports and comment-blanking now come from
 * `fitness/sources.ts`, which asks TypeScript's parser. The regexes that used
 * to do it here could not tell a module specifier from a string that merely
 * looked like one, so the planted-violation fixtures — whose entire purpose is
 * to contain forbidden imports as text — read as real violations of six
 * unrelated rules the moment they were added.
 *
 * What remains is the phase gates: pinned lists, frozen inventories, and
 * assertions whose subject is one named file rather than a class of them.
 */

import { readFileSync } from 'node:fs'
import { join, resolve as resolvePath } from 'node:path'
import { describe, expect, it } from 'vitest'
import { analyseFixture, loadTree } from './fitness/sources'

// Resolved from cwd rather than `import.meta.url`: under the jsdom
// environment that URL is not a file: URL, so fileURLToPath would throw.
const SRC = resolvePath(process.cwd(), 'src')

const TREE = loadTree()

interface SourceFile {
  /** Repo-relative, forward-slashed: 'domain/market/quote.ts'. */
  path: string
  imports: string[]
  /**
   * Imports that survive compilation.
   *
   * `import type` is erased, so it is neither a bundle edge nor a way to call
   * anything. Where a rule exists to stop code crossing a boundary, this is the
   * list it should read.
   */
  valueImports: string[]
  /** The names each import binds, keyed by specifier. */
  bindings: ReadonlyMap<string, readonly string[]>
}

const FILES: SourceFile[] = TREE.map((file) => ({
  path: file.path,
  imports: file.imports.map((reference) => reference.specifier),
  valueImports: file.imports
    .filter((reference) => !reference.typeOnly)
    .map((reference) => reference.specifier),
  bindings: new Map(
    file.imports.map((reference) => [reference.specifier, reference.names]),
  ),
}))

/**
 * Removes comments and string literals before a source-level scan.
 *
 * Without this, a doc comment explaining "Date.now() is banned here" would
 * itself trip the ban — so the rule could never be documented beside the code
 * it governs.
 *
 * Parsed rather than stripped by regex. The old implementation replaced quoted
 * spans with a pattern that could not tell a comment's apostrophe from an
 * opening quote: everything after "the manager's" vanished, real code with it,
 * and every later rule in that file looked satisfied.
 */
const BLANKED = new Map(TREE.map((file) => [file.text, file.code]))
function codeOnly(source: string): string {
  return BLANKED.get(source) ?? analyseFixture('scan.tsx', source).code
}

const inLayer = (file: SourceFile, prefix: string) => file.path.startsWith(prefix)
/** The file's source, for rules about content rather than imports. */
const sourceOf = (file: SourceFile) => readFileSync(join(SRC, file.path), 'utf8')
const isTest = (file: SourceFile) =>
  /\.test\.tsx?$/.test(file.path) || file.path.startsWith('test/')

/** Resolves a `~/x` alias to a layer-relative path; returns null for packages. */
function toLayerPath(specifier: string): string | null {
  if (specifier.startsWith('~/')) return specifier.slice(2)
  return null
}

function violations(
  files: SourceFile[],
  predicate: (specifier: string, file: SourceFile) => boolean,
): string[] {
  const found: string[] = []
  for (const file of files) {
    for (const specifier of file.imports) {
      if (predicate(specifier, file)) found.push(`${file.path} → ${specifier}`)
    }
  }
  return found
}

describe('T3 — domain purity', () => {
  const domain = FILES.filter((f) => inLayer(f, 'domain/') && !isTest(f))

  it('has domain files to check', () => {
    // Guards against the suite silently passing on an empty glob.
    expect(domain.length).toBeGreaterThan(0)
  })

  it('imports nothing outside the domain layer', () => {
    expect(
      violations(domain, (specifier) => {
        const layerPath = toLayerPath(specifier)
        if (layerPath === null) return false // bare packages handled below
        return !layerPath.startsWith('domain/')
      }),
    ).toEqual([])
  })

  it('imports no runtime package — the domain is pure TypeScript', () => {
    expect(
      violations(domain, (specifier) => {
        if (specifier.startsWith('.') || specifier.startsWith('~/')) return false
        // Type-only imports of nothing; any bare specifier is a dependency.
        return true
      }),
    ).toEqual([])
  })

  it('does not touch React, node builtins, fetch, env or formatting', () => {
    const banned = [
      { pattern: /\breact\b/, label: 'React' },
      { pattern: /^node:/, label: 'node builtin' },
      { pattern: /lib\/format/, label: 'presentation formatting' },
    ]
    expect(
      violations(domain, (specifier) =>
        banned.some((rule) => rule.pattern.test(specifier)),
      ),
    ).toEqual([])

    // Source-level checks for things that are not imports.
    const offenders: string[] = []
    for (const file of domain) {
      const source = codeOnly(readFileSync(join(SRC, file.path), 'utf8'))
      if (/\bprocess\.env\b/.test(source)) offenders.push(`${file.path}: process.env`)
      if (/\bfetch\s*\(/.test(source)) offenders.push(`${file.path}: fetch()`)
      // Only the Clock abstraction may read the wall clock, and only the
      // Random abstraction may read entropy. Everything else takes them as
      // inputs, which is what makes the domain deterministic under test.
      if (
        !file.path.startsWith('domain/shared/clock') &&
        /\bDate\.now\s*\(/.test(source)
      ) {
        offenders.push(`${file.path}: Date.now()`)
      }
      if (
        !file.path.startsWith('domain/shared/random') &&
        /\bMath\.random\s*\(/.test(source)
      ) {
        offenders.push(`${file.path}: Math.random()`)
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('T4 — dependency direction', () => {
  it('application never imports infrastructure or presentation', () => {
    const application = FILES.filter((f) => inLayer(f, 'application/') && !isTest(f))
    expect(application.length).toBeGreaterThan(0)
    expect(
      violations(application, (specifier) => {
        const layerPath = toLayerPath(specifier)
        if (layerPath === null) return false
        return (
          layerPath.startsWith('infrastructure/') ||
          layerPath.startsWith('components/') ||
          layerPath.startsWith('routes/') ||
          layerPath.startsWith('presentation/')
        )
      }),
    ).toEqual([])
  })

  /*
   * "The presentation layer names no infrastructure module except a published
   * server-function boundary" is now `no-ui-import-of-infrastructure` in
   * `fitness/rules.ts`, together with the analysis-runtime half that used to
   * be asserted separately in the Phase B guards. The exception it grants —
   * that a serverFns module really is built from server functions — is checked
   * in `fitness/fitness.test.ts` rather than assumed.
   */

  it('nothing outside the composition root imports a concrete provider', () => {
    // Wiring a provider is the composition root's job and nobody else's. Tests
    // are exempt: assembling a real container with a stub or fixture provider
    // is exactly how the wiring is meant to be exercised.
    const COMPOSITION_ROOTS = [
      'infrastructure/marketData/container.ts',
      'infrastructure/marketData/containerInstance.ts',
    ]
    const callers = FILES.filter(
      (f) =>
        !f.path.startsWith('infrastructure/marketData/providers/') &&
        !COMPOSITION_ROOTS.includes(f.path) &&
        !isTest(f),
    )
    expect(
      violations(callers, (specifier) => {
        const layerPath = toLayerPath(specifier)
        if (layerPath === null) return false
        return (
          layerPath.startsWith('infrastructure/marketData/providers/') &&
          !specifier.endsWith('/providers')
        )
      }),
    ).toEqual([])
  })

  it('the Overview component imports no data module', () => {
    // Phase 0 exit criterion X1, as an executable rule rather than a promise.
    const overview = FILES.find(
      (f) => f.path === 'components/lightDashboard/LightCommandCenter.tsx',
    )
    expect(overview).toBeDefined()
    const dataImports = overview!.imports
      .map(toLayerPath)
      .filter((path): path is string => path !== null && path.startsWith('data/'))
    // `data/countryExplorer/marketCenters` is the one permitted import: it is a
    // pure function of the clock over published exchange hours, not mock data.
    // Relocating it into the domain is tracked as a follow-up.
    expect(dataImports).toEqual(['data/countryExplorer/marketCenters'])
  })

  it('domain does not import application or infrastructure', () => {
    const domain = FILES.filter((f) => inLayer(f, 'domain/'))
    expect(
      violations(domain, (specifier) => {
        const layerPath = toLayerPath(specifier)
        if (layerPath === null) return false
        return (
          layerPath.startsWith('application/') || layerPath.startsWith('infrastructure/')
        )
      }),
    ).toEqual([])
  })
})

describe('T16 — server-only secrets', () => {
  it('declares no VITE_-prefixed credential anywhere in the new layers', () => {
    // Vite exposes only VITE_* to the client. Keeping every secret unprefixed
    // makes leaking one structurally impossible rather than merely unlikely.
    const offenders: string[] = []
    for (const file of FILES) {
      if (
        !file.path.startsWith('infrastructure/') &&
        !file.path.startsWith('application/') &&
        !file.path.startsWith('domain/')
      ) {
        continue
      }
      const source = readFileSync(join(SRC, file.path), 'utf8')
      for (const match of source.matchAll(/VITE_[A-Z0-9_]*(?:KEY|SECRET|TOKEN)/g)) {
        offenders.push(`${file.path}: ${match[0]}`)
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('P11 — only approved providers are connected', () => {
  it('ships exactly the adapters their phase gates approved', () => {
    // A new adapter appearing here means a live integration landed without
    // its phase gate. Phase 0 approved the fixture; Phase 2 approved
    // Frankfurter; Phase 5 approved Avanza; Phase 6A approved the New York
    // Fed, the ECB and the Riksbank policy series. The Market Data Capability
    // Gate approved Yahoo for S&P 500 and FTSE 100 only — the two indices with
    // no free official route and no index instrument on Avanza.
    //
    // httpClient is shared plumbing, not a data source, and `avanza/map.ts`
    // and `yahoo/map.ts` are reviewed identity tables rather than adapters.
    const adapters = FILES.filter(
      (f) =>
        f.path.startsWith('infrastructure/marketData/providers/') &&
        !isTest(f) &&
        !f.path.includes('/fixture/') &&
        !f.path.includes('/avanza/') &&
        !f.path.includes('/yahoo/'),
    )
      .map((f) => f.path)
      .sort()
    expect(adapters).toEqual([
      'infrastructure/marketData/providers/avanza.ts',
      'infrastructure/marketData/providers/bundesbank.ts',
      'infrastructure/marketData/providers/coinGecko.ts',
      /* The only computed provider: Cross-Asset Risk Appetite. */
      'infrastructure/marketData/providers/derived.ts',
      'infrastructure/marketData/providers/ecb.ts',
      'infrastructure/marketData/providers/fixture.ts',
      'infrastructure/marketData/providers/frankfurter.ts',
      'infrastructure/marketData/providers/httpClient.ts',
      'infrastructure/marketData/providers/newYorkFed.ts',
      'infrastructure/marketData/providers/riksbank.ts',
      'infrastructure/marketData/providers/riksbankPolicy.ts',
      'infrastructure/marketData/providers/usTreasury.ts',
      'infrastructure/marketData/providers/yahoo.ts',
    ])
  })

  /*
   * "Only the shared http client performs an outbound network call" now lives
   * in `fitness/rules.ts` as `no-outbound-network-outside-http-client`, where a
   * planted violation proves it fires. The two versions that used to sit here
   * were both disabled by a corrupt byte, and neither could have said so.
   */

  it('keeps provider response types inside their adapter', () => {
    // The wire contract must never be exported: nothing downstream may depend
    // on a provider's payload shape.
    for (const [file, wireType] of [
      ['frankfurter.ts', 'FrankfurterTimeSeries'],
      ['coinGecko.ts', 'CoinGeckoSimplePrice'],
      ['usTreasury.ts', 'TreasuryObservation'],
      ['riksbank.ts', 'SweaObservation'],
    ] as const) {
      const source = readFileSync(
        join(SRC, `infrastructure/marketData/providers/${file}`),
        'utf8',
      )
      expect(new RegExp(`interface\\s+${wireType}`).test(source)).toBe(true)
      expect(new RegExp(`export\\s+interface\\s+${wireType}`).test(source)).toBe(false)
    }
  })

  it('never places a credential in a URL', () => {
    // Query strings end up in access logs, proxy caches and error messages.
    const offenders: string[] = []
    for (const file of FILES) {
      if (!file.path.startsWith('infrastructure/marketData/providers/')) continue
      if (isTest(file)) continue
      const source = codeOnly(readFileSync(join(SRC, file.path), 'utf8'))
      if (/[?&](api[-_]?key|apikey|token|x_cg[\w-]*)=/i.test(source)) {
        offenders.push(file.path)
      }
    }
    expect(offenders).toEqual([])
  })

  it('registers only approved providers at the composition root', () => {
    const serverFns = readFileSync(
      join(SRC, 'infrastructure/marketData/containerInstance.ts'),
      'utf8',
    )
    const imported = [
      ...serverFns.matchAll(/(?:from|import\()\s*'\.\/providers\/([\w-]+)'/g),
    ]
      .map((m) => m[1])
      .sort()
    expect(imported).toEqual([
      'avanza',
      'bundesbank',
      'coinGecko',
      'derived',
      'ecb',
      'fixture',
      'frankfurter',
      'httpClient',
      'newYorkFed',
      'riksbank',
      'riksbankPolicy',
      'usTreasury',
      'yahoo',
    ])
  })
})

describe('Phase 4B guards', () => {
  it('contains no TradingView provider', () => {
    // TradingView supplies no market data: their Charting Library docs state
    // the integrator connects their own source, and the Datafeed API is an
    // interface WE implement. There is nothing to adapt, so there is no
    // adapter — and no scraping, private endpoint or community wrapper either.
    const offenders = FILES.filter((f) => /tradingview/i.test(f.path)).map((f) => f.path)
    expect(offenders).toEqual([])

    const mentions: string[] = []
    for (const file of FILES) {
      if (!file.path.startsWith('infrastructure/')) continue
      const source = codeOnly(readFileSync(join(SRC, file.path), 'utf8'))
      if (/tradingview/i.test(source)) mentions.push(file.path)
    }
    expect(mentions).toEqual([])
  })

  it('leaves no synthetic series in the yield path', () => {
    // The mulberry32 walk that used to be drawn as a yield curve is gone from
    // every yield producer. It survives only for sparklines, which are
    // Phase 6's problem.
    const yieldFiles = [
      'infrastructure/marketData/providers/usTreasury.ts',
      'infrastructure/marketData/providers/bundesbank.ts',
      'infrastructure/marketData/providers/riksbank.ts',
    ]
    for (const path of yieldFiles) {
      const source = codeOnly(readFileSync(join(SRC, path), 'utf8'))
      expect(/syntheticSeries|Math\.random/.test(source)).toBe(false)
    }
  })

  it('adds no FRED adapter in this phase', () => {
    expect(FILES.filter((f) => /fred/i.test(f.path))).toEqual([])
  })
})

describe('Phase 6A guards — the two domains stay apart', () => {
  it('never lets domain/policy import domain/market, or the reverse', () => {
    // The central rule of Part IX, mechanically. Government yields are market
    // pricing and policy rates are official decisions; if either module could
    // reach into the other, "do not confuse them" would be a convention
    // instead of a property. Both may use `domain/shared`, which is why the
    // provenance and primitive types live there.
    const offenders: string[] = []
    for (const file of FILES) {
      if (isTest(file)) continue
      const source = codeOnly(readFileSync(join(SRC, file.path), 'utf8'))
      if (file.path.startsWith('domain/policy/') && /~\/domain\/market/.test(source)) {
        offenders.push(`${file.path} imports domain/market`)
      }
      if (file.path.startsWith('domain/market/') && /~\/domain\/policy/.test(source)) {
        offenders.push(`${file.path} imports domain/policy`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('keeps a policy rate out of the government-yield model', () => {
    // A yield and a policy rate are both a number of percent. Only the brands
    // stop one being stored where the other belongs.
    const source = codeOnly(readFileSync(join(SRC, 'domain/market/rates.ts'), 'utf8'))
    expect(source).not.toMatch(/PolicyRatePercent|CentralBank/)
  })

  it('populates no central-bank decision from a rate series', () => {
    // Phase 6A defines the decision contract and deliberately fills nothing:
    // a step in a daily series says a level changed, not when a committee
    // announced it or what it said.
    const offenders: string[] = []
    for (const file of FILES) {
      if (isTest(file)) continue
      if (!file.path.startsWith('infrastructure/')) continue
      if (
        /CentralBankDecision|CentralBankMeeting/.test(
          codeOnly(readFileSync(join(SRC, file.path), 'utf8')),
        )
      ) {
        offenders.push(file.path)
      }
    }
    expect(offenders).toEqual([])
  })

  it('adds no central-bank rendering', () => {
    // No UI in Phase 6A. Nothing under components/ or routes/ may know these
    // types exist.
    const offenders = FILES.filter(
      (f) =>
        (f.path.startsWith('components/') || f.path.startsWith('routes/')) &&
        /~\/domain\/policy|CentralBanksSnapshot/.test(
          codeOnly(readFileSync(join(SRC, f.path), 'utf8')),
        ),
    ).map((f) => f.path)
    expect(offenders).toEqual([])
  })
})

describe('C1 — the legacy stack is frozen', () => {
  /**
   * Everything importing the pre-Phase-0 mock data today.
   *
   * This list may SHRINK as routes migrate. It must never grow: a new entry
   * means a feature was built on invented data with no provenance, no
   * staleness and no source, in a codebase that spent six phases making those
   * things structural. Adding one here should require the same deliberation as
   * adding a provider.
   *
   * Absent because they have migrated: `routes/watchlist.tsx`,
   * `routes/markets.tsx`. `AppHeader` migrated and was later deleted with
   * `AppSidebar`: neither was mounted by any route or layout.
   */
  const FROZEN_MOCK_CONSUMERS = [
    'components/countryExplorer/FloatingMarketChips.tsx',
    'data/countryExplorer/mockNow.ts',
    'data/countryExplorer/trendSeries.ts',
    'routes/portfolio.tsx',
    'routes/reports.tsx',
    'services/avanzaMcp/serverFns.ts',
    'services/investmentLetter/agentRoster.ts',
    'services/investmentLetter/mockFixtures.ts',
    'services/marketDataService.ts',
  ]

  it('shrinks as routes migrate, and is the migration metric', () => {
    // 13 at the freeze, one per migration thereafter. This number going down
    // is the only measure of C1 progress that cannot be argued with.
    //
    // 11 → 9 in C2-2 Stage A, and the two that left did not migrate to a real
    // data source — they were DELETED. `routes/agents.tsx` and
    // `components/agents/AgentCard.tsx` presented five invented agents with
    // invented progress values, and Agent Headquarters replaced them with the
    // seeded organization and its real runs. The metric counts consumers of
    // the mock data, and a consumer that no longer exists is the strongest way
    // to stop being one.
    expect(FROZEN_MOCK_CONSUMERS).toHaveLength(9)
  })

  it('gains no new consumer of the mock data', () => {
    // Uses the PARSED import list, not a source scan: `codeOnly` strips string
    // literals, and a module specifier is a string literal — a source scan for
    // an import path can never match anything.
    const consumers = FILES.filter((f) =>
      f.imports.some((specifier) => specifier.startsWith('~/data/mockData')),
    )
      .map((f) => f.path)
      .sort()

    const added = consumers.filter((path) => !FROZEN_MOCK_CONSUMERS.includes(path))
    expect(added).toEqual([])
  })

  it('keeps the legacy service out of the new architecture entirely', () => {
    // The old stack may keep working; it may not leak inward. Nothing under
    // domain/, application/ or infrastructure/ may reach for it.
    const offenders: string[] = []
    for (const file of FILES) {
      if (isTest(file)) continue
      if (
        !file.path.startsWith('domain/') &&
        !file.path.startsWith('application/') &&
        !file.path.startsWith('infrastructure/')
      ) {
        continue
      }
      const banned = (specifier: string) =>
        specifier.startsWith('~/data/mockData') ||
        specifier.startsWith('~/services/marketDataService') ||
        specifier.startsWith('~/types')
      if (file.imports.some(banned)) offenders.push(file.path)
    }
    expect(offenders).toEqual([])
  })
})

describe('AI Phase A guards — an organization, and no runtime', () => {
  it('keeps domain/analysis independent of the market and policy domains', () => {
    // Three bounded contexts. `domain/analysis` describes a firm and knows
    // nothing about instruments or policy rates; the typed bridges live in
    // `application/analysis`, which is allowed to know all three.
    const offenders: string[] = []
    for (const file of FILES) {
      if (isTest(file)) continue
      if (!file.path.startsWith('domain/analysis/')) continue
      for (const specifier of file.imports) {
        if (
          specifier.startsWith('~/domain/market') ||
          specifier.startsWith('~/domain/policy')
        ) {
          offenders.push(`${file.path} imports ${specifier}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('keeps the market and policy domains unaware of analysis', () => {
    const offenders = FILES.filter(
      (f) =>
        !isTest(f) &&
        (f.path.startsWith('domain/market/') || f.path.startsWith('domain/policy/')) &&
        f.imports.some((s) => s.startsWith('~/domain/analysis')),
    ).map((f) => f.path)
    expect(offenders).toEqual([])
  })

  /*
   * "Nothing imports a model client" was asserted three times, in three
   * describes, with three different package patterns — three answers to one
   * question, and the narrowest of them decided nothing. It is now
   * `no-llm-dependency` in `fitness/rules.ts`, once, and covering tests too:
   * a test importing an SDK means the dependency is installed and the C2
   * decisions have already been made somewhere.
   */

  /*
   * Phase A forbade `infrastructure/analysis` entirely. Phase B lifts that
   * deliberately — the runtime lives there — and every other boundary stays.
   * See the Phase B guards below.
   */

  it('lets no component or route EXECUTE domain analysis logic', () => {
    /*
     * Written for Phase A as "no analysis imports at all", when no interface to
     * the institution was authorised and any such import meant somebody had
     * started building one early.
     *
     * The Headquarters view is now a commissioned surface, so the rule says
     * what was actually dangerous: a component that CALLS a domain function is
     * a second place eligibility, blocking or standing gets decided. Rendering
     * a `CaseStanding` is not that; computing one is.
     *
     * `import type` is erased at compile time — no bundle edge, nothing
     * callable — so only value imports are counted.
     */
    const offenders = FILES.filter(
      (f) =>
        (f.path.startsWith('components/') || f.path.startsWith('routes/')) &&
        f.valueImports.some((s) => s.startsWith('~/domain/analysis')),
    ).map((f) => f.path)
    expect(offenders).toEqual([])
  })

  it('leaves the legacy investmentLetter prototype running and unmodified', () => {
    // It is a product specification and a prototype. It is replaced by the
    // Agents migration, not by Phase A.
    const legacy = FILES.filter((f) => f.path.startsWith('services/investmentLetter/'))
    expect(legacy.length).toBeGreaterThan(0)
    const offenders = legacy.filter((f) =>
      f.imports.some((s) => s.startsWith('~/domain/analysis')),
    )
    expect(offenders.map((f) => f.path)).toEqual([])
  })

  it('keeps the headquarters a first-class navigation destination', () => {
    /*
     * A permanent product requirement, not a styling detail: the firm's
     * investment floor is the digital headquarters of Financial OS, and it
     * must not be demoted to a settings page, a modal or a subsection of
     * Reports.
     *
     * **The destination was renamed, not demoted.** Command Center v1 merged
     * `/agents` and `/cases` — two screens both claiming to be the
     * headquarters, one of them literally titled *Huvudkontor* while holding
     * no desks — into `/headquarters`, and moved it up the navigation.
     * `/agents` still resolves and redirects there.
     */
    const navigation = readFileSync(join(SRC, 'lib/navigation.ts'), 'utf8')
    expect(navigation).toMatch(/to:\s*'\/headquarters'/)
    expect(navigation).toMatch(/label:\s*'Huvudkontor'/)
  })
})

describe('AI Phase B guards — the runtime respects its layers', () => {
  it('keeps domain/analysis free of application and infrastructure', () => {
    const offenders: string[] = []
    for (const file of FILES) {
      if (isTest(file) || !file.path.startsWith('domain/analysis/')) continue
      for (const specifier of file.imports) {
        if (
          specifier.startsWith('~/application') ||
          specifier.startsWith('~/infrastructure')
        ) {
          offenders.push(`${file.path} imports ${specifier}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('keeps application/analysis off infrastructure', () => {
    // It depends on domain contracts and its own ports. Infrastructure
    // implements those ports, never the other way round.
    const offenders: string[] = []
    for (const file of FILES) {
      if (isTest(file) || !file.path.startsWith('application/analysis/')) continue
      for (const specifier of file.imports) {
        if (specifier.startsWith('~/infrastructure')) {
          offenders.push(`${file.path} imports ${specifier}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  /* Both now in `fitness/rules.ts` — see the note in the Phase A guards. */

  /*
   * "No domain record carries generated activity prose" is now
   * `no-prose-activity-in-domain` in `fitness/rules.ts`. It checked two files
   * with two expressions, both of which had been matching nothing since they
   * were written; the replacement reads every declaration in `domain/analysis`
   * from the AST, and found a generated sentence in `waitingChains` on its
   * first live run.
   */

  it('leaves the legacy investmentLetter prototype untouched by the runtime', () => {
    const offenders = FILES.filter(
      (f) =>
        f.path.startsWith('services/investmentLetter/') &&
        f.imports.some((s) => s.includes('/analysis')),
    ).map((f) => f.path)
    expect(offenders).toEqual([])
  })

  it('keeps the headquarters a first-class navigation destination', () => {
    const navigation = readFileSync(join(SRC, 'lib/navigation.ts'), 'utf8')
    expect(navigation).toMatch(/to:\s*'\/headquarters'/)
    expect(navigation).toMatch(/label:\s*'Huvudkontor'/)
  })
})

describe('Storage stage 1 — the database stays on the server', () => {
  /*
   * The migration runner opens a connection and reads the filesystem, and the
   * test harness starts a database. Neither belongs anywhere near a browser
   * bundle. The runner also guards itself at runtime, but a guard that throws
   * in production is a worse outcome than a build that never shipped the
   * module — so the import graph is the primary control.
   */
  const postgres = 'infrastructure/analysis/postgres/'

  it('is never reached from presentation or routes', () => {
    const client = FILES.filter(
      (f) => inLayer(f, 'presentation/') || inLayer(f, 'routes/'),
    )
    const offenders = violations(client, (specifier) => {
      const layer = toLayerPath(specifier)
      return (
        (layer?.startsWith(postgres) ?? false) ||
        specifier.includes('/postgres/migrations') ||
        specifier === 'pg'
      )
    })
    expect(offenders).toEqual([])
  })

  it('keeps the database driver out of every layer above infrastructure', () => {
    const above = FILES.filter(
      (f) =>
        !inLayer(f, 'infrastructure/') &&
        !inLayer(f, 'test/') &&
        f.imports.some((s) => s === 'pg' || s.startsWith('pg/')),
    ).map((f) => f.path)
    expect(above).toEqual([])
  })

  it('keeps the integration harness out of application code', () => {
    /*
     * `testDatabase` imports `embedded-postgres`, a devDependency. Reaching it
     * from application code would compile locally and fail to install in
     * production.
     */
    const offenders = FILES.filter((f) => !isTest(f) && !inLayer(f, 'test/'))
      .filter((f) =>
        f.imports.some((s) => s.includes('testDatabase') || s === 'embedded-postgres'),
      )
      .map((f) => f.path)
    expect(offenders).toEqual([])
  })

  it('applies migrations only through the runner', () => {
    // Nothing else reads the SQL directory. A second code path that applied
    // migrations would not record checksums, and the history would stop being
    // a description of the database.
    const offenders = FILES.filter(
      (f) =>
        !f.path.startsWith('infrastructure/analysis/postgres/') &&
        codeOnly(readFileSync(join(SRC, f.path), 'utf8')).includes('db/migrations'),
    ).map((f) => f.path)
    expect(offenders).toEqual([])
  })
})

describe('Storage — the adapter is reachable only from the composition root', () => {
  const postgres = 'infrastructure/analysis/postgres/'

  it('is constructed by nothing but the composition root and the tests', () => {
    /*
     * Written at stage 2, when the adapter existed and nothing wired it. It is
     * wired now — `container.ts` is the analysis composition root and selects
     * PostgreSQL as the only runtime store — so the property worth holding is
     * the narrower one: selecting a store is the root's job and nobody else's.
     *
     * It was not restated when that changed because it could not fail. The old
     * scanner's import pattern forbade a newline between `import` and `from`,
     * so every multi-line import in the codebase was invisible to it — 203 of
     * 1583, across 143 files — and this rule had never once seen the import it
     * exists to find.
     */
    const COMPOSITION_ROOT = 'infrastructure/analysis/container.ts'
    const offenders = FILES.filter(
      (file) =>
        !isTest(file) && !inLayer(file, postgres) && file.path !== COMPOSITION_ROOT,
    )
      .filter((file) => file.imports.some((s) => s.includes('postgresRepositories')))
      .map((file) => file.path)
    expect(offenders).toEqual([])
  })

  it('never lets a row type escape the adapter', () => {
    // A row is a transport detail — snake_case, nullable, `unknown` where the
    // domain has a union. Letting one out would put the database's shape into
    // the application layer, which is what the ports exist to prevent.
    const offenders = FILES.filter((file) => !inLayer(file, postgres))
      .filter((file) => file.imports.some((s) => s.includes('/postgres/rows')))
      .map((file) => file.path)
    expect(offenders).toEqual([])
  })

  it('keeps the analysis context off the market-data context', () => {
    // The shared kernel exists so that observability is not a reason for one
    // bounded context to depend on another.
    const offenders = FILES.filter(
      (file) =>
        inLayer(file, 'application/analysis/') || inLayer(file, 'domain/analysis/'),
    )
      .filter((file) =>
        file.imports.some((s) => s.startsWith('~/application/marketData')),
      )
      .map((file) => file.path)
    expect(offenders).toEqual([])
  })

  it('routes every statement through a catalogue', () => {
    /*
     * `StorageProvenance.queryCatalogHash` answers "which SQL produced this
     * analysis" years later, and is computable only while every statement is
     * enumerable. A repository that inlined SQL would silently shrink what the
     * hash covers.
     */
    const repositories = FILES.filter(
      (file) => inLayer(file, postgres) && file.path.endsWith('Repositories.ts'),
    )
    expect(repositories.length).toBeGreaterThan(0)

    const offenders = repositories
      .filter((file) => {
        const source = codeOnly(readFileSync(join(SRC, file.path), 'utf8'))
        // Every SELECT/INSERT/UPDATE must sit inside a `catalog({ … })` block.
        return (
          /(SELECT|INSERT INTO|UPDATE) /.test(source) && !source.includes('catalog({')
        )
      })
      .map((file) => file.path)
    expect(offenders).toEqual([])
  })
})

describe('Phase C1A — the command foundation', () => {
  it('constructs the in-memory store nowhere but its own module and tests', () => {
    /*
     * The composition root selects PostgreSQL and nothing else. A fallback to
     * memory is how a system ends up "working" while storing nothing, which is
     * discovered later and by someone else.
     */
    const offenders = FILES.filter(
      (file) =>
        !isTest(file) &&
        file.path !== 'infrastructure/analysis/inMemoryRepositories.ts' &&
        file.path !== 'infrastructure/analysis/repositoryContract.ts',
    )
      .filter((file) => file.imports.some((s) => s.includes('inMemoryRepositories')))
      .map((file) => file.path)
    expect(offenders).toEqual([])
  })

  it('keeps command handlers out of infrastructure', () => {
    // A handler may use the domain and the ports. Reaching an adapter would
    // let one command know which database it is running against.
    const commands = FILES.filter((f) => inLayer(f, 'application/analysis/commands/'))
    expect(commands.length).toBeGreaterThan(0)

    const offenders = violations(commands, (specifier) => {
      const layer = toLayerPath(specifier)
      return layer?.startsWith('infrastructure/') ?? false
    })
    expect(offenders).toEqual([])
  })

  it('opens no transaction inside a command handler', () => {
    /*
     * `runCommand` owns the boundary. A handler that opened its own would put
     * the ledger entry and the effect in different transactions, and a
     * committed command could then exist without its effect.
     */
    const offenders = FILES.filter(
      (f) =>
        inLayer(f, 'application/analysis/commands/') &&
        !isTest(f) &&
        !f.path.endsWith('runCommand.ts') &&
        !f.path.endsWith('resolveCommand.ts'),
    )
      .filter((f) =>
        codeOnly(readFileSync(join(SRC, f.path), 'utf8')).includes('withTransaction('),
      )
      .map((f) => f.path)
    expect(offenders).toEqual([])
  })

  it('never describes an actor as authenticated', () => {
    // TD-8 is open. `system-asserted` is the only honest state, and a stray
    // `authenticated` would be a claim the system cannot make.
    const analysis = FILES.filter(
      (f) =>
        !isTest(f) &&
        (inLayer(f, 'domain/analysis/') ||
          inLayer(f, 'application/analysis/') ||
          inLayer(f, 'infrastructure/analysis/')),
    )
    const offenders = analysis
      .filter((f) => {
        const source = codeOnly(readFileSync(join(SRC, f.path), 'utf8'))
        return /authentication:\s*'authenticated'/.test(source)
      })
      .map((f) => f.path)
    expect(offenders).toEqual([])
  })

  it('ships exactly the approved commands', () => {
    /*
     * Pinned rather than counted, so a command arriving without a gate fails
     * here — a command is an institutional act, and the set of acts the firm
     * can perform is not something that should grow quietly.
     */
    const handlers = FILES.filter(
      (f) => inLayer(f, 'application/analysis/commands/') && !isTest(f),
    ).map((f) => f.path.split('/').pop())
    expect(handlers?.sort()).toEqual([
      'acceptContribution.ts',
      'aggregateManagerConclusion.ts',
      /* The person adds to their own open case. TD-94's door. */
      'amendCase.ts',
      'assembleEvidenceSet.ts',
      /* The person closes their own case on instruction; history kept. */
      'closeCase.ts',
      'definition.ts',
      'envelope.ts',
      'eventIdentity.ts',
      'failAgentRun.ts',
      'instantiatePlaybook.ts',
      'openInvestmentCase.ts',
      'proposeThesis.ts',
      'recordCaseDecision.ts',
      'recordContribution.ts',
      'recordDevilsAdvocateReview.ts',
      /* What a control function's model produced, before anyone files it. */
      'recordGovernanceCandidate.ts',
      'recordPeerExamination.ts',
      'recordRiskReview.ts',
      'recordVerificationReview.ts',
      'registry.ts',
      'rejectContribution.ts',
      'reopenForReconsideration.ts',
      'resolveCommand.ts',
      'resolveConditionalRequirement.ts',
      'returnForCorrection.ts',
      'returnFromCioReview.ts',
      'reviseThesis.ts',
      'runCommand.ts',
      'startAgentRun.ts',
      'submitForCioDecision.ts',
      'submitForVerification.ts',
    ])
  })
})

describe('Phase C1C-1 — the external-work boundary', () => {
  it('lets no command reach a contribution provider', () => {
    /*
     * The first of three protections for D-C1C-4. A command body runs inside
     * `runCommand`'s transaction; if it could call a provider, a PostgreSQL
     * transaction would stay open across a network call that may take minutes
     * or never return. A command that cannot SEE the provider cannot call it.
     */
    const offenders = FILES.filter(
      (f) =>
        inLayer(f, 'application/analysis/commands/') &&
        !isTest(f) &&
        f.imports.some((specifier) => specifier.includes('contributionPort')),
    ).map((f) => f.path)
    expect(offenders).toEqual([])
  })

  /*
   * The second and third protections for D-C1C-4 now live in `fitness/rules.ts`
   * as `orchestrator-writes-nothing-directly` and
   * `no-caller-supplied-or-invented-identity`. Both read the AST rather than
   * the text, so the identity rule covers concatenation and entropy as well as
   * the template literal the old expression looked for.
   */

  it('resolves playbooks only through the registry', () => {
    /*
     * TD-31. A command importing the macro playbook directly would be making
     * the routing decision at the call site again.
     */
    const offenders = FILES.filter(
      (f) =>
        inLayer(f, 'application/analysis/commands/') &&
        !isTest(f) &&
        f.imports.some((specifier) => specifier.includes('macroPlaybook')),
    ).map((f) => f.path)
    expect(offenders).toEqual([])
  })

  it('declares live work only in the live provider', () => {
    /*
     * LIFTED at the C2 gate, and narrowed rather than deleted.
     *
     * It used to ban the live provider kind outright, because the four
     * decisions the gate demanded had not been made. They are made and the
     * provider exists, so the blanket ban is over. What survives is the
     * property underneath it: a provider kind is DECLARED BY THE PROVIDER, so
     * a fixture cannot enter the record as live work because whoever wired it
     * up passed the wrong string. Exactly one non-test module may say it.
     *
     * ## Why this reads the raw source
     *
     * The two guards this replaces both ran their regex over `codeOnly`, which
     * BLANKS STRING LITERAL CONTENTS — the literal they were searching for was
     * erased before the search. They matched nothing, could only ever return
     * an empty array, and passed for that reason rather than because the
     * codebase complied. Exactly the failure `fitness/rules.ts` was built to
     * end, reappearing in an inline `it()`.
     *
     * So this reads `sourceOf` directly. The cost is that prose must not spell
     * the literal out; the comments here are worded around it deliberately.
     *
     * ## It sees a named constant too, since C2-2 Stage C
     *
     * The pattern matched only an object-literal property, so a module could
     * hold the value in an exported constant and this would report that nobody
     * declares live work anywhere — which is what happened the moment the live
     * provider did exactly that, correctly, so that callers reasoning about
     * live work refer to the provider's own declaration instead of restating
     * the string. A guard that can be stepped around by moving a value into a
     * constant is not asserting where the value lives.
     *
     * So both assignment forms are matched, and comparisons deliberately are
     * not: reading the kind and deciding something (`providerKind === …`) is
     * what the domain's budget and usage rules do all day. What must stay
     * confined is SAYING that something IS live work.
     */
    const declaresLive = /[kK][iI][nN][dD]\s*(?::\s*\w+\s*)?[:=]\s*'live'/
    const offenders = FILES.filter(
      (f) => !isTest(f) && declaresLive.test(sourceOf(f)),
    ).map((f) => f.path)
    expect(offenders).toEqual([
      'infrastructure/analysis/providers/live.ts',
      /*
       * The control functions' provider, added at G1 (2026-09-17): one module
       * whose three identities — verification, challenge, peer examination —
       * each carry their own prompt id and contract, and which declares its
       * own kind for the same reason the other two do.
       */
      'infrastructure/analysis/providers/liveGovernance.ts',
      /*
       * The synthesis provider, added at P4.5b. A separate module rather than a
       * mode on the claim provider, because it produces a different artifact
       * answering a different question — and the two would otherwise have
       * shared a prompt id, a contract version and an output schema version
       * while meaning different things by all three.
       *
       * It declares its own kind for exactly the reason this rule exists: a
       * provider states what it is, so nothing can enter the record as live
       * work because a caller passed the wrong string.
       */
      'infrastructure/analysis/providers/liveSynthesis.ts',
      /*
       * Test support, not production. The shared repository contract drives
       * live runs through both adapters, which is the only way the parity
       * cases can prove a live run round-trips at all. It is named without
       * `.test.ts` because it is a suite two test files invoke, so `isTest`
       * does not classify it — pinned here rather than by loosening `isTest`,
       * which several other rules depend on.
       */
      'infrastructure/analysis/repositoryContract.ts',
    ])
  })

  it('keeps raw provider text out of the failure record', () => {
    /*
     * The orchestrator used to put `error.message` — a provider's own words —
     * into a free-text `failureReason`, which then flowed into logs and read
     * models. The field is a closed category now, and nothing may reintroduce
     * the old one.
     */
    const offenders = FILES.filter(
      (f) => !isTest(f) && /failureReason/.test(codeOnly(sourceOf(f))),
    ).map((f) => f.path)
    expect(offenders).toEqual([])
  })
})

describe('Phase C1C-2 — contribution', () => {
  const providers = 'infrastructure/analysis/providers/'

  it('ships exactly the approved contribution providers', () => {
    /*
     * Five now, and two of them are models. C2 lifted the gate that kept this
     * list at two; the list itself stays, so a SIXTH file appearing here is
     * still a provider landing without a decision — the same control the
     * market-data adapters are under, for the same reason.
     *
     * The fifth is the Research Office synthesis provider, approved at P4.5b.
     * The sixth and seventh are the control functions' provider — one module,
     * three identities, one per function — and its stub, approved at G1
     * (2026-09-17): the committee's scrutiny, produced as candidates.
     */
    const adapters = FILES.filter((f) => inLayer(f, providers) && !isTest(f))
      .map((f) => f.path)
      .sort()
    expect(adapters).toEqual([
      'infrastructure/analysis/providers/index.ts',
      'infrastructure/analysis/providers/live.ts',
      'infrastructure/analysis/providers/liveGovernance.ts',
      'infrastructure/analysis/providers/liveSynthesis.ts',
      'infrastructure/analysis/providers/modelClient.ts',
      'infrastructure/analysis/providers/recorded.ts',
      'infrastructure/analysis/providers/stub.ts',
      'infrastructure/analysis/providers/stubGovernance.ts',
    ])
  })

  it('gives the stub no way to name a model', () => {
    /*
     * TD-32, as a rule rather than a hope. The stub declares a scenario; if it
     * could reach `PromptRef` or `ModelRef` it could describe itself as a model
     * execution again, and a placeholder in a field named `model` is a real
     * model identity to every reader downstream.
     */
    const stub = FILES.find((f) => f.path.endsWith('providers/stub.ts'))
    expect(stub).toBeDefined()
    const source = codeOnly(sourceOf(stub!))
    expect(source).not.toMatch(/\bPromptRef\b|\bModelRef\b/)
    expect(source).not.toMatch(/\bmodel\s*:/)
  })

  it('lets nothing express usage as a nullable amount', () => {
    /*
     * TD-33. `null` had to mean three things — nothing to spend, nothing
     * reported, nobody looked — and the ambiguity falls on the expensive side,
     * because null reads as free. The state is what carries the meaning now.
     */
    const offenders = FILES.filter(
      (f) =>
        !isTest(f) &&
        f.path.includes('/analysis/') &&
        /usage:\s*null|cost\?:\s*RunCost/.test(codeOnly(sourceOf(f))),
    ).map((f) => f.path)
    expect(offenders).toEqual([])
  })

  it('keeps claim identity out of the provider’s hands', () => {
    /*
     * A provider names its own claims — a fixture is written before it is
     * replayed, and a counterclaim has to say what it contests. Those names
     * are local to one contribution: `RecordContribution` translates them
     * through `deriveClaimId`, and a handler storing `claim.id` unchanged
     * would let two replays of one fixture collide.
     */
    const handler = FILES.find((f) => f.path.endsWith('commands/recordContribution.ts'))
    expect(handler).toBeDefined()
    expect(handler!.imports).toContain('./eventIdentity')
    expect(codeOnly(sourceOf(handler!))).toMatch(/id:\s*deriveClaimId\(/)
  })

  it('validates a contribution outside the handler that stores it', () => {
    // What a defect IS and what to DO about it are different decisions. Kept
    // apart so each rule is testable without a case, a run and a transaction
    // around it.
    const validation = FILES.find((f) =>
      f.path.endsWith('application/analysis/contributionValidation.ts'),
    )
    expect(validation).toBeDefined()
    const offenders = violations([validation!], (specifier) => {
      const layer = toLayerPath(specifier)
      return layer?.startsWith('infrastructure/') ?? false
    })
    expect(offenders).toEqual([])
  })

  it('sequences the provider from one place only', () => {
    /*
     * The orchestrator holds the provider. Nothing else in the application
     * layer may call one: a second sequencer would be a second opinion about
     * when a transaction is open, and the boundary would hold in one of them.
     *
     * ## Strengthened at C2-2 Stage C, not relaxed
     *
     * This used to assert that no application module IMPORTS `contributionPort`,
     * which is a proxy for the property rather than the property. Two things
     * were wrong with it, and only the second showed up.
     *
     * It was too strict in one direction: `commissionAnalysis` names
     * `ContributionProvider` as a **type**, to receive a provider and hand it
     * to the one sequencer. It calls nothing. Passing the orchestrator a
     * provider is what every caller of `runPlaybook` has always done, and doing
     * it from the application layer rather than from `smokeFns` does not make
     * it a second sequencer.
     *
     * And it was too weak in the other, which matters more: an import check
     * cannot see a CALL. A module that named the port type-only and then
     * invoked `provider.contribute()` around its own transaction — the exact
     * failure this exists to prevent — would have satisfied the old assertion
     * completely.
     *
     * So the property is asserted directly. Exactly one non-test application
     * module may invoke a provider, and the modules permitted even to name the
     * port are pinned, so a third becomes a deliberate act rather than an
     * import somebody added.
     */
    const invokesAProvider = /\.(contribute|declare)\s*\(/
    const sequencers = FILES.filter(
      (f) =>
        inLayer(f, 'application/analysis/') &&
        !isTest(f) &&
        invokesAProvider.test(codeOnly(sourceOf(f))),
    ).map((f) => f.path)
    expect(sequencers).toEqual(['application/analysis/orchestrator.ts'])

    const namesThePort = FILES.filter(
      (f) =>
        inLayer(f, 'application/analysis/') &&
        !isTest(f) &&
        !f.path.endsWith('contributionPort.ts') &&
        f.imports.some((specifier) => specifier.includes('contributionPort')),
    )
      .map((f) => f.path)
      .sort()
    expect(namesThePort).toEqual([
      /* Receives a provider and hands it to the orchestrator. Calls nothing. */
      'application/analysis/commissionAnalysis.ts',
      /*
       * Receives the provider the container built and hands it to
       * `commissionAnalysis` when the firm is advanced on the person's word
       * (host `begin`, 2026-09-17). Calls nothing; the sequencer check above
       * is what proves that, and this pin is what makes a third a decision.
       */
      'application/analysis/domainSystem.ts',
      'application/analysis/orchestrator.ts',
    ])
  })
})

describe('Phase C1C-3 — aggregation and revision minting', () => {
  it('mints revisions in exactly one place', () => {
    /*
     * Three commands produce revisions. The rules about lineage, numbering and
     * supersession fail silently when duplicated — a revision superseding the
     * wrong predecessor reads exactly like one superseding the right one — so
     * only `revisions.ts` may call the domain's minting builders.
     *
     * Resolved through the import binding rather than by name. `reviseThesis`
     * is a domain builder AND a command factory, and the text scan this
     * replaces could not tell them apart: it reported the command registry for
     * calling its own handler, and would have reported a genuine second minting
     * path in exactly the same words.
     */
    const MAY_MINT = [
      'application/analysis/revisions.ts',
      // Rehydrates a stored revision rather than minting one; the builder is
      // how a row becomes a domain record.
      'infrastructure/analysis/postgres/mapping.ts',
      // A shared test harness, run against both adapters. Not production code,
      // and not covered by `isTest` because it holds no test of its own.
      'infrastructure/analysis/repositoryContract.ts',
    ]
    const MINTING_BUILDERS = ['buildThesis', 'reviseThesis']

    const offenders = FILES.filter(
      (f) =>
        !isTest(f) &&
        !f.path.startsWith('domain/') &&
        !MAY_MINT.includes(f.path) &&
        [...f.bindings].some(
          ([specifier, names]) =>
            specifier.startsWith('~/domain/analysis') &&
            names.some((name) => MINTING_BUILDERS.includes(name)),
        ),
    ).map((f) => f.path)
    expect(offenders).toEqual([])
  })

  it('routes every revision-producing command through mintRevision', () => {
    for (const handler of [
      'proposeThesis.ts',
      'aggregateManagerConclusion.ts',
      'reviseThesis.ts',
    ]) {
      const file = FILES.find((f) => f.path.endsWith(`commands/${handler}`))
      expect(file).toBeDefined()
      expect(file!.imports).toContain('../revisions')
    }
  })

  it('lets no command handler import another command handler', () => {
    /*
     * One handler is one transaction. Composing them would put two ledger
     * entries where the caller believes there is one, which is why the shared
     * work is an operation rather than a fourth command.
     */
    const handlers = FILES.filter(
      (f) =>
        inLayer(f, 'application/analysis/commands/') &&
        !isTest(f) &&
        ![
          'definition.ts',
          'envelope.ts',
          'registry.ts',
          'runCommand.ts',
          'resolveCommand.ts',
          'eventIdentity.ts',
        ].some((infrastructure) => f.path.endsWith(infrastructure)),
    )
    const commandModules = new Set(
      FILES.filter((f) => inLayer(f, 'application/analysis/commands/')).map((f) =>
        f.path.split('/').pop()!.replace(/\.ts$/, ''),
      ),
    )
    const shared = new Set([
      'definition',
      'envelope',
      'eventIdentity',
      'runCommand',
      'resolveCommand',
      'registry',
    ])

    const offenders: string[] = []
    for (const handler of handlers) {
      for (const specifier of handler.imports) {
        const name = specifier.replace(/^\.\//, '')
        if (commandModules.has(name) && !shared.has(name)) {
          offenders.push(`${handler.path} → ${specifier}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('decides eligibility in one place, and never in a handler', () => {
    // The aggregation records facts. Whether a revision reaches the CIO is
    // `evaluateRevisionEligibility`'s decision, and a handler reimplementing a
    // blocking rule is how two answers to one question appear.
    const offenders = FILES.filter(
      (f) =>
        inLayer(f, 'application/analysis/commands/') &&
        !isTest(f) &&
        /evaluateRevisionEligibility|evaluateThesisEligibility/.test(
          codeOnly(sourceOf(f)),
        ),
    ).map((f) => f.path)
    expect(offenders).toEqual([])
  })

  it('never persists or literalises a blocking judgement again', () => {
    /*
     * Strengthened rather than removed. The rule used to forbid a LITERAL
     * `blocksEligibility: true|false` outside the domain, on the reasoning that
     * one function should derive the effect.
     *
     * Migration 0023 went further: the judgement is no longer stored at all.
     * Whether a materiality blocks is a POLICY question, and the policy is
     * chosen at submission -- later than aggregation, by a different actor,
     * possibly at a different threshold. A value written before its governing
     * policy is known is a future judgement, not a historical fact.
     *
     * So this now forbids the field itself, in either casing, anywhere in
     * production code. The approved derivation
     * `disagreementBlocksEligibility(materiality, threshold)` remains legal --
     * it is a function call taking a policy threshold, not a stored or
     * literalised verdict.
     */
    const offenders = FILES.filter((f) => {
      if (isTest(f)) return false
      const code = codeOnly(sourceOf(f))
      // The function is the sanctioned form; ignore its call sites and its own
      // definition before looking for the field.
      const withoutTheFunction = code.replace(/disagreementBlocksEligibility/g, '')
      return /blocksEligibility|blocks_eligibility/.test(withoutTheFunction)
    }).map((f) => f.path)

    expect(
      offenders,
      'a blocking judgement may be derived under a policy, never stored',
    ).toEqual([])
  })

  it('reads the Risk rule nowhere but the domain', () => {
    // A second implementation of "does Risk apply" is a second answer.
    const offenders = FILES.filter(
      (f) =>
        !isTest(f) &&
        !f.path.startsWith('domain/analysis/') &&
        /RISK_REVIEW_WHEN_IMPLEMENTABLE\.evaluate/.test(codeOnly(sourceOf(f))),
    ).map((f) => f.path)
    expect(offenders).toEqual([])
  })

  it('offers no way to supply a conditional outcome', () => {
    /*
     * TD-29's closing property. The command computes the result, so its input
     * has no field a caller could use to state one — stronger than accepting
     * an answer and rejecting it when it disagrees.
     */
    const file = FILES.find((f) =>
      f.path.endsWith('commands/resolveConditionalRequirement.ts'),
    )
    expect(file).toBeDefined()
    const input = codeOnly(sourceOf(file!)).split('export function')[0]!
    expect(input).not.toMatch(/\b(required|outcome|state)\s*[?]?:/)
  })

  it('keeps aggregation query fields out of jsonb', () => {
    /*
     * "Which claims did the manager set aside, and why" is the question the
     * CIO asks before selecting a thesis. Behind a document it is a scan and a
     * parse, so claim ids, dispositions, materiality and scope are columns.
     */
    const migration = readFileSync(
      join(SRC, '..', 'db', 'migrations', '0018_manager_aggregations.sql'),
      'utf8',
    )
    for (const column of [
      'claim_id',
      'disposition',
      'materiality',
      'blocks_eligibility',
      'scope',
      'run_id',
    ]) {
      // A column declaration, not a mention: `<name> text` or `<name> boolean`.
      expect(
        new RegExp(`${column} +(text|boolean)`).test(migration),
        `${column} is not a column`,
      ).toBe(true)
    }
    /*
     * And no jsonb at all in this migration — read past the comments, which
     * mention it precisely because the choice was deliberate. The manager's
     * rationale is the only document-shaped field, and it is `text`.
     */
    const statements = migration
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/--[^\n]*/g, ' ')
    expect(statements).not.toMatch(/jsonb/)
  })
})

describe('Phase C1B — case and playbook commands', () => {
  it('keeps the conditional-requirement rules in the domain', () => {
    // Whether a governance gate applies is an institutional rule, not a
    // storage concern and not a UI concern.
    const file = FILES.find((f) => f.path.endsWith('domain/analysis/requirements.ts'))
    expect(file).toBeDefined()
  })

  it('never recomputes a stored requirement resolution on read', () => {
    /*
     * The one thing this model cannot survive. Re-evaluating the rule when the
     * headquarters loads would let historical eligibility drift as the thesis
     * or the rule changes, which is the whole reason resolutions are stored.
     */
    const readers = FILES.filter(
      (f) =>
        !isTest(f) &&
        f.path.includes('/analysis/') &&
        sourceOf(f).includes('evaluateRequirement('),
    ).map((f) => f.path)

    // Produced in exactly one place, and consumed by commands — never by a
    // repository or a projection.
    for (const path of readers) {
      expect(path).not.toMatch(/infrastructure\//)
      expect(path).not.toMatch(/presentation\//)
    }
  })

  it('keeps requirement levels out of the presentation layer', () => {
    /*
     * How much a stage is needed is a workflow rule that belongs to the
     * playbook, and whether a conditional one applies belongs to a recorded
     * evaluation. A component declaring either would be a third source of
     * truth that renders correctly and means nothing.
     */
    const offenders = FILES.filter(
      (f) =>
        f.path.startsWith('presentation/') &&
        /requirement:\s*'(required|optional|conditional)'/.test(sourceOf(f)),
    ).map((f) => f.path)
    expect(offenders).toEqual([])
  })

  it('keeps the macro playbook out of the presentation layer', () => {
    const offenders = FILES.filter(
      (f) =>
        f.path.includes('presentation/') && sourceOf(f).includes('MACRO_REGIME_PLAYBOOK'),
    ).map((f) => f.path)
    expect(offenders).toEqual([])
  })
})
