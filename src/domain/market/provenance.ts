/**
 * Re-export of the shared domain kernel.
 *
 * The provenance and primitive types are not market-specific — they describe
 * where a number came from and what kind of number it is, which `domain/policy`
 * needs in exactly the same terms. They live in `domain/shared` so the two
 * domains can share them WITHOUT importing each other, which is the property
 * the import-graph test enforces: a government yield and a policy rate must
 * never be substitutable, and neither module may reach into the other.
 *
 * This file exists so every existing `~/domain/market` import keeps working.
 */

export * from '~/domain/shared/provenance'
