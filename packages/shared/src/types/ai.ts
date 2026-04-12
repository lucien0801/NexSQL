export type AIProviderType = 'openai' | 'ollama'

export interface AIConfig {
  provider: AIProviderType
  // OpenAI-compatible
  apiKey?: string
  baseUrl?: string
  model?: string
  // Ollama
  ollamaBaseUrl?: string
  ollamaModel?: string
  // General
  maxTokens?: number
  temperature?: number
}

export interface NLToSQLRequest {
  question: string
  connectionId: string
  databaseName?: string
  dialect: string
  tableHints?: string[] // focus on specific tables
}

export interface NLToSQLChunk {
  type: 'token' | 'done' | 'error'
  content: string
}
