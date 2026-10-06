/**
 * Where Financial OS keeps a person's data on this computer.
 *
 * One root under the operating system's application-data directory — the
 * desktop host resolves it (`app.getPath('userData')`), never a hardcoded
 * user path — and beneath it the database, the documents, the backups, the
 * logs and the configuration. Nothing of a person's lives in the
 * repository, the build output or a temporary folder.
 */

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

export const DATABASE_FILE = 'financial-os.db'

export function dataLayout(root) {
  const layout = {
    root,
    database: join(root, DATABASE_FILE),
    documents: join(root, 'documents'),
    meetingPacks: join(root, 'documents', 'meeting-packs'),
    reports: join(root, 'documents', 'reports'),
    attachments: join(root, 'documents', 'attachments'),
    backups: join(root, 'backups'),
    snapshots: join(root, 'backups', 'snapshots'),
    preMigration: join(root, 'backups', 'pre-migration'),
    bundles: join(root, 'backups', 'bundles'),
    logs: join(root, 'logs'),
    config: join(root, 'config'),
  }
  for (const dir of [
    layout.root,
    layout.documents,
    layout.meetingPacks,
    layout.reports,
    layout.attachments,
    layout.backups,
    layout.snapshots,
    layout.preMigration,
    layout.bundles,
    layout.logs,
    layout.config,
  ]) {
    mkdirSync(dir, { recursive: true })
  }
  return layout
}
