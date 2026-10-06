import { cn } from '~/lib/cn'
import { initialsOf, portraitUrlOf } from '~/presentation/advisory/portraits'

const SIZE = {
  sm: 'h-10 w-10 text-[13px]',
  md: 'h-14 w-14 text-[17px]',
  lg: 'h-[132px] w-[132px] text-[40px]',
  xl: 'h-[168px] w-[168px] text-[52px]',
} as const

/**
 * The client's portrait in a gold frame — or the monogram in the same
 * frame, which is every synthetic client's case. Decorative: the name
 * stands beside it in text, so the frame says nothing a reader needs. It
 * carries a view-transition name so the frame in the relationship book
 * becomes the frame on the dossier.
 */
export function ClientPortrait({
  clientId,
  displayName,
  size = 'lg',
  className,
}: {
  clientId: string
  displayName: string
  size?: keyof typeof SIZE
  className?: string
}) {
  const url = portraitUrlOf(clientId)
  return (
    <span
      aria-hidden="true"
      className={cn(
        'portrait-frame relative flex shrink-0 items-center justify-center overflow-hidden bg-[radial-gradient(120%_120%_at_30%_20%,#2a2416_0%,#14110b_60%,#0b0a08_100%)] font-display text-[#e6c987]',
        SIZE[size],
        className,
      )}
      style={{ viewTransitionName: `portrait-${clientId}` }}
    >
      {url ? (
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : (
        <span className="leading-none tracking-[0.02em]">{initialsOf(displayName)}</span>
      )}
    </span>
  )
}
