# Trusted Signing — your one-time setup

This is the operator's checklist for signing Financial OS with Microsoft
Trusted Signing so that it installs and runs on a Windows 11 computer with
Smart App Control on. Everything below is created outside the repository.
The release itself is built by the GitHub Actions workflow
`Windows release` (`.github/workflows/windows-release.yml`), which reads the
values as repository secrets and never prints them.

## Safe to document · never commit

| SAFE TO DOCUMENT (not secret, but still enter them as secrets for one place) | SECRETS THAT MUST NEVER BE COMMITTED |
|---|---|
| tenant id, client (application) id | **client secret** |
| Trusted Signing endpoint, account name, certificate profile name | anything that looks like a key, a `.pfx`, a password |
| publisher (the certificate subject, `CN=…`) | |

Nothing here goes into a source file, `electron-builder.yml`,
`build-manifest.json`, the application's configuration or a backup. The
client secret is pasted exactly once, into GitHub's secret store.

## 1. Azure subscription and tenant

Sign in to the Azure portal with the account that owns (or will own) the
subscription. Note the **Directory (tenant) ID** under *Microsoft Entra ID →
Overview*. Everything below is created in this tenant.

## 2. Trusted Signing account

*Create a resource → "Trusted Signing Accounts"*. Choose the subscription, a
resource group, a **name** (letters and digits; this is the account name),
a **region** that offers Trusted Signing (for Sweden choose *West Europe*),
and the **Basic** tier. The endpoint follows the region, for West Europe:
`https://weu.codesigning.azure.net`. You can read it later on the account's
Overview page as *Account URI*.

## 3. Identity validation

On the account, open *Identity validation* and create one:
- **Individual** — for you as a person: full legal name, address, a
  government ID, and verification through Microsoft's identity partner.
- **Organization** — for a registered company (needs a few years of history).

Validation can take from a day to a couple of weeks. The certificate
profile below cannot be created until it is **Completed**.

## 4. Public Trust certificate profile

On the account, *Certificate profiles → Create*. Type **Public Trust**,
link it to the completed identity validation, give it a **profile name**
(for example `financial-os`). The profile's subject shows as
`CN=<your validated name>` (plus O/L/C when organisational). That subject,
starting with `CN=`, is the **publisher** value, exactly as shown.

## 5. Application (service principal) for the runner

*Microsoft Entra ID → App registrations → New registration*, single tenant,
no redirect URI. Note the **Application (client) ID**. Under *Certificates
& secrets → New client secret*, create a secret and copy its **Value** now
(it is shown once). Choose an expiry you will remember to renew.

## 6. Signer role on the certificate profile

Back on the Trusted Signing account, *Access control (IAM) → Add role
assignment → "Trusted Signing Certificate Profile Signer"*, assign it to the
app registration from step 5. (You may also give yourself *Trusted Signing
Identity Verifier* for the portal.)

## 7. Where each value is read

| Value | Where to read it |
|---|---|
| `AZURE_TENANT_ID` | Entra ID → Overview → Directory (tenant) ID |
| `AZURE_CLIENT_ID` | the app registration → Overview → Application (client) ID |
| `AZURE_CLIENT_SECRET` | the client secret's Value from step 5 |
| `FINANCIAL_OS_SIGN_ENDPOINT` | Trusted Signing account → Overview → Account URI |
| `FINANCIAL_OS_SIGN_ACCOUNT` | the Trusted Signing account's name |
| `FINANCIAL_OS_SIGN_PROFILE` | the certificate profile's name |
| `FINANCIAL_OS_SIGN_PUBLISHER` | the profile's subject, e.g. `CN=Martin Enström` |

## 8. Enter them in GitHub

Repository → *Settings → Secrets and variables → Actions → New repository
secret*, one per row above, with exactly those names. Then run *Actions →
Windows release → Run workflow* with mode **release**. The artifact
`Financial-OS-Windows-0.1.0` holds `Financial-OS-Setup-0.1.0.exe`,
`build-manifest.json` and `checksums.sha256`. Mode **validate** runs the
whole pipeline unsigned and publishes the manifest and checksums only; it is
never a release.

## What the workflow does with them

electron-builder's Azure signing installs the `TrustedSigning` PowerShell
module on the runner and calls `Invoke-TrustedSigning` with the endpoint,
account, profile, SHA-256 digests and Microsoft's timestamp server; the
three `AZURE_*` values are read by Microsoft's library through the
environment. It signs `Financial OS.exe`, `elevate.exe`, the uninstaller and
`Financial-OS-Setup-0.1.0.exe`. The workflow then checks with Windows that the
executable and the installer are Valid, signed by your publisher, timestamped
and SHA-256, re-hashes the published build against its manifest, and only
then uploads the installer.

## Renewal and rotation

Trusted Signing certificates are short-lived and renewed by the service;
nothing to do. The client secret expires on the date you chose: create a new
one in the app registration and replace the `AZURE_CLIENT_SECRET` secret in
GitHub. Delete the old secret in Azure afterwards.
