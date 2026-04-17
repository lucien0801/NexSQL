import OpenAI from 'openai'
import type {
  AIConfig,
  NLToSQLRequest,
  SQLOptimizeRequest,
  AIDesignRequest,
  AIDocRequest,
  ERGraphInferRequest
} from '@shared/types/ai'
import {
  buildSystemPrompt,
  buildOptimizePrompt,
  buildDesignPrompt,
  buildSchemaDocPrompt,
  buildRelationInferPrompt,
  getDefaultModel,
  type AIProvider
} from './AIProvider'

export class OpenAIProvider implements AIProvider {
  private client: OpenAI
  private config: AIConfig

  constructor(config: AIConfig) {
    this.config = config
    this.client = new OpenAI({
      apiKey: config.apiKey ?? 'sk-placeholder',
      baseURL: config.baseUrl ?? undefined
    })
  }

  async generateSQL(
    schema: string,
    request: NLToSQLRequest,
    onToken: (token: string) => void
  ): Promise<string> {
    const systemPrompt = buildSystemPrompt(schema, request.dialect)
    return this.streamCompletion(systemPrompt, request.question, onToken)
  }

  async optimizeSQL(
    schema: string,
    request: SQLOptimizeRequest,
    planSummary: string,
    onToken: (token: string) => void
  ): Promise<string> {
    const systemPrompt = buildOptimizePrompt(schema, 'sql', planSummary)
    const userPrompt = `请诊断并优化以下 SQL：\n${request.sql}`
    return this.streamCompletion(systemPrompt, userPrompt, onToken)
  }

  async generateDesignSQL(
    schema: string,
    request: AIDesignRequest,
    onToken: (token: string) => void
  ): Promise<string> {
    const systemPrompt = buildDesignPrompt(schema, request.dialect)
    return this.streamCompletion(systemPrompt, request.prompt, onToken)
  }

  async generateSchemaDoc(
    schema: string,
    request: AIDocRequest,
    onToken: (token: string) => void
  ): Promise<string> {
    const systemPrompt = buildSchemaDocPrompt(schema, request.dialect)
    const targetText = request.targets
      .map((item) => `${item.database}.${item.table}`)
      .join(', ')
    const userPrompt = `为这些表生成 Markdown 数据字典：${targetText}`
    return this.streamCompletion(systemPrompt, userPrompt, onToken)
  }

  async inferSchemaRelations(
    schema: string,
    request: ERGraphInferRequest,
    onToken: (token: string) => void
  ): Promise<string> {
    const systemPrompt = buildRelationInferPrompt(schema)
    const userPrompt = `请为数据库 ${request.databaseName} 推断最多 ${request.maxCandidates ?? 60} 条关系。`
    return this.streamCompletion(systemPrompt, userPrompt, onToken)
  }

  private async streamCompletion(
    systemPrompt: string,
    userPrompt: string,
    onToken: (token: string) => void
  ): Promise<string> {
    const model = getDefaultModel(this.config)

    const stream = await this.client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      stream: true,
      max_tokens: this.config.maxTokens ?? 1024,
      temperature: this.config.temperature ?? 0.1
    })

    let fullSQL = ''
    for await (const chunk of stream) {
      const token = chunk.choices[0]?.delta?.content ?? ''
      if (token) {
        fullSQL += token
        onToken(token)
      }
    }

    return fullSQL.trim()
  }
}
