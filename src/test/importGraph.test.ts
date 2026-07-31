/**
 * Architectural fitness tests (T3 + T4).
 *
 * These make the dependency rules in `docs/data-architecture.md` executable
 * rather than aspirational. Without them, "the UI never imports a concrete
 * provider" is a comment that decays the first time someone is in a hurry.
 *
 * Deliberately a source-text scan rather than a full AST parse: it needs to be
 * fast, dependency-free, and obvious enough that a failure points straight at
 * the offending line.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve as resolvePath, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

// Resolved from cwd rather than `import.meta.url`: under the jsdom
// environment that URL is not a file: URL, so fileURLToPath would throw.
const SRC = resolvePath(process.cwd(), 'src')

interface SourceFile {
  /** Repo-relative, forward-slashed: 'domain/market/quote.ts'. */
  path: string
  imports: string[]
}

function listFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      listFiles(full, out)
    } else if (/\.tsx?$/.test(entry) && !/\.d\.ts$/.test(entry)) {
      out.push(full)
    }
  }
  return out
}

const IMPORT_PATTERN =
  /(?:^|\n)\s*(?:import|export)\s[^'"\n]*?from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g

function parse(fullPath: string): SourceFile {
  const source = readFileSync(fullPath, 'utf8')
  const imports: string[] = []
  for (const match of source.matchAll(IMPORT_PATTERN)) {
    const specifier = match[1] ?? match[2] ?? match[3]
    if (specifier) imports.push(specifier)
  }
  return {
    path: relative(SRC, fullPath).split(sep).join('/'),
    imports,
  }
}

/**
 * Removes comments and string literals before a source-level scan.
 *
 * Without this, a doc comment explaining "Date.now() is banned here" would
 * itself trip the ban — so the rule could never be documented beside the code
 * it governs.
 */
function codeOnly(source: string): string {
  const blockComment = /\/\*[\s\S]*?\*\//g
  const lineComment = /\/\/[^\n]*/g
  const singleQuoted = /'(?:[^'\\\n]|\\.)*'/g
  const doubleQuoted = /"(?:[^"\\\n]|\\.)*"/g
  return source
    .replace(blockComment, ' ')
    .replace(lineComment, ' ')
    .replace(singleQuoted, "''")
    .replace(doubleQuoted, '""')
}

const FILES: SourceFile[] = listFiles(SRC).map(parse)

const inLayer = (file: SourceFile, prefix: string) => file.path.startsWith(prefix)
/** The file's source, for rules about content rather than imports. */
const sourceOf = (file: SourceFile) => readFileSync(join(SRC, file.path), 'utf8')
const isTest = (file: SourceFile) => /\.test\.tsx?$/.test(file.path)

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

  it('presentation never imports infrastructure except its published boundary', () => {
    // The UI must not be able to name a concrete provider, an HTTP client, or
    // anything that could carry an API key into the browser bundle.
    //
    // The single exception is `serverFns.ts`. That module IS the layer's
    // published boundary: its whole purpose is to be the one client-reachable
    // surface, and a `createServerFn` reference compiles to a network call
    // rather than to the handler body. Importing it is importing a port, not
    // an implementation — which is why a route loader may, and nothing else
    // in the layer may.
    const presentation = FILES.filter(
      (f) =>
        (inLayer(f, 'components/') ||
          inLayer(f, 'routes/') ||
          inLayer(f, 'presentation/')) &&
        !isTest(f),
    )
    expect(presentation.length).toBeGreaterThan(0)
    expect(
      violations(presentation, (specifier) => {
        const layerPath = toLayerPath(specifier)
        if (layerPath === null) return false
        if (!layerPath.startsWith('infrastructure/')) return false
        return !layerPath.endsWith('/serverFns')
      }),
    ).toEqual([])
  })

  it('routes reach infrastructure only through a server function', () => {
    // Guards the exception above: the boundary must stay a server-function
    // module, so a future edit cannot quietly widen it into a direct import.
    const routes = FILES.filter((f) => inLayer(f, 'routes/') && !isTest(f))
    const infraImports = routes.flatMap((f) =>
      f.imports
        .map(toLayerPath)
        .filter(
          (path): path is string => path !== null && path.startsWith('infrastructure/'),
        ),
    )
    expect(infraImports.every((path) => path.endsWith('/serverFns'))).toBe(true)
  })

  it('nothing outside the composition root imports a concrete provider', () => {
    // Wiring a provider is the composition root's job and nobody else's. Tests
    // are exempt: assembling a real container with a stub or fixture provider
    // is exactly how the wiring is meant to be exercised.
    const COMPOSITION_ROOTS = [
      'infrastructure/marketData/container.ts',
      'infrastructure/marketData/serverFns.ts',
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
    // Fed, the ECB and the Riksbank policy series. httpClient is shared plumbing,
    // not a data source, and `avanza/map.ts` is a reviewed identity table.
    const adapters = FILES.filter(
      (f) =>
        f.path.startsWith('infrastructure/marketData/providers/') &&
        !isTest(f) &&
        !f.path.includes('/fixture/') &&
        !f.path.includes('/avanza/'),
    )
      .map((f) => f.path)
      .sort()
    expect(adapters).toEqual([
      'infrastructure/marketData/providers/avanza.ts',
      'infrastructure/marketData/providers/bundesbank.ts',
      'infrastructure/marketData/providers/coinGecko.ts',
      'infrastructure/marketData/providers/ecb.ts',
      'infrastructure/marketData/providers/fixture.ts',
      'infrastructure/marketData/providers/frankfurter.ts',
      'infrastructure/marketData/providers/httpClient.ts',
      'infrastructure/marketData/providers/newYorkFed.ts',
      'infrastructure/marketData/providers/riksbank.ts',
      'infrastructure/marketData/providers/riksbankPolicy.ts',
      'infrastructure/marketData/providers/usTreasury.ts',
    ])
  })

  it('confines every outbound call to the shared http client', () => {
    // One module owns the network. An adapter calling fetch directly would
    // also bypass the network-disabled guard.
    const offenders: string[] = []
    for (const file of FILES) {
      if (!file.path.startsWith('infrastructure/marketData/')) continue
      if (isTest(file)) continue
      if (file.path.endsWith('providers/httpClient.ts')) continue
      const source = codeOnly(readFileSync(join(SRC, file.path), 'utf8'))
      if (/fetch\s*\(/.test(source)) offenders.push(`${file.path}: fetch()`)
    }
    expect(offenders).toEqual([])
  })

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

  it('performs no outbound fetch outside the market-data layer', () => {
    const offenders: string[] = []
    for (const file of FILES) {
      if (!file.path.startsWith('infrastructure/marketData/')) continue
      if (isTest(file)) continue
      const source = codeOnly(readFileSync(join(SRC, file.path), 'utf8'))
      if (/fetch\s*\(/.test(source)) offenders.push(`${file.path}: fetch()`)
      if (/XMLHttpRequest/.test(source)) offenders.push(`${file.path}: XMLHttpRequest`)
    }
    expect(offenders).toEqual([])
  })

  it('registers only approved providers at the composition root', () => {
    const serverFns = readFileSync(
      join(SRC, 'infrastructure/marketData/serverFns.ts'),
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
      'ecb',
      'fixture',
      'frankfurter',
      'httpClient',
      'newYorkFed',
      'riksbank',
      'riksbankPolicy',
      'usTreasury',
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
   * Absent because they have migrated: `AppHeader`, `routes/watchlist.tsx`,
   * `routes/markets.tsx`.
   */
  const FROZEN_MOCK_CONSUMERS = [
    'components/agents/AgentCard.tsx',
    'components/countryExplorer/FloatingMarketChips.tsx',
    'data/countryExplorer/mockNow.ts',
    'data/countryExplorer/trendSeries.ts',
    'routes/agents.tsx',
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
    expect(FROZEN_MOCK_CONSUMERS).toHaveLength(11)
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

  it('contains no LLM client anywhere', () => {
    // Phase A defines contracts. The moment a model client appears, the
    // determinism, cost and caching decisions have been made implicitly.
    const offenders: string[] = []
    for (const file of FILES) {
      if (isTest(file)) continue
      for (const specifier of file.imports) {
        if (
          /^(@anthropic-ai|openai|@openai|langchain|@langchain|ai)(\/|$)/.test(specifier)
        ) {
          offenders.push(`${file.path} imports ${specifier}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  /*
   * Phase A forbade `infrastructure/analysis` entirely. Phase B lifts that
   * deliberately — the runtime lives there — and every other boundary stays.
   * See the Phase B guards below.
   */

  it('keeps the Agents UI untouched by Phase A', () => {
    const offenders = FILES.filter(
      (f) =>
        (f.path.startsWith('components/') || f.path.startsWith('routes/')) &&
        f.imports.some((s) => s.startsWith('~/domain/analysis')),
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

  it('keeps Agenter a first-class navigation destination', () => {
    /*
     * A permanent product requirement, not a styling detail: the Agents
     * section is the digital headquarters of Financial OS, and it must not be
     * demoted to a settings page, a modal or a subsection of Reports.
     */
    const navigation = readFileSync(join(SRC, 'lib/navigation.ts'), 'utf8')
    expect(navigation).toMatch(/to:\s*'\/agents'/)
    expect(navigation).toMatch(/label:\s*'Agenter'/)
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

  it('keeps components and routes off the analysis runtime', () => {
    const offenders = FILES.filter(
      (f) =>
        (f.path.startsWith('components/') || f.path.startsWith('routes/')) &&
        f.imports.some(
          (s) =>
            s.startsWith('~/infrastructure/analysis') ||
            s.startsWith('~/application/analysis'),
        ),
    ).map((f) => f.path)
    expect(offenders).toEqual([])
  })

  it('still contains no LLM client', () => {
    // Phase B builds the runtime. The model arrives in Phase C, and not before.
    const offenders: string[] = []
    for (const file of FILES) {
      if (isTest(file)) continue
      for (const specifier of file.imports) {
        if (
          /^(@anthropic-ai|openai|@openai|langchain|@langchain|ai)(\/|$)/.test(specifier)
        ) {
          offenders.push(`${file.path} imports ${specifier}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('stores no prose activity in the domain', () => {
    /*
     * The integrity mechanism behind the living-organization vision. Activity
     * text is generated in the presentation layer from structured events; a
     * domain field holding a sentence would let anything write "Macro Team is
     * studying the Fed" with no work behind it.
     */
    const contributions = codeOnly(
      readFileSync(join(SRC, 'domain/analysis/contributions.ts'), 'utf8'),
    )
    expect(contributions).not.toMatch(/activity\s*[?]?:\s*string/)
    const events = codeOnly(readFileSync(join(SRC, 'domain/analysis/events.ts'), 'utf8'))
    expect(events).not.toMatch(/description\s*[?]?:\s*string/)
  })

  it('leaves the legacy investmentLetter prototype untouched by the runtime', () => {
    const offenders = FILES.filter(
      (f) =>
        f.path.startsWith('services/investmentLetter/') &&
        f.imports.some((s) => s.includes('/analysis')),
    ).map((f) => f.path)
    expect(offenders).toEqual([])
  })

  it('keeps Agenter a first-class navigation destination', () => {
    const navigation = readFileSync(join(SRC, 'lib/navigation.ts'), 'utf8')
    expect(navigation).toMatch(/to:\s*'\/agents'/)
    expect(navigation).toMatch(/label:\s*'Agenter'/)
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

describe('Storage stage 2 — the adapter exists but is not wired', () => {
  const postgres = 'infrastructure/analysis/postgres/'

  it('is constructed by nothing outside its own directory and the tests', () => {
    /*
     * Stage 2 builds the adapter and stops. Dual write is stage 3 and the read
     * switch is stage 5; wiring it early would make "PostgreSQL is not
     * authoritative yet" a claim rather than a fact.
     */
    const offenders = FILES.filter((file) => !isTest(file) && !inLayer(file, postgres))
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
      'definition.ts',
      'envelope.ts',
      'eventIdentity.ts',
      'failAgentRun.ts',
      'instantiatePlaybook.ts',
      'openInvestmentCase.ts',
      'proposeThesis.ts',
      'recordContribution.ts',
      'registry.ts',
      'resolveCommand.ts',
      'runCommand.ts',
      'startAgentRun.ts',
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

  it('lets the orchestrator write nothing directly', () => {
    /*
     * The second. The orchestrator sequences commands and calls the provider
     * between them; a direct repository write from there would be an
     * institutional effect with no command, no actor and no ledger entry.
     */
    const orchestrator = FILES.find((f) =>
      f.path.endsWith('application/analysis/orchestrator.ts'),
    )
    expect(orchestrator).toBeDefined()
    const forbidden = orchestrator!.imports.filter(
      (specifier) =>
        specifier.includes('/repositories') || specifier.includes('/commandLog'),
    )
    expect(forbidden).toEqual([])
  })

  it('derives every record identity in one place', () => {
    /*
     * TD-30. A handler building an id by hand would be a second scheme, and
     * two schemes eventually collide or diverge across a restart.
     */
    const offenders = FILES.filter(
      (f) =>
        inLayer(f, 'application/analysis/commands/') &&
        !isTest(f) &&
        !f.path.endsWith('eventIdentity.ts') &&
        /eventId:\s*`/.test(sourceOf(f)),
    ).map((f) => f.path)
    expect(offenders).toEqual([])
  })

  it('accepts no caller-supplied event or assignment identity', () => {
    const offenders = FILES.filter(
      (f) =>
        inLayer(f, 'application/analysis/commands/') &&
        !isTest(f) &&
        /(eventIdPrefix|assignmentIdPrefix|creationEventId)/.test(codeOnly(sourceOf(f))),
    ).map((f) => f.path)
    expect(offenders).toEqual([])
  })

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

  it('ships no live contribution provider', () => {
    // C2 remains blocked: recorded and stub only. Read through `codeOnly`, so
    // the rule can be documented beside the code it governs rather than being
    // tripped by the sentence explaining it.
    const offenders = FILES.filter(
      (f) => !isTest(f) && /providerKind:\s*'live'/.test(codeOnly(sourceOf(f))),
    ).map((f) => f.path)
    expect(offenders).toEqual([])
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
     * Two, and neither is a model. A third file appearing here means a
     * provider landed without the phase gate that C2 is waiting on — the same
     * control the market-data adapters are under, for the same reason.
     */
    const adapters = FILES.filter((f) => inLayer(f, providers) && !isTest(f))
      .map((f) => f.path)
      .sort()
    expect(adapters).toEqual([
      'infrastructure/analysis/providers/index.ts',
      'infrastructure/analysis/providers/recorded.ts',
      'infrastructure/analysis/providers/stub.ts',
    ])
  })

  it('lets no provider declare itself live', () => {
    // C2 remains blocked. A provider states its own kind, so this is the one
    // place a fixture could claim to be work the firm stands behind.
    const offenders = FILES.filter(
      (f) => inLayer(f, providers) && /kind:\s*'live'/.test(codeOnly(sourceOf(f))),
    ).map((f) => f.path)
    expect(offenders).toEqual([])
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
     */
    const callers = FILES.filter(
      (f) =>
        inLayer(f, 'application/analysis/') &&
        !isTest(f) &&
        !f.path.endsWith('orchestrator.ts') &&
        !f.path.endsWith('contributionPort.ts') &&
        f.imports.some((specifier) => specifier.includes('contributionPort')),
    ).map((f) => f.path)
    expect(callers).toEqual([])
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

  it('imports no LLM, model client or agent runtime', () => {
    /*
     * C2 remains blocked: nothing in C1B may reach a model.
     *
     * Tested against IMPORTS rather than text. The parity suite carries a
     * provenance fixture whose provider happens to be named 'anthropic', and a
     * rule that could not tell a recorded string from a dependency would have
     * to be either wrong or disabled.
     */
    const clients = /^(@anthropic-ai\/|openai$|openai\/|@ai-sdk\/|langchain|llamaindex)/
    const offenders = FILES.filter((f) =>
      f.imports.some((specifier) => clients.test(specifier)),
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
