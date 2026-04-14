import { useCallback, useEffect, useMemo, useState } from 'react'
import { Database, RefreshCw, Table2, Copy, Search, ArrowUpDown, ExternalLink } from 'lucide-react'
import type { DBType } from '@shared/types/connection'
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

export function DatabaseOverview({ tab }: DatabaseOverviewProps): JSX.Element {
  const { connections } = useConnectionStore()
  const { openTableTab } = useQueryStore()
  const connection = connections.find((item) => item.id === tab.connectionId) ?? null
  const dbType = connection?.type ?? 'mysql'
  const databaseName = tab.selectedDatabase ?? connection?.database ?? ''
  const [rows, setRows] = useState<TableMetaRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')

  const summary = useMemo(() => {
    const totalSize = rows.reduce((sum, row) => sum + (row.totalSize ?? 0), 0)
    const totalRows = rows.reduce((sum, row) => sum + (row.estimatedRow ?? 0), 0)
    return { totalSize, totalRows }
  }, [rows])

  const loadData = useCallback(async (): Promise<void> => {
    if (!tab.connectionId || !databaseName || !window.db) return
    setLoading(true)
    setError(null)
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

  useEffect(() => {
    void loadData()
  }, [loadData, tab.id])

  const copyDatabaseName = async (): Promise<void> => {
    if (!databaseName) return
    await navigator.clipboard.writeText(databaseName)
  }

  const refresh = async (): Promise<void> => {
    await loadData()
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

      {error && (
        <div className="px-4 py-2 text-xs text-accent-red border-b border-app-border bg-red-900/10">{error}</div>
      )}

      <div className="flex-1 overflow-auto selectable">
        <table className="w-full text-xs border-collapse" style={{ minWidth: '1320px' }}>
          <thead className="sticky top-0 z-10 bg-app-sidebar border-b border-app-border">
            <tr>
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
                <td colSpan={12} className="px-4 py-8 text-center text-text-muted">加载中...</td>
              </tr>
            ) : visibleRows.length === 0 ? (
              <tr>
                <td colSpan={12} className="px-4 py-8 text-center text-text-muted">
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