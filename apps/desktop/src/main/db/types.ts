import type { ConnectionConfig } from '@shared/types/connection'
import type { QueryResult } from '@shared/types/query'

export interface DriverColumn {
  name: string
  type: string
}

export interface DriverResult {
  columns: DriverColumn[]
  rows: Record<string, unknown>[]
  rowCount: number
  affectedRows?: number
}

export interface DriverTableInfo {
  name: string
  type: 'table' | 'view'
}

export interface DriverColumnInfo {
  name: string
  type: string
  nullable: boolean
  primaryKey: boolean
  defaultValue?: string
  collation?: string
}

export interface DriverIndexInfo {
  name: string
  columns: string[]
  unique: boolean
  primary: boolean
}

export interface IDbDriver {
  testConnection(): Promise<void>
  execute(sql: string): Promise<DriverResult>
  getDatabases(): Promise<string[]>
  getTables(database?: string): Promise<DriverTableInfo[]>
  getColumns(table: string, database?: string): Promise<DriverColumnInfo[]>
  getIndexes(table: string, database?: string): Promise<DriverIndexInfo[]>
  getTableDDL(table: string, database?: string): Promise<string>
  useDatabase(database: string): Promise<void>
  disconnect(): Promise<void>
}

export function driverResultToQueryResult(
  result: DriverResult,
  sql: string,
  durationMs: number
): QueryResult {
  return {
    columns: result.columns,
    rows: result.rows,
    rowCount: result.rowCount,
    durationMs,
    sql
  }
}

export type { ConnectionConfig }
