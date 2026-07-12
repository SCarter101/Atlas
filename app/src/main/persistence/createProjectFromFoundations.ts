import { randomUUID } from 'node:crypto'
import type { FoundationsCodexDraft } from '@shared/ipc'
import type { CodexEntry } from '@shared/schema/codex'
import type { ProjectManifest } from '@shared/schema/project'
import { upsertCodexEntry } from './codexStore'
import type { AtlasDb } from './db'
import { createProject } from './projectStore'

export function slugify(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
  return slug || 'untitled-project'
}

// Real project creation from the Story Foundations onboarding flow (spec
// §4): a project manifest plus whatever starter Codex entries the writer
// answered, with no manuscript structure yet — that's created by the
// writer once they start drafting.
export async function createProjectFromFoundations(
  projectRoot: string,
  db: AtlasDb,
  title: string,
  genrePrimary: string | undefined,
  entries: FoundationsCodexDraft[]
): Promise<ProjectManifest> {
  const manifest = await createProject(projectRoot, { title, genrePrimary })

  const now = new Date().toISOString()
  for (const draft of entries) {
    const entry: CodexEntry = {
      schemaVersion: 1,
      id: randomUUID(),
      type: draft.type,
      name: draft.name,
      status: draft.status,
      body: { summary: draft.summary },
      isPrivate: false,
      localModelOnly: false,
      locked: false,
      source: 'author',
      relationships: [],
      manuscriptLinks: [],
      createdAt: now,
      updatedAt: now,
      history: []
    }
    await upsertCodexEntry(projectRoot, db, entry)
  }

  return manifest
}
