/**
 * The Boardroom projection, and the chronology it refuses to invent.
 *
 * Two failures this is built against.
 *
 * **False chronology.** The record establishes an order only where two acts
 * carry different instants. Where they share one, a projection that sorted by
 * kind or by id would draw an arrow the firm never wrote — and a reader would
 * conclude that Rates answered Macro, or that governance ran after synthesis,
 * on no evidence at all.
 *
 * **Absence read as agreement.** An examination that raised nothing is a desk
 * that looked. It is not endorsement, and the projection must carry the
 * difference rather than flatten it into a blank.
 */

import { describe, expect, it } from 'vitest'
import { boardroomTimeline } from './boardroomTimeline'
import type { CaseOverview } from './caseOverview'

const AT_1 = '2026-07-30T09:00:00.000Z'
const AT_2 = '2026-07-30T10:00:00.000Z'
const AT_3 = '2026-07-30T11:00:00.000Z'

/** Only the fields the projection reads. The rest of a case is not its concern. */
const overviewOf = (over: Partial<CaseOverview> = {}): CaseOverview =>
  ({
    runs: [],
    claims: [],
    aggregations: [],
    peerExaminations: [],
    verification: [],
    devilsAdvocate: [],
    risk: [],
    submissions: [],
    decisionHistory: [],
    ...over,
  }) as unknown as CaseOverview

const run = (id: string, departmentId: string, at: string) => ({
  id,
  departmentId,
  state: 'completed',
  startedAt: at,
  completedAt: at,
  claims: [{ id: `${id}-claim` }],
})

const examination = (over: Record<string, unknown> = {}) => ({
  reviewId: 'rvw-peer-1',
  scope: 'thesis-revision',
  revisionId: 'rev-1',
  byDepartmentId: 'rates',
  examinedDepartmentId: 'global-macro',
  at: AT_2,
  challenges: [],
  outcomes: {},
  ...over,
})

const objection = (over: Record<string, unknown> = {}) => ({
  id: 'chl-1',
  contests: 'clm-macro-1',
  argument: 'The growth attribution assumes the real-rate component was unchanged.',
  materiality: 'material',
  counterEvidence: [],
  ...over,
})

/* ================================================ chronology, and its limit */

describe('the record’s own order, and nothing beyond it', () => {
  it('places acts with different instants in sequence', () => {
    const timeline = boardroomTimeline(
      overviewOf({
        runs: [
          run('run-macro', 'global-macro', AT_1),
          run('run-rates', 'rates', AT_2),
        ] as never,
      }),
    )
    expect(timeline.moments.map((moment) => moment.at)).toEqual([AT_1, AT_2])
    expect(timeline.moments.every((moment) => moment.concurrent === false)).toBe(true)
  })

  it('does not order two acts the record placed at one instant', () => {
    /*
     * THE regression. Two desks recorded at the same instant differ in kind and
     * in id, and neither difference is evidence about which came first. They
     * belong to one moment, and that moment says so.
     */
    const timeline = boardroomTimeline(
      overviewOf({
        runs: [
          run('run-zzz-macro', 'global-macro', AT_1),
          run('run-aaa-rates', 'rates', AT_1),
        ] as never,
      }),
    )

    expect(timeline.moments).toHaveLength(1)
    expect(timeline.moments[0]!.concurrent).toBe(true)
    expect(timeline.moments[0]!.entries).toHaveLength(2)
  })

  it('does not let a difference in KIND manufacture an order', () => {
    /*
     * A synthesis recorded at the same instant as an analysis does not follow
     * it merely because synthesis usually follows analysis. If this ever splits
     * into two moments, some rank has been reintroduced.
     */
    const timeline = boardroomTimeline(
      overviewOf({
        runs: [run('run-macro', 'global-macro', AT_1)] as never,
        aggregations: [
          {
            id: 'agg-1',
            aggregatedAt: AT_1,
            departmentId: 'research-office',
            producedRevisionId: 'rev-1',
          },
        ] as never,
      }),
    )

    expect(timeline.moments).toHaveLength(1)
    expect(timeline.moments[0]!.concurrent).toBe(true)
    expect(timeline.moments[0]!.entries.map((e) => e.kind).sort()).toEqual([
      'analysis-recorded',
      'synthesis-produced',
    ])
  })

  it('orders within a same-time group only for stability', () => {
    /*
     * Deterministic across renders, and meaningless. Asserted so the guarantee
     * is explicit — a presentation layer may rely on it not shuffling, and may
     * not read it as sequence.
     */
    const build = () =>
      boardroomTimeline(
        overviewOf({
          runs: [
            run('run-b', 'rates', AT_1),
            run('run-a', 'global-macro', AT_1),
          ] as never,
        }),
      )
    expect(build().entries.map((e) => e.id)).toEqual(build().entries.map((e) => e.id))
  })

  it('never promotes a per-kind sequence into a global order', () => {
    /*
     * A verification's sequence 1 and a risk review's sequence 1 count
     * different things: sequences are allocated per (case, revision, kind).
     * Both arrive at one instant here, and both must stay in one moment.
     */
    const timeline = boardroomTimeline(
      overviewOf({
        verification: [
          {
            reviewId: 'rvw-v',
            scope: 'thesis-revision',
            revisionId: 'rev-1',
            byDepartmentId: 'verification',
            at: AT_2,
            sequence: 1,
            status: 'verified',
          },
        ] as never,
        risk: [
          {
            reviewId: 'rvw-r',
            scope: 'thesis-revision',
            revisionId: 'rev-1',
            byDepartmentId: 'risk',
            at: AT_2,
            sequence: 1,
            status: 'accepted',
          },
        ] as never,
      }),
    )
    expect(timeline.moments).toHaveLength(1)
    expect(timeline.moments[0]!.concurrent).toBe(true)
  })
})

/* ===================================================== what an entry carries */

describe('every entry resolves to a persisted act', () => {
  it('carries the run id and the claims it produced', () => {
    const timeline = boardroomTimeline(
      overviewOf({ runs: [run('run-macro', 'global-macro', AT_1)] as never }),
    )
    expect(timeline.entries[0]).toMatchObject({
      id: 'run-macro',
      kind: 'analysis-recorded',
      lane: 'analysis',
      byDepartmentId: 'global-macro',
      claimIds: ['run-macro-claim'],
    })
  })

  it('leaves unaccepted work off the debate entirely', () => {
    /*
     * A run awaiting a person's acceptance has produced nothing institutional.
     * Showing it would put a position on the floor that the firm has not
     * adopted.
     */
    const timeline = boardroomTimeline(
      overviewOf({
        runs: [
          { ...run('run-pending', 'rates', AT_1), state: 'awaiting-acceptance' },
        ] as never,
      }),
    )
    expect(timeline.entries).toEqual([])
  })

  it('separates analytical desks from control functions by lane', () => {
    const timeline = boardroomTimeline(
      overviewOf({
        runs: [run('run-macro', 'global-macro', AT_1)] as never,
        peerExaminations: [examination()] as never,
        devilsAdvocate: [
          {
            reviewId: 'rvw-da',
            scope: 'thesis-revision',
            revisionId: 'rev-1',
            byDepartmentId: 'devils-advocate',
            at: AT_3,
            challenges: [],
            outcomes: {},
          },
        ] as never,
      }),
    )
    const lanes = Object.fromEntries(timeline.entries.map((e) => [e.id, e.lane]))
    /* A peer is an analytical voice; the Devil's Advocate is not. */
    expect(lanes['rvw-peer-1']).toBe('analysis')
    expect(lanes['rvw-da']).toBe('governance')
  })
})

/* ============================================== objections, and their absence */

describe('an examination reports what it found, not what it implies', () => {
  it('records a zero-challenge examination as an empty list, not a missing one', () => {
    const timeline = boardroomTimeline(
      overviewOf({ peerExaminations: [examination()] as never }),
    )
    const entry = timeline.entries[0]!
    /* Present and empty — a desk that looked and raised nothing. */
    expect(entry.objections).toEqual([])
    expect(entry.examinedDepartmentId).toBe('global-macro')
  })

  it('carries an objection’s claim, materiality and outcome unchanged', () => {
    const timeline = boardroomTimeline(
      overviewOf({
        peerExaminations: [
          examination({ challenges: [objection()], outcomes: { 'chl-1': 'open' } }),
        ] as never,
      }),
    )
    expect(timeline.entries[0]!.objections).toEqual([
      {
        challengeId: 'chl-1',
        contests: 'clm-macro-1',
        argument: 'The growth attribution assumes the real-rate component was unchanged.',
        materiality: 'material',
        outcome: 'open',
        counterEvidenceCount: 0,
      },
    ])
  })

  it('keeps a settled objection visible, with who settled it', () => {
    /*
     * Settled is not withdrawn. The objection, its materiality and the person
     * accountable for answering it all survive — otherwise the record would
     * read as though Rates had always agreed.
     */
    const timeline = boardroomTimeline(
      overviewOf({
        peerExaminations: [
          examination({
            reviewId: 'rvw-peer-2',
            at: AT_3,
            supersedesReviewId: 'rvw-peer-1',
            challenges: [objection({ resolvedBy: 'research-director' })],
            outcomes: { 'chl-1': 'resolved' },
          }),
        ] as never,
      }),
    )
    const entry = timeline.entries[0]!
    expect(entry.supersedesReviewId).toBe('rvw-peer-1')
    expect(entry.objections![0]).toMatchObject({
      outcome: 'resolved',
      resolvedBy: 'research-director',
      materiality: 'material',
    })
  })

  it('marks the superseded examination from what the reviews record', () => {
    /*
     * Read from the successor's own `supersedesReviewId`, never decided by
     * ranking the two. Both remain on the timeline: the objection and its
     * settlement are two acts, and the history keeps both.
     */
    const timeline = boardroomTimeline(
      overviewOf({
        peerExaminations: [
          examination({ challenges: [objection()], outcomes: { 'chl-1': 'open' } }),
          examination({
            reviewId: 'rvw-peer-2',
            at: AT_3,
            supersedesReviewId: 'rvw-peer-1',
            challenges: [objection({ resolvedBy: 'research-director' })],
            outcomes: { 'chl-1': 'resolved' },
          }),
        ] as never,
      }),
    )
    const first = timeline.entries.find((e) => e.id === 'rvw-peer-1')!
    const second = timeline.entries.find((e) => e.id === 'rvw-peer-2')!
    expect(first.superseded).toBe(true)
    expect(second.superseded).toBeUndefined()
    expect(timeline.entries).toHaveLength(2)
  })
})
