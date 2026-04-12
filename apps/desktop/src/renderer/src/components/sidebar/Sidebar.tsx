import { Database, History, Plus, Settings } from 'lucide-react'
import { ConnectionList } from './ConnectionList'
import { SchemaTree } from './SchemaTree'
import { useUIStore } from '@renderer/stores/uiStore'
import { useQueryStore } from '@renderer/stores/queryStore'
import { useI18nStore } from '@renderer/stores/i18nStore'
import { clsx } from 'clsx'
import type { QueryHistoryEntry } from '@shared/types/query'

export function Sidebar(): JSX.Element {
  const { sidebarTab, setSidebarTab, openConnectionDialog, setShowAppSettings } = useUIStore()
  const { history, loadHistory } = useQueryStore()
  const { t } = useI18nStore()

  const handleHistoryClick = (): void => {
    setSidebarTab('history')
    loadHistory()
  }

  return (
    <div className="flex flex-col h-full bg-app-sidebar border-r border-app-border">
      {/* Sidebar header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-app-border shrink-0">
        <div className="flex gap-1">
          <button
            onClick={() => setSidebarTab('connections')}
            className={clsx(
              'p-1.5 rounded text-xs flex items-center gap-1 transition-colors',
              sidebarTab === 'connections'
                ? 'bg-app-active text-white'
                : 'text-text-secondary hover:text-text-primary hover:bg-app-hover'
            )}
            title={t('sidebar.connections')}
          >
            <Database size={14} />
          </button>
          <button
            onClick={handleHistoryClick}
            className={clsx(
              'p-1.5 rounded text-xs flex items-center gap-1 transition-colors',
              sidebarTab === 'history'
                ? 'bg-app-active text-white'
                : 'text-text-secondary hover:text-text-primary hover:bg-app-hover'
            )}
            title={t('sidebar.history')}
          >
            <History size={14} />
          </button>
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => openConnectionDialog()}
            className="p-1.5 rounded text-text-secondary hover:text-text-primary hover:bg-app-hover transition-colors"
            title={t('conn.newConn')}
          >
            <Plus size={14} />
          </button>
          <button
            onClick={() => setShowAppSettings(true)}
            className="p-1.5 rounded text-text-secondary hover:text-text-primary hover:bg-app-hover transition-colors"
            title={t('settings.title')}
          >
            <Settings size={14} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        {sidebarTab === 'connections' ? (
          <>
            <ConnectionList />
            <SchemaTree />
          </>
        ) : (
          <HistoryList history={history} />
        )}
      </div>
    </div>
  )
}

function HistoryList({ history }: { history: QueryHistoryEntry[] }): JSX.Element {
  const { newTab, updateTabSQL } = useQueryStore()

  const handleClick = (sql: string): void => {
    const tabId = newTab()
    updateTabSQL(tabId, sql)
  }

  if (history.length === 0) {
    return (
      <div className="p-4 text-text-muted text-xs text-center">
        暂无查询记录
      </div>
    )
  }

  return (
    <div className="py-1">
      <div className="px-3 py-1 text-2xs text-text-muted uppercase tracking-wider font-semibold">
        历史记录
      </div>
      {history.map((entry) => (
        <button
          key={entry.id}
          onClick={() => handleClick(entry.sql)}
          className="w-full text-left px-3 py-1.5 hover:bg-app-hover transition-colors group"
        >
          <div className="flex items-center gap-2">
            <span
              className={clsx(
                'w-1.5 h-1.5 rounded-full shrink-0',
                entry.success ? 'bg-accent-green' : 'bg-accent-red'
              )}
            />
            <span className="text-xs text-text-primary truncate font-mono">
              {entry.sql.replace(/\s+/g, ' ').substring(0, 60)}
            </span>
          </div>
          <div className="flex gap-3 mt-0.5 pl-3.5 text-2xs text-text-muted">
            <span>{entry.durationMs}ms</span>
            <span>{entry.rowCount} 行</span>
            <span>{new Date(entry.executedAt).toLocaleTimeString()}</span>
          </div>
        </button>
      ))}
    </div>
  )
}
