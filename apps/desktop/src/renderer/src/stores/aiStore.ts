import { create } from 'zustand'
import type {
  AIConfig,
  SQLOptimizeResponse,
  AIDesignResponse,
  AIDocResponse,
  SemanticIndexBuildResponse,
  SemanticIndexItem,
  ERGraphEdge,
  ERGraphNode,
  ERGraphLoadResponse
} from '@shared/types/ai'

export type AITaskType = 'optimize' | 'design' | 'doc' | 'index' | 'er'

export interface AITaskLog {
  id: string
  task: AITaskType
  message: string
  createdAt: number
  level: 'info' | 'success' | 'error'
}

interface AIState {
  config: AIConfig | null
  isGenerating: boolean
  isOptimizing: boolean
  isBuildingIndex: boolean
  streamingSQL: string
  optimizeResults: Record<string, SQLOptimizeResponse>
  designResult: AIDesignResponse | null
  docResult: AIDocResponse | null
  semanticIndexStatus: Record<string, SemanticIndexItem[]>
  erGraphByKey: Record<string, ERGraphLoadResponse>
  logs: AITaskLog[]
  currentTask: AITaskType | null
  isLoadingERGraph: boolean
  isSavingERGraph: boolean
  isInferringERGraph: boolean

  loadConfig: () => Promise<void>
  updateConfig: (config: Partial<AIConfig>) => Promise<void>
  generateSQL: (question: string, connectionId: string, database?: string) => Promise<string>
  optimizeSQL: (tabId: string, sql: string, connectionId: string, database?: string) => Promise<SQLOptimizeResponse>
  generateDesignSQL: (
    prompt: string,
    connectionId: string,
    dialect: string,
    database?: string,
    includeExistingSchema?: boolean
  ) => Promise<AIDesignResponse>
  generateSchemaDoc: (
    connectionId: string,
    dialect: string,
    targets: Array<{ database: string; table: string }>
  ) => Promise<AIDocResponse>
  buildSemanticIndex: (
    connectionId: string,
    database?: string,
    tables?: string[]
  ) => Promise<SemanticIndexBuildResponse>
  loadSemanticIndexStatus: (connectionId: string) => Promise<void>
  updateSemanticIndexItem: (
    connectionId: string,
    databaseName: string,
    tableName: string,
    manualNotes: string
  ) => Promise<void>
  loadERGraph: (connectionId: string, databaseName: string) => Promise<ERGraphLoadResponse>
  saveERGraph: (
    connectionId: string,
    databaseName: string,
    nodes: Array<Pick<ERGraphNode, 'tableName' | 'x' | 'y' | 'collapsed'>>,
    edges: ERGraphEdge[]
  ) => Promise<void>
  inferSchemaRelations: (connectionId: string, databaseName: string, maxCandidates?: number) => Promise<ERGraphEdge[]>
  addLog: (task: AITaskType, message: string, level?: AITaskLog['level']) => void
  clearOptimizeResult: (tabId: string) => void
  clearLogs: () => void
  setGenerating: (generating: boolean) => void
  appendStreamToken: (token: string) => void
  resetStreaming: () => void
}

export const useAIStore = create<AIState>((set, get) => ({
  config: null,
  isGenerating: false,
  isOptimizing: false,
  isBuildingIndex: false,
  streamingSQL: '',
  optimizeResults: {},
  designResult: null,
  docResult: null,
  semanticIndexStatus: {},
  erGraphByKey: {},
  logs: [],
  currentTask: null,
  isLoadingERGraph: false,
  isSavingERGraph: false,
  isInferringERGraph: false,

  addLog: (task: AITaskType, message: string, level: AITaskLog['level'] = 'info') => {
    set((state) => ({
      logs: [
        {
          id: crypto.randomUUID(),
          task,
          message,
          createdAt: Date.now(),
          level
        },
        ...state.logs
      ].slice(0, 200)
    }))
  },

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

  optimizeSQL: async (tabId, sql, connectionId, database) => {
    if (!window.ai) throw new Error('AI 接口不可用')
    const { config } = get()
    if (!config || (!config.apiKey && config.provider === 'openai')) {
      throw new Error('请先在设置中配置 AI')
    }

    set({ isOptimizing: true, currentTask: 'optimize' })
    get().addLog('optimize', '已提交 SQL 优化任务，正在分析执行计划...')
    try {
      const result = await window.ai.optimizeSQL({
        sql,
        connectionId,
        databaseName: database
      })
      set((state) => ({
        isOptimizing: false,
        currentTask: null,
        optimizeResults: {
          ...state.optimizeResults,
          [tabId]: result
        }
      }))
      if (result.semanticMatches.length > 0) {
        get().addLog('optimize', `已命中语义索引 ${result.semanticMatches.length} 项：${result.semanticMatches.join(', ')}`)
      } else {
        get().addLog('optimize', '本次优化未命中语义索引，将主要依赖执行计划与 schema。')
      }
      get().addLog('optimize', 'SQL 优化完成，已返回建议。', 'success')
      return result
    } catch (err) {
      set({ isOptimizing: false, currentTask: null })
      get().addLog(
        'optimize',
        `SQL 优化失败：${err instanceof Error ? err.message : String(err)}`,
        'error'
      )
      throw err
    }
  },

  generateDesignSQL: async (prompt, connectionId, dialect, database, includeExistingSchema = true) => {
    if (!window.ai) throw new Error('AI 接口不可用')
    set({ currentTask: 'design' })
    get().addLog('design', '已提交数据库设计任务，正在生成设计 SQL...')
    const result = await window.ai.generateDesignSQL({
      prompt,
      connectionId,
      databaseName: database,
      dialect,
      includeExistingSchema
    })
    set({ designResult: result, currentTask: null })
    get().addLog('design', '数据库设计生成完成。', 'success')
    return result
  },

  generateSchemaDoc: async (connectionId, dialect, targets) => {
    if (!window.ai) throw new Error('AI 接口不可用')
    set({ currentTask: 'doc' })
    get().addLog('doc', `已提交文档生成任务，目标表 ${targets.length} 张。`)
    const result = await window.ai.generateSchemaDoc({
      connectionId,
      dialect,
      targets
    })
    set({ docResult: result, currentTask: null })
    get().addLog('doc', '数据字典生成完成，可复制 Markdown。', 'success')
    return result
  },

  buildSemanticIndex: async (connectionId, database, tables) => {
    if (!window.ai) throw new Error('AI 接口不可用')
    set({ isBuildingIndex: true, currentTask: 'index' })
    get().addLog('index', '开始构建语义索引...')
    try {
      const result = await window.ai.buildSemanticIndex({
        connectionId,
        databaseName: database,
        tables
      })
      set((state) => ({
        isBuildingIndex: false,
        currentTask: null,
        semanticIndexStatus: {
          ...state.semanticIndexStatus,
          [connectionId]: result.items
        }
      }))
      get().addLog(
        'index',
        `语义索引构建完成：新增/更新 ${result.indexed}，跳过 ${result.skipped}，失败 ${result.failed}。`,
        result.failed > 0 ? 'info' : 'success'
      )
      return result
    } catch (err) {
      set({ isBuildingIndex: false, currentTask: null })
      get().addLog(
        'index',
        `语义索引构建失败：${err instanceof Error ? err.message : String(err)}`,
        'error'
      )
      throw err
    }
  },

  loadSemanticIndexStatus: async (connectionId) => {
    if (!window.ai) return
    const items = await window.ai.getSemanticIndexStatus(connectionId)
    set((state) => ({
      semanticIndexStatus: {
        ...state.semanticIndexStatus,
        [connectionId]: items
      }
    }))
  },

  updateSemanticIndexItem: async (connectionId, databaseName, tableName, manualNotes) => {
    if (!window.ai) throw new Error('AI 接口不可用')
    if (typeof window.ai.updateSemanticIndexItem !== 'function') {
      throw new Error('AI 接口版本过旧，请重启桌面应用以加载最新 Preload API。')
    }
    const updated = await window.ai.updateSemanticIndexItem({
      connectionId,
      databaseName,
      tableName,
      manualNotes
    })
    set((state) => ({
      semanticIndexStatus: {
        ...state.semanticIndexStatus,
        [connectionId]: (state.semanticIndexStatus[connectionId] ?? []).map((item) =>
          item.databaseName === databaseName && item.tableName === tableName ? updated : item
        )
      }
    }))
    await get().loadSemanticIndexStatus(connectionId)
    get().addLog('index', `已更新语义索引备注：${databaseName}.${tableName}`, 'success')
  },

  loadERGraph: async (connectionId, databaseName) => {
    if (!window.ai) throw new Error('AI 接口不可用')
    set({ isLoadingERGraph: true, currentTask: 'er' })
    get().addLog('er', `加载 E-R 图：${databaseName}`)
    try {
      const graph = await window.ai.getERGraph({ connectionId, databaseName })
      const key = `${connectionId}:${databaseName}`
      set((state) => ({
        isLoadingERGraph: false,
        currentTask: null,
        erGraphByKey: {
          ...state.erGraphByKey,
          [key]: graph
        }
      }))
      return graph
    } catch (err) {
      set({ isLoadingERGraph: false, currentTask: null })
      get().addLog('er', `加载 E-R 图失败：${err instanceof Error ? err.message : String(err)}`, 'error')
      throw err
    }
  },

  saveERGraph: async (connectionId, databaseName, nodes, edges) => {
    if (!window.ai) throw new Error('AI 接口不可用')
    set({ isSavingERGraph: true, currentTask: 'er' })
    get().addLog('er', `保存 E-R 图：${databaseName}`)
    try {
      await window.ai.saveERGraph({ connectionId, databaseName, nodes, edges })
      await get().loadERGraph(connectionId, databaseName)
      set({ isSavingERGraph: false, currentTask: null })
      get().addLog('er', `E-R 图保存完成：${databaseName}`, 'success')
    } catch (err) {
      set({ isSavingERGraph: false, currentTask: null })
      get().addLog('er', `保存 E-R 图失败：${err instanceof Error ? err.message : String(err)}`, 'error')
      throw err
    }
  },

  inferSchemaRelations: async (connectionId, databaseName, maxCandidates = 60) => {
    if (!window.ai) throw new Error('AI 接口不可用')
    set({ isInferringERGraph: true, currentTask: 'er' })
    get().addLog('er', `开始自动推断关系：${databaseName}`)
    try {
      const response = await window.ai.inferSchemaRelations({ connectionId, databaseName, maxCandidates })
      set({ isInferringERGraph: false, currentTask: null })
      get().addLog('er', `推断完成，候选关系 ${response.candidates.length} 条。`, 'success')
      return response.candidates
    } catch (err) {
      set({ isInferringERGraph: false, currentTask: null })
      get().addLog('er', `自动推断失败：${err instanceof Error ? err.message : String(err)}`, 'error')
      throw err
    }
  },

  clearOptimizeResult: (tabId) => {
    set((state) => {
      const next = { ...state.optimizeResults }
      delete next[tabId]
      return { optimizeResults: next }
    })
  },

  clearLogs: () => set({ logs: [] }),

  setGenerating: (generating) => set({ isGenerating: generating }),
  appendStreamToken: (token) =>
    set((state) => ({ streamingSQL: state.streamingSQL + token })),
  resetStreaming: () => set({ streamingSQL: '' })
}))
