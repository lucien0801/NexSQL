import { create } from 'zustand'
import type { AIConfig } from '@shared/types/ai'

interface AIState {
  config: AIConfig | null
  isGenerating: boolean
  streamingSQL: string

  loadConfig: () => Promise<void>
  updateConfig: (config: Partial<AIConfig>) => Promise<void>
  generateSQL: (question: string, connectionId: string, database?: string) => Promise<string>
  setGenerating: (generating: boolean) => void
  appendStreamToken: (token: string) => void
  resetStreaming: () => void
}

export const useAIStore = create<AIState>((set, get) => ({
  config: null,
  isGenerating: false,
  streamingSQL: '',

  loadConfig: async () => {
    if (!window.ai) return
    const config = await window.ai.getConfig()
    set({ config })
  },

  updateConfig: async (partial) => {
    if (!window.ai) return
    await window.ai.updateConfig(partial)
    const updated = await window.ai.getConfig()
    set({ config: updated })
  },

  generateSQL: async (question, connectionId, database) => {
    if (!window.ai) throw new Error('AI 接口不可用')
    const { config } = get()
    if (!config || (!config.apiKey && config.provider === 'openai')) {
      throw new Error('请先在设置中配置 AI')
    }

    set({ isGenerating: true, streamingSQL: '' })

    // Register streaming listener
    const unsub = window.ai!.onSQLToken((token) => {
      set((state) => ({ streamingSQL: state.streamingSQL + token }))
    })

    try {
      const sql = await window.ai!.generateSQL({
        question,
        connectionId,
        databaseName: database,
        dialect: 'sql' // will be enriched by the main process based on connection type
      })
      return sql
    } finally {
      unsub()
      set({ isGenerating: false })
    }
  },

  setGenerating: (generating) => set({ isGenerating: generating }),
  appendStreamToken: (token) =>
    set((state) => ({ streamingSQL: state.streamingSQL + token })),
  resetStreaming: () => set({ streamingSQL: '' })
}))
