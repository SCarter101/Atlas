// Per-role system-prompt persistence (Phase 6). Prompts are global (not
// per-project) — there are only 5 fixed agent roles, so one JSON file per
// role lives under the OS user-data directory, mirroring how
// main/security/keyVault.ts stores secrets outside any project folder.
export interface PromptVersionEntry {
  version: string
  text: string
  savedAt: string
}

export interface PromptRecord {
  role: string
  activeVersion: string
  activeText: string
  history: PromptVersionEntry[]
}
