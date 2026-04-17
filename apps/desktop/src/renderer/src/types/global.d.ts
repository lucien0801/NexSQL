import type { ConnectionConfig, ConnectionFormData, ConnectionTestResult } from '@shared/types/connection'
import type { QueryResult, DatabaseSchema, QueryHistoryEntry, SchemaColumn } from '@shared/types/query'
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

declare global {
  interface Window {
    db: undefined | {
      listConnections(): Promise<ConnectionConfig[]>
      addConnection(formData: ConnectionFormData): Promise<ConnectionConfig>
      updateConnection(id: string, formData: Partial<ConnectionFormData>): Promise<ConnectionConfig>
      deleteConnection(id: string): Promise<void>
      testConnection(formData: ConnectionFormData, existingId?: string): Promise<ConnectionTestResult>
      connect(id: string): Promise<void>
      disconnect(id: string): Promise<void>
      executeQuery(connectionId: string, sql: string, database?: string): Promise<QueryResult>
      getDatabases(connectionId: string): Promise<string[]>
      createDatabase(connectionId: string, database: string, charset?: string, collation?: string): Promise<void>
      dropDatabase(connectionId: string, database: string): Promise<void>
      alterDatabaseCharset(connectionId: string, database: string, charset: string, collation?: string, applyToAllTables?: boolean): Promise<void>
      getSchema(connectionId: string, database?: string): Promise<DatabaseSchema>
      getTableColumns(connectionId: string, table: string, database?: string): Promise<SchemaColumn[]>
      getTableIndexes(connectionId: string, table: string, database?: string): Promise<Array<{ name: string; columns: string[]; unique: boolean; primary: boolean }>>
      getTableDDL(connectionId: string, table: string, database?: string): Promise<string>
      exportTableSQL(connectionId: string, table: string, database?: string): Promise<string>
      exportDatabaseSQL(connectionId: string, database?: string): Promise<string>
      importDatabaseSQL(connectionId: string, sql: string, database?: string): Promise<number>
      getHistory(connectionId?: string, limit?: number): Promise<QueryHistoryEntry[]>
      duplicateConnection(id: string): Promise<ConnectionConfig>
      exportConnections(): Promise<string>
      importConnections(jsonStr: string): Promise<number>
    }
    ai: undefined | {
      getConfig(): Promise<AIConfig>
      updateConfig(config: Partial<AIConfig>): Promise<void>
      generateSQL(request: NLToSQLRequest): Promise<string>
      optimizeSQL(request: SQLOptimizeRequest): Promise<SQLOptimizeResponse>
      generateDesignSQL(request: AIDesignRequest): Promise<AIDesignResponse>
      generateSchemaDoc(request: AIDocRequest): Promise<AIDocResponse>
      buildSemanticIndex(request: SemanticIndexBuildRequest): Promise<SemanticIndexBuildResponse>
      getSemanticIndexStatus(connectionId: string): Promise<SemanticIndexItem[]>
      updateSemanticIndexItem(request: SemanticIndexUpdateRequest): Promise<SemanticIndexItem>
      getERGraph(request: ERGraphLoadRequest): Promise<ERGraphLoadResponse>
      saveERGraph(request: ERGraphSaveRequest): Promise<ERGraphSaveResponse>
      inferSchemaRelations(request: ERGraphInferRequest): Promise<ERGraphInferResponse>
      onSQLToken(callback: (token: string) => void): () => void
      onSQLDone(callback: () => void): () => void
    }
    platform: string | undefined
  }
}

export {}
