import { useEffect, useState } from 'react'

/**
 * The desktop host, as the page may reach it: pick a folder or a file,
 * open a path in the operating system, relaunch, read or set "start with
 * Windows". Present only inside the desktop window (`desktop/preload.cjs`);
 * in a browser every door is absent and the surfaces say so.
 */

export interface DesktopBridge {
  info(): Promise<{ version: string; dataDir: string; platform: string }>
  chooseFolder(title?: string): Promise<string | null>
  chooseFile(options?: {
    title?: string
    filters?: { name: string; extensions: string[] }[]
  }): Promise<string | null>
  /** Open a path under the data directory in the operating system; the host refuses anything else. */
  openPath(path: string): Promise<string>
  relaunch(): Promise<void>
  autostart: {
    get(): Promise<boolean>
    set(enabled: boolean): Promise<boolean>
  }
}

export function desktopBridge(): DesktopBridge | null {
  if (typeof window === 'undefined') return null
  const bridge = (window as unknown as { financialOsDesktop?: DesktopBridge }).financialOsDesktop
  return bridge ?? null
}

/**
 * The bridge as a surface should read it: absent on the server and on the
 * first client render — the two must agree, or the page fails to hydrate
 * (measured: the desktop-only doors tripped React's hydration check) —
 * and present after mount, where the desktop is.
 */
export function useDesktopBridge(): DesktopBridge | null {
  const [bridge, setBridge] = useState<DesktopBridge | null>(null)
  useEffect(() => {
    setBridge(desktopBridge())
  }, [])
  return bridge
}
