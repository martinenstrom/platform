/**
 * Contribution providers.
 *
 * Two, and neither is a model: a **recorded** provider replaying immutable
 * fixtures, and a **stub** producing controlled outcomes. A live provider is
 * Phase C2 and is gated on its own approval — a fitness rule asserts that
 * nothing here declares `providerKind: 'live'`, and the import rules keep LLM
 * clients out of the repository entirely.
 *
 * Neither may bypass claim validation, evidence resolution, the command
 * ledger, assignment state, governance gates or execution provenance. They
 * enter through the same `ContributionProvider` port a live provider will, and
 * their output is written by the same command.
 */

export {
  RECORDED_PROVIDER_ID,
  createRecordedContributionProvider,
  keyForRecording,
  recordingId,
  type RecordedContribution,
} from './recorded'

export {
  STUB_PROVIDER_ID,
  createStubContributionProvider,
  type StubOutcome,
} from './stub'
