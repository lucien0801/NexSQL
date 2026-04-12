import { useRef, useCallback, useState, useEffect } from 'react'
import MonacoEditor, { type OnMount } from '@monaco-editor/react'
import { KeyMod, KeyCode, languages, type editor, type IDisposable } from 'monaco-editor'
import { Play, Loader2, ChevronDown, Download } from 'lucide-react'
import { clsx } from 'clsx'
import { useQueryStore } from '@renderer/stores/queryStore'
import { useConnectionStore } from '@renderer/stores/connectionStore'
import { usePrefsStore } from '@renderer/stores/prefsStore'

export function QueryEditor(): JSX.Element {
  const { tabs, activeTabId, updateTabSQL, updateTabConnection, updateTabDatabase, loadSchema } = useQueryStore()
  const { connections, statuses } = useConnectionStore()
  const { fontSize, theme } = usePrefsStore()
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const completionDisposableRef = useRef<IDisposable | null>(null)
  const completionSuggestionsRef = useRef<Array<Omit<languages.CompletionItem, 'range'>>>([])
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
      provideCompletionItems: (model, position) => {
        const word = model.getWordUntilPosition(position)
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn
        }

        return {
          suggestions: completionSuggestionsRef.current.map((item) => ({
            ...item,
            range
          }))
        }
      }
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

      if (tableEntries.length <= 40) {
        const columnLists = await Promise.all(
          tableEntries.map(async (entry) => ({
            ...entry,
            columns: await window.db!
              .getTableColumns(activeTab.connectionId!, entry.table, entry.database)
              .catch(() => [])
          }))
        )

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

        <button
          onClick={handleSaveSQL}
          disabled={!activeTab.sql.trim()}
          className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border border-app-border text-text-secondary hover:text-text-primary hover:border-accent-blue transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
          title="保存 SQL 为文件"
        >
          <Download size={12} />
          保存 .sql
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
