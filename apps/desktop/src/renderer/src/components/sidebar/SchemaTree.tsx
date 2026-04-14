import { useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronRight, ChevronDown, Table2, Eye, Columns, Database, Key, RefreshCw, Search, X, Plus, Languages, Trash2 } from 'lucide-react'
import { clsx } from 'clsx'
import { useConnectionStore } from '@renderer/stores/connectionStore'
import { useQueryStore } from '@renderer/stores/queryStore'
import { TableDesigner } from '@renderer/components/designer/TableDesigner'
import type { DBType } from '@shared/types/connection'
import type { SchemaTable, SchemaColumn } from '@shared/types/query'

function quoteIdentifierByType(dbType: DBType, name: string): string {
  if (dbType === 'mssql') return `[${name.replace(/]/g, ']]')}]`
  if (dbType === 'postgresql' || dbType === 'sqlite') return `"${name.replace(/"/g, '""')}"`
  return `\`${name.replace(/`/g, '``')}\``
}

function buildPreviewSQL(tableName: string, dbType: DBType): string {
  const t = quoteIdentifierByType(dbType, tableName)
  if (dbType === 'mssql') return `SELECT TOP 200 * FROM ${t};`
  return `SELECT * FROM ${t} LIMIT 200;`
}

function buildCreateTableSQL(tableName: string, dbType: DBType): string {
  const t = quoteIdentifierByType(dbType, tableName)

  if (dbType === 'postgresql') {
    return `CREATE TABLE ${t} (\n  id BIGSERIAL PRIMARY KEY\n);`
  }

  if (dbType === 'mssql') {
    return `CREATE TABLE ${t} (\n  [id] BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY\n);`
  }

  if (dbType === 'sqlite') {
    return `CREATE TABLE ${t} (\n  "id" INTEGER PRIMARY KEY AUTOINCREMENT\n);`
  }

  return `CREATE TABLE ${t} (\n  \`id\` BIGINT NOT NULL AUTO_INCREMENT,\n  PRIMARY KEY (\`id\`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`
}

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
  const { connections } = useConnectionStore()
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

  const handleSelectSQL = (): void => {
    const conn = connections.find((c) => c.id === menu.connectionId)
    const sql = buildPreviewSQL(menu.table.name, conn?.type ?? 'mysql')
    openInNewTab(sql)
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
    { label: '查看数据 (SQL)', icon: 'S', action: handleSelectSQL },
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

interface DbCtxMenu {
  x: number
  y: number
  connectionId: string
  database: string
}

function DatabaseContextMenu({
  menu,
  onClose,
  onCreateTable,
  onAlterCharset,
  onDropDatabase
}: {
  menu: DbCtxMenu
  onClose: () => void
  onCreateTable: (connectionId: string, database: string) => void
  onAlterCharset: (connectionId: string, database: string) => void
  onDropDatabase: (connectionId: string, database: string) => void
}): JSX.Element {
  return createPortal(
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="fixed z-50 bg-app-sidebar border border-app-border rounded shadow-2xl py-1 min-w-[220px] text-xs"
        style={{ top: menu.y, left: menu.x }}
      >
        <div className="px-3 py-1 text-text-muted text-2xs border-b border-app-border mb-1 truncate">
          {menu.database}
        </div>
        <button
          onClick={() => {
            onCreateTable(menu.connectionId, menu.database)
            onClose()
          }}
          className="w-full text-left px-3 py-1.5 flex items-center gap-2 text-text-secondary hover:bg-app-active hover:text-text-primary transition-colors"
        >
          <Plus size={12} className="shrink-0 text-accent-green" />
          新建数据表
        </button>
        <button
          onClick={() => {
            onAlterCharset(menu.connectionId, menu.database)
            onClose()
          }}
          className="w-full text-left px-3 py-1.5 flex items-center gap-2 text-text-secondary hover:bg-app-active hover:text-text-primary transition-colors"
        >
          <Languages size={12} className="shrink-0 text-accent-blue" />
          修改数据库字符集
        </button>
        <button
          onClick={() => {
            onDropDatabase(menu.connectionId, menu.database)
            onClose()
          }}
          className="w-full text-left px-3 py-1.5 flex items-center gap-2 text-accent-red hover:bg-app-active transition-colors"
        >
          <Trash2 size={12} className="shrink-0" />
          删除数据库
        </button>
      </div>
    </>,
    document.body
  )
}

type SchemaDialog =
  | {
      type: 'none'
    }
  | {
      type: 'create'
      connectionId: string
      name: string
      charset: string
      collation: string
    }
  | {
      type: 'drop'
      connectionId: string
      database: string
      confirmName: string
    }
  | {
      type: 'charset'
      connectionId: string
      database: string
      charset: string
      collation: string
      applyToAllTables: boolean
    }
  | {
      type: 'createTable'
      connectionId: string
      database: string
      tableName: string
    }
  | {
      type: 'message'
      title: string
      message: string
    }

function SchemaActionDialog({
  dialog,
  submitting,
  onClose,
  onChange,
  onSubmit
}: {
  dialog: SchemaDialog
  submitting: boolean
  onClose: () => void
  onChange: (patch: Record<string, string | boolean>) => void
  onSubmit: () => void
}): JSX.Element | null {
  if (dialog.type === 'none') return null

  const isMessage = dialog.type === 'message'
  const canSubmit = (() => {
    if (dialog.type === 'create') return dialog.name.trim().length > 0
    if (dialog.type === 'drop') return dialog.confirmName.trim() === dialog.database
    if (dialog.type === 'charset') return dialog.charset.trim().length > 0
    if (dialog.type === 'createTable') return dialog.tableName.trim().length > 0
    return true
  })()

  const title =
    dialog.type === 'create'
      ? '新建数据库'
      : dialog.type === 'drop'
        ? '删除数据库'
        : dialog.type === 'charset'
          ? '修改数据库字符集'
          : dialog.type === 'createTable'
            ? '新建数据表'
          : dialog.title

  return createPortal(
    <>
      <div className="fixed inset-0 z-[70] bg-black/40" onClick={() => !submitting && onClose()} />
      <div className="fixed inset-0 z-[71] flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded border border-app-border bg-app-sidebar shadow-2xl">
          <div className="px-4 py-3 border-b border-app-border text-sm font-semibold text-text-primary">{title}</div>

          <div className="px-4 py-3 space-y-3 text-xs text-text-secondary">
            {dialog.type === 'create' && (
              <>
                <div>
                  <div className="mb-1 text-text-muted">数据库名</div>
                  <input
                    value={dialog.name}
                    onChange={(e) => onChange({ name: e.target.value })}
                    className="w-full bg-app-input border border-app-border rounded px-2 py-1.5 text-text-primary focus:outline-none focus:border-accent-blue"
                    placeholder="例如：nexsql_demo"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div className="mb-1 text-text-muted">字符集（可选）</div>
                    <input
                      value={dialog.charset}
                      onChange={(e) => onChange({ charset: e.target.value })}
                      className="w-full bg-app-input border border-app-border rounded px-2 py-1.5 text-text-primary focus:outline-none focus:border-accent-blue"
                      placeholder="utf8mb4"
                    />
                  </div>
                  <div>
                    <div className="mb-1 text-text-muted">排序规则（可选）</div>
                    <input
                      value={dialog.collation}
                      onChange={(e) => onChange({ collation: e.target.value })}
                      className="w-full bg-app-input border border-app-border rounded px-2 py-1.5 text-text-primary focus:outline-none focus:border-accent-blue"
                      placeholder="utf8mb4_general_ci"
                    />
                  </div>
                </div>
              </>
            )}

            {dialog.type === 'drop' && (
              <>
                <div className="text-accent-red">此操作不可恢复。请输入数据库名确认删除。</div>
                <div>
                  <div className="mb-1 text-text-muted">确认删除：{dialog.database}</div>
                  <input
                    value={dialog.confirmName}
                    onChange={(e) => onChange({ confirmName: e.target.value })}
                    className="w-full bg-app-input border border-app-border rounded px-2 py-1.5 text-text-primary focus:outline-none focus:border-accent-blue"
                    placeholder={dialog.database}
                  />
                </div>
              </>
            )}

            {dialog.type === 'charset' && (
              <>
                <div className="text-text-muted">目标数据库：{dialog.database}</div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div className="mb-1 text-text-muted">字符集</div>
                    <input
                      value={dialog.charset}
                      onChange={(e) => onChange({ charset: e.target.value })}
                      className="w-full bg-app-input border border-app-border rounded px-2 py-1.5 text-text-primary focus:outline-none focus:border-accent-blue"
                      placeholder="utf8mb4"
                    />
                  </div>
                  <div>
                    <div className="mb-1 text-text-muted">排序规则（可选）</div>
                    <input
                      value={dialog.collation}
                      onChange={(e) => onChange({ collation: e.target.value })}
                      className="w-full bg-app-input border border-app-border rounded px-2 py-1.5 text-text-primary focus:outline-none focus:border-accent-blue"
                      placeholder="utf8mb4_general_ci"
                    />
                  </div>
                </div>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={dialog.applyToAllTables}
                    onChange={(e) => onChange({ applyToAllTables: e.target.checked })}
                  />
                  <span>同时转换该库所有数据表字段字符集</span>
                </label>
              </>
            )}

            {dialog.type === 'createTable' && (
              <>
                <div className="text-text-muted">目标数据库：{dialog.database}</div>
                <div>
                  <div className="mb-1 text-text-muted">数据表名</div>
                  <input
                    value={dialog.tableName}
                    onChange={(e) => onChange({ tableName: e.target.value })}
                    className="w-full bg-app-input border border-app-border rounded px-2 py-1.5 text-text-primary focus:outline-none focus:border-accent-blue"
                    placeholder="例如：users"
                  />
                </div>
                <div className="text-2xs text-text-muted">
                  将创建一个默认主键字段 id，你可以随后在表设计器中继续调整字段与索引。
                </div>
              </>
            )}

            {dialog.type === 'message' && (
              <div className="text-text-secondary whitespace-pre-wrap">{dialog.message}</div>
            )}
          </div>

          <div className="px-4 py-3 border-t border-app-border flex items-center justify-end gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded border border-app-border text-text-secondary hover:text-text-primary hover:border-accent-blue transition-colors text-xs"
              disabled={submitting}
            >
              {isMessage ? '关闭' : '取消'}
            </button>
            {!isMessage && (
              <button
                onClick={onSubmit}
                disabled={!canSubmit || submitting}
                className="px-3 py-1.5 rounded bg-accent-blue text-white hover:bg-blue-600 transition-colors text-xs disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {submitting ? '处理中...' : '确认'}
              </button>
            )}
          </div>
        </div>
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
  filter,
  onDropDatabase,
  onCreateTable,
  onAlterCharset
}: {
  db: { name: string; tables: SchemaTable[] }
  depth: number
  connectionId: string
  defaultExpanded: boolean
  filter: string
  onDropDatabase: (connectionId: string, database: string) => void
  onCreateTable: (connectionId: string, database: string) => void
  onAlterCharset: (connectionId: string, database: string) => void
}): JSX.Element {
  const hasFilter = filter.trim().length > 0
  const visibleTables = hasFilter
    ? db.tables.filter((t) => t.name.toLowerCase().includes(filter.toLowerCase()))
    : db.tables

  // Auto-expand when searching
  const [manualExpanded, setManualExpanded] = useState(defaultExpanded)
  const expanded = hasFilter ? visibleTables.length > 0 : manualExpanded

  const [contextMenu, setContextMenu] = useState<CtxMenu | null>(null)
  const [dbContextMenu, setDbContextMenu] = useState<DbCtxMenu | null>(null)
  const [designer, setDesigner] = useState<SchemaTable | null>(null)

  const handleCtx = (e: React.MouseEvent, table: SchemaTable): void => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, table, connectionId, database: db.name })
  }

  const handleDbCtx = (e: React.MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    setDbContextMenu({ x: e.clientX, y: e.clientY, connectionId, database: db.name })
  }

  if (hasFilter && visibleTables.length === 0) return <></>

  return (
    <div>
      <button
        onClick={() => setManualExpanded((v) => !v)}
        onContextMenu={handleDbCtx}
        style={{ paddingLeft: `${depth * 12 + 12}px` }}
        className="w-full flex items-center gap-1 py-0.5 pr-3 text-xs text-text-secondary hover:text-text-primary hover:bg-app-hover transition-colors"
        title="右键数据库可进行管理操作"
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
      {dbContextMenu && (
        <DatabaseContextMenu
          menu={dbContextMenu}
          onClose={() => setDbContextMenu(null)}
          onDropDatabase={onDropDatabase}
          onCreateTable={onCreateTable}
          onAlterCharset={onAlterCharset}
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
  filter,
  onCreateDatabase,
  onCreateTable,
  onDropDatabase,
  onAlterCharset
}: {
  connectionId: string
  connectionName: string
  databases: { name: string; tables: SchemaTable[] }[]
  isActive: boolean
  filter: string
  onCreateDatabase: (connectionId: string) => void
  onCreateTable: (connectionId: string, database: string) => void
  onDropDatabase: (connectionId: string, database: string) => void
  onAlterCharset: (connectionId: string, database: string) => void
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
        <span
          className="ml-auto p-0.5 rounded text-text-muted hover:text-text-primary hover:bg-app-hover"
          title="新建数据库"
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation()
            onCreateDatabase(connectionId)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              e.stopPropagation()
              onCreateDatabase(connectionId)
            }
          }}
        >
          <Plus size={11} />
        </span>
      </button>
      {expanded && databases.map((db) => (
        <DatabaseNode
          key={db.name}
          db={db}
          depth={1}
          connectionId={connectionId}
          defaultExpanded={databases.length === 1}
          filter={filter}
          onDropDatabase={onDropDatabase}
          onCreateTable={onCreateTable}
          onAlterCharset={onAlterCharset}
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
  const [dialog, setDialog] = useState<SchemaDialog>({ type: 'none' })
  const [submitting, setSubmitting] = useState(false)

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

  const handleCreateDatabase = async (connectionId: string): Promise<void> => {
    setDialog({
      type: 'create',
      connectionId,
      name: '',
      charset: 'utf8mb4',
      collation: 'utf8mb4_general_ci'
    })
  }

  const handleDropDatabase = async (connectionId: string, database: string): Promise<void> => {
    setDialog({ type: 'drop', connectionId, database, confirmName: '' })
  }

  const handleAlterDatabaseCharset = async (connectionId: string, database: string): Promise<void> => {
    setDialog({
      type: 'charset',
      connectionId,
      database,
      charset: 'utf8mb4',
      collation: 'utf8mb4_general_ci',
      applyToAllTables: true
    })
  }

  const handleCreateTable = async (connectionId: string, database: string): Promise<void> => {
    setDialog({
      type: 'createTable',
      connectionId,
      database,
      tableName: ''
    })
  }

  const handleDialogChange = (patch: Record<string, string | boolean>): void => {
    setDialog((prev) => {
      if (prev.type === 'none' || prev.type === 'message') return prev
      return { ...prev, ...patch }
    })
  }

  const handleDialogSubmit = async (): Promise<void> => {
    if (!window.db || dialog.type === 'none' || dialog.type === 'message') return

    setSubmitting(true)
    try {
      if (dialog.type === 'create') {
        await window.db.createDatabase(
          dialog.connectionId,
          dialog.name.trim(),
          dialog.charset.trim() || undefined,
          dialog.collation.trim() || undefined
        )
        await loadSchema(dialog.connectionId)
      }

      if (dialog.type === 'drop') {
        await window.db.dropDatabase(dialog.connectionId, dialog.database)
        await loadSchema(dialog.connectionId)
      }

      if (dialog.type === 'charset') {
        await window.db.alterDatabaseCharset(
          dialog.connectionId,
          dialog.database,
          dialog.charset.trim(),
          dialog.collation.trim() || undefined,
          dialog.applyToAllTables
        )
        await loadSchema(dialog.connectionId)
      }

      if (dialog.type === 'createTable') {
        const conn = connections.find((c) => c.id === dialog.connectionId)
        const dbType = conn?.type ?? 'mysql'
        const sql = buildCreateTableSQL(dialog.tableName.trim(), dbType)
        await window.db.executeQuery(dialog.connectionId, sql, dialog.database)
        await loadSchema(dialog.connectionId)
      }

      setDialog({ type: 'none' })
    } catch (err) {
      setDialog({
        type: 'message',
        title: '操作失败',
        message: err instanceof Error ? err.message : String(err)
      })
    } finally {
      setSubmitting(false)
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
            onCreateDatabase={handleCreateDatabase}
            onCreateTable={handleCreateTable}
            onDropDatabase={handleDropDatabase}
            onAlterCharset={handleAlterDatabaseCharset}
          />
        )
      })}

      <SchemaActionDialog
        dialog={dialog}
        submitting={submitting}
        onClose={() => !submitting && setDialog({ type: 'none' })}
        onChange={handleDialogChange}
        onSubmit={handleDialogSubmit}
      />
    </div>
  )
}
