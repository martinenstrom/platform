/**
 * Contribution providers.
 *
 * Three: a **recorded** provider replaying immutable fixtures, a **stub**
 * producing controlled outcomes, and — since the C2 gate ruled determinism,
 * cost, caching and provenance — a **live** provider that calls a model.
 *
 * None of them may bypass claim validation, evidence resolution, the command
 * ledger, assignment state, governance gates or execution provenance. All
 * three enter through the same `ContributionProvider` port, and their output is
 * written by the same command. That is the rule that made the live one cheap:
 * it is a third implementation of an interface, not new machinery.
 *
 * The model client stays behind the live provider. `llm-client-confined-to-
 * provider` asserts nothing outside this directory imports it, and there is no
 * SDK to leak — which makes the property easier to hold, not harder.
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

export {
  LIVE_PROVIDER_ID,
  createLiveContributionProvider,
  LiveProviderFailure,
  type LiveProviderConfig,
} from './live'
