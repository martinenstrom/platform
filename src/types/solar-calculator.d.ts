declare module 'solar-calculator' {
  /** Julian centuries since J2000.0 for the given timestamp (ms epoch). */
  export function century(date: number): number

  /** Solar declination angle, in degrees, for `t` (Julian centuries). */
  export function declination(t: number): number

  /** Equation of time, in minutes, for `t` (Julian centuries). */
  export function equationOfTime(t: number): number
}
