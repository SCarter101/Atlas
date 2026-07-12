import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getSessionSummary, logSessionActivity } from './sessionStore'
import { projectPaths } from './paths'
import { mkdir, writeFile } from 'node:fs/promises'

function localDateString(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

async function writeDay(projectRoot: string, offsetDays: number, wordsWritten: number): Promise<void> {
  const date = new Date()
  date.setDate(date.getDate() + offsetDays)
  const dateStr = localDateString(date)
  await mkdir(projectPaths(projectRoot).sessionsDir, { recursive: true })
  await writeFile(
    join(projectPaths(projectRoot).sessionsDir, `${dateStr}.json`),
    JSON.stringify({ date: dateStr, wordsWritten }),
    'utf-8'
  )
}

describe('sessionStore', () => {
  let projectRoot: string

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'atlas-session-test-'))
  })

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true })
  })

  describe('logSessionActivity', () => {
    it('creates today\'s activity file on first call', async () => {
      await logSessionActivity(projectRoot, 250)
      const summary = await getSessionSummary(projectRoot)
      expect(summary.today.wordsWritten).toBe(250)
    })

    it('accumulates multiple calls on the same day', async () => {
      await logSessionActivity(projectRoot, 100)
      await logSessionActivity(projectRoot, 50)
      await logSessionActivity(projectRoot, 30)
      const summary = await getSessionSummary(projectRoot)
      expect(summary.today.wordsWritten).toBe(180)
    })

    it('clamps at zero rather than going negative', async () => {
      await logSessionActivity(projectRoot, 20)
      await logSessionActivity(projectRoot, -100)
      const summary = await getSessionSummary(projectRoot)
      expect(summary.today.wordsWritten).toBe(0)
    })
  })

  describe('getSessionSummary', () => {
    it('returns a zeroed summary with no streak when nothing has been logged', async () => {
      const summary = await getSessionSummary(projectRoot)
      expect(summary.today.wordsWritten).toBe(0)
      expect(summary.streakDays).toBe(0)
      expect(summary.heatmap).toHaveLength(30)
      expect(summary.goalMet).toBe(false)
    })

    it('computes a streak of consecutive prior days plus today', async () => {
      await writeDay(projectRoot, -2, 400)
      await writeDay(projectRoot, -1, 500)
      await logSessionActivity(projectRoot, 300)

      const summary = await getSessionSummary(projectRoot)
      expect(summary.streakDays).toBe(3)
    })

    it('still counts the streak through yesterday when today has no activity yet', async () => {
      await writeDay(projectRoot, -2, 400)
      await writeDay(projectRoot, -1, 500)

      const summary = await getSessionSummary(projectRoot)
      expect(summary.streakDays).toBe(2)
      expect(summary.today.wordsWritten).toBe(0)
    })

    it('breaks the streak on a gap day', async () => {
      await writeDay(projectRoot, -3, 400)
      // gap at -2
      await writeDay(projectRoot, -1, 500)
      await logSessionActivity(projectRoot, 300)

      const summary = await getSessionSummary(projectRoot)
      expect(summary.streakDays).toBe(2)
    })

    it('reports goalMet true only when a word-count goal is set and reached', async () => {
      await logSessionActivity(projectRoot, 500)

      const notMet = await getSessionSummary(projectRoot, { wordCount: 1000 })
      expect(notMet.goalMet).toBe(false)

      const met = await getSessionSummary(projectRoot, { wordCount: 500 })
      expect(met.goalMet).toBe(true)

      const noGoal = await getSessionSummary(projectRoot)
      expect(noGoal.goalMet).toBe(false)
    })

    it('fills missing days in the heatmap with zero words rather than requiring a file per day', async () => {
      await logSessionActivity(projectRoot, 750)
      const summary = await getSessionSummary(projectRoot)
      const today = summary.heatmap[summary.heatmap.length - 1]
      expect(today.wordsWritten).toBe(750)
      const zeroDays = summary.heatmap.filter((d) => d.wordsWritten === 0)
      expect(zeroDays.length).toBe(29)
    })
  })
})
