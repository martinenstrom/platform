import {
  Bot,
  Eye,
  FileText,
  LayoutDashboard,
  LineChart,
  Wallet,
  type LucideIcon,
} from 'lucide-react'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
}

/** Primary navigation. Paths must match the file routes in `src/routes`. */
export const primaryNav: NavItem[] = [
  { to: '/', label: 'Översikt', icon: LayoutDashboard },
  { to: '/agents', label: 'Agenter', icon: Bot },
  { to: '/portfolio', label: 'Portfölj', icon: Wallet },
  { to: '/markets', label: 'Marknader', icon: LineChart },
  { to: '/watchlist', label: 'Bevakning', icon: Eye },
  { to: '/reports', label: 'Rapporter', icon: FileText },
]
