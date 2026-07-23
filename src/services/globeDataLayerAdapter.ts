/**
 * Real-data adapter for the Global Command Center's optional AI Risk /
 * Commodity Exposure / Shipping Activity heatmap layers — intentionally
 * unimplemented, same "throwing stub + suggested outline" shape as
 * `countryExplorerAdapter.ts` and `avanzaMcpAdapter.ts`.
 *
 * These layers ship disabled in `GlobalDataLayersPanel` with an explanatory
 * tooltip rather than a fabricated demo visualization — there is no live
 * data source wired up yet, and inventing a per-country "AI risk" score from
 * nothing would be indistinguishable from real analysis at a glance, which
 * is exactly what this template's mock-data conventions try to avoid.
 */

/** Population density — WorldPop, Gridded Population of the World (GPW), or LandScan. */
export const POPULATION_DENSITY_SOURCES = {
  worldPop: 'https://www.worldpop.org/rest/data',
  gpw: 'https://sedac.ciesin.columbia.edu/data/set/gpw-v4-population-density-rev11',
  landscan: 'https://landscan.ornl.gov',
} as const

/** Economic activity — World Bank/IMF/OECD indicators, or satellite night-light intensity as a proxy. */
export const ECONOMIC_ACTIVITY_SOURCES = {
  worldBank: 'https://api.worldbank.org/v2',
  imf: 'https://www.imf.org/external/datamapper/api',
  oecd: 'https://sdmx.oecd.org',
} as const

/** Weather — OpenWeatherMap, Meteomatics, Tomorrow.io, Meteoblue, NOAA, or ECMWF-compatible providers. */
export const WEATHER_SOURCES = {
  openWeatherMap: 'https://api.openweathermap.org/data/3.0',
  meteomatics: 'https://api.meteomatics.com',
  tomorrowIo: 'https://api.tomorrow.io/v4',
} as const

/** AI risk — no established public index exists; would need a licensed/proprietary geopolitical-AI-risk data provider. */
export const AI_RISK_SOURCES = {
  note: 'No standard public data source identified — would require a licensed geopolitical/AI-risk research provider.',
} as const

/** Commodity exposure — UN Comtrade (trade-by-commodity), World Bank Commodity Markets, or EIA for energy specifically. */
export const COMMODITY_EXPOSURE_SOURCES = {
  unComtrade: 'https://comtradeapi.un.org',
  worldBankCommodities: 'https://www.worldbank.org/en/research/commodity-markets',
  eia: 'https://api.eia.gov',
} as const

/** Shipping activity — MarineTraffic, Spire Maritime, or UNCTAD port-call statistics. */
export const SHIPPING_ACTIVITY_SOURCES = {
  marineTraffic: 'https://services.marinetraffic.com/api',
  spireMaritime: 'https://api.spire.com/maritime',
  unctadPortCalls: 'https://unctadstat.unctad.org/EN/BulkDownload.html',
} as const

/**
 * TODO(global-command-center-data-layers): implement.
 *
 * Suggested outline per layer: fetch a coarse per-country value from one of
 * the sources above, normalize to 0-1, and colour countries on the existing
 * single-hue cyan intensity scale (`GlobalCommandMap.tsx`'s `intensityFill`).
 * Roll layers over one at a time — `GlobalDataLayersPanel` keeps each toggle
 * disabled with a "Kräver datakälla" note until its adapter here actually
 * returns data.
 */
export function createGlobeDataLayerAdapter(): never {
  throw new Error(
    'Datalager-adaptern är inte implementerad ännu. Väder, befolkningstäthet, ekonomisk aktivitet, AI-risk, råvaruexponering och sjöfartsaktivitet förblir inaktiverade i gränssnittet tills dess.',
  )
}
