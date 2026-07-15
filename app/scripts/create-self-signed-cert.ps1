<#
.SYNOPSIS
  Generates a self-signed Authenticode code-signing certificate for local Atlas builds.

.DESCRIPTION
  Creates a code-signing cert in the CurrentUser\My store, exports it to a
  password-protected .pfx under app/certs/ (gitignored - never commit key material,
  even for a test-only cert), and prints the WIN_CSC_LINK / WIN_CSC_KEY_PASSWORD
  env vars electron-builder reads natively.

  This produces a self-signed, untrusted-chain certificate suitable for proving the
  signing pipeline works end-to-end. It is NOT trusted by Windows/SmartScreen and is
  not a substitute for a real CA-issued code-signing certificate before a public beta.

.PARAMETER OutDir
  Directory to write the .pfx into. Defaults to app/certs relative to this script.

.PARAMETER Password
  Password to protect the exported .pfx. If omitted, a random one is generated and
  printed once (not stored anywhere else).
#>
param(
  [string]$OutDir = (Join-Path $PSScriptRoot "..\certs"),
  [string]$Password
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $OutDir)) {
  New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
}

if (-not $Password) {
  $Password = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 24 | ForEach-Object { [char]$_ })
}
$securePassword = ConvertTo-SecureString -String $Password -Force -AsPlainText

$cert = New-SelfSignedCertificate `
  -Type CodeSigningCert `
  -Subject "CN=Atlas Dev Test Certificate, O=Atlas, C=US" `
  -CertStoreLocation "Cert:\CurrentUser\My" `
  -KeyUsage DigitalSignature `
  -FriendlyName "Atlas Dev Test Code Signing Cert" `
  -NotAfter (Get-Date).AddYears(5)

$pfxPath = Join-Path $OutDir "atlas-test-cert.pfx"
Export-PfxCertificate -Cert $cert -FilePath $pfxPath -Password $securePassword | Out-Null

# Test-only cert: safe to remove from the personal store now that it's exported to the .pfx.
Remove-Item -Path "Cert:\CurrentUser\My\$($cert.Thumbprint)" -Force

Write-Host ""
Write-Host "Self-signed code-signing certificate created (untrusted chain, dev/test use only):"
Write-Host "  $pfxPath"
Write-Host ""
Write-Host "Set these before running 'npm run dist':"
Write-Host "  `$env:WIN_CSC_LINK = `"$pfxPath`""
Write-Host "  `$env:WIN_CSC_KEY_PASSWORD = `"$Password`""
Write-Host ""
Write-Host "Password (save it now, not stored anywhere else): $Password"
