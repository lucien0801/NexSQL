import type {
  AIConfig,
  NLToSQLRequest,
  SQLOptimizeRequest,
  AIDesignRequest,
  AIDocRequest,
  ERGraphInferRequest
} from '@shared/types/ai'

export interface AIProvider {
  generateSQL(
    schema: string,
    request: NLToSQLRequest,
    onToken: (token: string) => void
  ): Promise<string>
  optimizeSQL(
    schema: string,
    request: SQLOptimizeRequest,
    planSummary: string,
    onToken: (token: string) => void
  ): Promise<string>
  generateDesignSQL(
    schema: string,
    request: AIDesignRequest,
    onToken: (token: string) => void
  ): Promise<string>
  generateSchemaDoc(
    schema: string,
    request: AIDocRequest,
    onToken: (token: string) => void
  ): Promise<string>
  inferSchemaRelations(
    schema: string,
    request: ERGraphInferRequest,
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

export function buildOptimizePrompt(schema: string, dialect: string, planSummary: string): string {
  return `You are a senior SQL performance engineer.
Database dialect: ${dialect.toUpperCase()}
Schema context:
${schema}

Execution plan summary:
${planSummary}

Return actionable recommendations in Chinese using this structure:
1) 问题点
2) 优化建议
3) 原因解释
4) 风险与注意事项
5) 可执行 SQL 示例

Keep recommendations practical and avoid guessing unavailable indexes.`
}

export function buildDesignPrompt(schema: string, dialect: string): string {
  return `You are a database architect.
Database dialect: ${dialect.toUpperCase()}
Existing schema context:
${schema}

Generate SQL DDL for the requested business domain.
Output format:
1) First line: brief design notes in Chinese
2) Then pure executable SQL statements

Requirements:
- Include primary keys and foreign keys where appropriate
- Add important indexes
- Use clear table and column names`
}

export function buildSchemaDocPrompt(schema: string, dialect: string): string {
  return `You are a database documentation specialist.
Database dialect: ${dialect.toUpperCase()}
Schema context:
${schema}

Generate concise Markdown data dictionary in Chinese.
For each table include:
- Table purpose
- Columns (name, type, nullable, key, comment)
- Index summary
- Relationship notes`
}

export function buildRelationInferPrompt(schema: string): string {
  return `You are a database relationship modeling assistant.
Schema context:
${schema}

Return ONLY JSON array with this shape:
[
  {
    "sourceTable": "orders",
    "sourceColumn": "user_id",
    "targetTable": "users",
    "targetColumn": "id",
    "relationType": "1:N",
    "confidence": 0.86,
    "reason": "column naming + key pattern"
  }
]

Rules:
- relationType must be one of: 1:1, 1:N, N:M, unknown
- confidence range 0 to 1
- never include markdown or any text outside JSON
- prefer high precision over recall`
}

export function getDefaultModel(config: AIConfig): string {
  if (config.provider === 'openai') {
    return config.model ?? 'gpt-4o-mini'
  }
  return config.ollamaModel ?? 'qwen2.5-coder:7b'
}
