import type { AtlasBridge } from '@shared/ipc'

declare global {
  interface Window {
    atlas: AtlasBridge
  }
}
