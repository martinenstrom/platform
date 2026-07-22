import clsx, { type ClassValue } from 'clsx'

/** Conditional className helper used across all components. */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs)
}
