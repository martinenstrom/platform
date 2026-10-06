/**
 * The translation from a Sentinel priority to the one action it calls for,
 * the bands and horizons the advisor reads, the chips, the completeness,
 * and the time fit: rank respected, nothing silently dropped.
 */

import { describe, expect, it } from 'vitest'
import {
  actionTypeOf,
  dailyBandOf,
  bestUseOfTime,
  completenessOf,
  dailyActionOf,
  DAILY_TIME,
  horizonOf,
  minutesIn,
  objectiveOf,
  signalsOf,
  type DailyAction,
  type DailyClientContext,
} from './dailyCommand'
import type { SentinelDriver, SentinelPriority } from './sentinel'

const TODAY = '2026-09-23'

const CLIENT: DailyClientContext = {
  id: 'cl-x',
  displayName: 'Xenia Exempel',
  segment: 'private-banking',
  officeId: 'of-strandvagen',
  officeName: 'Strandvägen',
  lastContact: { date: '2026-08-07', type: 'phone' },
  nextMeeting: null,
  health: 'watch',
  aum: 12_000_000,
  summary: {
    hasContact: true,
    hasRiskProfile: true,
    hasFinancialOverview: true,
    hasMeetingBooked: false,
  },
}

const overdue: SentinelDriver = {
  kind: 'overdue-commitment',
  commitmentId: 'co-1',
  title: 'Återkomma om energiexponeringen',
  dueDate: '2026-09-10',
  daysOverdue: 13,
}
const concern: SentinelDriver = {
  kind: 'concern',
  contextFactId: 'cf-1',
  statement: 'Orolig över energiexponeringen',
  sourceDate: '2026-08-07',
  daysOld: 47,
}
const silence: SentinelDriver = { kind: 'silence', days: 47, lastInteractionId: 'in-1', lastDate: '2026-08-07' }
const market: SentinelDriver = {
  kind: 'market',
  eventId: 'sectors:sector:energy:daily',
  impactId: 'cl-x|sectors:sector:energy:daily',
  category: 'sectors',
  symbol: 'sector:energy',
  label: 'Energy',
  change: -8,
  changeUnit: 'percent',
  direction: 'down',
  eventSeverity: 'major',
  relevance: 'high',
  directness: 'contextual',
  sourceIds: ['cf-1'],
}
const meeting: SentinelDriver = { kind: 'meeting', eventId: 'ev-1', title: 'Genomgång', date: '2026-09-25', daysAhead: 2 }
const refinancing: SentinelDriver = {
  kind: 'event',
  eventId: 'ev-2',
  eventType: 'mortgage-refinancing',
  title: 'Omsättning av bolånet',
  date: '2026-10-16',
  daysAhead: 23,
  material: true,
  liabilityId: 'li-1',
  amount: 4_000_000,
}

function priority(
  theme: SentinelPriority['theme'],
  severity: SentinelPriority['severity'],
  horizon: SentinelPriority['horizon'],
  drivers: SentinelDriver[],
  dueAt: string | null,
): SentinelPriority {
  return {
    id: `cl-x:${theme}`,
    clientId: 'cl-x',
    theme,
    severity,
    horizon,
    score: 400,
    primary: drivers[0]!,
    drivers,
    dueAt,
    sourceIds: ['co-1', 'cf-1'],
    strengthenedByMarket: false,
    fingerprint: 'f',
    assessedAt: TODAY,
    method: 'sentinel-v1',
  }
}

describe('from a priority to the one action', () => {
  it('names the action by the theme and refines it by the drivers', () => {
    expect(actionTypeOf(priority('overdue-commitment', 'critical', 'today', [overdue, concern, market, silence], '2026-09-10'))).toBe('FOLLOW_UP_COMMITMENT')
    expect(actionTypeOf(priority('meeting-imminent', 'critical', 'today', [meeting, concern], '2026-09-25'))).toBe('PREPARE_MEETING')
    expect(actionTypeOf(priority('event-approaching', 'high', 'upcoming', [refinancing], '2026-10-16'))).toBe('FINANCING_REVIEW')
    expect(actionTypeOf(priority('relationship-risk', 'high', 'today', [silence, concern], null))).toBe('CALL_CLIENT')
    expect(actionTypeOf(priority('relationship-risk', 'high', 'today', [silence, concern, market], null))).toBe('MARKET_REASSURANCE')
    expect(actionTypeOf(priority('market-impact', 'high', 'today', [market], null))).toBe('MARKET_REASSURANCE')
    expect(actionTypeOf(priority('contact-silence', 'normal', 'upcoming', [silence], null))).toBe('CALL_CLIENT')
    expect(actionTypeOf(priority('portfolio', 'normal', 'watch', [{ kind: 'excess-cash', amount: 2_000_000, sharePercent: 25 }], null))).toBe('PORTFOLIO_REVIEW')
  })

  it('states the objective the conversation should reach', () => {
    const risk = priority('relationship-risk', 'high', 'today', [silence, concern, { kind: 'open-commitment', commitmentId: 'co-2', title: 'x', dueDate: null }], null)
    expect(objectiveOf(risk, 'CALL_CLIENT')).toBe('re-anchor-strategy')
    expect(objectiveOf(priority('relationship-risk', 'high', 'today', [silence, concern], null), 'CALL_CLIENT')).toBe('address-concern')
    expect(objectiveOf(priority('contact-silence', 'normal', 'upcoming', [silence], null), 'CALL_CLIENT')).toBe('personal-check-in')
    expect(objectiveOf(priority('meeting-preparation', 'high', 'upcoming', [meeting, refinancing], '2026-09-25'), 'PREPARE_MEETING')).toBe('financing-plan')
    expect(objectiveOf(priority('overdue-commitment', 'critical', 'today', [overdue], '2026-09-10'), 'FOLLOW_UP_COMMITMENT')).toBe('deliver-promise')
  })

  it('reads the band from the severity and the horizon from Sentinel’s, within the week', () => {
    expect(dailyBandOf('critical')).toBe('high')
    expect(dailyBandOf('high')).toBe('high')
    expect(dailyBandOf('normal')).toBe('medium')
    expect(dailyBandOf('low')).toBe('watch')
    expect(horizonOf('today', null, TODAY)).toBe('now')
    expect(horizonOf('upcoming', '2026-09-28', TODAY)).toBe('week')
    expect(horizonOf('upcoming', '2026-10-16', TODAY)).toBe('watch')
    expect(horizonOf('upcoming', null, TODAY)).toBe('week')
    expect(horizonOf('watch', '2026-09-24', TODAY)).toBe('watch')
  })

  it('consolidates the reasons into a few chips, in reason order, never a badge per fact', () => {
    expect(signalsOf([overdue, concern, market, silence, overdue, concern])).toEqual([
      'overdue-commitment',
      'concern',
      'market',
      'silence',
    ])
    expect(signalsOf([meeting, refinancing, { kind: 'undiscussed', topic: 'financing', sinceDays: null }])).toEqual(['meeting', 'financing'])
  })

  it('builds the action with every record it rests on, and the time it takes stated once', () => {
    const action = dailyActionOf(
      priority('overdue-commitment', 'critical', 'today', [overdue, concern, market, silence], '2026-09-10'),
      CLIENT,
      TODAY,
    )
    expect(action).toMatchObject({
      id: 'cl-x:FOLLOW_UP_COMMITMENT',
      actionType: 'FOLLOW_UP_COMMITMENT',
      band: 'high',
      horizon: 'now',
      objective: 'deliver-promise',
      time: DAILY_TIME.FOLLOW_UP_COMMITMENT,
      commitmentId: 'co-1',
      marketEventId: 'sectors:sector:energy:daily',
      meetingId: null,
      completeness: 'partial',
      gaps: ['no-meeting-booked'],
      sourceIds: ['co-1', 'cf-1'],
    })
    expect(action.reasons).toHaveLength(4)
    expect(action.reasons[0]).toBe(overdue)
  })

  it('says what the record lacks instead of guessing', () => {
    expect(completenessOf({ hasContact: false, hasRiskProfile: false, hasFinancialOverview: false, hasMeetingBooked: false })).toEqual({
      completeness: 'insufficient',
      gaps: ['no-contact-recorded', 'no-risk-profile', 'no-financial-overview', 'no-meeting-booked'],
    })
    expect(completenessOf({ hasContact: true, hasRiskProfile: true, hasFinancialOverview: true, hasMeetingBooked: true })).toEqual({ completeness: 'full', gaps: [] })
  })
})

describe('the best use of a window', () => {
  const action = (id: string, type: DailyAction['actionType']): DailyAction => ({
    ...dailyActionOf(priority('contact-silence', 'normal', 'upcoming', [silence], null), { ...CLIENT, id, displayName: id }, TODAY),
    id: `${id}:${type}`,
    actionType: type,
    time: DAILY_TIME[type],
  })
  const ranked = [
    action('a', 'PREPARE_MEETING'), // 30–45
    action('b', 'FOLLOW_UP_COMMITMENT'), // 20–30
    action('c', 'CALL_CLIENT'), // 15–20
    action('d', 'MARKET_REASSURANCE'), // 10–15
    action('e', 'RELATIONSHIP_CHECK_IN'), // 10–15
  ]

  it('fits fifteen minutes with the highest-ranked action that fits, naming what it skipped', () => {
    const fit = bestUseOfTime(ranked, 15)
    expect(fit.best?.action.id).toBe('c:CALL_CLIENT')
    expect(fit.best?.remainingMinutes).toBe(0)
    expect(fit.second).toBeNull()
    expect(fit.skipped.map((a) => a.id)).toEqual(['a:PREPARE_MEETING', 'b:FOLLOW_UP_COMMITMENT'])
    expect(fit.alsoFits.map((a) => a.id)).toEqual(['d:MARKET_REASSURANCE', 'e:RELATIONSHIP_CHECK_IN'])
  })

  it('fits thirty minutes tightly with the top action at its shortest, nothing left for a second', () => {
    const fit = bestUseOfTime(ranked, 30)
    expect(fit.best?.action.id).toBe('a:PREPARE_MEETING')
    expect(fit.best?.remainingMinutes).toBe(0)
    expect(fit.second).toBeNull()
    expect(fit.skipped).toEqual([])
    expect(fit.alsoFits.map((a) => a.id)).toEqual([
      'b:FOLLOW_UP_COMMITMENT',
      'c:CALL_CLIENT',
      'd:MARKET_REASSURANCE',
      'e:RELATIONSHIP_CHECK_IN',
    ])
  })

  it('offers a second action only where the remainder holds it, in rank order', () => {
    const fit = bestUseOfTime(ranked, 45)
    expect(fit.best?.action.id).toBe('a:PREPARE_MEETING')
    expect(fit.best?.remainingMinutes).toBe(15)
    /* The promise needs twenty; the call fits the quarter left. */
    expect(fit.second?.action.id).toBe('c:CALL_CLIENT')
    expect(fit.second?.remainingMinutes).toBe(0)
    expect(fit.alsoFits.map((a) => a.id)).toEqual(['b:FOLLOW_UP_COMMITMENT', 'd:MARKET_REASSURANCE', 'e:RELATIONSHIP_CHECK_IN'])
    expect(fit.skipped).toEqual([])
  })

  it('gives an hour to the top priority and the next, in rank order', () => {
    const fit = bestUseOfTime(ranked, 60)
    expect(fit.best?.action.id).toBe('a:PREPARE_MEETING')
    expect(fit.second?.action.id).toBe('b:FOLLOW_UP_COMMITMENT')
    expect(fit.second?.remainingMinutes).toBe(10)
    expect(fit.skipped).toEqual([])
  })

  it('says when nothing fits', () => {
    const fit = bestUseOfTime([action('a', 'PREPARE_MEETING')], 10)
    expect(fit.best).toBeNull()
    expect(fit.skipped).toHaveLength(1)
  })

  it('reads the minutes a line names', () => {
    expect(minutesIn('Jag har 30 minuter. Vem borde jag ringa?')).toBe(30)
    expect(minutesIn('Jag har 15 min innan nästa möte')).toBe(15)
    expect(minutesIn('I have an hour')).toBe(60)
    expect(minutesIn('Jag har en timme och 15 minuter')).toBe(75)
    expect(minutesIn('Jag har en halvtimme')).toBe(30)
    expect(minutesIn('Jag har en kvart')).toBe(15)
    expect(minutesIn('Vem behöver mig idag?')).toBeNull()
  })
})
