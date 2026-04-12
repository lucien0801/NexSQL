import { useState, useRef, useEffect } from 'react'
import { Sparkles, Loader2, Settings } from 'lucide-react'
import { useAIStore } from '@renderer/stores/aiStore'
import { useQueryStore } from '@renderer/stores/queryStore'
import { useConnectionStore } from '@renderer/stores/connectionStore'
import { useUIStore } from '@renderer/stores/uiStore'
import { clsx } from 'clsx'

export function AIInputBar(): JSX.Element {
  const [question, setQuestion] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const { isGenerating, generateSQL, loadConfig, config } = useAIStore()
  const { tabs, activeTabId, updateTabSQL } = useQueryStore()
  const { activeConnectionId } = useConnectionStore()
  const { setShowSettings } = useUIStore()

  useEffect(() => {
    loadConfig()
  }, [])

  const activeTab = tabs.find((t) => t.id === activeTabId)
  const connectionId = activeTab?.connectionId ?? activeConnectionId

  const isConfigured = config
    ? config.provider === 'ollama'
      ? !!(config.ollamaBaseUrl && config.ollamaModel)
      : !!(config.apiKey)
    : false

  const handleGenerate = async (): Promise<void> => {
    if (!question.trim() || !connectionId || isGenerating) return

    try {
      const sql = await generateSQL(
        question.trim(),
        connectionId,
        activeTab?.selectedDatabase ?? undefined
      )
      if (activeTabId) {
        updateTabSQL(activeTabId, sql)
      }
      setQuestion('')
    } catch (err) {
      console.error('AI 生成失败:', err)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleGenerate()
    }
  }

  return (
    <div className="border-b border-app-border bg-app-sidebar shrink-0">
      <div className="flex items-center gap-2 px-3 py-2">
        <Sparkles size={13} className={clsx('shrink-0', isConfigured ? 'text-accent-blue' : 'text-text-muted')} />
        <input
          ref={inputRef}
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            !isConfigured
              ? '点击右侧 ⚙ 配置 AI...'
              : !connectionId
              ? '请先连接数据库...'
              : '用自然语言描述查询需求，按 Enter 生成 SQL...'
          }
          className={clsx(
            'flex-1 bg-app-input text-text-primary text-xs px-2.5 py-1.5 rounded border border-app-border',
            'focus:outline-none focus:border-accent-blue placeholder:text-text-muted',
            'selectable'
          )}
          disabled={isGenerating || !isConfigured || !connectionId}
        />
        <button
          onClick={handleGenerate}
          disabled={!question.trim() || !connectionId || isGenerating || !isConfigured}
          className={clsx(
            'flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded transition-colors shrink-0',
            'bg-accent-blue text-white hover:bg-blue-600',
            'disabled:opacity-40 disabled:cursor-not-allowed'
          )}
        >
          {isGenerating ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Sparkles size={12} />
          )}
          生成
        </button>
        <button
          onClick={() => setShowSettings(true)}
          title="AI 设置"
          className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-app-hover transition-colors"
        >
          <Settings size={13} />
        </button>
      </div>
    </div>
  )
}

