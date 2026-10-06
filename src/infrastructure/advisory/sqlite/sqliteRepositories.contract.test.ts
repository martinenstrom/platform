import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll } from 'vitest'
import { describeAdvisoryRepositoryContract } from '../advisoryRepositoryContract'
import { openDatabase, type Database } from './database'
import { migrate } from './migrate'
import { createSqliteAdvisoryRepositories, writeSeed } from './repositories'

const dir = mkdtempSync(join(tmpdir(), 'fos-contract-'))
const opened: Database[] = []
afterAll(() => {
  for (const db of opened) db.close()
  rmSync(dir, { recursive: true, force: true })
})

describeAdvisoryRepositoryContract({
  name: 'SQLite record (file, WAL)',
  open: async (seed) => {
    const db = openDatabase(join(dir, `contract-${opened.length + 1}.db`))
    opened.push(db)
    const outcome = await migrate(db)
    if (!outcome.ok) throw new Error(`migration refused: ${outcome.code}`)
    await writeSeed(db, seed)
    return createSqliteAdvisoryRepositories(db)
  },
})
