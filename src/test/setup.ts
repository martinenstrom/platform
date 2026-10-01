import '@testing-library/jest-dom/vitest'

/**
 * jsdom doesn't implement matchMedia — CountryExplorer's reduced-motion
 * detection needs it. A file that opts into the node environment (the
 * document renderers) has no window at all.
 */
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string): MediaQueryList => {
    return {
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    } as MediaQueryList
  }
}
