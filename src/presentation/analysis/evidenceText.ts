/**
 * What the institution's answers to an assembly mean, in Swedish.
 *
 * Presentation only. Every code below is produced by the command or by the
 * boundary; nothing here decides anything, and a code that arrives without a
 * label is shown verbatim rather than translated into a guess.
 */

/**
 * The bounded refusal and failure codes an assembly can come back with.
 *
 * `RejectionCode` and `AnalysisReadFailure` in one map, because a person
 * reading the screen is being told what happened rather than which layer said
 * so. Each string names the rule that fired: a refusal a reader cannot act on
 * is a refusal that will be retried unchanged.
 */
export const ASSEMBLY_REFUSAL_LABEL: Record<string, string> = {
  /* Institutional refusals. */
  'not-authorised':
    'Personen du agerar som leder inte den avdelning du sammanställer för. ' +
    'Att avgöra vad en avdelning får resonera över är en chefshandling.',
  'not-found':
    'Urvalsregeln, familjen eller avdelningen är inte registrerad hos firman. ' +
    'Ett underlag vars urval inte kan slås upp är ett underlag ingen kan försvara.',
  'invariant-violated':
    'Urvalet håller inte: fönstret är tomt eller vänt, tidpunkten ligger i ' +
    'framtiden, eller så håller firman inga observationer för det.',
  'illegal-prior-state': 'Handlingen kan inte utföras i det här läget.',
  'aggregate-conflict': 'Något annat ändrade posten under tiden. Läs om sidan.',
  'payload-conflict':
    'Samma handling har redan bokförts med ett annat innehåll. Två omdömen kan ' +
    'inte bokföras under samma identitet.',
  'unknown-actor': 'Personen är inte anställd hos firman.',

  /* Operational failures. */
  NOT_CONFIGURED: 'Analysmiljön saknar databaskonfiguration.',
  SERVICE_UNAVAILABLE: 'Analysmiljön svarar inte just nu.',
  NOT_FOUND: 'Kunde inte läsas.',
}
