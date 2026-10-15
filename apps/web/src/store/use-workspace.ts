import { useStore } from 'zustand'
import { getWorkspaceStore, type WorkspaceState } from './workspace-store'

/** 组件只订阅所需字段并派发 action；领域状态与编排都在 store 中。 */
export function useWorkspace<T>(selector: (state: WorkspaceState) => T): T {
  return useStore(getWorkspaceStore(), selector)
}
