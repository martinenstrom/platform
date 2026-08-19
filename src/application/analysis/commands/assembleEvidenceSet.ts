/**
 * Declaring a body of evidence fit for analysis.
 *
 * The twentieth institutional act, and the one C3 exists to add. Until now the
 * only production path that could write an `EvidenceSet` was a smoke route with
 * no actor, no mandate, no command, no ledger entry and no recorded selection —
 * while nineteen lesser acts all carried the full envelope. Assembly determines
 * the ceiling on every claim the firm can make from a set: `citeFrom` refuses
 * anything outside it, `composeConfidence` is bounded by its properties, and
 * the C2-2 live run produced five `insufficient-evidence` claims *because of
 * what was in the set*. That is a more consequential act than several of the
 * nineteen, and it now has a name on it.
 *
 * ## It takes a query, never a list of observation ids
 *
 * Load-bearing, and ruled (gate §0.3). An assembler who names individual
 * observations can drop the inconvenient source, and the disagreement machinery
 * — which the set computes from its own membership rather than being told about
 * — would never see it. An assembler who names a family and a window gets
 * whatever the firm holds, disagreements and revisions included.
 *
 * ## What is recorded, and why each part
 *
 * | | answers |
 * |---|---|
 * | membership, in `evidence_items` | what the firm reasoned over |
 * | `rule_id`, versioned | which selection semantics ran |
 * | family and window | what was asked for |
 * | `known_at`, resolved | what the institution knew when it selected |
 * | actor and mandate | who declared it fit, on whose authority |
 *
 * Without the fourth, "latest known" names a moment nobody wrote down and the
 * set cannot be reproduced. Without the second, a reviewer can see what was
 * included and still cannot tell whether anything was left out.
 *
 * ## Derivation runs here
 *
 * Gate §0.5 puts an institutional derivation at assembly time, as a write. The
 * 2s10s spread is computed by `deriveObservations`, recorded into the
 * observation store, and joins the set as a member like any other observation —
 * so every reader reads one stored value and nothing recomputes it. The
 * arithmetic is not restated here; this module decides *when* it runs.
 *
 * ## No transition event
 *
 * `TransitionEvent` requires a `caseId` — it is the case timeline — and an
 * evidence set belongs to the firm rather than to a case, which is why
 * commissioning offers every set the firm holds. Inventing a case to carry an
 * event would fabricate a coordinate the act does not have, the same thing
 * §0.3b refuses about knowledge time. The ledger entry `runCommand` writes for
 * every command, plus the assembly record, are what this act leaves behind.
 */

import {
  buildEvidenceSet,
  selectionPayload,
  type DurableObservation,
  type EvidenceAssembly,
  type EvidenceItem,
  type EvidenceSelection,
  type Organization,
} from '~/domain/analysis'
import { deriveAssemblyId } from './eventIdentity'
import { reject } from './envelope'
import type { CommandDefinition } from './definition'
import { runSelection, selectionIsKnown } from '../evidenceSelection'

export interface AssembleEvidenceSetInput {
  /** The versioned rule and the window. Never a list of observation ids. */
  selection: {
    ruleId: string
    subjectFamily: string
    from: string
    to: string
    /**
     * Assemble as the firm knew it at this instant. Optional at the boundary,
     * **never optional in the record** — see `execute`.
     */
    knownAt?: string
  }
  /**
   * The department whose manager is assembling this.
   *
   * Declared by the caller because the mandate must be decided before anything
   * is read, and checked against the seeded firm by `runCommand` — a caller
   * cannot name a department it does not manage. There is no second scope to
   * cross-check it against, deliberately: a set is not case-scoped, so managing
   * the department IS the whole of the authority claimed.
   */
  onBehalfOfDepartmentId: string
}

export function assembleEvidenceSet(
  organization: Organization,
): CommandDefinition<AssembleEvidenceSetInput, EvidenceAssembly> {
  return {
    type: 'AssembleEvidenceSet',
    /*
     * No case aggregate moves. A set is firm-level and content-addressed, so
     * there is no version to have moved on, and accepting one would offer
     * concurrency protection against nothing.
     */
    versionPolicy: 'refuses-expected-version',
    /*
     * Assembling is ordinary forward motion — it reverses nothing and refuses
     * nobody. The rule, the window and the knowledge time already say why these
     * observations; prose beside them would be prose nobody reads.
     */
    reasonPolicy: 'optional',
    /* It produces evidence, which is what this category names. */
    category: 'analysis',
    /*
     * Declaring what a desk may reason over is a managerial act, the same class
     * as choosing how the firm works a question. A contributor may produce
     * work; setting the ceiling on what the firm can conclude is not that.
     */
    mandate: (input) => ({
      kind: 'department-manager',
      departmentId: input.onBehalfOfDepartmentId,
    }),
    /* Firm-level. There is no case, and naming one would be inventing it. */
    scope: () => ({}),
    payload: (input) => ({
      selection: selectionPayload({
        ruleId: input.selection.ruleId,
        subjectFamily: input.selection.subjectFamily,
        from: input.selection.from,
        to: input.selection.to,
        /*
         * An absent `knownAt` is part of the identity as absent. Substituting
         * the resolved instant here would make two retries of one command hash
         * differently, because the second would carry a moment the first did
         * not name.
         */
        knownAt: input.selection.knownAt ?? '',
      }),
      onBehalfOfDepartmentId: input.onBehalfOfDepartmentId,
    }),

    async execute(repositories, context, input) {
      if (!organization.departments.some((d) => d.id === input.onBehalfOfDepartmentId)) {
        reject('not-found', `Department "${input.onBehalfOfDepartmentId}" does not exist`)
      }

      /*
       * Resolved before anything is read. A set whose rule cannot be resolved
       * is a set nobody can explain, which is the whole reason the rule is
       * stored — so an unknown one is refused rather than run as "whatever the
       * code does today".
       */
      const requested = {
        ruleId: input.selection.ruleId,
        subjectFamily: input.selection.subjectFamily,
        from: input.selection.from,
        to: input.selection.to,
        knownAt: input.selection.knownAt ?? context.occurredAt,
      }
      if (!selectionIsKnown(requested)) {
        reject(
          'not-found',
          `"${requested.ruleId}" / "${requested.subjectFamily}" is not a ` +
            `registered selection rule and family. An evidence set whose ` +
            `selection cannot be resolved is a set nobody can defend.`,
        )
      }

      if (!requested.from.trim() || !requested.to.trim()) {
        reject(
          'invariant-violated',
          `A selection needs a reference-period window. Without one the rule ` +
            `describes no body of evidence at all.`,
        )
      }
      if (requested.from > requested.to) {
        reject(
          'invariant-violated',
          `The window "${requested.from}".."${requested.to}" ends before it ` +
            `starts and can select nothing.`,
        )
      }
      /*
       * The firm cannot have known something before it happened. A `knownAt`
       * after the act would read as institutional knowledge the firm did not
       * hold when it assembled — the class of thing §0.3b refuses.
       */
      if (requested.knownAt > context.occurredAt) {
        reject(
          'invariant-violated',
          `A selection cannot be made as of "${requested.knownAt}", which is ` +
            `after the assembly at "${context.occurredAt}".`,
        )
      }

      const selection: EvidenceSelection = requested

      const outcome = await runSelection(repositories.observations, selection, {
        recordedAt: context.occurredAt,
        correlationId: context.correlationId,
      })

      /*
       * Nothing to assemble is a refusal, not an empty set.
       *
       * An assembled set holding no observations would still be an
       * institutional declaration that a desk may reason over it, and the
       * commission surface already refuses to offer one. Producing it here and
       * refusing it there would put the same judgement in two places, with the
       * later one carrying no actor.
       */
      if (outcome.selected.length === 0) {
        reject(
          'invariant-violated',
          `The firm holds no observations for "${selection.subjectFamily}" in ` +
            `"${selection.from}".."${selection.to}" as known at ` +
            `"${selection.knownAt}". There is no body of evidence to declare.`,
        )
      }

      /*
       * The derivation is written, then read back.
       *
       * `record` reports only what was NEW; a re-assembly of the same window
       * derives the identical fact, which is already held and reports nothing.
       * Reading each one back means the set carries what the store holds rather
       * than what this call happened to construct — one institutional truth for
       * what an observation said, which is the whole of §0.3b.
       */
      await repositories.observations.record(outcome.derived, context.provenance)
      const derived: DurableObservation[] = []
      for (const candidate of outcome.derived) {
        const stored = await repositories.observations.get(
          candidate.ref.id,
          candidate.ref.contentHash,
        )
        if (!stored) {
          reject(
            'invariant-violated',
            `The derived observation "${candidate.ref.id}" did not read back ` +
              `after being recorded. The store and the derivation disagree.`,
          )
        }
        derived.push(stored)
      }

      const items: EvidenceItem[] = [...outcome.selected, ...derived].map(
        (observation) => ({
          ref: observation.ref,
          value: observation.value,
          provenance: observation.provenance,
        }),
      )

      /*
       * The set computes its own disagreements, revisions and co-temporality
       * from its membership. Nothing upstream can suppress one, which is the
       * second of the two mechanisms §0.6 relies on — the first being that this
       * command takes a query rather than a list.
       */
      const set = buildEvidenceSet({
        items,
        assembledAt: context.occurredAt,
        correlationId: context.correlationId,
      })
      const saved = await repositories.evidence.save(set)

      const assembly: EvidenceAssembly = {
        assemblyId: deriveAssemblyId(context.commandId),
        evidenceSetId: saved.id,
        selection,
        selectedSubjects: [...outcome.subjects],
        observationCount: outcome.selected.length,
        derivedCount: derived.length,
        assembledAt: context.occurredAt,
        /*
         * The person, from the resolved actor. `runCommand` looked the employee
         * up against the seeded organization, so this is who the firm says
         * acted rather than who the caller claimed to be.
         */
        actorEmployeeId: context.actor.employeeId ?? '',
        onBehalfOfDepartmentId: input.onBehalfOfDepartmentId,
        correlationId: context.correlationId,
      }
      if (!assembly.actorEmployeeId) {
        reject(
          'not-authorised',
          `Assembly is a judgement and requires a person. A system actor ` +
            `cannot declare a body of evidence fit for analysis.`,
        )
      }

      const recorded = await repositories.assemblies.record(assembly, context.provenance)
      return {
        value: recorded,
        resultKind: 'evidence-assembly',
        resultRef: recorded.assemblyId,
      }
    },

    async rehydrate(repositories, resultRef) {
      const found = await repositories.assemblies.get(resultRef)
      if (!found) {
        throw new Error(
          `Evidence assembly "${resultRef}" was committed by this command but ` +
            `no longer reads back. The ledger and the store disagree.`,
        )
      }
      return found
    },
  }
}
