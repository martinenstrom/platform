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
import {
  ARTEFACTS,
  authenticodeOf,
  checksumsText,
  describeBuild,
  signingPlan,
  subjectMatches,
  verifyManifest,
  writeManifest,
  // @ts-expect-error — the desktop host and its packaging are plain JavaScript by design.
} from './buildManifest.mjs'

describe.runIf(process.platform === 'win32')('the Authenticode query', () => {
  it('reads a Microsoft-signed binary as Valid, by its subject, timestamped — and a plain file as NotSigned', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fos-authenticode-'))
    try {
      const signed = authenticodeOf(process.execPath, join(dir, 'q1.ps1'))
      expect(signed.error).toBeNull()
      expect(signed.status).toBe('Valid')
      expect(signed.subject).toMatch(/Node\.js|OpenJS|Microsoft/)
      /* The certificate's own signature algorithm is the CA's choice within SHA-2; the file digest is SHA-256 by our signing. */
      expect(signed.algorithm).toMatch(/sha(256|384|512)/i)
      expect(signed.timestamped).toBe(true)
      /* A signable file that carries no signature (a text file is "UnknownError": not a signable type at all). */
      const plain = join(dir, 'plain.ps1')
      writeFileSync(plain, "Write-Output 'unsigned'\n")
      const unsigned = authenticodeOf(plain, join(dir, 'q2.ps1'))
      expect(unsigned).toMatchObject({ status: 'NotSigned', subject: null, timestamped: false, error: null })
      expect(subjectMatches(signed.subject, 'nobody')).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('the publisher check', () => {
  it('matches the certificate’s CN against the publisher with or without the prefix, and nothing else', () => {
    expect(subjectMatches('CN=Martin Enström, O=Martin Enström, L=Stockholm, C=SE', 'CN=Martin Enström')).toBe(true)
    expect(subjectMatches('CN=Martin Enström, C=SE', 'Martin Enström')).toBe(true)
    expect(subjectMatches('CN=Someone Else, C=SE', 'CN=Martin Enström')).toBe(false)
    expect(subjectMatches('O=Martin Enström, C=SE', 'Martin Enström')).toBe(false)
    expect(subjectMatches(null, 'CN=Martin Enström')).toBe(false)
    expect(subjectMatches('CN=Martin Enström', '')).toBe(false)
  })
})

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
    expect(manifest.commit).toBeNull()
    expect(await verifyManifest(dir)).toMatchObject({ ok: true, problems: [] })
    /* The checksums file names each artefact by its file name, sha256sum style. */
    const lines = checksumsText(manifest).trimEnd().split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[2]).toMatch(/^[0-9a-f]{64} \*Financial-OS-Setup-0\.1\.0\.exe$/)
    /* Nothing of a credential: the manifest carries the mode and the publisher only. */
    expect(JSON.stringify(manifest)).not.toMatch(/secret|password|AZURE_/i)
  })

  it('records the commit the build comes from when one is given', async () => {
    plant()
    const manifest = await describeBuild(dir, {
      buildId: 'b3',
      version: '0.1.0',
      signing: { mode: 'azure', publisher: 'CN=Martin Enström' },
      commit: 'a84aef8a84aef8a84aef8a84aef8a84aef8a84aef',
    })
    expect(manifest).toMatchObject({ commit: 'a84aef8a84aef8a84aef8a84aef8a84aef8a84aef', signing: { mode: 'azure', publisher: 'CN=Martin Enström' } })
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
