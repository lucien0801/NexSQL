import * as sql from 'mssql'
import type { IDbDriver, DriverResult, DriverTableInfo, DriverColumnInfo, DriverIndexInfo } from '../types'

interface MSSQLConfig {
  host: string
  port: number
  database: string
  user: string
  password: string
  ssl?: boolean
}

export class MSSQLDriver implements IDbDriver {
  private pool: sql.ConnectionPool | null = null
  private config: sql.config

  constructor(config: MSSQLConfig) {
    this.config = {
      server: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      options: {
        encrypt: config.ssl ?? true,
        trustServerCertificate: true,
        enableArithAbort: true
      },
      pool: {
        max: 5,
        min: 0,
        idleTimeoutMillis: 30000
      }
    }
  }

  private async getPool(): Promise<sql.ConnectionPool> {
    if (!this.pool || !this.pool.connected) {
      this.pool = await new sql.ConnectionPool(this.config).connect()
    }
    return this.pool
  }

  async testConnection(): Promise<void> {
    const pool = await this.getPool()
    await pool.request().query('SELECT 1 AS test')
  }

  async execute(sqlStr: string): Promise<DriverResult> {
    const pool = await this.getPool()
    const result = await pool.request().query(sqlStr)
    const recordset = result.recordset ?? []
    const columnsMeta = (recordset as unknown as { columns?: Record<string, { name: string; type: { name?: string } }> }).columns ?? {}
    const columns = Object.values(columnsMeta).map((c) => ({
      name: c.name,
      type: c.type?.name ?? 'unknown'
    }))
    const rowsAffected = result.rowsAffected.reduce((a, b) => a + b, 0)
    return {
      columns,
      rows: recordset as Record<string, unknown>[],
      rowCount: recordset.length > 0 ? recordset.length : rowsAffected,
      affectedRows: rowsAffected
    }
  }

  async getDatabases(): Promise<string[]> {
    const pool = await this.getPool()
    const result = await pool.request().query('SELECT name FROM sys.databases ORDER BY name')
    return result.recordset.map((r: Record<string, unknown>) => r['name'] as string)
  }

  async getTables(database?: string): Promise<DriverTableInfo[]> {
    const pool = await this.getPool()
    const db = database ? `[${database}]..` : ''
    const result = await pool.request().query(`
      SELECT TABLE_NAME, TABLE_TYPE
      FROM ${db}information_schema.tables
      WHERE TABLE_SCHEMA = 'dbo'
      ORDER BY TABLE_NAME
    `)
    return result.recordset.map((r: Record<string, unknown>) => ({
      name: r['TABLE_NAME'] as string,
      type: (r['TABLE_TYPE'] === 'VIEW' ? 'view' : 'table') as 'table' | 'view'
    }))
  }

  async getColumns(table: string, database?: string): Promise<DriverColumnInfo[]> {
    const pool = await this.getPool()
    const db = database ? `[${database}]..` : ''
    const request = pool.request()
    request.input('tableName', sql.NVarChar, table)
    const result = await request.query(`
      SELECT
        c.COLUMN_NAME,
        c.DATA_TYPE,
        c.IS_NULLABLE,
        c.COLUMN_DEFAULT,
        CASE WHEN pk.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END AS IS_PRIMARY_KEY
      FROM ${db}information_schema.COLUMNS c
      LEFT JOIN (
        SELECT ku.COLUMN_NAME
        FROM ${db}information_schema.TABLE_CONSTRAINTS tc
        JOIN ${db}information_schema.KEY_COLUMN_USAGE ku
          ON tc.CONSTRAINT_NAME = ku.CONSTRAINT_NAME
        WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
          AND tc.TABLE_NAME = @tableName
      ) pk ON c.COLUMN_NAME = pk.COLUMN_NAME
      WHERE c.TABLE_NAME = @tableName
      ORDER BY c.ORDINAL_POSITION
    `)
    return result.recordset.map((r: Record<string, unknown>) => ({
      name: r['COLUMN_NAME'] as string,
      type: r['DATA_TYPE'] as string,
      nullable: r['IS_NULLABLE'] === 'YES',
      primaryKey: r['IS_PRIMARY_KEY'] === 1,
      defaultValue: r['COLUMN_DEFAULT'] != null ? String(r['COLUMN_DEFAULT']) : undefined
    }))
  }

  async useDatabase(database: string): Promise<void> {
    const pool = await this.getPool()
    await pool.request().query(`USE [${database}]`)
  }

  async getIndexes(table: string, database?: string): Promise<DriverIndexInfo[]> {
    const pool = await this.getPool()
    const db = database ? `[${database}]..` : ''
    const request = pool.request()
    request.input('tableName', sql.NVarChar, table)
    const result = await request.query(`
      SELECT i.name AS index_name, c.name AS column_name,
             i.is_unique, i.is_primary_key
      FROM ${db}sys.indexes i
      JOIN ${db}sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
      JOIN ${db}sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
      JOIN ${db}sys.tables t ON t.object_id = i.object_id
      WHERE t.name = @tableName
      ORDER BY i.name, ic.key_ordinal
    `)
    const map = new Map<string, DriverIndexInfo>()
    for (const r of result.recordset as Record<string, unknown>[]) {
      const name = r['index_name'] as string
      if (!map.has(name)) {
        map.set(name, { name, columns: [], unique: !!(r['is_unique']), primary: !!(r['is_primary_key']) })
      }
      map.get(name)!.columns.push(r['column_name'] as string)
    }
    return Array.from(map.values())
  }

  async getTableDDL(table: string, database?: string): Promise<string> {
    const pool = await this.getPool()
    const db = database ? `[${database}]..` : ''
    const request = pool.request()
    request.input('tableName', sql.NVarChar, table)
    const result = await request.query(`
      SELECT c.COLUMN_NAME, c.DATA_TYPE, c.CHARACTER_MAXIMUM_LENGTH,
             c.IS_NULLABLE, c.COLUMN_DEFAULT
      FROM ${db}information_schema.COLUMNS c
      WHERE c.TABLE_NAME = @tableName
      ORDER BY c.ORDINAL_POSITION
    `)
    const lines = (result.recordset as Record<string, unknown>[]).map((r) => {
      let col = `  [${r['COLUMN_NAME']}] ${r['DATA_TYPE'] as string}`
      if (r['CHARACTER_MAXIMUM_LENGTH']) col += `(${r['CHARACTER_MAXIMUM_LENGTH']})`
      if (r['IS_NULLABLE'] === 'NO') col += ' NOT NULL'
      if (r['COLUMN_DEFAULT']) col += ` DEFAULT ${r['COLUMN_DEFAULT'] as string}`
      return col
    })
    return `CREATE TABLE [${table}] (\n${lines.join(',\n')}\n);`
  }

  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.close()
      this.pool = null
    }
  }
}
