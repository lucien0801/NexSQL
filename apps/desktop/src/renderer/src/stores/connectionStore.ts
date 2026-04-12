import { create } from 'zustand'
import type { ConnectionConfig, ConnectionFormData, ConnectionStatus } from '@shared/types/connection'

interface ConnectionState {
  connections: ConnectionConfig[]
  statuses: Record<string, ConnectionStatus>
  activeConnectionId: string | null

  // Actions
  loadConnections: () => Promise<void>
  addConnection: (formData: ConnectionFormData) => Promise<ConnectionConfig>
  updateConnection: (id: string, formData: Partial<ConnectionFormData>) => Promise<void>
  deleteConnection: (id: string) => Promise<void>
  duplicateConnection: (id: string) => Promise<ConnectionConfig>
  connect: (id: string) => Promise<void>
  disconnect: (id: string) => Promise<void>
  setActiveConnection: (id: string | null) => void
  getStatus: (id: string) => ConnectionStatus
}

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  connections: [],
  statuses: {},
  activeConnectionId: null,

  loadConnections: async () => {
    if (!window.db) return
    const connections = await window.db.listConnections()
    set({ connections })
  },

  addConnection: async (formData) => {
    const conn = await window.db!.addConnection(formData)
    set((state) => ({ connections: [...state.connections, conn] }))
    return conn
  },

  updateConnection: async (id, formData) => {
    const updated = await window.db!.updateConnection(id, formData)
    set((state) => ({
      connections: state.connections.map((c) => (c.id === id ? updated : c))
    }))
  },

  deleteConnection: async (id) => {
    await window.db!.deleteConnection(id)
    set((state) => ({
      connections: state.connections.filter((c) => c.id !== id),
      statuses: Object.fromEntries(
        Object.entries(state.statuses).filter(([k]) => k !== id)
      ),
      activeConnectionId: state.activeConnectionId === id ? null : state.activeConnectionId
    }))
  },

  duplicateConnection: async (id) => {
    const newConn = await window.db!.duplicateConnection(id)
    set((state) => ({ connections: [...state.connections, newConn] }))
    return newConn
  },

  connect: async (id) => {
    set((state) => ({ statuses: { ...state.statuses, [id]: 'connecting' } }))
    try {
      await window.db!.connect(id)
      set((state) => ({
        statuses: { ...state.statuses, [id]: 'connected' },
        activeConnectionId: id
      }))
    } catch (err) {
      set((state) => ({ statuses: { ...state.statuses, [id]: 'error' } }))
      throw err
    }
  },

  disconnect: async (id) => {
    await window.db!.disconnect(id)
    set((state) => ({
      statuses: { ...state.statuses, [id]: 'disconnected' },
      activeConnectionId: state.activeConnectionId === id ? null : state.activeConnectionId
    }))
  },

  setActiveConnection: (id) => {
    set({ activeConnectionId: id })
  },

  getStatus: (id) => {
    return get().statuses[id] ?? 'disconnected'
  }
}))
