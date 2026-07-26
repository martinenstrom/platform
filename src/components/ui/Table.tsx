import type { ReactNode, ThHTMLAttributes, TdHTMLAttributes } from 'react'
import { cn } from '~/lib/cn'

/** Horizontal scroll container so dense tables stay usable on tablet/mobile. */
export function TableWrapper({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return <div className={cn('-mx-3 overflow-x-auto px-3', className)}>{children}</div>
}

export function Table({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <table className={cn('w-full min-w-[560px] border-collapse text-sm', className)}>
      {children}
    </table>
  )
}

export function Th({
  children,
  className,
  align = 'left',
  ...props
}: ThHTMLAttributes<HTMLTableCellElement> & { align?: 'left' | 'right' | 'center' }) {
  return (
    <th
      scope="col"
      className={cn(
        'type-metadata px-3 pb-3',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        align === 'left' && 'text-left',
        className,
      )}
      {...props}
    >
      {children}
    </th>
  )
}

export function Td({
  children,
  className,
  numeric = false,
  ...props
}: TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <td
      className={cn(
        'border-t border-line px-3 py-3 text-content',
        numeric && 'tabular text-right',
        className,
      )}
      {...props}
    >
      {children}
    </td>
  )
}

export function Tr({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <tr className={cn('transition-colors duration-150 hover:bg-surface-2', className)}>
      {children}
    </tr>
  )
}
