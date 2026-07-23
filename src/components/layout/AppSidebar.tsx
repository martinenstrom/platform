import { Link } from '@tanstack/react-router'
import { PanelLeft, Settings } from 'lucide-react'
import { cn } from '~/lib/cn'
import { primaryNav, type NavItem } from '~/lib/navigation'
import { IconButton } from '~/components/ui/Button'

interface AppSidebarProps {
  collapsed: boolean
  onToggleCollapsed: () => void
  /** Called after navigating — lets the mobile drawer close itself. */
  onNavigate?: () => void
}

export function AppSidebar({
  collapsed,
  onToggleCollapsed,
  onNavigate,
}: AppSidebarProps) {
  return (
    <div className="flex h-full flex-col bg-canvas">
      <div
        className={cn(
          'flex h-16 items-center px-4',
          collapsed ? 'justify-center' : 'justify-between',
        )}
      >
        <Link
          to="/"
          onClick={onNavigate}
          className="flex items-center gap-2.5 rounded-sm"
          aria-label="Stack – till översikten"
        >
          <Logo />
          {!collapsed && (
            <span className="hud-label text-[13px] text-content">Stack</span>
          )}
        </Link>
        {!collapsed && (
          <IconButton label="Fäll ihop sidopanelen" onClick={onToggleCollapsed}>
            <PanelLeft className="h-4 w-4" aria-hidden="true" />
          </IconButton>
        )}
      </div>

      {collapsed && (
        <div className="flex justify-center pb-2">
          <IconButton label="Expandera sidopanelen" onClick={onToggleCollapsed}>
            <PanelLeft className="h-4 w-4" aria-hidden="true" />
          </IconButton>
        </div>
      )}

      <nav aria-label="Huvudnavigation" className="flex-1 overflow-y-auto px-3 py-2">
        <ul className="flex flex-col gap-0.5">
          {primaryNav.map((item) => (
            <li key={item.to}>
              <SidebarLink item={item} collapsed={collapsed} onNavigate={onNavigate} />
            </li>
          ))}
        </ul>
      </nav>

      <div className={cn('px-3 py-4', collapsed ? 'flex justify-center' : '')}>
        <Link
          to="/settings"
          onClick={onNavigate}
          aria-label="Inställningar"
          title="Inställningar"
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-content-subtle transition-colors duration-150 hover:bg-surface-2 hover:text-content"
          activeProps={{ className: 'text-content' }}
        >
          <Settings className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>
    </div>
  )
}

/** Minimal mark: a stacked glyph, no wordmark inside the shape. */
function Logo() {
  return (
    <span
      className="hud-frame hud-glow flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent-solid"
      aria-hidden="true"
    >
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none">
        <path d="M2 5.5 8 2.5l6 3-6 3-6-3Z" fill="white" fillOpacity="0.95" />
        <path
          d="M2 10.5 8 13.5l6-3"
          stroke="white"
          strokeOpacity="0.55"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  )
}

function SidebarLink({
  item,
  collapsed,
  onNavigate,
}: {
  item: NavItem
  collapsed: boolean
  onNavigate?: () => void
}) {
  const Icon = item.icon
  return (
    <Link
      to={item.to}
      onClick={onNavigate}
      activeOptions={{ exact: item.to === '/' }}
      title={collapsed ? item.label : undefined}
      className={cn(
        'hud-label relative flex items-center gap-3 rounded-md px-3 py-2 text-[11px] transition-all duration-150',
        'text-content-muted hover:bg-surface-2 hover:text-content',
        collapsed && 'justify-center px-0',
      )}
      activeProps={{
        className: cn(
          'bg-accent-soft text-accent shadow-[0_0_16px_rgba(77,232,245,0.25)]',
          'before:absolute before:top-1 before:bottom-1 before:left-0 before:w-0.5 before:rounded-full before:bg-accent before:shadow-[0_0_8px_rgba(77,232,245,0.8)]',
        ),
        'aria-current': 'page',
      }}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      {collapsed ? <span className="sr-only">{item.label}</span> : item.label}
    </Link>
  )
}
