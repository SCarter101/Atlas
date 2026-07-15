import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ProjectManifest } from '@shared/schema/project'
import { createBackup, listBackups, maybeRunScheduledBackup, restoreBackup } from './backupStore'
import { projectPaths } from './paths'

function manifestWithSchedule(schedule?: ProjectManifest['backupSchedule']): ProjectManifest {
  return {
    schemaVersion: 1,
    id: 'proj-1',
    title: 'Backup Test',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    books: [],
    advancedMode: false,
    theme: 'paper',
    backupSchedule: schedule
  }
}

// Pre-seeds the backup manifest.json with one entry at a given age, without
// going through createBackup() — lets the interval-comparison logic be
// tested against a specific injected "last backup time" instead of actually
// sleeping, per the task's own guidance.
async function seedBackupManifest(projectRoot: string, ageMinutes: number): Promise<void> {
  const createdAt = new Date(Date.now() - ageMinutes * 60_000).toISOString()
  await writeFile(
    join(projectPaths(projectRoot).backupsDir, 'manifest.json'),
    JSON.stringify([{ backupId: 'existing', label: 'Prior backup', createdAt, fileName: 'existing.zip', sizeBytes: 10 }], null, 2),
    'utf-8'
  )
  await writeFile(join(projectPaths(projectRoot).backupsDir, 'existing.zip'), 'placeholder', 'utf-8')
}

describe('backupStore', () => {
  let projectRoot: string

  beforeEach(async () => {
    projectRoot = mkdtempSync(join(tmpdir(), 'atlas-backup-test-'))
    await mkdir(join(projectRoot, 'manuscript', 'book-01'), { recursive: true })
    await mkdir(projectPaths(projectRoot).backupsDir, { recursive: true })
    await writeFile(join(projectRoot, 'project.json'), JSON.stringify({ title: 'Backup Test' }), 'utf-8')
    await writeFile(join(projectRoot, 'manuscript', 'book-01', 'scene-001.md'), 'Scene prose', 'utf-8')
    await writeFile(join(projectRoot, 'index.sqlite'), 'rebuildable index', 'utf-8')
    await writeFile(join(projectPaths(projectRoot).backupsDir, 'old.zip'), 'do not include', 'utf-8')
  })

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true })
  })

  it('creates and lists a backup without recursing into backups', async () => {
    const backup = await createBackup(projectRoot, 'Manual save')
    const backupPath = join(projectPaths(projectRoot).backupsDir, backup.fileName)

    expect(existsSync(backupPath)).toBe(true)
    const backups = await listBackups(projectRoot)
    expect(backups).toHaveLength(1)
    expect(backups[0].backupId).toBe(backup.backupId)
    expect(backups[0].label).toBe('Manual save')

    const zip = await JSZip.loadAsync(await readFile(backupPath))
    expect(zip.file('project.json')).not.toBeNull()
    expect(zip.file('manuscript/book-01/scene-001.md')).not.toBeNull()
    expect(zip.file('backups/old.zip')).toBeNull()
    expect(zip.file('index.sqlite')).toBeNull()
  })

  it('restores a backup into a separate project folder with matching files', async () => {
    const backup = await createBackup(projectRoot)
    const result = await restoreBackup(projectRoot, backup.backupId)

    expect(result.restoredProjectRoot).not.toBe(projectRoot)
    expect(existsSync(result.restoredProjectRoot)).toBe(true)
    await expect(readFile(join(result.restoredProjectRoot, 'project.json'), 'utf-8')).resolves.toContain('Backup Test')
    await expect(readFile(join(result.restoredProjectRoot, 'manuscript', 'book-01', 'scene-001.md'), 'utf-8')).resolves.toBe(
      'Scene prose'
    )

    rmSync(result.restoredProjectRoot, { recursive: true, force: true })
  })

  describe('maybeRunScheduledBackup', () => {
    it('does nothing when no schedule is configured', async () => {
      const result = await maybeRunScheduledBackup(projectRoot, manifestWithSchedule(undefined))
      expect(result).toBeNull()
      expect(await listBackups(projectRoot)).toHaveLength(0)
    })

    it('does nothing when the schedule exists but is disabled', async () => {
      const result = await maybeRunScheduledBackup(projectRoot, manifestWithSchedule({ enabled: false, intervalMinutes: 30 }))
      expect(result).toBeNull()
      expect(await listBackups(projectRoot)).toHaveLength(0)
    })

    it('creates a backup immediately when enabled and no backup has ever been made', async () => {
      const result = await maybeRunScheduledBackup(projectRoot, manifestWithSchedule({ enabled: true, intervalMinutes: 60 }))
      expect(result).not.toBeNull()
      expect(result?.label).toBe('Scheduled backup')
      expect(await listBackups(projectRoot)).toHaveLength(1)
    })

    it('skips creating a backup when the most recent backup is within the configured interval', async () => {
      await seedBackupManifest(projectRoot, 5) // 5 minutes ago
      const result = await maybeRunScheduledBackup(projectRoot, manifestWithSchedule({ enabled: true, intervalMinutes: 60 }))
      expect(result).toBeNull()
      // Still just the one pre-seeded entry — no new backup was created.
      expect(await listBackups(projectRoot)).toHaveLength(1)
    })

    it('creates a new backup once the most recent backup is older than the configured interval', async () => {
      await seedBackupManifest(projectRoot, 120) // 2 hours ago
      const result = await maybeRunScheduledBackup(projectRoot, manifestWithSchedule({ enabled: true, intervalMinutes: 60 }))
      expect(result).not.toBeNull()
      expect(await listBackups(projectRoot)).toHaveLength(2)
    })

    it('ignores a non-positive interval rather than backing up on every poll', async () => {
      const result = await maybeRunScheduledBackup(projectRoot, manifestWithSchedule({ enabled: true, intervalMinutes: 0 }))
      expect(result).toBeNull()
      expect(await listBackups(projectRoot)).toHaveLength(0)
    })
  })

  // Codex adversarial-review finding (Round 10/Phase 9 closing pass): a
  // plain writeFile(manifestPath, ...) let two overlapping createBackup()
  // calls read the same manifest and independently overwrite it, silently
  // discarding whichever entry finished writing first — a realistic
  // scenario now that Track D's scheduled-backup timer can fire while the
  // writer also clicks "Create backup" manually. Both entries must survive
  // regardless of which write actually lands last.
  it('does not lose either backup entry when two createBackup() calls overlap', async () => {
    const [a, b] = await Promise.all([createBackup(projectRoot, 'Manual A'), createBackup(projectRoot, 'Manual B')])

    const manifest = await listBackups(projectRoot)
    expect(manifest).toHaveLength(2)
    const ids = manifest.map((m) => m.backupId)
    expect(ids).toContain(a.backupId)
    expect(ids).toContain(b.backupId)
  })
})
