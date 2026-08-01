/**
 * Deliberate violations, and the near-misses that must not be mistaken for them.
 *
 * Two fixtures per rule, and both are load-bearing.
 *
 * The **planted violation** is the half that was missing. A rule is only ever
 * run against a tree that complies, so "passed" is the only result it can
 * produce whether the expression works or not — which is how eleven rules with
 * a corrupt byte in them passed for months. Requiring each rule to fail on a
 * file that breaks it turns "the pattern looks right" into "the pattern fires".
 *
 * The **benign near-miss** is the other half. `detect: () => ['broken']` would
 * pass every planted violation ever written, and so would a rule whose pattern
 * had grown so broad it flagged the compliant code around it. Each near-miss
 * sits as close to the line as real code does — a port that wraps the network,
 * a structured field whose name reads like prose, an identity passed through
 * rather than invented — and the rule must let it through.
 *
 * Fixtures are TypeScript source, parsed exactly as a real file is. The
 * meta-test requires them to parse: a fixture with a syntax error would be
 * detected or ignored for reasons that have nothing to do with the rule.
 */

export interface Fixture {
  /**
   * The path the fixture pretends to occupy. It decides whether the rule
   * selects the file at all, so it must be somewhere the rule looks.
   */
  path: string
  /** What this fixture is doing, for a failure message that explains itself. */
  what: string
  source: string
}

export interface RuleFixtures {
  ruleId: string
  /** Each must be detected. */
  violations: Fixture[]
  /** Each must be allowed through. */
  nearMisses: Fixture[]
}

export const PLANTED: readonly RuleFixtures[] = [
  {
    ruleId: 'no-outbound-network-outside-http-client',
    violations: [
      {
        path: 'infrastructure/marketData/providers/rogue.ts',
        what: 'an adapter calling fetch directly',
        source: `
          export async function loadSeries(url: string): Promise<unknown> {
            const response = await fetch(url)
            return response.json()
          }
        `,
      },
      {
        path: 'infrastructure/marketData/providers/rogue.ts',
        what: 'the same call reached through globalThis',
        source: `
          export async function loadSeries(url: string): Promise<unknown> {
            return (await globalThis.fetch(url)).json()
          }
        `,
      },
      {
        path: 'application/marketData/stream.ts',
        what: 'a socket opened outside the client',
        source: `
          export function connect(url: string): WebSocket {
            return new WebSocket(url)
          }
        `,
      },
      {
        path: 'infrastructure/marketData/providers/rogue.ts',
        what: 'an http package pulled in as a dependency',
        source: `
          import axios from 'axios'
          export const get = (url: string) => axios.get(url)
        `,
      },
      {
        path: 'components/countryExplorer/CapitalFlowsCard.tsx',
        what: 'a frozen static-asset URL repointed at a third party',
        source: `
          const WORLD_ATLAS_URL = 'https://cdn.example.com/countries-110m.json'
          export function CapitalFlowsCard() {
            fetch(WORLD_ATLAS_URL)
            return null
          }
        `,
      },
    ],
    nearMisses: [
      {
        path: 'infrastructure/marketData/providers/frankfurter.ts',
        what: 'an adapter going through the injected client',
        source: `
          import type { HttpClient } from './httpClient'
          export async function rates(client: HttpClient, url: string) {
            return client.getJson(url)
          }
        `,
      },
      {
        path: 'components/countryExplorer/CapitalFlowsCard.tsx',
        what: 'the frozen same-origin topology load, unchanged',
        source: `
          const WORLD_ATLAS_URL = '/data/countries-110m.json'
          export function CapitalFlowsCard() {
            fetch(WORLD_ATLAS_URL).then((response) => response.json())
            return null
          }
        `,
      },
      {
        path: 'application/marketData/notes.ts',
        what: 'the words fetch() and new WebSocket in a comment and a string',
        source: `
          /** Never call fetch() here; new WebSocket(url) belongs to the client. */
          export const RULE = 'no fetch(url) and no new EventSource(url) outside the client'
        `,
      },
    ],
  },

  {
    ruleId: 'no-prose-activity-in-domain',
    violations: [
      {
        path: 'domain/analysis/contributions.ts',
        what: 'an activity sentence stored on a record',
        source: `
          export interface AgentRunRecord {
            id: string
            activity: string
          }
        `,
      },
      {
        path: 'domain/analysis/events.ts',
        what: 'an optional narration field',
        source: `
          export interface TransitionEvent {
            id: string
            description?: string | null
          }
        `,
      },
      {
        path: 'domain/analysis/aggregation.ts',
        what: 'a list of generated commentary',
        source: `
          export interface ManagerAggregation {
            id: string
            commentary: readonly string[]
          }
        `,
      },
    ],
    nearMisses: [
      {
        path: 'domain/analysis/theses.ts',
        what: 'the prose a person actually wrote and the firm stands behind',
        source: `
          export interface InvestmentThesis {
            statement: string
            invalidationCriteria: string
            reason: string
          }
        `,
      },
      {
        path: 'domain/analysis/events.ts',
        what: 'a structured activity kind rather than a sentence',
        source: `
          export type ActivityKind = 'run-started' | 'contribution-recorded'
          export interface TransitionEvent {
            activity: ActivityKind
          }
        `,
      },
    ],
  },

  {
    ruleId: 'orchestrator-writes-nothing-directly',
    violations: [
      {
        path: 'application/analysis/orchestrator.ts',
        what: 'a repository reached from the sequencer',
        source: `
          import type { Repositories } from './repositories'
          export async function run(repositories: Repositories) {
            await repositories.runs.save({ id: 'r1' })
          }
        `,
      },
      {
        path: 'application/analysis/orchestrator.ts',
        what: 'a ledger append with no command behind it',
        source: `
          export async function run(log: { append(entry: unknown): Promise<void> }) {
            await log.append({ kind: 'ran' })
          }
        `,
      },
      {
        path: 'application/analysis/orchestrator.ts',
        what: 'a transaction opened around external work',
        source: `
          export async function run(deps: { withTransaction: unknown }) {
            await withTransaction(async () => {
              await produce()
            })
          }
        `,
      },
    ],
    nearMisses: [
      {
        path: 'application/analysis/orchestrator.ts',
        what: 'the real shape — commands either side of a provider call',
        source: `
          import { runCommand } from './commands/runCommand'
          import { startAgentRun } from './commands/startAgentRun'
          import { recordContribution } from './commands/recordContribution'
          import type { ContributionProvider } from './contributionPort'

          export async function orchestrate(
            deps: unknown,
            provider: ContributionProvider,
          ) {
            const started = await runCommand(deps, startAgentRun(), {})
            const produced = await provider.produce({ runId: started.value })
            return runCommand(deps, recordContribution(), produced)
          }
        `,
      },
    ],
  },

  {
    ruleId: 'no-llm-dependency',
    violations: [
      {
        path: 'infrastructure/analysis/providers/live.ts',
        what: 'the Anthropic SDK',
        source: `
          import Anthropic from '@anthropic-ai/sdk'
          export const client = new Anthropic()
        `,
      },
      {
        path: 'infrastructure/analysis/providers/live.ts',
        what: 'the OpenAI SDK',
        source: `
          import { OpenAI } from 'openai'
          export const client = new OpenAI()
        `,
      },
      {
        path: 'application/analysis/orchestrator.ts',
        what: 'a framework that wraps one',
        source: `
          import { ChatPromptTemplate } from '@langchain/core'
          export const prompt = ChatPromptTemplate
        `,
      },
    ],
    nearMisses: [
      {
        path: 'infrastructure/analysis/providers/recorded.ts',
        what: "a recorded provenance whose provider is the string 'anthropic'",
        source: `
          import type { ExecutionIdentity } from '~/domain/analysis'
          export const RECORDED: ExecutionIdentity = {
            kind: 'model',
            model: { provider: 'anthropic', name: 'claude-opus-5' },
            prompt: { id: 'p1', hash: 'abc' },
          }
        `,
      },
      {
        path: 'application/analysis/contributionPort.ts',
        what: 'our own module whose path contains the word ai',
        source: `
          import type { Claim } from '~/domain/analysis'
          export interface ContributionProvider {
            produce(request: unknown): Promise<readonly Claim[]>
          }
        `,
      },
    ],
  },

  {
    ruleId: 'no-ui-import-of-infrastructure',
    violations: [
      {
        path: 'routes/agents.tsx',
        what: 'a route naming the database adapter',
        source: `
          import { postgresRepositories } from '~/infrastructure/analysis/postgres/postgresRepositories'
          export const Route = { loader: () => postgresRepositories }
        `,
      },
      {
        path: 'components/agents/AgentCard.tsx',
        what: 'a component naming a concrete provider',
        source: `
          import { frankfurter } from '~/infrastructure/marketData/providers/frankfurter'
          export function AgentCard() {
            return frankfurter
          }
        `,
      },
      {
        path: 'components/agents/AgentCard.tsx',
        what: 'a component reaching the analysis runtime',
        source: `
          import { orchestrate } from '~/application/analysis/orchestrator'
          export function AgentCard() {
            return orchestrate
          }
        `,
      },
    ],
    nearMisses: [
      {
        path: 'routes/markets.tsx',
        what: 'the published server-function boundary, which is a port',
        source: `
          import { getQuotes } from '~/infrastructure/marketData/serverFns'
          import type { Quote } from '~/domain/market/quote'
          export const Route = { loader: (): Promise<Quote[]> => getQuotes() }
        `,
      },
      {
        path: 'components/agents/AgentCard.tsx',
        what: 'domain types and presentation helpers only',
        source: `
          import type { Department } from '~/domain/analysis'
          import { formatPercent } from '~/lib/format'
          export function AgentCard(props: { department: Department }) {
            return formatPercent(props.department.id.length)
          }
        `,
      },
    ],
  },

  {
    ruleId: 'no-caller-supplied-or-invented-identity',
    violations: [
      {
        path: 'application/analysis/commands/recordSomething.ts',
        what: 'an event id assembled from a template literal',
        source: `
          export function handler(context: { commandId: string }) {
            return { eventId: \`evt-\${context.commandId}-1\` }
          }
        `,
      },
      {
        path: 'application/analysis/commands/recordSomething.ts',
        what: 'an id built by concatenation',
        source: `
          export function handler(context: { commandId: string }) {
            return { runId: 'run-' + context.commandId }
          }
        `,
      },
      {
        path: 'application/analysis/commands/recordSomething.ts',
        what: 'an identity drawn from entropy, which no replay can reproduce',
        source: `
          export function handler() {
            return { id: crypto.randomUUID() }
          }
        `,
      },
      {
        path: 'application/analysis/commands/recordSomething.ts',
        what: 'an input letting the caller name the event',
        source: `
          export interface RecordSomethingInput {
            caseId: string
            eventId: string
          }
        `,
      },
      {
        path: 'application/analysis/commands/recordSomething.ts',
        what: 'an input letting the caller name the revision it will produce',
        source: `
          export interface RecordSomethingInput {
            caseId: string
            producedRevisionId: string
          }
        `,
      },
    ],
    nearMisses: [
      {
        path: 'application/analysis/commands/recordSomething.ts',
        what: 'identities derived from the command, and one passed through',
        source: `
          import { deriveEventId, deriveRunId } from './eventIdentity'
          export function handler(context: { commandId: string }, runId: string) {
            const aggregationId = deriveRunId(context, 'aggregation')
            return {
              eventId: deriveEventId(context, 'run-started'),
              runId,
              id: aggregationId,
              producedRevisionId: '',
            }
          }
        `,
      },
      {
        path: 'application/analysis/commands/recordSomething.ts',
        what: 'an input naming the records it targets rather than the ones it mints',
        source: `
          export interface RecordSomethingInput {
            caseId: string
            sourceRevisionId: string
            departmentId: string
          }
        `,
      },
      {
        path: 'application/analysis/commands/recordSomething.ts',
        what: 'a message that happens to interpolate an id',
        source: `
          export function handler(revisionId: string) {
            const message = \`Revision \${revisionId} does not exist\`
            return { message }
          }
        `,
      },
    ],
  },
]
