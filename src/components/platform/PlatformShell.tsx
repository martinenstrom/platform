import type { ReactNode } from 'react'
import { cn } from '~/lib/cn'

const SCENE = '/data/environment/waterfront-scene.jpg'

/**
 * The room without the workspace: the first-run page and Recovery Mode
 * stand in the same evening waterfront as every other page, but there is
 * no column to navigate by and no bar — there is no record to go to yet,
 * or the record refused to open. One centred column, the firm's mark at
 * its head.
 */
export function PlatformShell({
  kicker,
  title,
  lede,
  children,
  wide = false,
}: {
  kicker: string
  title: string
  lede?: ReactNode
  children: ReactNode
  wide?: boolean
}) {
  return (
    <div className="relative min-h-screen">
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <div
          className="hero-photo-drift absolute -inset-y-[8px] right-0 left-0 bg-cover bg-no-repeat"
          style={{ backgroundImage: `url(${SCENE})` }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#060910]/55 via-[#060910]/35 to-[#060910]/80" />
      </div>
      <div
        className={cn(
          'relative z-10 mx-auto flex min-h-screen w-full flex-col px-6 py-10 lg:py-14',
          wide ? 'max-w-[1180px]' : 'max-w-[880px]',
        )}
      >
        <header className="mb-6">
          <p className="type-display-statement text-[23px] leading-none text-institution">
            Financial<span className="text-content"> OS</span>
          </p>
          <p className="type-section mt-6 text-institution">{kicker}</p>
          <h1 className="type-display-name mt-1.5 text-[44px] leading-none">{title}</h1>
          {lede && (
            <p className="mt-3 max-w-[40rem] font-display text-[15.5px] leading-snug text-content-muted">
              {lede}
            </p>
          )}
        </header>
        <div className="flex flex-col gap-3">{children}</div>
      </div>
    </div>
  )
}
