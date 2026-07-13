import { app, safeStorage } from 'electron'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const SECRET_NAME_RE = /^[a-z0-9._-]+$/i

function secretPath(name: string): string {
  if (!SECRET_NAME_RE.test(name)) throw new Error(`Invalid secret name: ${name}`)
  return join(app.getPath('userData'), 'atlas', 'secrets', `${name}.bin`)
}

function ensureEncryptionAvailable(): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('encryption-unavailable')
  }
}

// Locally satisfies spec §13's "backend vault" requirement for this desktop
// build by encrypting secrets through Electron safeStorage, which delegates
// to the OS keychain where available. Raw keys are never written to disk.
export async function setSecret(name: string, value: string): Promise<void> {
  ensureEncryptionAvailable()
  const targetPath = secretPath(name)
  await mkdir(join(app.getPath('userData'), 'atlas', 'secrets'), { recursive: true })
  await writeFile(targetPath, safeStorage.encryptString(value))
}

export async function getSecret(name: string): Promise<string | null> {
  ensureEncryptionAvailable()
  const targetPath = secretPath(name)
  if (!existsSync(targetPath)) return null
  const encrypted = await readFile(targetPath)
  return safeStorage.decryptString(encrypted)
}

export async function clearSecret(name: string): Promise<void> {
  await rm(secretPath(name), { force: true })
}

export async function hasSecret(name: string): Promise<boolean> {
  return existsSync(secretPath(name))
}
