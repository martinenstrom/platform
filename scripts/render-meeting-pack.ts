/**
 * Render sample Meeting Packs to files for inspection — the full pack and
 * the executive brief for one or more clients, over the synthetic record
 * at a given date. No server, no store, no version counter: the files are
 * written where asked and nothing else happens.
 *
 *   npx vite-node scripts/render-meeting-pack.ts -- <outDir> [today] [clientId ...]
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { meetingPack } from '~/application/advisory/meetingPack'
import type { AdvisoryContext } from '~/application/advisory/ports'
import { FakeClock } from '~/domain/shared/clock'
import { createSyntheticAdvisoryRepositories } from '~/infrastructure/advisory/syntheticRepositories'
import { syntheticClients } from '~/infrastructure/advisory/syntheticClients'
import { renderPdf } from '~/infrastructure/documents/pdf'
import { renderPptx } from '~/infrastructure/documents/pptx'
import { composePackDocument } from '~/presentation/documents/meetingPackDocument'

const args = process.argv.slice(2).filter((a) => a !== '--')
const outDir = args[0] ?? '.probe/meeting-pack/refine'
const today = args[1] ?? new Date().toISOString().slice(0, 10)
const clients = args.length > 2 ? args.slice(2) : ['cl-dahlqvist', 'cl-alvarsson']

const context: AdvisoryContext = {
  repositories: createSyntheticAdvisoryRepositories(syntheticClients(today)),
  clock: new FakeClock(`${today}T10:00:00.000Z`),
}
mkdirSync(outDir, { recursive: true })

for (const clientId of clients) {
  for (const depth of ['full', 'executive'] as const) {
    const pack = await meetingPack(context, clientId, depth)
    if (!pack) {
      console.log(`no pack for ${clientId}`)
      continue
    }
    const doc = composePackDocument(pack)
    const base = join(outDir, `${doc.fileBaseName}`)
    const [pptx, pdf] = await Promise.all([renderPptx(doc), renderPdf(doc)])
    writeFileSync(`${base}.pptx`, pptx)
    writeFileSync(`${base}.pdf`, pdf)
    writeFileSync(`${base}.json`, JSON.stringify(doc, null, 2))
    console.log(
      `${doc.fileBaseName}: ${doc.slides.length} slides (${doc.coreCount} core, ${doc.appendixCount} appendix) · readiness ${pack.readiness.state} · pptx ${pptx.length} B · pdf ${pdf.length} B`,
    )
  }
}
