import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { X, Plus, Trash2, RefreshCw, Play, Check, AlertTriangle } from 'lucide-react'
import { clsx } from 'clsx'
import type { SchemaColumn } from '@shared/types/query'

// ── Internal types ───────────────────────────────────────────

interface IndexInfo {
  name: string
  columns: string[]
  unique: boolean
  primary: boolean
}

interface ColumnDraft {
  _id: string
  name: string
  baseType: string      // e.g. 'VARCHAR', 'INT'
  length: string        // e.g. '255' or '10,2' or ''
  primaryKey: boolean
  nullable: boolean
  autoIncrement: boolean
  defaultValue: string
  _origName: string     // original name (for CHANGE COLUMN detection)
  _isNew: boolean
  _isDeleted: boolean
}

interface IndexDraft {
  _id: string
  name: string
  columns: string[]
  type: 'INDEX' | 'UNIQUE'
  _isNew: boolean
  _isDeleted: boolean
  _isPrimary: boolean
}

// ── Helpers ──────────────────────────────────────────────────

function parseType(typeStr: string): { baseType: string; length: string } {
  const m = typeStr.match(/^([^(]+)\(([^)]+)\)$/)
  if (m) return { baseType: m[1].trim().toUpperCase(), length: m[2].trim() }
  return { baseType: typeStr.trim().toUpperCase(), length: '' }
}

function buildType(baseType: string, length: string): string {
  const t = (baseType || 'VARCHAR').trim().toUpperCase()
  const l = length.trim()
  return l ? `${t}(${l})` : t
}

function colToSQL(col: ColumnDraft): string {
  const q = (s: string): string => `\`${s}\``
  const parts: string[] = [q(col.name), buildType(col.baseType, col.length)]
  if (col.primaryKey) {
    parts.push('NOT NULL')
    if (col.autoIncrement) parts.push('AUTO_INCREMENT')
    parts.push('PRIMARY KEY')
  } else {
    if (!col.nullable) parts.push('NOT NULL')
    if (col.defaultValue !== '') parts.push(`DEFAULT '${col.defaultValue}'`)
  }
  return parts.join(' ')
}

function generateAlterSQL(
  tbl: string,
  db: string,
  origCols: ColumnDraft[],
  draftCols: ColumnDraft[],
  origIdxs: IndexDraft[],
  draftIdxs: IndexDraft[]
): string {
  const stmts: string[] = []
  const q = (s: string): string => `\`${s}\``
  const tblRef = db ? `${q(db)}.${q(tbl)}` : q(tbl)

  // Drop columns marked as deleted (that existed originally)
  draftCols
    .filter((c) => c._isDeleted && !c._isNew)
    .forEach((c) => stmts.push(`ALTER TABLE ${tblRef} DROP COLUMN ${q(c._origName)};`))

  // Add new columns
  draftCols
    .filter((c) => c._isNew && !c._isDeleted)
    .forEach((c) => stmts.push(`ALTER TABLE ${tblRef}\n  ADD COLUMN ${colToSQL(c)};`))

  // Modify existing columns
  draftCols
    .filter((c) => !c._isNew && !c._isDeleted)
    .forEach((c) => {
      const orig = origCols.find((o) => o._origName === c._origName)
      if (!orig) return
      const sig = (d: ColumnDraft): string =>
        [d.name, buildType(d.baseType, d.length), d.nullable, d.primaryKey, d.autoIncrement, d.defaultValue].join('|')
      if (sig(orig) !== sig(c)) {
        stmts.push(`ALTER TABLE ${tblRef}\n  CHANGE COLUMN ${q(c._origName)} ${colToSQL(c)};`)
      }
    })

  // Drop indexes marked as deleted
  draftIdxs
    .filter((i) => i._isDeleted && !i._isNew && !i._isPrimary)
    .forEach((i) => stmts.push(`DROP INDEX ${q(i.name)} ON ${tblRef};`))

  // Add new indexes
  draftIdxs
    .filter((i) => i._isNew && !i._isDeleted)
    .forEach((i) => {
      const prefix = i.type === 'UNIQUE' ? 'UNIQUE ' : ''
      stmts.push(
        `CREATE ${prefix}INDEX ${q(i.name)} ON ${tblRef} (${i.columns.map(q).join(', ')});`
      )
    })

  return stmts.length > 0 ? stmts.join('\n') : '-- 无变更'
}

// ── Cell input style ─────────────────────────────────────────
const cell =
  'bg-transparent border border-transparent hover:border-app-border focus:border-accent-blue focus:bg-app-input rounded px-1.5 py-0.5 text-xs text-text-primary focus:outline-none transition-colors w-full'

// ── Main Component ────────────────────────────────────────────

interface TableDesignerProps {
  connectionId: string
  table: string
  database: string
  onClose: () => void
}

type LeftTab = 'columns' | 'indexes'
type RightTab = 'ddl' | 'changes'

export function TableDesigner({ connectionId, table, database, onClose }: TableDesignerProps): JSX.Element {
  const [leftTab, setLeftTab] = useState<LeftTab>('columns')
  const [rightTab, setRightTab] = useState<RightTab>('ddl')
  const [origCols, setOrigCols] = useState<ColumnDraft[]>([])
  const [draftCols, setDraftCols] = useState<ColumnDraft[]>([])
  const [origIdxs, setOrigIdxs] = useState<IndexDraft[]>([])
  const [draftIdxs, setDraftIdxs] = useState<IndexDraft[]>([])
  const [ddl, setDdl] = useState('')
  const [loading, setLoading] = useState(true)
  const [applying, setApplying] = useState(false)
  const [applyResult, setApplyResult] = useState<{ ok: boolean; msg: string } | null>(null)

  // New index form
  const [newIdxName, setNewIdxName] = useState('')
  const [newIdxType, setNewIdxType] = useState<'INDEX' | 'UNIQUE'>('INDEX')
  const [newIdxCols, setNewIdxCols] = useState<Set<string>>(new Set())

  const schemaToColumnDraft = (c: SchemaColumn): ColumnDraft => {
    const { baseType, length } = parseType(c.type)
    return {
      _id: crypto.randomUUID(),
      name: c.name,
      baseType,
      length,
      primaryKey: c.primaryKey,
      nullable: c.nullable,
      autoIncrement: false,
      defaultValue: c.defaultValue ?? '',
      _origName: c.name,
      _isNew: false,
      _isDeleted: false,
    }
  }

  const loadData = useCallback(async () => {
    if (!window.db) return
    setLoading(true)
    setApplyResult(null)
    try {
      const [cols, idxs, tableDdl] = await Promise.all([
        window.db.getTableColumns(connectionId, table, database),
        window.db.getTableIndexes(connectionId, table, database),
        window.db.getTableDDL(connectionId, table, database),
      ])
      const colDrafts = cols.map(schemaToColumnDraft)
      setOrigCols(colDrafts.map((c) => ({ ...c })))
      setDraftCols(colDrafts.map((c) => ({ ...c })))
      const idxDrafts: IndexDraft[] = idxs.map((ix) => ({
        _id: crypto.randomUUID(),
        name: ix.name,
        columns: ix.columns,
        type: ix.unique || ix.primary ? 'UNIQUE' : 'INDEX',
        _isNew: false,
        _isDeleted: false,
        _isPrimary: ix.primary,
      }))
      setOrigIdxs(idxDrafts.map((i) => ({ ...i })))
      setDraftIdxs(idxDrafts.map((i) => ({ ...i })))
      setDdl(tableDdl)
    } finally {
      setLoading(false)
    }
  }, [connectionId, table, database])

  useEffect(() => {
    loadData()
  }, [loadData])

  const changeSQL = generateAlterSQL(table, database, origCols, draftCols, origIdxs, draftIdxs)
  const hasChanges = changeSQL !== '-- 无变更'

  // Column helpers
  const updateCol = (id: string, patch: Partial<ColumnDraft>): void =>
    setDraftCols((prev) => prev.map((c) => (c._id === id ? { ...c, ...patch } : c)))

  const addColumn = (): void => {
    setDraftCols((prev) => [
      ...prev,
      {
        _id: crypto.randomUUID(),
        name: `field_${prev.length + 1}`,
        baseType: 'VARCHAR',
        length: '255',
        primaryKey: false,
        nullable: true,
        autoIncrement: false,
        defaultValue: '',
        _origName: '',
        _isNew: true,
        _isDeleted: false,
      },
    ])
  }

  const deleteCol = (id: string): void => {
    setDraftCols((prev) =>
      prev
        .map((c) => {
          if (c._id !== id) return c
          if (c._isNew) return null           // remove newly-added rows entirely
          return { ...c, _isDeleted: !c._isDeleted }  // toggle existing rows
        })
        .filter(Boolean) as ColumnDraft[]
    )
  }

  // Index helpers
  const deleteIdx = (id: string): void => {
    setDraftIdxs((prev) =>
      prev
        .map((i) => {
          if (i._id !== id) return i
          if (i._isNew) return null
          return { ...i, _isDeleted: !i._isDeleted }
        })
        .filter(Boolean) as IndexDraft[]
    )
  }

  const addIndex = (): void => {
    if (!newIdxName.trim() || newIdxCols.size === 0) return
    setDraftIdxs((prev) => [
      ...prev,
      {
        _id: crypto.randomUUID(),
        name: newIdxName.trim(),
        columns: Array.from(newIdxCols),
        type: newIdxType,
        _isNew: true,
        _isDeleted: false,
        _isPrimary: false,
      },
    ])
    setNewIdxName('')
    setNewIdxCols(new Set())
  }

  const applyChanges = async (): Promise<void> => {
    if (!hasChanges || !window.db) return
    const stmts = changeSQL
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s && !s.startsWith('--'))
      .join(' ')
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s + ';')

    setApplying(true)
    setApplyResult(null)
    try {
      for (const stmt of stmts) {
        await window.db.executeQuery(connectionId, stmt, database)
      }
      setApplyResult({ ok: true, msg: `成功执行 ${stmts.length} 条语句，已刷新` })
      await loadData()
    } catch (err) {
      setApplyResult({ ok: false, msg: err instanceof Error ? err.message : String(err) })
    } finally {
      setApplying(false)
    }
  }

  const activeCols = draftCols.filter((c) => !c._isDeleted)
  const activeIdxs = draftIdxs.filter((i) => !i._isDeleted)
  const colNames = activeCols.map((c) => c.name).filter(Boolean)

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div
        className="bg-app-bg border border-app-border rounded-lg shadow-2xl flex flex-col"
        style={{ width: '90vw', height: '85vh', maxWidth: 1200, maxHeight: 800 }}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-app-border shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-text-primary">设计表</span>
            <span className="text-xs text-text-muted bg-app-hover px-2 py-0.5 rounded font-mono">
              {database}.{table}
            </span>
            {hasChanges && (
              <span className="text-2xs text-accent-yellow bg-yellow-900/30 px-1.5 py-0.5 rounded">
                有未保存的变更
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {hasChanges && (
              <button
                onClick={applyChanges}
                disabled={applying}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-accent-blue text-white hover:bg-blue-600 disabled:opacity-50 transition-colors"
              >
                <Play size={11} />
                {applying ? '执行中...' : '执行变更'}
              </button>
            )}
            <button
              onClick={loadData}
              title="刷新"
              className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-app-hover transition-colors"
            >
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={onClose}
              className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-app-hover transition-colors"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Apply result banner */}
        {applyResult && (
          <div
            className={clsx(
              'px-4 py-2 text-xs flex items-center gap-2 shrink-0',
              applyResult.ok ? 'bg-green-900/20 text-accent-green' : 'bg-red-900/20 text-accent-red'
            )}
          >
            {applyResult.ok ? <Check size={12} /> : <AlertTriangle size={12} />}
            {applyResult.msg}
          </div>
        )}

        {/* ── Body ── */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left: editable panels */}
          <div className="flex flex-col border-r border-app-border" style={{ width: '62%' }}>
            <div className="flex border-b border-app-border shrink-0">
              {(['columns', 'indexes'] as LeftTab[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setLeftTab(t)}
                  className={clsx(
                    'px-4 py-2 text-xs font-medium transition-colors',
                    leftTab === t
                      ? 'text-accent-blue border-b-2 border-accent-blue'
                      : 'text-text-secondary hover:text-text-primary'
                  )}
                >
                  {t === 'columns' ? `字段 (${activeCols.length})` : `索引 (${activeIdxs.length})`}
                </button>
              ))}
            </div>

            {loading ? (
              <div className="flex-1 flex items-center justify-center text-text-muted text-xs">
                加载中...
              </div>
            ) : leftTab === 'columns' ? (
              <ColumnsEditor cols={draftCols} onUpdate={updateCol} onDelete={deleteCol} onAdd={addColumn} />
            ) : (
              <IndexesEditor
                idxs={draftIdxs}
                colNames={colNames}
                onDelete={deleteIdx}
                newName={newIdxName}
                onNewName={setNewIdxName}
                newType={newIdxType}
                onNewType={setNewIdxType}
                newCols={newIdxCols}
                onNewCols={setNewIdxCols}
                onAdd={addIndex}
              />
            )}
          </div>

          {/* Right: DDL / Changes */}
          <div className="flex flex-col flex-1 overflow-hidden">
            <div className="flex border-b border-app-border shrink-0">
              {(['ddl', 'changes'] as RightTab[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setRightTab(t)}
                  className={clsx(
                    'px-4 py-2 text-xs font-medium transition-colors',
                    rightTab === t
                      ? 'text-accent-blue border-b-2 border-accent-blue'
                      : 'text-text-secondary hover:text-text-primary'
                  )}
                >
                  {t === 'ddl' ? (
                    '当前 DDL'
                  ) : (
                    <span className="flex items-center gap-1.5">
                      变更 SQL
                      {hasChanges && (
                        <span className="w-1.5 h-1.5 rounded-full bg-accent-yellow inline-block" />
                      )}
                    </span>
                  )}
                </button>
              ))}
            </div>
            <pre className="flex-1 overflow-auto p-3 text-xs font-mono text-text-secondary leading-relaxed whitespace-pre-wrap break-words">
              {rightTab === 'ddl' ? ddl || '-- 加载中...' : changeSQL}
            </pre>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

// ── Columns Editor ────────────────────────────────────────────

function ColumnsEditor({
  cols,
  onUpdate,
  onDelete,
  onAdd,
}: {
  cols: ColumnDraft[]
  onUpdate: (id: string, patch: Partial<ColumnDraft>) => void
  onDelete: (id: string) => void
  onAdd: () => void
}): JSX.Element {
  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 bg-app-sidebar z-10">
            <tr className="border-b border-app-border">
              <th className="text-center px-2 py-2 text-text-muted font-medium w-7">#</th>
              <th className="text-left px-2 py-2 text-text-muted font-medium min-w-[100px]">字段名</th>
              <th className="text-left px-2 py-2 text-text-muted font-medium min-w-[80px]">类型</th>
              <th className="text-left px-2 py-2 text-text-muted font-medium w-[60px]">长度</th>
              <th className="text-center px-1 py-2 text-text-muted font-medium w-9">主键</th>
              <th className="text-center px-1 py-2 text-text-muted font-medium w-9">非空</th>
              <th className="text-center px-1 py-2 text-text-muted font-medium w-9">AI</th>
              <th className="text-left px-2 py-2 text-text-muted font-medium min-w-[70px]">默认值</th>
              <th className="w-7" />
            </tr>
          </thead>
          <tbody>
            {cols.map((col, i) => (
              <tr
                key={col._id}
                className={clsx(
                  'border-b border-app-border/30 transition-colors',
                  col._isDeleted
                    ? 'opacity-40 bg-red-900/10'
                    : col._isNew
                      ? 'bg-green-900/10'
                      : 'hover:bg-app-hover/30'
                )}
              >
                <td className="px-1 py-1 text-center text-text-muted text-2xs">{i + 1}</td>
                <td className="px-1 py-0.5">
                  <input
                    value={col.name}
                    onChange={(e) => onUpdate(col._id, { name: e.target.value })}
                    disabled={col._isDeleted}
                    className={clsx(cell, col.primaryKey ? 'text-accent-yellow font-medium' : '')}
                  />
                </td>
                <td className="px-1 py-0.5">
                  <input
                    value={col.baseType}
                    onChange={(e) => onUpdate(col._id, { baseType: e.target.value.toUpperCase() })}
                    disabled={col._isDeleted}
                    className={clsx(cell, 'font-mono text-accent-blue text-2xs')}
                    list="td-col-types"
                  />
                </td>
                <td className="px-1 py-0.5">
                  <input
                    value={col.length}
                    onChange={(e) => onUpdate(col._id, { length: e.target.value })}
                    disabled={col._isDeleted}
                    placeholder="—"
                    className={clsx(cell, 'font-mono text-text-muted text-2xs')}
                  />
                </td>
                <td className="px-1 py-1 text-center">
                  <input
                    type="checkbox"
                    checked={col.primaryKey}
                    onChange={(e) => onUpdate(col._id, { primaryKey: e.target.checked })}
                    disabled={col._isDeleted}
                    className="accent-accent-yellow cursor-pointer"
                  />
                </td>
                <td className="px-1 py-1 text-center">
                  <input
                    type="checkbox"
                    checked={!col.nullable && !col.primaryKey}
                    onChange={(e) => onUpdate(col._id, { nullable: !e.target.checked })}
                    disabled={col._isDeleted || col.primaryKey}
                    className="accent-accent-red cursor-pointer"
                  />
                </td>
                <td className="px-1 py-1 text-center">
                  <input
                    type="checkbox"
                    checked={col.autoIncrement}
                    onChange={(e) => onUpdate(col._id, { autoIncrement: e.target.checked })}
                    disabled={col._isDeleted}
                    className="accent-accent-blue cursor-pointer"
                  />
                </td>
                <td className="px-1 py-0.5">
                  <input
                    value={col.defaultValue}
                    onChange={(e) => onUpdate(col._id, { defaultValue: e.target.value })}
                    disabled={col._isDeleted}
                    placeholder="NULL"
                    className={clsx(cell, 'font-mono text-text-muted text-2xs')}
                  />
                </td>
                <td className="px-1 py-0.5 text-center">
                  <button
                    onClick={() => onDelete(col._id)}
                    title={col._isDeleted ? '撤销删除' : '标记删除'}
                    className={clsx(
                      'p-0.5 rounded transition-colors',
                      col._isDeleted
                        ? 'text-accent-green hover:text-text-primary'
                        : 'text-text-muted hover:text-accent-red'
                    )}
                  >
                    <Trash2 size={11} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Common SQL types datalist */}
        <datalist id="td-col-types">
          {[
            'INT', 'BIGINT', 'SMALLINT', 'TINYINT', 'DECIMAL', 'FLOAT', 'DOUBLE',
            'VARCHAR', 'CHAR', 'TEXT', 'MEDIUMTEXT', 'LONGTEXT',
            'DATETIME', 'TIMESTAMP', 'DATE', 'TIME',
            'BOOLEAN', 'TINYINT', 'JSON', 'BLOB', 'MEDIUMBLOB',
          ].map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>

        {cols.length === 0 && (
          <div className="p-6 text-center text-text-muted text-xs">
            暂无字段，点击下方按钮新增
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-app-border p-2">
        <button
          onClick={onAdd}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-app-border text-text-secondary hover:text-text-primary hover:border-accent-blue transition-colors"
        >
          <Plus size={12} />
          新增字段
        </button>
      </div>
    </div>
  )
}

// ── Indexes Editor ────────────────────────────────────────────

function IndexesEditor({
  idxs,
  colNames,
  onDelete,
  newName,
  onNewName,
  newType,
  onNewType,
  newCols,
  onNewCols,
  onAdd,
}: {
  idxs: IndexDraft[]
  colNames: string[]
  onDelete: (id: string) => void
  newName: string
  onNewName: (v: string) => void
  newType: 'INDEX' | 'UNIQUE'
  onNewType: (v: 'INDEX' | 'UNIQUE') => void
  newCols: Set<string>
  onNewCols: (v: Set<string>) => void
  onAdd: () => void
}): JSX.Element {
  const toggleCol = (col: string): void => {
    const next = new Set(newCols)
    if (next.has(col)) next.delete(col)
    else next.add(col)
    onNewCols(next)
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-app-sidebar border-b border-app-border">
            <tr>
              <th className="text-left px-3 py-2 text-text-muted font-medium">索引名</th>
              <th className="text-left px-3 py-2 text-text-muted font-medium">字段</th>
              <th className="text-left px-3 py-2 text-text-muted font-medium w-20">类型</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {idxs.map((idx) => (
              <tr
                key={idx._id}
                className={clsx(
                  'border-b border-app-border/30 transition-colors',
                  idx._isDeleted
                    ? 'opacity-40 bg-red-900/10'
                    : idx._isNew
                      ? 'bg-green-900/10'
                      : 'hover:bg-app-hover/30'
                )}
              >
                <td className="px-3 py-1.5 font-mono text-text-primary">{idx.name}</td>
                <td className="px-3 py-1.5">
                  <div className="flex flex-wrap gap-1">
                    {idx.columns.map((c) => (
                      <span
                        key={c}
                        className="bg-app-hover px-1.5 py-0.5 rounded text-text-secondary font-mono text-2xs"
                      >
                        {c}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-3 py-1.5">
                  {idx._isPrimary ? (
                    <span className="text-2xs bg-yellow-900/40 text-accent-yellow px-1.5 py-0.5 rounded font-medium">
                      PRIMARY
                    </span>
                  ) : idx.type === 'UNIQUE' ? (
                    <span className="text-2xs bg-blue-900/40 text-accent-blue px-1.5 py-0.5 rounded font-medium">
                      UNIQUE
                    </span>
                  ) : (
                    <span className="text-2xs bg-app-hover text-text-muted px-1.5 py-0.5 rounded">
                      INDEX
                    </span>
                  )}
                </td>
                <td className="px-1 py-1 text-center">
                  {!idx._isPrimary && (
                    <button
                      onClick={() => onDelete(idx._id)}
                      title={idx._isDeleted ? '撤销删除' : '标记删除'}
                      className={clsx(
                        'p-0.5 rounded transition-colors',
                        idx._isDeleted
                          ? 'text-accent-green hover:text-text-primary'
                          : 'text-text-muted hover:text-accent-red'
                      )}
                    >
                      <Trash2 size={11} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {idxs.length === 0 && (
          <div className="p-4 text-center text-text-muted text-xs">暂无索引</div>
        )}
      </div>

      {/* New index form */}
      <div className="shrink-0 border-t border-app-border p-3 space-y-2">
        <div className="text-2xs text-text-muted font-medium uppercase tracking-wider">新增索引</div>
        <div className="flex gap-2">
          <input
            value={newName}
            onChange={(e) => onNewName(e.target.value)}
            placeholder="索引名称"
            className="flex-1 bg-app-input border border-app-border rounded px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-accent-blue transition-colors"
          />
          <select
            value={newType}
            onChange={(e) => onNewType(e.target.value as 'INDEX' | 'UNIQUE')}
            className="bg-app-input border border-app-border rounded px-2 py-1 text-xs text-text-secondary focus:outline-none focus:border-accent-blue transition-colors"
          >
            <option value="INDEX">INDEX</option>
            <option value="UNIQUE">UNIQUE</option>
          </select>
        </div>
        {colNames.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {colNames.map((c) => (
              <label key={c} className="flex items-center gap-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={newCols.has(c)}
                  onChange={() => toggleCol(c)}
                  className="accent-accent-blue"
                />
                <span className="text-xs text-text-secondary font-mono">{c}</span>
              </label>
            ))}
          </div>
        )}
        <button
          onClick={onAdd}
          disabled={!newName.trim() || newCols.size === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-app-border text-text-secondary hover:text-text-primary hover:border-accent-blue disabled:opacity-40 transition-colors"
        >
          <Plus size={12} />
          添加索引
        </button>
      </div>
    </div>
  )
}
