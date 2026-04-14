import { useRef, useCallback, useState, useEffect } from 'react'
import MonacoEditor, { type OnMount } from '@monaco-editor/react'
import { KeyMod, KeyCode, languages, type editor, type IDisposable } from 'monaco-editor'
import { Play, Loader2, ChevronDown, Download, AlignLeft, Minimize2 } from 'lucide-react'
import { format as formatSQL } from 'sql-formatter'
import { clsx } from 'clsx'
import { useQueryStore } from '@renderer/stores/queryStore'
import { useConnectionStore } from '@renderer/stores/connectionStore'
import { usePrefsStore } from '@renderer/stores/prefsStore'

type TableColumnEntry = {
  table: string
  database: string
  columns: Array<{ name: string; type: string }>
}

export function QueryEditor(): JSX.Element {
  const { tabs, activeTabId, updateTabSQL, updateTabConnection, updateTabDatabase, loadSchema } = useQueryStore()
  const { connections, statuses } = useConnectionStore()
  const { fontSize, theme } = usePrefsStore()
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const completionDisposableRef = useRef<IDisposable | null>(null)
  const completionSuggestionsRef = useRef<Array<Omit<languages.CompletionItem, 'range'>>>([])
  const tableColumnsRef = useRef<TableColumnEntry[]>([])
  // alias → columns 专属缓存：alias 名 → 字段数组，直接用于补全查询
  const aliasColumnsRef = useRef<Map<string, Array<{ name: string; type: string }>>>(new Map())
  // alias → tableName 映射：用于检测表名是否发生变化，变化时使字段缓存失效
  const aliasTableRef = useRef<Map<string, string>>(new Map())
  const activeTabIdRef = useRef<string | null>(activeTabId)
  activeTabIdRef.current = activeTabId

  const [showConnPicker, setShowConnPicker] = useState(false)
  const [showDbPicker, setShowDbPicker] = useState(false)
  const [availableDbs, setAvailableDbs] = useState<string[]>([])

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null
  const connection = activeTab?.connectionId
    ? connections.find((c) => c.id === activeTab.connectionId)
    : null
  const isConnected = connection
    ? (statuses[connection.id] ?? 'disconnected') === 'connected'
    : false

  const connectedConnections = connections.filter(
    (c) => (statuses[c.id] ?? 'disconnected') === 'connected'
  )

  const editorFontSize = fontSize === 'small' ? 12 : fontSize === 'large' ? 16 : 14

  const handleRun = useCallback((): void => {
    const tabId = activeTabIdRef.current
    if (!tabId) return

    const selection = editorRef.current?.getSelection()
    const model = editorRef.current?.getModel()
    const selectedSql =
      selection && model && !selection.isEmpty()
        ? model.getValueInRange(selection).trim()
        : undefined

    useQueryStore.getState().executeQuery(tabId, selectedSql)
  }, [])

  const handleFormatSQL = (): void => {
    if (!activeTabId || !activeTab?.sql.trim()) return
    try {
      const formatted = formatSQL(activeTab.sql, { language: 'sql', tabWidth: 2, keywordCase: 'upper' })
      updateTabSQL(activeTabId, formatted)
      editorRef.current?.setValue(formatted)
    } catch {
      // 格式化失败时保持原样
    }
  }

  const handleCompressSQL = (): void => {
    if (!activeTabId || !activeTab?.sql.trim()) return
    const compressed = activeTab.sql
      .replace(/--[^\n]*/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\s+/g, ' ')
      .trim()
    updateTabSQL(activeTabId, compressed)
    editorRef.current?.setValue(compressed)
  }

  const handleSaveSQL = (): void => {
    if (!activeTab?.sql.trim()) return
    const blob = new Blob([activeTab.sql], { type: 'text/sql;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${sanitizeFileName(activeTab.title || 'query')}.sql`
    link.click()
    URL.revokeObjectURL(url)
  }

  const handleMount: OnMount = (ed, monaco) => {
    editorRef.current = ed
    ed.addCommand(KeyMod.CtrlCmd | KeyCode.Enter, () => handleRun())
    ed.addCommand(KeyCode.F5, () => handleRun())

    completionDisposableRef.current?.dispose()
    completionDisposableRef.current = monaco.languages.registerCompletionItemProvider('sql', {
      triggerCharacters: ['.'],
      provideCompletionItems: (model, position) => {
        const word = model.getWordUntilPosition(position)
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn
        }
        const textUntilCursor = model.getValueInRange({
          startLineNumber: 1,
          startColumn: 1,
          endLineNumber: position.lineNumber,
          endColumn: position.column
        })

        const qualifier = resolveTypedQualifier(textUntilCursor)
        if (qualifier) {
          const qKey = qualifier.toLowerCase()

          // 1) 先查 alias 专属缓存（已经加载过）
          let cols = aliasColumnsRef.current.get(qKey)

          // 2) 缓存没有时，内联解析当前 SQL 找到别名对应的表，再从 tableColumnsRef 同步查
          if (!cols) {
            const statement = getCurrentSqlStatement(model.getValue())
            const tableAliases = parseTableAliases(statement)
            const rawTable = tableAliases[qKey]
            if (rawTable) {
              const normalized = normalizeSqlIdentifier(rawTable).replace(/\s*\.\s*/g, '.')
              const parts = normalized.split('.')
              const tableName = normalizeSqlIdentifier(parts[parts.length - 1])
              if (tableName) {
                // 从 tableColumnsRef（连接时已预加载）里同步查
                const cached = tableColumnsRef.current.find(
                  (e) => normalizeSqlIdentifier(e.table).toLowerCase() === tableName.toLowerCase()
                )
                if (cached) {
                  aliasColumnsRef.current.set(qKey, cached.columns)
                  cols = cached.columns
                } else {
                  // tableColumnsRef 也没有（超大库），异步拉取后重新触发补全
                  const tab = useQueryStore.getState().tabs.find((t) => t.id === activeTabIdRef.current)
                  const connectionId = tab?.connectionId
                  if (connectionId && window.db) {
                    const targetDb = parts.length > 1
                      ? normalizeSqlIdentifier(parts[0])
                      : (tab?.selectedDatabase ?? undefined)
                    window.db.getTableColumns(connectionId, tableName, targetDb)
                      .then((columns) => {
                        if (columns.length > 0) {
                          aliasColumnsRef.current.set(qKey, columns)
                          tableColumnsRef.current = [
                            ...tableColumnsRef.current,
                            { table: tableName, database: targetDb ?? '', columns }
                          ]
                          // 重新触发补全弹窗
                          editorRef.current?.trigger('alias', 'editor.action.triggerSuggest', {})
                        }
                      })
                      .catch(() => {})
                  }
                }
              }
            }
          }

          if (cols && cols.length > 0) {
            return {
              suggestions: [...cols]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((col) => ({
                  label: `${qualifier}.${col.name}`,
                  kind: languages.CompletionItemKind.Field,
                  insertText: col.name,
                  detail: col.type,
                  documentation: `${col.name} · ${col.type}`,
                  range
                }))
            }
          }
        }

        // 兜底：全量建议（关键字 + 表名 + 字段）
        return {
          suggestions: completionSuggestionsRef.current.map((item) => ({ ...item, range }))
        }
      }
    })

    // 内容变化时同步更新 alias 缓存（仅增量更新，不 clear）
    let prefetchTimer: ReturnType<typeof setTimeout> | null = null
    ed.onDidChangeModelContent(() => {
      if (prefetchTimer) clearTimeout(prefetchTimer)
      prefetchTimer = setTimeout(() => {
        const sql = ed.getValue()
        const tabId = activeTabIdRef.current
        if (!tabId || !window.db) return
        const tab = useQueryStore.getState().tabs.find((t) => t.id === tabId)
        const connectionId = tab?.connectionId
        if (!connectionId) return

        const statement = getCurrentSqlStatement(sql)
        const tableAliases = parseTableAliases(statement) // { a: 'app_app', b: 'app_user' ... }

        // 移除已不存在的别名；同时检查别名对应的表名是否变化，变了则使字段缓存失效
        const currentAliases = new Set(Object.keys(tableAliases).map((k) => k.toLowerCase()))
        for (const key of aliasColumnsRef.current.keys()) {
          if (!currentAliases.has(key)) {
            aliasColumnsRef.current.delete(key)
            aliasTableRef.current.delete(key)
          }
        }

        void (async () => {
          for (const [alias, rawTable] of Object.entries(tableAliases)) {
            const qKey = alias.toLowerCase()
            const normalized = normalizeSqlIdentifier(rawTable).replace(/\s*\.\s*/g, '.')
            const parts = normalized.split('.')
            const tableName = normalizeSqlIdentifier(parts[parts.length - 1])
            if (!tableName) continue
            const tableKey = tableName.toLowerCase()

            // 表名变化时使旧缓存失效
            const prevTable = aliasTableRef.current.get(qKey)
            if (prevTable && prevTable !== tableKey) {
              aliasColumnsRef.current.delete(qKey)
              aliasTableRef.current.delete(qKey)
            }

            if (aliasColumnsRef.current.has(qKey)) continue // 表名未变且已缓存，跳过

            const targetDb = parts.length > 1
              ? normalizeSqlIdentifier(parts[0])
              : (tab?.selectedDatabase ?? undefined)

            const cached = tableColumnsRef.current.find(
              (e) => normalizeSqlIdentifier(e.table).toLowerCase() === tableName.toLowerCase()
            )
            if (cached) {
              aliasColumnsRef.current.set(qKey, cached.columns)
              aliasTableRef.current.set(qKey, tableName.toLowerCase())
              continue
            }

            const columns = await window.db!
              .getTableColumns(connectionId, tableName, targetDb)
              .catch(() => [])

            if (columns.length > 0) {
              aliasColumnsRef.current.set(qKey, columns)
              aliasTableRef.current.set(qKey, tableName.toLowerCase())
              tableColumnsRef.current = [
                ...tableColumnsRef.current,
                { table: tableName, database: targetDb ?? '', columns }
              ]
            }
          }
        })()
      }, 400)
    })
  }

  useEffect(() => {
    return () => completionDisposableRef.current?.dispose()
  }, [])

  const handleSelectConnection = (connId: string): void => {
    if (!activeTabId) return
    updateTabConnection(activeTabId, connId)
    setShowConnPicker(false)
  }

  const handleOpenDbPicker = async (): Promise<void> => {
    if (!activeTab?.connectionId || !window.db) return
    setShowDbPicker(true)
    try {
      const dbs = await window.db.getDatabases(activeTab.connectionId)
      setAvailableDbs(dbs)
    } catch {
      setAvailableDbs([])
    }
  }

  const handleSelectDb = (db: string): void => {
    if (!activeTabId) return
    updateTabDatabase(activeTabId, db)
    setShowDbPicker(false)
  }

  useEffect(() => {
    let cancelled = false

    const loadCompletions = async (): Promise<void> => {
      if (!activeTab?.connectionId || !window.db) {
        completionSuggestionsRef.current = baseSqlSuggestions()
        tableColumnsRef.current = []
        return
      }

      await loadSchema(activeTab.connectionId, activeTab.selectedDatabase ?? undefined)
      const schema = useQueryStore.getState().getSchema(activeTab.connectionId)
      const targetDatabases = (schema?.databases ?? []).filter((db) =>
        activeTab.selectedDatabase ? db.name === activeTab.selectedDatabase : true
      )

      const tableEntries = targetDatabases.flatMap((db) =>
        db.tables.map((table) => ({ database: db.name, table: table.name }))
      )

      const suggestions: Array<Omit<languages.CompletionItem, 'range'>> = [
        ...baseSqlSuggestions(),
        ...tableEntries.map((entry) => ({
          label: entry.table,
          kind: languages.CompletionItemKind.Class,
          insertText: entry.table,
          detail: `table · ${entry.database}`,
          documentation: `Table in ${entry.database}`
        }))
      ]

      if (tableEntries.length <= 200) {
        const columnLists = await Promise.all(
          tableEntries.map(async (entry) => ({
            ...entry,
            columns: await window.db!
              .getTableColumns(activeTab.connectionId!, entry.table, entry.database)
              .catch(() => [])
          }))
        )

        tableColumnsRef.current = columnLists.filter((e) => e.columns.length > 0)

        for (const item of columnLists) {
          for (const column of item.columns) {
            suggestions.push({
              label: `${item.table}.${column.name}`,
              kind: languages.CompletionItemKind.Field,
              insertText: `${item.table}.${column.name}`,
              detail: `${column.type} · ${item.table}`,
              documentation: `Column ${column.name} from ${item.table}`
            })
            suggestions.push({
              label: column.name,
              kind: languages.CompletionItemKind.Field,
              insertText: column.name,
              detail: `${column.type} · ${item.table}`,
              documentation: `Column ${column.name} from ${item.table}`
            })
          }
        }
      } else {
          // 表数量超过阈值时不预加载所有字段，依赖 prefetch 按需加载
      }

      if (!cancelled) {
        completionSuggestionsRef.current = suggestions
      }
    }

    void loadCompletions()

    return () => {
      cancelled = true
    }
  }, [activeTab?.connectionId, activeTab?.selectedDatabase, loadSchema])

  if (!activeTab) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted text-sm">
        新建标签页开始查询
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-1 bg-app-sidebar border-b border-app-border shrink-0">
        <button
          onClick={handleRun}
          disabled={!isConnected || activeTab.isLoading}
          className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded bg-accent-blue text-white hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
          title="执行查询 (F5 或 Ctrl+Enter)"
        >
          {activeTab.isLoading ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Play size={12} />
          )}
          执行
        </button>

        <button          onClick={handleFormatSQL}
          disabled={!activeTab.sql.trim()}
          className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border border-app-border text-text-secondary hover:text-text-primary hover:border-accent-blue transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
          title="美化 SQL"
        >
          <AlignLeft size={12} />
          美化
        </button>

        <button
          onClick={handleCompressSQL}
          disabled={!activeTab.sql.trim()}
          className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border border-app-border text-text-secondary hover:text-text-primary hover:border-accent-blue transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
          title="压缩 SQL（去除换行与注释）"
        >
          <Minimize2 size={12} />
          压缩
        </button>

        <button          onClick={handleSaveSQL}
          disabled={!activeTab.sql.trim()}
          className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border border-app-border text-text-secondary hover:text-text-primary hover:border-accent-blue transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
          title="保存 SQL 为文件"
        >
          <Download size={12} />
          保存
        </button>

        {/* Connection picker */}
        <div className="relative">
          <button
            onClick={() => { setShowConnPicker((v) => !v); setShowDbPicker(false) }}
            className={clsx(
              'flex items-center gap-1 px-2 py-1 text-xs rounded border transition-colors',
              connection
                ? 'border-app-border text-text-secondary hover:border-accent-blue hover:text-text-primary'
                : 'border-accent-yellow text-accent-yellow hover:border-yellow-400 animate-pulse'
            )}
            title="切换连接"
          >
            {connection ? (
              <>
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isConnected ? 'bg-accent-green' : 'bg-text-muted'}`} />
                <span className="max-w-[120px] truncate">{connection.name}</span>
              </>
            ) : (
              <span>未选择连接 ▼</span>
            )}
            <ChevronDown size={10} className="ml-0.5 opacity-60 shrink-0" />
          </button>
          {showConnPicker && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowConnPicker(false)} />
              <div className="absolute top-full left-0 mt-1 z-50 bg-app-sidebar border border-app-border rounded shadow-xl min-w-[160px] py-1">
                {connectedConnections.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-text-muted">无已连接的数据库</div>
                ) : (
                  connectedConnections.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => handleSelectConnection(c.id)}
                      className={clsx(
                        'w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-app-active transition-colors',
                        activeTab.connectionId === c.id ? 'text-accent-blue' : 'text-text-secondary hover:text-text-primary'
                      )}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-accent-green shrink-0" />
                      {c.name}
                    </button>
                  ))
                )}
              </div>
            </>
          )}
        </div>

        {/* Database picker */}
        {connection && isConnected && (
          <div className="relative">
            <button
              onClick={showDbPicker ? () => setShowDbPicker(false) : handleOpenDbPicker}
              className="flex items-center gap-1 px-2 py-1 text-xs rounded border border-app-border text-text-secondary hover:border-accent-blue hover:text-text-primary transition-colors"
              title="切换数据库"
            >
              <span className="max-w-[100px] truncate">
                {activeTab.selectedDatabase || (connection.database || '默认库')}
              </span>
              <ChevronDown size={10} className="opacity-60 shrink-0" />
            </button>
            {showDbPicker && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowDbPicker(false)} />
                <div className="absolute top-full left-0 mt-1 z-50 bg-app-sidebar border border-app-border rounded shadow-xl min-w-[140px] max-h-52 overflow-y-auto py-1">
                  {availableDbs.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-text-muted flex items-center gap-1">
                      <Loader2 size={11} className="animate-spin" /> 加载中...
                    </div>
                  ) : (
                    availableDbs.map((db) => (
                      <button
                        key={db}
                        onClick={() => handleSelectDb(db)}
                        className={clsx(
                          'w-full text-left px-3 py-1.5 text-xs hover:bg-app-active transition-colors',
                          (activeTab.selectedDatabase || connection.database) === db
                            ? 'text-accent-blue'
                            : 'text-text-secondary hover:text-text-primary'
                        )}
                      >
                        {db}
                      </button>
                    ))
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Monaco Editor */}
      <div className="flex-1 selectable">
        <MonacoEditor
          height="100%"
          language="sql"
          theme={theme === 'light' || theme === 'light-blue' ? 'vs' : 'vs-dark'}
          value={activeTab.sql}
          onChange={(value) => {
            if (activeTabId) updateTabSQL(activeTabId, value ?? '')
          }}
          onMount={handleMount}
          options={{
            fontSize: editorFontSize,
            fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
            fontLigatures: true,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            lineNumbers: 'on',
            renderLineHighlight: 'line',
            tabSize: 2,
            insertSpaces: true,
            automaticLayout: true,
            suggestOnTriggerCharacters: true,
            quickSuggestions: true,
            padding: { top: 8, bottom: 8 }
          }}
        />
      </div>
    </div>
  )
}

function normalizeSqlIdentifier(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return ''
  return trimmed
    .replace(/^\[([^\]]+)\]$/, '$1')
    .replace(/^"(.+)"$/, '$1')
    .replace(/^`(.+)`$/, '$1')
    .replace(/^['](.+)[']$/, '$1')
}

function resolveTypedQualifier(textUntilCursor: string): string | null {
  const qualifierMatch = textUntilCursor.match(/([a-zA-Z_][\w$]*)\.[\w$]*$/)
  return qualifierMatch ? qualifierMatch[1] : null
}

function getCurrentSqlStatement(textUntilCursor: string): string {
  const parts = textUntilCursor.split(';')
  return parts[parts.length - 1] ?? textUntilCursor
}

function parseTableAliases(sql: string): Record<string, string> {
  const aliasMap: Record<string, string> = {}
  const pattern = /\b(?:from|join)\s+((?:\[[^\]]+\]|`[^`]+`|"[^"]+"|[a-zA-Z0-9_]+)(?:\s*\.\s*(?:\[[^\]]+\]|`[^`]+`|"[^"]+"|[a-zA-Z0-9_]+))?)\s+(?:as\s+)?((?:\[[^\]]+\]|`[^`]+`|"[^"]+"|[a-zA-Z0-9_]+))/gi
  const reserved = new Set([
    'on', 'where', 'group', 'order', 'left', 'right', 'inner', 'outer', 'full', 'cross', 'join', 'limit',
    'having', 'union', 'offset'
  ])

  let match: RegExpExecArray | null
  while ((match = pattern.exec(sql)) !== null) {
    const table = normalizeSqlIdentifier(match[1]).replace(/\s*\.\s*/g, '.')
    const alias = normalizeSqlIdentifier(match[2]).toLowerCase()
    if (!table || !alias || reserved.has(alias)) continue
    aliasMap[alias] = table
  }

  return aliasMap
}

function buildAliasSuggestions(
  sql: string,
  typedQualifier: string | null,
  tableColumns: TableColumnEntry[]
): Array<Omit<languages.CompletionItem, 'range'>> {
  if (!sql.trim() || tableColumns.length === 0) return []

  const currentStatement = getCurrentSqlStatement(sql)
  if (!currentStatement.trim()) return []

  const aliases = parseTableAliases(currentStatement)
  const subqueryAliases = parseSubqueryAliases(currentStatement)
  const tableToColumns = new Map<string, TableColumnEntry>()
  for (const entry of tableColumns) {
    const tableKey = normalizeSqlIdentifier(entry.table).toLowerCase()
    const fullTableKey = `${normalizeSqlIdentifier(entry.database).toLowerCase()}.${tableKey}`
    tableToColumns.set(tableKey, entry)
    tableToColumns.set(fullTableKey, entry)
  }

  const typed = typedQualifier?.toLowerCase() ?? null
  const suggestions: Array<Omit<languages.CompletionItem, 'range'>> = []

  for (const [alias, table] of Object.entries(aliases)) {
    if (typed && alias !== typed) continue

    const tableKey = normalizeSqlIdentifier(table).toLowerCase()
    const plainTable = tableKey.includes('.') ? tableKey.split('.').pop() ?? tableKey : tableKey
    const columnEntry = tableToColumns.get(tableKey) ?? tableToColumns.get(plainTable)
    if (!columnEntry) continue

    const sortedColumns = [...columnEntry.columns].sort((a, b) => a.name.localeCompare(b.name))
    for (const column of sortedColumns) {
      suggestions.push({
        label: `${alias}.${column.name}`,
        kind: languages.CompletionItemKind.Field,
        insertText: typed ? column.name : `${alias}.${column.name}`,
        detail: `${column.type} · ${columnEntry.table} as ${alias}`,
        documentation: `Column ${column.name} from ${columnEntry.table} (${alias})`
      })
    }
  }

  for (const [alias, columns] of Object.entries(subqueryAliases)) {
    if (typed && alias !== typed) continue
    for (const col of columns) {
      suggestions.push({
        label: `${alias}.${col}`,
        kind: languages.CompletionItemKind.Field,
        insertText: typed ? col : `${alias}.${col}`,
        detail: `subquery · alias ${alias}`,
        documentation: `Column ${col} from subquery alias ${alias}`
      })
    }
  }

  return suggestions
}

function splitTopLevelComma(input: string): string[] {
  const result: string[] = []
  let depth = 0
  let quote: 'single' | 'double' | 'backtick' | null = null
  let start = 0

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]

    if (quote === 'single') {
      if (ch === "'" && input[i - 1] !== '\\') quote = null
      continue
    }
    if (quote === 'double') {
      if (ch === '"' && input[i - 1] !== '\\') quote = null
      continue
    }
    if (quote === 'backtick') {
      if (ch === '`') quote = null
      continue
    }

    if (ch === "'") {
      quote = 'single'
      continue
    }
    if (ch === '"') {
      quote = 'double'
      continue
    }
    if (ch === '`') {
      quote = 'backtick'
      continue
    }

    if (ch === '(') {
      depth += 1
      continue
    }
    if (ch === ')') {
      depth = Math.max(0, depth - 1)
      continue
    }

    if (ch === ',' && depth === 0) {
      result.push(input.slice(start, i).trim())
      start = i + 1
    }
  }

  const tail = input.slice(start).trim()
  if (tail) result.push(tail)
  return result
}

function extractProjectionAlias(expr: string): string | null {
  const cleaned = expr.trim()
  if (!cleaned) return null

  const asAlias = cleaned.match(/\bas\s+((?:\[[^\]]+\]|`[^`]+`|"[^"]+"|[a-zA-Z_][\w$]*))\s*$/i)
  if (asAlias) return normalizeSqlIdentifier(asAlias[1])

  const trailingAlias = cleaned.match(/\s+((?:\[[^\]]+\]|`[^`]+`|"[^"]+"|[a-zA-Z_][\w$]*))\s*$/)
  if (trailingAlias) {
    const maybeAlias = normalizeSqlIdentifier(trailingAlias[1])
    const reserved = new Set(['desc', 'asc', 'nulls'])
    if (!reserved.has(maybeAlias.toLowerCase())) return maybeAlias
  }

  const plainCol = cleaned.match(/((?:\[[^\]]+\]|`[^`]+`|"[^"]+"|[a-zA-Z_][\w$]*)(?:\s*\.\s*(?:\[[^\]]+\]|`[^`]+`|"[^"]+"|[a-zA-Z_][\w$]*))*)\s*$/)
  if (!plainCol) return null
  const normalized = plainCol[1].replace(/\s*\.\s*/g, '.')
  const lastPart = normalized.split('.').pop() ?? normalized
  return normalizeSqlIdentifier(lastPart)
}

function extractSubquerySelectColumns(subquerySql: string): string[] {
  const sql = subquerySql.trim()
  if (!/^select\b/i.test(sql)) return []

  let depth = 0
  let quote: 'single' | 'double' | 'backtick' | null = null
  let fromIndex = -1

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]

    if (quote === 'single') {
      if (ch === "'" && sql[i - 1] !== '\\') quote = null
      continue
    }
    if (quote === 'double') {
      if (ch === '"' && sql[i - 1] !== '\\') quote = null
      continue
    }
    if (quote === 'backtick') {
      if (ch === '`') quote = null
      continue
    }

    if (ch === "'") {
      quote = 'single'
      continue
    }
    if (ch === '"') {
      quote = 'double'
      continue
    }
    if (ch === '`') {
      quote = 'backtick'
      continue
    }

    if (ch === '(') {
      depth += 1
      continue
    }
    if (ch === ')') {
      depth = Math.max(0, depth - 1)
      continue
    }

    if (depth === 0 && /^from\b/i.test(sql.slice(i))) {
      fromIndex = i
      break
    }
  }

  if (fromIndex <= 6) return []

  const selectList = sql.slice(6, fromIndex)
  const parts = splitTopLevelComma(selectList)
  const cols = parts
    .map((part) => extractProjectionAlias(part))
    .filter((name): name is string => Boolean(name))

  return Array.from(new Set(cols))
}

function parseSubqueryAliases(sql: string): Record<string, string[]> {
  const aliasColumns: Record<string, string[]> = {}
  const keywordPattern = /\b(from|join)\b/gi
  const aliasPattern = /^\s*\)\s*(?:as\s+)?((?:\[[^\]]+\]|`[^`]+`|"[^"]+"|[a-zA-Z_][\w$]*))/i
  const reserved = new Set([
    'on', 'where', 'group', 'order', 'left', 'right', 'inner', 'outer', 'full', 'cross', 'join', 'limit',
    'having', 'union', 'offset'
  ])

  let keywordMatch: RegExpExecArray | null
  while ((keywordMatch = keywordPattern.exec(sql)) !== null) {
    let idx = keywordPattern.lastIndex
    while (idx < sql.length && /\s/.test(sql[idx])) idx += 1
    if (sql[idx] !== '(') continue

    let depth = 0
    let endIdx = -1
    let quote: 'single' | 'double' | 'backtick' | null = null
    for (let i = idx; i < sql.length; i++) {
      const ch = sql[i]

      if (quote === 'single') {
        if (ch === "'" && sql[i - 1] !== '\\') quote = null
        continue
      }
      if (quote === 'double') {
        if (ch === '"' && sql[i - 1] !== '\\') quote = null
        continue
      }
      if (quote === 'backtick') {
        if (ch === '`') quote = null
        continue
      }

      if (ch === "'") {
        quote = 'single'
        continue
      }
      if (ch === '"') {
        quote = 'double'
        continue
      }
      if (ch === '`') {
        quote = 'backtick'
        continue
      }

      if (ch === '(') depth += 1
      if (ch === ')') {
        depth -= 1
        if (depth === 0) {
          endIdx = i
          break
        }
      }
    }

    if (endIdx === -1) continue

    const subquerySql = sql.slice(idx + 1, endIdx)
    const aliasMatch = sql.slice(endIdx).match(aliasPattern)
    if (!aliasMatch) continue
    const alias = normalizeSqlIdentifier(aliasMatch[1]).toLowerCase()
    if (!alias || reserved.has(alias)) continue

    const projectedColumns = extractSubquerySelectColumns(subquerySql)
    if (projectedColumns.length > 0) {
      aliasColumns[alias] = projectedColumns
    }
  }

  return aliasColumns
}

function dedupeCompletions(
  suggestions: Array<Omit<languages.CompletionItem, 'range'>>
): Array<Omit<languages.CompletionItem, 'range'>> {
  const seen = new Set<string>()
  const sorted = [...suggestions].sort((a, b) => String(a.label).localeCompare(String(b.label)))
  const result: Array<Omit<languages.CompletionItem, 'range'>> = []
  for (const item of sorted) {
    const key = `${String(item.label)}::${item.insertText ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(item)
  }
  return result
}

function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'query'
}

function baseSqlSuggestions(): Array<Omit<languages.CompletionItem, 'range'>> {
  return [
    'SELECT', 'FROM', 'WHERE', 'ORDER BY', 'GROUP BY', 'LIMIT', 'INSERT INTO', 'UPDATE', 'DELETE',
    'JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'CREATE TABLE', 'ALTER TABLE', 'DROP TABLE'
  ].map((keyword) => ({
    label: keyword,
    kind: languages.CompletionItemKind.Keyword,
    insertText: keyword,
    detail: 'SQL keyword'
  }))
}
