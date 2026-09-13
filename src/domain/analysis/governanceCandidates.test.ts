/**
 * The governance candidate contracts, frozen.
 *
 * Three acts, three identities, three sets of invariants. What these tests
 * defend is the property the whole boundary rests on: a candidate's identity
 * binds the institutional basis it was produced against, so scrutiny of one
 * revision cannot be filed against another merely because its prose still reads
 * plausibly.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import {
  buildDevilsAdvocateCandidate,
  buildPeerExaminationCandidate,
  buildVerificationCandidate,
  candidateStaleness,
  canonicalDevilsAdvocateCandidateInput,
  canonicalPeerExaminationCandidateInput,
  canonicalVerificationCandidateInput,
  devilsAdvocateCandidateContentHash,
  devilsAdvocateCandidateHashMatches,
  GOVERNANCE_CANDIDATE_FIELD_DISPOSITION,
  peerExaminationCandidateContentHash,
  peerExaminationCandidateHashMatches,
  verificationCandidateContentHash,
  verificationCandidateHashMatches,
  type GovernanceCandidateBasis,
  type PeerExaminationCandidateBasis,
  type ProposedChallenge,
} from './governanceCandidates'
import type { VerificationFinding } from './review'

/* ------------------------------------------------------------- fixtures */

const RUN = 'run-1'
const PRODUCED_AT = '2026-09-12T09:00:00.000Z'

const basis = (
  over: Partial<GovernanceCandidateBasis> = {},
): GovernanceCandidateBasis => ({
  caseId: 'case-1',
  thesisId: 'thesis-1',
  sourceRevisionId: 'rev-2',
  playbookId: 'macro-regime',
  playbookVersion: '6',
  playbookEntryKey: 'verification',
  observedClaimIds: ['clm-b', 'clm-a'],
  ...over,
})

const peerBasis = (
  over: Partial<PeerExaminationCandidateBasis> = {},
): PeerExaminationCandidateBasis => ({
  ...basis({ playbookEntryKey: 'peer-examination' }),
  examinedDepartmentId: 'research-office',
  ...over,
})

const finding = (over: Partial<VerificationFinding> = {}): VerificationFinding => ({
  kind: 'value-mismatch',
  claimId: 'clm-a',
  detail: 'The claim reads 2.41; the observation reads 2.14.',
  blocking: false,
  severity: 'material',
  ...over,
})

const challenge = (over: Partial<ProposedChallenge> = {}): ProposedChallenge => ({
  contests: 'clm-a',
  kind: 'fragile-assumption',
  argument: 'The term-premium split rests on a decomposition nobody supplied.',
  counterEvidence: [],
  wouldBeResolvedBy: 'A published term-premium decomposition for the window.',
  materiality: 'material',
  ...over,
})

const verification = () =>
  buildVerificationCandidate({
    runId: RUN,
    artifact: {
      status: 'verified-with-qualifications',
      findings: [finding()],
      claimsReviewed: ['clm-a', 'clm-b'],
    },
    basis: basis(),
    producedAt: PRODUCED_AT,
  })

/* ------------------------------------------------------- frozen encodings */

describe('the encodings are frozen', () => {
  /*
   * Golden vectors, written out in full. If one of these lines has to change,
   * the canonicalization version has to change with it — a candidate stored
   * under v1 must still hash to what it said it did.
   */
  it('renders a verification candidate exactly', () => {
    expect(
      canonicalVerificationCandidateInput(
        RUN,
        { status: 'verified', findings: [], claimsReviewed: ['clm-a'] },
        basis({ observedClaimIds: ['clm-a'] }),
      ),
    ).toBe(
      'i1' +
        's5:run-1' +
        's6:case-1' +
        's8:thesis-1' +
        's5:rev-2' +
        's12:macro-regime' +
        's1:6' +
        's12:verification' +
        'l1:s5:clm-a' +
        's8:verified' +
        'l1:s5:clm-a' +
        'l0:',
    )
  })

  it("renders a devil's advocate candidate exactly", () => {
    expect(
      canonicalDevilsAdvocateCandidateInput(
        RUN,
        {
          challenges: [
            {
              contests: 'clm-a',
              kind: 'overconfidence',
              argument: 'Stated with more certainty than the evidence carries.',
              counterEvidence: [],
              wouldBeResolvedBy: 'A confidence interval on the decomposition.',
              materiality: 'material',
            },
          ],
        },
        basis({ playbookEntryKey: 'challenge', observedClaimIds: ['clm-a'] }),
      ),
    ).toBe(
      'i1' +
        's5:run-1' +
        's6:case-1' +
        's8:thesis-1' +
        's5:rev-2' +
        's12:macro-regime' +
        's1:6' +
        's9:challenge' +
        'l1:s5:clm-a' +
        'l1:' +
        'l7:' +
        's5:clm-a' +
        'a' +
        's14:overconfidence' +
        's53:Stated with more certainty than the evidence carries.' +
        'l0:' +
        's43:A confidence interval on the decomposition.' +
        's8:material',
    )
  })

  it('renders a peer examination candidate exactly, including who was examined', () => {
    expect(
      canonicalPeerExaminationCandidateInput(
        RUN,
        { challenges: [] },
        peerBasis({ observedClaimIds: ['clm-a'] }),
      ),
    ).toBe(
      'i1' +
        's5:run-1' +
        's6:case-1' +
        's8:thesis-1' +
        's5:rev-2' +
        's12:macro-regime' +
        's1:6' +
        's16:peer-examination' +
        'l1:s5:clm-a' +
        's15:research-office' +
        'l0:',
    )
  })

  it('pins the digests', () => {
    const candidate = verification()
    expect(candidate.contentHash).toMatch(/^[0-9a-f]{64}$/)
    expect(
      verificationCandidateContentHash(RUN, candidate.artifact, candidate.basis),
    ).toBe(candidate.contentHash)
  })
})

describe('each act has its own identity', () => {
  /*
   * The property the domain separation exists for. A peer examination and a
   * Devil's Advocate filing can carry identical objections and are not the same
   * control act; without separate domains they would be the same candidate.
   */
  it('gives identical objections different identities per act', () => {
    const shared = basis({ observedClaimIds: ['clm-a'] })
    const artifact = { challenges: [challenge()] }
    expect(devilsAdvocateCandidateContentHash(RUN, artifact, shared)).not.toBe(
      peerExaminationCandidateContentHash(RUN, artifact, {
        ...shared,
        examinedDepartmentId: 'research-office',
      }),
    )
  })

  it('separates every digest from the raw canonical bytes', () => {
    const candidate = verification()
    expect(candidate.contentHash).not.toBe(
      canonicalVerificationCandidateInput(RUN, candidate.artifact, candidate.basis),
    )
  })
})

describe('ordering is not identity', () => {
  it('hashes a verdict identically however the producer ordered it', () => {
    const left = buildVerificationCandidate({
      runId: RUN,
      artifact: {
        status: 'verified',
        findings: [finding({ claimId: 'clm-a' }), finding({ claimId: 'clm-b' })],
        claimsReviewed: ['clm-a', 'clm-b'],
      },
      basis: basis(),
      producedAt: PRODUCED_AT,
    })
    const right = buildVerificationCandidate({
      runId: RUN,
      artifact: {
        status: 'verified',
        findings: [finding({ claimId: 'clm-b' }), finding({ claimId: 'clm-a' })],
        claimsReviewed: ['clm-b', 'clm-a'],
      },
      basis: basis({ observedClaimIds: ['clm-a', 'clm-b'] }),
      producedAt: PRODUCED_AT,
    })
    expect(left.contentHash).toBe(right.contentHash)
  })

  it('hashes objections identically however the producer ordered them', () => {
    const shared = basis({
      playbookEntryKey: 'challenge',
      observedClaimIds: ['clm-a', 'clm-b'],
    })
    const one = challenge({ contests: 'clm-a' })
    const two = challenge({ contests: 'clm-b' })
    expect(
      buildDevilsAdvocateCandidate({
        runId: RUN,
        artifact: { challenges: [one, two] },
        basis: shared,
        producedAt: PRODUCED_AT,
      }).contentHash,
    ).toBe(
      buildDevilsAdvocateCandidate({
        runId: RUN,
        artifact: { challenges: [two, one] },
        basis: shared,
        producedAt: PRODUCED_AT,
      }).contentHash,
    )
  })
})

describe('the institutional basis is part of the identity', () => {
  const same = {
    status: 'verified' as const,
    findings: [],
    claimsReviewed: ['clm-a'],
  }
  const one = basis({ observedClaimIds: ['clm-a'] })

  it('distinguishes an identical verdict on a different revision', () => {
    expect(verificationCandidateContentHash(RUN, same, one)).not.toBe(
      verificationCandidateContentHash(
        RUN,
        same,
        basis({ observedClaimIds: ['clm-a'], sourceRevisionId: 'rev-3' }),
      ),
    )
  })

  it('distinguishes an identical verdict over a different claim universe', () => {
    expect(verificationCandidateContentHash(RUN, same, one)).not.toBe(
      verificationCandidateContentHash(
        RUN,
        same,
        basis({ observedClaimIds: ['clm-a', 'clm-b'] }),
      ),
    )
  })

  it('distinguishes an identical verdict under a different playbook version', () => {
    expect(verificationCandidateContentHash(RUN, same, one)).not.toBe(
      verificationCandidateContentHash(
        RUN,
        same,
        basis({ observedClaimIds: ['clm-a'], playbookVersion: '7' }),
      ),
    )
  })

  it('distinguishes candidates produced by different runs', () => {
    expect(verificationCandidateContentHash(RUN, same, one)).not.toBe(
      verificationCandidateContentHash('run-2', same, one),
    )
  })

  it('distinguishes a peer examination of a different desk', () => {
    const artifact = { challenges: [] }
    expect(
      peerExaminationCandidateContentHash(
        RUN,
        artifact,
        peerBasis({ observedClaimIds: ['clm-a'] }),
      ),
    ).not.toBe(
      peerExaminationCandidateContentHash(
        RUN,
        artifact,
        peerBasis({ observedClaimIds: ['clm-a'], examinedDepartmentId: 'rates' }),
      ),
    )
  })
})

describe('production time is deliberately not part of the identity', () => {
  it('gives the same candidate the same hash whenever it was produced', () => {
    const shared = {
      runId: RUN,
      artifact: {
        status: 'verified' as const,
        findings: [],
        claimsReviewed: ['clm-a'],
      },
      basis: basis({ observedClaimIds: ['clm-a'] }),
    }
    expect(
      buildVerificationCandidate({ ...shared, producedAt: PRODUCED_AT }).contentHash,
    ).toBe(
      buildVerificationCandidate({
        ...shared,
        producedAt: '2027-01-01T00:00:00.000Z',
      }).contentHash,
    )
  })
})

/* ------------------------------------------------------------- invariants */

describe("the Devil's Advocate must object", () => {
  it('refuses a filing with no objections', () => {
    expect(() =>
      buildDevilsAdvocateCandidate({
        runId: RUN,
        artifact: { challenges: [] },
        basis: basis({ playbookEntryKey: 'challenge' }),
        producedAt: PRODUCED_AT,
      }),
    ).toThrow(/must object/)
  })
})

describe('a peer may examine and object to nothing', () => {
  it('accepts an examination with no objections', () => {
    const candidate = buildPeerExaminationCandidate({
      runId: RUN,
      artifact: { challenges: [] },
      basis: peerBasis(),
      producedAt: PRODUCED_AT,
    })
    expect(candidate.artifact.challenges).toEqual([])
    expect(peerExaminationCandidateHashMatches(candidate)).toBe(true)
  })

  it('names the desk it examined', () => {
    expect(() =>
      buildPeerExaminationCandidate({
        runId: RUN,
        artifact: { challenges: [] },
        basis: peerBasis({ examinedDepartmentId: '  ' }),
        producedAt: PRODUCED_AT,
      }),
    ).toThrow(/examined department/)
  })
})

describe('scrutiny stays inside the basis it declared', () => {
  it('refuses a verdict reviewing a claim outside the observed set', () => {
    expect(() =>
      buildVerificationCandidate({
        runId: RUN,
        artifact: { status: 'verified', findings: [], claimsReviewed: ['clm-z'] },
        basis: basis({ observedClaimIds: ['clm-a'] }),
        producedAt: PRODUCED_AT,
      }),
    ).toThrow(/not in the claim set/)
  })

  it('refuses a finding on a claim the verdict did not review', () => {
    expect(() =>
      buildVerificationCandidate({
        runId: RUN,
        artifact: {
          status: 'verified',
          findings: [finding({ claimId: 'clm-b' })],
          claimsReviewed: ['clm-a'],
        },
        basis: basis(),
        producedAt: PRODUCED_AT,
      }),
    ).toThrow(/without listing it as reviewed/)
  })

  it('refuses a verdict that reviewed nothing', () => {
    expect(() =>
      buildVerificationCandidate({
        runId: RUN,
        artifact: { status: 'verified', findings: [], claimsReviewed: [] },
        basis: basis(),
        producedAt: PRODUCED_AT,
      }),
    ).toThrow(/reviews no claims/)
  })

  it('refuses an objection to a claim outside the observed set', () => {
    expect(() =>
      buildDevilsAdvocateCandidate({
        runId: RUN,
        artifact: { challenges: [challenge({ contests: 'clm-z' })] },
        basis: basis({ playbookEntryKey: 'challenge' }),
        producedAt: PRODUCED_AT,
      }),
    ).toThrow(/not in the claim set/)
  })

  it("refuses an objection to another lineage's thesis", () => {
    expect(() =>
      buildDevilsAdvocateCandidate({
        runId: RUN,
        artifact: { challenges: [challenge({ contestsThesis: 'thesis-9' })] },
        basis: basis({ playbookEntryKey: 'challenge' }),
        producedAt: PRODUCED_AT,
      }),
    ).toThrow(/not the lineage/)
  })
})

describe('the institutional builders do the arguing', () => {
  /*
   * These refusals are not re-implemented here. `buildVerificationFinding` and
   * `buildChallenge` are the institutional definitions, and a candidate the
   * filing command would reject is refused at production instead of stored.
   */
  it('refuses a blocking finding that states no correction', () => {
    expect(() =>
      buildVerificationCandidate({
        runId: RUN,
        artifact: {
          status: 'correction-required',
          findings: [finding({ blocking: true })],
          claimsReviewed: ['clm-a'],
        },
        basis: basis(),
        producedAt: PRODUCED_AT,
      }),
    ).toThrow(/what would clear it/)
  })

  it('refuses an objection with neither counter-evidence nor a resolution', () => {
    expect(() =>
      buildDevilsAdvocateCandidate({
        runId: RUN,
        artifact: {
          challenges: [challenge({ counterEvidence: [], wouldBeResolvedBy: undefined })],
        },
        basis: basis({ playbookEntryKey: 'challenge' }),
        producedAt: PRODUCED_AT,
      }),
    ).toThrow(/nothing could settle/)
  })
})

describe('the digest attests the candidate it is stored with', () => {
  it('accepts untouched candidates', () => {
    expect(verificationCandidateHashMatches(verification())).toBe(true)
    expect(
      devilsAdvocateCandidateHashMatches(
        buildDevilsAdvocateCandidate({
          runId: RUN,
          artifact: { challenges: [challenge()] },
          basis: basis({ playbookEntryKey: 'challenge' }),
          producedAt: PRODUCED_AT,
        }),
      ),
    ).toBe(true)
  })

  it('notices an edited verdict', () => {
    const candidate = verification()
    expect(
      verificationCandidateHashMatches({
        ...candidate,
        artifact: { ...candidate.artifact, status: 'verified' },
      }),
    ).toBe(false)
  })

  it('notices an edited basis with the verdict untouched', () => {
    const candidate = verification()
    expect(
      verificationCandidateHashMatches({
        ...candidate,
        basis: { ...candidate.basis, sourceRevisionId: 'rev-99' },
      }),
    ).toBe(false)
  })

  it('refuses a candidate claiming a canonicalization this build does not know', () => {
    expect(
      verificationCandidateHashMatches({
        ...verification(),
        canonicalizationVersion: '2',
      }),
    ).toBe(false)
  })
})

/* --------------------------------------------------------- stale detection */

describe('staleness is measured against the record, never against a clock', () => {
  const current = {
    basis: basis({ observedClaimIds: ['clm-a', 'clm-b'] }),
    hashMatches: true,
    knownCanonicalization: true,
    currentRevisionId: 'rev-2',
    currentClaimIds: ['clm-b', 'clm-a'],
  }

  it('passes a candidate whose basis still holds, whatever the order', () => {
    expect(candidateStaleness(current)).toEqual([])
  })

  it('catches a superseded revision', () => {
    expect(candidateStaleness({ ...current, currentRevisionId: 'rev-3' })).toContain(
      'revision-superseded',
    )
  })

  it('catches work accepted since the candidate was produced', () => {
    expect(
      candidateStaleness({ ...current, currentClaimIds: ['clm-a', 'clm-b', 'clm-c'] }),
    ).toContain('claim-set-changed')
  })

  it('catches work withdrawn since the candidate was produced', () => {
    expect(candidateStaleness({ ...current, currentClaimIds: ['clm-a'] })).toContain(
      'claim-set-changed',
    )
  })

  it('catches a digest that does not attest its contents', () => {
    expect(candidateStaleness({ ...current, hashMatches: false })).toContain(
      'content-hash-mismatch',
    )
  })

  it('reports every reason rather than the first', () => {
    expect(
      candidateStaleness({
        ...current,
        hashMatches: false,
        knownCanonicalization: false,
        currentRevisionId: 'rev-3',
        currentClaimIds: [],
      }).length,
    ).toBe(4)
  })
})

/* ------------------------------------------------------- field coverage */

/**
 * Every member of every candidate type is either bound by the digest or has a
 * written reason it is not.
 *
 * Prose cannot notice a field added next year, and a field the digest does not
 * bind is a field an editor can change without the digest objecting.
 */
describe('no field escapes the decision', () => {
  const source = ts.createSourceFile(
    'governanceCandidates.ts',
    readFileSync(
      join(process.cwd(), 'src/domain/analysis/governanceCandidates.ts'),
      'utf8',
    ),
    ts.ScriptTarget.Latest,
    true,
  )

  const membersOf = (interfaceName: string): string[] => {
    let found: ts.InterfaceDeclaration | null = null
    source.forEachChild((node) => {
      if (ts.isInterfaceDeclaration(node) && node.name.text === interfaceName) {
        found = node
      }
    })
    if (found === null) throw new Error(`${interfaceName} not found`)
    return (found as ts.InterfaceDeclaration).members
      .flatMap((member) =>
        ts.isPropertySignature(member) && member.name && ts.isIdentifier(member.name)
          ? [member.name.text]
          : [],
      )
      .sort()
  }

  const cases = [
    ['GovernanceCandidateBasis', GOVERNANCE_CANDIDATE_FIELD_DISPOSITION.basis],
    /* Only its own added member; the rest are inherited and covered above. */
    ['PeerExaminationCandidateBasis', GOVERNANCE_CANDIDATE_FIELD_DISPOSITION.peerBasis],
    [
      'VerificationCandidateArtifact',
      GOVERNANCE_CANDIDATE_FIELD_DISPOSITION.verificationArtifact,
    ],
    [
      'DevilsAdvocateCandidateArtifact',
      GOVERNANCE_CANDIDATE_FIELD_DISPOSITION.devilsAdvocateArtifact,
    ],
    [
      'PeerExaminationCandidateArtifact',
      GOVERNANCE_CANDIDATE_FIELD_DISPOSITION.peerExaminationArtifact,
    ],
    ['ProducedVerificationReview', GOVERNANCE_CANDIDATE_FIELD_DISPOSITION.record],
    ['ProducedDevilsAdvocateReview', GOVERNANCE_CANDIDATE_FIELD_DISPOSITION.record],
    ['ProducedPeerExamination', GOVERNANCE_CANDIDATE_FIELD_DISPOSITION.record],
  ] as const

  for (const [interfaceName, disposition] of cases) {
    it(`${interfaceName} — every member is included or excluded, exactly once`, () => {
      const accounted = [
        ...disposition.included,
        ...Object.keys(disposition.excluded),
      ].sort()
      expect(accounted).toEqual(membersOf(interfaceName))
      expect(new Set(accounted).size).toBe(accounted.length)
    })
  }

  it('checks something rather than an empty surface', () => {
    expect(membersOf('GovernanceCandidateBasis').length).toBeGreaterThan(5)
  })
})
