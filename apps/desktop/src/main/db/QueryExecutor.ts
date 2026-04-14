import { app } from 'electron'
import Database from 'better-sqlite3'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type { QueryResult, QueryHistoryEntry, DatabaseSchema, DatabaseInfo, SchemaTable, SchemaColumn } from '@shared/types/query'
import { getDriver, getConnectionConfig, reconnectById } from './ConnectionManager'
import { driverResultToQueryResult } from './types'

let internalDb: Database.Database | null = null

function getInternalDb(): Database.Database {
  if (!internalDb) {
    const dbPath = join(app.getPath('userData'), 'nexsql.db')
    internalDb = new Database(dbPath)
  }
  return internalDb
}

/** Network error codes that indicate the connection was dropped by the server */
function isConnectionDropped(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const code = (err as NodeJS.ErrnoException).code ?? ''
  const msg = err.message ?? ''
  return (
    code === 'ECONNRESET' ||
    code === 'ECONNREFUSED' ||
    code === 'ETIMEDOUT' ||
    code === 'EPIPE' ||
    msg.includes('Connection lost') ||
    msg.includes('server has gone away') ||
    msg.includes('terminating connection')
  )
}

async function runWithReconnect<T>(
  connectionId: string,
  action: () => Promise<T>
): Promise<T> {
  try {
    return await action()
  } catch (err) {
    if (!isConnectionDropped(err)) throw err
    await reconnectById(connectionId)
    return action()
  }
}

export async function executeQuery(
  connectionId: string,
  sql: string,
  _database?: string
): Promise<QueryResult> {
  const start = Date.now()
  let result: QueryResult

  const runQuery = async (): Promise<QueryResult> => {
    const driver = getDriver(connectionId)
    if (_database) {
      await driver.useDatabase(_database)
    }
    const driverResult = await driver.execute(sql)
    const durationMs = Date.now() - start
    return driverResultToQueryResult(driverResult, sql, durationMs)
  }

  try {
    result = await runQuery()
    saveHistory(connectionId, sql, Date.now() - start, result.rowCount, true)
  } catch (firstErr) {
    // One automatic reconnect attempt on dropped-connection errors
    if (isConnectionDropped(firstErr)) {
      try {
        await reconnectById(connectionId)
        result = await runQuery()
        saveHistory(connectionId, sql, Date.now() - start, result.rowCount, true)
      } catch (retryErr) {
        const durationMs = Date.now() - start
        const errorMsg = retryErr instanceof Error ? retryErr.message : String(retryErr)
        result = { columns: [], rows: [], rowCount: 0, durationMs, sql, error: errorMsg }
        saveHistory(connectionId, sql, durationMs, 0, false, errorMsg)
      }
    } else {
      const durationMs = Date.now() - start
      const errorMsg = firstErr instanceof Error ? firstErr.message : String(firstErr)
      result = { columns: [], rows: [], rowCount: 0, durationMs, sql, error: errorMsg }
      saveHistory(connectionId, sql, durationMs, 0, false, errorMsg)
    }
  }

  return result
}

export async function getDatabases(connectionId: string): Promise<string[]> {
  return runWithReconnect(connectionId, async () => getDriver(connectionId).getDatabases())
}

export async function getSchema(
  connectionId: string,
  database?: string
): Promise<DatabaseSchema> {
  return runWithReconnect(connectionId, async () => {
    const driver = getDriver(connectionId)

    // When database is not explicitly specified, enumerate ALL databases
    // (do NOT fall back to config.database, otherwise users with a configured
    // default DB would only ever see that one schema)
    const targetDb = database ?? ''

    // If no specific database is specified, enumerate all databases and load their tables
    if (!targetDb) {
      let dbNames: string[] = []
      try {
        dbNames = await driver.getDatabases()
      } catch {
        // fallback: try empty string
        dbNames = ['']
      }

      const databases: DatabaseInfo[] = await Promise.all(
        dbNames.map(async (dbName) => {
          try {
            const tables = await driver.getTables(dbName)
            return {
              name: dbName,
              tables: tables.map((t) => ({ name: t.name, type: t.type, columns: [] }))
            } as DatabaseInfo
          } catch {
            return { name: dbName, tables: [] } as DatabaseInfo
          }
        })
      )
      return { connectionId, databases }
    }

    const tables = await driver.getTables(targetDb)

    // Lazy: only return table list without columns for speed
    const tableList: SchemaTable[] = tables.map((t) => ({
      name: t.name,
      type: t.type,
      columns: [] // loaded on demand
    }))

    const dbInfo: DatabaseInfo = {
      name: targetDb,
      tables: tableList
    }

    return {
      connectionId,
      databases: [dbInfo]
    }
  })
}

export async function getTableColumns(
  connectionId: string,
  table: string,
  database?: string
): Promise<SchemaColumn[]> {
  return runWithReconnect(connectionId, async () => {
    const driver = getDriver(connectionId)
    const config = getConnectionConfig(connectionId)
    const targetDb = database ?? config.database ?? ''
    const cols = await driver.getColumns(table, targetDb)
    return cols.map((c) => ({
      name: c.name,
      type: c.type,
      nullable: c.nullable,
      primaryKey: c.primaryKey,
      defaultValue: c.defaultValue
    }))
  })
}

export async function getTableIndexes(
  connectionId: string,
  table: string,
  database?: string
): Promise<Array<{ name: string; columns: string[]; unique: boolean; primary: boolean }>> {
  return runWithReconnect(connectionId, async () => {
    const driver = getDriver(connectionId)
    const config = getConnectionConfig(connectionId)
    const targetDb = database ?? config.database ?? ''
    return driver.getIndexes(table, targetDb)
  })
}

export async function getTableDDL(
  connectionId: string,
  table: string,
  database?: string
): Promise<string> {
  return runWithReconnect(connectionId, async () => {
    const driver = getDriver(connectionId)
    const config = getConnectionConfig(connectionId)
    const targetDb = database ?? config.database ?? ''
    return driver.getTableDDL(table, targetDb)
  })
}

export async function exportTableSQL(
  connectionId: string,
  table: string,
  database?: string
): Promise<string> {
  return runWithReconnect(connectionId, async () => {
    const driver = getDriver(connectionId)
    const config = getConnectionConfig(connectionId)
    const targetDb = database ?? config.database ?? ''

    const ddl = await driver.getTableDDL(table, targetDb)
    const dataResult = await driver.execute(`SELECT * FROM \`${table}\``)
    const rows = dataResult.rows

    if (rows.length === 0) return ddl + '\n-- No data'

    const cols = dataResult.columns.map((c) => `\`${c.name}\``).join(', ')
    const inserts = rows.map((row) => {
      const vals = dataResult.columns.map((c) => {
        const v = row[c.name]
        if (v === null || v === undefined) return 'NULL'
        if (typeof v === 'number') return String(v)
        return `'${String(v).replace(/'/g, "''")}'`
      }).join(', ')
      return `INSERT INTO \`${table}\` (${cols}) VALUES (${vals});`
    })

    return ddl + '\n\n' + inserts.join('\n')
  })
}

function escapeMySQLIdentifier(name: string): string {
  return `\`${name.replace(/`/g, '``')}\``
}

function escapePostgresIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

function escapeMSSQLIdentifier(name: string): string {
  return `[${name.replace(/]/g, ']]')}]`
}

export async function createDatabase(
  connectionId: string,
  database: string,
  charset?: string,
  collation?: string
): Promise<void> {
  return runWithReconnect(connectionId, async () => {
    const driver = getDriver(connectionId)
    const config = getConnectionConfig(connectionId)
    const dbName = database.trim()
    if (!dbName) throw new Error('数据库名不能为空')

    if (config.type === 'mysql') {
      const charsetSql = charset?.trim() ? ` CHARACTER SET ${charset.trim()}` : ''
      const collateSql = collation?.trim() ? ` COLLATE ${collation.trim()}` : ''
      await driver.execute(`CREATE DATABASE ${escapeMySQLIdentifier(dbName)}${charsetSql}${collateSql}`)
      return
    }

    if (config.type === 'postgresql') {
      await driver.execute(`CREATE DATABASE ${escapePostgresIdentifier(dbName)}`)
      return
    }

    if (config.type === 'mssql') {
      await driver.execute(`CREATE DATABASE ${escapeMSSQLIdentifier(dbName)}`)
      return
    }

    throw new Error('当前数据库类型不支持创建数据库')
  })
}

export async function dropDatabase(
  connectionId: string,
  database: string
): Promise<void> {
  return runWithReconnect(connectionId, async () => {
    const driver = getDriver(connectionId)
    const config = getConnectionConfig(connectionId)
    const dbName = database.trim()
    if (!dbName) throw new Error('数据库名不能为空')

    if (config.type === 'mysql') {
      // Avoid dropping the currently selected DB.
      await driver.useDatabase('information_schema')
      await driver.execute(`DROP DATABASE ${escapeMySQLIdentifier(dbName)}`)
      return
    }

    if (config.type === 'postgresql') {
      await driver.execute(`DROP DATABASE ${escapePostgresIdentifier(dbName)}`)
      return
    }

    if (config.type === 'mssql') {
      await driver.execute(`DROP DATABASE ${escapeMSSQLIdentifier(dbName)}`)
      return
    }

    throw new Error('当前数据库类型不支持删除数据库')
  })
}

export async function alterDatabaseCharset(
  connectionId: string,
  database: string,
  charset: string,
  collation?: string,
  applyToAllTables = false
): Promise<void> {
  return runWithReconnect(connectionId, async () => {
    const driver = getDriver(connectionId)
    const config = getConnectionConfig(connectionId)
    const dbName = database.trim()
    const charsetName = charset.trim()

    if (!dbName) throw new Error('数据库名不能为空')
    if (!charsetName) throw new Error('字符集不能为空')

    if (config.type !== 'mysql') {
      throw new Error('仅 MySQL/MariaDB 支持修改数据库字符集')
    }

    const collateSql = collation?.trim() ? ` COLLATE ${collation.trim()}` : ''

    await driver.execute(
      `ALTER DATABASE ${escapeMySQLIdentifier(dbName)} CHARACTER SET ${charsetName}${collateSql}`
    )

    if (!applyToAllTables) return

    const tableRows = await driver.execute(
      `SELECT TABLE_NAME
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = '${dbName.replace(/'/g, "''")}' AND TABLE_TYPE = 'BASE TABLE'
       ORDER BY TABLE_NAME`
    )

    for (const row of tableRows.rows) {
      const tableName = String(row['TABLE_NAME'] ?? row['table_name'] ?? '')
      if (!tableName) continue
      await driver.execute(
        `ALTER TABLE ${escapeMySQLIdentifier(dbName)}.${escapeMySQLIdentifier(tableName)} CONVERT TO CHARACTER SET ${charsetName}${collateSql}`
      )
    }
  })
}

function saveHistory(
  connectionId: string,
  sql: string,
  durationMs: number,
  rowCount: number,
  success: boolean,
  error?: string
): void {
  try {
    const db = getInternalDb()
    db.prepare(`
      INSERT INTO query_history (id, connection_id, sql, duration_ms, row_count, success, error, executed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      connectionId,
      sql.trim(),
      durationMs,
      rowCount,
      success ? 1 : 0,
      error ?? null,
      Date.now()
    )
  } catch {
    // Non-critical, ignore history save errors
  }
}

export function getHistory(
  connectionId?: string,
  limit = 100
): QueryHistoryEntry[] {
  const db = getInternalDb()
  const query = connectionId
    ? db.prepare(
        `SELECT * FROM query_history WHERE connection_id = ?
         ORDER BY executed_at DESC LIMIT ?`
      )
    : db.prepare(`SELECT * FROM query_history ORDER BY executed_at DESC LIMIT ?`)

  const rows = (connectionId
    ? query.all(connectionId, limit)
    : query.all(limit)) as Array<{
    id: string
    connection_id: string
    sql: string
    duration_ms: number
    row_count: number
    success: number
    error: string | null
    executed_at: number
  }>

  return rows.map((r) => ({
    id: r.id,
    connectionId: r.connection_id,
    sql: r.sql,
    durationMs: r.duration_ms,
    rowCount: r.row_count,
    success: r.success === 1,
    error: r.error ?? undefined,
    executedAt: r.executed_at
  }))
}
