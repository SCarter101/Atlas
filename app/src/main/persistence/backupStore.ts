import { existsSync, rmSync } from 'node:fs'
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative } from 'node:path'
import JSZip from 'jszip'
import type { BackupMeta } from '@shared/schema/backup'
import type { ProjectManifest } from '@shared/schema/project'
import { projectPaths } from './paths'

let mostRecentRecoveryAvailable = false

function manifestPath(projectRoot: string): string {
  return join(projectPaths(projectRoot).backupsDir, 'manifest.json')
}

// Codex adversarial-review finding (Round 10/Phase 9 closing pass): a plain
// writeFile(manifestPath, ...) has two real failure modes now that Track D's
// scheduled backups make overlapping createBackup() calls a realistic case
// (a scheduled backup firing while the writer clicks "Create backup"
// manually), not just a theoretical double-click:
//   1. Non-atomic write — an interruption mid-write leaves truncated/invalid
//      JSON, which listBackupsOldestFirst()'s catch silently turns into [],
//      making every prior backup disappear from the UI despite intact ZIPs.
//   2. Read-modify-write race — two overlapping calls both read the same
//      manifest, append independently, and whichever writeFile() finishes
//      last silently discards the other's entry.
// Fixed with (1) an atomic write (write to a temp file in the same
// directory, then rename() — rename is atomic on the same volume, so a
// crash mid-write can never leave a torn manifest.json) and (2) a
// per-projectRoot in-memory promise chain so overlapping createBackup()
// calls serialize their manifest read-modify-write instead of racing.
const manifestWriteQueues = new Map<string, Promise<void>>()

async function withManifestWriteLock(projectRoot: string, fn: () => Promise<void>): Promise<void> {
  const previous = manifestWriteQueues.get(projectRoot) ?? Promise.resolve()
  const next = previous.then(fn, fn)
  // Swallow so a failed write doesn't wedge the queue for later callers —
  // each caller still awaits `next` directly and sees its own rejection.
  manifestWriteQueues.set(
    projectRoot,
    next.catch(() => {})
  )
  return next
}

async function writeManifestAtomically(projectRoot: string, manifest: BackupMeta[]): Promise<void> {
  const finalPath = manifestPath(projectRoot)
  const tmpPath = `${finalPath}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tmpPath, JSON.stringify(manifest, null, 2), 'utf-8')
  try {
    await rename(tmpPath, finalPath)
  } catch (err) {
    await unlink(tmpPath).catch(() => {})
    throw err
  }
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

  // Read-modify-write of the shared manifest must be serialized per project
  // — see withManifestWriteLock's comment above the manifest-write helpers.
  await withManifestWriteLock(projectRoot, async () => {
    const manifest = await listBackupsOldestFirst(projectRoot)
    manifest.push(meta)
    await writeManifestAtomically(projectRoot, manifest)
  })

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

// ---------------------------------------------------------------------------
// Scheduled automatic backups (Round 10/Phase 9)
// ---------------------------------------------------------------------------

// Called on a periodic timer from main/index.ts's whenReady() — see that
// file for why this is poll-based (a fixed-tick check against the
// manifest's *current* schedule setting) rather than a per-project
// setTimeout/setInterval keyed to intervalMinutes directly: the writer can
// change the interval or turn scheduling off entirely mid-session via
// Settings, and a poll that re-reads the manifest each tick picks that up
// for free with no timer-teardown bookkeeping.
//
// Elapsed time is measured against the most recent entry in the existing
// backup manifest (listBackups()) rather than a separate "last scheduled
// run" timestamp — any backup, scheduled or manually triggered via
// Settings' "Create backup" button, resets the clock. That's deliberate:
// the point of scheduling is "don't go too long without a safety copy," and
// a writer who just made a manual backup doesn't need another one seconds
// later just because the poll happened to land right after.
export async function maybeRunScheduledBackup(projectRoot: string, manifest: ProjectManifest): Promise<BackupMeta | null> {
  const schedule = manifest.backupSchedule
  if (!schedule?.enabled) return null
  if (!Number.isFinite(schedule.intervalMinutes) || schedule.intervalMinutes <= 0) return null

  const existing = await listBackups(projectRoot)
  if (existing.length > 0) {
    const mostRecent = existing[0] // listBackups() sorts newest-first
    const elapsedMs = Date.now() - new Date(mostRecent.createdAt).getTime()
    const intervalMs = schedule.intervalMinutes * 60_000
    if (Number.isFinite(elapsedMs) && elapsedMs < intervalMs) return null
  }

  return createBackup(projectRoot, 'Scheduled backup')
}
