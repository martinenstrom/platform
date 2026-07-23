/**
 * Net capital flow by region for the "Capital Flows" card — illustrative
 * figures, not sourced flow-of-funds data. Deliberately a simple labeled
 * list rather than a second embedded map component.
 */
export interface RegionalCapitalFlow {
  region: string
  netFlowBillionsUsd: number
}

export const GLOBAL_CAPITAL_FLOWS: RegionalCapitalFlow[] = [
  { region: 'N. America', netFlowBillionsUsd: 12.48 },
  { region: 'Europe', netFlowBillionsUsd: 8.7 },
  { region: 'Asia', netFlowBillionsUsd: -1.38 },
  { region: 'Oceania', netFlowBillionsUsd: 1.88 },
]
