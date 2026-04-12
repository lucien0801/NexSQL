import Database from 'better-sqlite3'
import type { IDbDriver, DriverResult, DriverTableInfo, DriverColumnInfo, DriverIndexInfo } from '../types'

interface SQLiteConfig {
  filePath: string
}

interface SQLitePragmaRow {
  name: string
  type: string
  notnull: number
  dflt_value: string | null
  pk: number
}

export class SQLiteDriver implements IDbDriver {
  private db: Database.Database

  constructor(config: SQLiteConfig) {
    this.db = new Database(config.filePath)
    this.db.pragma('foreign_keys = ON')
  }

  async testConnection(): Promise<void> {
    this.db.prepare('SELECT 1').get()
  }

  async execute(sql: string): Promise<DriverResult> {
    const trimmed = sql.trim().toUpperCase()
    const isSelect =
      trimmed.startsWith('SELECT') ||
      trimmed.startsWith('WITH') ||
      trimmed.startsWith('PRAGMA') ||
      trimmed.startsWith('EXPLAIN')

    if (isSelect) {
      const stmt = this.db.prepare(sql)
      const rows = stmt.all() as Record<string, unknown>[]
      const columns =
        rows.length > 0
          ? Object.keys(rows[0]).map((name) => ({ name, type: 'text' }))
          : []
      return { columns, rows, rowCount: rows.length }
    } else {
      const stmt = this.db.prepare(sql)
      const info = stmt.run()
      return {
        columns: [],
        rows: [],
        rowCount: info.changes,
        affectedRows: info.changes
      }
    }
  }

  async getDatabases(): Promise<string[]> {
    return ['main']
  }

  async getTables(_database?: string): Promise<DriverTableInfo[]> {
    const rows = this.db
      .prepare(
        `SELECT name, type FROM sqlite_master
         WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'
         ORDER BY name`
      )
      .all() as { name: string; type: string }[]
    return rows.map((r) => ({
      name: r.name,
      type: r.type as 'table' | 'view'
    }))
  }

  async getColumns(table: string, _database?: string): Promise<DriverColumnInfo[]> {
    const rows = this.db.prepare(`PRAGMA table_info("${table}")`).all() as SQLitePragmaRow[]
    return rows.map((r) => ({
      name: r.name,
      type: r.type || 'TEXT',
      nullable: r.notnull === 0,
      primaryKey: r.pk > 0,
      defaultValue: r.dflt_value ?? undefined
    }))
  }

  async useDatabase(_database: string): Promise<void> {
    // SQLite has no database switching
  }

  async getIndexes(table: string, _database?: string): Promise<DriverIndexInfo[]> {
    const rows = this.db.prepare(`PRAGMA index_list("${table}")`).all() as { name: string; unique: number; origin: string }[]
    return rows.map((r) => {
      const cols = this.db.prepare(`PRAGMA index_info("${r.name}")`).all() as { name: string }[]
      return {
        name: r.name,
        columns: cols.map((c) => c.name),
        unique: r.unique === 1,
        primary: r.origin === 'pk'
      }
    })
  }

  async getTableDDL(table: string, _database?: string): Promise<string> {
    const row = this.db
      .prepare(`SELECT sql FROM sqlite_master WHERE type IN ('table','view') AND name = ?`)
      .get(table) as { sql: string } | undefined
    return row?.sql ?? `-- DDL not available for ${table}`
  }

  async disconnect(): Promise<void> {
    this.db.close()
  }
}
