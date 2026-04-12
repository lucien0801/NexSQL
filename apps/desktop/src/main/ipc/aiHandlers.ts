import { ipcMain, app } from 'electron'
import Database from 'better-sqlite3'
import { join } from 'path'
import type { AIConfig, NLToSQLRequest } from '@shared/types/ai'
import { OpenAIProvider } from '../ai/OpenAIProvider'
import { OllamaProvider } from '../ai/OllamaProvider'
import { buildSchemaContext } from '../ai/SchemaContextBuilder'
import { getSchema } from '../db/QueryExecutor'
import { getMainWindow } from '../index'

let internalDb: Database.Database | null = null

function getInternalDb(): Database.Database {
  if (!internalDb) {
    internalDb = new Database(join(app.getPath('userData'), 'nexsql.db'))
  }
  return internalDb
}

const DEFAULT_CONFIG: AIConfig = {
  provider: 'openai',
  model: 'gpt-4o-mini',
  baseUrl: '',
  apiKey: '',
  ollamaBaseUrl: 'http://localhost:11434',
  ollamaModel: 'qwen2.5-coder:7b',
  maxTokens: 1024,
  temperature: 0.1
}

function getSetting(key: string): string | null {
  const db = getInternalDb()
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value ?? null
}

function setSetting(key: string, value: string): void {
  const db = getInternalDb()
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value)
}

export function getAIConfig(): AIConfig {
  const raw = getSetting('ai_config')
  if (!raw) return { ...DEFAULT_CONFIG }
  try {
    return { ...DEFAULT_CONFIG, ...(JSON.parse(raw) as Partial<AIConfig>) }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

export function registerAiHandlers(): void {
  ipcMain.handle('ai:getConfig', async () => {
    const config = getAIConfig()
    // Don't expose API key to renderer; send masked version
    return { ...config, apiKey: config.apiKey ? '••••••••' : '' }
  })

  ipcMain.handle('ai:updateConfig', async (_event, partial: Partial<AIConfig>) => {
    const current = getAIConfig()
    // If user sends back masked key, keep the original
    if (partial.apiKey === '••••••••') {
      delete partial.apiKey
    }
    const updated = { ...current, ...partial }
    setSetting('ai_config', JSON.stringify(updated))
  })

  ipcMain.handle('ai:generateSQL', async (_event, request: NLToSQLRequest) => {
    const config = getAIConfig()
    const win = getMainWindow()

    let schemaContext = ''
    try {
      const schema = await getSchema(request.connectionId, request.databaseName)
      schemaContext = buildSchemaContext(schema, request.tableHints)
    } catch {
      schemaContext = '-- Schema unavailable'
    }

    const provider =
      config.provider === 'ollama' ? new OllamaProvider(config) : new OpenAIProvider(config)

    const sql = await provider.generateSQL(schemaContext, request, (token) => {
      win?.webContents.send('ai:sqlToken', token)
    })

    win?.webContents.send('ai:sqlDone')
    return sql
  })
}
