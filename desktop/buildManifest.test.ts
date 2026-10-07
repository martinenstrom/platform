/**
 * The signing plan is read from the environment and never falls through
 * half-configured to an unsigned build; the manifest describes one run's
 * artefacts and refuses a directory whose files changed or went missing —
 * a planted alteration fails, the untouched build passes.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
// @ts-expect-error — the desktop host and its packaging are plain JavaScript by design.
import { ARTEFACTS, describeBuild, signingPlan, verifyManifest, writeManifest } from './buildManifest.mjs'

describe('the signing plan', () => {
  it('is unsigned, and says so, when nothing is set', () => {
    expect(signingPlan({})).toMatchObject({ mode: 'unsigned', ok: true, publisher: null })
  })

  it('refuses an unsigned build when one is required', () => {
    const plan = signingPlan({ FINANCIAL_OS_SIGN_REQUIRE: '1' })
    expect(plan.mode).toBe('unsigned')
    expect(plan.ok).toBe(false)
    expect(plan.missing[0]).toMatch(/Trusted Signing|certificate/)
  })

  it('maps a complete Trusted Signing environment to electron-builder’s Azure options, without the secret', () => {
    const plan = signingPlan({
      AZURE_TENANT_ID: 't',
      AZURE_CLIENT_ID: 'c',
      AZURE_CLIENT_SECRET: 'very-secret',
      FINANCIAL_OS_SIGN_ENDPOINT: 'https://weu.codesigning.azure.net',
      FINANCIAL_OS_SIGN_ACCOUNT: 'financial-os-signing',
      FINANCIAL_OS_SIGN_PROFILE: 'financial-os-public',
      FINANCIAL_OS_SIGN_PUBLISHER: 'CN=Martin Enström',
    })
    expect(plan).toMatchObject({ mode: 'azure', ok: true, publisher: 'CN=Martin Enström' })
    expect(plan.config.win.azureSignOptions).toEqual({
      publisherName: 'CN=Martin Enström',
      endpoint: 'https://weu.codesigning.azure.net',
      codeSigningAccountName: 'financial-os-signing',
      certificateProfileName: 'financial-os-public',
    })
    expect(JSON.stringify(plan)).not.toContain('very-secret')
  })

  it('refuses a half-configured Trusted Signing environment and names what is missing', () => {
    const plan = signingPlan({ AZURE_TENANT_ID: 't', FINANCIAL_OS_SIGN_ACCOUNT: 'a' })
    expect(plan.mode).toBe('azure')
    expect(plan.ok).toBe(false)
    expect(plan.missing).toEqual([
      'AZURE_CLIENT_ID',
      'AZURE_CLIENT_SECRET',
      'FINANCIAL_OS_SIGN_ENDPOINT',
      'FINANCIAL_OS_SIGN_PROFILE',
      'FINANCIAL_OS_SIGN_PUBLISHER',
    ])
    expect(plan.config).toBeNull()
  })

  it('maps a certificate in the Windows store to signtool options with an RFC 3161 timestamp', () => {
    const plan = signingPlan({ FINANCIAL_OS_SIGN_SUBJECT: 'Martin Enström' })
    expect(plan).toMatchObject({ mode: 'certificate', ok: true, publisher: 'Martin Enström' })
    expect(plan.config.win.signtoolOptions).toEqual({
      certificateSubjectName: 'Martin Enström',
      publisherName: 'Martin Enström',
      signingHashAlgorithms: ['sha256'],
      rfc3161TimeStampServer: 'http://timestamp.digicert.com',
    })
  })
})

describe('the build manifest', () => {
  let dir: string
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  function plant() {
    dir = mkdtempSync(join(tmpdir(), 'fos-build-'))
    for (const rel of ARTEFACTS) {
      const path = join(dir, rel)
      mkdirSync(join(path, '..'), { recursive: true })
      writeFileSync(path, `content of ${rel}`)
    }
  }

  it('describes one run and verifies it unchanged', async () => {
    plant()
    const manifest = await describeBuild(dir, {
      buildId: 'b1',
      version: '0.1.0',
      signing: { mode: 'unsigned', publisher: null },
      signatures: { 'win-unpacked/Financial OS.exe': { status: 'NotSigned', subject: null, timestamped: false } },
    })
    writeManifest(dir, manifest)
    expect(manifest.files.map((f: { path: string }) => f.path)).toEqual([...ARTEFACTS])
    expect(manifest.files[0]).toMatchObject({ bytes: 'content of win-unpacked/Financial OS.exe'.length, signature: { status: 'NotSigned' } })
    expect(await verifyManifest(dir)).toMatchObject({ ok: true, problems: [] })
  })

  it('refuses an archive altered after the run, and a missing installer', async () => {
    plant()
    writeManifest(
      dir,
      await describeBuild(dir, { buildId: 'b2', version: '0.1.0', signing: { mode: 'unsigned', publisher: null } }),
    )
    writeFileSync(join(dir, 'win-unpacked/resources/app.asar'), 'another run’s archive')
    rmSync(join(dir, 'Financial-OS-Setup-0.1.0.exe'))
    const result = await verifyManifest(dir)
    expect(result.ok).toBe(false)
    expect(result.problems).toEqual([
      'changed since the build: win-unpacked/resources/app.asar',
      'missing: Financial-OS-Setup-0.1.0.exe',
    ])
  })

  it('refuses a directory without a manifest', async () => {
    plant()
    const result = await verifyManifest(dir)
    expect(result.ok).toBe(false)
    expect(result.problems[0]).toMatch(/no build-manifest\.json/)
  })
})
