/**
 * Every advisory kind, as the product says it — in Swedish, once.
 *
 * The domain speaks in identifiers; this is the one place they become words
 * a Private Banker reads. A component never carries a label of its own for
 * a domain kind, so the same concept reads the same on every surface.
 */

import type {
  AssetClass,
  AssetKind,
  CommitmentPriority,
  CommitmentStatus,
  CommunicationChannel,
  ContextCategory,
  ClientSegment,
  EventType,
  ExtractedItemKind,
  GoalKind,
  GoalPriority,
  GoalStatus,
  HealthBand,
  HealthDriverKind,
  HouseholdMemberRole,
  Importance,
  InteractionSource,
  InteractionType,
  LiabilityKind,
  MemoryAnswerKind,
  OpportunityStatus,
  OpportunityType,
  Priority,
  StrategicRole,
  SuggestedTopicKind,
  DiscussionTopic,
  Confidence,
} from '~/domain/advisory'

export const SEGMENT_LABEL: Record<ClientSegment, string> = {
  'private-banking': 'Private Banking',
  'wealth-management': 'Wealth Management',
  entrepreneur: 'Entreprenör',
  'family-office': 'Family Office',
}

/** The segment as a dense row says it: the abbreviation a desk uses. */
export const SEGMENT_SHORT: Record<ClientSegment, string> = {
  'private-banking': 'PB',
  'wealth-management': 'WM',
  entrepreneur: 'Entreprenör',
  'family-office': 'FO',
}

export const CHANNEL_LABEL: Record<CommunicationChannel, string> = {
  phone: 'Telefon',
  email: 'E-post',
  teams: 'Teams',
  'in-person': 'Personligt möte',
}

export const INTERACTION_LABEL: Record<InteractionType, string> = {
  meeting: 'Möte',
  phone: 'Telefon',
  email: 'E-post',
  teams: 'Teams',
  'internal-note': 'Intern notering',
  'portfolio-discussion': 'Portföljdiskussion',
  'financing-discussion': 'Finansieringsdiskussion',
  'portfolio-change': 'Portföljförändring',
  'credit-decision': 'Kreditbeslut',
  'investment-proposal': 'Placeringsförslag',
  deposit: 'Insättning',
  withdrawal: 'Uttag',
  complaint: 'Klagomål',
  'follow-up': 'Uppföljning',
  'family-event': 'Familjehändelse',
  'financial-event': 'Ekonomisk händelse',
  other: 'Övrigt',
}

/** The interaction types an advisor picks from when recording an update. */
export const RECORDABLE_INTERACTIONS: readonly InteractionType[] = [
  'meeting',
  'phone',
  'email',
  'teams',
  'internal-note',
  'portfolio-discussion',
  'financing-discussion',
  'other',
]

export const SOURCE_LABEL: Record<InteractionSource, string> = {
  advisor: 'Rådgivare',
  client: 'Klienten',
  system: 'System',
}

export const IMPORTANCE_LABEL: Record<Importance, string> = {
  low: 'Låg',
  normal: 'Normal',
  high: 'Hög',
}

export const CONTEXT_LABEL: Record<ContextCategory, string> = {
  preference: 'Preferens',
  concern: 'Oro',
  objective: 'Mål',
  family: 'Familj',
  business: 'Verksamhet',
  communication: 'Kommunikation',
  behaviour: 'Beteende',
}

export const COMMITMENT_STATUS_LABEL: Record<CommitmentStatus, string> = {
  open: 'Öppet',
  done: 'Klart',
  cancelled: 'Avbrutet',
}

export const COMMITMENT_PRIORITY_LABEL: Record<CommitmentPriority, string> = {
  low: 'Låg',
  medium: 'Medel',
  high: 'Hög',
}

export const PRIORITY_LABEL: Record<Priority, string> = COMMITMENT_PRIORITY_LABEL

export const EVENT_LABEL: Record<EventType, string> = {
  birthday: 'Födelsedag',
  'loan-maturity': 'Lån förfaller',
  'mortgage-refinancing': 'Omsättning av bolån',
  'investment-maturity': 'Placering förfaller',
  'pension-event': 'Pensionshändelse',
  'company-sale': 'Bolagsförsäljning',
  'property-purchase': 'Fastighetsköp',
  'property-completion': 'Tillträde',
  'tax-deadline': 'Skattefrist',
  'planned-withdrawal': 'Planerat uttag',
  'liquidity-event': 'Likviditetshändelse',
  'client-meeting': 'Möte',
  'annual-review': 'Årsgenomgång',
  'family-event': 'Familjehändelse',
  'insurance-review': 'Försäkringsöversyn',
  custom: 'Händelse',
}

export const OPPORTUNITY_TYPE_LABEL: Record<OpportunityType, string> = {
  investment: 'Placering',
  financing: 'Finansiering',
  'external-asset-transfer': 'Flytt av externt kapital',
  pension: 'Pension',
  insurance: 'Försäkring',
  'company-sale-proceeds': 'Försäljningslikvid',
  'liquidity-deployment': 'Placering av likviditet',
  'property-financing': 'Fastighetsfinansiering',
  'family-wealth': 'Familjeförmögenhet',
  'next-generation': 'Nästa generation',
  other: 'Övrigt',
}

export const OPPORTUNITY_STATUS_LABEL: Record<OpportunityStatus, string> = {
  identified: 'Identifierad',
  'in-discussion': 'Diskuteras',
  proposed: 'Föreslagen',
  won: 'Vunnen',
  lost: 'Förlorad',
}

export const GOAL_KIND_LABEL: Record<GoalKind, string> = {
  'capital-preservation': 'Kapitalbevarande',
  'long-term-growth': 'Långsiktig tillväxt',
  'retirement-income': 'Pensionsinkomst',
  'property-purchase': 'Fastighetsköp',
  'generational-wealth': 'Generationsskifte',
  'liquidity-reserve': 'Likviditetsreserv',
  'childrens-future': 'Barnens framtid',
  'company-sale-proceeds': 'Försäljningslikvid',
  'lifestyle-spending': 'Livsstil',
}

export const GOAL_PRIORITY_LABEL: Record<GoalPriority, string> = {
  primary: 'Primärt',
  secondary: 'Sekundärt',
  aspirational: 'Önskemål',
}

export const GOAL_STATUS_LABEL: Record<GoalStatus, string> = {
  'on-track': 'Enligt plan',
  'at-risk': 'I riskzonen',
  behind: 'Efter plan',
  achieved: 'Uppnått',
  'not-started': 'Ej påbörjat',
}

export const ASSET_KIND_LABEL: Record<AssetKind, string> = {
  'investment-portfolio': 'Placeringsportfölj',
  cash: 'Likvida medel',
  property: 'Fastigheter',
  'company-ownership': 'Bolagsinnehav',
  pension: 'Pension',
  'other-financial': 'Övriga finansiella tillgångar',
  other: 'Övriga tillgångar',
}

export const LIABILITY_KIND_LABEL: Record<LiabilityKind, string> = {
  mortgage: 'Bolån',
  'investment-loan': 'Värdepapperskredit',
  'company-debt': 'Bolagsskuld',
  'bridge-financing': 'Brygglån',
  'property-financing': 'Fastighetslån',
  'other-loan': 'Övrigt lån',
}

export const ASSET_CLASS_LABEL: Record<AssetClass, string> = {
  equities: 'Aktier',
  'fixed-income': 'Räntor',
  alternatives: 'Alternativa',
  cash: 'Likvida medel',
}

export const STRATEGIC_ROLE_LABEL: Record<StrategicRole, string> = {
  'core-equity': 'Kärninnehav',
  liquidity: 'Likviditet',
  'inflation-hedge': 'Inflationsskydd',
  satellite: 'Satellit / tema',
  income: 'Avkastning',
  diversifier: 'Diversifiering',
}

export const HOUSEHOLD_ROLE_LABEL: Record<HouseholdMemberRole, string> = {
  client: 'Klient',
  spouse: 'Partner',
  child: 'Barn',
  company: 'Bolag',
  'holding-company': 'Holdingbolag',
  foundation: 'Stiftelse',
  related: 'Närstående',
}

export const HEALTH_BAND_LABEL: Record<HealthBand, string> = {
  strong: 'Stark',
  stable: 'Stabil',
  watch: 'Bevaka',
  'at-risk': 'I riskzonen',
}

/** The band as the dossier's pill states it: one phrase, uppercase in the UI. */
export const HEALTH_PILL_LABEL: Record<HealthBand, string> = {
  strong: 'Hög relationshälsa',
  stable: 'Stabil relation',
  watch: 'Relation att bevaka',
  'at-risk': 'Relation i riskzonen',
}

/** The segment as the dossier's pill states it. */
export const SEGMENT_PILL_LABEL: Record<ClientSegment, string> = {
  'private-banking': 'PB-kund',
  'wealth-management': 'WM-kund',
  entrepreneur: 'Entreprenör',
  'family-office': 'Family Office',
}

/**
 * The firm's seven-step risk scale, named. A label per step and nothing
 * derived: the step is the client's recorded profile.
 */
export const RISK_PROFILE_LABEL: Record<1 | 2 | 3 | 4 | 5 | 6 | 7, string> = {
  1: 'Mycket försiktig',
  2: 'Försiktig',
  3: 'Balanserad',
  4: 'Balanserad tillväxt',
  5: 'Tillväxt',
  6: 'Offensiv',
  7: 'Mycket offensiv',
}

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  high: 'Hög säkerhet',
  medium: 'Medelhög säkerhet',
  low: 'Låg säkerhet',
}

export const TOPIC_LABEL: Record<DiscussionTopic, string> = {
  'portfolio-performance': 'Portföljutveckling',
  allocation: 'Allokering',
  'energy-exposure': 'Energiexponering',
  financing: 'Finansiering',
  'investment-alternatives': 'Placeringsalternativ',
  fees: 'Avgifter',
  pension: 'Pension',
  property: 'Fastigheter',
  liquidity: 'Likviditet',
  risk: 'Risk',
  'market-volatility': 'Marknadsoro',
  family: 'Familj',
  company: 'Bolag',
  tax: 'Skatt',
  insurance: 'Försäkring',
  succession: 'Generationsskifte',
}

/** What JARVIS calls each thing it understood. */
export const EXTRACTED_KIND_LABEL: Record<ExtractedItemKind, string> = {
  interaction: 'Interaktion',
  concern: 'Klientens oro',
  preference: 'Preferens',
  objective: 'Mål',
  family: 'Familjekontext',
  business: 'Verksamhet',
  'important-event': 'Viktig händelse',
  'next-meeting': 'Nästa möte',
  commitment: 'Åtagande',
  'discussion-topics': 'Diskussionsämnen',
  'key-point': 'Nyckelpunkt',
}

export const MEMORY_ANSWER_HEADING: Record<MemoryAnswerKind, string> = {
  commitments: 'Öppna åtaganden',
  concerns: 'Vad klienten oroar sig för',
  topic: 'Vad relationsminnet säger om ämnet',
  'loan-maturity': 'Lån och förfall',
  birthday: 'Födelsedag',
  'next-meeting': 'Nästa möte',
  'changes-since-last-meeting': 'Sedan senaste mötet',
  holdings: 'Innehav',
  goals: 'Klientens mål',
  'last-contact': 'Senaste kontakt',
  unknown: 'Senaste noteringarna',
}

export const SUGGESTED_TOPIC_LABEL: Record<SuggestedTopicKind, string> = {
  'open-commitment': 'Öppet åtagande',
  'client-concern': 'Klientens oro',
  'allocation-drift': 'Avvikelse från strategi',
  'upcoming-event': 'Kommande händelse',
  'excess-cash': 'Överskottslikviditet',
  'goal-at-risk': 'Mål i riskzonen',
  opportunity: 'Möjlighet',
  'contact-gap': 'Lång tid utan kontakt',
}

export function healthDriverText(kind: HealthDriverKind, count?: number): string {
  switch (kind) {
    case 'recent-contact':
      return count === 0 ? 'Kontakt i dag' : `Kontakt för ${count ?? 0} dagar sedan`
    case 'recent-meeting':
      return 'Möte under senaste kvartalet'
    case 'no-overdue-commitments':
      return 'Inga försenade åtaganden'
    case 'next-meeting-booked':
      return 'Nästa möte bokat'
    case 'no-open-concerns':
      return 'Ingen aktiv oro'
    case 'overdue-commitments':
      return count === 1 ? 'Ett försenat åtagande' : `${count ?? 0} försenade åtaganden`
    case 'contact-lapsed':
      return `${count ?? 0} dagar utan kontakt`
    case 'open-concerns':
      return count === 1 ? 'En aktiv oro' : `${count ?? 0} aktiva orosmoment`
    case 'recent-large-withdrawal':
      return 'Stort uttag nyligen'
    case 'open-complaint':
      return 'Klagomål under senaste halvåret'
    case 'fee-sensitive':
      return 'Avgiftskänslig'
    case 'goal-behind':
      return 'Mål efter plan'
  }
}
