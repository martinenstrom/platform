/**
 * The backup passphrase, kept for unattended exports — and only there.
 *
 * The desktop host lends the operating system's own protection (Electron
 * `safeStorage`, DPAPI on Windows) through a narrow hook on `globalThis`;
 * the application never imports the host. With the hook the passphrase is
 * sealed into `config/backup-passphrase.bin`, readable only by this Windows
 * account on this computer. Without it — development, tests — the
 * passphrase lives in the process's memory and is gone with it, and the
 * status says so. It is never logged, never in source, never in Git.
 */

import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DataLayout } from '~/infrastructure/platform/dataDir'

export const PASSPHRASE_FILE = 'backup-passphrase.bin'

/** What the host lends: symmetric sealing bound to the account. */
export interface HostSecrets {
  available: boolean
  /** UTF-8 text → base64 of the sealed bytes. */
  encrypt(text: string): string
  /** base64 of sealed bytes → UTF-8 text. */
  decrypt(sealed: string): string
}

const SECRETS_KEY = Symbol.for('financial-os:secrets')
const MEMORY_KEY = Symbol.for('financial-os:backup-passphrase')
const registry = globalThis as unknown as {
  [SECRETS_KEY]?: HostSecrets
  [MEMORY_KEY]?: string | null
}

export function hostSecrets(): HostSecrets | null {
  const secrets = registry[SECRETS_KEY]
  return secrets && secrets.available ? secrets : null
}

/** The host registers its sealing here; a test may register a fake. */
export function registerHostSecrets(secrets: HostSecrets | null): void {
  if (secrets) registry[SECRETS_KEY] = secrets
  else delete registry[SECRETS_KEY]
}

export type PassphraseKeeping = 'sealed-on-this-computer' | 'this-session-only' | 'none'

export function passphraseKeeping(layout: DataLayout): PassphraseKeeping {
  if (hostSecrets() && existsSync(join(layout.config, PASSPHRASE_FILE)))
    return 'sealed-on-this-computer'
  if (registry[MEMORY_KEY]) return 'this-session-only'
  return 'none'
}

/** Keep the passphrase: sealed by the host where it can be, in memory where it cannot. */
export function storePassphrase(layout: DataLayout, passphrase: string): PassphraseKeeping {
  registry[MEMORY_KEY] = passphrase
  const secrets = hostSecrets()
  if (!secrets) return 'this-session-only'
  writeFileSync(join(layout.config, PASSPHRASE_FILE), secrets.encrypt(passphrase), 'utf8')
  return 'sealed-on-this-computer'
}

export function loadPassphrase(layout: DataLayout): string | null {
  const inMemory = registry[MEMORY_KEY]
  if (inMemory) return inMemory
  const secrets = hostSecrets()
  const path = join(layout.config, PASSPHRASE_FILE)
  if (!secrets || !existsSync(path)) return null
  try {
    const passphrase = secrets.decrypt(readFileSync(path, 'utf8'))
    registry[MEMORY_KEY] = passphrase
    return passphrase
  } catch {
    return null
  }
}

export function clearPassphrase(layout: DataLayout): void {
  registry[MEMORY_KEY] = null
  const path = join(layout.config, PASSPHRASE_FILE)
  if (existsSync(path)) unlinkSync(path)
}
