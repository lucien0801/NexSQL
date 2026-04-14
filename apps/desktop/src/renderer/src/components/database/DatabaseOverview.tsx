import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Database, RefreshCw, Table2, Copy, Search, ArrowUpDown, ExternalLink, Download, Upload } from 'lucide-react'
import type { DBType } from '@shared/types/connection'
import type { SchemaTable } from '@shared/types/query'
import type { QueryTab } from '@renderer/stores/queryStore'
import { useConnectionStore } from '@renderer/stores/connectionStore'
import { useQueryStore } from '@renderer/stores/queryStore'

interface DatabaseOverviewProps {
  tab: QueryTab
}

interface TableMetaRow {
  name: string
  schema: string
  kind: string
  charset: string
  collation: string
  engine: string
  estimatedRow: number | null
  totalSize: number | null
  dataSize: number | null
  indexSize: number | null
  comment: string
}

type SortKey =
  | 'name'
  | 'schema'
  | 'kind'
  | 'charset'
  | 'collation'
  | 'engine'
  | 'estimatedRow'
  | 'totalSize'
  | 'dataSize'
  | 'indexSize'
  | 'comment'

interface ColumnDef {
  key: SortKey
  label: string
  numeric?: boolean
}

const columns: ColumnDef[] = [
  { key: 'name', label: 'name' },
  { key: 'schema', label: 'schema' },
  { key: 'kind', label: 'kind' },
  { key: 'charset', label: 'charset' },
  { key: 'collation', label: 'collation' },
  { key: 'engine', label: 'engine' },
  { key: 'estimatedRow', label: 'estimated_row', numeric: true },
  { key: 'totalSize', label: 'total_size', numeric: true },
  { key: 'dataSize', label: 'data_size', numeric: true },
  { key: 'indexSize', label: 'index_size', numeric: true },
  { key: 'comment', label: 'comment' }
]

type ExportMode = 'structure' | 'data' | 'full'

interface ImportPreviewState {
  fileName: string
  sql: string
  statements: string[]
}

interface StatementStats {
  create: number
  modify: number
  insert: number
  delete: number
  other: number
}

export function DatabaseOverview({ tab }: DatabaseOverviewProps): JSX.Element {
  const { connections } = useConnectionStore()
  const { openTableTab } = useQueryStore()
  const connection = connections.find((item) => item.id === tab.connectionId) ?? null
  const dbType = connection?.type ?? 'mysql'
  const databaseName = tab.selectedDatabase ?? connection?.database ?? ''
  const [rows, setRows] = useState<TableMetaRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [showExportDialog, setShowExportDialog] = useState(false)
  const [exportMode, setExportMode] = useState<ExportMode>('full')
  const [exportSelectedOnly, setExportSelectedOnly] = useState(false)
  const [importPreview, setImportPreview] = useState<ImportPreviewState | null>(null)
  const [selectedTableNames, setSelectedTableNames] = useState<string[]>([])

  const summary = useMemo(() => {
    const totalSize = rows.reduce((sum, row) => sum + (row.totalSize ?? 0), 0)
    const totalRows = rows.reduce((sum, row) => sum + (row.estimatedRow ?? 0), 0)
    return { totalSize, totalRows }
  }, [rows])

  const loadData = useCallback(async (): Promise<void> => {
    if (!tab.connectionId || !databaseName || !window.db) return
    setLoading(true)
    setError(null)
    setMessage(null)
    try {
      const sql = buildDatabaseOverviewQuery(dbType, databaseName)
      const result = await window.db.executeQuery(tab.connectionId, sql, databaseName)
      if (result.error) throw new Error(result.error)
      setRows(result.rows.map(mapOverviewRow))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [databaseName, dbType, tab.connectionId])

  const visibleRows = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    const filtered = keyword
      ? rows.filter((row) =>
          [row.name, row.schema, row.kind, row.charset, row.collation, row.engine, row.comment]
            .join(' ')
            .toLowerCase()
            .includes(keyword)
        )
      : rows

    return [...filtered].sort((left, right) => compareRows(left, right, sortKey, sortDirection))
  }, [rows, search, sortKey, sortDirection])

  const visibleRowNames = useMemo(() => visibleRows.map((row) => row.name), [visibleRows])
  const visibleSelectedCount = useMemo(
    () => visibleRowNames.filter((name) => selectedTableNames.includes(name)).length,
    [visibleRowNames, selectedTableNames]
  )
  const selectedTotal = selectedTableNames.length
  const importStats = useMemo(
    () => (importPreview ? classifySqlStatements(importPreview.statements) : null),
    [importPreview]
  )

  useEffect(() => {
    void loadData()
  }, [loadData, tab.id])

  useEffect(() => {
    setSelectedTableNames([])
    setExportSelectedOnly(false)
  }, [tab.id, databaseName])

  const copyDatabaseName = async (): Promise<void> => {
    if (!databaseName) return
    await navigator.clipboard.writeText(databaseName)
  }

  const refresh = async (): Promise<void> => {
    await loadData()
  }

  const handleExportDatabase = async (): Promise<void> => {
    if (!tab.connectionId || !databaseName || !window.db) return
    try {
      setError(null)
      setMessage(null)
      setLoading(true)
      const sql = await buildDatabaseExport(
        tab.connectionId,
        databaseName,
        dbType,
        exportMode,
        exportSelectedOnly ? selectedTableNames : undefined
      )
      const blob = new Blob([sql], { type: 'text/sql;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${sanitizeFileName(databaseName)}-${exportMode}.sql`
      link.click()
      URL.revokeObjectURL(url)
      setMessage(`已导出数据库 ${databaseName}（${exportMode === 'full' ? '全量' : exportMode === 'structure' ? '仅结构' : '仅数据'}）`)
      setShowExportDialog(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  const handleImportClick = (): void => {
    fileInputRef.current?.click()
  }

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0]
    if (!file || !tab.connectionId || !databaseName || !window.db) return

    try {
      setError(null)
      setMessage(null)
      const sql = await file.text()
      const statements = splitSqlStatements(sql)
      if (statements.length === 0) throw new Error('未解析到可执行的 SQL 语句')
      setImportPreview({ fileName: file.name, sql, statements })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      event.target.value = ''
    }
  }

  const confirmImport = async (): Promise<void> => {
    if (!importPreview || !tab.connectionId || !databaseName || !window.db) return
    try {
      setError(null)
      setMessage(null)
      setLoading(true)
      for (const statement of importPreview.statements) {
        const result = await window.db.executeQuery(tab.connectionId, statement, databaseName)
        if (result.error) throw new Error(result.error)
      }
      await loadData()
      setMessage(`已导入 ${importPreview.statements.length} 条 SQL 语句到 ${databaseName}`)
      setImportPreview(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  const openTableData = (tableName: string): void => {
    if (!tab.connectionId || !databaseName) return
    openTableTab(tab.connectionId, tableName, databaseName)
  }

  const handleSort = (key: SortKey): void => {
    if (sortKey === key) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortKey(key)
    setSortDirection('asc')
  }

  const toggleRowSelection = (tableName: string): void => {
    setSelectedTableNames((prev) =>
      prev.includes(tableName) ? prev.filter((item) => item !== tableName) : [...prev, tableName]
    )
  }

  const toggleVisibleSelection = (): void => {
    setSelectedTableNames((prev) => {
      const allSelected = visibleRowNames.length > 0 && visibleRowNames.every((name) => prev.includes(name))
      if (allSelected) {
        return prev.filter((name) => !visibleRowNames.includes(name))
      }
      const merged = new Set([...prev, ...visibleRowNames])
      return Array.from(merged)
    })
  }

  return (
    <div className="flex flex-col h-full bg-app-bg">
      <div className="flex items-center justify-between px-4 py-3 bg-app-sidebar border-b border-app-border shrink-0 gap-3">
        <div className="min-w-0 flex items-center gap-2">
          <Database size={16} className="text-accent-blue shrink-0" />
          <div className="min-w-0">
            <div className="text-sm font-semibold text-text-primary truncate">{databaseName || '数据库概览'}</div>
            <div className="text-xs text-text-muted truncate">
              {visibleRows.length}/{rows.length} 张表 · 估算 {summary.totalRows} 行 · 总大小 {formatBytes(summary.totalSize)}
            </div>
          </div>
          <button
            onClick={() => void copyDatabaseName()}
            className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-app-hover transition-colors"
            title="复制数据库名"
          >
            <Copy size={13} />
          </button>
        </div>
        <button
          onClick={() => handleImportClick()}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-app-border text-text-secondary hover:text-text-primary hover:border-accent-blue transition-colors"
          title="导入 SQL 文件到当前数据库"
        >
          <Upload size={12} />
          导入
        </button>
        <button
          onClick={() => setShowExportDialog(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-app-border text-text-secondary hover:text-text-primary hover:border-accent-blue transition-colors"
          title="导出当前数据库 SQL"
        >
          <Download size={12} />
          导出
        </button>
        <button
          onClick={() => void refresh()}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-app-border text-text-secondary hover:text-text-primary hover:border-accent-blue transition-colors"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          刷新
        </button>
      </div>

      <div className="flex items-center gap-2 px-4 py-2 bg-app-bg border-b border-app-border shrink-0">
        <div className="relative min-w-[260px] flex-1 max-w-[420px]">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索表名、schema、注释..."
            className="w-full bg-app-input border border-app-border rounded pl-7 pr-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent-blue"
          />
        </div>
        {search && (
          <button
            onClick={() => setSearch('')}
            className="px-3 py-1.5 text-xs rounded border border-app-border text-text-secondary hover:text-text-primary hover:border-accent-blue transition-colors"
          >
            清空
          </button>
        )}
      </div>

      <input ref={fileInputRef} type="file" accept=".sql,.txt" className="hidden" onChange={handleImportFile} />

      {showExportDialog && (
        <ActionDialog title="导出数据库" onClose={() => !loading && setShowExportDialog(false)}>
          <div className="space-y-3 text-xs text-text-secondary">
            <div>请选择导出内容：</div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="radio" checked={exportMode === 'structure'} onChange={() => setExportMode('structure')} />
              <span>只导出结构</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="radio" checked={exportMode === 'data'} onChange={() => setExportMode('data')} />
              <span>只导出数据</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="radio" checked={exportMode === 'full'} onChange={() => setExportMode('full')} />
              <span>全量导出</span>
            </label>
            <div className="pt-2 border-t border-app-border/60">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={exportSelectedOnly}
                  onChange={(e) => setExportSelectedOnly(e.target.checked)}
                />
                <span>只导出选中表</span>
              </label>
              <div className="text-2xs text-text-muted mt-1">
                当前已选 {selectedTotal} 张表（当前筛选视图中选中 {visibleSelectedCount}/{visibleRowNames.length}）
              </div>
            </div>
          </div>
          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              onClick={() => setShowExportDialog(false)}
              className="px-3 py-1.5 rounded border border-app-border text-text-secondary hover:text-text-primary hover:border-accent-blue transition-colors text-xs"
              disabled={loading}
            >
              取消
            </button>
            <button
              onClick={() => void handleExportDatabase()}
              className="px-3 py-1.5 rounded bg-accent-blue text-white hover:bg-blue-600 transition-colors text-xs disabled:opacity-40"
              disabled={loading || (exportSelectedOnly && selectedTotal === 0)}
            >
              {loading ? '导出中...' : '开始导出'}
            </button>
          </div>
        </ActionDialog>
      )}

      {importPreview && (
        <ActionDialog title="导入预检" onClose={() => !loading && setImportPreview(null)}>
          <div className="space-y-3 text-xs text-text-secondary">
            <div>文件：{importPreview.fileName}</div>
            <div>将执行 {importPreview.statements.length} 条 SQL 语句。</div>
            {importStats && (
              <div className="grid grid-cols-2 gap-2 text-2xs">
                <div className="rounded border border-app-border px-2 py-1">创建: {importStats.create}</div>
                <div className="rounded border border-app-border px-2 py-1">修改: {importStats.modify}</div>
                <div className="rounded border border-app-border px-2 py-1">插入: {importStats.insert}</div>
                <div className="rounded border border-app-border px-2 py-1">删除: {importStats.delete}</div>
                <div className="rounded border border-app-border px-2 py-1 col-span-2">其他: {importStats.other}</div>
              </div>
            )}
            <div className="rounded border border-app-border bg-app-input p-2 max-h-48 overflow-auto text-2xs text-text-muted whitespace-pre-wrap">
              {importPreview.statements.slice(0, 5).map((statement, index) => `${index + 1}. ${statement}`).join('\n\n')}
              {importPreview.statements.length > 5 ? `\n\n... 其余 ${importPreview.statements.length - 5} 条语句未展开` : ''}
            </div>
          </div>
          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              onClick={() => setImportPreview(null)}
              className="px-3 py-1.5 rounded border border-app-border text-text-secondary hover:text-text-primary hover:border-accent-blue transition-colors text-xs"
              disabled={loading}
            >
              取消
            </button>
            <button
              onClick={() => void confirmImport()}
              className="px-3 py-1.5 rounded bg-accent-blue text-white hover:bg-blue-600 transition-colors text-xs disabled:opacity-40"
              disabled={loading}
            >
              {loading ? '导入中...' : '确认导入'}
            </button>
          </div>
        </ActionDialog>
      )}

      {message && (
        <div className="px-4 py-2 text-xs text-accent-green border-b border-app-border bg-green-900/10">{message}</div>
      )}

      {error && (
        <div className="px-4 py-2 text-xs text-accent-red border-b border-app-border bg-red-900/10">{error}</div>
      )}

      <div className="flex-1 overflow-auto selectable">
        <table className="w-full text-xs border-collapse" style={{ minWidth: '1320px' }}>
          <thead className="sticky top-0 z-10 bg-app-sidebar border-b border-app-border">
            <tr>
              <th className="px-3 py-2 text-left text-text-secondary font-semibold border-r border-app-border whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={visibleRowNames.length > 0 && visibleSelectedCount === visibleRowNames.length}
                  onChange={toggleVisibleSelection}
                  title="勾选当前筛选结果"
                />
              </th>
              {columns.map((column) => (
                <th
                  key={column.key}
                  onClick={() => handleSort(column.key)}
                  className="px-3 py-2 text-left text-text-secondary font-semibold border-r border-app-border whitespace-nowrap cursor-pointer select-none"
                >
                  <span className="inline-flex items-center gap-1">
                    {column.label}
                    <ArrowUpDown size={11} className={sortKey === column.key ? 'text-accent-blue' : 'text-text-muted'} />
                    {sortKey === column.key && <span className="text-accent-blue">{sortDirection === 'asc' ? '↑' : '↓'}</span>}
                  </span>
                </th>
              ))}
              <th className="px-3 py-2 text-left text-text-secondary font-semibold whitespace-nowrap">actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 ? (
              <tr>
                <td colSpan={13} className="px-4 py-8 text-center text-text-muted">加载中...</td>
              </tr>
            ) : visibleRows.length === 0 ? (
              <tr>
                <td colSpan={13} className="px-4 py-8 text-center text-text-muted">
                  {rows.length === 0 ? '当前数据库暂无数据表信息' : '没有匹配的表'}
                </td>
              </tr>
            ) : (
              visibleRows.map((row, index) => (
                <tr
                  key={`${row.schema}.${row.name}`}
                  onDoubleClick={() => openTableData(row.name)}
                  className={`${index % 2 === 0 ? 'bg-app-bg' : 'bg-app-panel'} border-b border-app-border hover:bg-app-hover cursor-pointer`}
                >
                  <td className="px-3 py-2 border-r border-app-border whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedTableNames.includes(row.name)}
                      onChange={() => toggleRowSelection(row.name)}
                      title={`选择 ${row.name}`}
                    />
                  </td>
                  <td className="px-3 py-2 border-r border-app-border font-medium text-text-primary whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5">
                      <Table2 size={12} className="text-accent-orange shrink-0" />
                      {row.name}
                    </span>
                  </td>
                  <td className="px-3 py-2 border-r border-app-border whitespace-nowrap">{row.schema || '--'}</td>
                  <td className="px-3 py-2 border-r border-app-border whitespace-nowrap">{row.kind || '--'}</td>
                  <td className="px-3 py-2 border-r border-app-border whitespace-nowrap">{row.charset || '--'}</td>
                  <td className="px-3 py-2 border-r border-app-border whitespace-nowrap">{row.collation || '--'}</td>
                  <td className="px-3 py-2 border-r border-app-border whitespace-nowrap">{row.engine || '--'}</td>
                  <td className="px-3 py-2 border-r border-app-border whitespace-nowrap">{row.estimatedRow ?? '--'}</td>
                  <td className="px-3 py-2 border-r border-app-border whitespace-nowrap">{formatBytes(row.totalSize)}</td>
                  <td className="px-3 py-2 border-r border-app-border whitespace-nowrap">{formatBytes(row.dataSize)}</td>
                  <td className="px-3 py-2 border-r border-app-border whitespace-nowrap">{formatBytes(row.indexSize)}</td>
                  <td className="px-3 py-2 border-r border-app-border">{row.comment || '--'}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        openTableData(row.name)
                      }}
                      className="inline-flex items-center gap-1.5 px-2 py-1 rounded border border-app-border text-text-secondary hover:text-text-primary hover:border-accent-blue transition-colors"
                      title="打开表数据"
                    >
                      <ExternalLink size={11} />
                      打开数据
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function compareRows(left: TableMetaRow, right: TableMetaRow, sortKey: SortKey, direction: 'asc' | 'desc'): number {
  const factor = direction === 'asc' ? 1 : -1
  const leftValue = left[sortKey]
  const rightValue = right[sortKey]

  if (typeof leftValue === 'number' || typeof rightValue === 'number' || leftValue === null || rightValue === null) {
    const a = typeof leftValue === 'number' ? leftValue : -1
    const b = typeof rightValue === 'number' ? rightValue : -1
    return (a - b) * factor
  }

  return String(leftValue ?? '').localeCompare(String(rightValue ?? '')) * factor
}

function buildDatabaseOverviewQuery(dbType: DBType, database: string): string {
  const safeDatabase = database.replace(/'/g, "''")

  if (dbType === 'postgresql') {
    return `SELECT
      c.relname AS table_name,
      n.nspname AS table_schema,
      CASE c.relkind WHEN 'v' THEN 'VIEW' ELSE 'TABLE' END AS table_kind,
      NULL::text AS table_charset,
      NULL::text AS table_collation,
      NULL::text AS table_engine,
      c.reltuples::bigint AS estimated_row,
      pg_total_relation_size(c.oid) AS total_size,
      pg_relation_size(c.oid) AS data_size,
      pg_indexes_size(c.oid) AS index_size,
      obj_description(c.oid, 'pg_class') AS table_comment
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'v') AND n.nspname = '${safeDatabase}'
    ORDER BY c.relname`
  }

  if (dbType === 'mssql') {
    return `SELECT
      t.name AS table_name,
      s.name AS table_schema,
      CASE WHEN t.type = 'V' THEN 'VIEW' ELSE 'TABLE' END AS table_kind,
      NULL AS table_charset,
      NULL AS table_collation,
      NULL AS table_engine,
      SUM(p.rows) AS estimated_row,
      SUM(a.total_pages) * 8192 AS total_size,
      SUM(a.data_pages) * 8192 AS data_size,
      (SUM(a.used_pages) - SUM(a.data_pages)) * 8192 AS index_size,
      CAST(ep.value AS NVARCHAR(4000)) AS table_comment
    FROM sys.objects t
    JOIN sys.schemas s ON s.schema_id = t.schema_id
    LEFT JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0, 1)
    LEFT JOIN sys.allocation_units a ON a.container_id = p.partition_id
    LEFT JOIN sys.extended_properties ep ON ep.major_id = t.object_id AND ep.minor_id = 0 AND ep.name = 'MS_Description'
    WHERE t.type IN ('U', 'V')
    GROUP BY t.name, s.name, t.type, ep.value
    ORDER BY t.name`
  }

  if (dbType === 'sqlite') {
    return `SELECT
      name AS table_name,
      'main' AS table_schema,
      UPPER(type) AS table_kind,
      NULL AS table_charset,
      NULL AS table_collation,
      NULL AS table_engine,
      NULL AS estimated_row,
      NULL AS total_size,
      NULL AS data_size,
      NULL AS index_size,
      '' AS table_comment
    FROM sqlite_master
    WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'
    ORDER BY name`
  }

  return `SELECT
    t.TABLE_NAME AS table_name,
    t.TABLE_SCHEMA AS table_schema,
    t.TABLE_TYPE AS table_kind,
    ccsa.CHARACTER_SET_NAME AS table_charset,
    t.TABLE_COLLATION AS table_collation,
    t.ENGINE AS table_engine,
    t.TABLE_ROWS AS estimated_row,
    (COALESCE(t.DATA_LENGTH, 0) + COALESCE(t.INDEX_LENGTH, 0)) AS total_size,
    t.DATA_LENGTH AS data_size,
    t.INDEX_LENGTH AS index_size,
    t.TABLE_COMMENT AS table_comment
  FROM information_schema.TABLES t
  LEFT JOIN information_schema.COLLATION_CHARACTER_SET_APPLICABILITY ccsa
    ON ccsa.COLLATION_NAME = t.TABLE_COLLATION
  WHERE t.TABLE_SCHEMA = '${safeDatabase}'
  ORDER BY t.TABLE_NAME`
}

function mapOverviewRow(row: Record<string, unknown>): TableMetaRow {
  return {
    name: toText(row.table_name ?? row.name),
    schema: toText(row.table_schema ?? row.schema),
    kind: toText(row.table_kind ?? row.kind),
    charset: toText(row.table_charset ?? row.charset, '--'),
    collation: toText(row.table_collation ?? row.collation, '--'),
    engine: toText(row.table_engine ?? row.engine, '--'),
    estimatedRow: toNumber(row.estimated_row),
    totalSize: toNumber(row.total_size),
    dataSize: toNumber(row.data_size),
    indexSize: toNumber(row.index_size),
    comment: toText(row.table_comment ?? row.comment)
  }
}

function toText(value: unknown, fallback = ''): string {
  return value == null ? fallback : String(value)
}

function toNumber(value: unknown): number | null {
  if (value == null || value === '') return null
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

function formatBytes(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '--'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = value
  let unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex++
  }
  return `${size >= 10 || unitIndex === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unitIndex]}`
}

function sanitizeFileName(value: string): string {
  return value.replace(/[\\/:*?"<>|]+/g, '_')
}

function ActionDialog({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }): JSX.Element {
  return createPortal(
    <>
      <div className="fixed inset-0 z-[70] bg-black/40" onClick={onClose} />
      <div className="fixed inset-0 z-[71] flex items-center justify-center p-4">
        <div className="w-full max-w-lg rounded border border-app-border bg-app-sidebar shadow-2xl">
          <div className="px-4 py-3 border-b border-app-border text-sm font-semibold text-text-primary">{title}</div>
          <div className="px-4 py-3">{children}</div>
        </div>
      </div>
    </>,
    document.body
  )
}

async function buildDatabaseExport(
  connectionId: string,
  database: string,
  dbType: DBType,
  mode: ExportMode,
  selectedTableNames?: string[]
): Promise<string> {
  if (!window.db) throw new Error('数据库 API 不可用')

  const schema = await window.db.getSchema(connectionId, database)
  const dbInfo = schema.databases.find((item) => item.name === database)
  const selected = new Set((selectedTableNames ?? []).map((name) => name.toLowerCase()))
  const tables = (dbInfo?.tables ?? []).filter((table) =>
    selected.size === 0 ? true : selected.has(table.name.toLowerCase())
  )
  const chunks: string[] = [
    '-- NexSQL Database Export',
    `-- Source: ${database}`,
    `-- Export Mode: ${mode}`,
    `-- Exported At: ${new Date().toISOString()}`,
    ''
  ]

  if (dbType === 'mysql' && mode !== 'data') {
    chunks.push(`CREATE DATABASE IF NOT EXISTS ${quoteIdentifier(dbType, database)};`)
    chunks.push(`USE ${quoteIdentifier(dbType, database)};`)
    chunks.push('')
  }

  for (const table of tables) {
    if (mode !== 'data') {
      const ddl = await window.db.getTableDDL(connectionId, table.name, database)
      chunks.push(`-- ${table.type.toUpperCase()}: ${table.name}`)
      chunks.push(ddl.endsWith(';') ? ddl : `${ddl};`)
    }

    if (mode !== 'structure' && table.type === 'table') {
      const result = await window.db.executeQuery(
        connectionId,
        `SELECT * FROM ${quoteIdentifier(dbType, table.name)}`,
        database
      )
      if (result.error) throw new Error(result.error)
      if (result.rows.length > 0) {
        const columnNames = result.columns.map((column) => column.name)
        for (const row of result.rows) {
          chunks.push(buildInsertStatement(dbType, table.name, columnNames, row))
        }
      }
    }

    chunks.push('')
  }

  return chunks.join('\n')
}

function classifySqlStatements(statements: string[]): StatementStats {
  const stats: StatementStats = { create: 0, modify: 0, insert: 0, delete: 0, other: 0 }

  for (const raw of statements) {
    const statement = raw.trim().toUpperCase()
    if (!statement) continue

    if (statement.startsWith('CREATE ')) {
      stats.create++
      continue
    }

    if (statement.startsWith('ALTER ') || statement.startsWith('UPDATE ') || statement.startsWith('REPLACE ')) {
      stats.modify++
      continue
    }

    if (statement.startsWith('INSERT ')) {
      stats.insert++
      continue
    }

    if (statement.startsWith('DELETE ') || statement.startsWith('DROP ') || statement.startsWith('TRUNCATE ')) {
      stats.delete++
      continue
    }

    stats.other++
  }

  return stats
}

function quoteIdentifier(type: DBType, value: string): string {
  if (type === 'mssql') return `[${value.replace(/]/g, ']]')}]`
  if (type === 'postgresql' || type === 'sqlite') return `"${value.replace(/"/g, '""')}"`
  return `\`${value.replace(/`/g, '``')}\``
}

function toSqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number' || typeof value === 'bigint') return String(value)
  if (typeof value === 'boolean') return value ? '1' : '0'
  return `'${String(value).replace(/'/g, "''")}'`
}

function buildInsertStatement(type: DBType, tableName: string, columns: string[], row: Record<string, unknown>): string {
  const table = quoteIdentifier(type, tableName)
  const cols = columns.map((column) => quoteIdentifier(type, column)).join(', ')
  const values = columns.map((column) => toSqlLiteral(row[column])).join(', ')
  return `INSERT INTO ${table} (${cols}) VALUES (${values});`
}

function splitSqlStatements(sql: string): string[] {
  const statements: string[] = []
  let current = ''
  let inSingle = false
  let inDouble = false
  let inBacktick = false
  let inLineComment = false
  let inBlockComment = false

  for (let index = 0; index < sql.length; index++) {
    const char = sql[index]
    const next = sql[index + 1] ?? ''

    if (inLineComment) {
      if (char === '\n') {
        inLineComment = false
        current += char
      }
      continue
    }

    if (inBlockComment) {
      if (char === '*' && next === '/') {
        inBlockComment = false
        index++
      }
      continue
    }

    if (!inSingle && !inDouble && !inBacktick) {
      if (char === '-' && next === '-') {
        inLineComment = true
        index++
        continue
      }
      if (char === '#') {
        inLineComment = true
        continue
      }
      if (char === '/' && next === '*') {
        inBlockComment = true
        index++
        continue
      }
    }

    if (char === "'" && !inDouble && !inBacktick) {
      const escaped = sql[index - 1] === '\\'
      if (!escaped) inSingle = !inSingle
      current += char
      continue
    }

    if (char === '"' && !inSingle && !inBacktick) {
      const escaped = sql[index - 1] === '\\'
      if (!escaped) inDouble = !inDouble
      current += char
      continue
    }

    if (char === '`' && !inSingle && !inDouble) {
      inBacktick = !inBacktick
      current += char
      continue
    }

    if (char === ';' && !inSingle && !inDouble && !inBacktick) {
      const statement = current.trim()
      if (statement) statements.push(statement)
      current = ''
      continue
    }

    current += char
  }

  const tail = current.trim()
  if (tail) statements.push(tail)
  return statements.filter((statement) => !/^DELIMITER\b/i.test(statement.trim()))
}