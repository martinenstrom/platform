import { useId } from 'react'
import { STATUS } from '~/lib/chartTheme'

interface SparklineProps {
  data: number[]
  /** Direction drives the colour; the numeric change is always shown next to it. */
  trendUp: boolean
  width?: number
  height?: number
  /** Renders a soft gradient fill under the line — terminal-style area chart. */
  area?: boolean
}

/** Tiny inline trend line. Decorative — the adjacent percentage carries the data. */
export function Sparkline({
  data,
  trendUp,
  width = 64,
  height = 20,
  area = false,
}: SparklineProps) {
  const reactId = useId()
  if (data.length < 2) return null

  const min = Math.min(...data)
  const max = Math.max(...data)
  const span = max - min || 1
  const stepX = width / (data.length - 1)
  const color = trendUp ? STATUS.positive : STATUS.negative

  const coords = data.map((value, index) => {
    const x = index * stepX
    const y = height - ((value - min) / span) * (height - 2) - 1
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  const points = coords.join(' ')
  // useId is SSR-stable; strip the colons so it stays a valid url() reference.
  const gradientId = area ? `spark-fill-${reactId.replace(/:/g, '')}` : undefined

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      focusable="false"
      className="overflow-visible"
    >
      {area && (
        <>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.28} />
              <stop offset="100%" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <polygon
            points={`0,${height} ${points} ${width},${height}`}
            fill={`url(#${gradientId})`}
          />
        </>
      )}
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
