import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { Loader2, Sparkles, Database, FileText, RefreshCcw, Clipboard } from 'lucide-react'
import { clsx } from 'clsx'
import { useAIStore } from '@renderer/stores/aiStore'
import { useConnectionStore } from '@renderer/stores/connectionStore'
import { useQueryStore } from '@renderer/stores/queryStore'
import { ERDiagramWorkbench } from './ERDiagramWorkbench'

type WorkbenchTab = 'design' | 'doc' | 'index' | 'er' | 'logs'

export function AIWorkbench(): JSX.Element {
  const [tab, setTab] = useState<WorkbenchTab>('design')
  const [designPrompt, setDesignPrompt] = useState('我需要一个博客系统，包含用户、文章、评论和标签')
  const [docDatabase, setDocDatabase] = useState('')
  const [indexDatabase, setIndexDatabase] = useState('')
  const [selectedTables, setSelectedTables] = useState<string[]>([])
  const [indexTableFilter, setIndexTableFilter] = useState('')
  const [selectedIndexTables, setSelectedIndexTables] = useState<string[]>([])
  const [selectedIndexKey, setSelectedIndexKey] = useState<string>('')
  const [manualNotesDraft, setManualNotesDraft] = useState('')
  const [saveMessage, setSaveMessage] = useState('')
  const [saveError, setSaveError] = useState('')

  const {
    generateDesignSQL,
    generateSchemaDoc,
    buildSemanticIndex,
    loadSemanticIndexStatus,
    designResult,
    docResult,
    semanticIndexStatus,
    logs,
    isBuildingIndex,
    currentTask,
    clearLogs,
    updateSemanticIndexItem
  } = useAIStore()
  const { connections, statuses, activeConnectionId } = useConnectionStore()
  const { loadSchema, getSchema, newTab, updateTabSQL } = useQueryStore()

  const connected = useMemo(
    () => connections.filter((c) => (statuses[c.id] ?? 'disconnected') === 'connected'),
    [connections, statuses]
  )

  const connectionId = activeConnectionId ?? connected[0]?.id ?? null
  const connection = connectionId ? connections.find((c) => c.id === connectionId) ?? null : null

  const schema = connectionId ? getSchema(connectionId) : null
  const databases = schema?.databases ?? []
  const activeDb = docDatabase || databases[0]?.name || ''
  const indexDb = indexDatabase || databases[0]?.name || ''
  const tables = databases.find((db) => db.name === activeDb)?.tables ?? []
  const indexTables = databases.find((db) => db.name === indexDb)?.tables ?? []
  const allIndexItems = connectionId ? semanticIndexStatus[connectionId] ?? [] : []
  const deferredIndexTableFilter = useDeferredValue(indexTableFilter)
  const currentIndex = allIndexItems.filter((item) => item.databaseName === indexDb)
  const indexedCount = currentIndex.filter((item) => item.status === 'indexed').length
  const failedCount = currentIndex.filter((item) => item.status === 'failed').length
  const freshCount = currentIndex.filter((item) => Date.now() - item.updatedAt < 5 * 60 * 1000).length
  const selectedIndexItem = currentIndex.find((item) => `${item.databaseName}.${item.tableName}` === selectedIndexKey) ?? currentIndex[0] ?? null
  const filteredIndexTables = useMemo(() => {
    const keywords = deferredIndexTableFilter
      .split(/[\s,，]+/)
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
    if (keywords.length === 0) return indexTables
    return indexTables.filter((table) =>
      keywords.some((keyword) => table.name.toLowerCase().includes(keyword))
    )
  }, [deferredIndexTableFilter, indexTables])

  useEffect(() => {
    if (!connectionId) return
    void loadSchema(connectionId)
    void loadSemanticIndexStatus(connectionId)
  }, [connectionId, loadSchema, loadSemanticIndexStatus])

  useEffect(() => {
    if (!docDatabase && databases.length > 0) {
      setDocDatabase(databases[0].name)
    }
  }, [databases, docDatabase])

  useEffect(() => {
    if (!indexDatabase && databases.length > 0) {
      setIndexDatabase(databases[0].name)
    }
  }, [databases, indexDatabase])

  useEffect(() => {
    setSelectedIndexTables([])
    setIndexTableFilter('')
  }, [indexDb])

  useEffect(() => {
    if (currentIndex.length > 0 && !selectedIndexKey) {
      setSelectedIndexKey(`${currentIndex[0].databaseName}.${currentIndex[0].tableName}`)
    }
    if (currentIndex.length === 0) {
      setSelectedIndexKey('')
    }
  }, [currentIndex, selectedIndexKey])

  useEffect(() => {
    setManualNotesDraft(selectedIndexItem?.manualNotes ?? '')
  }, [selectedIndexItem?.databaseName, selectedIndexItem?.tableName, selectedIndexItem?.manualNotes])

  const handleGenerateDesign = async (): Promise<void> => {
    if (!connectionId || !connection || !designPrompt.trim()) return
    const result = await generateDesignSQL(
      designPrompt.trim(),
      connectionId,
      connection.type,
      undefined,
      true
    )
    const tabId = newTab(connectionId)
    updateTabSQL(tabId, result.sql)
  }

  const handleGenerateDoc = async (): Promise<void> => {
    if (!connectionId || !connection || !activeDb || selectedTables.length === 0) return
    await generateSchemaDoc(
      connectionId,
      connection.type,
      selectedTables.map((table) => ({ database: activeDb, table }))
    )
    setTab('logs')
  }

  const handleBuildIndex = async (): Promise<void> => {
    if (!connectionId || !indexDb) return
    await buildSemanticIndex(
      connectionId,
      indexDb,
      selectedIndexTables.length > 0 ? selectedIndexTables : undefined
    )
    await loadSemanticIndexStatus(connectionId)
  }

  const handleSaveManualNotes = async (): Promise<void> => {
    if (!connectionId || !selectedIndexItem) return
    setSaveMessage('')
    setSaveError('')
    try {
      await updateSemanticIndexItem(
        connectionId,
        selectedIndexItem.databaseName,
        selectedIndexItem.tableName,
        manualNotesDraft
      )
      setSaveMessage(`备注已保存：${selectedIndexItem.databaseName}.${selectedIndexItem.tableName}`)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
    }
  }

  const allSelected = tables.length > 0 && selectedTables.length === tables.length
  const allIndexSelected = filteredIndexTables.length > 0 && filteredIndexTables.every((table) => selectedIndexTables.includes(table.name))

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-app-border px-3 py-2">
        <div className="text-xs font-semibold text-text-primary">AI 工作台</div>
        <div className="mt-1 text-2xs text-text-muted">
          设计与文档在此独立执行，支持查看步骤日志与语义索引状态。
        </div>
      </div>

      <div className="flex items-center gap-1 border-b border-app-border px-2 py-1">
        <TabButton label="设计" active={tab === 'design'} onClick={() => setTab('design')} />
        <TabButton label="文档" active={tab === 'doc'} onClick={() => setTab('doc')} />
        <TabButton label="语义索引" active={tab === 'index'} onClick={() => setTab('index')} />
        <TabButton label="E-R 图" active={tab === 'er'} onClick={() => setTab('er')} />
        <TabButton label="执行日志" active={tab === 'logs'} onClick={() => setTab('logs')} />
      </div>

      <div className="flex-1 overflow-auto p-3">
        {!connectionId ? (
          <div className="rounded border border-app-border p-3 text-xs text-text-muted">
            请先连接数据库后使用 AI 工作台。
          </div>
        ) : tab === 'design' ? (
          <div className="space-y-3">
            <div className="text-xs text-text-secondary">需求描述</div>
            <textarea
              value={designPrompt}
              onChange={(e) => setDesignPrompt(e.target.value)}
              rows={5}
              className="w-full resize-y rounded border border-app-border bg-app-input px-2 py-2 text-xs text-text-primary focus:border-accent-blue focus:outline-none"
            />
            <button
              onClick={() => void handleGenerateDesign()}
              disabled={!designPrompt.trim() || currentTask === 'design'}
              className="flex items-center gap-1.5 rounded bg-accent-blue px-2.5 py-1.5 text-xs text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {currentTask === 'design' ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
              生成设计 SQL
            </button>
            {designResult && (
              <div className="rounded border border-app-border bg-app-panel p-2">
                <div className="mb-1 text-xs text-text-primary">最近结果</div>
                <div className="text-2xs text-text-muted">{new Date(designResult.createdAt).toLocaleString()}</div>
                <div className="mt-2 whitespace-pre-wrap font-mono text-2xs text-text-secondary">
                  {designResult.notes || '已生成并写入新查询标签页'}
                </div>
              </div>
            )}
          </div>
        ) : tab === 'doc' ? (
          <div className="space-y-3">
            <div className="text-xs text-text-secondary">选择数据库</div>
            <select
              value={activeDb}
              onChange={(e) => {
                setDocDatabase(e.target.value)
                setSelectedTables([])
              }}
              className="w-full rounded border border-app-border bg-app-input px-2 py-1.5 text-xs text-text-primary focus:border-accent-blue focus:outline-none"
            >
              {databases.map((db) => (
                <option key={db.name} value={db.name}>
                  {db.name}
                </option>
              ))}
            </select>

            <div className="flex items-center justify-between">
              <div className="text-xs text-text-secondary">选择表（{selectedTables.length}/{tables.length}）</div>
              <button
                onClick={() => setSelectedTables(allSelected ? [] : tables.map((t) => t.name))}
                className="text-2xs text-text-muted hover:text-text-primary"
              >
                {allSelected ? '取消全选' : '全选'}
              </button>
            </div>

            <div className="max-h-48 overflow-auto rounded border border-app-border bg-app-panel p-2">
              {tables.map((table) => {
                const checked = selectedTables.includes(table.name)
                return (
                  <label key={table.name} className="flex cursor-pointer items-center gap-2 py-1 text-xs text-text-secondary">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        setSelectedTables((prev) =>
                          e.target.checked
                            ? [...prev, table.name]
                            : prev.filter((item) => item !== table.name)
                        )
                      }}
                    />
                    <span>{table.name}</span>
                  </label>
                )
              })}
            </div>

            <button
              onClick={() => void handleGenerateDoc()}
              disabled={selectedTables.length === 0 || currentTask === 'doc'}
              className="flex items-center gap-1.5 rounded border border-app-border px-2.5 py-1.5 text-xs text-text-secondary transition-colors hover:border-accent-blue hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
            >
              {currentTask === 'doc' ? <Loader2 size={12} className="animate-spin" /> : <FileText size={12} />}
              生成文档
            </button>

            {docResult && (
              <div className="rounded border border-app-border bg-app-panel p-2">
                <div className="mb-1 flex items-center justify-between text-xs text-text-primary">
                  <span>最近文档</span>
                  <button
                    onClick={() => void navigator.clipboard.writeText(docResult.markdown)}
                    className="flex items-center gap-1 text-2xs text-text-muted hover:text-text-primary"
                  >
                    <Clipboard size={11} /> 复制
                  </button>
                </div>
                <pre className="max-h-56 overflow-auto whitespace-pre-wrap text-2xs text-text-secondary">{docResult.markdown}</pre>
              </div>
            )}
          </div>
        ) : tab === 'index' ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-text-secondary">目标数据库</span>
              <select
                value={indexDb}
                onChange={(e) => {
                  setIndexDatabase(e.target.value)
                  setSelectedIndexKey('')
                }}
                className="rounded border border-app-border bg-app-input px-2 py-1.5 text-xs text-text-primary focus:border-accent-blue focus:outline-none"
              >
                {databases.map((db) => (
                  <option key={db.name} value={db.name}>
                    {db.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="rounded border border-app-border bg-app-panel p-2 text-2xs text-text-muted">
              语义索引不会自动建立。请先选择数据库，再按需筛选表，最后由你主动点击“构建索引”。如果不选表，则默认构建当前数据库全部表。
            </div>

            <div className="space-y-2 rounded border border-app-border bg-app-panel p-2">
              <div className="flex items-center justify-between gap-2">
                <input
                  value={indexTableFilter}
                  onChange={(event) => setIndexTableFilter(event.target.value)}
                  placeholder="筛选要建立索引的表，支持空格或逗号分隔关键词"
                  className="w-full rounded border border-app-border bg-app-input px-2 py-1.5 text-xs text-text-primary focus:border-accent-blue focus:outline-none"
                />
                <button
                  onClick={() => setIndexTableFilter('')}
                  disabled={!indexTableFilter}
                  className="rounded border border-app-border px-2 py-1 text-2xs text-text-secondary hover:border-accent-blue hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
                >
                  清空
                </button>
              </div>

              <div className="flex items-center justify-between text-xs text-text-secondary">
                <span>选择表（{selectedIndexTables.length}/{filteredIndexTables.length}）</span>
                <button
                  onClick={() => setSelectedIndexTables(allIndexSelected ? [] : filteredIndexTables.map((table) => table.name))}
                  className="text-2xs text-text-muted hover:text-text-primary"
                >
                  {allIndexSelected ? '取消全选' : '全选当前筛选结果'}
                </button>
              </div>

              <div className="max-h-44 overflow-auto rounded border border-app-border bg-app-bg p-2">
                {filteredIndexTables.length === 0 ? (
                  <div className="text-2xs text-text-muted">没有匹配的表。</div>
                ) : (
                  filteredIndexTables.map((table) => {
                    const checked = selectedIndexTables.includes(table.name)
                    return (
                      <label key={table.name} className="flex cursor-pointer items-center gap-2 py-1 text-xs text-text-secondary">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) => {
                            setSelectedIndexTables((prev) =>
                              event.target.checked
                                ? [...prev, table.name]
                                : prev.filter((item) => item !== table.name)
                            )
                          }}
                        />
                        <span>{table.name}</span>
                      </label>
                    )
                  })
                )}
              </div>

              <div className="text-2xs text-text-muted">
                当前模式：{selectedIndexTables.length > 0 ? `仅构建 ${selectedIndexTables.length} 张选中表` : '未选表，将构建当前数据库全部表'}
              </div>
            </div>

            <div className="grid grid-cols-4 gap-2">
              <SummaryCard label="总条目" value={String(currentIndex.length)} />
              <SummaryCard label="已索引" value={String(indexedCount)} tone="success" />
              <SummaryCard label="失败" value={String(failedCount)} tone={failedCount > 0 ? 'danger' : 'neutral'} />
              <SummaryCard label="近期更新" value={String(freshCount)} />
            </div>
            <div className="rounded border border-app-border bg-app-panel p-2 text-2xs text-text-muted">
              当前索引采用增量更新：schema 未变化的表会直接跳过，只有新增、变更或失败的表会重建。
            </div>
            <div className="rounded border border-app-border bg-app-panel p-2 text-2xs text-text-muted">
              索引会持久化到应用内部 SQLite（表 semantic_index_items），按 connection_id + database_name + table_name 存储。
            </div>
            <div className="flex items-center justify-between">
              <div className="text-xs text-text-secondary">语义索引状态（{indexDb || '-'} / {currentIndex.length}）</div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    if (connectionId) void loadSemanticIndexStatus(connectionId)
                  }}
                  className="flex items-center gap-1 rounded border border-app-border px-2 py-1 text-2xs text-text-muted hover:border-accent-blue hover:text-text-primary"
                >
                  <RefreshCcw size={11} /> 刷新
                </button>
                <button
                  onClick={() => void handleBuildIndex()}
                  disabled={isBuildingIndex || !indexDb}
                  className="flex items-center gap-1 rounded bg-accent-blue px-2 py-1 text-2xs text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {isBuildingIndex ? <Loader2 size={11} className="animate-spin" /> : <Database size={11} />}
                  {selectedIndexTables.length > 0 ? '构建选中表索引' : '构建索引'}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-[minmax(0,220px)_minmax(0,1fr)] gap-3">
              <div className="space-y-1 max-h-[420px] overflow-auto">
              {currentIndex.length === 0 ? (
                <div className="rounded border border-app-border p-2 text-2xs text-text-muted">
                  暂无索引数据。请选择数据库和表后，手动点击“构建索引”。
                </div>
              ) : (
                currentIndex.map((item) => (
                  <button
                    key={`${item.databaseName}.${item.tableName}`}
                    onClick={() => setSelectedIndexKey(`${item.databaseName}.${item.tableName}`)}
                    className={clsx(
                      'w-full rounded border bg-app-panel p-2 text-left',
                      selectedIndexKey === `${item.databaseName}.${item.tableName}`
                        ? 'border-accent-blue'
                        : 'border-app-border'
                    )}
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-text-primary">{item.databaseName}.{item.tableName}</span>
                      <span
                        className={clsx(
                          'text-2xs',
                          item.status === 'indexed' ? 'text-accent-green' : 'text-accent-red'
                        )}
                      >
                        {item.status === 'indexed' ? '已索引' : '失败'}
                      </span>
                    </div>
                    <div className="mt-1 text-2xs text-text-muted">更新时间: {new Date(item.updatedAt).toLocaleString()}</div>
                    {item.manualNotes && <div className="mt-1 text-2xs text-accent-blue">含人工备注</div>}
                    {item.error && <div className="mt-1 text-2xs text-accent-red">{item.error}</div>}
                  </button>
                ))
              )}
              </div>

              <div className="rounded border border-app-border bg-app-panel p-3">
                {selectedIndexItem ? (
                  <div className="space-y-3">
                    <div>
                      <div className="text-xs font-semibold text-text-primary">{selectedIndexItem.databaseName}.{selectedIndexItem.tableName}</div>
                      <div className="mt-1 text-2xs text-text-muted">手工修改有意义：适合补充业务语义、命名约定、真实 join 关系、枚举含义。AI 召回时会使用这些人工备注。</div>
                    </div>

                    <div>
                      <div className="mb-1 text-2xs text-text-muted">索引摘要</div>
                      <pre className="max-h-52 overflow-auto whitespace-pre-wrap rounded border border-app-border bg-app-bg p-2 text-2xs text-text-secondary">{selectedIndexItem.summaryText}</pre>
                    </div>

                    <div>
                      <div className="mb-1 text-2xs text-text-muted">人工备注</div>
                      <textarea
                        value={manualNotesDraft}
                        onChange={(event) => setManualNotesDraft(event.target.value)}
                        rows={6}
                        placeholder="补充业务含义、真实关系、常见过滤字段、枚举说明等"
                        className="w-full resize-y rounded border border-app-border bg-app-input px-2 py-2 text-xs text-text-primary focus:border-accent-blue focus:outline-none"
                      />
                      <div className="mt-2 flex items-center gap-2">
                        <button
                          onClick={() => void handleSaveManualNotes()}
                          className="rounded bg-accent-blue px-2.5 py-1 text-xs text-white hover:bg-blue-600"
                        >
                          保存备注
                        </button>
                        <button
                          onClick={() => setManualNotesDraft('')}
                          className="rounded border border-app-border px-2.5 py-1 text-xs text-text-secondary hover:border-accent-blue hover:text-text-primary"
                        >
                          清空草稿
                        </button>
                      </div>
                      {saveMessage && <div className="mt-2 text-2xs text-accent-green">{saveMessage}</div>}
                      {saveError && <div className="mt-2 text-2xs text-accent-red">{saveError}</div>}
                    </div>
                  </div>
                ) : (
                  <div className="text-2xs text-text-muted">请选择左侧索引条目查看详情。</div>
                )}
              </div>
            </div>
          </div>
        ) : tab === 'er' ? (
          <ERDiagramWorkbench connectionId={connectionId} databases={databases} />
        ) : (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <div className="text-xs text-text-secondary">执行步骤</div>
              <button onClick={clearLogs} className="text-2xs text-text-muted hover:text-text-primary">清空</button>
            </div>
            <div className="space-y-1">
              {logs.length === 0 ? (
                <div className="rounded border border-app-border p-2 text-2xs text-text-muted">暂无执行日志。</div>
              ) : (
                logs.map((log) => (
                  <div key={log.id} className="rounded border border-app-border bg-app-panel p-2">
                    <div className="flex items-center justify-between text-2xs">
                      <span className="text-text-secondary">{taskLabel(log.task)}</span>
                      <span className={clsx(log.level === 'error' ? 'text-accent-red' : log.level === 'success' ? 'text-accent-green' : 'text-text-muted')}>
                        {new Date(log.createdAt).toLocaleTimeString()}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-text-primary">{log.message}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function SummaryCard({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'neutral' | 'success' | 'danger' }): JSX.Element {
  return (
    <div className="rounded border border-app-border bg-app-panel p-2">
      <div className="text-2xs text-text-muted">{label}</div>
      <div className={clsx('mt-1 text-sm font-semibold', tone === 'success' ? 'text-accent-green' : tone === 'danger' ? 'text-accent-red' : 'text-text-primary')}>
        {value}
      </div>
    </div>
  )
}

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'rounded px-2 py-1 text-xs transition-colors',
        active ? 'bg-app-active text-white' : 'text-text-secondary hover:bg-app-hover hover:text-text-primary'
      )}
    >
      {label}
    </button>
  )
}

function taskLabel(task: WorkbenchTab | 'optimize' | 'design' | 'doc' | 'index' | 'er'): string {
  if (task === 'optimize') return 'SQL 优化'
  if (task === 'design') return '数据库设计'
  if (task === 'doc') return '文档生成'
  if (task === 'index') return '语义索引'
  if (task === 'er') return 'E-R 关系图'
  return String(task)
}
