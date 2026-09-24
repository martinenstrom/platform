/**
 * What the client is trying to achieve. A portfolio is eventually judged
 * against these rather than against performance alone; in Phase 1 they are
 * facts the advisor records, with a progress figure derived from the assets
 * the goal is associated with.
 */

import type { ClientId } from './client'

export type GoalKind =
  | 'capital-preservation'
  | 'long-term-growth'
  | 'retirement-income'
  | 'property-purchase'
  | 'generational-wealth'
  | 'liquidity-reserve'
  | 'childrens-future'
  | 'company-sale-proceeds'
  | 'lifestyle-spending'

export type GoalPriority = 'primary' | 'secondary' | 'aspirational'
export type GoalStatus = 'on-track' | 'at-risk' | 'behind' | 'achieved' | 'not-started'

export interface Goal {
  id: string
  clientId: ClientId
  kind: GoalKind
  title: string
  targetAmount: number | null
  /** ISO date. */
  targetDate: string | null
  priority: GoalPriority
  /** Progress towards the target, percent, as last assessed. */
  progressPercent: number
  /** The assets the goal draws on. */
  associatedAssetIds: readonly string[]
  status: GoalStatus
  /** The advisor's own words about the goal, as written. */
  notes: string
  /** ISO date the progress and status were last assessed. */
  assessedAt: string
}
