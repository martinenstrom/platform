/**
 * The load-bearing architectural rules, as objects rather than as assertions.
 *
 * A rule written inline inside an `it()` block can only ever be checked against
 * a codebase that already complies, so the only outcome it can produce is
 * "passed" — whether it works or not. Eleven of them did not work: a literal
 * backspace byte sat where `\b` was meant, and every one of those rules had
 * been silently matching nothing since the day it was written.
 *
 * Reifying a rule makes the other half testable. `detect` is a function, so it
 * can be pointed at a file that deliberately breaks the rule and required to
 * fail — and at a file that deliberately comes close without breaking it and
 * required not to. `src/test/fitness/ruleIntegrity.test.ts` does exactly that
 * for every entry below, and a rule added here without both fixtures fails the
 * meta-test rather than joining the suite unexercised.
 */

import ts from 'typescript'
import type { AnalysedSource } from './sources'

export interface FitnessRule {
  /** Stable identifier; the fixtures reference it. */
  id: string
  /** The property, stated the way the institution would state it. */
  states: string
  /** What goes wrong, silently, if it stops holding. */
  because: string
  /**
   * The files this rule judges.
   *
   * Checked against the real tree: a rule that selects nothing is a rule whose
   * subject has been renamed or deleted, which is indistinguishable from a rule
   * that works until something violates it.
   */
  selects(file: AnalysedSource): boolean
  /** What is wrong in one selected file. Empty means the file complies. */
  detect(file: AnalysedSource): string[]
}

/* ------------------------------------------------------------------ helpers */

/** Every node in the file, depth first. */
function* nodes(file: AnalysedSource): Generator<ts.Node> {
  const stack: ts.Node[] = [file.ast]
  while (stack.length > 0) {
    const node = stack.pop()!
    yield node
    ts.forEachChild(node, (child) => {
      stack.push(child)
    })
  }
}

/** 1-based line of a node, for a failure message that points somewhere. */
function lineOf(file: AnalysedSource, node: ts.Node): number {
  return file.ast.getLineAndCharacterOfPosition(node.getStart(file.ast)).line + 1
}

const at = (file: AnalysedSource, node: ts.Node, what: string) =>
  `${file.path}:${lineOf(file, node)} — ${what}`

/** The text of a property/member name, whatever syntax declared it. */
function nameOf(name: ts.PropertyName | ts.BindingName | undefined): string | null {
  if (!name) return null
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text
  return null
}

/** `a.b.c` → 'a.b.c'; anything else → null. */
function accessPath(node: ts.Expression): string | null {
  if (ts.isIdentifier(node)) return node.text
  if (ts.isPropertyAccessExpression(node)) {
    const left = accessPath(node.expression)
    return left === null ? null : `${left}.${node.name.text}`
  }
  return null
}

const under =
  (...prefixes: string[]) =>
  (file: AnalysedSource) =>
    prefixes.some((prefix) => file.path.startsWith(prefix))

/* ------------------------------------------------------------------- rule 1 */

/**
 * The one module allowed to open a socket.
 *
 * Everything else reaches the network through it, which is what makes the
 * network-disabled test guard, the timeout, the provenance stamp and the
 * credential handling apply to every outbound call rather than to most of them.
 */
const HTTP_CLIENT = 'infrastructure/marketData/providers/httpClient.ts'

/**
 * Same-origin static assets, frozen.
 *
 * Both load `/data/countries-110m.json`, a topology file served from our own
 * origin — no provider, no credential, no market data. The list may shrink; it
 * must never grow, and the rule below checks that the URL each one uses is
 * still a same-origin path rather than an absolute URL that was edited in
 * later.
 */
const FROZEN_STATIC_ASSET_FETCHES: Record<string, string> = {
  'components/countryExplorer/CapitalFlowsCard.tsx': 'WORLD_ATLAS_URL',
  'components/countryExplorer/GlobalCommandMap.tsx': 'WORLD_ATLAS_URL',
}

const HTTP_PACKAGES =
  /^(axios|node-fetch|undici|got|superagent|request|ky|phin|needle|node:https?)$/

const noOutboundNetwork: FitnessRule = {
  id: 'no-outbound-network-outside-http-client',
  states: 'Only the shared http client performs an outbound network call.',
  because:
    'A direct call bypasses the network-disabled guard, the timeout and the ' +
    'provenance stamp, so a request nobody can see becomes a source nobody ' +
    'can trace.',
  selects: (file) => !file.isTest && file.path !== HTTP_CLIENT,
  detect(file) {
    const allowedVia = FROZEN_STATIC_ASSET_FETCHES[file.path]
    const found: string[] = []

    for (const reference of file.imports) {
      if (HTTP_PACKAGES.test(reference.specifier) && !reference.typeOnly) {
        found.push(`${file.path} — imports the http package '${reference.specifier}'`)
      }
    }

    for (const node of nodes(file)) {
      if (ts.isNewExpression(node)) {
        const constructed = accessPath(node.expression)
        if (
          constructed &&
          /(^|\.)(XMLHttpRequest|WebSocket|EventSource)$/.test(constructed)
        ) {
          found.push(at(file, node, `constructs ${constructed}`))
        }
        continue
      }

      if (ts.isCallExpression(node)) {
        const called = accessPath(node.expression)
        if (called === 'navigator.sendBeacon') {
          found.push(at(file, node, 'calls navigator.sendBeacon'))
          continue
        }
        if (called !== null && /(^|\.)fetch$/.test(called)) {
          const argument = node.arguments[0]
          const permitted =
            allowedVia !== undefined &&
            argument !== undefined &&
            ts.isIdentifier(argument) &&
            argument.text === allowedVia
          if (!permitted) found.push(at(file, node, `calls ${called}()`))
        }
        continue
      }

      /*
       * A frozen fetch is allowed to load a path on our own origin and nothing
       * else. Checking the constant rather than the call is deliberate: the
       * call site is the part nobody edits, and the URL is the part somebody
       * eventually points at a provider.
       */
      if (
        allowedVia !== undefined &&
        ts.isVariableDeclaration(node) &&
        nameOf(node.name) === allowedVia
      ) {
        const initialiser = node.initializer
        const literal =
          initialiser && ts.isStringLiteral(initialiser) ? initialiser.text : null
        if (literal === null || !literal.startsWith('/') || literal.startsWith('//')) {
          found.push(at(file, node, `${allowedVia} is no longer a same-origin path`))
        }
      }
    }

    return found
  },
}

/* ------------------------------------------------------------------- rule 2 */

/**
 * Field names that would hold a sentence describing what a desk is doing.
 *
 * Not every string is prose: a thesis `statement`, a rejection `reason` and an
 * invalidation criterion are all things a person wrote and the firm stands
 * behind. These are the names under which generated narration arrives —
 * "Macro Team is studying the Fed" — with no work behind it.
 */
const PROSE_FIELD_NAMES =
  /^(activity|activityText|activityLabel|activityDescription|description|narrative|commentary|story|prose|blurb|statusText|displayText|renderedText|humanReadable|headline)$/

const noProseActivityInDomain: FitnessRule = {
  id: 'no-prose-activity-in-domain',
  states: 'No domain record carries generated activity prose.',
  because:
    'Headquarters activity is projected from structured events. A domain field ' +
    'holding a sentence lets anything narrate work that never happened, and the ' +
    'record stops being evidence.',
  selects: (file) => !file.isTest && file.path.startsWith('domain/analysis/'),
  detect(file) {
    const found: string[] = []
    for (const node of nodes(file)) {
      if (!ts.isPropertySignature(node) && !ts.isPropertyDeclaration(node)) continue
      const name = nameOf(node.name)
      if (name === null || !PROSE_FIELD_NAMES.test(name)) continue
      const declared = node.type
      if (!declared) continue
      // `string`, `string | null`, `string[]`, `readonly string[]` — any shape
      // whose leaves are strings is a place a sentence can live.
      if (/\bstring\b/.test(declared.getText(file.ast))) {
        found.push(at(file, node, `${name}: ${declared.getText(file.ast)}`))
      }
    }
    return found
  },
}

/* ------------------------------------------------------------------- rule 3 */

const WRITE_METHODS = /^(save|append|insert|update|delete|remove|put|store|write)$/

const orchestratorWritesNothing: FitnessRule = {
  id: 'orchestrator-writes-nothing-directly',
  states:
    'The orchestrator sequences commands and never writes to a repository ' +
    'or the ledger itself.',
  because:
    'It runs outside any transaction, between commands, so a write from there ' +
    'is an institutional effect with no command, no actor and no ledger entry — ' +
    'and no way to reject it.',
  selects: (file) => file.path === 'application/analysis/orchestrator.ts',
  detect(file) {
    const found: string[] = []

    for (const reference of file.imports) {
      if (reference.typeOnly) continue
      if (
        /(repositories|repository|commandLog|inMemory|\/postgres\/)/i.test(
          reference.specifier,
        )
      ) {
        found.push(`${file.path} — imports ${reference.specifier}`)
      }
    }

    for (const node of nodes(file)) {
      if (!ts.isCallExpression(node)) continue
      const called = accessPath(node.expression)
      if (called === 'withTransaction' || called?.endsWith('.withTransaction')) {
        found.push(at(file, node, 'opens a transaction'))
        continue
      }
      if (!ts.isPropertyAccessExpression(node.expression)) continue
      if (!WRITE_METHODS.test(node.expression.name.text)) continue
      const receiver = accessPath(node.expression.expression)
      if (
        receiver !== null &&
        /^(repositories|repos|store|log|ledger)\b/.test(receiver)
      ) {
        found.push(at(file, node, `writes directly: ${called}()`))
      }
    }

    return found
  },
}

/* ------------------------------------------------------------------- rule 4 */

/**
 * Model clients, as packages.
 *
 * Matched against parsed import specifiers rather than against source text:
 * the parity fixtures carry a recorded provenance whose provider is the string
 * 'anthropic', and a rule that could not tell a recorded value from a
 * dependency would have to be either wrong or switched off.
 */
const LLM_PACKAGES =
  /^(@anthropic-ai\/|anthropic$|openai$|openai\/|@openai\/|@ai-sdk\/|^ai$|langchain|@langchain\/|llamaindex|@google\/generative-ai|@mistralai\/|cohere-ai|replicate$|ollama$)/

const noLlmDependency: FitnessRule = {
  id: 'no-llm-dependency',
  states: 'Nothing in the codebase imports a model client.',
  because:
    'C2 is the gate where determinism, cost, caching and provenance for real ' +
    'model execution get decided. A client appearing before it decides them by ' +
    'default and by accident.',
  // Tests included: a test importing an SDK means the dependency is installed
  // and the decision has already been made somewhere.
  selects: () => true,
  detect: (file) =>
    file.imports
      .filter((reference) => LLM_PACKAGES.test(reference.specifier))
      .map((reference) => `${file.path} — imports ${reference.specifier}`),
}

/* ------------------------------------------------------------------- rule 5 */

const noUiImportOfInfrastructure: FitnessRule = {
  id: 'no-ui-import-of-infrastructure',
  states:
    'The presentation layer names no infrastructure module except a published ' +
    'server-function boundary.',
  because:
    'An import is a bundle edge. Naming a provider, a database adapter or the ' +
    'analysis runtime from a component is how a credential, a driver or a ' +
    'migration reaches the browser.',
  selects: (file) =>
    !file.isTest && under('components/', 'routes/', 'presentation/')(file),
  detect(file) {
    const found: string[] = []
    for (const reference of file.imports) {
      const specifier = reference.specifier
      if (!specifier.startsWith('~/infrastructure')) {
        // The analysis runtime has no server-function boundary at all yet, so
        // the application layer is off limits from the UI outright.
        if (specifier.startsWith('~/application/analysis')) {
          found.push(`${file.path} — imports ${specifier}`)
        }
        continue
      }
      /*
       * `serverFns` IS the published boundary: a `createServerFn` reference
       * compiles to a network call rather than to the handler body, so
       * importing it is importing a port. Everything else in the layer is an
       * implementation.
       */
      if (specifier.endsWith('/serverFns')) continue
      found.push(`${file.path} — imports ${specifier}`)
    }
    return found
  },
}

/* ------------------------------------------------------------------- rule 6 */

/** Identities the firm mints. Every one derives from the command that caused it. */
const MINTED_IDENTITY_FIELDS =
  /^(id|eventId|revisionId|assignmentId|runId|claimId|aggregationId|resolutionId|reviewId|challengeId)$/

/** Identity fields a caller may not hand in, whatever the value. */
const CALLER_SUPPLIED_IDENTITY_FIELDS =
  /^(eventId|eventIdPrefix|creationEventId|assignmentIdPrefix|newRevisionId|producedRevisionId|aggregationId|reviewId|challengeId)$/

const noCallerSuppliedIdentity: FitnessRule = {
  id: 'no-caller-supplied-or-invented-identity',
  states:
    'Command handlers derive every minted identity from the command, and no ' +
    'command input offers a caller a field to supply one.',
  because:
    'A second identity scheme collides or diverges across a restart, and a ' +
    'caller-supplied id lets a replay be aimed at a record it did not create.',
  selects: (file) =>
    !file.isTest &&
    file.path.startsWith('application/analysis/commands/') &&
    !file.path.endsWith('eventIdentity.ts'),
  detect(file) {
    const found: string[] = []

    for (const node of nodes(file)) {
      // (a) an identity assembled here rather than derived
      if (ts.isPropertyAssignment(node)) {
        const name = nameOf(node.name)
        if (name === null || !MINTED_IDENTITY_FIELDS.test(name)) continue
        const value = node.initializer
        if (ts.isTemplateExpression(value) || ts.isNoSubstitutionTemplateLiteral(value)) {
          found.push(at(file, node, `${name} is built from a template literal`))
        } else if (
          ts.isBinaryExpression(value) &&
          value.operatorToken.kind === ts.SyntaxKind.PlusToken
        ) {
          found.push(at(file, node, `${name} is built by concatenation`))
        } else if (ts.isCallExpression(value)) {
          const called = accessPath(value.expression) ?? ''
          if (/randomUUID|Math\.random|Date\.now|uuid|nanoid/.test(called)) {
            found.push(at(file, node, `${name} comes from ${called}()`))
          }
        }
        continue
      }

      // (b) an input shape that lets a caller state one
      if (ts.isInterfaceDeclaration(node) && /Input$/.test(node.name.text)) {
        for (const member of node.members) {
          const name = nameOf(member.name)
          if (name !== null && CALLER_SUPPLIED_IDENTITY_FIELDS.test(name)) {
            found.push(at(file, member, `${node.name.text}.${name} is caller-supplied`))
          }
        }
      }
    }

    return found
  },
}

/* --------------------------------------------------------------- the registry */

/**
 * Ordered as the reviewer named them. Adding an entry here without a planted
 * violation and a benign near-miss in `planted.ts` fails the meta-test.
 */
export const LOAD_BEARING_RULES: readonly FitnessRule[] = [
  noOutboundNetwork,
  noProseActivityInDomain,
  orchestratorWritesNothing,
  noLlmDependency,
  noUiImportOfInfrastructure,
  noCallerSuppliedIdentity,
]

export function ruleById(id: string): FitnessRule {
  const found = LOAD_BEARING_RULES.find((rule) => rule.id === id)
  if (!found) throw new Error(`No fitness rule with id "${id}"`)
  return found
}
