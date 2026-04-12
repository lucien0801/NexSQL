import { Plus, X } from 'lucide-react'
import { clsx } from 'clsx'
import { useQueryStore } from '@renderer/stores/queryStore'
import { useConnectionStore } from '@renderer/stores/connectionStore'

export function TabBar(): JSX.Element {
  const { tabs, activeTabId, newTab, closeTab, setActiveTab } = useQueryStore()
  const { activeConnectionId } = useConnectionStore()

  const handleNewTab = (): void => {
    newTab(activeConnectionId ?? undefined)
  }

  const handleCloseTab = (tabId: string): void => {
    const tab = tabs.find((item) => item.id === tabId)
    if (tab?.hasPendingChanges) {
      const confirmed = confirm('当前数据表页有未提交的修改，确认直接关闭吗？')
      if (!confirmed) return
    }
    closeTab(tabId)
  }

  return (
    <div className="flex items-center bg-app-header border-b border-app-border shrink-0 overflow-x-auto">
      <div className="flex items-center min-w-0">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={clsx(
              'flex items-center gap-1.5 px-3 py-1.5 text-xs cursor-pointer border-r border-app-border shrink-0 group transition-colors max-w-[160px]',
              tab.id === activeTabId
                ? 'bg-app-bg text-text-primary border-t-2 border-t-accent-blue'
                : 'bg-app-header text-text-secondary hover:bg-app-hover hover:text-text-primary'
            )}
          >
            {tab.isLoading && (
              <span className="w-2 h-2 rounded-full bg-accent-blue animate-pulse shrink-0" />
            )}
            {tab.hasPendingChanges && !tab.isLoading && (
              <span className="w-2 h-2 rounded-full bg-accent-yellow shrink-0" title="有未提交的修改" />
            )}
            <span className="truncate">{tab.title}</span>
            <button
              onClick={(e) => {
                e.stopPropagation()
                handleCloseTab(tab.id)
              }}
              className="ml-0.5 rounded p-0.5 opacity-0 group-hover:opacity-100 hover:bg-app-hover transition-all"
              title="Close tab"
            >
              <X size={11} />
            </button>
          </div>
        ))}
      </div>

      <button
        onClick={handleNewTab}
        className="flex items-center justify-center w-7 h-7 ml-1 shrink-0 rounded text-text-muted hover:text-text-primary hover:bg-app-hover transition-colors"
        title="新建查询"
      >
        <Plus size={14} />
      </button>
    </div>
  )
}
