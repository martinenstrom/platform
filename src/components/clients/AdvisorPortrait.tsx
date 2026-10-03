import { cn } from '~/lib/cn'
import type { AdvisorIdentity } from '~/presentation/advisory/advisorIdentity'
import { initialsOf } from '~/presentation/advisory/portraits'

const SIZE = {
  sm: 'h-8 w-8 text-[11px]',
  lg: 'h-[168px] w-[168px] text-[48px]',
} as const

/**
 * The advisor's portrait in the same gold frame a client's stands in — or
 * the monogram in the frame where the presentation holds no portrait.
 * Decorative: the name stands beside it in text on every surface that
 * shows it, so the frame says nothing a reader needs.
 */
export function AdvisorPortrait({
  identity,
  size = 'lg',
  className,
}: {
  identity: AdvisorIdentity
  size?: keyof typeof SIZE
  className?: string
}) {
  return (
    <span
      aria-hidden="true"
      data-advisor-portrait={identity.advisorId}
      className={cn(
        'portrait-frame relative flex shrink-0 items-center justify-center overflow-hidden bg-[radial-gradient(120%_120%_at_30%_20%,#2a2416_0%,#14110b_60%,#0b0a08_100%)] font-display text-[#e6c987]',
        SIZE[size],
        className,
      )}
    >
      {identity.portraitUrl ? (
        <img src={identity.portraitUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        <span className="leading-none tracking-[0.02em]">
          {initialsOf(identity.fullName)}
        </span>
      )}
    </span>
  )
}
