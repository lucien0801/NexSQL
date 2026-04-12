import type { AIConfig, NLToSQLRequest } from '@shared/types/ai'

export interface AIProvider {
  generateSQL(
    schema: string,
    request: NLToSQLRequest,
    onToken: (token: string) => void
  ): Promise<string>
}

export function buildSystemPrompt(schema: string, dialect: string): string {
  return `You are an expert SQL developer. Generate ONLY the SQL query with no explanation or markdown.
Database dialect: ${dialect.toUpperCase()}
Database schema:
${schema}
Rules:
- Return ONLY the SQL statement, no markdown code blocks
- Use proper ${dialect.toUpperCase()} syntax
- Use appropriate quoting for identifiers
- Do not include comments in the output`
}

export function getDefaultModel(config: AIConfig): string {
  if (config.provider === 'openai') {
    return config.model ?? 'gpt-4o-mini'
  }
  return config.ollamaModel ?? 'qwen2.5-coder:7b'
}
