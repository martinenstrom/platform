/**
 * The Meeting Pack preview, rendered against the record and driven through
 * the workflow: readiness with its reasons, the contents, the Executive
 * Brief on screen, a generation that hands the file over and lists the
 * version, a blocked pack that cannot be generated, and a review pack that
 * can be generated anyway.
 */

import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { meetingPack, type MeetingPack } from '~/application/advisory/meetingPack'
import type { AdvisoryContext } from '~/application/advisory/ports'
import { FakeClock } from '~/domain/shared/clock'
import { createSyntheticAdvisoryRepositories } from '~/infrastructure/advisory/syntheticRepositories'
import { syntheticClients } from '~/infrastructure/advisory/syntheticClients'
import type { GeneratedPackMeta } from '~/application/advisory/meetingPackVersions'
import { renderInRouter } from '~/test/renderInRouter'
import { MeetingPackPreview } from './MeetingPackPreview'
import type { MeetingPackActions, PackFile } from './meetingPackActions'

const TODAY = '2026-09-23'

function contextAt(): AdvisoryContext {
  return {
    repositories: createSyntheticAdvisoryRepositories(syntheticClients(TODAY)),
    clock: new FakeClock(`${TODAY}T10:00:00.000Z`),
  }
}

function metaFor(
  pack: MeetingPack,
  version: number,
  format: 'pptx' | 'pdf',
): GeneratedPackMeta {
  return {
    id: `pack-${version}-${format}`,
    version,
    generatedAt: `${TODAY}T10:0${version}:00.000Z`,
    sourceAsOf: TODAY,
    clientId: pack.identity.clientId,
    meetingId: pack.meeting.eventId,
    meetingDate: pack.meeting.date,
    audience: 'INTERNAL_ADVISOR',
    format,
    depth: pack.depth,
    fileName: `Anna_Per_Dahlqvist_Motesunderlag_2026-10-03_v${version}.${format}`,
    byteLength: 120_000,
    fingerprint: pack.fingerprint,
    slideCount: pack.outline.core.length + pack.outline.appendix.length,
    coreCount: pack.outline.core.length,
    appendixCount: pack.outline.appendix.length,
    filePath: null,
  }
}

function actionsFor(pack: MeetingPack) {
  const saved: PackFile[] = []
  const generated: string[][] = []
  const actions: MeetingPackActions = {
    async generate(_depth, formats) {
      generated.push([...formats])
      const files = formats.map((format) => ({
        meta: metaFor(pack, 1, format),
        base64: Buffer.from(`${format}-bytes`).toString('base64'),
        reused: false,
      }))
      return {
        ok: true,
        pack,
        document: {
          coreCount: pack.outline.core.length,
          appendixCount: pack.outline.appendix.length,
          fileBaseName: 'x',
        },
        files,
        versions: files.map((f) => f.meta),
      }
    },
    async download(id) {
      const format = id.endsWith('pdf') ? 'pdf' : 'pptx'
      return {
        ok: true,
        meta: metaFor(pack, 1, format),
        base64: Buffer.from('again').toString('base64'),
      }
    },
    save(file) {
      saved.push(file)
    },
  }
  return { actions, saved, generated }
}

async function renderPreview(clientId: string, depth: 'executive' | 'full' = 'full') {
  const pack = (await meetingPack(contextAt(), clientId, depth))!
  const { actions, saved, generated } = actionsFor(pack)
  const rendered = await renderInRouter(
    <MeetingPackPreview
      pack={pack}
      versions={[]}
      depth={depth}
      requestedFormat={null}
      actions={actions}
    />,
    [
      '/clients/$clientId',
      '/clients/$clientId/meeting-prep',
      '/clients/$clientId/meeting-pack',
    ],
  )
  return { rendered, pack, saved, generated }
}

describe('Anna & Per — a ready pack', () => {
  it('shows the client, the meeting, the readiness, the contents and the brief on screen', async () => {
    const { rendered, pack } = await renderPreview('cl-dahlqvist')
    expect(
      screen.getByRole('heading', { level: 1, name: 'Anna & Per Dahlqvist' }),
    ).toBeInTheDocument()
    const status = screen.getByRole('region', { name: 'Status' })
    expect(within(status).getByText('Redo')).toBeInTheDocument()
    expect(within(status).getByText(/utan förbehåll/)).toBeInTheDocument()
    const contents = screen.getByRole('region', { name: 'Innehåll' })
    expect(within(contents).getAllByRole('listitem').length).toBe(
      pack.outline.core.length + pack.outline.appendix.length,
    )
    expect(within(contents).getByText('Executive meeting brief')).toBeInTheDocument()
    const article = screen.getByRole('article', { name: 'Underlag på skärmen' })
    expect(within(article).getByText('Mötets huvudfokus')).toBeInTheDocument()
    expect(within(article).getByText('Topp 3 prioriteringar')).toBeInTheDocument()
    expect(
      within(article).getAllByText(/KONFIDENTIELLT · INTERNT RÅDGIVARMATERIAL/).length,
    ).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: 'Granska underlag' })).toHaveAttribute(
      'href',
      '/clients/cl-dahlqvist/meeting-prep',
    )
    rendered.unmount()
  })

  it('generates both formats, hands both files over and lists the version', async () => {
    const user = userEvent.setup()
    const { rendered, saved, generated } = await renderPreview('cl-dahlqvist')
    await user.click(screen.getByRole('button', { name: /Generera båda/ }))
    await waitFor(() => expect(saved.length).toBe(2))
    expect(generated).toEqual([['pptx', 'pdf']])
    expect(saved.map((f) => f.format)).toEqual(['pptx', 'pdf'])
    expect(saved[0]!.fileName).toBe('Anna_Per_Dahlqvist_Motesunderlag_2026-10-03_v1.pptx')
    const versions = screen.getByRole('region', { name: 'Genererade versioner' })
    expect(within(versions).getAllByText('v1').length).toBe(2)
    expect(within(versions).getByText(/PowerPoint · \d+ bilder/)).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/Version 1 genererad/)
    /* An earlier version is fetched again, never regenerated. */
    await user.click(within(versions).getAllByRole('button', { name: /Ladda ner/ })[0]!)
    await waitFor(() => expect(saved.length).toBe(3))
    rendered.unmount()
  })

  it('switches depth through the URL, not through state', async () => {
    const { rendered } = await renderPreview('cl-dahlqvist', 'executive')
    const nav = screen.getByRole('navigation', { name: 'Djup' })
    expect(within(nav).getByRole('link', { name: 'Executive brief' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(
      within(nav).getByRole('link', { name: 'Fullt mötesunderlag' }),
    ).toHaveAttribute('href', '/clients/cl-dahlqvist/meeting-pack?depth=full')
    const contents = screen.getByRole('region', { name: 'Innehåll' })
    expect(within(contents).getAllByRole('listitem').length).toBeLessThanOrEqual(5)
    rendered.unmount()
  })
})

describe('review and blocked packs', () => {
  it("lists Henrik's review reasons and still allows generation", async () => {
    const { rendered } = await renderPreview('cl-alvarsson')
    const status = screen.getByRole('region', { name: 'Status' })
    expect(within(status).getByText('Granska')).toBeInTheDocument()
    expect(within(status).getByText(/dagar gammal/)).toBeInTheDocument()
    expect(within(status).getByText(/Generera ändå/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Generera PowerPoint/ })).toBeEnabled()
    rendered.unmount()
  })

  it('disables generation for a blocked record and says why', async () => {
    const seed = syntheticClients(TODAY)
    const context: AdvisoryContext = {
      repositories: createSyntheticAdvisoryRepositories({
        ...seed,
        assets: seed.assets.filter((a) => a.clientId !== 'cl-ceder'),
        portfolios: seed.portfolios.filter((p) => p.clientId !== 'cl-ceder'),
      }),
      clock: new FakeClock(`${TODAY}T10:00:00.000Z`),
    }
    const pack = (await meetingPack(context, 'cl-ceder'))!
    const { actions } = actionsFor(pack)
    const rendered = await renderInRouter(
      <MeetingPackPreview
        pack={pack}
        versions={[]}
        depth="full"
        requestedFormat={null}
        actions={actions}
      />,
      [
        '/clients/$clientId',
        '/clients/$clientId/meeting-prep',
        '/clients/$clientId/meeting-pack',
      ],
    )
    const status = screen.getByRole('region', { name: 'Status' })
    expect(within(status).getByText('Blockerad')).toBeInTheDocument()
    expect(within(status).getByText(/Inga värderade tillgångar/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Generera PowerPoint/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Generera PDF/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Generera båda/ })).toBeDisabled()
    rendered.unmount()
  })
})
