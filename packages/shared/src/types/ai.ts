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

export interface SQLOptimizeRequest {
  sql: string
  connectionId: string
  databaseName?: string
  maxPlanRows?: number
}

export interface SQLOptimizeResponse {
  sql: string
  explainSQL: string
  planSummary: string
  planRows: Record<string, unknown>[]
  recommendations: string
  semanticMatches: string[]
  createdAt: number
}

export interface AIDesignRequest {
  prompt: string
  connectionId: string
  databaseName?: string
  dialect: string
  includeExistingSchema?: boolean
}

export interface AIDesignResponse {
  sql: string
  notes: string
  createdAt: number
}

export interface TableDocTarget {
  database: string
  table: string
}

export interface AIDocRequest {
  connectionId: string
  targets: TableDocTarget[]
  dialect: string
}

export interface AIDocResponse {
  markdown: string
  createdAt: number
}

export interface SemanticIndexBuildRequest {
  connectionId: string
  databaseName?: string
  tables?: string[]
}

export type SemanticIndexItemStatus = 'indexed' | 'failed'

export interface SemanticIndexItem {
  connectionId: string
  databaseName: string
  tableName: string
  schemaHash: string
  summaryText: string
  manualNotes?: string
  status: SemanticIndexItemStatus
  error?: string
  updatedAt: number
}

export interface SemanticIndexUpdateRequest {
  connectionId: string
  databaseName: string
  tableName: string
  manualNotes: string
}

export interface SemanticIndexBuildResponse {
  total: number
  indexed: number
  failed: number
  skipped: number
  items: SemanticIndexItem[]
  createdAt: number
}

export type ERRelationType = '1:1' | '1:N' | 'N:M' | 'unknown'
export type ERRelationSourceType = 'manual' | 'inferred' | 'metadata'
export type ERRelationStatus = 'confirmed' | 'pending' | 'rejected'

export interface ERGraphColumn {
  name: string
  type: string
  nullable: boolean
  primaryKey: boolean
}

export interface ERGraphNode {
  connectionId: string
  databaseName: string
  tableName: string
  x: number
  y: number
  collapsed?: boolean
  columns: ERGraphColumn[]
}

export interface ERGraphEdge {
  id: string
  connectionId: string
  databaseName: string
  sourceTable: string
  sourceColumn: string
  targetTable: string
  targetColumn: string
  relationType: ERRelationType
  confidence: number
  sourceType: ERRelationSourceType
  note?: string
  status: ERRelationStatus
  createdAt: number
  updatedAt: number
}

export interface ERGraphLoadRequest {
  connectionId: string
  databaseName: string
}

export interface ERGraphLoadResponse {
  connectionId: string
  databaseName: string
  nodes: ERGraphNode[]
  edges: ERGraphEdge[]
  createdAt: number
}

export interface ERGraphSaveRequest {
  connectionId: string
  databaseName: string
  nodes: Array<Pick<ERGraphNode, 'tableName' | 'x' | 'y' | 'collapsed'>>
  edges: ERGraphEdge[]
}

export interface ERGraphSaveResponse {
  connectionId: string
  databaseName: string
  savedNodes: number
  savedEdges: number
  updatedAt: number
}

export interface ERGraphInferRequest {
  connectionId: string
  databaseName: string
  maxCandidates?: number
}

export interface ERGraphInferResponse {
  connectionId: string
  databaseName: string
  candidates: ERGraphEdge[]
  createdAt: number
}
