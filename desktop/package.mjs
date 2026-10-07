/**
 * The Windows package, as one coherent build.
 *
 *   node desktop/package.mjs              build, sign per the environment, verify, publish
 *   node desktop/package.mjs --verify     re-check release/current against its manifest
 *   node desktop/package.mjs --install-copy
 *                                         copy release/current into the per-user Programs
 *                                         folder with both shortcuts (the path an installer
 *                                         takes where the NSIS installer itself cannot run)
 *
 * The application is built, then packaged into a STAGING directory that
 * nothing else reads; only when the executable, the archive and the
 * installer all exist — and carry a valid signature where one was asked
 * for — is the staging directory renamed to `release/current`, in one
 * move. An install copies from `release/current` after re-hashing it
 * against the manifest. The earlier defect this guards against: an
 * executable and an archive copied from two different runs, which the
 * executable's embedded integrity check rejects silently at start.
 *
 * Signing reads the environment only (see buildManifest.mjs). Nothing of it
 * is written to the repository, the manifest or the log.
 */

import { execFileSync, spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ARTEFACTS,
  checksumsText,
  describeBuild,
  hashFile,
  SIGNED_FILES,
  signingPlan,
  subjectMatches,
  verifyManifest,
  writeManifest,
} from './buildManifest.mjs'

const require = createRequire(import.meta.url)
const here = dirname(fileURLToPath(import.meta.url))
const projectDir = resolve(here, '..')
const releaseDir = join(projectDir, 'release')
const currentDir = join(releaseDir, 'current')
const lockFile = join(releaseDir, '.packaging.lock')
const log = (...args) => console.log('[package]', ...args)

const mode = process.argv[2] ?? '--build'
if (mode === '--verify') {
  const result = await verifyManifest(currentDir)
  log(result.ok ? 'release/current is one coherent build' : 'release/current is NOT coherent')
  for (const problem of result.problems) log('  -', problem)
  if (result.manifest)
    log(`  build ${result.manifest.buildId} · ${result.manifest.version} · signing ${result.manifest.signing.mode}`)
  process.exit(result.ok ? 0 : 1)
} else if (mode === '--install-copy') {
  await installCopy()
} else {
  await buildAndPublish()
}

/* ------------------------------------------------------------------ build */

async function buildAndPublish() {
  const version = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf8')).version
  const signing = signingPlan(process.env)
  if (!signing.ok) {
    log(`signing mode "${signing.mode}" is not complete; missing: ${signing.missing.join(', ')}`)
    process.exit(2)
  }
  log(`signing: ${signing.mode}${signing.publisher ? ` as "${signing.publisher}"` : ''}`)
  if (signing.mode === 'unsigned')
    log('WARNING: an unsigned build. Windows Smart App Control judges it by file hash; see docs/windows-code-signing.md')

  mkdirSync(releaseDir, { recursive: true })
  if (existsSync(lockFile)) {
    log(`another package run holds ${lockFile}; remove it only if no build is running`)
    process.exit(3)
  }
  writeFileSync(lockFile, `${process.pid} ${new Date().toISOString()}\n`)
  const buildId = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15)
  const staging = join(releaseDir, `.staging-${buildId}`)
  let failed = false
  try {
    log('building the application (vite build)')
    run('npx', ['vite', 'build'])

    log(`packaging into ${staging}`)
    const { build, Platform, Arch } = require('electron-builder')
    await build({
      targets: Platform.WINDOWS.createTarget('nsis', Arch.x64),
      config: {
        extends: './electron-builder.yml',
        directories: { output: staging },
        ...(signing.config ?? {}),
      },
    })

    for (const rel of ARTEFACTS) {
      if (!existsSync(join(staging, rel))) throw new Error(`the run did not produce ${rel}`)
    }
    const signatures = {}
    for (const rel of SIGNED_FILES) {
      const status = signatureOf(join(staging, rel))
      signatures[rel] = status
      log(`signature ${rel}: ${status.status}${status.subject ? ` · ${status.subject}` : ''}${status.algorithm ? ` · ${status.algorithm}` : ''}${status.timestamped ? ' · timestamped' : ''}`)
      if (signing.mode === 'unsigned') continue
      if (status.status !== 'Valid')
        throw new Error(`${rel} is not validly signed (${status.status}) although signing was requested`)
      if (!subjectMatches(status.subject, signing.publisher))
        throw new Error(`${rel} is signed by "${status.subject}", not by the configured publisher`)
      if (!status.timestamped) throw new Error(`${rel} carries no timestamp`)
      if (!/sha256/iu.test(status.algorithm ?? '')) throw new Error(`${rel} is not signed with a SHA-256 chain`)
    }
    const commit = commitSha()
    const manifest = await describeBuild(staging, { buildId, version, signing, signatures, commit })
    writeManifest(staging, manifest)
    writeFileSync(join(staging, 'checksums.sha256'), checksumsText(manifest), 'utf8')

    if (existsSync(currentDir)) rmSync(currentDir, { recursive: true, force: true })
    renameSync(staging, currentDir)
    log(`published ${currentDir} · build ${buildId} · ${version} · ${signing.mode} · commit ${commit ?? 'unknown'}`)
  } catch (error) {
    failed = true
    const message = error instanceof Error ? error.message : String(error)
    if (/spawn UNKNOWN/u.test(message))
      log(
        'the installer step was stopped by Windows application control: electron-builder runs the freshly built, not yet signed installer stub to produce the uninstaller, and Smart App Control refuses to run it here. Build the installer on a machine where that stub may run (a CI runner), or ask the person to decide about Smart App Control; nothing was published.',
      )
    else {
      /* The whole message: a tool's failure carries its own output in the lines after the first. */
      log('failed:')
      for (const line of message.split('\n').slice(0, 60)) log('   ', line)
    }
    rmSync(staging, { recursive: true, force: true })
  } finally {
    if (existsSync(lockFile)) unlinkSync(lockFile)
  }
  /* A failed run is a failed process, whatever a tool left behind in the exit code. */
  if (failed) process.exit(1)
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: projectDir, stdio: 'inherit', shell: process.platform === 'win32' })
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited with ${result.status}`)
}

/** The commit the build comes from: the runner's, else the working tree's head. */
function commitSha() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: projectDir, encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

/** Authenticode status of a file, as Windows reports it; never a guess. */
function signatureOf(path) {
  if (process.platform !== 'win32')
    return { status: 'NotChecked', subject: null, algorithm: null, timestamped: false }
  const script = `$s = Get-AuthenticodeSignature -LiteralPath '${path.replace(/'/g, "''")}'; [pscustomobject]@{ status = [string]$s.Status; subject = $(if ($s.SignerCertificate) { $s.SignerCertificate.Subject } else { $null }); algorithm = $(if ($s.SignerCertificate) { $s.SignerCertificate.SignatureAlgorithm.FriendlyName } else { $null }); timestamped = ($null -ne $s.TimeStamperCertificate) } | ConvertTo-Json -Compress`
  const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
  })
  return JSON.parse(out)
}

/* ---------------------------------------------------------- install copy */

/** The per-user copy an installer would make, from a verified published build only. */
async function installCopy() {
  if (process.platform !== 'win32') throw new Error('the install copy is a Windows act')
  const result = await verifyManifest(currentDir)
  if (!result.ok) {
    log('refusing to copy: release/current is not one coherent build')
    for (const problem of result.problems) log('  -', problem)
    process.exit(1)
  }
  const target = join(process.env.LOCALAPPDATA, 'Programs', 'Financial OS')
  const source = join(currentDir, 'win-unpacked')
  const script = `
    $src = '${source.replace(/'/g, "''")}'; $dst = '${target.replace(/'/g, "''")}'
    if (Get-Process -Name 'Financial OS' -ErrorAction SilentlyContinue) { Write-Output 'RUNNING'; exit 4 }
    New-Item -ItemType Directory -Force -Path $dst | Out-Null
    $null = & robocopy $src $dst /MIR /NFL /NDL /NJH /NJS /NP /R:2 /W:1
    if ($LASTEXITCODE -ge 8) { Write-Output "ROBOCOPY $LASTEXITCODE"; exit 5 }
    $exe = Join-Path $dst 'Financial OS.exe'
    $sh = New-Object -ComObject WScript.Shell
    foreach ($lnk in @((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Financial OS.lnk'), (Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs\\Financial OS.lnk'))) {
      $s = $sh.CreateShortcut($lnk); $s.TargetPath = $exe; $s.WorkingDirectory = $dst; $s.IconLocation = "$exe,0"; $s.Description = 'Financial OS'; $s.Save()
      Write-Output ("SHORTCUT " + $lnk)
    }
    Write-Output ("INSTALLED " + $exe)
  `
  const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
  })
  for (const line of out.split(/\r?\n/).filter(Boolean)) log(line)
  if (/^RUNNING/mu.test(out)) {
    log('Financial OS is running; close it before replacing the application')
    process.exit(4)
  }
  const copied = await Promise.all(
    ['Financial OS.exe', 'resources/app.asar'].map(
      async (rel) => (await hashFile(join(target, rel))) === (await hashFile(join(source, rel))),
    ),
  )
  if (!copied.every(Boolean)) {
    log('the copied executable or archive does not match the published build')
    process.exit(6)
  }
  log(`the installed copy matches build ${result.manifest.buildId} (${result.manifest.signing.mode})`)
}
