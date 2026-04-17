import { create } from 'zustand'

type SidebarTab = 'connections' | 'history'
type WindowTab = 'workspace' | 'ai-workbench'

interface UIState {
  sidebarWidth: number
  editorHeightPercent: number
  sidebarTab: SidebarTab
  windowTab: WindowTab
  showConnectionDialog: boolean
  editingConnectionId: string | null
  showSettings: boolean
  showAppSettings: boolean

  setSidebarWidth: (width: number) => void
  setEditorHeightPercent: (pct: number) => void
  setSidebarTab: (tab: SidebarTab) => void
  setWindowTab: (tab: WindowTab) => void
  openConnectionDialog: (editId?: string) => void
  closeConnectionDialog: () => void
  setShowSettings: (show: boolean) => void
  setShowAppSettings: (show: boolean) => void
}

export const useUIStore = create<UIState>((set) => ({
  sidebarWidth: 240,
  editorHeightPercent: 55,
  sidebarTab: 'connections',
  windowTab: 'workspace',
  showConnectionDialog: false,
  editingConnectionId: null,
  showSettings: false,
  showAppSettings: false,

  setSidebarWidth: (width) => set({ sidebarWidth: width }),
  setEditorHeightPercent: (pct) => set({ editorHeightPercent: pct }),
  setSidebarTab: (tab) => set({ sidebarTab: tab }),
  setWindowTab: (tab) => set({ windowTab: tab }),
  openConnectionDialog: (editId) =>
    set({ showConnectionDialog: true, editingConnectionId: editId ?? null }),
  closeConnectionDialog: () =>
    set({ showConnectionDialog: false, editingConnectionId: null }),
  setShowSettings: (show) => set({ showSettings: show }),
  setShowAppSettings: (show) => set({ showAppSettings: show })
}))
