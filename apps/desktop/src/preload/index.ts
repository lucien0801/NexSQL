import { contextBridge, ipcRenderer } from 'electron'
import type { ConnectionConfig, ConnectionFormData, ConnectionTestResult } from '@shared/types/connection'
import type {
  QueryResult,
  DatabaseSchema,
  QueryHistoryEntry,
  SchemaColumn
} from '@shared/types/query'
import type {
  AIConfig,
  NLToSQLRequest,
  SQLOptimizeRequest,
  SQLOptimizeResponse,
  AIDesignRequest,
  AIDesignResponse,
  AIDocRequest,
  AIDocResponse,
  SemanticIndexBuildRequest,
  SemanticIndexBuildResponse,
  SemanticIndexItem,
  SemanticIndexUpdateRequest,
  ERGraphLoadRequest,
  ERGraphLoadResponse,
  ERGraphSaveRequest,
  ERGraphSaveResponse,
  ERGraphInferRequest,
  ERGraphInferResponse
} from '@shared/types/ai'

const dbAPI = {
  listConnections: (): Promise<ConnectionConfig[]> =>
    ipcRenderer.invoke('db:listConnections'),

  addConnection: (formData: ConnectionFormData): Promise<ConnectionConfig> =>
    ipcRenderer.invoke('db:addConnection', formData),

  updateConnection: (id: string, formData: Partial<ConnectionFormData>): Promise<ConnectionConfig> =>
    ipcRenderer.invoke('db:updateConnection', id, formData),

  deleteConnection: (id: string): Promise<void> =>
    ipcRenderer.invoke('db:deleteConnection', id),

  testConnection: (formData: ConnectionFormData, existingId?: string): Promise<ConnectionTestResult> =>
    ipcRenderer.invoke('db:testConnection', formData, existingId),

  connect: (id: string): Promise<void> =>
    ipcRenderer.invoke('db:connect', id),

  disconnect: (id: string): Promise<void> =>
    ipcRenderer.invoke('db:disconnect', id),

  executeQuery: (connectionId: string, sql: string, database?: string): Promise<QueryResult> =>
    ipcRenderer.invoke('db:executeQuery', connectionId, sql, database),

  getDatabases: (connectionId: string): Promise<string[]> =>
    ipcRenderer.invoke('db:getDatabases', connectionId),

  createDatabase: (connectionId: string, database: string, charset?: string, collation?: string): Promise<void> =>
    ipcRenderer.invoke('db:createDatabase', connectionId, database, charset, collation),

  dropDatabase: (connectionId: string, database: string): Promise<void> =>
    ipcRenderer.invoke('db:dropDatabase', connectionId, database),

  alterDatabaseCharset: (
    connectionId: string,
    database: string,
    charset: string,
    collation?: string,
    applyToAllTables?: boolean
  ): Promise<void> =>
    ipcRenderer.invoke(
      'db:alterDatabaseCharset',
      connectionId,
      database,
      charset,
      collation,
      applyToAllTables
    ),

  getSchema: (connectionId: string, database?: string): Promise<DatabaseSchema> =>
    ipcRenderer.invoke('db:getSchema', connectionId, database),

  getTableColumns: (connectionId: string, table: string, database?: string): Promise<SchemaColumn[]> =>
    ipcRenderer.invoke('db:getTableColumns', connectionId, table, database),

  getTableIndexes: (connectionId: string, table: string, database?: string): Promise<Array<{ name: string; columns: string[]; unique: boolean; primary: boolean }>> =>
    ipcRenderer.invoke('db:getTableIndexes', connectionId, table, database),

  getTableDDL: (connectionId: string, table: string, database?: string): Promise<string> =>
    ipcRenderer.invoke('db:getTableDDL', connectionId, table, database),

  exportTableSQL: (connectionId: string, table: string, database?: string): Promise<string> =>
    ipcRenderer.invoke('db:exportTableSQL', connectionId, table, database),

  exportDatabaseSQL: (connectionId: string, database?: string): Promise<string> =>
    ipcRenderer.invoke('db:exportDatabaseSQL', connectionId, database),

  importDatabaseSQL: (connectionId: string, sql: string, database?: string): Promise<number> =>
    ipcRenderer.invoke('db:importDatabaseSQL', connectionId, sql, database),

  getHistory: (connectionId?: string, limit?: number): Promise<QueryHistoryEntry[]> =>
    ipcRenderer.invoke('db:getHistory', connectionId, limit),

  duplicateConnection: (id: string): Promise<ConnectionConfig> =>
    ipcRenderer.invoke('db:duplicateConnection', id),

  exportConnections: (): Promise<string> =>
    ipcRenderer.invoke('db:exportConnections'),

  importConnections: (jsonStr: string): Promise<number> =>
    ipcRenderer.invoke('db:importConnections', jsonStr)
}

const aiAPI = {
  getConfig: (): Promise<AIConfig> =>
    ipcRenderer.invoke('ai:getConfig'),

  updateConfig: (config: Partial<AIConfig>): Promise<void> =>
    ipcRenderer.invoke('ai:updateConfig', config),

  generateSQL: (request: NLToSQLRequest): Promise<string> =>
    ipcRenderer.invoke('ai:generateSQL', request),

  optimizeSQL: (request: SQLOptimizeRequest): Promise<SQLOptimizeResponse> =>
    ipcRenderer.invoke('ai:optimizeSQL', request),

  generateDesignSQL: (request: AIDesignRequest): Promise<AIDesignResponse> =>
    ipcRenderer.invoke('ai:generateDesignSQL', request),

  generateSchemaDoc: (request: AIDocRequest): Promise<AIDocResponse> =>
    ipcRenderer.invoke('ai:generateSchemaDoc', request),

  buildSemanticIndex: (request: SemanticIndexBuildRequest): Promise<SemanticIndexBuildResponse> =>
    ipcRenderer.invoke('ai:buildSemanticIndex', request),

  getSemanticIndexStatus: (connectionId: string): Promise<SemanticIndexItem[]> =>
    ipcRenderer.invoke('ai:getSemanticIndexStatus', connectionId),

  updateSemanticIndexItem: (request: SemanticIndexUpdateRequest): Promise<SemanticIndexItem> =>
    ipcRenderer.invoke('ai:updateSemanticIndexItem', request),

  getERGraph: (request: ERGraphLoadRequest): Promise<ERGraphLoadResponse> =>
    ipcRenderer.invoke('ai:getERGraph', request),

  saveERGraph: (request: ERGraphSaveRequest): Promise<ERGraphSaveResponse> =>
    ipcRenderer.invoke('ai:saveERGraph', request),

  inferSchemaRelations: (request: ERGraphInferRequest): Promise<ERGraphInferResponse> =>
    ipcRenderer.invoke('ai:inferSchemaRelations', request),

  onSQLToken: (callback: (token: string) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, token: string): void => callback(token)
    ipcRenderer.on('ai:sqlToken', listener)
    return () => ipcRenderer.off('ai:sqlToken', listener)
  },

  onSQLDone: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('ai:sqlDone', listener)
    return () => ipcRenderer.off('ai:sqlDone', listener)
  }
}

contextBridge.exposeInMainWorld('db', dbAPI)
contextBridge.exposeInMainWorld('ai', aiAPI)
contextBridge.exposeInMainWorld('platform', process.platform)

export type DbAPI = typeof dbAPI
export type AiAPI = typeof aiAPI
