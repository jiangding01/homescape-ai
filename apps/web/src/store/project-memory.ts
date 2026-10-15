export const LAST_PROJECT_STORAGE_KEY = 'homescape.lastProjectId'

/** 记住最近使用的项目 ID。仅为每个浏览器的便利，读写失败（隐私模式、被禁用）时静默忽略。 */
export interface ProjectMemory {
  read(): string | null
  write(projectId: string): void
}

export function createProjectMemory(
  getStorage: () => Pick<Storage, 'getItem' | 'setItem'> | undefined = () =>
    typeof localStorage === 'undefined' ? undefined : localStorage,
): ProjectMemory {
  return {
    read() {
      try {
        return getStorage()?.getItem(LAST_PROJECT_STORAGE_KEY) ?? null
      } catch {
        return null
      }
    },
    write(projectId) {
      try {
        getStorage()?.setItem(LAST_PROJECT_STORAGE_KEY, projectId)
      } catch {
        // 忽略：服务端项目列表仍可恢复。
      }
    },
  }
}
