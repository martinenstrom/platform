import { STATUS } from '~/lib/chartTheme'

interface SparklineProps {
  data: number[]
  /** Direction drives the colour; the numeric change is always shown next to it. */
  trendUp: boolean
  width?: number
  height?: number
}

/** Tiny inline trend line. Decorative — the adjacent percentage carries the data. */
export function Sparkline({ data, trendUp, width = 64, height = 20 }: SparklineProps) {
  if (data.length < 2) return null

  const min = Math.min(...data)
  const max = Math.max(...data)
  const span = max - min || 1
  const stepX = width / (data.length - 1)

  const points = data
    .map((value, index) => {
      const x = index * stepX
      const y = height - ((value - min) / span) * (height - 2) - 1
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      focusable="false"
      className="overflow-visible"
    >
      <polyline
        points={points}
        fill="none"
        stroke={trendUp ? STATUS.positive : STATUS.negative}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
