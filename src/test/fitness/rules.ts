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
/** The live-voice provider: an SDP exchange and a sideband socket, the one other network boundary. */
const LIVE_VOICE_PROVIDER = 'infrastructure/jarvis/openaiLive.ts'

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
  states: 'Only the shared http client and the live-voice provider perform an outbound network call.',
  because:
    'A direct call bypasses the network-disabled guard, the timeout and the ' +
    'provenance stamp, so a request nobody can see becomes a source nobody ' +
    'can trace. The live-voice provider is the one other boundary: a WebRTC ' +
    'SDP exchange and a sideband WebSocket, which no http client models. It ' +
    'honours the same network-disabled guard and a timeout of its own, and ' +
    'it ingests nothing into the record, so there is nothing to stamp.',
  selects: (file) => !file.isTest && file.path !== HTTP_CLIENT && file.path !== LIVE_VOICE_PROVIDER,
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

/**
 * The one directory a model client may live in.
 *
 * The live provider and its transport, and nothing else. Trailing slash so a
 * sibling directory with a longer name cannot satisfy the prefix.
 */
const PROVIDER_DIRECTORY = 'infrastructure/analysis/providers/'

/**
 * NARROWED at the C2 gate, not removed.
 *
 * The original rule said "nothing imports a model client", and its reason was
 * that C2 is where determinism, cost, caching and provenance get decided — so
 * a client appearing beforehand would decide them by accident. C2 has now
 * decided all four, and the client exists.
 *
 * What must not be lost is the property the rule was really protecting: **an
 * LLM cannot leak into the domain, the application layer, or a component.**
 * Deleting the rule would drop that on the day it starts to matter, which is
 * the day a client is actually in the tree.
 *
 * There is no SDK, so there is no package to leak — which makes this easier to
 * hold rather than harder. The rule therefore catches both the package form
 * and the module form: importing an SDK anywhere, and importing the provider's
 * own client from outside the provider directory.
 */
const llmClientConfinedToProvider: FitnessRule = {
  id: 'llm-client-confined-to-provider',
  states:
    'A model client is reachable only through the contribution provider — ' +
    'never from domain, application or presentation.',
  because:
    'C2 decided determinism, cost, caching and provenance, so a client may ' +
    'now exist. It may not spread: a model reachable from the domain or a ' +
    'component would put non-deterministic, billable work behind code the ' +
    'firm treats as pure, and the seam that makes a recorded run and a live ' +
    'run interchangeable is the provider port.',
  // Tests included. A test importing an SDK means the dependency is installed,
  // and an installed SDK is reachable from everywhere.
  selects: () => true,
  detect: (file) => {
    const offences: string[] = []
    const insideProvider = file.path.startsWith(PROVIDER_DIRECTORY)

    for (const reference of file.imports) {
      // An SDK package is refused everywhere, including inside the provider:
      // the client decision ruled no SDK, and nothing is exempt from it.
      if (LLM_PACKAGES.test(reference.specifier)) {
        offences.push(`${file.path} — imports ${reference.specifier}`)
        continue
      }
      // The hand-rolled client is confined rather than banned.
      if (!insideProvider && reference.specifier.includes('providers/modelClient')) {
        offences.push(`${file.path} — imports the model client from outside the provider`)
      }
    }
    return offences
  },
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
        /*
         * The application layer is reachable for TYPES only. `import type` is
         * erased at compile time: it is not a bundle edge and nothing can be
         * called through it, which is the entire hazard this rule names.
         *
         * A value import stays forbidden — that is how assembly logic, and a
         * second answer to "is this eligible", would arrive in a component.
         */
        if (specifier.startsWith('~/application/analysis') && !reference.typeOnly) {
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

/* ------------------------------------------------------------- rules 7 & 8 */

/**
 * The one function that answers "may this revision reach the CIO".
 *
 * Plus the two beneath it: a handler that called `evaluateGate` or
 * `evaluateThesisEligibility` directly would be assembling the answer from
 * parts, which is the same failure wearing a different name.
 */
const ELIGIBILITY_DECIDERS =
  /^(evaluateRevisionEligibility|evaluateThesisEligibility|evaluateGate|evaluateRevisionGates)$/

/** The one module allowed to call them from outside the domain. */
const ELIGIBILITY_ADAPTER = 'application/analysis/eligibility.ts'

const eligibilityDecidedInTheDomain: FitnessRule = {
  id: 'eligibility-decided-only-in-the-domain',
  states:
    'No command handler decides eligibility; the adapter maps state and the ' +
    'domain decides.',
  because:
    'A handler that reimplements a blocking rule is a second answer to the one ' +
    'question the CIO acts on, and it reads as correct because the domain ' +
    'function is still being called somewhere.',
  selects: (file) =>
    !file.isTest &&
    file.path.startsWith('application/analysis/') &&
    file.path !== ELIGIBILITY_ADAPTER,
  detect(file) {
    const found: string[] = []
    for (const reference of file.imports) {
      for (const name of reference.names) {
        if (ELIGIBILITY_DECIDERS.test(name)) {
          found.push(`${file.path} — imports ${name}`)
        }
      }
    }
    for (const node of nodes(file)) {
      if (!ts.isCallExpression(node)) continue
      const called = accessPath(node.expression)
      if (called && ELIGIBILITY_DECIDERS.test(called.split('.').pop()!)) {
        found.push(at(file, node, `calls ${called}()`))
      }
    }
    return found
  },
}

/**
 * Names that would mean a threshold has been reimplemented somewhere.
 *
 * Deliberately about the ANSWER rather than the inputs: a module may read a
 * verdict status, and may not decide what it means for eligibility.
 */
const ELIGIBILITY_VERDICT_FIELDS = /^(eligibleForDecision|eligibleForPublication)$/

const noSecondEligibilityAnswer: FitnessRule = {
  id: 'no-second-eligibility-answer',
  states:
    'Nothing outside the domain assigns an eligibility verdict; it is read, ' +
    'never computed.',
  because:
    'A boolean assembled in a projection or a handler outranks the domain ' +
    'wherever it is read, and disagreeing answers to "may this reach the CIO" ' +
    'is the one thing this model cannot survive.',
  selects: (file) => !file.isTest && !file.path.startsWith('domain/'),
  detect(file) {
    const found: string[] = []
    for (const node of nodes(file)) {
      if (!ts.isPropertyAssignment(node)) continue
      const name = nameOf(node.name)
      if (name === null || !ELIGIBILITY_VERDICT_FIELDS.test(name)) continue
      const value = node.initializer
      /*
       * A pass-through is fine — that is how the domain's answer travels. A
       * literal, a comparison or a boolean expression is a decision.
       */
      if (
        value.kind === ts.SyntaxKind.TrueKeyword ||
        value.kind === ts.SyntaxKind.FalseKeyword ||
        ts.isBinaryExpression(value) ||
        ts.isPrefixUnaryExpression(value) ||
        ts.isConditionalExpression(value)
      ) {
        found.push(at(file, node, `${name} is decided here`))
      }
    }
    return found
  },
}

/* ------------------------------------------------------------------ rule 9 */

/**
 * The two places the word may legitimately appear in SQL: as storage.
 *
 * `eligibility_policies` is the registry the domain reads its own rules from,
 * and `eligibility_policy_version` records which of those rules the domain
 * applied. Both are the RESULT of a decision the domain already made, written
 * down — the opposite of the query that makes one. Everything else still fires,
 * including a computed `AS eligible` and any other invented eligibility column,
 * because the exemption is anchored to these two names and nothing broader.
 */
const ELIGIBILITY_STORAGE_NAMES = /\beligibility_polic(?:ies|y_version)\b/gi

const withoutStorageNames = (text: string) => text.replace(ELIGIBILITY_STORAGE_NAMES, '')

const noEligibilityInSql: FitnessRule = {
  id: 'no-eligibility-in-sql',
  states: 'No SQL statement decides whether a revision may reach the CIO.',
  because:
    'A CASE over verdict statuses in a query is a governance rule with no test, ' +
    'no version and no reviewer — and it silently outranks the domain for every ' +
    'reader of that query.',
  selects: (file) =>
    !file.isTest && file.path.startsWith('infrastructure/analysis/postgres/'),
  detect(file) {
    const found: string[] = []
    for (const node of nodes(file)) {
      if (!ts.isStringLiteralLike(node) && !ts.isTemplateLiteral(node)) continue
      const text = node.getText(file.ast)
      if (!/\b(SELECT|UPDATE|INSERT)\b/i.test(text)) continue
      if (/\beligib/i.test(withoutStorageNames(text))) {
        found.push(at(file, node, 'SQL mentions eligibility'))
      }
      // A verdict compared inside SQL is a gate the domain cannot see.
      if (/\bstatus\s*(=|<>|!=|IN)\s*\(?'(verified|accepted|approved)/i.test(text)) {
        found.push(at(file, node, 'SQL compares a governance verdict'))
      }
    }
    return found
  },
}

/* ----------------------------------------------------------------- rule 10 */

/**
 * The one PostgreSQL test allowed to name the memory adapter, and why.
 *
 * `adapter.pg.test.ts` constructs it to read its `provenance()` and assert that
 * the two stores describe themselves differently — the memory adapter is the
 * SUBJECT of that assertion, not a source of state. Frozen: the list may
 * shrink, and a second entry means a durability test found somewhere to fall
 * back to.
 */
const MEMORY_ADAPTER_COMPARISONS = ['infrastructure/analysis/postgres/adapter.pg.test.ts']

const noMemoryInDurableTests: FitnessRule = {
  id: 'no-in-memory-adapter-in-durable-tests',
  states: 'No PostgreSQL-backed test reads institutional state from memory.',
  because:
    'A durability test that can fall back to memory proves that memory works. ' +
    'The whole value of the restart suite is that the second runtime had ' +
    'nowhere else to read from.',
  selects: (file) =>
    /\.pg\.test\.tsx?$/.test(file.path) &&
    !MEMORY_ADAPTER_COMPARISONS.includes(file.path),
  detect: (file) => {
    const found: string[] = []
    for (const reference of file.imports) {
      if (
        reference.specifier.includes('inMemoryRepositories') ||
        reference.names.includes('createInMemoryRepositories')
      ) {
        found.push(`${file.path} — imports ${reference.specifier}`)
      }
    }
    /*
     * The dynamic form too. `await import('../inMemoryRepositories')` inside a
     * test body is exactly how a fallback gets added without touching the
     * import block anybody reviews.
     */
    for (const node of nodes(file)) {
      if (!ts.isCallExpression(node)) continue
      if (node.expression.kind !== ts.SyntaxKind.ImportKeyword) continue
      const argument = node.arguments[0]
      if (
        argument &&
        ts.isStringLiteralLike(argument) &&
        argument.text.includes('inMemoryRepositories')
      ) {
        found.push(at(file, node, 'dynamically imports the memory adapter'))
      }
    }
    return found
  },
}

/* ----------------------------------------------------------------- rule 11 */

/**
 * Characters a migration must not contain.
 *
 * Two classes, and the second is the one that cost a debugging session.
 *
 * **Control characters** are the defect the whole fitness harness exists
 * because of: invisible in an editor, invisible in review, invisible in a diff.
 * In SQL a stray one lands inside a string literal or an identifier and is
 * silently part of the value.
 *
 * **Characters the client encoding cannot represent.** The embedded PostgreSQL
 * harness connects in WIN1252, and a character with no equivalent there fails
 * the migration with `22P05` — at apply time, on a machine that is not the one
 * that wrote it. An arrow in a comment did exactly that. The rule is not
 * "no arrows": it is the whole set outside the encoding, because the next one
 * will be a different character.
 *
 * Scoped to migrations. Application source is UTF-8 end to end and says so.
 */
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/

/**
 * Everything WIN1252 can represent, as ranges.
 *
 * Latin-1 minus the C1 control block, plus the 27 characters WIN1252 puts in
 * 0x80–0x9F — the curly quotes, the dashes and the ellipsis this codebase's
 * prose actually uses.
 */
const WIN1252_EXTRAS = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039,
  0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122,
  0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
])

const encodableInWin1252 = (code: number) =>
  code <= 0x7f || (code >= 0xa0 && code <= 0xff) || WIN1252_EXTRAS.has(code)

const migrationCharacters: FitnessRule = {
  id: 'no-unrepresentable-characters-in-migrations',
  states:
    'A migration contains no control character and nothing the client encoding ' +
    'cannot represent.',
  because:
    'A control character is invisible in an editor, a review and a diff, and in ' +
    'SQL it becomes part of a literal. An unencodable one fails the migration at ' +
    'apply time on a machine other than the one that wrote it.',
  /*
   * Migrations are read from `db/`, not `src/`, so the rule receives them as
   * synthetic sources — see `loadMigrationSources` in `fitness.test.ts`.
   */
  selects: (file) => file.path.startsWith('db/migrations/'),
  detect(file) {
    const found: string[] = []
    file.text.split('\n').forEach((line, index) => {
      for (const character of line) {
        const code = character.codePointAt(0)!
        if (CONTROL_CHARACTERS.test(character)) {
          found.push(
            `${file.path}:${index + 1} — control character U+${code
              .toString(16)
              .toUpperCase()
              .padStart(4, '0')}`,
          )
          return
        }
        if (!encodableInWin1252(code)) {
          found.push(
            `${file.path}:${index + 1} — "${character}" (U+${code
              .toString(16)
              .toUpperCase()
              .padStart(4, '0')}) cannot be encoded by the client`,
          )
          return
        }
      }
    })
    return found
  },
}

/* ----------------------------------------------------------------- rule 12 */

/**
 * The decision shape migration 0020 replaced.
 *
 * `DecisionRow` described `governance`, `unresolved_dissent` and
 * `reconsideration_triggers` for a whole phase after the columns were dropped,
 * and a case-keyed primary key after the key had moved. It compiled the entire
 * time — TypeScript does not object to an unused exported type — so the only
 * thing standing between it and a mapper written against it was that nobody
 * happened to import it.
 *
 * ## Why word boundaries, and why the AST
 *
 * The current schema contains the dropped names as substrings.
 * `decision_reconsideration_triggers` is a live table; `reconsideration_triggers`
 * is a dropped column. `decision_dissent` is live; `unresolved_dissent` is
 * dropped. A substring search flags both live tables, and the natural response
 * to a rule that cries wolf is to weaken it until it says nothing.
 */
const DROPPED_DECISION_COLUMNS = new Set([
  'governance',
  'unresolved_dissent',
  'reconsideration_triggers',
])

/** `\b` does not match after `_`, so this leaves the live tables alone. */
const DROPPED_IN_SQL =
  /\b(?:decision_revisions|unresolved_dissent|reconsideration_triggers)\b/

const noPre0020DecisionShape: FitnessRule = {
  id: 'no-pre-0020-decision-shape',
  states: 'Nothing describes the decision schema that migration 0020 replaced.',
  because:
    'A row type outliving its table is a promise about the database that the ' +
    'compiler cannot check and the database will not honour. The last one sat ' +
    'here for a phase, and was harmless only by luck.',
  selects: (file) => !file.isTest && file.path.startsWith('infrastructure/analysis/'),
  detect(file) {
    const found: string[] = []

    for (const node of nodes(file)) {
      /*
       * A member named for a dropped column. Only row types use snake_case
       * members, so this needs no name filter on the interface itself — and a
       * filter would be the thing to forget when the next row type is added.
       */
      if (ts.isPropertySignature(node) || ts.isPropertyDeclaration(node)) {
        const name = nameOf(node.name)
        if (name !== null && DROPPED_DECISION_COLUMNS.has(name)) {
          found.push(at(file, node, `declares the dropped column "${name}"`))
        }
      }

      /*
       * A decision row type keyed on the case. The key moved to `decision_id`
       * so a case can hold a decision and the correction that supersedes it;
       * anything still shaped around `case_id` alone cannot represent that.
       */
      if (
        ts.isInterfaceDeclaration(node) &&
        /^Decision|Decision.*Row$/.test(node.name.text)
      ) {
        const members = node.members
          .map((member) => nameOf(member.name))
          .filter((name): name is string => name !== null)
        if (members.includes('case_id') && !members.includes('decision_id')) {
          found.push(
            at(file, node, `${node.name.text} is keyed on the case, not the decision`),
          )
        }
      }

      if (ts.isStringLiteralLike(node) || ts.isTemplateLiteral(node)) {
        const text = node.getText(file.ast)
        if (DROPPED_IN_SQL.test(text)) {
          found.push(at(file, node, 'names a dropped table or column'))
        }
      }
    }

    return found
  },
}

/* ----------------------------------------------------------------- rule 13 */

/**
 * The submission-reference validator cannot be routed around.
 *
 * `analysis.reviews` is keyed on `id` alone, so no foreign key can prove that
 * the verification a submission cites reviewed THIS revision. The database
 * accepts a sibling revision's verdict with every constraint satisfied, and the
 * record then says the firm verified something it did not.
 *
 * That makes `validateSubmissionReferences` the only enforcement (R6), and an
 * only enforcement is one a new persistence path can forget. This rule is what
 * notices.
 *
 * ## What it proves, and what it does not
 *
 * It proves the module that owns submission persistence CALLS the validator.
 * It does not prove every branch does -- that needs a call graph this rule does
 * not build. The behavioural contract tests cover the branches; this covers the
 * module. Both are needed and neither is sufficient, and this is repository
 * enforcement rather than a database constraint either way.
 */
const SUBMISSION_PERSISTENCE =
  /INSERT INTO analysis\.cio_submissions|store\.submissions\.set/

const submissionValidatorNotBypassed: FitnessRule = {
  id: 'submission-references-always-validated',
  states:
    'Every module that stores or rebuilds a CIO submission validates its references.',
  because:
    'No foreign key can prove a cited review reviewed this revision, so the ' +
    'validator is the only thing standing between a submission and a record ' +
    'claiming a verification that belongs to a different argument.',
  selects: (file) =>
    !file.isTest &&
    file.path.startsWith('infrastructure/analysis/') &&
    SUBMISSION_PERSISTENCE.test(file.text),
  detect(file) {
    /*
     * A CALL, not an import. A module that imports the validator and re-exports
     * it has done nothing, and the whole point of the rule is the difference.
     */
    for (const node of nodes(file)) {
      if (!ts.isCallExpression(node)) continue
      const called = accessPath(node.expression)
      if (called !== null && /(^|\.)validateSubmissionReferences$/.test(called)) {
        return []
      }
    }
    return [
      `${file.path} — stores or rebuilds a submission without calling ` +
        `validateSubmissionReferences`,
    ]
  },
}

/* ----------------------------------------------------------------- rule 14 */

/**
 * No port is satisfied by something that only refuses.
 *
 * B2A carried a `Proxy` whose every method threw "not implemented", and it
 * satisfied `DecisionRepository` structurally while failing on first use. That
 * is the worst shape a missing capability can take: the container looks
 * complete, construction succeeds, and the failure arrives during an
 * institutional command.
 *
 * ## Placeholder, not refusal
 *
 * A repository legitimately throws all the time -- `InvariantViolationError`
 * for a blocked submission, `ConflictingRecordError` for a real disagreement.
 * The difference is not the throw. A placeholder throws a **generic `Error`**,
 * unconditionally, and usually says so in the message; a refusal throws a
 * **named** domain or storage error, and normally after checking something.
 * The rule keys on both, and the near-misses prove it discriminates.
 */
const PLACEHOLDER_WORDS =
  /not implemented|unimplemented|placeholder|to ?do|coming (in|soon)|stage b\d/i

/** Errors that mean "the caller is wrong", not "this was never built". */
const BOUNDED_ERRORS =
  /^(Invariant|Conflicting|Duplicate|Referential|Immutable|Malformed|Concurrency|Transaction|Storage|Retryable|Ambiguous|Invalid)\w*Error$/

function isPlaceholderBody(body: ts.Node | undefined, file: AnalysedSource): boolean {
  if (!body || !ts.isBlock(body) || body.statements.length !== 1) return false
  const only = body.statements[0]!
  if (!ts.isThrowStatement(only) || !only.expression) return false
  if (!ts.isNewExpression(only.expression)) return false

  const thrown = accessPath(only.expression.expression) ?? ''
  const text = only.expression.getText(file.ast)

  // A named bounded error is a refusal, whatever it says.
  if (BOUNDED_ERRORS.test(thrown)) return false
  return thrown === 'Error' || PLACEHOLDER_WORDS.test(text)
}

const noThrowingPortImplementations: FitnessRule = {
  id: 'no-placeholder-port-implementations',
  states: 'No repository port is satisfied by methods that exist only to refuse.',
  because:
    'A container that is structurally complete and fails on first use turns a ' +
    'missing capability into a failure during an institutional command, which ' +
    'is the latest and worst moment to discover it.',
  selects: (file) => !file.isTest && file.path.startsWith('infrastructure/analysis/'),
  detect(file) {
    const found: string[] = []

    for (const node of nodes(file)) {
      /* A method or property function whose whole body is a placeholder throw. */
      if (ts.isMethodDeclaration(node) && isPlaceholderBody(node.body, file)) {
        found.push(at(file, node, `${nameOf(node.name) ?? 'a method'} only refuses`))
      }
      if (
        ts.isPropertyAssignment(node) &&
        (ts.isArrowFunction(node.initializer) ||
          ts.isFunctionExpression(node.initializer)) &&
        isPlaceholderBody(node.initializer.body, file)
      ) {
        found.push(at(file, node, `${nameOf(node.name) ?? 'a method'} only refuses`))
      }

      /*
       * A Proxy standing in for a port. Structurally perfect and behaviourally
       * empty -- the exact shape the B2A stub took.
       */
      if (
        ts.isNewExpression(node) &&
        accessPath(node.expression) === 'Proxy' &&
        /Repositor|Repository|ResultStore|CommandLog/.test(file.text)
      ) {
        found.push(at(file, node, 'a Proxy stands in for a port'))
      }

      /*
       * A cast that asserts completeness the object does not have. The `unknown`
       * hop is what lets an incomplete literal reach a port type at all.
       */
      if (ts.isAsExpression(node)) {
        const target = node.type.getText(file.ast)
        if (
          /Repositor(y|ies)|ResultStore|CommandLog/.test(target) &&
          (ts.isObjectLiteralExpression(node.expression) ||
            (ts.isAsExpression(node.expression) &&
              node.expression.type.kind === ts.SyntaxKind.UnknownKeyword))
        ) {
          found.push(at(file, node, `casts an incomplete value to ${target}`))
        }
      }
    }

    return found
  },
}

/* ----------------------------------------------------------------- rule 15 */

/**
 * The same rule as 11, for the half of the tree it never covered.
 *
 * Rule 11 selects `db/migrations/` only, because a control character in SQL
 * becomes part of a literal. TypeScript was left out on the reasoning that a
 * compiler would object — and it does not. `BASIS_DOMAIN_SEPARATION` was
 * written with a **literal NUL** as its terminator, twice, in the file that
 * defines an integrity digest. It compiled, the tests passed, and every tool
 * that read the file back rendered the byte as a space. The second occurrence
 * was written *while fixing the first*.
 *
 * ## Two classes, both invisible
 *
 * **Control characters** are the original defect: a backspace where `\b` was
 * meant silenced eleven rules for months.
 *
 * **Zero-width and bidirectional characters** are worse, because they are
 * invisible by design rather than by accident. A bidi override makes source
 * *display* in one order and *compile* in another — the Trojan Source class.
 * In a file whose job is to attest that stored bytes are unaltered, a character
 * that changes what a reviewer sees is precisely the wrong thing to permit.
 *
 * ## What stays legal
 *
 * Tab, and carriage return. A CR is a line-ending artefact of whoever checked
 * the tree out, not a hidden payload, and a rule that fires on a contributor's
 * git settings is a rule that gets deleted rather than obeyed. Escapes such as
 * a backslash-u escape are plain ASCII in source and are the correct way to write these
 * characters — the near-misses pin that, because a rule that rejected the fix
 * for the defect it detects would be worse than no rule.
 */
const INVISIBLE_IN_SOURCE = new Map<number, string>([
  ...Array.from({ length: 32 }, (_, code): [number, string] => [
    code,
    'control character',
  ]).filter(([code]) => code !== 0x09 && code !== 0x0a && code !== 0x0d),
  [0x7f, 'control character'],
  [0x200b, 'zero-width space'],
  [0x200c, 'zero-width non-joiner'],
  [0x200d, 'zero-width joiner'],
  [0x2060, 'word joiner'],
  [0xfeff, 'byte-order mark'],
  [0x202a, 'bidirectional override'],
  [0x202b, 'bidirectional override'],
  [0x202c, 'bidirectional override'],
  [0x202d, 'bidirectional override'],
  [0x202e, 'bidirectional override'],
  [0x2066, 'bidirectional isolate'],
  [0x2067, 'bidirectional isolate'],
  [0x2068, 'bidirectional isolate'],
  [0x2069, 'bidirectional isolate'],
])

const sourceCharacters: FitnessRule = {
  id: 'no-invisible-characters-in-source',
  states:
    'No TypeScript source contains a control, zero-width or bidirectional ' +
    'character as a literal byte.',
  because:
    'Such a character is invisible in the editor, the review and the diff, and ' +
    'the compiler accepts it. One sat inside an integrity digest’s domain ' +
    'separator and was rendered as a space by every tool that read it back.',
  selects: (file) => /[.]tsx?$/.test(file.path),
  detect(file) {
    const found: string[] = []
    file.text.split('\n').forEach((line, index) => {
      for (const character of line) {
        const code = character.codePointAt(0)!
        const what = INVISIBLE_IN_SOURCE.get(code)
        if (what !== undefined) {
          found.push(
            `${file.path}:${index + 1} — ${what} U+${code
              .toString(16)
              .toUpperCase()
              .padStart(4, '0')}; write it as an escape`,
          )
          return
        }
      }
    })
    return found
  },
}

/* ----------------------------------------------------------------- rule 16 */

/**
 * Locale-aware comparison never decides an identity.
 *
 * `canonicalJson` sorted object keys with `localeCompare`, whose no-argument
 * form reads the host's default locale. Measured under Node's ICU, `tr` and
 * `da` order the keys `Id` and `id` opposite to `en`, `sv`, `lt`, `cs` and
 * `et` — so two machines could derive different ids for one value. TD-61
 * removed it from every identity path, and this keeps it out.
 *
 * ## Why the rule is scoped rather than global
 *
 * **Locale-aware sorting is correct for user-facing text**, and a rule that
 * banned it everywhere would be turned off rather than obeyed. So this selects
 * the identity surfaces only, and one of its fixtures is a presentation
 * component sorting with `localeCompare` that must **pass**.
 *
 * ## Why the bare `.sort()` case is included
 *
 * `Array.prototype.sort` with no comparator orders by UTF-16 code unit. That is
 * not locale-sensitive, but it is a *different rule* from canonical value v1's
 * UTF-8 byte order, and the two agree only below the astral plane. In an
 * identity path the ordering must be named, not defaulted.
 */
const IDENTITY_SURFACES = [
  'domain/shared/canonicalValue.ts',
  'domain/analysis/identity.ts',
  'domain/analysis/evidence.ts',
  'domain/analysis/requirements.ts',
  'domain/analysis/theses.ts',
  'domain/analysis/aggregation.ts',
  'application/analysis/writeOnce.ts',
  'application/analysis/playbooks.ts',
  'application/analysis/evidenceRefs.ts',
  'application/analysis/commands/envelope.ts',
  'application/analysis/commands/eventIdentity.ts',
]

/** A command that builds an identity payload. Selected by shape, not by name. */
const IDENTITY_PAYLOAD_MODULE = /^application\/analysis\/commands\/[a-zA-Z]+\.ts$/

const selectsIdentitySurface = (file: AnalysedSource) =>
  !file.isTest &&
  (IDENTITY_SURFACES.includes(file.path) ||
    (IDENTITY_PAYLOAD_MODULE.test(file.path) && /payload:\s*\(/.test(file.text)))

const noLocaleSensitiveIdentityOrder: FitnessRule = {
  id: 'no-locale-sensitive-identity-ordering',
  states:
    'No identity-critical module orders values with a locale-aware comparison, ' +
    'and none leaves an identity ordering to the default sort.',
  because:
    'A locale-aware comparison reads the host default, so two machines derive ' +
    'different ids for one value. The default sort is not locale-sensitive but ' +
    'is a different order from the one the encoder specifies, and an identity ' +
    'ordering that nobody named is one nobody can reproduce.',
  selects: selectsIdentitySurface,
  detect(file) {
    const found: string[] = []

    for (const node of nodes(file)) {
      /* `x.localeCompare(y)` anywhere in an identity module. */
      if (ts.isCallExpression(node)) {
        const called = accessPath(node.expression)
        if (called !== null && /(^|\.)localeCompare$/.test(called)) {
          found.push(at(file, node, 'orders with localeCompare'))
          continue
        }

        /*
         * `.sort()` with no comparator. The default is UTF-16 code-unit order,
         * which is not the encoder's rule -- name the ordering instead.
         */
        if (
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === 'sort' &&
          node.arguments.length === 0
        ) {
          found.push(at(file, node, 'sorts without naming an ordering'))
        }
      }

      /* `new Intl.Collator(...)`, and `Intl.Collator.prototype.compare`. */
      if (ts.isNewExpression(node) && accessPath(node.expression) === 'Intl.Collator') {
        found.push(at(file, node, 'constructs an Intl.Collator'))
      }
      if (
        ts.isPropertyAccessExpression(node) &&
        accessPath(node) !== null &&
        /^Intl\.Collator$/.test(accessPath(node)!)
      ) {
        found.push(at(file, node, 'reaches for Intl.Collator'))
      }
    }

    return found
  },
}

/**
 * `openChallenges` carries materiality so the GATE can apply the firm's
 * threshold. Anything else that compares a materiality is a second threshold.
 *
 * The rule this stage exists to protect. `evaluateEligibilityGates` blocked on
 * every open challenge while `challengeBlocks` said a non-material one does
 * not, and nothing caught the disagreement because both looked reasonable in
 * isolation. Comparing materiality is exactly what that mistake looked like.
 */
const challengeThresholdOnlyInTheGate: FitnessRule = {
  id: 'challenge-threshold-only-in-the-gate',
  states:
    'Nothing but `challengeBlocks` decides whether an open challenge blocks; ' +
    'everywhere else reads the materiality and passes it on.',
  because:
    'A threshold restated anywhere is a second place the firm draws its line, ' +
    'and the two will disagree without either being obviously wrong. The gate ' +
    'silently outranked the policy for exactly this reason.',
  selects: (file) =>
    !file.isTest &&
    /* The two functions that ARE the thresholds. */
    !file.path.endsWith('domain/analysis/review.ts') &&
    !file.path.endsWith('domain/analysis/aggregation.ts') &&
    /*
     * A KNOWN violation, excluded openly rather than silently.
     *
     * `aggregateValidation.ts` hardcodes `materiality === 'decision-critical'`
     * for the DISAGREEMENT threshold -- the same defect this rule exists to
     * prevent, in the sibling field, found by this rule on the day it was
     * written. Fixing it needs a policy threaded into a validator that has
     * none, which is a design change beyond the ruling this stage implements.
     *
     * Recorded as TD-70. When that closes, delete this line: the rule already
     * catches it.
     */
    !file.path.endsWith('domain/analysis/aggregateValidation.ts'),
  detect(file) {
    const found: string[] = []
    for (const node of nodes(file)) {
      /*
       * A comparison against one of the named weights. Reading `.materiality`
       * is fine and necessary -- carrying it is the whole design. Comparing it
       * is deciding.
       */
      if (!ts.isBinaryExpression(node)) continue
      const operator = node.operatorToken.kind
      const comparing =
        operator === ts.SyntaxKind.EqualsEqualsEqualsToken ||
        operator === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
        operator === ts.SyntaxKind.LessThanToken ||
        operator === ts.SyntaxKind.GreaterThanToken ||
        operator === ts.SyntaxKind.LessThanEqualsToken ||
        operator === ts.SyntaxKind.GreaterThanEqualsToken
      if (!comparing) continue

      /*
       * Structural, not textual. The analysed AST blanks string contents so a
       * rule cannot be tripped by prose -- which also means the literal's VALUE
       * is unavailable here. Comparing `.materiality` against any string
       * literal is the shape that matters; which weight it names does not
       * change the fact that a threshold is being restated.
       */
      const sides = [node.left, node.right]
      const readsMateriality = sides.some(
        (side) =>
          ts.isPropertyAccessExpression(side) && nameOf(side.name) === 'materiality',
      )
      const againstLiteral = sides.some((side) => ts.isStringLiteral(side))
      if (!readsMateriality || !againstLiteral) continue

      found.push(at(file, node, 'compares a materiality against a literal weight'))
    }
    return found
  },
}

/* ------------------------------------------------------------------ rule 18 */

/**
 * The one act that may declare a body of evidence fit for analysis.
 *
 * Until C3 Stage B the only production writer of an `EvidenceSet` was
 * `/smoke/c2-1`: a route that hand-wrote one hard-coded observation and called
 * `repositories.evidence.save` directly, with **no actor, no mandate, no
 * command, no ledger entry, no event and no recorded selection** — while
 * nineteen lesser acts all carried the full envelope.
 *
 * Assembly determines the ceiling on every claim the firm can make from the
 * set: `citeFrom` refuses anything outside it, and `composeConfidence` is
 * bounded by its properties. A second writer would be a second way to set that
 * ceiling with nobody's name on it, and the whole of gate §0.3 rests on there
 * not being one.
 *
 * The adapters that IMPLEMENT `save` are excluded — a port needs a body — as
 * are the test harnesses that seed fixtures, which is what `isTest` and the
 * named harness files below cover.
 */
const EVIDENCE_SAVE_IMPLEMENTORS = [
  'infrastructure/analysis/inMemoryRepositories.ts',
  'infrastructure/analysis/postgres/evidenceRepositories.ts',
]

/** Fixture seeders. Never reachable from the served application. */
const EVIDENCE_TEST_HARNESSES = [
  'infrastructure/analysis/decisionSeed.ts',
  'infrastructure/analysis/aggregationHarness.ts',
  'infrastructure/analysis/postgres/macroFlowHarness.ts',
  /* The shared parity contract. Not named .test.ts, but only a suite runs it. */
  'infrastructure/analysis/repositoryContract.ts',
]

const evidenceOnlyFromTheGovernedAct: FitnessRule = {
  id: 'evidence-assembled-only-by-the-governed-act',
  states:
    'Only `AssembleEvidenceSet` writes an evidence set. Nothing else in the ' +
    'application or infrastructure calls `evidence.save`.',
  because:
    'Whoever writes a set decides what a desk may conclude from it. A second ' +
    'writer would set that ceiling with no actor, no mandate and no recorded ' +
    'selection — which is exactly what `/smoke/c2-1` did, and what retiring it ' +
    'was for. The door closes only if it stays closed.',
  selects: (file) =>
    !file.isTest &&
    (under('application/', 'infrastructure/', 'components/', 'routes/')(file) ||
      false) &&
    !file.path.endsWith('application/analysis/commands/assembleEvidenceSet.ts') &&
    !EVIDENCE_SAVE_IMPLEMENTORS.some((path) => file.path.endsWith(path)) &&
    !EVIDENCE_TEST_HARNESSES.some((path) => file.path.endsWith(path)),
  detect(file) {
    const found: string[] = []
    for (const node of nodes(file)) {
      if (!ts.isCallExpression(node)) continue
      const path = accessPath(node.expression)
      /*
       * Structural: any call whose callee ends in `.evidence.save`, however the
       * repositories object was reached — `repositories.evidence.save`,
       * `tx.evidence.save`, `this.repos.evidence.save`. Reading the set is
       * untouched, which is the near-miss the meta-test requires.
       */
      if (path === null || !/(^|\.)evidence\.save$/.test(path)) continue
      found.push(at(file, node, `calls ${path} outside AssembleEvidenceSet`))
    }
    return found
  },
}

/* --------------------------------------------------------------- the registry */

/**
 * Ordered as the reviewer named them. Adding an entry here without a planted
 * violation and a benign near-miss in `planted.ts` fails the meta-test.
 */
/*
 * The fast path, ruled a hard product principle on 2026-09-17: a simple
 * market fact goes structured fresh data → deterministic formatting →
 * answer, and never simple fact → general model → tools → general model →
 * answer. Two modules make a line Tier 0 and speak it: the recogniser and
 * the formatter. The day either of them reaches for a model, a provider,
 * or the runtime's plumbing, the one-second path has quietly become a
 * model path again, and every green test above it still passes.
 */
const FAST_PATH_MODULES = ['application/jarvis/marketIntent.ts', 'presentation/jarvis/marketSpeech.ts']

const MODEL_PACKAGES = /^(openai|@anthropic-ai\/sdk|@langchain\/.*|langchain|ai|@ai-sdk\/.*|@google\/generative-ai|@mistralai\/.*|cohere-ai|groq-sdk)$/

const fastPathMeetsNoModel: FitnessRule = {
  id: 'fast-path-meets-no-model',
  states:
    'The Tier-0 market path — the recogniser and the formatter — imports no model, no provider and no infrastructure.',
  because:
    'A named instrument’s move is answered from the platform’s own numbers ' +
    'in under a second because nothing on that path waits for a model. An ' +
    'import of a model SDK, of the live provider or of the runtime would ' +
    'put a general model back between the number and the person, and the ' +
    'measured second would become the measured five without any test ' +
    'failing — a richer JARVIS quietly becoming a slower one.',
  selects: (file) => !file.isTest && FAST_PATH_MODULES.includes(file.path),
  detect(file) {
    const found: string[] = []
    for (const reference of file.imports) {
      if (reference.typeOnly) continue
      const { specifier } = reference
      if (MODEL_PACKAGES.test(specifier)) {
        found.push(`${file.path} — imports the model package '${specifier}'`)
      } else if (/(^~\/|\/)infrastructure\//.test(specifier) || specifier.startsWith('~/infrastructure')) {
        found.push(`${file.path} — imports infrastructure '${specifier}'`)
      } else if (/\/(openaiLive|liveSession|liveTools|liveSpeech)$/.test(specifier)) {
        found.push(`${file.path} — imports the live runtime’s '${specifier}'`)
      }
    }
    return found
  },
}

export const LOAD_BEARING_RULES: readonly FitnessRule[] = [
  noOutboundNetwork,
  fastPathMeetsNoModel,
  noProseActivityInDomain,
  orchestratorWritesNothing,
  llmClientConfinedToProvider,
  noUiImportOfInfrastructure,
  noCallerSuppliedIdentity,
  eligibilityDecidedInTheDomain,
  noSecondEligibilityAnswer,
  noEligibilityInSql,
  noMemoryInDurableTests,
  migrationCharacters,
  sourceCharacters,
  noPre0020DecisionShape,
  submissionValidatorNotBypassed,
  noThrowingPortImplementations,
  noLocaleSensitiveIdentityOrder,
  challengeThresholdOnlyInTheGate,
  evidenceOnlyFromTheGovernedAct,
]

export function ruleById(id: string): FitnessRule {
  const found = LOAD_BEARING_RULES.find((rule) => rule.id === id)
  if (!found) throw new Error(`No fitness rule with id "${id}"`)
  return found
}
