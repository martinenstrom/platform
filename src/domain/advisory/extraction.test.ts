/**
 * What JARVIS understands from a note — planted sentences, asserted items.
 *
 * Deterministic by design: the same note produces the same items, so a
 * sentence can be planted and the outcome required. A near-miss is asserted
 * beside each hit, so a rule that matched everything would fail here too.
 */

import { describe, expect, it } from 'vitest'
import { datesIn, extractFromNote } from './extraction'

const WEDNESDAY = '2026-09-23'

describe('the spec example, in Swedish', () => {
  const note =
    'Träffade klienten i dag. Han är fortsatt orolig över energiallokeringen. Vi diskuterade det långsiktiga resonemanget. Bolånet ska omsättas den 14 november. Nästa möte är bokat den 3 december. Jag lovade att återkomma med en jämförelse av två placeringsalternativ.'
  const result = extractFromNote({ text: note, interactionDate: WEDNESDAY })
  const byKind = (kind: string) => result.items.filter((item) => item.kind === kind)

  it('reads the interaction as a meeting', () => {
    expect(result.interactionType).toBe('meeting')
    expect(byKind('interaction')[0]?.interactionType).toBe('meeting')
  })

  it('hears the concern', () => {
    expect(byKind('concern')).toHaveLength(1)
    expect(byKind('concern')[0]?.sourceText).toBe(
      'Han är fortsatt orolig över energiallokeringen.',
    )
    expect(byKind('concern')[0]?.contextCategory).toBe('concern')
  })

  it('dates the refinancing', () => {
    const [event] = byKind('important-event')
    expect(event?.eventType).toBe('mortgage-refinancing')
    expect(event?.date).toBe('2026-11-14')
    expect(event?.confidence).toBe('high')
  })

  it('books the next meeting', () => {
    const [meeting] = byKind('next-meeting')
    expect(meeting?.date).toBe('2026-12-03')
    expect(meeting?.eventType).toBe('client-meeting')
  })

  it('turns the promise into a commitment, as a task', () => {
    const [commitment] = byKind('commitment')
    expect(commitment?.title).toBe(
      'Återkomma med en jämförelse av två placeringsalternativ',
    )
    expect(commitment?.date).toBeNull()
    expect(commitment?.sourceText).toBe(
      'Jag lovade att återkomma med en jämförelse av två placeringsalternativ.',
    )
  })

  it('names the topics', () => {
    expect(result.topics).toEqual(
      expect.arrayContaining([
        'energy-exposure',
        'financing',
        'investment-alternatives',
        'allocation',
      ]),
    )
    expect(byKind('discussion-topics')).toHaveLength(1)
  })

  it('keeps the words every item rests on', () => {
    for (const item of result.items) expect(item.sourceText.length).toBeGreaterThan(0)
  })
})

describe('the spec example, in English', () => {
  const note =
    'Met the client today. He remains concerned about the energy allocation. We discussed the long-term rationale. Mortgage refinancing is due on 14 November. Next meeting is booked for 3 December. I promised to return with a comparison of two investment alternatives.'
  const result = extractFromNote({ text: note, interactionDate: WEDNESDAY })

  it('produces the same structure', () => {
    expect(result.interactionType).toBe('meeting')
    expect(result.items.find((i) => i.kind === 'concern')).toBeDefined()
    expect(result.items.find((i) => i.kind === 'important-event')?.date).toBe(
      '2026-11-14',
    )
    expect(result.items.find((i) => i.kind === 'next-meeting')?.date).toBe('2026-12-03')
    expect(result.items.find((i) => i.kind === 'commitment')?.title).toBe(
      'Return with a comparison of two investment alternatives',
    )
  })
})

describe('promises with relative dates', () => {
  it('resolves "on Friday" to the coming Friday and strips it from the task', () => {
    const result = extractFromNote({
      text: 'I promised to send the proposal on Friday.',
      interactionDate: WEDNESDAY,
    })
    const [commitment] = result.items.filter((i) => i.kind === 'commitment')
    expect(commitment?.date).toBe('2026-09-25')
    expect(commitment?.title).toBe('Send the proposal')
    expect(commitment?.priority).toBe('high')
  })

  it('resolves "om två veckor" from the interaction date', () => {
    const result = extractFromNote({
      text: 'Jag lovade att skicka ett finansieringsförslag om två veckor.',
      interactionDate: WEDNESDAY,
    })
    expect(result.items.find((i) => i.kind === 'commitment')?.date).toBe('2026-10-07')
  })

  it('does not read what the client will do as the advisor’s promise', () => {
    const result = extractFromNote({
      text: 'Klienten kommer att skicka sina deklarationer nästa vecka.',
      interactionDate: WEDNESDAY,
    })
    expect(result.items.filter((i) => i.kind === 'commitment')).toHaveLength(0)
  })
})

describe('near misses', () => {
  it('a calm sentence is not a concern', () => {
    const result = extractFromNote({
      text: 'Klienten är nöjd med utvecklingen.',
      interactionDate: WEDNESDAY,
    })
    expect(result.items.filter((i) => i.kind === 'concern')).toHaveLength(0)
  })

  it('a mortgage mentioned without a refinancing is not an event', () => {
    const result = extractFromNote({
      text: 'Vi pratade om bolånet i allmänhet.',
      interactionDate: WEDNESDAY,
    })
    expect(result.items.filter((i) => i.kind === 'important-event')).toHaveLength(0)
  })

  it('an unrecognised note is an internal note with low confidence', () => {
    const result = extractFromNote({ text: 'Noterat.', interactionDate: WEDNESDAY })
    expect(result.interactionType).toBe('internal-note')
    expect(result.items[0]?.confidence).toBe('low')
  })
})

describe('datesIn', () => {
  it('reads explicit, ISO, slash and weekday forms', () => {
    expect(datesIn('den 14 november', WEDNESDAY).map((d) => d.date)).toEqual([
      '2026-11-14',
    ])
    expect(datesIn('2026-12-03', WEDNESDAY).map((d) => d.date)).toEqual(['2026-12-03'])
    expect(datesIn('14/11', WEDNESDAY).map((d) => d.date)).toEqual(['2026-11-14'])
    expect(datesIn('på fredag', WEDNESDAY).map((d) => d.date)).toEqual(['2026-09-25'])
    expect(datesIn('nästa fredag', WEDNESDAY).map((d) => d.date)).toEqual(['2026-10-02'])
  })

  it('rolls a month that has passed into next year', () => {
    expect(datesIn('den 3 mars', WEDNESDAY).map((d) => d.date)).toEqual(['2027-03-03'])
  })

  it('reads a period as its first day, and says so through precision', () => {
    expect(datesIn('inom två veckor', WEDNESDAY)[0]).toMatchObject({
      date: '2026-10-07',
      precision: 'day',
    })
    expect(datesIn('återkommer nästa vecka', WEDNESDAY)[0]).toMatchObject({
      date: '2026-09-28',
      precision: 'week',
    })
    expect(datesIn('boka hemma hos henne v.43', WEDNESDAY)[0]).toMatchObject({
      date: '2026-10-19',
      precision: 'week',
    })
    expect(datesIn('optionerna löser ut i mars', WEDNESDAY)[0]).toMatchObject({
      date: '2027-03-01',
      precision: 'month',
    })
    expect(datesIn('kapitalanrop i oktober', WEDNESDAY)[0]).toMatchObject({
      date: '2026-10-01',
      precision: 'month',
    })
  })

  it('does not read "15 nov" twice as a month', () => {
    expect(datesIn('läggas om 15 nov', WEDNESDAY)).toHaveLength(1)
  })
})

/**
 * Notes as an advisor types them after a meeting: compounds, abbreviations,
 * amounts, informal verbs. Each assertion is a case the first probe missed.
 */
describe('informal Swedish, typed quickly', () => {
  const at = (text: string) => extractFromNote({ text, interactionDate: WEDNESDAY })
  const kinds = (text: string) =>
    at(text).items.map((i) => `${i.kind}${i.eventType ? ':' + i.eventType : ''}`)

  it('"ska läggas om 15 nov" is a refinancing with its day', () => {
    const [event] = at(
      'Bolånet på 6,5 mkr ska läggas om 15 nov, han vill avvakta med bindningstiden.',
    ).items.filter((i) => i.kind === 'important-event')
    expect(event).toMatchObject({
      eventType: 'mortgage-refinancing',
      date: '2026-11-15',
      confidence: 'high',
    })
  })

  it('a compound loan that matures is a maturity, and the stress beside it a concern', () => {
    const items = at(
      'Brygglånet Åre förfaller 7 nov – de är stressade över räntan.',
    ).items
    expect(items.find((i) => i.kind === 'important-event')).toMatchObject({
      eventType: 'loan-maturity',
      date: '2026-11-07',
    })
    expect(items.some((i) => i.kind === 'concern')).toBe(true)
  })

  it('"Lovat skicka … på måndag" is the advisor’s promise, dated and trimmed', () => {
    const [commitment] = at(
      'Lovat skicka samlat finansieringsförslag på måndag.',
    ).items.filter((i) => i.kind === 'commitment')
    expect(commitment).toMatchObject({
      title: 'Skicka samlat finansieringsförslag',
      date: '2026-09-28',
      confidence: 'high',
    })
  })

  it('a promise that mentions booking is a promise, not a booked meeting', () => {
    const items = at(
      'Lovade skicka jämförelsen mellan två energialternativ senast på fredag och boka ny genomgång i december.',
    ).items
    expect(items.filter((i) => i.kind === 'next-meeting')).toHaveLength(0)
    expect(items.find((i) => i.kind === 'commitment')).toMatchObject({
      date: '2026-09-25',
    })
  })

  it('"Ny träff … 12/11" and "Nästa kvartalsmöte 16 dec" are the next meeting', () => {
    expect(
      at('Ny träff hemma hos henne 12/11.').items.find((i) => i.kind === 'next-meeting')
        ?.date,
    ).toBe('2026-11-12')
    expect(
      at('Nästa kvartalsmöte 16 dec kl 10.').items.find((i) => i.kind === 'next-meeting')
        ?.date,
    ).toBe('2026-12-16')
  })

  it('a week or a month is proposed at low confidence, never as a fact', () => {
    expect(
      at('Återkommer med utkast nästa vecka.').items.find((i) => i.kind === 'commitment'),
    ).toMatchObject({ date: '2026-09-28', confidence: 'low' })
    expect(
      at('Optionerna löser ut i mars, ca 1,5 mkr efter skatt.').items.find(
        (i) => i.kind === 'important-event',
      ),
    ).toMatchObject({
      eventType: 'liquidity-event',
      date: '2027-03-01',
      confidence: 'low',
    })
    expect(
      at('Kapitalanrop PE ca 1 mkr i oktober.').items.find(
        (i) => i.kind === 'important-event',
      ),
    ).toMatchObject({ eventType: 'planned-withdrawal', confidence: 'low' })
  })

  it('a child’s birthday is a family event, not the client’s birthday', () => {
    expect(kinds('Sagas 10-årsdag 23 aug, familjen åker till Åre.')).toContain(
      'important-event:family-event',
    )
    expect(kinds('Sagas 10-årsdag 23 aug, familjen åker till Åre.')).not.toContain(
      'important-event:birthday',
    )
  })

  it('"irriterad" is a concern; "Ev." is not the end of a sentence', () => {
    expect(
      kinds(
        'Viktor ringde, irriterad över att high yield-fonden minskades utan att han förstod varför.',
      ),
    ).toContain('concern')
    const items = at('Vill inte binda. Ev. sommarstuga nästa år.').items
    expect(items.some((i) => i.sourceText === 'Ev. sommarstuga nästa år.')).toBe(true)
  })

  it('"inom två veckor" dates a promise to the day', () => {
    expect(
      at('Jag ska ta fram ett förslag på gåvoplan inom två veckor.').items.find(
        (i) => i.kind === 'commitment',
      ),
    ).toMatchObject({ date: '2026-10-07', title: 'Ta fram ett förslag på gåvoplan' })
  })

  it('reads a compound property name as the property topic', () => {
    expect(
      at('Uppsalafastigheten: refinansiering ej klar, väntar på värdering.').topics,
    ).toContain('property')
  })
})

describe('the record moves: a promise kept, a concern eased', () => {
  const record = {
    openCommitments: [
      { id: 'co-1', title: 'Återkomma med pensionsanalys' },
      { id: 'co-2', title: 'Se över avgifterna och föreslå prisjustering' },
      { id: 'co-3', title: 'Ta fram jämförelse av två alternativ till energifonden' },
    ],
    activeConcerns: [{ id: 'cf-1', statement: 'Orolig över energiexponeringen efter nedgången' }],
  }
  const at = (text: string, rec = record) =>
    extractFromNote({ text, interactionDate: WEDNESDAY, record: rec })

  it('closes the open promises a past-tense delivery names, each once, for the advisor to confirm', () => {
    const result = at(
      'Pratade med Margareta. Gick igenom pensionsanalysen och avgiftsförslaget. Hon är nöjd.',
    )
    const completed = result.items.filter((i) => i.kind === 'commitment-completed')
    expect(completed.map((i) => i.commitmentId)).toEqual(['co-1', 'co-2'])
    expect(completed[0]).toMatchObject({
      title: 'Återkomma med pensionsanalys',
      confidence: 'medium',
      date: WEDNESDAY,
      sourceText: 'Gick igenom pensionsanalysen och avgiftsförslaget.',
    })
    /* The delivery sentence is not also a new promise. */
    expect(result.items.some((i) => i.kind === 'commitment')).toBe(false)
  })

  it('does not close a promise the note only talks about, or one the advisor is still to keep', () => {
    /* Near miss: the topic without a delivery. */
    expect(
      at('Pratade om pensionsanalysen, hon vill vänta.').items.some(
        (i) => i.kind === 'commitment-completed',
      ),
    ).toBe(false)
    /* Near miss: a future promise is a promise, never a kept one. */
    const future = at('Jag ska skicka pensionsanalysen på fredag.')
    expect(future.items.some((i) => i.kind === 'commitment-completed')).toBe(false)
    expect(future.items.some((i) => i.kind === 'commitment')).toBe(true)
    /* Near miss: a delivery of something else — "energiexponeringen" is not "energifonden". */
    expect(
      at('Vi gick igenom energiexponeringen.').items.some(
        (i) => i.kind === 'commitment-completed',
      ),
    ).toBe(false)
    /* Without a record, nothing is matched. */
    expect(
      extractFromNote({ text: 'Gick igenom pensionsanalysen.', interactionDate: WEDNESDAY }).items.some(
        (i) => i.kind === 'commitment-completed',
      ),
    ).toBe(false)
  })

  it('eases the one active concern a calmer client speaks to, and never reads it as a new concern', () => {
    const result = at(
      'Pratade med kunden. Han är lugnare, ligger kvar och vi bokade möte 28 oktober. Vi går även igenom bolånet.',
    )
    const eased = result.items.filter((i) => i.kind === 'concern-eased')
    expect(eased).toHaveLength(1)
    expect(eased[0]).toMatchObject({ contextFactId: 'cf-1', confidence: 'low', date: WEDNESDAY })
    expect(result.items.some((i) => i.kind === 'concern')).toBe(false)
    expect(result.items.find((i) => i.kind === 'next-meeting')).toMatchObject({ date: '2026-10-28' })
    expect(result.topics).toContain('financing')
    /* "Vi går även igenom" is present tense: no promise was kept. */
    expect(result.items.some((i) => i.kind === 'commitment-completed')).toBe(false)
  })

  it('names the concern the sentence speaks of when there are several, and is sure of that one', () => {
    const two = {
      ...record,
      activeConcerns: [
        { id: 'cf-1', statement: 'Orolig över energiexponeringen efter nedgången' },
        { id: 'cf-2', statement: 'Oroad över avgifterna' },
      ],
    }
    const result = at('Hon är inte längre orolig över avgifterna.', two)
    expect(result.items.filter((i) => i.kind === 'concern-eased')).toEqual([
      expect.objectContaining({ contextFactId: 'cf-2', confidence: 'medium' }),
    ])
    /* Several concerns and a calm sentence that names none: nobody is guessed. */
    expect(at('Han är lugnare nu.', two).items.some((i) => i.kind === 'concern-eased')).toBe(false)
  })

  it('still hears a new concern, and a calm word alone eases nothing', () => {
    expect(at('Han är orolig över räntan.').items.some((i) => i.kind === 'concern')).toBe(true)
    expect(at('Han är lugn inför mötet.').items.some((i) => i.kind === 'concern-eased')).toBe(false)
    expect(
      at('Han är lugnare.', { openCommitments: [], activeConcerns: [] }).items.some(
        (i) => i.kind === 'concern-eased',
      ),
    ).toBe(false)
  })
})
