import { app } from 'electron'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentRole } from '@shared/schema/agent'
import type { PromptRecord, PromptVersionEntry } from '@shared/schema/prompts'

// Seed content, moved verbatim out of Settings.tsx's DEFAULT_PROMPTS/
// DEFAULT_VERSIONS (the prompt editor was previously fully client-side and
// forgot every edit on reload) — these are now only the fallback used when
// no on-disk record exists yet for a role.
const DEFAULT_PROMPTS: Record<AgentRole, string> = {
  Generator:
    "You are Generator, the primary drafting agent for this novelist's manuscript. Draft prose from the scene outline and metadata provided. Match the writer's established voice. Never contradict locked world rules or canon Codex facts. Ask a clarifying question if the outline is too vague to draft confidently.",
  'Dev-Editor':
    'You are Story Editor, an industry developmental editor. Operate at the act or full-manuscript level. Watch specifically for: continuity breaks, pacing problems, point-of-view drift, weak or unclear stakes, missing or weak hooks, and setups that never pay off (or payoffs with no setup). Return a structured report of 1-4 findings, each with a severity score (low/medium/high) and a concrete, actionable revision plan the writer can act on — never rewrite prose directly.',
  'Line-Editor':
    'You are Line Editor, a copy editor focused on clarity and voice preservation. Propose tracked changes only — never silently edit. Flag AI-sounding prose separately from grammar and style issues.',
  Dialoguer:
    "You are Dialogue Editor. Use each character's Codex voice profile to evaluate whether dialogue is distinct, advances conflict, and avoids sounding interchangeable between characters. When asked for alternate phrasings, produce exactly 3 distinct tension-tier alternatives (calm, guarded, confrontational), each grounded in that character's actual Codex voice profile fields (vocabulary, rhythm, formality level, speech directness, verbal tics, favorite/avoided phrases) rather than a generic rewrite.",
  'World-Builder':
    'You are World Builder. Use the Codex world repository as primary knowledge. Clearly separate invented facts from researched real-world facts, and cite sources for anything pulled from the web. Never add to the Codex without writer approval. You currently have no access to external research or the internet — every proposal you make is your own inference from the manuscript selection or the writer\'s own World Builder interview answers, and must be labeled honestly as model inference, never presented as verified or researched fact.'
}

const DEFAULT_VERSIONS: Record<AgentRole, string> = {
  Generator: '1.2',
  'Dev-Editor': '1.1',
  'Line-Editor': '1.3',
  Dialoguer: '1.1',
  'World-Builder': '1.2'
}

// Prompts are global (not project-scoped) — there are only 5 fixed agent
// roles, so one JSON file per role lives under the OS user-data directory,
// mirroring main/security/keyVault.ts's `atlas/secrets/` layout.
function promptsDir(): string {
  return join(app.getPath('userData'), 'atlas', 'prompts')
}

function promptPath(role: AgentRole): string {
  // Roles are a fixed enum of 5 safe identifiers (see AgentRole in
  // shared/schema/agent.ts) — no filename sanitization needed, unlike
  // keyVault.ts's arbitrary secret names.
  return join(promptsDir(), `${role}.json`)
}

function defaultRecord(role: AgentRole): PromptRecord {
  return { role, activeVersion: DEFAULT_VERSIONS[role], activeText: DEFAULT_PROMPTS[role], history: [] }
}

async function readRecord(role: AgentRole): Promise<PromptRecord> {
  const targetPath = promptPath(role)
  if (!existsSync(targetPath)) return defaultRecord(role)
  const raw = await readFile(targetPath, 'utf-8')
  return JSON.parse(raw) as PromptRecord
}

async function writeRecord(role: AgentRole, record: PromptRecord): Promise<void> {
  await mkdir(promptsDir(), { recursive: true })
  await writeFile(promptPath(role), JSON.stringify(record, null, 2), 'utf-8')
}

// Same version-bump convention Settings.tsx used client-side before this
// store existed: bump the minor decimal by 0.1.
function bumpVersion(currentVersion: string): string {
  return (parseFloat(currentVersion) + 0.1).toFixed(1)
}

export async function getActivePrompt(role: AgentRole): Promise<{ text: string; version: string }> {
  const record = await readRecord(role)
  return { text: record.activeText, version: record.activeVersion }
}

export async function setPrompt(role: AgentRole, text: string): Promise<{ version: string }> {
  const record = await readRecord(role)
  const historyEntry: PromptVersionEntry = {
    version: record.activeVersion,
    text: record.activeText,
    savedAt: new Date().toISOString()
  }
  const nextVersion = bumpVersion(record.activeVersion)
  const nextRecord: PromptRecord = {
    role,
    activeVersion: nextVersion,
    activeText: text,
    history: [...record.history, historyEntry]
  }
  await writeRecord(role, nextRecord)
  return { version: nextVersion }
}

export async function resetPrompt(role: AgentRole): Promise<{ text: string; version: string }> {
  const record = await readRecord(role)
  const historyEntry: PromptVersionEntry = {
    version: record.activeVersion,
    text: record.activeText,
    savedAt: new Date().toISOString()
  }
  const nextRecord: PromptRecord = {
    role,
    activeVersion: DEFAULT_VERSIONS[role],
    activeText: DEFAULT_PROMPTS[role],
    history: [...record.history, historyEntry]
  }
  await writeRecord(role, nextRecord)
  return { text: nextRecord.activeText, version: nextRecord.activeVersion }
}

export async function listPromptHistory(role: AgentRole): Promise<PromptVersionEntry[]> {
  const record = await readRecord(role)
  return record.history
}
