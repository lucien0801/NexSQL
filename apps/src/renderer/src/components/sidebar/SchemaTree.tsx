import { useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronRight, ChevronDown, Table2, Eye, Columns, Database, Key, RefreshCw, Search, X } from 'lucide-react'
import { clsx } from 'clsx'
import { useConnectionStore } from '@renderer/stores/connectionStore'
import { useQueryStore } from '@renderer/stores/queryStore'
import { TableDesigner } from '@renderer/components/designer/TableDesigner'
import type { SchemaTable, SchemaColumn } from '@shared/types/query'

// ──────────────────── Context Menu ────────────────────
interface CtxMenu {
  x: number
  y: number
  table: SchemaTable
  connectionId: string
  database: string
}

function ContextMenu({
  menu,
  onClose,
  onDesign
}: {
  menu: CtxMenu
  onClose: () => void
  onDesign: () => void
}): JSX.Element {
  const { openTableTab, newTab, updateTabSQL, updateTabConnection, updateTabDatabase, setActiveTab } = useQueryStore()

  const openInNewTab = (sql: string): void => {
    const tabId = newTab(menu.connectionId)
    updateTabConnection(tabId, menu.connectionId)
    updateTabDatabase(tabId, menu.database)
    updateTabSQL(tabId, sql)
    setActiveTab(tabId)
    onClose()
  }

  const openTableView = (): void => {
    openTableTab(menu.connectionId, menu.table.name, menu.database)
    onClose()
  }

  const handleSelectAll = (): void => {
    openTableView()
  }

  const handleCount = (): void => {
    openInNewTab(`SELECT COUNT(*) AS total FROM \`${menu.table.name}\`;`)
  }

  const handleExportSQL = async (): Promise<void> => {
    if (!window.db) return
    try {
      const sql = await window.db.exportTableSQL(menu.connectionId, menu.table.name, menu.database)
      openInNewTab(sql)
    } catch (e) {
      openInNewTab(`-- 导出失败: ${e}`)
    }
  }

  const handleDesign = (): void => {
    onDesign()
    onClose()
  }

  const items = [
    { label: '查看数据 (表格)', icon: '▶', action: handleSelectAll },
    { label: '统计行数 (COUNT)', icon: '#', action: handleCount },
    { divider: true },
    { label: '设计表 (字段/索引/DDL)', icon: '⊞', action: handleDesign },
    { divider: true },
    { label: '导出数据为 INSERT SQL', icon: '↑', action: handleExportSQL },
  ]

  return createPortal(
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="fixed z-50 bg-app-sidebar border border-app-border rounded shadow-2xl py-1 min-w-[200px] text-xs"
        style={{ top: menu.y, left: menu.x }}
      >
        <div className="px-3 py-1 text-text-muted text-2xs border-b border-app-border mb-1 truncate">
          {menu.table.name}
        </div>
        {items.map((item, i) =>
          'divider' in item ? (
            <div key={i} className="border-t border-app-border my-1" />
          ) : (
            <button
              key={i}
              onClick={item.action}
              className="w-full text-left px-3 py-1.5 flex items-center gap-2 text-text-secondary hover:bg-app-active hover:text-text-primary transition-colors"
            >
              <span className="font-mono text-text-muted w-4 text-center shrink-0">{item.icon}</span>
              {item.label}
            </button>
          )
        )}
      </div>
    </>,
    document.body
  )
}

// ──────────────────── TableNode ────────────────────
function TableNode({
  table,
  depth,
  connectionId,
  database,
  onContextMenu,
  highlight
}: {
  table: SchemaTable
  depth: number
  connectionId: string
  database: string
  onContextMenu: (e: React.MouseEvent, table: SchemaTable) => void
  highlight?: string
}): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const [columns, setColumns] = useState<SchemaColumn[]>(table.columns)
  const [loading, setLoading] = useState(false)
  const { openTableTab } = useQueryStore()

  const handleToggle = async (): Promise<void> => {
    const next = !expanded
    setExpanded(next)
    if (next && columns.length === 0 && !loading) {
      setLoading(true)
      try {
        const cols = await window.db!.getTableColumns(connectionId, table.name, database)
        setColumns(cols)
      } catch {
        // ignore
      } finally {
        setLoading(false)
      }
    }
  }

  const handleDoubleClick = (): void => {
    openTableTab(connectionId, table.name, database)
  }

  // Highlight matching characters
  const renderName = (): JSX.Element => {
    if (!highlight) return <span className="truncate">{table.name}</span>
    const idx = table.name.toLowerCase().indexOf(highlight.toLowerCase())
    if (idx === -1) return <span className="truncate">{table.name}</span>
    return (
      <span className="truncate">
        {table.name.slice(0, idx)}
        <mark className="bg-accent-yellow/40 text-text-primary rounded-sm">{table.name.slice(idx, idx + highlight.length)}</mark>
        {table.name.slice(idx + highlight.length)}
      </span>
    )
  }

  return (
    <div>
      <button
        onClick={handleToggle}
        onDoubleClick={handleDoubleClick}
        onContextMenu={(e) => onContextMenu(e, table)}
        style={{ paddingLeft: `${depth * 12 + 12}px` }}
        className="w-full flex items-center gap-1.5 py-0.5 pr-3 text-xs text-text-secondary hover:text-text-primary hover:bg-app-hover transition-colors group"
        title="双击预览数据，右键更多操作"
      >
        {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        {table.type === 'view' ? (
          <Eye size={12} className="text-accent-blue shrink-0" />
        ) : (
          <Table2 size={12} className="text-accent-orange shrink-0" />
        )}
        {renderName()}
        {loading && <span className="ml-auto text-2xs text-text-muted animate-pulse">...</span>}
        {!loading && columns.length > 0 && (
          <span className="text-2xs text-text-muted ml-auto opacity-0 group-hover:opacity-100">{columns.length}</span>
        )}
      </button>
      {expanded && columns.map((col) => (
        <ColumnRow key={col.name} col={col} depth={depth + 1} />
      ))}
    </div>
  )
}

function ColumnRow({ col, depth }: { col: SchemaColumn; depth: number }): JSX.Element {
  return (
    <div
      style={{ paddingLeft: `${depth * 12 + 12}px` }}
      className="flex items-center gap-1.5 py-0.5 pr-3 text-2xs text-text-muted"
    >
      {col.primaryKey ? (
        <Key size={9} className="shrink-0 text-accent-yellow" />
      ) : (
        <Columns size={9} className="shrink-0" />
      )}
      <span className="truncate">{col.name}</span>
      <span className="ml-auto text-text-muted opacity-70 font-mono">{col.type}</span>
    </div>
  )
}

// ──────────────────── DatabaseNode ────────────────────
function DatabaseNode({
  db,
  depth,
  connectionId,
  defaultExpanded,
  filter
}: {
  db: { name: string; tables: SchemaTable[] }
  depth: number
  connectionId: string
  defaultExpanded: boolean
  filter: string
}): JSX.Element {
  const hasFilter = filter.trim().length > 0
  const visibleTables = hasFilter
    ? db.tables.filter((t) => t.name.toLowerCase().includes(filter.toLowerCase()))
    : db.tables

  // Auto-expand when searching
  const [manualExpanded, setManualExpanded] = useState(defaultExpanded)
  const expanded = hasFilter ? visibleTables.length > 0 : manualExpanded

  const [contextMenu, setContextMenu] = useState<CtxMenu | null>(null)
  const [designer, setDesigner] = useState<SchemaTable | null>(null)

  const handleCtx = (e: React.MouseEvent, table: SchemaTable): void => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, table, connectionId, database: db.name })
  }

  if (hasFilter && visibleTables.length === 0) return <></>

  return (
    <div>
      <button
        onClick={() => setManualExpanded((v) => !v)}
        style={{ paddingLeft: `${depth * 12 + 12}px` }}
        className="w-full flex items-center gap-1 py-0.5 pr-3 text-xs text-text-secondary hover:text-text-primary hover:bg-app-hover transition-colors"
      >
        {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <Database size={11} className="text-accent-blue shrink-0" />
        <span className="truncate">{db.name}</span>
        <span className="text-2xs text-text-muted ml-auto">{hasFilter ? `${visibleTables.length}/${db.tables.length}` : db.tables.length}</span>
      </button>
      {expanded && visibleTables.map((table) => (
        <TableNode
          key={table.name}
          table={table}
          depth={depth + 1}
          connectionId={connectionId}
          database={db.name}
          onContextMenu={handleCtx}
          highlight={hasFilter ? filter : undefined}
        />
      ))}
      {contextMenu && (
        <ContextMenu
          menu={contextMenu}
          onClose={() => setContextMenu(null)}
          onDesign={() => {
            setDesigner(contextMenu.table)
            setContextMenu(null)
          }}
        />
      )}
      {designer && (
        <TableDesigner
          connectionId={connectionId}
          table={designer.name}
          database={db.name}
          onClose={() => setDesigner(null)}
        />
      )}
    </div>
  )
}

// ──────────────────── SchemaConnectionNode ────────────────────
function SchemaConnectionNode({
  connectionId,
  connectionName,
  databases,
  isActive,
  filter
}: {
  connectionId: string
  connectionName: string
  databases: { name: string; tables: SchemaTable[] }[]
  isActive: boolean
  filter: string
}): JSX.Element {
  const [expanded, setExpanded] = useState(true)

  return (
    <div>
      <button
        onClick={() => setExpanded((v) => !v)}
        className={clsx(
          'w-full flex items-center gap-1 px-3 py-1 text-xs hover:bg-app-hover transition-colors',
          isActive ? 'text-text-primary' : 'text-text-secondary'
        )}
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="truncate font-medium">{connectionName}</span>
      </button>
      {expanded && databases.map((db) => (
        <DatabaseNode
          key={db.name}
          db={db}
          depth={1}
          connectionId={connectionId}
          defaultExpanded={databases.length === 1}
          filter={filter}
        />
      ))}
    </div>
  )
}

// ──────────────────── SchemaTree (root) ────────────────────
export function SchemaTree(): JSX.Element {
  const { connections, statuses, activeConnectionId } = useConnectionStore()
  const { schema, loadSchema } = useQueryStore()
  const [filter, setFilter] = useState('')
  const [refreshing, setRefreshing] = useState(false)

  const connectedConnections = connections.filter(
    (c) => (statuses[c.id] ?? 'disconnected') === 'connected'
  )

  const handleRefreshAll = async (): Promise<void> => {
    setRefreshing(true)
    try {
      await Promise.all(connectedConnections.map((c) => loadSchema(c.id)))
    } finally {
      setRefreshing(false)
    }
  }

  if (connectedConnections.length === 0) return <></>

  return (
    <div className="py-1 border-t border-app-border mt-2">
      {/* Header row: title + refresh */}
      <div className="flex items-center justify-between px-3 py-1">
        <span className="text-2xs text-text-muted uppercase tracking-wider font-semibold">数据库结构</span>
        <button
          onClick={handleRefreshAll}
          title="刷新所有 Schema"
          className="p-0.5 rounded text-text-muted hover:text-text-primary hover:bg-app-hover transition-colors"
        >
          <RefreshCw size={11} className={refreshing ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Search box */}
      <div className="px-2 pb-1">
        <div className="relative">
          <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="搜索数据表..."
            className="w-full bg-app-input border border-app-border rounded pl-6 pr-6 py-1 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue transition-colors"
          />
          {filter && (
            <button
              onClick={() => setFilter('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
            >
              <X size={11} />
            </button>
          )}
        </div>
      </div>

      {connectedConnections.map((conn) => {
        const s = schema[conn.id]
        return (
          <SchemaConnectionNode
            key={conn.id}
            connectionId={conn.id}
            connectionName={conn.name}
            databases={s?.databases ?? []}
            isActive={activeConnectionId === conn.id}
            filter={filter}
          />
        )
      })}
    </div>
  )
}
