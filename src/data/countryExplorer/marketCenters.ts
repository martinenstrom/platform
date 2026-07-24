/**
 * Major financial centers shown as markers on the globe's "Market Status"
 * layer. Trading hours are well-known public facts (each exchange's regular
 * session), not fetched data — `getMarketStatus` is a pure function of the
 * current time, computed locally via `Intl.DateTimeFormat`'s `timeZone`
 * option (no dependency needed).
 *
 * Deliberately simplified, and honest about it:
 * - Lunch-break trading halts (Tokyo, Hong Kong, Shanghai) are ignored —
 *   those exchanges are treated as one continuous session.
 * - HOLIDAY is not a possible return value — there is no holiday-calendar
 *   data source here, so exchange holidays simply show as CLOSED (correct
 *   for evenings/weekends, technically imprecise on a holiday weekday).
 */

export interface MarketCenter {
  id: string
  name: string
  /** Primary exchange's common short code (NYSE, LSE, XETRA, …). */
  exchange: string
  lat: number
  lng: number
  /** IANA time zone identifier. */
  timeZone: string
  /** Regular session open, "HH:MM" in the center's local time. */
  openLocal: string
  /** Regular session close, "HH:MM" in the center's local time. */
  closeLocal: string
}

export type MarketStatusValue = 'OPEN' | 'CLOSED' | 'PRE-MARKET' | 'AFTER-HOURS'

const PRE_MARKET_MINUTES = 60
const AFTER_HOURS_MINUTES = 60

export const MARKET_CENTERS: MarketCenter[] = [
  {
    id: 'stockholm',
    name: 'Stockholm',
    exchange: 'OMX',
    lat: 59.33,
    lng: 18.07,
    timeZone: 'Europe/Stockholm',
    openLocal: '09:00',
    closeLocal: '17:30',
  },
  {
    id: 'london',
    name: 'London',
    exchange: 'LSE',
    lat: 51.51,
    lng: -0.13,
    timeZone: 'Europe/London',
    openLocal: '08:00',
    closeLocal: '16:30',
  },
  {
    id: 'frankfurt',
    name: 'Frankfurt',
    exchange: 'XETRA',
    lat: 50.11,
    lng: 8.68,
    timeZone: 'Europe/Berlin',
    openLocal: '09:00',
    closeLocal: '17:30',
  },
  {
    id: 'new-york',
    name: 'New York',
    exchange: 'NYSE',
    lat: 40.71,
    lng: -74.01,
    timeZone: 'America/New_York',
    openLocal: '09:30',
    closeLocal: '16:00',
  },
  {
    id: 'toronto',
    name: 'Toronto',
    exchange: 'TSX',
    lat: 43.65,
    lng: -79.38,
    timeZone: 'America/Toronto',
    openLocal: '09:30',
    closeLocal: '16:00',
  },
  {
    id: 'sao-paulo',
    name: 'São Paulo',
    exchange: 'B3',
    lat: -23.55,
    lng: -46.63,
    timeZone: 'America/Sao_Paulo',
    openLocal: '10:00',
    closeLocal: '17:00',
  },
  {
    id: 'tokyo',
    name: 'Tokyo',
    exchange: 'TSE',
    lat: 35.68,
    lng: 139.69,
    timeZone: 'Asia/Tokyo',
    openLocal: '09:00',
    closeLocal: '15:00',
  },
  {
    id: 'hong-kong',
    name: 'Hong Kong',
    exchange: 'HKEX',
    lat: 22.32,
    lng: 114.17,
    timeZone: 'Asia/Hong_Kong',
    openLocal: '09:30',
    closeLocal: '16:00',
  },
  {
    id: 'shanghai',
    name: 'Shanghai',
    exchange: 'SSE',
    lat: 31.23,
    lng: 121.47,
    timeZone: 'Asia/Shanghai',
    openLocal: '09:30',
    closeLocal: '15:00',
  },
  {
    id: 'singapore',
    name: 'Singapore',
    exchange: 'SGX',
    lat: 1.35,
    lng: 103.82,
    timeZone: 'Asia/Singapore',
    openLocal: '09:00',
    closeLocal: '17:00',
  },
  {
    id: 'sydney',
    name: 'Sydney',
    exchange: 'ASX',
    lat: -33.87,
    lng: 151.21,
    timeZone: 'Australia/Sydney',
    openLocal: '10:00',
    closeLocal: '16:00',
  },
  {
    id: 'mumbai',
    name: 'Mumbai',
    exchange: 'NSE',
    lat: 19.08,
    lng: 72.88,
    timeZone: 'Asia/Kolkata',
    openLocal: '09:15',
    closeLocal: '15:30',
  },
  {
    id: 'dubai',
    name: 'Dubai',
    exchange: 'DFM',
    lat: 25.2,
    lng: 55.27,
    timeZone: 'Asia/Dubai',
    openLocal: '10:00',
    closeLocal: '14:00',
  },
  {
    id: 'zurich',
    name: 'Zurich',
    exchange: 'SIX',
    lat: 47.37,
    lng: 8.54,
    timeZone: 'Europe/Zurich',
    openLocal: '09:00',
    closeLocal: '17:30',
  },
  {
    id: 'paris',
    name: 'Paris',
    exchange: 'EPA',
    lat: 48.86,
    lng: 2.35,
    timeZone: 'Europe/Paris',
    openLocal: '09:00',
    closeLocal: '17:30',
  },
  {
    id: 'johannesburg',
    name: 'Johannesburg',
    exchange: 'JSE',
    lat: -26.2,
    lng: 28.05,
    timeZone: 'Africa/Johannesburg',
    openLocal: '09:00',
    closeLocal: '17:00',
  },
  {
    id: 'lagos',
    name: 'Lagos',
    exchange: 'NGX',
    lat: 6.52,
    lng: 3.38,
    timeZone: 'Africa/Lagos',
    openLocal: '10:00',
    closeLocal: '14:30',
  },
  {
    id: 'cape-town',
    name: 'Cape Town',
    // No primary exchange of its own; represented under A2X (a licensed South
    // African exchange) on South African market hours.
    exchange: 'A2X',
    lat: -33.92,
    lng: 18.42,
    timeZone: 'Africa/Johannesburg',
    openLocal: '09:00',
    closeLocal: '17:00',
  },
  {
    id: 'nairobi',
    name: 'Nairobi',
    exchange: 'NSE',
    lat: -1.29,
    lng: 36.82,
    timeZone: 'Africa/Nairobi',
    openLocal: '09:00',
    closeLocal: '15:00',
  },
  {
    id: 'casablanca',
    name: 'Casablanca',
    exchange: 'CSE',
    lat: 33.57,
    lng: -7.59,
    timeZone: 'Africa/Casablanca',
    openLocal: '09:30',
    closeLocal: '15:30',
  },
  {
    id: 'buenos-aires',
    name: 'Buenos Aires',
    exchange: 'BYMA',
    lat: -34.6,
    lng: -58.38,
    timeZone: 'America/Argentina/Buenos_Aires',
    openLocal: '11:00',
    closeLocal: '17:00',
  },
  {
    id: 'santiago',
    name: 'Santiago',
    exchange: 'BCS',
    lat: -33.45,
    lng: -70.67,
    timeZone: 'America/Santiago',
    openLocal: '09:30',
    closeLocal: '16:00',
  },
  {
    id: 'bogota',
    name: 'Bogotá',
    exchange: 'BVC',
    lat: 4.71,
    lng: -74.07,
    timeZone: 'America/Bogota',
    openLocal: '09:30',
    closeLocal: '16:00',
  },
]

function parseHHMM(value: string): number {
  const [hours = 0, minutes = 0] = value.split(':').map(Number)
  return hours * 60 + minutes
}

/** Weekday (0=Sunday) and minutes-since-midnight for `date`, in `timeZone`. */
function getLocalTimeParts(
  date: Date,
  timeZone: string,
): { weekday: number; minutesOfDay: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)

  const weekdayStr = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun'
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0')
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0')

  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return { weekday: WEEKDAYS.indexOf(weekdayStr), minutesOfDay: hour * 60 + minute }
}

export function getMarketStatus(center: MarketCenter, now: Date): MarketStatusValue {
  const { weekday, minutesOfDay } = getLocalTimeParts(now, center.timeZone)
  const isWeekend = weekday === 0 || weekday === 6
  const open = parseHHMM(center.openLocal)
  const close = parseHHMM(center.closeLocal)

  if (isWeekend) return 'CLOSED'
  if (minutesOfDay >= open - PRE_MARKET_MINUTES && minutesOfDay < open)
    return 'PRE-MARKET'
  if (minutesOfDay >= open && minutesOfDay < close) return 'OPEN'
  if (minutesOfDay >= close && minutesOfDay < close + AFTER_HOURS_MINUTES)
    return 'AFTER-HOURS'
  return 'CLOSED'
}
