/**
 * Who a source is, from its address: the authority ladder the brief sets —
 * official first, then direct market data, then the issuer, then
 * government, then reputable financial news, then everything else.
 *
 * The table is reviewed, not learned: a domain not listed is `other` and
 * ranks last, however confident it sounds. An issuer is recognised by its
 * filing host or an investor-relations host, never by its name alone.
 */

import type { AuthorityRank, SourceType } from './evidence'

export interface SourceIdentity {
  sourceType: SourceType
  authority: AuthorityRank
  publisher: string
}

const OFFICIAL: Record<string, string> = {
  'federalreserve.gov': 'Federal Reserve',
  'newyorkfed.org': 'New York Fed',
  'bls.gov': 'BLS',
  'bea.gov': 'BEA',
  'treasury.gov': 'U.S. Treasury',
  'census.gov': 'U.S. Census Bureau',
  'riksbank.se': 'Riksbanken',
  'scb.se': 'SCB',
  'konj.se': 'Konjunkturinstitutet',
  'fi.se': 'Finansinspektionen',
  'ecb.europa.eu': 'ECB',
  'bankofengland.co.uk': 'Bank of England',
  'boj.or.jp': 'Bank of Japan',
  'bundesbank.de': 'Bundesbank',
  'destatis.de': 'Destatis',
  'ons.gov.uk': 'ONS',
  'imf.org': 'IMF',
  'oecd.org': 'OECD',
  'bis.org': 'BIS',
  'ismworld.org': 'ISM',
}

const ISSUER_HOSTS: Record<string, string> = {
  'sec.gov': 'SEC EDGAR',
}

const GOVERNMENT: Record<string, string> = {
  'regeringen.se': 'Regeringen',
  'riksdagen.se': 'Riksdagen',
  'whitehouse.gov': 'The White House',
  'ec.europa.eu': 'Europeiska kommissionen',
}

const NEWS: Record<string, string> = {
  'reuters.com': 'Reuters',
  'bloomberg.com': 'Bloomberg',
  'ft.com': 'Financial Times',
  'wsj.com': 'The Wall Street Journal',
  'cnbc.com': 'CNBC',
  'marketwatch.com': 'MarketWatch',
  'barrons.com': "Barron's",
  'economist.com': 'The Economist',
  'nytimes.com': 'The New York Times',
  'apnews.com': 'AP',
  'axios.com': 'Axios',
  'di.se': 'Dagens industri',
  'svd.se': 'Svenska Dagbladet',
  'dn.se': 'Dagens Nyheter',
  'affarsvarlden.se': 'Affärsvärlden',
  'efn.se': 'EFN',
  'omni.se': 'Omni Ekonomi',
  'placera.se': 'Placera',
}

const AGGREGATOR: Record<string, string> = {
  'finance.yahoo.com': 'Yahoo Finance',
  'investing.com': 'Investing.com',
  'tradingeconomics.com': 'Trading Economics',
  'nasdaq.com': 'Nasdaq',
  'morningstar.com': 'Morningstar',
}

/** The registrable part of a host — `www.federalreserve.gov` → `federalreserve.gov`; `ecb.europa.eu` keeps its three labels. */
export function registrableDomain(host: string): string {
  const labels = host.toLowerCase().split('.').filter(Boolean)
  if (labels.length <= 2) return labels.join('.')
  const last = labels[labels.length - 1]!
  const second = labels[labels.length - 2]!
  /* Two-label public suffixes the table uses: `co.uk`, `or.jp`, `europa.eu`. */
  if (
    (last === 'uk' && second === 'co') ||
    (last === 'jp' && second === 'or') ||
    (last === 'eu' && second === 'europa')
  )
    return labels.slice(-3).join('.')
  return labels.slice(-2).join('.')
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}

const capitalise = (word: string) => word.charAt(0).toUpperCase() + word.slice(1)

/** The source behind an address, by the reviewed table; an unknown address is `other`, ranked last. */
export function authorityOf(url: string | null): SourceIdentity {
  const host = url ? hostOf(url) : null
  if (!host) return { sourceType: 'other', authority: 6, publisher: 'okänd källa' }
  const domain = registrableDomain(host)
  if (OFFICIAL[domain])
    return { sourceType: 'official', authority: 1, publisher: OFFICIAL[domain]! }
  if (ISSUER_HOSTS[domain])
    return { sourceType: 'issuer', authority: 2, publisher: ISSUER_HOSTS[domain]! }
  if (
    /^(?:investor|investors|ir)\./.test(host) ||
    /investor[- ]?relations/.test(url ?? '')
  )
    return {
      sourceType: 'issuer',
      authority: 2,
      publisher: capitalise(domain.split('.')[0] ?? domain),
    }
  if (GOVERNMENT[domain])
    return { sourceType: 'government', authority: 3, publisher: GOVERNMENT[domain]! }
  if (NEWS[domain]) return { sourceType: 'news', authority: 4, publisher: NEWS[domain]! }
  if (AGGREGATOR[domain] || AGGREGATOR[host])
    return {
      sourceType: 'other',
      authority: 5,
      publisher: AGGREGATOR[host] ?? AGGREGATOR[domain]!,
    }
  if (domain.endsWith('.gov'))
    return { sourceType: 'government', authority: 3, publisher: capitalise(domain) }
  return { sourceType: 'other', authority: 6, publisher: domain }
}

/** The domains the reviewed table counts as reputable financial news, for a news-restricted search. */
export const NEWS_DOMAINS: readonly string[] = Object.keys(NEWS)

/** The official domains, for a search that must land on a primary source. */
export const OFFICIAL_DOMAINS: readonly string[] = Object.keys(OFFICIAL)
