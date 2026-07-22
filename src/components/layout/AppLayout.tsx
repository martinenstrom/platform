import { useEffect, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '~/lib/cn'
import { IconButton } from '~/components/ui/Button'
import { AppHeader } from './AppHeader'
import { AppSidebar } from './AppSidebar'

const COLLAPSE_STORAGE_KEY = 'stack.sidebar.collapsed'

/**
 * Application shell: fixed sidebar on desktop, overlay drawer on mobile,
 * sticky header aligned with the content column.
 */
export function AppLayout({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  // Read the persisted preference after hydration so SSR markup stays stable.
  useEffect(() => {
    setCollapsed(window.localStorage.getItem(COLLAPSE_STORAGE_KEY) === 'true')
  }, [])

  function toggleCollapsed() {
    setCollapsed((value) => {
      const next = !value
      window.localStorage.setItem(COLLAPSE_STORAGE_KEY, String(next))
      return next
    })
  }

  useEffect(() => {
    if (!mobileNavOpen) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setMobileNavOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [mobileNavOpen])

  return (
    <div className="flex min-h-screen bg-canvas">
      <aside
        className={cn(
          'hidden shrink-0 transition-[width] duration-200 lg:block',
          collapsed ? 'w-16' : 'w-60',
        )}
        aria-label="Sidopanel"
      >
        <div
          className={cn(
            'fixed inset-y-0 left-0 transition-[width] duration-200',
            collapsed ? 'w-16' : 'w-60',
          )}
        >
          <AppSidebar collapsed={collapsed} onToggleCollapsed={toggleCollapsed} />
        </div>
      </aside>

      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Stäng menyn"
            onClick={() => setMobileNavOpen(false)}
            className="absolute inset-0 bg-black/70"
          />
          <div className="relative h-full w-64">
            <AppSidebar
              collapsed={false}
              onToggleCollapsed={() => setMobileNavOpen(false)}
              onNavigate={() => setMobileNavOpen(false)}
            />
            <IconButton
              label="Stäng menyn"
              onClick={() => setMobileNavOpen(false)}
              className="absolute top-3 -right-11 bg-surface-2"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </IconButton>
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader onOpenMobileNav={() => setMobileNavOpen(true)} />
        <main className="flex-1 px-6 pt-2 pb-16 lg:px-10">{children}</main>
      </div>
    </div>
  )
}
