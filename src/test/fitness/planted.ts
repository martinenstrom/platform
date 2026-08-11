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

  {
    ruleId: 'eligibility-decided-only-in-the-domain',
    violations: [
      {
        path: 'application/analysis/commands/recordRiskReview.ts',
        what: 'a handler asking the domain whether the revision is eligible',
        source: `
          import { evaluateRevisionEligibility } from '~/domain/analysis'
          export async function execute(repositories: never, input: { caseId: string }) {
            const results = evaluateRevisionEligibility([], input.caseId, {})
            return results
          }
        `,
      },
      {
        path: 'application/analysis/commands/submitForVerification.ts',
        what: 'a handler assembling the answer from the gate instead',
        source: `
          import { evaluateGate } from '~/domain/analysis'
          export function execute() {
            return evaluateGate({ riskRequirement: 'not-required' }).passed
          }
        `,
      },
      {
        path: 'application/analysis/orchestrator.ts',
        what: 'the sequencer deciding it',
        source: `
          import { evaluateThesisEligibility } from '~/domain/analysis'
          export function ready(thesisId: string, revisionId: string) {
            return evaluateThesisEligibility(thesisId, revisionId, {
              lifecycle: 'verified',
              blockers: [],
              missingRequiredContributions: [],
            }).eligibleForDecision
          }
        `,
      },
    ],
    nearMisses: [
      {
        path: 'application/analysis/commands/recordRiskReview.ts',
        what: 'a handler recording a verdict and drawing no conclusion from it',
        source: `
          import { buildRiskVerdict } from '~/domain/analysis'
          export function execute(input: { status: 'accepted' }) {
            return buildRiskVerdict({ status: input.status, findings: [] })
          }
        `,
      },
      {
        path: 'application/analysis/requiredWork.ts',
        what: 'an input the domain will decide from, computed outside it',
        source: `
          export function unmet(entries: readonly string[]) {
            return entries.filter((entry) => entry.length === 0)
          }
        `,
      },
    ],
  },

  {
    ruleId: 'no-second-eligibility-answer',
    violations: [
      {
        path: 'presentation/caseView.ts',
        what: 'a projection deciding eligibility from a status',
        source: `
          export function view(status: string, blockers: readonly string[]) {
            return { eligibleForDecision: status === 'verified' && blockers.length === 0 }
          }
        `,
      },
      {
        path: 'application/analysis/eligibility.ts',
        what: 'the adapter hard-coding the answer',
        source: `
          export function summary() {
            return { eligibleForDecision: true }
          }
        `,
      },
    ],
    nearMisses: [
      {
        path: 'application/analysis/eligibility.ts',
        what: "passing the domain's own answer through",
        source: `
          export function summary(decided: { eligibleForDecision: boolean }) {
            return { eligibleForDecision: decided.eligibleForDecision }
          }
        `,
      },
      {
        path: 'presentation/caseView.ts',
        what: 'reading the answer to choose a label',
        source: `
          export function label(eligibility: { eligibleForDecision: boolean }) {
            return eligibility.eligibleForDecision ? 'Ready for the CIO' : 'Blocked'
          }
        `,
      },
    ],
  },

  {
    ruleId: 'no-eligibility-in-sql',
    violations: [
      {
        path: 'infrastructure/analysis/postgres/eligibilityRepositories.ts',
        what: 'a query computing eligibility',
        source: `
          export const SQL = {
            list: \`SELECT revision_id,
                          (status = 'verified') AS eligible
                   FROM analysis.reviews\`,
          }
        `,
      },
      {
        path: 'infrastructure/analysis/postgres/eligibilityRepositories.ts',
        what: 'a query comparing a governance verdict',
        source: `
          export const SQL = {
            passed: \`SELECT 1 FROM analysis.reviews WHERE status = 'verified'\`,
          }
        `,
      },
      {
        /*
         * The storage exemption is two names, not the word. An adapter that
         * invents its own eligibility column is deciding again, and still fires.
         */
        path: 'infrastructure/analysis/postgres/eligibilityRepositories.ts',
        what: 'an eligibility column the registry does not define',
        source: `
          export const SQL = {
            state: \`SELECT revision_id,
                           CASE WHEN risk_review_id IS NULL THEN 'blocked'
                                ELSE 'clear' END AS eligibility_state
                    FROM analysis.cio_submissions\`,
          }
        `,
      },
    ],
    nearMisses: [
      {
        path: 'infrastructure/analysis/postgres/governanceRepositories.ts',
        what: 'a query that reads verdicts without judging them',
        source: `
          export const SQL = {
            forCase: \`SELECT id, kind, status, sequence
                      FROM analysis.reviews
                      WHERE case_id = $1 AND kind = $2
                      ORDER BY sequence\`,
          }
        `,
      },
      {
        path: 'infrastructure/analysis/postgres/policyRepositories.ts',
        what: 'reading the policy registry the domain applies',
        source: `
          export const SQL = {
            policies: \`SELECT * FROM analysis.eligibility_policies ORDER BY version\`,
          }
        `,
      },
      {
        path: 'infrastructure/analysis/postgres/submissionRepositories.ts',
        what: 'recording which policy version the domain used',
        source: `
          export const SQL = {
            insert: \`INSERT INTO analysis.cio_submissions
                       (id, case_id, eligibility_policy_version)
                     VALUES ($1, $2, $3)\`,
          }
        `,
      },
      {
        path: 'infrastructure/analysis/postgres/caseRepositories.ts',
        what: 'a comment mentioning eligibility beside an unrelated query',
        source: `
          /** Read by the eligibility adapter; it decides nothing here. */
          export const SQL = {
            revisions: \`SELECT revision_id, lifecycle FROM analysis.thesis_revisions
                        WHERE case_id = $1\`,
          }
        `,
      },
    ],
  },

  {
    ruleId: 'no-in-memory-adapter-in-durable-tests',
    violations: [
      {
        path: 'infrastructure/analysis/postgres/macroFlow.pg.test.ts',
        what: 'a durability test reaching for the memory store',
        source: `
          import { createInMemoryRepositories } from '../inMemoryRepositories'
          export const repositories = createInMemoryRepositories()
        `,
      },
      {
        path: 'infrastructure/analysis/postgres/schema.pg.test.ts',
        what: 'the same import renamed on the way in',
        source: `
          import { createInMemoryRepositories as fallback } from '../inMemoryRepositories'
          export const repositories = fallback()
        `,
      },
      {
        path: 'infrastructure/analysis/postgres/macroFlow.pg.test.ts',
        what: 'a fallback added dynamically, out of sight of the import block',
        source: `
          export async function repositories() {
            const { createInMemoryRepositories } = await import('../inMemoryRepositories')
            return createInMemoryRepositories()
          }
        `,
      },
    ],
    nearMisses: [
      {
        path: 'infrastructure/analysis/postgres/macroFlow.pg.test.ts',
        what: 'the durable composition root, which is the point',
        source: `
          import { createAnalysisContainer } from '~/infrastructure/analysis/container'
          export const start = (url: string) =>
            createAnalysisContainer({ connectionString: url } as never)
        `,
      },
      {
        path: 'infrastructure/analysis/postgres/queryCount.pg.test.ts',
        what: 'a comment explaining why the memory adapter is absent',
        source: `
          /* No createInMemoryRepositories here: a durable test that could fall
             back to memory would prove that memory works. */
          export const NOTE = 'inMemoryRepositories is deliberately unused'
        `,
      },
    ],
  },

  {
    ruleId: 'no-pre-0020-decision-shape',
    violations: [
      {
        path: 'infrastructure/analysis/postgres/rows.ts',
        what: 'a row type carrying the dropped governance document',
        source: `
          export interface DecisionRow {
            decision_id: string
            rationale: string
            governance: unknown
          }
        `,
      },
      {
        path: 'infrastructure/analysis/postgres/rows.ts',
        what: 'the dropped dissent and trigger columns',
        source: `
          export interface CaseDecisionRow {
            decision_id: string
            unresolved_dissent: unknown
            reconsideration_triggers: unknown
          }
        `,
      },
      {
        path: 'infrastructure/analysis/postgres/rows.ts',
        what: 'a decision row keyed on the case',
        source: `
          export interface DecisionRevisionRow {
            case_id: string
            revision_id: string
            relation: string
          }
        `,
      },
      {
        path: 'infrastructure/analysis/postgres/decisionRepositories.ts',
        what: 'a statement against the dropped table',
        source: `
          export const SQL = {
            revisions: \`SELECT revision_id, relation
                        FROM analysis.decision_revisions WHERE case_id = $1\`,
          }
        `,
      },
    ],
    nearMisses: [
      {
        /*
         * The live table CONTAINS the dropped column name. A substring search
         * flags this, and a rule that cries wolf gets weakened until it says
         * nothing -- which is the failure mode this whole harness exists for.
         */
        path: 'infrastructure/analysis/postgres/decisionRepositories.ts',
        what: 'the live reconsideration-trigger table, whose name contains a dropped one',
        source: `
          export const SQL = {
            triggers: \`SELECT id, ordinal, policy_version
                       FROM analysis.decision_reconsideration_triggers
                       WHERE decision_id = ANY($1) ORDER BY ordinal\`,
          }
        `,
      },
      {
        path: 'infrastructure/analysis/postgres/decisionRepositories.ts',
        what: 'the live dissent table, whose name contains a dropped one',
        source: `
          export const SQL = {
            dissent: \`SELECT decision_id, ordinal, materiality
                      FROM analysis.decision_dissent WHERE decision_id = ANY($1)\`,
          }
        `,
      },
      {
        path: 'infrastructure/analysis/postgres/mapping.ts',
        what: 'the current camelCase domain field, which is not a column',
        source: `
          export interface Decided {
            decisionId: string
            reconsiderationTriggers: readonly string[]
            unresolvedDissent: readonly string[]
          }
        `,
      },
      {
        path: 'infrastructure/analysis/postgres/rows.ts',
        what: 'a child row legitimately keyed on the case beside the decision',
        source: `
          export interface DecisionSubmissionRow {
            decision_id: string
            submission_id: string
            case_id: string
            revision_id: string
            relation: string
          }
        `,
      },
    ],
  },

  {
    ruleId: 'submission-references-always-validated',
    violations: [
      {
        path: 'infrastructure/analysis/postgres/rogueSubmissions.ts',
        what: 'a persistence path that never validates its references',
        source: `
          export function createRogue(client: { query(sql: string): Promise<void> }) {
            return {
              save: async () => {
                await client.query('INSERT INTO analysis.cio_submissions (id) VALUES ($1)')
              },
            }
          }
        `,
      },
      {
        path: 'infrastructure/analysis/rogueMemory.ts',
        what: 'an in-memory store writing submissions unchecked',
        source: `
          export function createRogue(store: { submissions: Map<string, unknown> }) {
            return {
              save: async (submission: { id: string }) => {
                store.submissions.set(submission.id, submission)
                return submission
              },
            }
          }
        `,
      },
      {
        /*
         * The one the rule exists to catch. Importing the validator is not
         * calling it, and a re-export looks reassuring in a diff.
         */
        path: 'infrastructure/analysis/postgres/rogueReexport.ts',
        what: 'a persistence path that only re-exports the validator',
        source: `
          import { validateSubmissionReferences } from '~/domain/analysis'
          export { validateSubmissionReferences }

          export function createRogue(client: { query(sql: string): Promise<void> }) {
            return {
              save: async () => {
                await client.query('INSERT INTO analysis.cio_submissions (id) VALUES ($1)')
              },
            }
          }
        `,
      },
    ],
    nearMisses: [
      {
        path: 'infrastructure/analysis/postgres/goodSubmissions.ts',
        what: 'a persistence path that calls the validator',
        source: `
          import { validateSubmissionReferences } from '~/domain/analysis'

          export function createGood(client: { query(sql: string): Promise<void> }) {
            return {
              save: async (submission: never, governance: never) => {
                const problems = validateSubmissionReferences(submission, governance)
                if (problems.length > 0) throw new Error('refused')
                await client.query('INSERT INTO analysis.cio_submissions (id) VALUES ($1)')
              },
            }
          }
        `,
      },
      {
        /*
         * The call is indirect. A rule that only looked at `save` itself would
         * flag this, and the real adapter routes hydration through a helper for
         * exactly this reason.
         */
        path: 'infrastructure/analysis/postgres/helperSubmissions.ts',
        what: 'a persistence path that validates through a local helper',
        source: `
          import { validateSubmissionReferences } from '~/domain/analysis'

          function checked(submission: never, governance: never) {
            const problems = validateSubmissionReferences(submission, governance)
            if (problems.length > 0) throw new Error('refused')
            return submission
          }

          export function createGood(client: { query(sql: string): Promise<void> }) {
            return {
              save: async (submission: never, governance: never) => {
                checked(submission, governance)
                await client.query('INSERT INTO analysis.cio_submissions (id) VALUES ($1)')
              },
            }
          }
        `,
      },
      {
        path: 'infrastructure/analysis/goodMemory.ts',
        what: 'an in-memory store that validates before writing',
        source: `
          import { validateSubmissionReferences } from '~/domain/analysis'

          export function createGood(store: { submissions: Map<string, unknown> }) {
            return {
              save: async (submission: { id: string }, governance: never) => {
                validateSubmissionReferences(submission as never, governance)
                store.submissions.set(submission.id, submission)
                return submission
              },
            }
          }
        `,
      },
    ],
  },

  {
    ruleId: 'no-placeholder-port-implementations',
    violations: [
      {
        path: 'infrastructure/analysis/postgres/stubRepositories.ts',
        what: 'a Proxy standing in for a repository port',
        source: `
          export const decisions = new Proxy(
            {},
            {
              get: () => () => {
                throw new Error('not implemented yet')
              },
            },
          ) as DecisionRepository
        `,
      },
      {
        path: 'infrastructure/analysis/postgres/stubRepositories.ts',
        what: 'a method whose whole body is a placeholder throw',
        source: `
          export const decisions = {
            save: async () => {
              throw new Error('decisions.save is not implemented')
            },
          }
        `,
      },
      {
        path: 'infrastructure/analysis/postgres/stubRepositories.ts',
        what: 'an incomplete literal cast to a complete port',
        source: `
          export const partial = {
            get: async () => null,
          } as unknown as AnalysisRepositories
        `,
      },
    ],
    nearMisses: [
      {
        /*
         * A refusal, not a placeholder. It throws unconditionally and it is
         * still correct code -- the difference is that the error is named and
         * bounded, which is what the rule keys on.
         */
        path: 'infrastructure/analysis/postgres/readOnlyRepositories.ts',
        what: 'a method that unconditionally throws a bounded error',
        source: `
          export const decisions = {
            save: async () => {
              throw new ImmutableRecordError('Case decision', 'decisions.save')
            },
          }
        `,
      },
      {
        path: 'infrastructure/analysis/postgres/guardedRepositories.ts',
        what: 'a method that validates and then refuses',
        source: `
          export const submissions = {
            save: async (submission: { blockers: readonly unknown[] }) => {
              if (submission.blockers.length > 0) {
                throw new InvariantViolationError('blockers', 'submissions.save')
              }
              return submission
            },
          }
        `,
      },
      {
        path: 'infrastructure/analysis/postgres/tracing.ts',
        what: 'a Proxy used for something that is not a port',
        source: `
          export const counted = new Proxy(
            { total: 0 },
            { get: (target, key) => Reflect.get(target, key) },
          )
        `,
      },
    ],
  },

  {
    ruleId: 'no-unrepresentable-characters-in-migrations',
    violations: [
      {
        path: 'db/migrations/0021_example.sql',
        what: 'an arrow in a comment, which WIN1252 cannot encode',
        source:
          '-- pending \u2192 decided\nALTER TABLE analysis.cases ADD COLUMN x text;\n',
      },
      {
        path: 'db/migrations/0021_example.sql',
        what: 'a NUL inside a string literal, invisible in review',
        source: "INSERT INTO analysis.cases (id) VALUES ('case\u00001');\n",
      },
      {
        path: 'db/migrations/0021_example.sql',
        what: 'a backspace where a word boundary was meant',
        source:
          '-- matches \u0008nothing\nALTER TABLE analysis.cases ADD COLUMN y text;\n',
      },
      {
        path: 'db/migrations/0021_example.sql',
        what: 'a CJK character outside the client encoding',
        source: '-- \u6c7a\nALTER TABLE analysis.cases ADD COLUMN z text;\n',
      },
    ],
    nearMisses: [
      {
        path: 'db/migrations/0021_example.sql',
        what: 'the em-dashes and curly quotes the comments actually use',
        source:
          '/* The firm\u2019s position \u2014 recorded once, where it is true. */\n' +
          'ALTER TABLE analysis.cases ADD COLUMN note text;\n',
      },
      {
        path: 'db/migrations/0021_example.sql',
        what: 'tabs and newlines, which are not the control characters at issue',
        source: 'CREATE TABLE analysis.x (\n\tid text PRIMARY KEY\n);\n',
      },
      {
        path: 'db/migrations/0021_example.sql',
        what: 'accented Latin-1, which the client encodes',
        source:
          '-- Sm\u00e5f\u00f6retag \u00e4r ocks\u00e5 f\u00f6retag\nALTER TABLE analysis.cases ADD COLUMN w text;\n',
      },
    ],
  },
  {
    ruleId: 'no-invisible-characters-in-source',
    violations: [
      {
        path: 'domain/analysis/example.ts',
        what: 'a NUL terminating a domain separator, the defect this rule exists for',
        source: 'export const SEPARATION = `financial-os:example:v1\u0000`\n',
      },
      {
        path: 'domain/analysis/example.ts',
        what: 'a backspace where a word boundary was meant',
        source: 'export const NAMES = /\u0008(?:governance)\u0008/\n',
      },
      {
        path: 'domain/analysis/example.ts',
        what: 'a zero-width space hiding inside an identifier literal',
        source: "export const KEY = 'macro\u200bscan'\n",
      },
      {
        path: 'domain/analysis/example.ts',
        what: 'a bidirectional override, which reorders what a reviewer sees',
        source: '/* \u202e drah si siht \u202c */\nexport const X = 1\n',
      },
      {
        path: 'domain/analysis/example.test.ts',
        what: 'the same character in a test, which the rule judges equally',
        source: "const separator = '\u0000'\nexport default separator\n",
      },
    ],
    nearMisses: [
      {
        path: 'domain/analysis/example.ts',
        what: 'the escape form, which is the correct way to write the character',
        source:
          'export const SEPARATION = `financial-os:example:v1' +
          '\\u0000`\n' +
          'export const CONTROLS = /[' +
          '\\u0000-\\u001f\\u007f]/\n',
      },
      {
        path: 'domain/analysis/example.ts',
        what: 'tabs, which are ordinary whitespace rather than a hidden payload',
        source: 'export const SHAPE = {\n\tid: 1,\n}\n',
      },
      {
        path: 'domain/analysis/example.ts',
        what: 'the em-dashes, curly quotes and accents the prose actually uses',
        source:
          '/* The firm\u2019s position \u2014 recorded once. Sm\u00e5f\u00f6retag too. */\n' +
          'export const NOTE = 1\n',
      },
      {
        path: 'domain/analysis/example.ts',
        what: 'an astral character, which is visible and four bytes wide',
        source: "export const CLEF = '\u{1d11e}'\n",
      },
    ],
  },
  {
    ruleId: 'no-locale-sensitive-identity-ordering',
    violations: [
      {
        path: 'application/analysis/commands/plantedCommand.ts',
        what: 'localeCompare ordering a collection inside an identity payload',
        source:
          'export const definition = {\n' +
          '  payload: (input: { ids: string[] }) => ({\n' +
          '    ids: [...input.ids].sort((a, b) => a.localeCompare(b)),\n' +
          '  }),\n' +
          '}\n',
      },
      {
        path: 'domain/shared/canonicalValue.ts',
        what: 'Intl.Collator inside the canonicalization itself',
        source:
          'const collator = new Intl.Collator()\n' +
          'export const order = (a: string, b: string) => collator.compare(a, b)\n',
      },
      {
        path: 'domain/analysis/evidence.ts',
        what: 'localeCompare ordering evidence before it is hashed',
        source:
          'export function build(items: { id: string }[]) {\n' +
          '  return [...items].sort((a, b) => a.id.localeCompare(b.id))\n' +
          '}\n',
      },
      {
        path: 'application/analysis/writeOnce.ts',
        what: 'a bare sort deciding the order of a semantic key',
        source:
          'export function key(values: readonly string[]) {\n' +
          "  return [...values].sort().join('|')\n" +
          '}\n',
      },
    ],
    nearMisses: [
      {
        path: 'application/analysis/writeOnce.ts',
        what: 'the approved format-specific comparator, named rather than defaulted',
        source:
          "import { utf8ByteOrder } from '~/domain/shared/canonicalValue'\n" +
          'export function key(values: readonly string[]) {\n' +
          "  return [...values].sort(utf8ByteOrder).join('|')\n" +
          '}\n',
      },
      {
        path: 'domain/analysis/identity.ts',
        what: 'a comment mentioning localeCompare, which is prose and not a call',
        source:
          '/* Never localeCompare: it reads the host default and two machines\n' +
          ' * would derive different ids. Intl.Collator is out for the same reason. */\n' +
          'export const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)\n',
      },
      {
        path: 'domain/analysis/aggregation.ts',
        what: 'a numeric comparator, which has no locale to be sensitive to',
        source:
          'export function bySequence(rows: readonly { seq: number }[]) {\n' +
          '  return [...rows].sort((a, b) => a.seq - b.seq)\n' +
          '}\n',
      },
    ],
  },

  /* ------------------------------- challenge-threshold-only-in-the-gate */
  {
    ruleId: 'challenge-threshold-only-in-the-gate',
    violations: [
      {
        path: 'application/analysis/submissionProjection.ts',
        what: 'a projection deciding for itself which challenges block',
        source:
          'export function blocking(open: readonly { materiality: string }[]) {\n' +
          "  return open.filter((c) => c.materiality !== 'non-material')\n" +
          '}\n',
      },
      {
        path: 'infrastructure/analysis/postgres/submissionRepositories.ts',
        what: 'an adapter reconstructing the threshold on read',
        source:
          'export function severe(row: { materiality: string }) {\n' +
          "  return row.materiality === 'decision-critical'\n" +
          '}\n',
      },
    ],
    nearMisses: [
      {
        path: 'application/analysis/assembleEligibilityBasis.ts',
        what: 'carrying the materiality through without judging it',
        source:
          'export function carry(cs: readonly { id: string; materiality: string }[]) {\n' +
          '  return cs.map((c) => ({ challengeId: c.id, materiality: c.materiality }))\n' +
          '}\n',
      },
      {
        path: 'infrastructure/analysis/postgres/decisionMapping.ts',
        what: 'refusing an UNKNOWN materiality, which is validation and not a threshold',
        source:
          "const KNOWN = ['non-material', 'material', 'decision-critical']\n" +
          'export function read(value: string) {\n' +
          '  if (!KNOWN.includes(value)) throw new Error("malformed row")\n' +
          '  return value\n' +
          '}\n',
      },
      {
        path: 'application/analysis/notes.ts',
        what: "prose naming 'non-material', which is a comment and not a comparison",
        source:
          '/* A non-material open challenge does not block: the gate applies\n' +
          ' * challengeBlocksAtOrAbove, and nothing here restates it. */\n' +
          'export const note = 1\n',
      },
    ],
  },
]
