import { describe, expect, it } from 'vitest'
import type { AgentGoal } from '@shared/schema/agent'
import type { CodexEntry } from '@shared/schema/codex'
import type { ProjectManifest } from '@shared/schema/project'
import type { SceneWritePatch } from '@shared/ipc'
import { AgentGoalSchema, CodexEntrySchema, ProjectManifestSeedSchema, SceneWritePatchSchema } from '@shared/validation'

describe('IPC boundary validation schemas', () => {
  describe('CodexEntrySchema', () => {
    it('parses a valid, complete CodexEntry', () => {
      const entry: CodexEntry = {
        schemaVersion: 1,
        id: 'codex-1',
        type: 'character',
        name: 'Marisol Vega',
        status: 'canon',
        body: { summary: 'Protagonist' },
        isPrivate: false,
        localModelOnly: false,
        locked: false,
        source: 'author',
        approvedAt: '2026-07-01T00:00:00.000Z',
        relationships: [{ id: 'rel-1', targetEntryId: 'codex-2', kind: 'sibling', notes: 'estranged' }],
        manuscriptLinks: [{ sceneId: 'scene-1', excerpt: 'She entered the room.' }],
        spoilerRevealSceneId: 'scene-9',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z',
        history: [
          {
            versionId: 'v1',
            changedAt: '2026-01-01T00:00:00.000Z',
            changedBy: 'author',
            diffSummary: 'Initial creation',
            snapshot: { name: 'Marisol Vega' }
          }
        ]
      }

      expect(CodexEntrySchema.parse(entry)).toEqual(entry)
    })

    it('throws on a malformed CodexEntry (missing required field, wrong enum value)', () => {
      const malformed = {
        schemaVersion: 1,
        id: 'codex-1',
        type: 'not-a-real-type', // invalid enum value
        // name is missing entirely
        status: 'canon',
        body: {},
        isPrivate: false,
        localModelOnly: false,
        locked: false,
        source: 'author',
        relationships: [],
        manuscriptLinks: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        history: []
      }

      expect(() => CodexEntrySchema.parse(malformed)).toThrow()
    })
  })

  describe('SceneWritePatchSchema', () => {
    it('parses a valid, complete SceneWritePatch', () => {
      const patch: SceneWritePatch = {
        meta: {
          id: 'scene-1',
          chapterId: 'chapter-1',
          order: 2,
          title: 'The Arrival',
          povCharacterId: 'codex-1',
          locationId: 'codex-2',
          timeOrDate: 'Day 1, morning',
          purpose: 'Introduce the setting',
          craft: {
            characterDesire: 'To find shelter',
            externalGoal: 'Reach the inn',
            stakes: 'Storm approaching'
          },
          continuity: {
            timelinePlacement: 'Opening',
            setupIds: ['setup-1'],
            payoffIds: []
          },
          wordCount: 1200,
          status: 'drafting',
          updatedAt: '2026-07-01T00:00:00.000Z'
        },
        prose: 'It was a dark and stormy night.'
      }

      expect(SceneWritePatchSchema.parse(patch)).toEqual(patch)
    })

    it('parses an empty patch (all fields optional)', () => {
      expect(SceneWritePatchSchema.parse({})).toEqual({})
    })

    it('throws on a malformed SceneWritePatch (wrong type on a meta field)', () => {
      const malformed = {
        meta: {
          title: 'The Arrival',
          wordCount: 'twelve-hundred' // should be a number
        }
      }

      expect(() => SceneWritePatchSchema.parse(malformed)).toThrow()
    })
  })

  describe('AgentGoalSchema', () => {
    it('parses a valid, complete AgentGoal', () => {
      const goal: AgentGoal = {
        runId: 'run-1',
        agentRole: 'Line-Editor',
        modelRef: { provider: 'anthropic', modelId: 'claude-opus-4', viaOpenRouter: false },
        userIntent: 'Tighten the prose in scene 1',
        scope: { sceneIds: ['scene-1'], selectionText: 'He noticed the door was heavy.' },
        constraints: {
          maxTurns: 4,
          maxTokens: 4000,
          maxToolCalls: 3,
          maxElapsedMs: 30000,
          maxCostUsd: 0.5,
          allowedCapabilityCategories: ['line-editing']
        }
      }

      expect(AgentGoalSchema.parse(goal)).toEqual(goal)
    })

    it('throws on a malformed AgentGoal (missing constraints)', () => {
      const malformed = {
        runId: 'run-1',
        agentRole: 'Line-Editor',
        modelRef: { provider: 'anthropic', modelId: 'claude-opus-4', viaOpenRouter: false },
        userIntent: 'Tighten the prose in scene 1',
        scope: {}
        // constraints is missing entirely
      }

      expect(() => AgentGoalSchema.parse(malformed)).toThrow()
    })
  })

  describe('ProjectManifestSeedSchema', () => {
    it('parses a valid, complete Partial<ProjectManifest> seed', () => {
      const seed: Partial<ProjectManifest> = {
        title: 'The Long Road',
        genrePrimary: 'Fantasy',
        targetWordCount: 90000,
        books: [],
        advancedMode: false,
        theme: 'paper',
        writerDisplayName: 'D. Carter'
      }

      expect(ProjectManifestSeedSchema.parse(seed)).toEqual(seed)
    })

    it('parses an empty seed (all fields optional)', () => {
      expect(ProjectManifestSeedSchema.parse({})).toEqual({})
    })
  })
})
