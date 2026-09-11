/**
 * The securities the firm can hold an institutional opinion about.
 *
 * A registry, for the reason `SELECTION_RULES` and `COMPILED_PLAYBOOKS` are
 * registries: "the securities we govern" and "whatever a caller happened to
 * type" are otherwise two lists that agree until they do not.
 *
 * ## Why a slug is not an identity
 *
 * `deriveSubjectRef` turns what the Chairman typed into a slug, which is
 * adequate for a macro subject nothing joins on. It is not adequate here.
 * "Nvidia", "NVIDIA Corp" and "NVDA" slug to three different strings, and
 * nothing would reconcile them — so one provider's prices and another's
 * fundamentals could describe the same company and the firm could not prove it.
 *
 * The `SecurityId` is what makes that provable. It is minted once, recorded
 * here, and **never derived from anything that can change**. A ticker can be
 * reassigned, a company can rename, a listing can move venue; the id does not
 * move with them. It is readable for the sake of anyone reading a database row,
 * and that readability is a convenience of the initial value, never a rule a
 * reader may rely on: `sec-nvda` does not MEAN the symbol is NVDA.
 *
 * ## The id is the observation subject
 *
 * Every governed observation about a security carries the `SecurityId` as its
 * `subject`. That is the whole join: two providers, two `sourceId`s, two
 * observation kinds, one subject — and therefore one provably identical
 * security. Storing a symbol there instead would make the join depend on a
 * mutable attribute of the thing being identified.
 *
 * ## Deliberately not a security master
 *
 * No issuer entity, no ISIN, no FIGI, no share classes, no corporate actions,
 * no holdings. None is required to assess one listed US large-cap, and building
 * them now would be inventing structure ahead of an institutional need for it.
 * Where a future case needs an issuer separate from its listing, this is the
 * place that gains the field.
 */

/** Minted once, recorded here, never derived from a mutable attribute. */
export type SecurityId = string

export interface GovernedSecurity {
  id: SecurityId
  /** Only equities are governed today. The union is the honest boundary. */
  kind: 'equity'
  /** As the venue lists it. May change; the id may not. */
  symbol: string
  /** ISO 10383 market identifier code for the listing venue. */
  mic: string
  /** ISO 4217. A valuation mixing a USD price with SEK revenue is wrong. */
  currency: string
  displayName: string
  /**
   * What each provider calls this security.
   *
   * The map is the reason an adapter never guesses: an ingestion for a source
   * with no entry here cannot name a symbol, so it cannot silently fetch the
   * wrong listing. Keyed by the provider's own `sourceId`.
   */
  providerIds: Readonly<Record<string, string>>
}

/**
 * The governed securities.
 *
 * One, deliberately. Equity v1 exists to prove a second institutional family,
 * not to onboard a universe, and a registry with one correct entry is a
 * stronger claim than a hundred unverified ones.
 */
export const GOVERNED_SECURITIES: readonly GovernedSecurity[] = Object.freeze([
  Object.freeze({
    id: 'sec-nvda',
    kind: 'equity' as const,
    symbol: 'NVDA',
    mic: 'XNAS',
    currency: 'USD',
    displayName: 'NVIDIA Corporation',
    providerIds: Object.freeze({ yahoo: 'NVDA' }),
  }),
])

export class UnknownSecurityError extends Error {
  constructor(readonly securityId: string) {
    super(
      `"${securityId}" is not a governed security. Evidence and claims may ` +
        `only concern securities the firm has admitted to its registry.`,
    )
    this.name = 'UnknownSecurityError'
  }
}

export class NoProviderIdentifierError extends Error {
  constructor(
    readonly securityId: string,
    readonly sourceId: string,
  ) {
    super(
      `Security "${securityId}" has no identifier for source "${sourceId}". ` +
        `An adapter must never guess a symbol: guessing is how a firm ends up ` +
        `holding evidence about the wrong listing.`,
    )
    this.name = 'NoProviderIdentifierError'
  }
}

export function findSecurity(securityId: string): GovernedSecurity | undefined {
  return GOVERNED_SECURITIES.find((security) => security.id === securityId)
}

export function requireSecurity(securityId: string): GovernedSecurity {
  const security = findSecurity(securityId)
  if (!security) throw new UnknownSecurityError(securityId)
  return security
}

/**
 * What a given source calls a governed security.
 *
 * Loud on absence rather than falling back to the symbol. A fallback would work
 * for NVDA and quietly fetch the wrong instrument for the first security whose
 * venue symbol differs from its provider ticker.
 */
export function providerSymbol(security: GovernedSecurity, sourceId: string): string {
  const symbol = security.providerIds[sourceId]
  if (!symbol) throw new NoProviderIdentifierError(security.id, sourceId)
  return symbol
}
