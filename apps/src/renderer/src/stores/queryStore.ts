import { create } from 'zustand'
import type { QueryResult, QueryHistoryEntry, DatabaseSchema, SchemaColumn } from '@shared/types/query'

export type QueryTabType = 'query' | 'table'
export type TableSortDirection = 'asc' | 'desc'

export interface TableSortRule {
  column: string
  direction: TableSortDirection
}

export interface TableColumnFilterRule {
  id: string
  column: string
  value: string
}

export interface TablePendingEdit {
  originalRow: Record<string, unknown>
  values: Record<string, string>
}

export interface TableDraftInsert {
  id: string
  values: Record<string, string>
}

export interface TableViewState {
  page: number
  pageSize: number
  totalRows: number
  sortColumn: string | null
  sortDirection: TableSortDirection
  sortRules: TableSortRule[]
  filterText: string
  columnFilters: TableColumnFilterRule[]
  columns: SchemaColumn[]
  rows: Record<string, unknown>[]
  pendingEdits: Record<string, TablePendingEdit>
  pendingInserts: TableDraftInsert[]
  pendingDeletes: Record<string, Record<string, unknown>>
 }

export interface QueryTab {
  id: string
  title: string
  type: QueryTabType
  connectionId: string | null
  sql: string
  result: QueryResult | null
  isLoading: boolean
  error: string | null
  selectedDatabase: string | null
  tableName?: string
  tableView?: TableViewState
  hasPendingChanges?: boolean
}

interface QueryState {
  tabs: QueryTab[]
  activeTabId: string | null
  history: QueryHistoryEntry[]
  schema: Record<string, DatabaseSchema> // keyed by connectionId

  // Tab actions
  newTab: (connectionId?: string) => string
  openTableTab: (connectionId: string, tableName: string, database?: string) => string
  closeTab: (tabId: string) => void
  setActiveTab: (tabId: string) => void
  updateTabSQL: (tabId: string, sql: string) => void
  updateTabConnection: (tabId: string, connectionId: string | null) => void
  updateTabDatabase: (tabId: string, database: string | null) => void
  patchTab: (tabId: string, patch: Partial<QueryTab>) => void
  updateTableView: (tabId: string, updater: (view: TableViewState) => TableViewState) => void

  // Query actions
  executeQuery: (tabId: string, sqlOverride?: string) => Promise<void>

  // Schema actions
  loadSchema: (connectionId: string, database?: string) => Promise<void>
  getSchema: (connectionId: string) => DatabaseSchema | null

  // History actions
  loadHistory: (connectionId?: string) => Promise<void>
}

export const useQueryStore = create<QueryState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  history: [],
  schema: {},

  newTab: (connectionId) => {
    const id = crypto.randomUUID()
    const tabCount = get().tabs.length + 1
    const tab: QueryTab = {
      id,
      title: `Query ${tabCount}`,
      type: 'query',
      connectionId: connectionId ?? null,
      sql: '',
      result: null,
      isLoading: false,
      error: null,
      selectedDatabase: null
    }
    set((state) => ({ tabs: [...state.tabs, tab], activeTabId: id }))
    return id
  },

  openTableTab: (connectionId, tableName, database) => {
    const existing = get().tabs.find(
      (tab) =>
        tab.type === 'table' &&
        tab.connectionId === connectionId &&
        tab.tableName === tableName &&
        (tab.selectedDatabase ?? null) === (database ?? null)
    )

    if (existing) {
      set({ activeTabId: existing.id })
      return existing.id
    }

    const id = crypto.randomUUID()
    const tab: QueryTab = {
      id,
      title: tableName,
      type: 'table',
      connectionId,
      sql: '',
      result: null,
      isLoading: false,
      error: null,
      selectedDatabase: database ?? null,
      tableName,
      hasPendingChanges: false,
      tableView: {
        page: 1,
        pageSize: 100,
        totalRows: 0,
        sortColumn: null,
        sortDirection: 'asc',
        sortRules: [],
        filterText: '',
        columnFilters: [],
        columns: [],
        rows: [],
        pendingEdits: {},
        pendingInserts: [],
        pendingDeletes: {}
      }
    }
    set((state) => ({ tabs: [...state.tabs, tab], activeTabId: id }))
    return id
  },

  closeTab: (tabId) => {
    set((state) => {
      const idx = state.tabs.findIndex((t) => t.id === tabId)
      const newTabs = state.tabs.filter((t) => t.id !== tabId)
      let newActiveId = state.activeTabId
      if (state.activeTabId === tabId) {
        if (newTabs.length > 0) {
          newActiveId = newTabs[Math.max(0, idx - 1)].id
        } else {
          newActiveId = null
        }
      }
      return { tabs: newTabs, activeTabId: newActiveId }
    })
  },

  setActiveTab: (tabId) => {
    set({ activeTabId: tabId })
  },

  updateTabSQL: (tabId, sql) => {
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, sql } : t))
    }))
  },

  updateTabConnection: (tabId, connectionId) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, connectionId, selectedDatabase: null } : t
      )
    }))
  },

  updateTabDatabase: (tabId, database) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, selectedDatabase: database } : t
      )
    }))
  },

  patchTab: (tabId, patch) => {
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, ...patch } : t))
    }))
  },

  updateTableView: (tabId, updater) => {
    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (tab.id !== tabId || !tab.tableView) return tab
        return { ...tab, tableView: updater(tab.tableView) }
      })
    }))
  },

  executeQuery: async (tabId, sqlOverride) => {
    const tab = get().tabs.find((t) => t.id === tabId)
    const sqlToRun = sqlOverride ?? tab?.sql ?? ''
    if (!tab || !tab.connectionId || !sqlToRun.trim()) return

    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, isLoading: true, error: null, result: null } : t
      )
    }))

    try {
      const result = await window.db!.executeQuery(
        tab.connectionId,
        sqlToRun,
        tab.selectedDatabase ?? undefined
      )
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === tabId ? { ...t, isLoading: false, result, error: result.error ?? null } : t
        )
      }))
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === tabId ? { ...t, isLoading: false, error: errorMsg } : t
        )
      }))
    }
  },

  loadSchema: async (connectionId, database) => {
    try {
      if (!window.db) return
      const schema = await window.db.getSchema(connectionId, database)
      set((state) => ({
        schema: { ...state.schema, [connectionId]: schema }
      }))
    } catch {
      // Silently fail schema load
    }
  },

  getSchema: (connectionId) => {
    return get().schema[connectionId] ?? null
  },

  loadHistory: async (connectionId) => {
    if (!window.db) return
    const history = await window.db.getHistory(connectionId, 200)
    set({ history })
  }
}))
