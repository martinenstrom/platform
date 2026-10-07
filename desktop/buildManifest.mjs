/**
 * One coherent Windows build, stated and checked.
 *
 * A package run produces three artefacts that must come from the same run:
 * the executable (which embeds the archive's integrity hash), the archive,
 * and the installer. The manifest records their hashes and the signing that
 * was applied; `verifyManifest` re-reads the files so an install copies only
 * what one run produced. The signing plan is read from the environment
 * alone — a certificate's password, a service principal's secret — and is
 * never written anywhere: the manifest carries the publisher and the mode,
 * not a credential.
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const MANIFEST_FILE = 'build-manifest.json'

/** The artefacts one run must produce, relative to the published build directory. */
export const ARTEFACTS = Object.freeze([
  'win-unpacked/Financial OS.exe',
  'win-unpacked/resources/app.asar',
  'Financial-OS-Setup-0.1.0.exe',
])

/** The files that must carry a signature when the build is signed. */
export const SIGNED_FILES = Object.freeze([
  'win-unpacked/Financial OS.exe',
  'Financial-OS-Setup-0.1.0.exe',
])

/* ---------------------------------------------------------------- signing */

const AZURE_AUTH = ['AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET']
const AZURE_SIGN = [
  'FINANCIAL_OS_SIGN_ENDPOINT',
  'FINANCIAL_OS_SIGN_ACCOUNT',
  'FINANCIAL_OS_SIGN_PROFILE',
  'FINANCIAL_OS_SIGN_PUBLISHER',
]

/**
 * How this run signs, from the environment:
 *
 *   azure        Microsoft Trusted Signing — the three Entra variables Microsoft's
 *                EnvironmentCredential reads, and the account, profile, endpoint and
 *                publisher of the certificate profile.
 *   certificate  signtool with a certificate in the Windows store (a hardware token
 *                or an EV certificate), named by its subject; or a .pfx through
 *                electron-builder's own WIN_CSC_LINK / WIN_CSC_KEY_PASSWORD.
 *   unsigned     nothing set. Allowed, and said plainly; FINANCIAL_OS_SIGN_REQUIRE=1
 *                turns it into a refusal.
 *
 * A half-configured mode is a refusal with the missing names, never a silent
 * fall-through to an unsigned build.
 */
export function signingPlan(env = process.env) {
  const has = (name) => typeof env[name] === 'string' && env[name].trim().length > 0
  const azureSign = AZURE_SIGN.filter(has)
  const azureAuth = AZURE_AUTH.filter(has)
  if (azureSign.length > 0 || azureAuth.length > 0) {
    const missing = [...AZURE_AUTH, ...AZURE_SIGN].filter((name) => !has(name))
    if (missing.length > 0) return { mode: 'azure', ok: false, missing, publisher: null, config: null }
    return {
      mode: 'azure',
      ok: true,
      missing: [],
      publisher: env.FINANCIAL_OS_SIGN_PUBLISHER.trim(),
      config: {
        win: {
          azureSignOptions: {
            publisherName: env.FINANCIAL_OS_SIGN_PUBLISHER.trim(),
            endpoint: env.FINANCIAL_OS_SIGN_ENDPOINT.trim(),
            codeSigningAccountName: env.FINANCIAL_OS_SIGN_ACCOUNT.trim(),
            certificateProfileName: env.FINANCIAL_OS_SIGN_PROFILE.trim(),
            ...(has('FINANCIAL_OS_SIGN_TIMESTAMP')
              ? { timestampRfc3161: env.FINANCIAL_OS_SIGN_TIMESTAMP.trim() }
              : {}),
          },
        },
      },
    }
  }
  if (has('FINANCIAL_OS_SIGN_SUBJECT') || has('WIN_CSC_LINK') || has('CSC_LINK')) {
    const subject = has('FINANCIAL_OS_SIGN_SUBJECT') ? env.FINANCIAL_OS_SIGN_SUBJECT.trim() : null
    const publisher = has('FINANCIAL_OS_SIGN_PUBLISHER') ? env.FINANCIAL_OS_SIGN_PUBLISHER.trim() : subject
    return {
      mode: 'certificate',
      ok: true,
      missing: [],
      publisher,
      config: {
        win: {
          signtoolOptions: {
            ...(subject ? { certificateSubjectName: subject } : {}),
            ...(publisher ? { publisherName: publisher } : {}),
            signingHashAlgorithms: ['sha256'],
            rfc3161TimeStampServer: has('FINANCIAL_OS_SIGN_TIMESTAMP')
              ? env.FINANCIAL_OS_SIGN_TIMESTAMP.trim()
              : 'http://timestamp.digicert.com',
          },
        },
      },
    }
  }
  if (has('FINANCIAL_OS_SIGN_REQUIRE') && env.FINANCIAL_OS_SIGN_REQUIRE.trim() === '1') {
    return {
      mode: 'unsigned',
      ok: false,
      missing: ['a signing mode: Trusted Signing (AZURE_* + FINANCIAL_OS_SIGN_*) or a certificate (FINANCIAL_OS_SIGN_SUBJECT or WIN_CSC_LINK)'],
      publisher: null,
      config: null,
    }
  }
  return { mode: 'unsigned', ok: true, missing: [], publisher: null, config: { win: {} } }
}

/* --------------------------------------------------------------- manifest */

export function hashFile(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')))
  })
}

/** Describe the published build: every artefact's hash and size, the signing, the commit, the run. */
export async function describeBuild(dir, { buildId, version, signing, signatures = {}, commit = null }) {
  const files = []
  for (const rel of ARTEFACTS) {
    const path = join(dir, rel)
    if (!existsSync(path)) throw new Error(`artefact missing from the build: ${rel}`)
    files.push({
      path: rel,
      bytes: statSync(path).size,
      sha256: await hashFile(path),
      ...(signatures[rel] ? { signature: signatures[rel] } : {}),
    })
  }
  return {
    buildId,
    builtAt: new Date().toISOString(),
    version,
    commit,
    signing: { mode: signing.mode, publisher: signing.publisher },
    files,
    method: 'build-manifest-v1',
  }
}

/**
 * Whether a certificate subject is the configured publisher: the subject's
 * CN, exactly, against the publisher with or without its `CN=` prefix. The
 * rest of the subject (O, L, C) is the certificate's to carry.
 */
export function subjectMatches(subject, publisher) {
  if (!subject || !publisher) return false
  const cn = subject
    .split(/,\s*(?=[A-Z]+=)/u)
    .map((part) => part.trim())
    .find((part) => part.startsWith('CN='))
  if (!cn) return false
  return cn.slice(3).trim() === publisher.replace(/^CN=/u, '').trim()
}

/** `sha256sum`-style lines for the artefacts, from the manifest, for a checksums file beside it. */
export function checksumsText(manifest) {
  return `${manifest.files.map((f) => `${f.sha256} *${f.path.split('/').pop()}`).join('\n')}\n`
}

/* ------------------------------------------------------------ authenticode */

/**
 * The query as a script file with a parameter, so the same text parses the
 * same way on every PowerShell, and a failure to read the signature is its
 * own message rather than an empty status. The security module is imported
 * by name: on a runner whose shell is PowerShell 7, the module path handed
 * down to Windows PowerShell made the module fail to autoload — measured
 * as an empty status in a manifest.
 */
const AUTHENTICODE_SCRIPT = `param([string]$Path)
try {
  Import-Module Microsoft.PowerShell.Security -ErrorAction Stop
  $s = Get-AuthenticodeSignature -LiteralPath $Path -ErrorAction Stop
  [pscustomobject]@{
    status = [string]$s.Status
    subject = $(if ($s.SignerCertificate) { $s.SignerCertificate.Subject } else { $null })
    algorithm = $(if ($s.SignerCertificate) { $s.SignerCertificate.SignatureAlgorithm.FriendlyName } else { $null })
    timestamped = ($null -ne $s.TimeStamperCertificate)
    error = $null
  } | ConvertTo-Json -Compress
} catch {
  [pscustomobject]@{ status = 'Error'; subject = $null; algorithm = $null; timestamped = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
}
`

/** Windows PowerShell's own module path, so a child never inherits a PowerShell 7 module path. */
const WINDOWS_POWERSHELL_MODULES = [
  join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'Modules'),
  join(process.env.ProgramFiles ?? 'C:\\Program Files', 'WindowsPowerShell', 'Modules'),
].join(';')

/**
 * Authenticode status of a file, as Windows reports it: status, the signer's
 * subject, the certificate's signature algorithm, whether it is timestamped,
 * and the reading error if any. PowerShell 7 where it is installed, else
 * Windows PowerShell with its own module path. Never a guess.
 */
export function authenticodeOf(path, scriptFile) {
  if (process.platform !== 'win32')
    return { status: 'NotChecked', subject: null, algorithm: null, timestamped: false, error: null }
  writeFileSync(scriptFile, AUTHENTICODE_SCRIPT, 'utf8')
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptFile, '-Path', path]
  try {
    let out
    try {
      out = execFileSync('pwsh.exe', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      if (error && error.code !== 'ENOENT') throw error
      out = execFileSync('powershell.exe', args, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PSModulePath: WINDOWS_POWERSHELL_MODULES },
      })
    }
    return JSON.parse(out.trim())
  } finally {
    rmSync(scriptFile, { force: true })
  }
}

export function writeManifest(dir, manifest) {
  writeFileSync(join(dir, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
}

export function readManifest(dir) {
  const path = join(dir, MANIFEST_FILE)
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf8'))
}

/**
 * Re-hash the published artefacts against the manifest. Every artefact must
 * be present and unchanged; a missing or altered file names itself, so a
 * copy from a half-written or mixed directory is refused before it starts.
 */
export async function verifyManifest(dir) {
  const manifest = readManifest(dir)
  if (!manifest) return { ok: false, problems: [`no ${MANIFEST_FILE} in ${dir}`], manifest: null }
  const problems = []
  for (const entry of manifest.files) {
    const path = join(dir, entry.path)
    if (!existsSync(path)) {
      problems.push(`missing: ${entry.path}`)
      continue
    }
    const actual = await hashFile(path)
    if (actual !== entry.sha256) problems.push(`changed since the build: ${entry.path}`)
  }
  for (const rel of ARTEFACTS) {
    if (!manifest.files.some((f) => f.path === rel)) problems.push(`not in the manifest: ${rel}`)
  }
  return { ok: problems.length === 0, problems, manifest }
}
