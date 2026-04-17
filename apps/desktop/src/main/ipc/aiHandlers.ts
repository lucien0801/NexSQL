import { ipcMain, app } from 'electron'
import Database from 'better-sqlite3'
import { join } from 'path'
import { createHash } from 'crypto'
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
  ERGraphInferResponse,
  ERGraphEdge,
  ERRelationType,
  ERRelationSourceType,
  ERRelationStatus
} from '@shared/types/ai'
import { OpenAIProvider } from '../ai/OpenAIProvider'
import { OllamaProvider } from '../ai/OllamaProvider'
import { buildSchemaContext } from '../ai/SchemaContextBuilder'
import { executeQuery, getSchema, getTableColumns, getTableDDL, getTableIndexes } from '../db/QueryExecutor'
import { getConnectionConfig } from '../db/ConnectionManager'
import { getMainWindow } from '../index'

let internalDb: Database.Database | null = null

interface SemanticIndexRow {
  connection_id: string
  database_name: string
  table_name: string
  schema_hash: string
  summary_text: string
  manual_notes: string | null
  status: 'indexed' | 'failed'
  error_message: string | null
  updated_at: number
}

interface ERDiagramNodeRow {
  connection_id: string
  database_name: string
  table_name: string
  x: number
  y: number
  collapsed: number
  updated_at: number
}

interface ERDiagramEdgeRow {
  id: string
  connection_id: string
  database_name: string
  source_table: string
  source_column: string
  target_table: string
  target_column: string
  relation_type: ERRelationType
  confidence: number
  source_type: ERRelationSourceType
  note: string | null
  status: ERRelationStatus
  created_at: number
  updated_at: number
}

function getInternalDb(): Database.Database {
  if (!internalDb) {
    internalDb = new Database(join(app.getPath('userData'), 'nexsql.db'))
    initAiSchema(internalDb)
  }
  return internalDb
}

function initAiSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS semantic_index_items (
      connection_id TEXT NOT NULL,
      database_name TEXT NOT NULL,
      table_name TEXT NOT NULL,
      schema_hash TEXT NOT NULL,
      summary_text TEXT NOT NULL,
      manual_notes TEXT,
      status TEXT NOT NULL,
      error_message TEXT,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (connection_id, database_name, table_name)
    );

    CREATE INDEX IF NOT EXISTS idx_semantic_index_connection
      ON semantic_index_items(connection_id, database_name);

    CREATE TABLE IF NOT EXISTS er_diagram_nodes (
      connection_id TEXT NOT NULL,
      database_name TEXT NOT NULL,
      table_name TEXT NOT NULL,
      x REAL NOT NULL,
      y REAL NOT NULL,
      collapsed INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (connection_id, database_name, table_name)
    );

    CREATE INDEX IF NOT EXISTS idx_er_nodes_connection
      ON er_diagram_nodes(connection_id, database_name);

    CREATE TABLE IF NOT EXISTS er_diagram_edges (
      id TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL,
      database_name TEXT NOT NULL,
      source_table TEXT NOT NULL,
      source_column TEXT NOT NULL,
      target_table TEXT NOT NULL,
      target_column TEXT NOT NULL,
      relation_type TEXT NOT NULL,
      confidence REAL NOT NULL,
      source_type TEXT NOT NULL,
      note TEXT,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_er_edges_connection
      ON er_diagram_edges(connection_id, database_name);
  `)

  const cols = db.pragma('table_info(semantic_index_items)') as Array<{ name: string }>
  const colNames = new Set(cols.map((col) => col.name))
  if (!colNames.has('manual_notes')) {
    db.exec('ALTER TABLE semantic_index_items ADD COLUMN manual_notes TEXT')
  }
}

const DEFAULT_CONFIG: AIConfig = {
  provider: 'openai',
  model: 'gpt-4o-mini',
  baseUrl: '',
  apiKey: '',
  ollamaBaseUrl: 'http://localhost:11434',
  ollamaModel: 'qwen2.5-coder:7b',
  maxTokens: 1024,
  temperature: 0.1
}

function getSetting(key: string): string | null {
  const db = getInternalDb()
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value ?? null
}

function setSetting(key: string, value: string): void {
  const db = getInternalDb()
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value)
}

function getProvider(config: AIConfig): OpenAIProvider | OllamaProvider {
  return config.provider === 'ollama' ? new OllamaProvider(config) : new OpenAIProvider(config)
}

function getDialectFromConnection(connectionId: string): string {
  try {
    return getConnectionConfig(connectionId).type
  } catch {
    return 'sql'
  }
}

function buildExplainSQL(sql: string, dialect: string): string {
  const trimmed = sql.trim().replace(/;+$/, '')
  const lower = trimmed.toLowerCase()
  if (lower.startsWith('explain ')) return trimmed
  if (dialect === 'sqlite') return `EXPLAIN QUERY PLAN ${trimmed}`
  if (dialect === 'postgresql') return `EXPLAIN (FORMAT JSON) ${trimmed}`
  return `EXPLAIN ${trimmed}`
}

function summarizePlanRows(rows: Record<string, unknown>[], maxRows = 30): string {
  if (!rows.length) return '执行计划为空'
  const clipped = rows.slice(0, maxRows)
  const lines = clipped.map((row, idx) => `${idx + 1}. ${JSON.stringify(row)}`)
  const suffix = rows.length > clipped.length ? `\n... 共 ${rows.length} 行，已截断` : ''
  return lines.join('\n') + suffix
}

function trimText(input: string, maxLength: number): string {
  if (input.length <= maxLength) return input
  return `${input.slice(0, maxLength)}\n... 已截断 ${input.length - maxLength} 个字符`
}

function getSemanticIndexItems(connectionId: string): SemanticIndexItem[] {
  migrateLegacySemanticIndex(connectionId)
  const db = getInternalDb()
  const rows = db.prepare(`
    SELECT connection_id, database_name, table_name, schema_hash, summary_text, manual_notes, status, error_message, updated_at
    FROM semantic_index_items
    WHERE connection_id = ?
    ORDER BY database_name, table_name
  `).all(connectionId) as SemanticIndexRow[]

  return rows.map(rowToSemanticIndexItem)
}

function setSemanticIndexItems(connectionId: string, items: SemanticIndexItem[]): void {
  const db = getInternalDb()
  const insert = db.prepare(`
    INSERT INTO semantic_index_items (
      connection_id, database_name, table_name, schema_hash, summary_text, manual_notes, status, error_message, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(connection_id, database_name, table_name)
    DO UPDATE SET
      schema_hash = excluded.schema_hash,
      summary_text = excluded.summary_text,
      manual_notes = COALESCE(semantic_index_items.manual_notes, excluded.manual_notes),
      status = excluded.status,
      error_message = excluded.error_message,
      updated_at = excluded.updated_at
  `)

  const tx = db.transaction((rows: SemanticIndexItem[]) => {
    for (const item of rows) {
      insert.run(
        item.connectionId,
        item.databaseName,
        item.tableName,
        item.schemaHash,
        item.summaryText,
        item.manualNotes ?? null,
        item.status,
        item.error ?? null,
        item.updatedAt
      )
    }
  })

  tx(items)
}

function rowToSemanticIndexItem(row: SemanticIndexRow): SemanticIndexItem {
  const manualNotes = row.manual_notes ?? undefined
  const mergedSummary = manualNotes
    ? `${row.summary_text}\n\n-- Manual Notes\n${manualNotes}`
    : row.summary_text
  return {
    connectionId: row.connection_id,
    databaseName: row.database_name,
    tableName: row.table_name,
    schemaHash: row.schema_hash,
    summaryText: mergedSummary,
    manualNotes,
    status: row.status,
    error: row.error_message ?? undefined,
    updatedAt: row.updated_at
  }
}

function migrateLegacySemanticIndex(connectionId: string): void {
  const legacyKey = `semantic_index:${connectionId}`
  const raw = getSetting(legacyKey)
  if (!raw) return

  try {
    const parsed = JSON.parse(raw) as SemanticIndexItem[]
    if (Array.isArray(parsed) && parsed.length > 0) {
      setSemanticIndexItems(connectionId, parsed)
    }
  } catch {
    // ignore legacy parse failure
  }

  const db = getInternalDb()
  db.prepare('DELETE FROM settings WHERE key = ?').run(legacyKey)
}

function hashText(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

function normalizeIdentifier(input: string): string {
  return input
    .trim()
    .replace(/^\[([^\]]+)\]$/, '$1')
    .replace(/^"(.+)"$/, '$1')
    .replace(/^`(.+)`$/, '$1')
}

function extractReferencedTables(sql: string): string[] {
  const matches = new Set<string>()
  const pattern = /\b(?:from|join|update|into|table)\s+((?:\[[^\]]+\]|`[^`]+`|"[^"]+"|[a-zA-Z0-9_]+)(?:\s*\.\s*(?:\[[^\]]+\]|`[^`]+`|"[^"]+"|[a-zA-Z0-9_]+))?)/gi

  let match: RegExpExecArray | null
  while ((match = pattern.exec(sql)) !== null) {
    const normalized = normalizeIdentifier(match[1]).replace(/\s*\.\s*/g, '.')
    const tableName = normalized.split('.').pop() ?? normalized
    if (tableName) matches.add(tableName.toLowerCase())
  }

  return Array.from(matches)
}

function tokenizeInput(input: string): string[] {
  const tokens = input.toLowerCase().match(/[a-z0-9_]{2,}/g) ?? []
  return Array.from(new Set(tokens))
}

function buildSemanticContext(
  connectionId: string,
  queryText: string,
  databaseName?: string,
  explicitTables?: string[]
): { context: string; matches: string[] } {
  const items = getSemanticIndexItems(connectionId).filter((item) => {
    if (item.status !== 'indexed') return false
    if (!databaseName) return true
    return item.databaseName === databaseName
  })

  if (items.length === 0) {
    return { context: '', matches: [] }
  }

  const explicitSet = new Set((explicitTables ?? []).map((table) => table.toLowerCase()))
  const queryLower = queryText.toLowerCase()
  const tokens = tokenizeInput(queryText)

  const ranked = items
    .map((item) => {
      const summary = item.summaryText.toLowerCase()
      let score = 0
      if (explicitSet.has(item.tableName.toLowerCase())) score += 100
      if (queryLower.includes(item.tableName.toLowerCase())) score += 40
      if (queryLower.includes(`${item.databaseName}.${item.tableName}`.toLowerCase())) score += 30
      for (const token of tokens) {
        if (item.tableName.toLowerCase().includes(token)) score += 8
        else if (summary.includes(token)) score += 2
      }
      return { item, score }
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)

  if (ranked.length === 0) {
    return { context: '', matches: [] }
  }

  const matches = ranked.map((entry) => `${entry.item.databaseName}.${entry.item.tableName}`)
  const context = ranked
    .map((entry) => `-- Semantic Index: ${entry.item.databaseName}.${entry.item.tableName}\n${trimText(entry.item.summaryText, 900)}`)
    .join('\n\n')

  return { context: trimText(context, 3600), matches }
}

function mergeAIContext(schemaContext: string, semanticContext: string): string {
  if (!semanticContext) return schemaContext
  if (!schemaContext) return `-- Semantic context\n${semanticContext}`
  return trimText(`${schemaContext}\n\n-- Semantic context\n${semanticContext}`, 8000)
}

async function buildFocusedSchemaContext(
  connectionId: string,
  databaseName: string | undefined,
  referencedTables: string[]
): Promise<string> {
  if (referencedTables.length === 0) {
    return '-- No focused tables detected from SQL'
  }

  const pieces = await Promise.all(
    referencedTables.slice(0, 6).map(async (table) => {
      const ddl = await getTableDDL(connectionId, table, databaseName).catch(() => '')
      if (ddl) {
        return `-- Focused table: ${table}\n${trimText(ddl, 1400)}`
      }

      const columns = await getTableColumns(connectionId, table, databaseName).catch(() => [])
      if (columns.length === 0) {
        return `-- Focused table: ${table}\n-- Metadata unavailable`
      }

      const columnText = columns
        .slice(0, 30)
        .map((column) => `${column.name} ${column.type}${column.primaryKey ? ' PRIMARY KEY' : ''}${column.nullable ? '' : ' NOT NULL'}`)
        .join('\n')
      return `-- Focused table: ${table}\n${columnText}`
    })
  )

  return trimText(pieces.join('\n\n'), 4200)
}

function buildColumnSemanticSummary(columns: Awaited<ReturnType<typeof getTableColumns>>): string {
  if (columns.length === 0) return 'columns: unavailable'

  const primary = columns.filter((column) => column.primaryKey).map((column) => column.name)
  const timeColumns = columns.filter((column) => /(created|updated|time|date)/i.test(column.name)).map((column) => column.name)
  const statusColumns = columns.filter((column) => /(status|state|type|flag)/i.test(column.name)).map((column) => column.name)
  const foreignLike = columns.filter((column) => /(_id|Id|ID)$/.test(column.name) && !column.primaryKey).map((column) => column.name)

  return [
    `primary_keys=${primary.join(', ') || 'none'}`,
    `time_columns=${timeColumns.join(', ') || 'none'}`,
    `status_columns=${statusColumns.join(', ') || 'none'}`,
    `foreign_like_columns=${foreignLike.join(', ') || 'none'}`
  ].join('\n')
}

function buildRelationshipSummary(
  tableName: string,
  columns: Awaited<ReturnType<typeof getTableColumns>>,
  indexes: Awaited<ReturnType<typeof getTableIndexes>>
): string {
  const foreignLike = columns
    .filter((column) => /(_id|Id|ID)$/.test(column.name) && !column.primaryKey)
    .map((column) => column.name)
  const indexedColumns = indexes.flatMap((index) => index.columns)
  const joinHints = foreignLike.map((column) => {
    const related = column.replace(/_id$/i, '').replace(/Id$|ID$/, '')
    return `${column} -> possible relation with ${related}`
  })

  return [
    `table=${tableName}`,
    `join_hints=${joinHints.join('; ') || 'none'}`,
    `indexed_columns=${Array.from(new Set(indexedColumns)).join(', ') || 'none'}`
  ].join('\n')
}

function normalizeEdge(row: ERDiagramEdgeRow): ERGraphEdge {
  return {
    id: row.id,
    connectionId: row.connection_id,
    databaseName: row.database_name,
    sourceTable: row.source_table,
    sourceColumn: row.source_column,
    targetTable: row.target_table,
    targetColumn: row.target_column,
    relationType: row.relation_type,
    confidence: Number.isFinite(row.confidence) ? row.confidence : 0,
    sourceType: row.source_type,
    note: row.note ?? undefined,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function buildERDefaultPosition(index: number): { x: number; y: number } {
  const col = index % 3
  const row = Math.floor(index / 3)
  return {
    x: 80 + col * 320,
    y: 80 + row * 260
  }
}

function singularize(input: string): string {
  if (input.endsWith('ies')) return `${input.slice(0, -3)}y`
  if (input.endsWith('ses')) return input.slice(0, -2)
  if (input.endsWith('s') && input.length > 2) return input.slice(0, -1)
  return input
}

function pluralize(input: string): string {
  if (input.endsWith('y')) return `${input.slice(0, -1)}ies`
  if (input.endsWith('s')) return `${input}es`
  return `${input}s`
}

function sanitizeRelationType(value: string | undefined): ERRelationType {
  if (value === '1:1' || value === '1:N' || value === 'N:M' || value === 'unknown') {
    return value
  }
  return 'unknown'
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

function edgeKey(edge: Pick<ERGraphEdge, 'sourceTable' | 'sourceColumn' | 'targetTable' | 'targetColumn'>): string {
  return `${edge.sourceTable}.${edge.sourceColumn}->${edge.targetTable}.${edge.targetColumn}`.toLowerCase()
}

function parseAIInferredEdges(raw: string, connectionId: string, databaseName: string): ERGraphEdge[] {
  const start = raw.indexOf('[')
  const end = raw.lastIndexOf(']')
  if (start < 0 || end < start) return []

  const maybeJson = raw.slice(start, end + 1)
  let parsed: unknown
  try {
    parsed = JSON.parse(maybeJson)
  } catch {
    return []
  }

  if (!Array.isArray(parsed)) return []

  const now = Date.now()
  return parsed
    .filter((item) => typeof item === 'object' && item !== null)
    .map((item) => item as Record<string, unknown>)
    .map((item) => ({
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
      connectionId,
      databaseName,
      sourceTable: String(item.sourceTable ?? '').trim(),
      sourceColumn: String(item.sourceColumn ?? '').trim(),
      targetTable: String(item.targetTable ?? '').trim(),
      targetColumn: String(item.targetColumn ?? '').trim(),
      relationType: sanitizeRelationType(String(item.relationType ?? 'unknown')),
      confidence: clampConfidence(Number(item.confidence ?? 0.5)),
      sourceType: 'inferred' as const,
      note: String(item.reason ?? '').trim() || 'AI 推断候选关系',
      status: 'pending' as const,
      createdAt: now,
      updatedAt: now
    }))
    .filter((edge) => edge.sourceTable && edge.sourceColumn && edge.targetTable && edge.targetColumn)
}

async function loadERGraphData(request: ERGraphLoadRequest): Promise<ERGraphLoadResponse> {
  const schema = await getSchema(request.connectionId, request.databaseName)
  const dbInfo = schema.databases.find((db: { name: string }) => db.name === request.databaseName)
  if (!dbInfo) {
    throw new Error(`未找到数据库: ${request.databaseName}`)
  }

  const db = getInternalDb()
  const nodeRows = db.prepare(`
    SELECT connection_id, database_name, table_name, x, y, collapsed, updated_at
    FROM er_diagram_nodes
    WHERE connection_id = ? AND database_name = ?
  `).all(request.connectionId, request.databaseName) as ERDiagramNodeRow[]
  const nodeMap = new Map(nodeRows.map((row) => [row.table_name.toLowerCase(), row]))

  const nodes = await Promise.all(
    dbInfo.tables.map(async (table: { name: string }, index: number) => {
      const persisted = nodeMap.get(table.name.toLowerCase())
      const pos = persisted ? { x: persisted.x, y: persisted.y } : buildERDefaultPosition(index)
      const columns = await getTableColumns(request.connectionId, table.name, request.databaseName).catch(() => [])
      return {
        connectionId: request.connectionId,
        databaseName: request.databaseName,
        tableName: table.name,
        x: pos.x,
        y: pos.y,
        collapsed: persisted ? persisted.collapsed === 1 : false,
        columns
      }
    })
  )

  const edgeRows = db.prepare(`
    SELECT id, connection_id, database_name, source_table, source_column, target_table, target_column,
           relation_type, confidence, source_type, note, status, created_at, updated_at
    FROM er_diagram_edges
    WHERE connection_id = ? AND database_name = ?
    ORDER BY updated_at DESC
  `).all(request.connectionId, request.databaseName) as ERDiagramEdgeRow[]

  return {
    connectionId: request.connectionId,
    databaseName: request.databaseName,
    nodes,
    edges: edgeRows.map(normalizeEdge),
    createdAt: Date.now()
  }
}

function saveERGraphData(request: ERGraphSaveRequest): ERGraphSaveResponse {
  const db = getInternalDb()
  const now = Date.now()

  const upsertNode = db.prepare(`
    INSERT INTO er_diagram_nodes(connection_id, database_name, table_name, x, y, collapsed, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(connection_id, database_name, table_name)
    DO UPDATE SET x = excluded.x, y = excluded.y, collapsed = excluded.collapsed, updated_at = excluded.updated_at
  `)

  const deleteEdges = db.prepare(`
    DELETE FROM er_diagram_edges
    WHERE connection_id = ? AND database_name = ?
  `)

  const insertEdge = db.prepare(`
    INSERT INTO er_diagram_edges(
      id, connection_id, database_name, source_table, source_column, target_table, target_column,
      relation_type, confidence, source_type, note, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const tx = db.transaction(() => {
    for (const node of request.nodes) {
      upsertNode.run(
        request.connectionId,
        request.databaseName,
        node.tableName,
        node.x,
        node.y,
        node.collapsed ? 1 : 0,
        now
      )
    }

    deleteEdges.run(request.connectionId, request.databaseName)
    for (const edge of request.edges) {
      if (!edge.sourceTable || !edge.sourceColumn || !edge.targetTable || !edge.targetColumn) continue
      insertEdge.run(
        edge.id,
        request.connectionId,
        request.databaseName,
        edge.sourceTable,
        edge.sourceColumn,
        edge.targetTable,
        edge.targetColumn,
        sanitizeRelationType(edge.relationType),
        clampConfidence(edge.confidence),
        edge.sourceType,
        edge.note ?? null,
        edge.status,
        edge.createdAt || now,
        now
      )
    }
  })

  tx()

  return {
    connectionId: request.connectionId,
    databaseName: request.databaseName,
    savedNodes: request.nodes.length,
    savedEdges: request.edges.length,
    updatedAt: now
  }
}

async function inferERByRules(request: ERGraphInferRequest): Promise<ERGraphEdge[]> {
  const schema = await getSchema(request.connectionId, request.databaseName)
  const dbInfo = schema.databases.find((db: { name: string }) => db.name === request.databaseName)
  if (!dbInfo) return []

  const tableNames = dbInfo.tables.map((table: { name: string }) => table.name)
  const tableMap = new Map<string, string>(tableNames.map((name: string) => [name.toLowerCase(), name]))
  const indexMap = new Map<string, Set<string>>()
  const columnsMap = new Map<string, Awaited<ReturnType<typeof getTableColumns>>>()

  for (const table of dbInfo.tables) {
    const [columns, indexes] = await Promise.all([
      getTableColumns(request.connectionId, table.name, request.databaseName).catch(() => []),
      getTableIndexes(request.connectionId, table.name, request.databaseName).catch(() => [])
    ])
    columnsMap.set(table.name, columns)
    indexMap.set(
      table.name,
      new Set(indexes.flatMap((index) => index.columns.map((column) => column.toLowerCase())))
    )
  }

  const result: ERGraphEdge[] = []
  const seen = new Set<string>()
  const now = Date.now()

  for (const table of dbInfo.tables) {
    const columns = columnsMap.get(table.name) ?? []
    for (const column of columns) {
      if (column.primaryKey) continue
      const match = column.name.match(/^(.+?)(?:_id|Id|ID)$/)
      if (!match) continue

      const stemRaw = match[1].toLowerCase()
      const candidates = [stemRaw, pluralize(stemRaw), singularize(stemRaw)]
      let matchedTable = ''
      for (const candidate of candidates) {
        if (tableMap.has(candidate)) {
          matchedTable = tableMap.get(candidate) ?? ''
          break
        }
      }
      if (!matchedTable || matchedTable.toLowerCase() === table.name.toLowerCase()) continue

      const targetColumns = columnsMap.get(matchedTable) ?? []
      const targetPk = targetColumns.find((targetColumn) => targetColumn.primaryKey)
      const targetId = targetColumns.find((targetColumn) => targetColumn.name.toLowerCase() === 'id')
      const targetColumn = targetId?.name ?? targetPk?.name ?? 'id'

      const indexed = indexMap.get(table.name)?.has(column.name.toLowerCase())
      let confidence = matchedTable.toLowerCase() === stemRaw ? 0.82 : 0.72
      if (indexed) confidence += 0.08
      if (targetPk) confidence += 0.05

      const edge: ERGraphEdge = {
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
        connectionId: request.connectionId,
        databaseName: request.databaseName,
        sourceTable: table.name,
        sourceColumn: column.name,
        targetTable: matchedTable,
        targetColumn,
        relationType: '1:N',
        confidence: clampConfidence(confidence),
        sourceType: 'inferred',
        note: `规则推断：${column.name} 命名与 ${matchedTable} 匹配${indexed ? '，且存在索引' : ''}`,
        status: 'pending',
        createdAt: now,
        updatedAt: now
      }

      const key = edgeKey(edge)
      if (seen.has(key)) continue
      seen.add(key)
      result.push(edge)
    }
  }

  return result
}

async function inferERByAI(request: ERGraphInferRequest, config: AIConfig): Promise<ERGraphEdge[]> {
  const canInferWithAI = config.provider === 'ollama' || Boolean(config.apiKey)
  if (!canInferWithAI) return []

  const graph = await loadERGraphData({ connectionId: request.connectionId, databaseName: request.databaseName })
  const schemaBrief = graph.nodes
    .map((node: { tableName: string; columns: Array<{ name: string; type: string; primaryKey: boolean }> }) => {
      const pk = node.columns.filter((column: { primaryKey: boolean }) => column.primaryKey).map((column: { name: string }) => column.name).join(', ') || 'none'
      const fields = node.columns.slice(0, 40).map((column: { name: string; type: string }) => `${column.name}:${column.type}`).join(', ')
      return `table=${node.tableName}\nprimary_keys=${pk}\ncolumns=${fields}`
    })
    .join('\n\n')

  const provider = getProvider(config)
  const raw = await provider.inferSchemaRelations(trimText(schemaBrief, 12000), request, () => {})
  return parseAIInferredEdges(raw, request.connectionId, request.databaseName)
}

async function inferERGraph(request: ERGraphInferRequest): Promise<ERGraphInferResponse> {
  const config = getAIConfig()
  const [ruleCandidates, aiCandidates] = await Promise.all([
    inferERByRules(request),
    inferERByAI(request, config).catch(() => [])
  ])

  const merged = new Map<string, ERGraphEdge>()
  for (const edge of [...ruleCandidates, ...aiCandidates]) {
    const key = edgeKey(edge)
    const prev = merged.get(key)
    if (!prev || edge.confidence > prev.confidence) {
      merged.set(key, edge)
    }
  }

  const maxCandidates = request.maxCandidates ?? 60
  const candidates = Array.from(merged.values())
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, maxCandidates)

  return {
    connectionId: request.connectionId,
    databaseName: request.databaseName,
    candidates,
    createdAt: Date.now()
  }
}

function deleteStaleSemanticIndexItems(connectionId: string, databases: string[], validKeys: string[]): void {
  if (databases.length === 0) return
  const db = getInternalDb()
  const placeholders = databases.map(() => '?').join(', ')
  const rows = db.prepare(`
    SELECT connection_id, database_name, table_name
    FROM semantic_index_items
    WHERE connection_id = ? AND database_name IN (${placeholders})
  `).all(connectionId, ...databases) as Array<{ connection_id: string; database_name: string; table_name: string }>

  const validSet = new Set(validKeys)
  const toDelete = rows.filter((row) => !validSet.has(`${row.database_name}.${row.table_name}`.toLowerCase()))
  const deleteStmt = db.prepare(`
    DELETE FROM semantic_index_items
    WHERE connection_id = ? AND database_name = ? AND table_name = ?
  `)

  const tx = db.transaction((items: typeof toDelete) => {
    for (const row of items) {
      deleteStmt.run(connectionId, row.database_name, row.table_name)
    }
  })

  tx(toDelete)
}

export function getAIConfig(): AIConfig {
  const raw = getSetting('ai_config')
  if (!raw) return { ...DEFAULT_CONFIG }
  try {
    return { ...DEFAULT_CONFIG, ...(JSON.parse(raw) as Partial<AIConfig>) }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

export function registerAiHandlers(): void {
  ipcMain.handle('ai:getConfig', async () => {
    const config = getAIConfig()
    // Don't expose API key to renderer; send masked version
    return { ...config, apiKey: config.apiKey ? '••••••••' : '' }
  })

  ipcMain.handle('ai:updateConfig', async (_event, partial: Partial<AIConfig>) => {
    const current = getAIConfig()
    // If user sends back masked key, keep the original
    if (partial.apiKey === '••••••••') {
      delete partial.apiKey
    }
    const updated = { ...current, ...partial }
    setSetting('ai_config', JSON.stringify(updated))
  })

  ipcMain.handle('ai:generateSQL', async (_event, request: NLToSQLRequest) => {
    const config = getAIConfig()
    const win = getMainWindow()

    let schemaContext = ''
    try {
      const schema = await getSchema(request.connectionId, request.databaseName)
      schemaContext = buildSchemaContext(schema, request.tableHints)
    } catch {
      schemaContext = '-- Schema unavailable'
    }

    const semanticContext = buildSemanticContext(
      request.connectionId,
      request.question,
      request.databaseName,
      request.tableHints
    )
    schemaContext = mergeAIContext(schemaContext, semanticContext.context)

    const provider = getProvider(config)

    const sql = await provider.generateSQL(schemaContext, request, (token) => {
      win?.webContents.send('ai:sqlToken', token)
    })

    win?.webContents.send('ai:sqlDone')
    return sql
  })

  ipcMain.handle('ai:optimizeSQL', async (_event, request: SQLOptimizeRequest): Promise<SQLOptimizeResponse> => {
    const config = getAIConfig()
    const provider = getProvider(config)
    const dialect = getDialectFromConnection(request.connectionId)
    const explainSQL = buildExplainSQL(request.sql, dialect)
    const referencedTables = extractReferencedTables(request.sql)

    const [planResult, focusedSchemaContext] = await Promise.all([
      executeQuery(request.connectionId, explainSQL, request.databaseName),
      buildFocusedSchemaContext(request.connectionId, request.databaseName, referencedTables)
    ])

    if (planResult.error) {
      throw new Error(`执行计划获取失败: ${planResult.error}`)
    }

    const planRows = planResult.rows
    const planSummary = trimText(summarizePlanRows(planRows, request.maxPlanRows ?? 12), 2600)

    let schemaContext = focusedSchemaContext
    if (!schemaContext || schemaContext === '-- No focused tables detected from SQL') {
      try {
        const schema = await getSchema(request.connectionId, request.databaseName)
        schemaContext = buildSchemaContext(schema, referencedTables)
      } catch {
        schemaContext = '-- Schema unavailable'
      }
    }

    const semanticContext = buildSemanticContext(
      request.connectionId,
      `${request.sql}\n${planSummary}`,
      request.databaseName,
      referencedTables
    )
    schemaContext = mergeAIContext(schemaContext, semanticContext.context)

    const recommendations = await provider.optimizeSQL(
      schemaContext,
      request,
      planSummary,
      () => {}
    )

    return {
      sql: request.sql,
      explainSQL,
      planSummary,
      planRows,
      recommendations,
      semanticMatches: semanticContext.matches,
      createdAt: Date.now()
    }
  })

  ipcMain.handle('ai:generateDesignSQL', async (_event, request: AIDesignRequest): Promise<AIDesignResponse> => {
    const config = getAIConfig()
    const provider = getProvider(config)
    let schemaContext = '-- Empty schema context'

    if (request.includeExistingSchema) {
      try {
        const schema = await getSchema(request.connectionId, request.databaseName)
        schemaContext = buildSchemaContext(schema)
      } catch {
        schemaContext = '-- Schema unavailable'
      }
    }

    const semanticContext = buildSemanticContext(
      request.connectionId,
      request.prompt,
      request.databaseName
    )
    schemaContext = mergeAIContext(schemaContext, semanticContext.context)

    const generated = await provider.generateDesignSQL(schemaContext, request, () => {})
    const lines = generated.split('\n').map((line) => line.trim()).filter(Boolean)
    const sqlStart = lines.findIndex((line) => /^(create|alter|drop|insert|update|delete)\b/i.test(line))
    const notes = sqlStart > 0 ? lines.slice(0, sqlStart).join('\n') : '由 AI 生成'
    const sql = sqlStart >= 0 ? lines.slice(sqlStart).join('\n') : generated

    return {
      sql: sql.trim(),
      notes: notes.trim(),
      createdAt: Date.now()
    }
  })

  ipcMain.handle('ai:generateSchemaDoc', async (_event, request: AIDocRequest): Promise<AIDocResponse> => {
    const config = getAIConfig()
    const provider = getProvider(config)
    const schemaPieces: string[] = []

    for (const target of request.targets) {
      const columns = await getTableColumns(request.connectionId, target.table, target.database)
      const indexes = await getTableIndexes(request.connectionId, target.table, target.database)
      const ddl = await getTableDDL(request.connectionId, target.table, target.database).catch(() => '')

      schemaPieces.push(`-- Table: ${target.database}.${target.table}`)
      if (ddl) schemaPieces.push(ddl)
      if (columns.length > 0) {
        schemaPieces.push('-- Columns')
        for (const column of columns) {
          schemaPieces.push(
            `${column.name} ${column.type} nullable=${column.nullable ? 'yes' : 'no'} primary=${column.primaryKey ? 'yes' : 'no'} comment=${column.comment ?? ''}`
          )
        }
      }
      if (indexes.length > 0) {
        schemaPieces.push('-- Indexes')
        for (const index of indexes) {
          schemaPieces.push(
            `${index.name} (${index.columns.join(', ')}) unique=${index.unique ? 'yes' : 'no'} primary=${index.primary ? 'yes' : 'no'}`
          )
        }
      }
      schemaPieces.push('')
    }

    const schemaContext = schemaPieces.join('\n').trim() || '-- Schema unavailable'
    const markdown = await provider.generateSchemaDoc(schemaContext, request, () => {})

    return {
      markdown,
      createdAt: Date.now()
    }
  })

  ipcMain.handle('ai:buildSemanticIndex', async (_event, request: SemanticIndexBuildRequest): Promise<SemanticIndexBuildResponse> => {
    migrateLegacySemanticIndex(request.connectionId)
    const schema = await getSchema(request.connectionId, request.databaseName)
    const databases = schema.databases.filter((db: { name: string }) => {
      if (!request.databaseName) return true
      return db.name === request.databaseName
    })

    const targetSet = request.tables ? new Set(request.tables.map((name: string) => name.toLowerCase())) : null
    const items: SemanticIndexItem[] = []
    const previousMap = new Map(
      getSemanticIndexItems(request.connectionId).map((item) => [`${item.databaseName}.${item.tableName}`.toLowerCase(), item])
    )
    let skipped = 0
    const validKeys: string[] = []

    for (const db of databases) {
      for (const table of db.tables) {
        if (targetSet && !targetSet.has(table.name.toLowerCase())) continue
        validKeys.push(`${db.name}.${table.name}`.toLowerCase())

        try {
          const [columns, indexes, ddl] = await Promise.all([
            getTableColumns(request.connectionId, table.name, db.name),
            getTableIndexes(request.connectionId, table.name, db.name).catch(() => []),
            getTableDDL(request.connectionId, table.name, db.name).catch(() => '')
          ])
          const columnSummary = buildColumnSemanticSummary(columns)
          const relationshipSummary = buildRelationshipSummary(table.name, columns, indexes)
          const summaryText = [
            `table=${table.name}`,
            `database=${db.name}`,
            `columns=${columns.map((c) => `${c.name}:${c.type}${c.comment ? `(${c.comment})` : ''}`).join(', ')}`,
            columnSummary,
            relationshipSummary,
            ddl
          ].join('\n')
          const schemaHash = hashText(summaryText)
          const itemKey = `${db.name}.${table.name}`.toLowerCase()
          const previous = previousMap.get(itemKey)

          if (previous && previous.status === 'indexed' && previous.schemaHash === schemaHash) {
            skipped += 1
            items.push(previous)
            continue
          }

          items.push({
            connectionId: request.connectionId,
            databaseName: db.name,
            tableName: table.name,
            schemaHash,
            summaryText,
            status: 'indexed',
            updatedAt: Date.now()
          })
        } catch (err) {
          items.push({
            connectionId: request.connectionId,
            databaseName: db.name,
            tableName: table.name,
            schemaHash: '',
            summaryText: '',
            status: 'failed',
            error: err instanceof Error ? err.message : String(err),
            updatedAt: Date.now()
          })
        }
      }
    }

    if (!targetSet) {
      deleteStaleSemanticIndexItems(
        request.connectionId,
        databases.map((db: { name: string }) => db.name),
        validKeys
      )
    }

    setSemanticIndexItems(request.connectionId, items)

    const failed = items.filter((item) => item.status === 'failed').length
    const indexed = items.filter((item) => item.status === 'indexed').length - skipped

    return {
      total: items.length,
      indexed,
      failed,
      skipped,
      items,
      createdAt: Date.now()
    }
  })

  ipcMain.handle('ai:getSemanticIndexStatus', async (_event, connectionId: string): Promise<SemanticIndexItem[]> => {
    return getSemanticIndexItems(connectionId)
  })

  ipcMain.handle('ai:updateSemanticIndexItem', async (_event, request: SemanticIndexUpdateRequest): Promise<SemanticIndexItem> => {
    const db = getInternalDb()
    const result = db.prepare(`
      UPDATE semantic_index_items
      SET manual_notes = ?, updated_at = ?
      WHERE connection_id = ?
        AND LOWER(database_name) = LOWER(?)
        AND LOWER(table_name) = LOWER(?)
    `).run(
      request.manualNotes.trim() || null,
      Date.now(),
      request.connectionId,
      request.databaseName,
      request.tableName
    )

    if (result.changes === 0) {
      throw new Error(`未找到语义索引条目: ${request.databaseName}.${request.tableName}`)
    }

    const row = db.prepare(`
      SELECT connection_id, database_name, table_name, schema_hash, summary_text, manual_notes, status, error_message, updated_at
      FROM semantic_index_items
      WHERE connection_id = ?
        AND LOWER(database_name) = LOWER(?)
        AND LOWER(table_name) = LOWER(?)
    `).get(request.connectionId, request.databaseName, request.tableName) as SemanticIndexRow | undefined

    if (!row) {
      throw new Error('语义索引条目不存在')
    }

    return rowToSemanticIndexItem(row)
  })

  ipcMain.handle('ai:getERGraph', async (_event, request: ERGraphLoadRequest): Promise<ERGraphLoadResponse> => {
    return loadERGraphData(request)
  })

  ipcMain.handle('ai:saveERGraph', async (_event, request: ERGraphSaveRequest): Promise<ERGraphSaveResponse> => {
    return saveERGraphData(request)
  })

  ipcMain.handle('ai:inferSchemaRelations', async (_event, request: ERGraphInferRequest): Promise<ERGraphInferResponse> => {
    return inferERGraph(request)
  })
}
