import { app, safeStorage } from 'electron'
import Database from 'better-sqlite3'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type { ConnectionConfig, ConnectionFormData, ConnectionTestResult } from '@shared/types/connection'
import { createDriver } from './drivers'
import type { IDbDriver } from './types'

let internalDb: Database.Database | null = null

function getInternalDb(): Database.Database {
  if (!internalDb) {
    const dbPath = join(app.getPath('userData'), 'nexsql.db')
    internalDb = new Database(dbPath)
    internalDb.pragma('journal_mode = WAL')
    internalDb.pragma('foreign_keys = ON')
    initSchema(internalDb)
  }
  return internalDb
}

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS connections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      host TEXT,
      port INTEGER,
      database_name TEXT NOT NULL DEFAULT '',
      username TEXT,
      password_encrypted BLOB,
      ssl INTEGER DEFAULT 0,
      file_path TEXT,
      group_name TEXT,
      tags TEXT,
      ssh_config TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS query_history (
      id TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL,
      sql TEXT NOT NULL,
      duration_ms INTEGER DEFAULT 0,
      row_count INTEGER DEFAULT 0,
      success INTEGER NOT NULL DEFAULT 1,
      error TEXT,
      executed_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_history_connection ON query_history(connection_id);
    CREATE INDEX IF NOT EXISTS idx_history_executed_at ON query_history(executed_at DESC);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)

  // Migrations: add new columns if missing
  const cols = db.pragma('table_info(connections)') as { name: string }[]
  const colNames = cols.map((c) => c.name)
  if (!colNames.includes('group_name')) db.exec(`ALTER TABLE connections ADD COLUMN group_name TEXT`)
  if (!colNames.includes('tags')) db.exec(`ALTER TABLE connections ADD COLUMN tags TEXT`)
  if (!colNames.includes('ssh_config')) db.exec(`ALTER TABLE connections ADD COLUMN ssh_config TEXT`)
}

// Row type from internal DB
interface ConnectionRow {
  id: string
  name: string
  type: string
  host: string | null
  port: number | null
  database_name: string
  username: string | null
  password_encrypted: Buffer | null
  ssl: number
  file_path: string | null
  group_name: string | null
  tags: string | null
  ssh_config: string | null
  created_at: number
  updated_at: number
}

function rowToConfig(row: ConnectionRow): ConnectionConfig {
  return {
    id: row.id,
    name: row.name,
    type: row.type as ConnectionConfig['type'],
    host: row.host ?? undefined,
    port: row.port ?? undefined,
    database: row.database_name || undefined,
    username: row.username ?? undefined,
    ssl: row.ssl === 1,
    filePath: row.file_path ?? undefined,
    group: row.group_name ?? undefined,
    tags: row.tags ? JSON.parse(row.tags) : undefined,
    ssh: row.ssh_config ? JSON.parse(row.ssh_config) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function encryptPassword(password: string): Buffer | null {
  if (!password) return null
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(password)
  }
  // Fallback: store base64 if safeStorage unavailable (dev/test)
  return Buffer.from(Buffer.from(password).toString('base64'))
}

function decryptPassword(encrypted: Buffer | null): string {
  if (!encrypted) return ''
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.decryptString(encrypted)
  }
  return Buffer.from(encrypted.toString(), 'base64').toString()
}

// Active connection pool
const activeConnections = new Map<string, IDbDriver>()

export async function listConnections(): Promise<ConnectionConfig[]> {
  const db = getInternalDb()
  const rows = db.prepare('SELECT * FROM connections ORDER BY name').all() as ConnectionRow[]
  return rows.map(rowToConfig)
}

export async function addConnection(
  formData: ConnectionFormData
): Promise<ConnectionConfig> {
  const db = getInternalDb()
  const now = Date.now()
  const id = randomUUID()
  const passwordEncrypted = encryptPassword(formData.password ?? '')

  db.prepare(`
    INSERT INTO connections (id, name, type, host, port, database_name, username, password_encrypted, ssl, file_path, group_name, tags, ssh_config, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    formData.name,
    formData.type,
    formData.host ?? null,
    formData.port ?? null,
    formData.database ?? '',
    formData.username ?? null,
    passwordEncrypted,
    formData.ssl ? 1 : 0,
    formData.filePath ?? null,
    formData.group ?? null,
    formData.tags ? JSON.stringify(formData.tags) : null,
    formData.ssh ? JSON.stringify(formData.ssh) : null,
    now,
    now
  )

  const row = db.prepare('SELECT * FROM connections WHERE id = ?').get(id) as ConnectionRow
  return rowToConfig(row)
}

export async function updateConnection(
  id: string,
  formData: Partial<ConnectionFormData>
): Promise<ConnectionConfig> {
  const db = getInternalDb()
  const existing = db.prepare('SELECT * FROM connections WHERE id = ?').get(id) as ConnectionRow
  if (!existing) throw new Error(`Connection not found: ${id}`)

  const now = Date.now()
  // Only update password if a non-empty value is provided; keep existing otherwise
  const passwordEncrypted =
    formData.password !== undefined && formData.password !== ''
      ? encryptPassword(formData.password)
      : existing.password_encrypted

  db.prepare(`
    UPDATE connections SET
      name = ?, type = ?, host = ?, port = ?, database_name = ?,
      username = ?, password_encrypted = ?, ssl = ?, file_path = ?,
      group_name = ?, tags = ?, ssh_config = ?, updated_at = ?
    WHERE id = ?
  `).run(
    formData.name ?? existing.name,
    formData.type ?? existing.type,
    formData.host ?? existing.host,
    formData.port ?? existing.port,
    formData.database ?? existing.database_name,
    formData.username ?? existing.username,
    passwordEncrypted,
    formData.ssl !== undefined ? (formData.ssl ? 1 : 0) : existing.ssl,
    formData.filePath ?? existing.file_path,
    formData.group !== undefined ? (formData.group || null) : existing.group_name,
    formData.tags !== undefined ? (formData.tags ? JSON.stringify(formData.tags) : null) : existing.tags,
    formData.ssh !== undefined ? (formData.ssh ? JSON.stringify(formData.ssh) : null) : existing.ssh_config,
    now,
    id
  )

  const row = db.prepare('SELECT * FROM connections WHERE id = ?').get(id) as ConnectionRow
  return rowToConfig(row)
}

export async function deleteConnection(id: string): Promise<void> {
  // Disconnect if active
  await disconnectById(id)
  const db = getInternalDb()
  db.prepare('DELETE FROM connections WHERE id = ?').run(id)
  db.prepare('DELETE FROM query_history WHERE connection_id = ?').run(id)
}

export async function testConnection(
  formData: ConnectionFormData,
  existingId?: string
): Promise<ConnectionTestResult> {
  const start = Date.now()

  // When editing an existing connection and password field is blank,
  // fall back to the stored (encrypted) password so the test uses real credentials.
  let passwordToUse = formData.password ?? ''
  if (!passwordToUse && existingId) {
    passwordToUse = getConnectionPassword(existingId)
  }

  const tempConfig: ConnectionConfig = {
    id: 'test',
    name: formData.name,
    type: formData.type,
    host: formData.host,
    port: formData.port,
    database: formData.database,
    username: formData.username,
    ssl: formData.ssl,
    filePath: formData.filePath,
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
  try {
    const driver = createDriver(tempConfig, passwordToUse)
    await driver.testConnection()
    await driver.disconnect()
    return { success: true, message: '连接成功', latencyMs: Date.now() - start }
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : String(err),
      latencyMs: Date.now() - start
    }
  }
}

export async function connectById(id: string): Promise<void> {
  if (activeConnections.has(id)) return

  const db = getInternalDb()
  const row = db.prepare('SELECT * FROM connections WHERE id = ?').get(id) as ConnectionRow
  if (!row) throw new Error(`Connection not found: ${id}`)

  const config = rowToConfig(row)
  const password = decryptPassword(row.password_encrypted)
  const driver = createDriver(config, password)
  await driver.testConnection()
  activeConnections.set(id, driver)
}

export async function reconnectById(id: string): Promise<void> {
  // Tear down the stale driver first, ignoring any disconnect errors
  const stale = activeConnections.get(id)
  if (stale) {
    try { await stale.disconnect() } catch { /* ignore */ }
    activeConnections.delete(id)
  }
  await connectById(id)
}

export async function disconnectById(id: string): Promise<void> {
  const driver = activeConnections.get(id)
  if (driver) {
    await driver.disconnect()
    activeConnections.delete(id)
  }
}

export function getDriver(id: string): IDbDriver {
  const driver = activeConnections.get(id)
  if (!driver) throw new Error(`Not connected to: ${id}. Call connect first.`)
  return driver
}

export function getConnectionConfig(id: string): ConnectionConfig {
  const db = getInternalDb()
  const row = db.prepare('SELECT * FROM connections WHERE id = ?').get(id) as ConnectionRow
  if (!row) throw new Error(`Connection not found: ${id}`)
  return rowToConfig(row)
}

export function getConnectionPassword(id: string): string {
  const db = getInternalDb()
  const row = db.prepare('SELECT password_encrypted FROM connections WHERE id = ?').get(id) as Pick<ConnectionRow, 'password_encrypted'>
  if (!row) return ''
  return decryptPassword(row.password_encrypted)
}

export async function duplicateConnection(id: string): Promise<ConnectionConfig> {
  const db = getInternalDb()
  const row = db.prepare('SELECT * FROM connections WHERE id = ?').get(id) as ConnectionRow
  if (!row) throw new Error(`Connection not found: ${id}`)
  const now = Date.now()
  const newId = randomUUID()
  db.prepare(`
    INSERT INTO connections (id, name, type, host, port, database_name, username, password_encrypted, ssl, file_path, group_name, tags, ssh_config, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    newId,
    row.name + ' (副本)',
    row.type, row.host, row.port, row.database_name,
    row.username, row.password_encrypted, row.ssl, row.file_path,
    row.group_name, row.tags, row.ssh_config, now, now
  )
  const newRow = db.prepare('SELECT * FROM connections WHERE id = ?').get(newId) as ConnectionRow
  return rowToConfig(newRow)
}

export async function exportConnections(): Promise<string> {
  const db = getInternalDb()
  const rows = db.prepare('SELECT * FROM connections ORDER BY name').all() as ConnectionRow[]
  const exportData = rows.map((row) => ({
    ...rowToConfig(row),
    _passwordHint: row.password_encrypted ? '(encrypted, not exported)' : null
  }))
  return JSON.stringify(exportData, null, 2)
}

export async function importConnections(jsonStr: string): Promise<number> {
  const items = JSON.parse(jsonStr) as ConnectionConfig[]
  let count = 0
  for (const item of items) {
    const formData: ConnectionFormData = {
      name: item.name,
      type: item.type,
      host: item.host,
      port: item.port,
      database: item.database,
      username: item.username,
      ssl: item.ssl,
      filePath: item.filePath,
      group: item.group,
      tags: item.tags,
      ssh: item.ssh
    }
    await addConnection(formData)
    count++
  }
  return count
}
