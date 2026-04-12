import mysql, { type Pool, type RowDataPacket, type OkPacket } from 'mysql2/promise'
import type { IDbDriver, DriverResult, DriverTableInfo, DriverColumnInfo, DriverIndexInfo } from '../types'

interface MySQLConfig {
  host: string
  port: number
  database: string
  user: string
  password: string
  ssl?: boolean
}

export class MySQLDriver implements IDbDriver {
  private pool: Pool
  private currentDatabase: string

  constructor(config: MySQLConfig) {
    this.currentDatabase = config.database
    this.pool = mysql.createPool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
      waitForConnections: true,
      connectionLimit: 5,
      multipleStatements: false,
      // Keep connections alive so the server doesn't drop them after wait_timeout
      enableKeepAlive: true,
      keepAliveInitialDelay: 10000
    })
  }

  async testConnection(): Promise<void> {
    const conn = await this.pool.getConnection()
    await conn.ping()
    conn.release()
  }

  async execute(sql: string): Promise<DriverResult> {
    const trimmed = sql.trim().toUpperCase()
    const isSelect =
      trimmed.startsWith('SELECT') ||
      trimmed.startsWith('WITH') ||
      trimmed.startsWith('SHOW') ||
      trimmed.startsWith('DESCRIBE') ||
      trimmed.startsWith('DESC') ||
      trimmed.startsWith('EXPLAIN')

    if (isSelect) {
      const [rows, fields] = await this.pool.query(sql) as [RowDataPacket[], mysql.FieldPacket[]]
      const columns = (fields || []).map((f) => ({
        name: f.name,
        type: f.type !== undefined ? String(f.type) : 'unknown'
      }))
      return {
        columns,
        rows: rows as Record<string, unknown>[],
        rowCount: rows.length
      }
    } else {
      const [result] = await this.pool.query(sql) as [OkPacket, mysql.FieldPacket[]]
      return {
        columns: [],
        rows: [],
        rowCount: result.affectedRows ?? 0,
        affectedRows: result.affectedRows
      }
    }
  }

  async getDatabases(): Promise<string[]> {
    const [rows] = await this.pool.query('SHOW DATABASES') as [RowDataPacket[], mysql.FieldPacket[]]
    return rows.map((r) => r['Database'] as string)
  }

  async getTables(database?: string): Promise<DriverTableInfo[]> {
    const db = database ?? this.currentDatabase
    const [rows] = await this.pool.query(
      `SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME`,
      [db]
    ) as [RowDataPacket[], mysql.FieldPacket[]]
    return rows.map((r) => ({
      name: r['TABLE_NAME'] as string,
      type: (r['TABLE_TYPE'] === 'VIEW' ? 'view' : 'table') as 'table' | 'view'
    }))
  }

  async getColumns(table: string, database?: string): Promise<DriverColumnInfo[]> {
    const db = database ?? this.currentDatabase
    const [rows] = await this.pool.query(
      `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
       ORDER BY ORDINAL_POSITION`,
      [db, table]
    ) as [RowDataPacket[], mysql.FieldPacket[]]
    return rows.map((r) => ({
      name: r['COLUMN_NAME'] as string,
      type: r['DATA_TYPE'] as string,
      nullable: r['IS_NULLABLE'] === 'YES',
      primaryKey: r['COLUMN_KEY'] === 'PRI',
      defaultValue: r['COLUMN_DEFAULT'] != null ? String(r['COLUMN_DEFAULT']) : undefined
    }))
  }

  async useDatabase(database: string): Promise<void> {
    this.currentDatabase = database
    await this.pool.query(`USE \`${database}\``)
  }

  async getIndexes(table: string, database?: string): Promise<DriverIndexInfo[]> {
    const db = database ?? this.currentDatabase
    const [rows] = await this.pool.query(
      `SELECT INDEX_NAME, COLUMN_NAME, NON_UNIQUE
       FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
       ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
      [db, table]
    ) as [RowDataPacket[], mysql.FieldPacket[]]
    const map = new Map<string, DriverIndexInfo>()
    for (const r of rows) {
      const name = r['INDEX_NAME'] as string
      if (!map.has(name)) {
        map.set(name, { name, columns: [], unique: !r['NON_UNIQUE'], primary: name === 'PRIMARY' })
      }
      map.get(name)!.columns.push(r['COLUMN_NAME'] as string)
    }
    return Array.from(map.values())
  }

  async getTableDDL(table: string, database?: string): Promise<string> {
    const db = database ?? this.currentDatabase
    await this.pool.query(`USE \`${db}\``)
    const [rows] = await this.pool.query(`SHOW CREATE TABLE \`${table}\``) as [RowDataPacket[], mysql.FieldPacket[]]
    return (rows[0]?.['Create Table'] ?? rows[0]?.['Create View'] ?? '') as string
  }

  async disconnect(): Promise<void> {
    await this.pool.end()
  }
}
