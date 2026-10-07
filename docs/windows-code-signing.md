# Windows code signing and the clean production install

Financial OS is a personal desktop application. On a Windows 11 computer
with **Smart App Control** on, an unsigned application is judged by the
reputation of each file's hash, and every build of Financial OS has a new
hash (the executable embeds the integrity hash of its archive). Measured on
2026-10-07: the unsigned NSIS installer was blocked every time; the unsigned
`Financial OS.exe` was allowed for two builds and blocked for two. Smart App
Control is not to be disabled or bypassed. The application must be signed.

## 1. The signing path

**Preferred: Microsoft Trusted Signing** (Azure). It is the signing service
Windows itself trusts, it gives SmartScreen and Smart App Control reputation
immediately, it issues short-lived certificates that are timestamped so
signatures stay valid, and it needs no hardware token. electron-builder 26
supports it natively (`win.azureSignOptions`).

**Alternative: a code-signing certificate** from a public CA (OV or EV).
Since June 2023 every new code-signing certificate's private key must live
on a hardware token or an HSM, so this path means a USB token in this
computer, or a cloud HSM with a custom signing command. electron-builder
supports a certificate in the Windows store by subject name
(`win.signtoolOptions.certificateSubjectName`).

Self-signed certificates are not a production solution: Smart App Control
does not trust them.

## 2. What is required from the person (once)

### Trusted Signing

1. An Azure subscription, and a **Trusted Signing account** (Basic tier) in a
   region, e.g. West Europe → endpoint `https://weu.codesigning.azure.net`.
2. **Identity validation** on that account — *Individual* for a person
   (government ID), *Organization* for a company — completed by Microsoft.
3. A **certificate profile** of type *Public Trust* on the account. Its
   subject (`CN=…`) is the publisher name.
4. An **app registration** (service principal) with a client secret, given
   the role *Trusted Signing Certificate Profile Signer* on the account.
5. On the build computer: PowerShell 5.1+, the **.NET 8 runtime**, and the
   Windows SDK **SignTool** (electron-builder installs the `TrustedSigning`
   PowerShell module itself, into the current user's modules).

The environment the package script reads — set in the shell or in a
secrets store, never in a file in the repository:

| Variable | Meaning |
|---|---|
| `AZURE_TENANT_ID` | Entra tenant of the app registration |
| `AZURE_CLIENT_ID` | the app registration's client id |
| `AZURE_CLIENT_SECRET` | its client secret |
| `FINANCIAL_OS_SIGN_ENDPOINT` | the account's regional endpoint |
| `FINANCIAL_OS_SIGN_ACCOUNT` | the Trusted Signing account name |
| `FINANCIAL_OS_SIGN_PROFILE` | the certificate profile name |
| `FINANCIAL_OS_SIGN_PUBLISHER` | the profile's subject, exactly, e.g. `CN=Martin Enström` |
| `FINANCIAL_OS_SIGN_TIMESTAMP` | optional; default `http://timestamp.acs.microsoft.com` |

### A certificate in the Windows store

| Variable | Meaning |
|---|---|
| `FINANCIAL_OS_SIGN_SUBJECT` | the certificate's subject name as issued |
| `FINANCIAL_OS_SIGN_PUBLISHER` | optional; defaults to the subject |
| `FINANCIAL_OS_SIGN_TIMESTAMP` | optional RFC 3161 server; default DigiCert |

A `.pfx` file (older certificates) goes through electron-builder's own
`WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD`.

`FINANCIAL_OS_SIGN_REQUIRE=1` makes an unsigned build a refusal.

## 3. What gets signed

With either mode electron-builder signs, in this order: `Financial OS.exe`,
`resources/elevate.exe`, the uninstaller, and `Financial-OS-Setup-0.1.0.exe`.
The files inside the archive are not executables Windows loads directly and
need no signature; Electron's own DLLs keep their state. The package script
verifies with Windows (`Get-AuthenticodeSignature`) that the executable and
the installer are **Valid**, by the configured publisher, and timestamped,
and refuses to publish otherwise.

## 4. One coherent build

`npm run desktop:package` runs `desktop/package.mjs`:

1. `vite build`.
2. electron-builder into `release/.staging-<id>` — a directory nothing reads.
3. The executable, the archive and the installer must all exist; where
   signing was requested, their signatures must be Valid.
4. `build-manifest.json` records every artefact's SHA-256, size, signature
   state, the signing mode and the publisher — never a credential.
5. The staging directory is renamed to `release/current` in one move.

`node desktop/package.mjs --verify` re-hashes `release/current` against the
manifest. `node desktop/package.mjs --install-copy` copies a verified build
into `%LOCALAPPDATA%\Programs\Financial OS` with the desktop and Start Menu
shortcuts — the path to take where the NSIS installer itself cannot run.

## 5. A build-machine limitation under Smart App Control

To produce a signable uninstaller, electron-builder **runs** the freshly
built, not yet signed installer stub. Smart App Control on this computer
refused that run on 2026-10-07 (`spawn UNKNOWN` from the NSIS step; Code
Integrity events 3033/3077 naming the stub). The installer must therefore be
built where that stub may run — a CI runner (GitHub Actions `windows-latest`
with the same environment variables as repository secrets) is the ordinary
answer — or the person decides about Smart App Control on the build machine.
The application itself builds here; only the installer step is affected.

## 6. Install, update, uninstall (NSIS, per user)

`electron-builder.yml`: assisted installer, per user, directory selectable,
desktop and Start Menu shortcuts, `deleteAppDataOnUninstall: false`. The
application lives under `%LOCALAPPDATA%\Programs\Financial OS`; the person's
data under `%APPDATA%\Financial OS\Financial OS` and is never inside the
installation directory. Reinstalling or updating replaces the application
and leaves the data; uninstalling removes the application, its shortcuts and
its Installed-apps entry and leaves the data.
