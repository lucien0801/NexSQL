import OpenAI from 'openai'
import type { AIConfig, NLToSQLRequest } from '@shared/types/ai'
import { buildSystemPrompt, getDefaultModel, type AIProvider } from './AIProvider'

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
    const model = getDefaultModel(this.config)
    const systemPrompt = buildSystemPrompt(schema, request.dialect)

    const stream = await this.client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: request.question }
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
