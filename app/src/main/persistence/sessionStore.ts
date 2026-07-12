import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { DailyActivity, SessionGoal, SessionSummary } from '@shared/schema/session'
import { projectPaths } from './paths'

const HEATMAP_DAYS = 30

function localDateString(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function todayLocalDate(): string {
  return localDateString(new Date())
}

function activityFile(projectRoot: string, date: string): string {
  return join(projectPaths(projectRoot).sessionsDir, `${date}.json`)
}

// Append-only daily activity log — one file per local day. Called from the
// scene:write IPC handler with the scene's word-count delta so "today's
// session" reflects real editing activity rather than a mocked value.
export async function logSessionActivity(projectRoot: string, wordsDelta: number): Promise<void> {
  const date = todayLocalDate()
  const paths = projectPaths(projectRoot)
  await mkdir(paths.sessionsDir, { recursive: true })
  const file = activityFile(projectRoot, date)
  const existingRaw = await readFile(file, 'utf-8').catch(() => null)
  const existing: DailyActivity = existingRaw ? (JSON.parse(existingRaw) as DailyActivity) : { date, wordsWritten: 0 }
  // Clamp at zero — a day's word count going negative (e.g. from heavy
  // deletions) isn't a meaningful thing to show on the streak/heatmap.
  const next: DailyActivity = { ...existing, date, wordsWritten: Math.max(0, existing.wordsWritten + wordsDelta) }
  await writeFile(file, JSON.stringify(next, null, 2), 'utf-8')
}

export async function getSessionSummary(projectRoot: string, goal?: SessionGoal): Promise<SessionSummary> {
  const paths = projectPaths(projectRoot)
  let files: string[] = []
  try {
    files = await readdir(paths.sessionsDir)
  } catch {
    files = []
  }

  const dateRe = /^(\d{4}-\d{2}-\d{2})\.json$/
  const knownDates = files.map((f) => dateRe.exec(f)?.[1]).filter((d): d is string => !!d)

  const activityByDate = new Map<string, DailyActivity>()
  for (const date of knownDates) {
    const raw = await readFile(activityFile(projectRoot, date), 'utf-8')
    activityByDate.set(date, JSON.parse(raw) as DailyActivity)
  }

  const heatmap: DailyActivity[] = []
  const cursor = new Date()
  cursor.setDate(cursor.getDate() - (HEATMAP_DAYS - 1))
  for (let i = 0; i < HEATMAP_DAYS; i++) {
    const dateStr = localDateString(cursor)
    heatmap.push(activityByDate.get(dateStr) ?? { date: dateStr, wordsWritten: 0 })
    cursor.setDate(cursor.getDate() + 1)
  }

  const today = todayLocalDate()
  const todayActivity = activityByDate.get(today) ?? { date: today, wordsWritten: 0 }

  // Streak counts consecutive days with wordsWritten > 0, ending today if
  // today already has activity, or ending yesterday if today is still zero
  // (so a streak isn't broken just because the writer hasn't started yet).
  let streakDays = 0
  const streakCursor = new Date()
  if (todayActivity.wordsWritten <= 0) streakCursor.setDate(streakCursor.getDate() - 1)
  for (;;) {
    const dateStr = localDateString(streakCursor)
    const activity = activityByDate.get(dateStr)
    if (!activity || activity.wordsWritten <= 0) break
    streakDays++
    streakCursor.setDate(streakCursor.getDate() - 1)
  }

  const goalMet = goal?.wordCount !== undefined ? todayActivity.wordsWritten >= goal.wordCount : false

  return { today: todayActivity, streakDays, heatmap, goal, goalMet }
}
