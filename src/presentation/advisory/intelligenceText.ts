/**
 * The intelligence, as sentences: what JARVIS noticed, why it matters, and
 * what to do — one rendering per signal kind, so the same fact reads the
 * same in the list, the rail and the briefing.
 *
 * Every sentence quotes the numbers the signal carries. Nothing is added
 * that the signal does not say.
 */

import type { NextBestAction, Signal, SignalKind } from '~/domain/advisory'
import { formatDayMonth, formatDaysFromToday, formatMsek, formatPoints } from './format'
import { ASSET_CLASS_LABEL } from './text'

export interface SignalText {
  /** SIGNAL — the fact. */
  signal: string
  /** WHY IT MATTERS. */
  why: string
  /** RECOMMENDED ACTION. */
  action: string
}

export type SignalTone = 'alert' | 'signal' | 'insight'

/** How loud a kind is, for the visual language: alerts are owed, signals are noticed, insights are opportunities. */
export const SIGNAL_TONE: Record<SignalKind, SignalTone> = {
  'overdue-commitment': 'alert',
  'retention-risk': 'alert',
  'meeting-approaching': 'signal',
  'allocation-drift': 'signal',
  'refinancing-approaching': 'signal',
  'loan-maturity-approaching': 'signal',
  'commitment-due-soon': 'signal',
  'excess-cash': 'signal',
  'no-recent-contact': 'signal',
  'open-concern': 'signal',
  'large-withdrawal': 'signal',
  'goal-at-risk': 'signal',
  'opportunity-open': 'insight',
  'birthday-approaching': 'insight',
}

export function signalText(signal: Signal): SignalText {
  switch (signal.kind) {
    case 'allocation-drift':
      return {
        signal: `${ASSET_CLASS_LABEL[signal.assetClass]} ${formatPoints(signal.deviationPoints)} mot strategisk allokering (${signal.currentPercent} % mot ${signal.strategicPercent} %).`,
        why: 'Portföljen avviker från det mandat klienten har godkänt.',
        action:
          signal.deviationPoints > 0
            ? 'Diskutera ombalansering vid nästa portföljgenomgång.'
            : 'Se över om undervikten är avsiktlig eller ska justeras.',
      }
    case 'excess-cash':
      return {
        signal: `Likvida medel ${formatMsek(signal.amount)}, ${signal.sharePercent} % av de finansiella tillgångarna.`,
        why: 'Likviditeten ligger väsentligt över klientens strategiska behov.',
        action: 'Pröva om överskottslikviditeten ska placeras.',
      }
    case 'refinancing-approaching':
      return {
        signal: `Omsättning av bolån ${formatDayMonth(signal.date)}, ${formatDaysFromToday(signal.daysAhead)}.`,
        why: 'Bunden ränta löper ut; villkoren behöver vara klara innan dess.',
        action: 'Ta fram villkor och kontakta klienten i god tid före förfallet.',
      }
    case 'loan-maturity-approaching':
      return {
        signal: `Lån förfaller ${formatDayMonth(signal.date)}, ${formatDaysFromToday(signal.daysAhead)}.`,
        why: 'Ett förfall utan plan blir ett likviditetsproblem för klienten.',
        action: 'Bekräfta hur lånet ska lösas eller förlängas.',
      }
    case 'no-recent-contact':
      return {
        signal: `Ingen kontakt på ${signal.days} dagar.`,
        why: 'Relationer utan kontakt tappar förtroende och blir sårbara för konkurrenter.',
        action: 'Ring klienten för en kort avstämning.',
      }
    case 'open-concern':
      return {
        signal: `Klienten har uttryckt oro: ${signal.statement}`,
        why: 'En obesvarad oro påverkar förtroendet mer än utvecklingen.',
        action: 'Adressera oron uttryckligen vid nästa kontakt.',
      }
    case 'overdue-commitment':
      return {
        signal: `Åtagande försenat ${signal.daysOverdue} ${signal.daysOverdue === 1 ? 'dag' : 'dagar'}: ${signal.title}`,
        why: 'Ett löfte till en klient får aldrig glömmas bort.',
        action: `Slutför "${signal.title}" och återkoppla till klienten.`,
      }
    case 'commitment-due-soon':
      return {
        signal: `Åtagande förfaller ${formatDaysFromToday(signal.daysAhead)}: ${signal.title}`,
        why: 'Klienten väntar på det du lovade.',
        action: `Slutför "${signal.title}" i tid.`,
      }
    case 'meeting-approaching':
      return {
        signal: `Möte ${formatDayMonth(signal.date)}, ${formatDaysFromToday(signal.daysAhead)}${signal.openCommitments > 0 ? `, ${signal.openCommitments} öppna åtaganden` : ''}.`,
        why: 'Ett förberett möte är den viktigaste kontaktpunkten i relationen.',
        action: 'Förbered mötet och stäm av öppna åtaganden innan.',
      }
    case 'birthday-approaching':
      return {
        signal: `Klienten fyller ${signal.turning} ${formatDayMonth(signal.date)}, ${formatDaysFromToday(signal.daysAhead)}.`,
        why: 'Ett personligt tillfälle att höra av sig.',
        action: 'Skicka en hälsning.',
      }
    case 'opportunity-open':
      return {
        signal: `Möjlighet: ${signal.title}, ${formatMsek(signal.potentialValue)}.`,
        why: 'En identifierad möjlighet som ännu inte tagits vidare.',
        action: 'Ta nästa steg enligt möjlighetens plan.',
      }
    case 'goal-at-risk':
      return {
        signal: `Målet "${signal.title}" är ${signal.status === 'behind' ? 'efter plan' : 'i riskzonen'}.`,
        why: 'Klientens mål är det portföljen ska bedömas mot.',
        action: 'Diskutera vad som krävs för att komma tillbaka på plan.',
      }
    case 'large-withdrawal':
      return {
        signal: `Stort uttag ${formatMsek(signal.amount)} den ${formatDayMonth(signal.date)}.`,
        why: 'Ett stort uttag kan betyda ett behov, eller en konkurrent.',
        action: 'Fråga vad uttaget gick till och om något har förändrats.',
      }
    case 'retention-risk':
      return {
        signal: `Relationshälsa ${signal.score}/100, i riskzonen.`,
        why: 'Flera negativa drivkrafter samtidigt.',
        action: 'Prioritera ett personligt möte med klienten.',
      }
  }
}

/** The next best action as one sentence. */
export function nextBestActionText(action: NextBestAction): string {
  return signalText(action.signal).action
}
