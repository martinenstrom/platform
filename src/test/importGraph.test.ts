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

const FILES: SourceFile[] = listFiles(SRC).map(parse)

const inLayer = (file: SourceFile, prefix: string) => file.path.startsWith(prefix)
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
      const source = readFileSync(join(SRC, file.path), 'utf8')
      if (/\bprocess\.env\b/.test(source)) offenders.push(`${file.path}: process.env`)
      if (/\bfetch\s*\(/.test(source)) offenders.push(`${file.path}: fetch()`)
      // Only the Clock abstraction may read the wall clock.
      if (
        !file.path.startsWith('domain/shared/clock') &&
        /\bDate\.now\s*\(/.test(source)
      ) {
        offenders.push(`${file.path}: Date.now()`)
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

  it('presentation never imports infrastructure', () => {
    // The UI must not be able to name a concrete provider, a HTTP client, or
    // anything that could carry an API key into the browser bundle.
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
        return layerPath !== null && layerPath.startsWith('infrastructure/')
      }),
    ).toEqual([])
  })

  it('nothing outside an adapter imports a concrete provider module', () => {
    const outsideProviders = FILES.filter(
      (f) => !f.path.startsWith('infrastructure/marketData/providers/'),
    )
    expect(
      violations(outsideProviders, (specifier) => {
        const layerPath = toLayerPath(specifier)
        if (layerPath === null) return false
        // The composition root is the single sanctioned exception; it exists
        // precisely to be the one place providers are named.
        return (
          layerPath.startsWith('infrastructure/marketData/providers/') &&
          !specifier.endsWith('/providers')
        )
      }).filter((v) => !v.startsWith('infrastructure/marketData/container.ts')),
    ).toEqual([])
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
