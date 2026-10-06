import type { Signal } from '~/domain/advisory'

/**
 * The dossier's architecture: the sections the band names, in the order
 * they stand on the page, and where a signal's subject is explained.
 */
export interface DossierSection {
  id: string
  label: string
}

export const DOSSIER_SECTIONS: readonly DossierSection[] = [
  { id: 'oversikt', label: 'Översikt' },
  { id: 'formogenhet', label: 'Förmögenhet' },
  { id: 'portfolj', label: 'Portfölj' },
  { id: 'finansiering', label: 'Finansiering' },
  { id: 'relation', label: 'Relation' },
  { id: 'ataganden', label: 'Åtaganden' },
  { id: 'handelser', label: 'Händelser' },
  { id: 'familj', label: 'Familj & bolag' },
  { id: 'marknad', label: 'Marknad' },
  { id: 'mal', label: 'Mål' },
  { id: 'mojligheter', label: 'Möjligheter' },
]

/** Where on the dossier a signal's subject is explained. */
export const SIGNAL_ANCHOR: Partial<Record<Signal['kind'], string>> = {
  'goal-at-risk': '#mal',
  'opportunity-open': '#mojligheter',
  'refinancing-approaching': '#finansiering',
  'loan-maturity-approaching': '#finansiering',
  'open-concern': '#klientkontext',
  'no-recent-contact': '#relationstidslinje',
  'retention-risk': '#relation',
  'large-withdrawal': '#relationstidslinje',
  'meeting-approaching': '#handelser',
  'birthday-approaching': '#handelser',
  'allocation-drift': '#portfolj',
  'excess-cash': '#formogenhet',
  'overdue-commitment': '#ataganden',
  'commitment-due-soon': '#ataganden',
}

export function anchorFor(kind: Signal['kind']): string {
  return SIGNAL_ANCHOR[kind] ?? '#relation'
}
