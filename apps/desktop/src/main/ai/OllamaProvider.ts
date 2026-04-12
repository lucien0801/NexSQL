import type { AIConfig, NLToSQLRequest } from '@shared/types/ai'
import { buildSystemPrompt, getDefaultModel, type AIProvider } from './AIProvider'

interface OllamaResponse {
  model: string
  response: string
  done: boolean
}

export class OllamaProvider implements AIProvider {
  private config: AIConfig
  private baseUrl: string

  constructor(config: AIConfig) {
    this.config = config
    this.baseUrl = (config.ollamaBaseUrl ?? 'http://localhost:11434').replace(/\/$/, '')
  }

  async generateSQL(
    schema: string,
    request: NLToSQLRequest,
    onToken: (token: string) => void
  ): Promise<string> {
    const model = getDefaultModel(this.config)
    const systemPrompt = buildSystemPrompt(schema, request.dialect)
    const prompt = `${systemPrompt}\n\nUser request: ${request.question}`

    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        stream: true,
        options: {
          temperature: this.config.temperature ?? 0.1,
          num_predict: this.config.maxTokens ?? 1024
        }
      })
    })

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status} ${response.statusText}`)
    }

    if (!response.body) {
      throw new Error('Ollama returned empty response body')
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let fullSQL = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const lines = decoder.decode(value, { stream: true }).split('\n')
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const data = JSON.parse(line) as OllamaResponse
          if (data.response) {
            fullSQL += data.response
            onToken(data.response)
          }
          if (data.done) break
        } catch {
          // skip malformed JSON lines
        }
      }
    }

    return fullSQL.trim()
  }
}
