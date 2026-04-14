import { useEffect } from 'react'
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels'
import { Sidebar } from '../sidebar/Sidebar'
import { TabBar } from '../editor/TabBar'
import { QueryEditor } from '../editor/QueryEditor'
import { ResultsPanel } from '../results/ResultsPanel'
import { AIInputBar } from '../ai/AIInputBar'
import { TableDataView } from '../table/TableDataView'
import { DatabaseOverview } from '../database/DatabaseOverview'
import { ConnectionDialog } from '../connection/ConnectionDialog'
import { SettingsDialog } from '../settings/SettingsDialog'
import { AppSettingsDialog } from '../settings/AppSettingsDialog'
import { useConnectionStore } from '@renderer/stores/connectionStore'
import { useQueryStore } from '@renderer/stores/queryStore'
import { useUIStore } from '@renderer/stores/uiStore'
import { usePrefsStore, applyFontSize, applyTheme } from '@renderer/stores/prefsStore'

export function AppLayout(): JSX.Element {
  const { loadConnections } = useConnectionStore()
  const { tabs, activeTabId, newTab } = useQueryStore()
  const { showConnectionDialog, showSettings, showAppSettings } = useUIStore()
  const { fontSize, theme } = usePrefsStore()

  useEffect(() => {
    loadConnections()
  }, [loadConnections])

  // Apply persisted font size on first render
  useEffect(() => {
    applyFontSize(fontSize)
  }, [fontSize])

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  // Ensure at least one tab
  useEffect(() => {
    if (tabs.length === 0) {
      newTab()
    }
  }, [tabs.length, newTab])

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent): void => {
      if (!activeTab?.hasPendingChanges) return
      event.preventDefault()
      event.returnValue = ''
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [activeTab?.hasPendingChanges])

  return (
    <div className="flex flex-col h-full bg-app-bg text-text-primary">
      {/* macOS traffic-light spacer – only rendered on darwin.
          hiddenInset keeps the red/yellow/green buttons but merges the titlebar
          into the window content, so we need to reserve ~28 px at the top and
          make it draggable so users can still move the window. */}
      {window.platform === 'darwin' && (
        <div
          className="shrink-0 bg-app-sidebar"
          style={{ height: 28, WebkitAppRegion: 'drag' } as React.CSSProperties}
        />
      )}
      {/* Main layout */}
      <PanelGroup direction="horizontal" className="flex-1 overflow-hidden">
        {/* Sidebar */}
        <Panel defaultSize={18} minSize={12} maxSize={35}>
          <Sidebar />
        </Panel>

        <PanelResizeHandle className="w-px bg-app-border hover:bg-accent-blue transition-colors" />

        {/* Main content */}
        <Panel defaultSize={82} minSize={50}>
          <div className="flex flex-col h-full">
            {/* Tab bar */}
            <TabBar />

            {activeTab?.type === 'table' ? (
              <div className="flex-1 overflow-hidden">
                <TableDataView tab={activeTab} />
              </div>
            ) : activeTab?.type === 'database' ? (
              <div className="flex-1 overflow-hidden">
                <DatabaseOverview tab={activeTab} />
              </div>
            ) : (
              <PanelGroup direction="vertical" className="flex-1 overflow-hidden">
                <Panel defaultSize={55} minSize={20}>
                  <div className="flex flex-col h-full">
                    {/* AI input bar */}
                    <AIInputBar />
                    {/* SQL editor */}
                    <div className="flex-1 overflow-hidden">
                      <QueryEditor />
                    </div>
                  </div>
                </Panel>

                <PanelResizeHandle className="h-px bg-app-border hover:bg-accent-blue transition-colors" />

                <Panel defaultSize={45} minSize={15}>
                  <ResultsPanel result={activeTab?.result ?? null} isLoading={activeTab?.isLoading ?? false} />
                </Panel>
              </PanelGroup>
            )}
          </div>
        </Panel>
      </PanelGroup>

      {/* Dialogs */}
      {showConnectionDialog && <ConnectionDialog />}
      {showSettings && <SettingsDialog />}
      {showAppSettings && <AppSettingsDialog />}
    </div>
  )
}
