export interface SessionGoal {
  wordCount?: number
  minutes?: number
}

export interface DailyActivity {
  date: string // 'YYYY-MM-DD', local date
  wordsWritten: number
  minutesActive?: number
}

export interface SessionSummary {
  today: DailyActivity
  streakDays: number
  heatmap: DailyActivity[]
  goal?: SessionGoal
  goalMet: boolean
}
