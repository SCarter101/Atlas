import type { SceneMeta } from './manuscript'

export interface SceneSnapshot {
  schemaVersion: 1
  snapshotId: string
  sceneId: string
  label?: string
  prose: string
  meta: SceneMeta
  createdAt: string
}

export interface SnapshotDiffRun {
  type: 'equal' | 'add' | 'remove'
  text: string
}
