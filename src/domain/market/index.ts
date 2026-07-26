/**
 * Public surface of the market domain.
 *
 * Application, infrastructure and presentation import from here. Nothing in
 * this barrel performs I/O, reads the environment, touches React, or formats
 * for a locale — that is what the import-graph test in `src/test/` enforces.
 */

export * from './primitives'
export * from './provenance'
export * from './instruments'
export * from './symbols'
export * from './observations'
export * from './rates'
export * from './search'
export * from './news'
export * from './sentiment'
export * from './events'
