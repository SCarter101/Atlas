import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createBackup, listBackups, restoreBackup } from './backupStore'
import { projectPaths } from './paths'

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
})
