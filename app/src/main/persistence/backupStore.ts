import { existsSync, rmSync } from 'node:fs'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative } from 'node:path'
import JSZip from 'jszip'
import type { BackupMeta } from '@shared/schema/backup'
import { projectPaths } from './paths'

let mostRecentRecoveryAvailable = false

function manifestPath(projectRoot: string): string {
  return join(projectPaths(projectRoot).backupsDir, 'manifest.json')
}

function sessionLockPath(projectRoot: string): string {
  return join(projectPaths(projectRoot).settingsDir, 'session.lock')
}

function safeTimestamp(value: string): string {
  return value.replace(/[:.]/g, '-')
}

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'backup'
  )
}

async function addProjectFiles(zip: JSZip, projectRoot: string, dir: string): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true })
  const paths = projectPaths(projectRoot)

  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    const rel = relative(projectRoot, fullPath).replace(/\\/g, '/')

    if (fullPath === paths.backupsDir || rel.startsWith('backups/')) continue
    // index.sqlite is a rebuildable search/index cache; it is regenerated on next open.
    if (entry.isFile() && entry.name === 'index.sqlite' && dir === projectRoot) continue

    if (entry.isDirectory()) {
      await addProjectFiles(zip, projectRoot, fullPath)
    } else if (entry.isFile()) {
      zip.file(rel, await readFile(fullPath))
    }
  }
}

async function listBackupsOldestFirst(projectRoot: string): Promise<BackupMeta[]> {
  try {
    const raw = await readFile(manifestPath(projectRoot), 'utf-8')
    return JSON.parse(raw) as BackupMeta[]
  } catch {
    return []
  }
}

export async function createBackup(projectRoot: string, label?: string): Promise<BackupMeta> {
  const paths = projectPaths(projectRoot)
  await mkdir(paths.backupsDir, { recursive: true })

  const createdAt = new Date().toISOString()
  const fileStem = `${safeTimestamp(createdAt)}-${slug(label ?? 'backup')}`
  const fileName = `${fileStem}.zip`
  const zip = new JSZip()

  await addProjectFiles(zip, projectRoot, projectRoot)
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  const filePath = join(paths.backupsDir, fileName)
  await writeFile(filePath, buffer)
  const fileStat = await stat(filePath)

  const meta: BackupMeta = {
    backupId: fileStem,
    label: label?.trim() || undefined,
    createdAt,
    fileName,
    sizeBytes: fileStat.size
  }

  const manifest = await listBackupsOldestFirst(projectRoot)
  manifest.push(meta)
  await writeFile(manifestPath(projectRoot), JSON.stringify(manifest, null, 2), 'utf-8')

  return meta
}

export async function listBackups(projectRoot: string): Promise<BackupMeta[]> {
  const manifest = await listBackupsOldestFirst(projectRoot)
  return manifest.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function restoreBackup(projectRoot: string, backupId: string): Promise<{ restoredProjectRoot: string }> {
  const backups = await listBackupsOldestFirst(projectRoot)
  const backup = backups.find((entry) => entry.backupId === backupId)
  if (!backup) throw new Error(`Backup ${backupId} was not found`)

  const sourcePath = join(projectPaths(projectRoot).backupsDir, backup.fileName)
  const zip = await JSZip.loadAsync(await readFile(sourcePath))
  const restoredProjectRoot = join(
    dirname(projectRoot),
    `${basename(projectRoot, '.atlas')}-restored-${safeTimestamp(new Date().toISOString())}.atlas`
  )

  // Restore into a new project folder so the current work is never clobbered.
  await mkdir(restoredProjectRoot, { recursive: true })
  const writes: Promise<void>[] = []
  zip.forEach((relativePath, file) => {
    const targetPath = join(restoredProjectRoot, relativePath)
    if (file.dir) {
      writes.push(mkdir(targetPath, { recursive: true }).then(() => undefined))
      return
    }
    writes.push(
      mkdir(dirname(targetPath), { recursive: true }).then(async () => {
        await writeFile(targetPath, await file.async('nodebuffer'))
      })
    )
  })
  await Promise.all(writes)

  return { restoredProjectRoot }
}

export async function markProjectSessionOpened(projectRoot: string): Promise<{ recoveryAvailable: boolean }> {
  const lockPath = sessionLockPath(projectRoot)
  mostRecentRecoveryAvailable = existsSync(lockPath)
  await mkdir(projectPaths(projectRoot).settingsDir, { recursive: true })
  await writeFile(lockPath, new Date().toISOString(), 'utf-8')
  return { recoveryAvailable: mostRecentRecoveryAvailable }
}

export function getSessionRecoveryStatus(): { recoveryAvailable: boolean } {
  return { recoveryAvailable: mostRecentRecoveryAvailable }
}

export function removeProjectSessionLock(projectRoot: string): void {
  rmSync(sessionLockPath(projectRoot), { force: true })
}
